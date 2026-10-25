// Instructor sessions: a separate signed cookie, so a student token can never
// open the dashboard (the signature covers the "faculty:" prefix).
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { getFaculty, type Faculty } from "@/lib/db/classes";

export const FACULTY_COOKIE = "ready_faculty";
const MAX_AGE = 60 * 60 * 24 * 30;

const sign = (id: string) => createHmac("sha256", env.sessionSecret).update(`faculty:${id}`).digest("base64url");

export function encodeFacultySession(id: string): string {
  return `${id}.${sign(id)}`;
}

export function decodeFacultySession(token: string | undefined): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const id = token.slice(0, i);
  const expected = Buffer.from(sign(id));
  const given = Buffer.from(token.slice(i + 1));
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

export async function startFacultySession(id: string) {
  (await cookies()).set(FACULTY_COOKIE, encodeFacultySession(id), { httpOnly: true, sameSite: "lax", secure: env.isProd, path: "/", maxAge: MAX_AGE });
}

export async function endFacultySession() {
  (await cookies()).delete(FACULTY_COOKIE);
}

export async function currentFaculty(): Promise<Faculty | null> {
  const id = decodeFacultySession((await cookies()).get(FACULTY_COOKIE)?.value);
  return id ? getFaculty(id) : null;
}
