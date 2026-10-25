import { type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { setSmsConsentByPhone } from "@/lib/db/repo";
import { normalizePhone } from "@/lib/sms/phone";
import { complianceKeyword, SMS_REPLIES } from "@/lib/sms/keywords";
import { createLoginLink } from "@/lib/auth/links";
import { inboundIntent, SNOOZE_REPLY, UNKNOWN_REPLY, YES_REPLY } from "@/lib/sms/nudge";
import { lastNudgedTopic, logSms, studentByPhone } from "@/lib/sms/service";
import { isValidTwilioRequest } from "@/lib/sms/twilio-signature";

// Twilio inbound SMS webhook. STOP / START / HELP always work first; then YES
// (send a session link) and LATER (snooze until tomorrow).
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params = Object.fromEntries([...form].map(([k, v]) => [k, String(v)]));

  if (env.twilioAuthToken) {
    const url = `${env.appUrl}${request.nextUrl.pathname}`;
    if (!isValidTwilioRequest(env.twilioAuthToken, url, params, request.headers.get("x-twilio-signature"))) {
      return new Response("Invalid signature", { status: 403 });
    }
  } else if (env.isProd) {
    return new Response("SMS is not configured", { status: 503 });
  }

  const from = normalizePhone(params.From ?? "");
  const keyword = complianceKeyword(params.Body ?? "");
  let reply: string | null = null;

  if (keyword === "stop" && from) {
    await setSmsConsentByPhone(from, false, `Texted "${params.Body}"`);
    reply = SMS_REPLIES.stop;
  } else if (keyword === "start" && from) {
    await setSmsConsentByPhone(from, true, `Texted "${params.Body}". ${SMS_REPLIES.start}`);
    reply = SMS_REPLIES.start;
  } else if (keyword === "help") {
    reply = SMS_REPLIES.help;
  }

  const student = from ? await studentByPhone(from) : null;
  if (student && !keyword) {
    const intent = inboundIntent(params.Body ?? "");
    await logSms(student.id, { direction: "in", kind: intent === "later" ? "snooze" : "other", body: String(params.Body ?? "").slice(0, 1000), status: "received" });
    if (intent === "yes") {
      const topic = await lastNudgedTopic(student.id);
      reply = YES_REPLY(await createLoginLink(student.id, topic?.topicId ?? null), topic?.name ?? null);
    } else if (intent === "later") {
      reply = SNOOZE_REPLY;
    } else {
      reply = UNKNOWN_REPLY;
    }
    await logSms(student.id, { direction: "out", kind: "reply", body: reply, status: "sent" });
  }

  return new Response(twiml(reply), { headers: { "content-type": "text/xml" } });
}

function twiml(message: string | null) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${esc(message)}</Message>` : ""}</Response>`;
}
