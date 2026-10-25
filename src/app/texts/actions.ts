"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { currentStudent } from "@/lib/auth/session";
import { parseHourRange } from "@/lib/onboarding/flow";
import { normalizePhone } from "@/lib/sms/phone";
import { smsConsentText } from "@/lib/sms/keywords";
import { nudgeStudent, removePushSubscriptions, savePushSubscription } from "@/lib/sms/service";

export type TextState = { ok?: string; error?: string } | undefined;

/** The wording shown next to the checkbox, stored verbatim when the student agrees. */
export const settingsConsentText = async () => smsConsentText("the number above", "during the hours above");

export async function saveTextSettings(_: TextState, form: FormData): Promise<TextState> {
  const student = await currentStudent();
  if (!student) return { error: "Please sign in again." };
  const phone = normalizePhone(String(form.get("phone") ?? ""));
  const window = parseHourRange(String(form.get("window") ?? ""));
  if (!phone) return { error: "That doesn't look like a phone number. Try (555) 123-4567." };
  if (!window) return { error: "Give a time range like 5pm–9pm." };
  if (form.get("consent") !== "on") return { error: "Check the box to agree to texts." };
  try {
    await sql.begin(async (tx) => {
      await tx`update students set phone_e164 = ${phone}, text_window_start = ${window.start}, text_window_end = ${window.end} where id = ${student.id}`;
      await tx`insert into consents (student_id, kind, granted, text_shown, source) values (${student.id}, 'sms', true, ${await settingsConsentText()}, 'web')`;
    });
  } catch (err) {
    if (String(err).includes("phone_e164")) return { error: "That number is already linked to another account." };
    throw err;
  }
  revalidatePath("/map");
  return { ok: "Texts are on." };
}

export async function stopTexts() {
  const student = await currentStudent();
  if (!student) return;
  await sql`insert into consents (student_id, kind, granted, text_shown, source) values (${student.id}, 'sms', false, 'Turned off texts on the semester page.', 'web')`;
  revalidatePath("/map");
}

export async function textMeNow(): Promise<TextState> {
  const student = await currentStudent();
  if (!student) return { error: "Please sign in again." };
  const out = await nudgeStudent(student.id, { kind: "test" });
  revalidatePath("/map");
  if (!out.sent) return { error: out.error ? `${out.channel === "push" ? "Push" : "Twilio"}: ${out.error}` : out.reason };
  if (out.status === "dry_run") return { ok: out.channel === "push" ? "Notifications aren't configured on the server yet, so this was logged." : "Twilio isn't connected yet, so this was logged instead of sent." };
  return { ok: out.channel === "push" ? "Sent. Check your notifications." : "Sent. Check your phone." };
}

/** The browser's time zone, so "5pm–9pm" means the student's 5pm. */
export async function saveTimezone(timezone: string) {
  const student = await currentStudent();
  if (!student || student.timezone === timezone) return;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return;
  }
  await sql`update students set timezone = ${timezone} where id = ${student.id}`;
}

/** The browser allowed notifications; remember this device. Allowing in the browser prompt is the consent. */
export async function savePushAction(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string) {
  const student = await currentStudent();
  if (!student) return;
  if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) return;
  await savePushSubscription(student.id, { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth }, userAgent.slice(0, 300));
  await sql`
    insert into consents (student_id, kind, granted, text_shown, source)
    values (${student.id}, 'push', true, 'Allowed Ready notifications on this device: nudges when a test is close and a topic is not ready, up to 2 a day.', 'web')`;
  revalidatePath("/map");
}

export async function removePushAction(endpoint: string | null) {
  const student = await currentStudent();
  if (!student) return;
  await removePushSubscriptions(student.id, endpoint ?? undefined);
  await sql`insert into consents (student_id, kind, granted, text_shown, source) values (${student.id}, 'push', false, 'Turned off notifications.', 'web')`;
  revalidatePath("/map");
}
