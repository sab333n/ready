"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { env, supabaseAuthEnabled } from "@/lib/env";
import { deleteStudent, registerStudent, studentAuthByEmail } from "@/lib/db/repo";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { currentStudent, endSession, startSession } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/auth/supabase";

export type SignInState = { error?: string } | undefined;

const emailSchema = z.email();
const passwordSchema = z.string().min(8, "Use at least 8 characters.");

function homeFor(done: Date | null) {
  return done ? "/learn" : "/onboarding";
}

export async function signInWithGoogle() {
  if (!supabaseAuthEnabled()) redirect("/login?error=" + encodeURIComponent("Google sign-in isn't configured yet."));
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${env.appUrl}/auth/callback` },
  });
  if (error || !data.url) {
    redirect("/login?error=" + encodeURIComponent(error?.message ?? "Google sign-in didn't start."));
  }
  redirect(data.url);
}

export async function signInWithPassword(_: SignInState, form: FormData): Promise<SignInState> {
  const email = emailSchema.safeParse(String(form.get("email") ?? "").trim());
  const password = String(form.get("password") ?? "");
  if (!email.success) return { error: "Enter a valid email address." };
  if (!password) return { error: "Enter your password." };

  const row = await studentAuthByEmail(email.data);
  if (!row?.passwordHash) return { error: "No password on that email yet. Create an account, or continue with Google." };
  if (!(await verifyPassword(password, row.passwordHash))) return { error: "That password doesn't match." };
  await startSession(row.id);
  redirect(homeFor(row.onboardingDoneAt));
}

export async function signUp(_: SignInState, form: FormData): Promise<SignInState> {
  const email = emailSchema.safeParse(String(form.get("email") ?? "").trim());
  const password = passwordSchema.safeParse(String(form.get("password") ?? ""));
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Enter your name." };
  if (!email.success) return { error: "Enter a valid email address." };
  if (!password.success) return { error: password.error.issues[0]?.message ?? "Use at least 8 characters." };

  const status = await registerStudent(email.data, await hashPassword(password.data), name);
  if (status === "exists") return { error: "That email already has a password. Sign in instead." };
  const row = await studentAuthByEmail(email.data);
  if (!row) return { error: "Couldn't create that account." };
  await startSession(row.id);
  redirect(homeFor(row.onboardingDoneAt));
}

export async function signOut() {
  if (supabaseAuthEnabled()) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  await endSession();
  redirect("/");
}

/** "Delete my data": removes the student and everything they own. */
export async function deleteMyData() {
  const student = await currentStudent();
  if (student) await deleteStudent(student.id);
  if (supabaseAuthEnabled()) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  await endSession();
  redirect("/?deleted=1");
}
