import { type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { setSmsConsentByPhone } from "@/lib/db/repo";
import { normalizePhone } from "@/lib/sms/phone";
import { complianceKeyword, SMS_REPLIES } from "@/lib/sms/keywords";
import { isValidTwilioRequest } from "@/lib/sms/twilio-signature";

// Twilio inbound SMS webhook. Phase 1 handles only STOP / START / HELP, which
// must always work. Other replies (YES, "quiz me", ...) arrive in Phase 4.
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

  return new Response(twiml(reply), { headers: { "content-type": "text/xml" } });
}

function twiml(message: string | null) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${esc(message)}</Message>` : ""}</Response>`;
}
