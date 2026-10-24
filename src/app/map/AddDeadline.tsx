"use client";

import { useActionState } from "react";
import { buttonClass, inputClass } from "@/components/ui";
import { addDeadline, type AddState } from "./actions";

export function AddDeadline({ courses }: { courses: { id: string; displayCode: string }[] }) {
  const [state, action, pending] = useActionState<AddState, FormData>(addDeadline, undefined);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted">Add a deadline by hand</summary>
      <form action={action} className="mt-3 grid grid-cols-2 gap-2">
        <input name="title" placeholder="e.g. Med math quiz" className={`${inputClass} col-span-2`} required aria-label="Title" />
        <select name="courseId" className={inputClass} aria-label="Course" required>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayCode}
            </option>
          ))}
        </select>
        <select name="kind" className={inputClass} aria-label="Type" defaultValue="assignment">
          <option value="assignment">Assignment</option>
          <option value="quiz">Quiz</option>
          <option value="exam">Exam</option>
          <option value="other">Other</option>
        </select>
        <input name="date" type="date" className={inputClass} required aria-label="Date" />
        <input name="time" type="time" className={inputClass} aria-label="Time (optional)" />
        <button className={`${buttonClass} col-span-2`} disabled={pending}>
          Add
        </button>
        {state?.error && <p className="col-span-2 text-[var(--red)]">{state.error}</p>}
      </form>
    </details>
  );
}
