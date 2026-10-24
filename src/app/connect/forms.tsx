"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { buttonClass, inputClass } from "@/components/ui";
import { connectCalendar, uploadMaterials, type CalendarState, type UploadState } from "./actions";

export function CalendarForm() {
  const [state, action, pending] = useActionState<CalendarState, FormData>(connectCalendar, undefined);
  useRefreshOn(state);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input name="url" type="url" inputMode="url" placeholder="https://… or webcal://…/calendar.ics" className={inputClass} aria-label="Calendar feed link" />
      <details className="text-sm text-muted">
        <summary className="cursor-pointer">Or upload an .ics file</summary>
        <input name="file" type="file" accept=".ics,text/calendar" className="mt-2 text-sm" />
      </details>
      <button className={buttonClass} disabled={pending}>
        {pending ? "Importing…" : "Import calendar"}
      </button>
      {state?.ok && <p className="text-sm text-[var(--green)]">{state.ok}</p>}
      {state?.error && <p className="text-sm text-[var(--red)]">{state.error}</p>}
    </form>
  );
}

export function UploadForm() {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadMaterials, undefined);
  useRefreshOn(state);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input name="files" type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" className="text-sm" aria-label="Files" />
      <button className={buttonClass} disabled={pending}>
        {pending ? "Reading your files…" : "Upload"}
      </button>
      {state?.results?.map((r) => (
        <p key={r.filename} className="text-sm">
          <span className="font-medium">{r.filename}</span>
          {r.course ? ` (${r.course})` : ""}: {plural(r.added + r.updated, "deadline")}, {plural(r.topics, "topic")}
          {r.duplicates > 0 ? `, ${r.duplicates} already on your calendar` : ""}.
          {r.notes && <span className="block text-muted">{r.notes}</span>}
        </p>
      ))}
      {state?.errors?.map((e) => (
        <p key={e} className="text-sm text-[var(--red)]">
          {e}
        </p>
      ))}
    </form>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Re-render the server parts of the page (progress counts) after an import. */
function useRefreshOn(state: unknown) {
  const router = useRouter();
  useEffect(() => {
    if (state) router.refresh();
  }, [state, router]);
}
