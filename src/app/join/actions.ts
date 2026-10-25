"use server";

import { redirect } from "next/navigation";
import { currentStudent } from "@/lib/auth/session";
import { joinClass, stopSharing } from "@/lib/db/classes";

/** The student agreed on the join page. The consent text is rebuilt on the server, never taken from the form. */
export async function joinClassAction(form: FormData) {
  const student = await currentStudent();
  if (!student) redirect("/login");
  await joinClass(student.id, String(form.get("classId")));
  redirect("/map?shared=1");
}

export async function stopSharingAction(form: FormData) {
  const student = await currentStudent();
  if (!student) redirect("/login");
  await stopSharing(student.id, String(form.get("classId")));
  redirect("/map");
}
