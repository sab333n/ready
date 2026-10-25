import { type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { runNudges } from "@/lib/sms/service";

// Vercel Cron (see vercel.json). Each student is only texted inside their own hours.
export async function GET(request: NextRequest) {
  if (!env.cronSecret) return new Response("CRON_SECRET is not set", { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return new Response("Unauthorized", { status: 401 });
  return Response.json(await runNudges());
}
