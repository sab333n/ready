"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "./auth/actions";
import { buttonClass, inputClass } from "@/components/ui";

export function SignInForm({ magicLink }: { magicLink: boolean }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, undefined);
  if (state?.sent) {
    return <p className="text-sm">Check {state.sent} for a sign-in link. You can close this tab.</p>;
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="email" className="text-sm font-medium">
        School email
      </label>
      <input id="email" name="email" type="email" autoComplete="email" required placeholder="you@school.edu" className={inputClass} />
      {state?.error && <p className="text-sm text-[var(--red)]">{state.error}</p>}
      <button className={buttonClass} disabled={pending}>
        {pending ? "One sec…" : magicLink ? "Email me a sign-in link" : "Continue"}
      </button>
      {!magicLink && <p className="text-xs text-muted">Dev mode: no email is sent. Configure Supabase for magic links.</p>}
    </form>
  );
}
