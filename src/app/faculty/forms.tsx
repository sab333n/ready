"use client";

import { useActionState } from "react";
import Link from "next/link";
import { buttonClass, inputClass } from "@/components/ui";
import { createClassAction, facultySignIn, facultySignUp, type FormState } from "./actions";

export function FacultyAuthForm({ mode }: { mode: "signin" | "signup" }) {
  const [state, action, pending] = useActionState<FormState, FormData>(mode === "signup" ? facultySignUp : facultySignIn, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      {mode === "signup" && (
        <>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Name students know you by
            <input name="name" required placeholder="Dr. Rivera" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            School
            <input name="school" placeholder="Louisiana State University" className={inputClass} />
          </label>
        </>
      )}
      <label className="flex flex-col gap-1 text-sm font-medium">
        Email
        <input name="email" type="email" required autoComplete="email" placeholder="you@school.edu" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Password
        <input
          name="password"
          type="password"
          required
          minLength={mode === "signup" ? 8 : undefined}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
          className={inputClass}
        />
      </label>
      {state?.error && <p className="text-sm text-[var(--red)]">{state.error}</p>}
      <button className={`${buttonClass} w-full`} disabled={pending}>
        {pending ? "One sec…" : mode === "signup" ? "Create instructor account" : "Sign in"}
      </button>
      <p className="text-center text-sm text-muted">
        {mode === "signup" ? (
          <>
            Have an account? <Link href="/faculty" className="text-foreground underline">Sign in</Link>
          </>
        ) : (
          <>
            New instructor? <Link href="/faculty?mode=signup" className="text-foreground underline">Create an account</Link>
          </>
        )}
      </p>
    </form>
  );
}

export function CreateClassForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createClassAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
        Class name
        <input name="name" required placeholder="Pharmacology, Fall 2026" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium sm:w-40">
        Course code
        <input name="code" required placeholder="PHARM 201" className={inputClass} />
      </label>
      <button className={buttonClass} disabled={pending}>
        {pending ? "Creating…" : "Create class"}
      </button>
      {state?.error && <p className="text-sm text-[var(--red)] sm:basis-full">{state.error}</p>}
    </form>
  );
}
