"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { env, supabaseAuthEnabled } from "@/lib/env";
import { deleteStudent, upsertStudentByEmail } from "@/lib/db/repo";
import { currentStudent, endSession, startSession } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/auth/supabase";

export type SignInState = { error?: string; sent?: string } | undefined;

export async function signIn(_: SignInState, form: FormData): Promise<SignInState> {
  const email = z.email().safeParse(String(form.get("email") ?? "").trim());
  if (!email.success) return { error: "Enter a valid email address." };

  if (supabaseAuthEnabled()) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.data,
      options: { emailRedirectTo: `${env.appUrl}/auth/callback` },
    });
    if (error) return { error: error.message };
    return { sent: email.data };
  }

  // Dev sign-in: no Supabase configured, so we trust the email. Never in production.
  if (env.isProd) return { error: "Sign-in isn't configured. Set the Supabase environment variables." };
  const student = await upsertStudentByEmail(email.data);
  await startSession(student.id);
  redirect(student.onboardingDoneAt ? "/map" : "/onboarding");
}

export async function signOut() {
  await endSession();
  redirect("/");
}

/** "Delete my data": removes the student and everything they own. */
export async function deleteMyData() {
  const student = await currentStudent();
  if (student) await deleteStudent(student.id);
  await endSession();
  redirect("/?deleted=1");
}
