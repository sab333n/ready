"use server";

import { currentStudent } from "@/lib/auth/session";
import { canvasLink } from "@/lib/db/repo";
import { importCalendarText, importCalendarUrl, importCanvas, importMaterial, type UploadResult } from "@/lib/importers";
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from "@/lib/materials/extract";

export type CalendarState = { ok?: string; error?: string } | undefined;
export type UploadState = { results?: UploadResult[]; errors?: string[] } | undefined;

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

export async function connectCalendar(_: CalendarState, form: FormData): Promise<CalendarState> {
  const student = await currentStudent();
  if (!student) return { error: "Please sign in again." };
  const url = String(form.get("url") ?? "").trim();
  const file = form.get("file");
  try {
    let result;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_UPLOAD_BYTES) return { error: "That file is too large." };
      result = await importCalendarText(student, await file.text());
    } else if (url) {
      result = await importCalendarUrl(student, url);
    } else {
      return { error: "Paste your calendar link or choose an .ics file." };
    }
    const total = result.added + result.updated;
    if (total === 0) return { error: "We read the calendar but found no upcoming assignments, quizzes or exams." };
    return { ok: `Imported ${total} deadline${total === 1 ? "" : "s"} across ${result.courses} course${result.courses === 1 ? "" : "s"}.` };
  } catch (err) {
    return { error: message(err) };
  }
}

export async function connectCanvas(_: CalendarState, form: FormData): Promise<CalendarState> {
  const student = await currentStudent();
  if (!student) return { error: "Please sign in again." };
  const saved = await canvasLink(student.id);
  const base = String(form.get("base") ?? "").trim() || saved?.baseUrl || "";
  const token = String(form.get("token") ?? "").trim() || saved?.token || "";
  if (!base) return { error: "Enter your school's Canvas address." };
  if (!token) return { error: "Paste an access token from Canvas → Account → Settings." };
  try {
    const result = await importCanvas(student, base, token);
    const deadlines = result.added + result.updated;
    const files = result.files;
    if (deadlines === 0 && files === 0) return { ok: "Connected. Nothing new to import. If a syllabus is only a scan, upload it below." };
    const parts = [
      deadlines ? `${deadlines} deadline${deadlines === 1 ? "" : "s"}` : "",
      files ? `${files} course file${files === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    return { ok: `Connected. Imported ${parts.join(" and ")} from ${result.courses} course${result.courses === 1 ? "" : "s"}.` };
  } catch (err) {
    return { error: message(err) };
  }
}

export async function uploadMaterials(_: UploadState, form: FormData): Promise<UploadState> {
  const student = await currentStudent();
  if (!student) return { errors: ["Please sign in again."] };
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { errors: ["Choose at least one file."] };

  const results: UploadResult[] = [];
  const errors: string[] = [];
  for (const file of files.slice(0, 10)) {
    const mime = file.type || (file.name.toLowerCase().endsWith(".pptx") ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : file.name.toLowerCase().endsWith(".docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "");
    if (!ACCEPTED_TYPES.includes(mime)) {
      errors.push(`${file.name}: upload a PDF, PowerPoint, Word file, or an image (PNG, JPG).`);
      continue;
    }
    try {
      results.push(await importMaterial(student, { filename: file.name, mime, bytes: new Uint8Array(await file.arrayBuffer()) }));
    } catch (err) {
      errors.push(`${file.name}: ${message(err)}`);
    }
  }
  return { results, errors };
}
