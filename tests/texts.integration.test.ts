// The text loop end to end, without Twilio: nudges are logged as dry runs,
// links sign in once per tap, and replies to the webhook are understood.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { upsertStudentByEmail } from "@/lib/db/repo";
import { createLoginLink, redeemLoginLink } from "@/lib/auth/links";
import { nudgeStudent, runNudges, savePushSubscription } from "@/lib/sms/service";
import { POST as later } from "@/app/api/push/later/[token]/route";
import { POST as inbound } from "@/app/api/sms/inbound/route";
import { migrate } from "../scripts/migrate";
import { NextRequest } from "next/server";

const PHONE = "+15552013344";
let studentId: string;
let antihypertensives: string;

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!, { log: false });
});

beforeEach(async () => {
  await sql`truncate students cascade`;
  const s = await upsertStudentByEmail("riley@school.edu", "Riley");
  studentId = s.id;
  await sql`update students set phone_e164 = ${PHONE}, timezone = 'America/Chicago', text_window_start = 0, text_window_end = 24, onboarding_done_at = now() where id = ${s.id}`;
  await sql`insert into consents (student_id, kind, granted, text_shown, source) values (${s.id}, 'sms', true, 'test consent', 'web')`;
  const [course] = await sql<{ id: string }[]>`insert into courses (student_id, code, display_code, color) values (${s.id}, 'PHARM201', 'PHARM 201', '#000') returning id`;
  const [t] = await sql<{ id: string }[]>`insert into topics (student_id, course_id, name) values (${s.id}, ${course.id}, 'Antihypertensives') returning id`;
  antihypertensives = t.id;
  await sql`
    insert into deadlines (student_id, course_id, title, kind, due_at, source, external_uid)
    values (${s.id}, ${course.id}, 'Quiz 4: Antihypertensives', 'quiz', now() + interval '3 days', 'manual', 'q4')`;
});

afterAll(async () => {
  await sql.end();
});

const reply = (body: string) => {
  const form = new FormData();
  form.set("From", PHONE);
  form.set("Body", body);
  return inbound(new NextRequest("http://localhost/api/sms/inbound", { method: "POST", body: form }));
};

describe("the text loop", () => {
  it("nudges once, with a link that opens the right topic, and doesn't repeat", async () => {
    expect(await runNudges()).toMatchObject({ checked: 1, sent: 1 });
    const [msg] = await sql<{ body: string; status: string; topicId: string }[]>`select body, status, topic_id from sms_messages`;
    expect(msg.status).toBe("dry_run");
    expect(msg.topicId).toBe(antihypertensives);
    expect(msg.body).toMatch(/Quiz 4: Antihypertensives is .*You haven't taught Antihypertensives yet\./);

    const token = msg.body.match(/\/t\/([\w-]+)/)![1];
    expect(await redeemLoginLink(token)).toEqual({ studentId, topicId: antihypertensives, redirectTo: null });
    expect(await redeemLoginLink("not-a-token")).toBeNull();

    expect(await runNudges()).toMatchObject({ sent: 0 });
  });

  it("answers YES with a link, LATER with a snooze, and keeps STOP working", async () => {
    await nudgeStudent(studentId, { kind: "test" });
    expect(await (await reply("yes")).text()).toMatch(/Here you go: Antihypertensives\. http.*\/t\//);
    expect(await (await reply("later")).text()).toMatch(/no more nudges until tomorrow/);
    expect((await nudgeStudent(studentId, { kind: "nudge" })).reason).toBe("Snoozed");
    expect(await (await reply("STOP")).text()).toMatch(/unsubscribed/);
    expect((await nudgeStudent(studentId, { kind: "nudge" })).reason).toBe("Hasn't turned on reminders");
  });

  it("prefers a notification when the student allowed one, and Later snoozes", async () => {
    await savePushSubscription(studentId, { endpoint: "https://push.example.test/abc", p256dh: "key", auth: "auth" }, "test");
    const out = await nudgeStudent(studentId, { kind: "instructor", from: "Dr. Rivera" });
    expect(out).toMatchObject({ sent: true, channel: "push", status: "dry_run" });
    expect(out.body).toMatch(/^Quiz 4: Antihypertensives is .*Dr\. Rivera asked Ready to check in\. You haven't taught Antihypertensives yet\./);
    const [msg] = await sql<{ channel: string }[]>`select channel from sms_messages order by created_at desc limit 1`;
    expect(msg.channel).toBe("push");

    // The notification's Later button posts the link token; that snoozes like replying LATER.
    const token = (await createLoginLink(studentId, antihypertensives)).split("/t/")[1];
    const res = await later(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(204);
    expect((await nudgeStudent(studentId, { kind: "nudge" })).reason).toBe("Snoozed");
  });
});

