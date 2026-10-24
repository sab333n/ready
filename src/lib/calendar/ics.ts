import ICAL from "ical.js";
import { classifyDeadline, findCourseCode, type CourseRef, type DeadlineKind } from "@/lib/courses";
import { zonedDate } from "@/lib/time";

export type ParsedDeadline = {
  uid: string;
  title: string;
  kind: DeadlineKind;
  dueAt: Date;
  allDay: boolean;
  course: CourseRef | null;
};

// Only keep events in a sensible window so an old, long-lived feed doesn't flood the map.
const WINDOW_PAST_DAYS = 60;
const WINDOW_FUTURE_DAYS = 240;

/** Parses an iCal feed from Canvas, Moodle, Blackboard (or anything RFC 5545). */
export function parseIcs(text: string, now = new Date(), tz = "America/New_York"): ParsedDeadline[] {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);

  const from = now.getTime() - WINDOW_PAST_DAYS * 864e5;
  const to = now.getTime() + WINDOW_FUTURE_DAYS * 864e5;
  const out: ParsedDeadline[] = [];

  for (const vevent of root.getAllSubcomponents("vevent")) {
    const event = new ICAL.Event(vevent);
    const raw = (event.summary ?? "").trim();
    if (!raw || !event.startDate) continue;

    // Due time: Canvas puts the due time in DTSTART (DTEND == DTSTART); a timed
    // event with a real duration is treated as "due at the end".
    const allDay = event.startDate.isDate;
    const dueAt = allDay ? endOfDay(event.startDate, tz) : event.startDate.toJSDate();
    if (dueAt.getTime() < from || dueAt.getTime() > to) continue;

    const categories = vevent.getAllProperties("categories").flatMap((p) => p.getValues().map(String));
    const { title, course } = splitCourse(raw, categories);
    let kind = classifyDeadline(title);
    if (kind === "skip") continue;
    // Canvas marks gradable items in the UID ("assignment-123"); trust that over keywords.
    if (kind === "other" && /(^|-)assignment-/.test(event.uid ?? "")) kind = "assignment";

    out.push({ uid: event.uid || `${raw}@${dueAt.toISOString()}`, title, kind, dueAt, allDay, course });
  }
  return out.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

function endOfDay(t: ICAL.Time, tz: string): Date {
  // All-day items have no time zone; 23:59 in the student's zone is a fair "due by".
  const date = `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
  return zonedDate(date, null, tz);
}

/** Pulls the course out of the summary ("Exam 2 [PHARM 201 - Pharmacology]") or CATEGORIES (Moodle). */
export function splitCourse(summary: string, categories: string[] = []): { title: string; course: CourseRef | null } {
  const bracket = summary.match(/\s*\[([^\]]+)\]\s*$/);
  if (bracket) {
    const inside = bracket[1];
    const code = findCourseCode(inside.toUpperCase());
    const title = summary.slice(0, bracket.index).trim();
    if (code) {
      const name = inside.split(/\s+[-–:]\s+/).slice(1).join(" - ").trim() || null;
      return { title, course: { ...code, name } };
    }
    return { title, course: { code: inside.toUpperCase().replace(/[^A-Z0-9]/g, ""), displayCode: inside, name: inside } };
  }
  for (const cat of categories) {
    const code = findCourseCode(cat.toUpperCase());
    if (code) return { title: summary, course: { ...code, name: null } };
  }
  const prefix = summary.match(/^([A-Za-z]{2,5}[\s-]?\d{3,4}[A-Za-z]?)\s*[:\-–]\s*(.+)$/);
  if (prefix) {
    const code = findCourseCode(prefix[1].toUpperCase());
    if (code) return { title: prefix[2].trim(), course: { ...code, name: null } };
  }
  return { title: summary, course: null };
}

/** Course platforms hand out webcal:// links; we fetch them over https. */
export function normalizeFeedUrl(input: string, allowLocal = false): URL {
  const url = new URL(input.trim().replace(/^webcals?:\/\//i, "https://"));
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url.hostname);
  if (local && allowLocal) return url;
  if (url.protocol !== "https:") throw new Error("Calendar links must start with https:// or webcal://");
  if (local || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(url.hostname)) {
    throw new Error("That link points to a private address.");
  }
  return url;
}

export async function fetchIcs(url: URL): Promise<string> {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!res.ok) throw new Error(`The calendar link returned ${res.status}. Check that you copied the full feed URL.`);
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("That link didn't return a calendar feed (.ics).");
  if (text.length > 5_000_000) throw new Error("That calendar feed is too large.");
  return text;
}
