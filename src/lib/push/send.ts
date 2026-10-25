// Sends one notification to one device. Push services are free; expired
// subscriptions (404/410) are reported so the caller can forget them.
import webpush from "web-push";
import { env, pushEnabled } from "@/lib/env";

export type PushSubscriptionRow = { endpoint: string; p256dh: string; auth: string };
export type PushResult = { status: "sent" | "dry_run" | "failed" | "gone"; error?: string };

let configured = false;

export async function sendPush(sub: PushSubscriptionRow, payload: Record<string, unknown>): Promise<PushResult> {
  if (!pushEnabled()) return { status: "dry_run" };
  if (!configured) {
    // Apple wants a contact URL or mailto in the VAPID claims.
    const subject = process.env.VAPID_SUBJECT ?? (env.appUrl.startsWith("https://") ? env.appUrl : "mailto:noreply@ready.test");
    webpush.setVapidDetails(subject, env.vapidPublicKey!, env.vapidPrivateKey!);
    configured = true;
  }
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 6 * 3600 });
    return { status: "sent" };
  } catch (err) {
    const code = (err as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) return { status: "gone" };
    return { status: "failed", error: (err instanceof Error ? err.message : "Push failed").slice(0, 300) };
  }
}
