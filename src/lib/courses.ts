// Course codes look like "PHARM 201", "NURS-210", "ACCT2101". We normalize them
// (PHARM201) so a calendar feed and a syllabus for the same course merge.
const CODE_RE = /\b([A-Z]{2,5})[\s-]?(\d{3,4}[A-Z]?)\b/;

export type CourseRef = { code: string; displayCode: string; name: string | null };

export function findCourseCode(text: string): { code: string; displayCode: string } | null {
  const m = text.match(CODE_RE);
  if (!m) return null;
  return { code: `${m[1]}${m[2]}`, displayCode: `${m[1]} ${m[2]}` };
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export const UNSORTED: CourseRef = { code: "OTHER", displayCode: "Other", name: "Not linked to a course" };

const COLORS = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#4b5563"];
export const colorForIndex = (i: number) => COLORS[i % COLORS.length];

export type DeadlineKind = "exam" | "quiz" | "assignment" | "other";

export function classifyDeadline(title: string): DeadlineKind | "skip" {
  const t = title.toLowerCase();
  if (/\b(lecture|class meeting|office hours?|lab section|recitation|no class|holiday|break)\b/.test(t)) return "skip";
  if (/\b(exam|midterm|final|test|hesi|ati)\b/.test(t)) return "exam";
  if (/\bquiz/.test(t)) return "quiz";
  if (/\b(assignment|homework|hw|due|paper|essay|project|lab|report|case study|care plan|discussion|problem set|pset|submit|submission|module|worksheet|video|cards?|drug cards?|reflection|presentation|check-?off)\b/.test(t))
    return "assignment";
  return "other";
}
