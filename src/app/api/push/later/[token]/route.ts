import { redeemLoginLink } from "@/lib/auth/links";
import { logSms } from "@/lib/sms/service";

// The "Later" button on a notification: snooze nudges until tomorrow, like replying LATER to a text.
export async function POST(_: Request, ctx: RouteContext<"/api/push/later/[token]">) {
  const link = await redeemLoginLink((await ctx.params).token);
  if (!link) return new Response(null, { status: 404 });
  await logSms(link.studentId, { direction: "in", kind: "snooze", channel: "push", body: "Tapped Later on a notification", status: "received" });
  return new Response(null, { status: 204 });
}
