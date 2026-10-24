// Our own session: an HMAC-signed student id in an httpOnly cookie. Supabase
// (when configured) only proves the email address; after that we use this.
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { getStudent, type Student } from "@/lib/db/repo";

export const SESSION_COOKIE = "ready_session";
const MAX_AGE = 60 * 60 * 24 * 30;

const sign = (value: string) => createHmac("sha256", env.sessionSecret).update(value).digest("base64url");

export function encodeSession(studentId: string): string {
  return `${studentId}.${sign(studentId)}`;
}

export function decodeSession(token: string | undefined): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const id = token.slice(0, i);
  const expected = Buffer.from(sign(id));
  const given = Buffer.from(token.slice(i + 1));
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

export async function startSession(studentId: string) {
  (await cookies()).set(SESSION_COOKIE, encodeSession(studentId), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function currentStudent(): Promise<Student | null> {
  const id = decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
  return id ? getStudent(id) : null;
}
