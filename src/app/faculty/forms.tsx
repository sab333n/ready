"use client";

import { useActionState } from "react";
import Link from "next/link";
import { buttonClass, inputClass } from "@/components/ui";
import {
  createClassAction,
  facultySignIn,
  facultySignUp,
  makeVideoAction,
  nudgeStudentAction,
  shareVideoAction,
  type FormState,
  type NudgeState,
  type VideoState,
} from "./actions";

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

export function NudgeButton({ classId, studentId }: { classId: string; studentId: string }) {
  const [state, action, pending] = useActionState<NudgeState, FormData>(nudgeStudentAction, undefined);
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="classId" value={classId} />
      <input type="hidden" name="studentId" value={studentId} />
      <button className="rounded-lg border border-black/15 px-2.5 py-1 text-xs font-medium hover:border-black/40 disabled:opacity-50" disabled={pending}>
        {pending ? "Texting…" : "Send a nudge"}
      </button>
      {state?.ok && <span className="text-xs text-[#16a34a]">{state.ok}</span>}
      {state?.error && <span className="text-xs text-[#dc2626]">{state.error}</span>}
    </form>
  );
}

export function MakeVideoForm({ classId, topics, suggested }: { classId: string; topics: string[]; suggested: string | null }) {
  const [state, action, pending] = useActionState<VideoState, FormData>(makeVideoAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="classId" value={classId} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-col gap-1 text-sm font-medium sm:w-64">
          Topic
          <select name="topic" defaultValue={suggested ?? topics[0]} className={inputClass}>
            {topics.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
          What should it focus on? (optional)
          <input name="focus" placeholder="e.g. why beta blockers slow the heart, not speed it up" className={inputClass} />
        </label>
      </div>
      <button className={`${buttonClass} self-start`} disabled={pending}>
        {pending ? "Writing the script and recording the voice… about 30 seconds" : "Make a video"}
      </button>
      {state?.error && <p className="text-sm text-[#dc2626]">{state.error}</p>}
    </form>
  );
}

export function ShareVideoButton({ videoId, shared }: { videoId: string; shared: boolean }) {
  const [state, action, pending] = useActionState<VideoState, FormData>(shareVideoAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="videoId" value={videoId} />
      <button className={`${buttonClass} self-start`} disabled={pending}>
        {pending ? "Sharing…" : shared ? "Share again and notify" : "Share with the class"}
      </button>
      {state?.ok && <p className="text-sm text-[#16a34a]">{state.ok}</p>}
      {state?.error && <p className="text-sm text-[#dc2626]">{state.error}</p>}
    </form>
  );
}
