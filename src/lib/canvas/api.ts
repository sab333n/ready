import { classifyDeadline, findCourseCode, normalizeCode, type CourseRef } from "@/lib/courses";
import type { NewDeadline } from "@/lib/db/repo";
import { MAX_UPLOAD_BYTES } from "@/lib/materials/extract";

const PAST_MS = 60 * 864e5;
const FUTURE_MS = 240 * 864e5;

export type CanvasCourse = { id: number; name?: string; course_code?: string; syllabus_body?: string | null };
export type CanvasAssignment = { id: number; name?: string; due_at?: string | null; course_id?: number };
export type CanvasFile = {
  id: number;
  display_name?: string;
  filename?: string;
  "content-type"?: string;
  size?: number;
  url?: string;
  locked?: boolean;
  hidden?: boolean;
  hidden_for_user?: boolean;
  locked_for_user?: boolean;
};

const READING_NAME = /\b(syllabus|schedule|outline|lecture|slides?|notes|handout|reading|chapter)\b/i;
const READING_MIME = new Set([
  "application/pdf",
  "text/plain",
  "text/html",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
export const MAX_CANVAS_READINGS = 12;

/** School Canvas address, https only, no path. */
export function canvasOrigin(raw: string): URL {
  const text = raw.trim();
  const url = new URL(text.includes("://") ? text : `https://${text}`);
  if (url.protocol !== "https:") throw new Error("The Canvas address has to start with https.");
  if (!url.hostname.includes(".") || /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) {
    throw new Error("That doesn't look like a Canvas address.");
  }
  return new URL(`https://${url.hostname}`);
}

export function assignmentsToDeadlines(courses: CanvasCourse[], assignments: CanvasAssignment[], now = new Date()): NewDeadline[] {
  const byId = new Map(courses.filter((c) => c.id && c.name).map((c) => [c.id, courseRef(c)]));
  const from = now.getTime() - PAST_MS;
  const to = now.getTime() + FUTURE_MS;
  const out: NewDeadline[] = [];
  for (const item of assignments) {
    if (!item.id || !item.name || !item.due_at || !item.course_id) continue;
    const dueAt = new Date(item.due_at);
    if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() < from || dueAt.getTime() > to) continue;
    const course = byId.get(item.course_id);
    if (!course) continue;
    let kind = classifyDeadline(item.name);
    if (kind === "skip") continue;
    if (kind === "other") kind = "assignment";
    out.push({
      uid: `canvas-${item.course_id}-${item.id}`,
      title: item.name.trim(),
      kind,
      dueAt,
      allDay: false,
      course,
    });
  }
  return out.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

/** Syllabus HTML from Canvas, as plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Posted readings a student can study from: syllabus, slides, notes, handouts. */
export function readingFiles(files: CanvasFile[], limit = 6): CanvasFile[] {
  return files
    .filter((file) => {
      if (!file.id || file.locked || file.hidden || file.hidden_for_user || file.locked_for_user) return false;
      if ((file.size ?? 0) > MAX_UPLOAD_BYTES) return false;
      const mime = (file["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (!READING_MIME.has(mime)) return false;
      return READING_NAME.test(fileName(file));
    })
    .sort((a, b) => readingRank(b) - readingRank(a))
    .slice(0, limit);
}

function fileName(file: CanvasFile): string {
  return file.display_name || file.filename || "";
}

function readingRank(file: CanvasFile): number {
  const name = fileName(file);
  if (/\bsyllabus\b/i.test(name)) return 3;
  if (/\b(outline|schedule)\b/i.test(name)) return 2;
  return 1;
}

export function canvasCourseRef(course: CanvasCourse): CourseRef | null {
  if (!course.id || !course.name?.trim()) return null;
  return courseRef(course);
}

function courseRef(course: CanvasCourse): CourseRef {
  const label = course.course_code?.trim() || course.name!.trim();
  const found = findCourseCode(label.toUpperCase()) ?? findCourseCode(course.name!.toUpperCase());
  if (found) return { ...found, name: course.name!.trim() };
  return { code: (normalizeCode(label).slice(0, 16) || `C${course.id}`), displayCode: label.slice(0, 32), name: course.name!.trim() };
}

function nextLink(header: string | null, origin: string): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (!match) continue;
    const next = new URL(match[1]);
    if (next.origin === origin) return next.toString();
  }
  return null;
}

async function canvasPages<T>(origin: URL, token: string, path: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = new URL(path, origin).toString();
  for (let page = 0; url && page < 8; page++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (res.status === 401) throw new Error("Canvas rejected that token. Make a new one under Account → Settings → New Access Token.");
    if (!res.ok) throw new Error(`Canvas returned ${res.status}. Check the school address.`);
    const body = (await res.json()) as T[] | { errors?: { message?: string }[] };
    if (!Array.isArray(body)) throw new Error(body.errors?.[0]?.message ?? "Canvas didn't return a list.");
    out.push(...body);
    url = nextLink(res.headers.get("link"), origin.origin);
  }
  return out;
}

export type CanvasReading = { course: CanvasCourse; syllabusHtml: string | null; files: CanvasFile[] };

/** Courses the student is taking, their assignments, and the syllabus plus posted readings. */
export async function fetchCanvas(origin: URL, token: string) {
  const courses = await canvasPages<CanvasCourse>(origin, token, "/api/v1/courses?enrollment_state=active&include[]=syllabus_body&per_page=50");
  const assignments: CanvasAssignment[] = [];
  const readings: CanvasReading[] = [];
  for (const course of courses) {
    if (!course.id || !course.name) continue;
    const page = await canvasPages<CanvasAssignment>(origin, token, `/api/v1/courses/${course.id}/assignments?per_page=100&order_by=due_at`);
    assignments.push(...page);
    let files: CanvasFile[] = [];
    try {
      files = await canvasPages<CanvasFile>(origin, token, `/api/v1/courses/${course.id}/files?per_page=50`);
    } catch {
      files = [];
    }
    readings.push({ course, syllabusHtml: course.syllabus_body?.trim() || null, files: readingFiles(files) });
  }
  return { courses, assignments, readings };
}

/** Downloads one course file. The token stays on the school host; signed file links are fetched without it. */
export async function downloadCanvasFile(origin: URL, token: string, file: CanvasFile): Promise<{ bytes: Uint8Array; mime: string } | null> {
  let url = new URL(`/api/v1/files/${file.id}/download`, origin);
  let sendToken = true;
  for (let hop = 0; hop < 3; hop++) {
    if (!isPublicHttps(url)) return null;
    const headers: Record<string, string> = {};
    if (sendToken && url.origin === origin.origin) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers, redirect: "manual" });
    if (res.status === 401 || res.status === 403 || res.status === 404) return null;
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      url = new URL(loc, url);
      sendToken = false;
      continue;
    }
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return null;
    const listed = (file["content-type"] ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
    const mime = (res.headers.get("content-type") ?? listed).split(";")[0].trim().toLowerCase();
    return { bytes, mime: mime === "application/octet-stream" ? listed : mime };
  }
  return null;
}

function isPublicHttps(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const host = url.hostname;
  if (!host.includes(".")) return false;
  return !/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host);
}
