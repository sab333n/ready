// Glue between parsers and the database, shared by server actions and tests.
import { fetchIcs, normalizeFeedUrl, parseIcs } from "@/lib/calendar/ics";
import {
  contentHash,
  courseFromExtraction,
  extractionToDeadlines,
  getOrCreateCourse,
  importDeadlines,
  recordFeedSync,
  saveMaterial,
  saveTopics,
  type ImportCounts,
  type Student,
} from "@/lib/db/repo";
import { env } from "@/lib/env";
import { extractMaterial, type UploadedFile } from "@/lib/materials/extract";

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

export type UploadResult = ImportCounts & { filename: string; course: string | null; topics: number; usedLlm: boolean; notes: string | null };

export async function importMaterial(student: Pick<Student, "id" | "timezone">, file: UploadedFile, now = new Date()): Promise<UploadResult> {
  const { text, extraction, usedLlm } = await extractMaterial(file, now);
  const course = courseFromExtraction(extraction);
  const courseId = await getOrCreateCourse(student.id, course);
  const material = await saveMaterial(student.id, {
    filename: file.filename,
    mime: file.mime,
    kind: file.mime.startsWith("image/") ? "screenshot" : "syllabus",
    text,
    contentHash: contentHash(file.bytes),
    courseId,
  });
  const counts = await importDeadlines(student, extractionToDeadlines(extraction, student.timezone), "upload", material.id);
  const topics = await saveTopics(student.id, courseId, extraction.topics, material.id);
  return { ...counts, filename: file.filename, course: course?.displayCode ?? null, topics, usedLlm, notes: extraction.notes };
}
