"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { currentFaculty, endFacultySession, startFacultySession } from "@/lib/auth/faculty";
import { createClass, createFaculty, facultyAuthByEmail } from "@/lib/db/classes";
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
