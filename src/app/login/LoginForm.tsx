"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInWithGoogle, signInWithPassword, signUp, type SignInState } from "../auth/actions";
import { buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";

export function LoginForm({ mode, error }: { mode: "signin" | "signup"; error?: string }) {
  const action = mode === "signup" ? signUp : signInWithPassword;
  const [state, formAction, pending] = useActionState<SignInState, FormData>(action, undefined);
  const message = state?.error ?? error;

  return (
    <div className="space-y-4">
      <form action={signInWithGoogle}>
        <button className={`${secondaryButtonClass} w-full gap-2 bg-white text-[#111]`}>
          <GoogleMark />
          Continue with Google
        </button>
      </form>
      <p className="text-center text-xs tracking-wide text-muted uppercase">or</p>
      <form action={formAction} className="flex flex-col gap-3">
        {mode === "signup" && (
          <>
            <label htmlFor="name" className="text-sm font-medium">
              Name
            </label>
            <input id="name" name="name" autoComplete="name" required placeholder="Your name" className={inputClass} />
          </>
        )}
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required placeholder="you@school.edu" className={inputClass} />
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
          minLength={mode === "signup" ? 8 : undefined}
          placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
          className={inputClass}
        />
        {message && <p className="text-sm text-[var(--red)]">{message}</p>}
        <button className={`${buttonClass} w-full`} disabled={pending}>
          {pending ? "One sec…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>
      <p className="text-center text-sm text-muted">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-foreground underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/login?mode=signup" className="text-foreground underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
