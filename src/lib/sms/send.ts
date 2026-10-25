// Sends one text through Twilio's REST API. Without Twilio settings the text is
// not sent; the caller logs it as a dry run, so the whole loop works in dev and demos.
import { env, smsSendingEnabled } from "@/lib/env";

export type SendResult = { status: "sent" | "dry_run" | "failed"; providerId?: string; error?: string };

export async function sendSms(to: string, body: string): Promise<SendResult> {
  if (!smsSendingEnabled()) return { status: "dry_run" };
  const params = new URLSearchParams({ To: to, Body: body });
  if (env.twilioFrom!.startsWith("MG")) params.set("MessagingServiceSid", env.twilioFrom!);
  else params.set("From", env.twilioFrom!);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioAccountSid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params,
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!res.ok) return { status: "failed", error: `${data.code ?? res.status}: ${data.message ?? "Twilio rejected the text"}`.slice(0, 300) };
    return { status: "sent", providerId: data.sid };
  } catch (err) {
    return { status: "failed", error: (err instanceof Error ? err.message : "Twilio request failed").slice(0, 300) };
  }
}
