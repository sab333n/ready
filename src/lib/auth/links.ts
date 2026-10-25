// One-tap links in texts: the token signs the student in and opens a session on
// a topic. Only its hash is stored, and it expires in two days.
import { createHash, randomBytes } from "node:crypto";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";

const TTL_MS = 48 * 3600_000;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createLoginLink(studentId: string, topicId: string | null, now = new Date()): Promise<string> {
  const token = randomBytes(16).toString("base64url");
  await sql`
    insert into login_links (token_hash, student_id, topic_id, expires_at)
    values (${hash(token)}, ${studentId}, ${topicId}, ${new Date(now.getTime() + TTL_MS)})`;
  return `${env.appUrl}/t/${token}`;
}

export async function redeemLoginLink(token: string, now = new Date()) {
  const [row] = await sql<{ studentId: string; topicId: string | null }[]>`
    update login_links set last_used_at = ${now}
    where token_hash = ${hash(token)} and expires_at > ${now}
    returning student_id, topic_id`;
  return row ?? null;
}
