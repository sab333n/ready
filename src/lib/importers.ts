// Glue between parsers and the database, shared by server actions and tests.
import { fetchIcs, normalizeFeedUrl, parseIcs } from "@/lib/calendar/ics";
import { assignmentsToDeadlines, canvasCourseRef, canvasOrigin, downloadCanvasFile, fetchCanvas, htmlToText, MAX_CANVAS_READINGS } from "@/lib/canvas/api";
import type { CourseRef } from "@/lib/courses";
import {
  contentHash,
  courseFromExtraction,
  extractionToDeadlines,
  getOrCreateCourse,
  importDeadlines,
  recordFeedSync,
  saveCanvasLink,
  saveMaterial,
  saveTopics,
  type ImportCounts,
  type Student,
} from "@/lib/db/repo";
import { env } from "@/lib/env";
import { extractMaterial, extractPlainText, type UploadedFile } from "@/lib/materials/extract";
import { officeKind, officeToText } from "@/lib/materials/office";
import type { MaterialExtraction } from "@/lib/materials/schema";
import { chunkText, looksLikeSyllabus } from "@/lib/materials/chunks";
import { courseTopics, materialsWithoutChunks, saveChunks } from "@/lib/db/lessons";

export async function importCalendarText(student: Pick<Student, "id" | "timezone">, ics: string, now = new Date()) {
  const items = parseIcs(ics, now, student.timezone);
  const counts = await importDeadlines(student, items, "ics");
  return { ...counts, courses: new Set(items.map((i) => i.course?.code ?? "OTHER")).size };
}

export async function importCalendarUrl(student: Pick<Student, "id" | "timezone">, rawUrl: string) {
  const url = normalizeFeedUrl(rawUrl, !env.isProd);
  try {
    const result = await importCalendarText(student, await fetchIcs(url));
    await recordFeedSync(student.id, url.toString(), null);
    return result;
  } catch (err) {
    await recordFeedSync(student.id, url.toString(), err instanceof Error ? err.message : "Import failed");
    throw err;
  }
}

export async function importCanvas(student: Pick<Student, "id" | "timezone">, rawBase: string, token: string, now = new Date()) {
  const origin = canvasOrigin(rawBase);
  const { courses, assignments, readings } = await fetchCanvas(origin, token);
  const items = assignmentsToDeadlines(courses, assignments, now);
  const counts = await importDeadlines(student, items, "canvas");
  await saveCanvasLink(student.id, origin.origin, token);
  let files = 0;
  const seen = new Set<string>();
  for (const reading of readings) {
    if (files >= MAX_CANVAS_READINGS) break;
    const course = canvasCourseRef(reading.course);
    if (!course) continue;
    const syllabus = htmlToText(reading.syllabusHtml ?? "");
    if (await saveCanvasText(student, `Syllabus — ${course.displayCode}.html`, syllabus, course, now, seen, "syllabus")) files++;
    for (const file of reading.files) {
      if (files >= MAX_CANVAS_READINGS) break;
      try {
        const downloaded = await downloadCanvasFile(origin, token, file);
        if (!downloaded) continue;
        const name = file.display_name || file.filename || "Canvas file";
        const office = officeKind(name, downloaded.mime);
        const saved = downloaded.mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")
          ? await saveCanvasPdf(student, name, downloaded.bytes, course, now, seen)
          : office
            ? await saveCanvasText(student, name, await officeToText(downloaded.bytes, office), course, now, seen, office === "pptx" ? "slides" : undefined)
            : await saveCanvasText(student, name, canvasFileText(downloaded), course, now, seen, /\bslides?\b/i.test(name) ? "slides" : undefined);
        if (saved) files++;
      } catch (err) {
        console.error("Canvas file skipped", nameOf(file), err);
      }
    }
  }
  return { ...counts, courses: new Set(items.map((i) => i.course?.code ?? "OTHER")).size, files };
}

function nameOf(file: { display_name?: string; filename?: string }) {
  return file.display_name || file.filename || "Canvas file";
}

function canvasFileText(file: { bytes: Uint8Array; mime: string }) {
  const raw = new TextDecoder().decode(file.bytes);
  return file.mime.includes("html") ? htmlToText(raw) : raw;
}

async function saveCanvasText(
  student: Pick<Student, "id" | "timezone">,
  filename: string,
  text: string,
  course: CourseRef,
  now: Date,
  seen: Set<string>,
  kind?: "syllabus" | "slides",
) {
  if (text.trim().length < 40) return false;
  const hash = contentHash(new TextEncoder().encode(text));
  if (seen.has(hash)) return false;
  seen.add(hash);
  const read = await extractPlainText(filename, text, now);
  const stored = await persistMaterial(student, { filename, mime: "text/html", hash, ...read }, course, kind);
  return stored.isNew;
}

async function saveCanvasPdf(
  student: Pick<Student, "id" | "timezone">,
  filename: string,
  bytes: Uint8Array,
  course: CourseRef,
  now: Date,
  seen: Set<string>,
) {
  const hash = contentHash(bytes);
  if (seen.has(hash)) return false;
  seen.add(hash);
  const stored = await importMaterial(student, { filename, mime: "application/pdf", bytes }, now, course);
  return stored.isNew;
}

export type UploadResult = ImportCounts & { kind: string; filename: string; course: string | null; topics: number; usedLlm: boolean; notes: string | null; isNew: boolean };

export async function importMaterial(
  student: Pick<Student, "id" | "timezone">,
  file: UploadedFile,
  now = new Date(),
  pinnedCourse: CourseRef | null = null,
): Promise<UploadResult> {
  // Hash first: the PDF reader takes ownership of (detaches) the byte buffer.
  const hash = contentHash(file.bytes);
  const read = await extractMaterial(file, now);
  const kind = /\bslides?\b/i.test(file.filename) ? "slides" : undefined;
  return persistMaterial(student, { filename: file.filename, mime: file.mime, hash, ...read }, pinnedCourse, kind);
}

async function persistMaterial(
  student: Pick<Student, "id" | "timezone">,
  material: { filename: string; mime: string; hash: string; text: string; extraction: MaterialExtraction; usedLlm: boolean },
  pinnedCourse: CourseRef | null,
  kindHint?: "syllabus" | "slides",
): Promise<UploadResult> {
  const extraction = pinnedCourse
    ? { ...material.extraction, course: { code: pinnedCourse.displayCode, name: pinnedCourse.name } }
    : material.extraction;
  const course = courseFromExtraction(extraction);
  const courseId = await getOrCreateCourse(student.id, course);
  const syllabus = kindHint === "syllabus" || looksLikeSyllabus(extraction.deadlines.length, material.text);
  const kind = material.mime.startsWith("image/") ? "screenshot" : kindHint === "slides" ? "slides" : syllabus ? "syllabus" : "notes";
  const saved = await saveMaterial(student.id, {
    filename: material.filename,
    mime: material.mime,
    kind,
    text: material.text,
    contentHash: material.hash,
    courseId,
  });
  await saveChunks(student.id, saved.id, chunkText(material.text));
  const counts = await importDeadlines(student, extractionToDeadlines(extraction, student.timezone), "upload", saved.id);
  // Topics are course units: take them from schedules, or from notes when the course has none yet,
  // so a lecture handout doesn't flood the topic list with sub-points.
  const existing = await courseTopics(student.id, courseId);
  const topics = syllabus || existing.length < 3 ? await saveTopics(student.id, courseId, extraction.topics, saved.id) : 0;
  return { ...counts, kind, filename: material.filename, course: course?.displayCode ?? null, topics, usedLlm: material.usedLlm, notes: extraction.notes, isNew: saved.isNew };
}

/** Materials uploaded before passages existed (Phase 1) get chunked on first use. */
export async function ensureChunks(studentId: string) {
  for (const m of await materialsWithoutChunks(studentId)) await saveChunks(studentId, m.id, chunkText(m.extractedText));
}
