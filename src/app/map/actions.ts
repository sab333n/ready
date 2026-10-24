"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentStudent } from "@/lib/auth/session";
import { addManualDeadline } from "@/lib/db/repo";

const ManualDeadline = z.object({
  courseId: z.uuid(),
  title: z.string().trim().min(2).max(200),
  kind: z.enum(["exam", "quiz", "assignment", "other"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal("")]),
});

export type AddState = { error?: string; ok?: boolean } | undefined;

export async function addDeadline(_: AddState, form: FormData): Promise<AddState> {
  const student = await currentStudent();
  if (!student) return { error: "Please sign in again." };
  const parsed = ManualDeadline.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Add a title, course and date." };
  await addManualDeadline(student, { ...parsed.data, time: parsed.data.time || null });
  revalidatePath("/map");
  return { ok: true };
}
