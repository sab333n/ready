// Offline fallback when no LLM is configured: regex-based reading of a syllabus.
// It is deliberately conservative: it only reports lines that clearly contain a
// date AND a deadline word, and topics from "Week N: ..." style schedule lines.
import { classifyDeadline, findCourseCode } from "@/lib/courses";
import type { MaterialExtraction } from "./schema";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i;
const NUMERIC_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
const TOPIC_RE = /^\s*(?:week|wk|module|unit|topic|chapter|ch\.?)\s*\d+\s*[:.\-–—)]\s*(.+)$/i;
const DEADLINE_WORD = /\b(exam|midterm|final|quiz|test|assignment|homework|hw|due|paper|essay|project|lab|report|case study|care plan|presentation)\b/i;

export function heuristicExtract(text: string, now = new Date()): MaterialExtraction {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

  const head = lines.slice(0, 20).join("\n");
  const code = findCourseCode(head.toUpperCase());
  let name: string | null = null;
  if (code) {
    const line = lines.slice(0, 20).find((l) => findCourseCode(l.toUpperCase())?.code === code.code);
    name = line?.replace(/^.*?\b[A-Z]{2,5}[\s-]?\d{3,4}[A-Z]?\b\s*[:\-–—]?\s*/i, "").replace(/\bsyllabus\b/i, "").trim() || null;
  }

  const deadlines: MaterialExtraction["deadlines"] = [];
  const topics: MaterialExtraction["topics"] = [];
  const seenTopics = new Set<string>();

  for (const line of lines) {
    const topic = line.match(TOPIC_RE);
    if (topic) {
      const topicName = cleanTitle(stripDates(topic[1]).split(/[;(]| - | – /)[0]);
      if (topicName && !DEADLINE_WORD.test(topicName) && !seenTopics.has(topicName.toLowerCase())) {
        seenTopics.add(topicName.toLowerCase());
        topics.push({ name: topicName, prerequisites: [] });
      }
    }

    if (!DEADLINE_WORD.test(line)) continue;
    const date = findDate(line, now);
    if (!date) continue;
    const title = cleanTitle(stripDates(line.replace(TIME_RE, "")).replace(/^(due|deadline)\s*[:\-–]?\s*/i, ""));
    const kind = classifyDeadline(title);
    if (!title || kind === "skip") continue;
    deadlines.push({ title, kind, date, time: findTime(line) });
  }

  return {
    course: { code: code?.displayCode ?? null, name },
    deadlines,
    topics,
    notes: "Read without AI (offline parser). Check dates against your syllabus.",
  };
}

function findDate(line: string, now: Date): string | null {
  let month: number, day: number, year: number | undefined;
  const m = line.match(MONTH_RE);
  if (m) {
    month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    day = Number(m[2]);
    year = m[3] ? Number(m[3]) : undefined;
  } else {
    const n = line.match(NUMERIC_RE);
    if (!n) return null;
    month = Number(n[1]);
    day = Number(n[2]);
    year = n[3] ? Number(n[3].length === 2 ? `20${n[3]}` : n[3]) : undefined;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  year ??= inferYear(month, now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A date with no year belongs to the current academic term: up to ~4 months back, else next year. */
export function inferYear(month: number, now: Date): number {
  const y = now.getFullYear();
  const monthsBack = now.getMonth() + 1 - month;
  return monthsBack > 4 ? y + 1 : monthsBack < -8 ? y - 1 : y;
}

function findTime(line: string): string | null {
  const t = line.match(TIME_RE);
  if (!t) return null;
  let h = Number(t[1]) % 12;
  if (t[3].toLowerCase() === "pm") h += 12;
  return `${String(h).padStart(2, "0")}:${t[2] ?? "00"}`;
}

function stripDates(s: string) {
  return s
    .replace(new RegExp(MONTH_RE.source, "gi"), "")
    .replace(new RegExp(NUMERIC_RE.source, "g"), "")
    .replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?/gi, "");
}

function cleanTitle(s: string) {
  return s.replace(/\s+/g, " ").replace(/^[\s:,\-–—|•*]+|[\s:,\-–—|•*(]+$/g, "").replace(/\s+(is\s+)?(due|by)\s*$/i, "").trim();
}
