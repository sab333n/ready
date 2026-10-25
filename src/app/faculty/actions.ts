"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { currentFaculty, endFacultySession, startFacultySession } from "@/lib/auth/faculty";
import { createClass, createFaculty, facultyAuthByEmail, facultyClass, sharesWith } from "@/lib/db/classes";
import { deleteVideo, facultyVideo } from "@/lib/db/videos";
import { makeVideo, shareAndNotify } from "@/lib/video/service";
import { nudgeStudent } from "@/lib/sms/service";
import { revalidatePath } from "next/cache";
import { findCourseCode } from "@/lib/courses";

export type FormState = { error?: string } | undefined;

const emailSchema = z.email();

export async function facultySignUp(_: FormState, form: FormData): Promise<FormState> {
  const name = String(form.get("name") ?? "").trim();
  const school = String(form.get("school") ?? "").trim();
  const email = emailSchema.safeParse(String(form.get("email") ?? "").trim());
  const password = String(form.get("password") ?? "");
  if (!name) return { error: "Enter your name as students know it, e.g. Dr. Rivera." };
  if (!email.success) return { error: "Enter a valid email address." };
  if (password.length < 8) return { error: "Use at least 8 characters." };
  const faculty = await createFaculty(email.data, name, await hashPassword(password), school || null);
  if (!faculty) return { error: "That email already has an instructor account. Sign in instead." };
  await startFacultySession(faculty.id);
  redirect("/faculty");
}

export async function facultySignIn(_: FormState, form: FormData): Promise<FormState> {
  const email = emailSchema.safeParse(String(form.get("email") ?? "").trim());
  const password = String(form.get("password") ?? "");
  if (!email.success) return { error: "Enter a valid email address." };
  const row = await facultyAuthByEmail(email.data);
  if (!row || !(await verifyPassword(password, row.passwordHash))) return { error: "That email and password don't match an instructor account." };
  await startFacultySession(row.id);
  redirect("/faculty");
}

export async function facultySignOut() {
  await endFacultySession();
  redirect("/faculty");
}

export async function createClassAction(_: FormState, form: FormData): Promise<FormState> {
  const faculty = await currentFaculty();
  if (!faculty) return { error: "Please sign in again." };
  const name = String(form.get("name") ?? "").trim();
  const course = findCourseCode(String(form.get("code") ?? "").toUpperCase());
  if (!name) return { error: "Name the class, e.g. Pharmacology, Fall 2026." };
  if (!course) return { error: "Enter the course code students see in Canvas, e.g. PHARM 201." };
  const created = await createClass(faculty.id, name, course.displayCode);
  redirect(`/faculty/class/${created.id}`);
}

export type NudgeState = { ok?: string; error?: string } | undefined;

/** "Send a nudge" on the dashboard. Only for students sharing with this class who agreed to texts. */
export async function nudgeStudentAction(_: NudgeState, form: FormData): Promise<NudgeState> {
  const faculty = await currentFaculty();
  if (!faculty) return { error: "Please sign in again." };
  const classId = String(form.get("classId"));
  const studentId = String(form.get("studentId"));
  if (!(await sharesWith(faculty.id, classId, studentId))) return { error: "This student isn't sharing with this class anymore." };
  const out = await nudgeStudent(studentId, { kind: "instructor", from: faculty.displayName });
  revalidatePath(`/faculty/class/${classId}`);
  if (!out.sent) return { error: out.error ? `Twilio: ${out.error}` : out.reason };
  if (out.status === "dry_run") return { ok: "Logged (not configured yet)." };
  return { ok: out.channel === "push" ? "Notification sent." : "Texted." };
}

export type VideoState = { ok?: string; error?: string } | undefined;

/** Writes the script, records the narration, and opens the preview. Takes about half a minute. */
export async function makeVideoAction(_: VideoState, form: FormData): Promise<VideoState> {
  const faculty = await currentFaculty();
  if (!faculty) return { error: "Please sign in again." };
  const cls = await facultyClass(faculty.id, String(form.get("classId")));
  if (!cls) return { error: "That class isn't yours." };
  const topic = String(form.get("topic") ?? "").trim().slice(0, 80);
  const focus = String(form.get("focus") ?? "").trim().slice(0, 300) || null;
  if (!topic) return { error: "Pick a topic." };
  const made = await makeVideo(cls, topic, focus);
  redirect(`/faculty/class/${cls.id}/video/${made.id}`);
}

export async function shareVideoAction(_: VideoState, form: FormData): Promise<VideoState> {
  const faculty = await currentFaculty();
  if (!faculty) return { error: "Please sign in again." };
  const video = await facultyVideo(faculty.id, String(form.get("videoId")));
  if (!video) return { error: "That video isn't yours." };
  const r = await shareAndNotify(faculty.id, faculty.displayName, video);
  revalidatePath(`/faculty/class/${video.classId}`);
  revalidatePath(`/faculty/class/${video.classId}/video/${video.id}`);
  return {
    ok:
      r.needIt === undefined
        ? "Shared."
        : `Shared with the class. ${r.notified} of ${r.needIt} students who aren't ready on ${video.topicName} got a notification; the rest see it on their semester page.`,
  };
}

export async function deleteVideoAction(form: FormData) {
  const faculty = await currentFaculty();
  if (!faculty) redirect("/faculty");
  const classId = String(form.get("classId"));
  await deleteVideo(faculty.id, String(form.get("videoId")));
  redirect(`/faculty/class/${classId}`);
}
