// What an instructor sees for one class, computed from the evidence of the
// students who chose to share. Pure: the database layer hands in rows, this
// decides readiness, who is at risk and why, and which topics the class is
// confidently wrong about.
import { deadlineReadiness, deadlineTopics, LEVEL_ORDER, topicReadiness, type DeadlineReadiness, type Evidence, type Level, type TopicReadiness } from "@/lib/readiness";

export type MemberTopic = { id: string; courseId: string; name: string; position: number; prerequisites: string[] };
export type MemberDeadline = { id: string; courseId: string | null; title: string; kind: "exam" | "quiz" | "assignment" | "other"; dueAt: Date };

export type MemberData = {
  studentId: string;
  name: string;
  lastActive: Date | null;
  topics: MemberTopic[];
  deadlines: MemberDeadline[];
  evidence: Evidence[];
  /** Agreed to texts, and when Ready last nudged them. */
  textsOn?: boolean;
  lastTexted?: Date | null;
};

export type ClassTopic = {
  key: string;
  name: string;
  /** Students who have this topic in their course map. */
  students: number;
  measured: number;
  average: number | null;
  notReady: number;
  /** Students whose latest evidence on this topic was "sure, but wrong". */
  confidentWrong: number;
};

export type MemberRow = {
  studentId: string;
  name: string;
  lastActive: Date | null;
  cells: Record<string, TopicReadiness>;
  exam: DeadlineReadiness | null;
};

export type AtRisk = {
  studentId: string;
  name: string;
  severity: number;
  reasons: string[];
  teachNext: string | null;
  textsOn: boolean;
  lastTexted: Date | null;
};

export type ClassExam = { title: string; kind: "exam" | "quiz"; dueAt: Date; counts: Record<Level, number> };

export type ClassReport = { topics: ClassTopic[]; rows: MemberRow[]; exam: ClassExam | null; atRisk: AtRisk[] };

const DAY = 864e5;
export const topicKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
const titleKey = (title: string) => title.trim().toLowerCase().replace(/\s+/g, " ");

export function classReport(members: MemberData[], now = new Date()): ClassReport {
  const exam = nextClassExam(members, now);

  // Columns: every topic any sharing student has, in syllabus order.
  const columns = new Map<string, { name: string; positions: number[] }>();
  for (const m of members) {
    for (const t of m.topics) {
      const key = topicKey(t.name);
      const col = columns.get(key) ?? { name: t.name, positions: [] };
      col.positions.push(t.position);
      columns.set(key, col);
    }
  }
  const order = [...columns.entries()].sort(([, a], [, b]) => avg(a.positions)! - avg(b.positions)!);

  const rows: MemberRow[] = members.map((m) => {
    const cells: Record<string, TopicReadiness> = {};
    for (const t of m.topics) cells[topicKey(t.name)] = topicReadiness(t.id, m.evidence, now);
    let examReadiness: DeadlineReadiness | null = null;
    if (exam) {
      const mine = m.deadlines.find((d) => titleKey(d.title) === titleKey(exam.title) && d.dueAt >= now);
      const byTopic = new Map(m.topics.map((t) => [t.id, cells[topicKey(t.name)]]));
      if (mine) examReadiness = deadlineReadiness(deadlineTopics(mine, m.topics), byTopic);
    }
    return { studentId: m.studentId, name: m.name, lastActive: m.lastActive, cells, exam: examReadiness };
  });

  const topics: ClassTopic[] = order.map(([key, col]) => {
    const cells = rows.map((r) => r.cells[key]).filter(Boolean);
    const scored = cells.filter((c) => c.score !== null).map((c) => c.score!);
    const wrong = members.filter((m) => {
      const t = m.topics.find((x) => topicKey(x.name) === key);
      return t && latest(m.evidence, t.id)?.confidentWrong;
    }).length;
    return {
      key,
      name: col.name,
      students: cells.length,
      measured: scored.length,
      average: avg(scored),
      notReady: cells.filter((c) => c.level === "not_ready").length,
      confidentWrong: wrong,
    };
  });

  if (exam) for (const r of rows) exam.counts[r.exam?.level ?? "unmeasured"]++;

  const nameOf = (key: string) => columns.get(key)?.name ?? key;
  const atRisk = members
    .map((m, i) => riskFor(m, rows[i], exam, now, nameOf))
    .filter((r): r is AtRisk => r !== null)
    .sort((a, b) => b.severity - a.severity || a.name.localeCompare(b.name));

  return { topics, rows, exam, atRisk };
}

/** The soonest exam or quiz in the next 30 days that most sharing students have on their calendar. */
function nextClassExam(members: MemberData[], now: Date): ClassExam | null {
  const seen = new Map<string, { title: string; kind: "exam" | "quiz"; dueAt: Date; students: number }>();
  for (const m of members) {
    for (const d of m.deadlines) {
      if ((d.kind !== "exam" && d.kind !== "quiz") || d.dueAt < now || d.dueAt.getTime() - now.getTime() > 30 * DAY) continue;
      const key = titleKey(d.title);
      const entry = seen.get(key) ?? { title: d.title, kind: d.kind, dueAt: d.dueAt, students: 0 };
      entry.students++;
      seen.set(key, entry);
    }
  }
  const quorum = Math.max(1, Math.ceil(members.length / 3));
  const pick = [...seen.values()].filter((e) => e.students >= quorum).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0];
  return pick ? { title: pick.title, kind: pick.kind, dueAt: pick.dueAt, counts: { not_ready: 0, unmeasured: 0, getting_there: 0, ready: 0 } } : null;
}

function riskFor(m: MemberData, row: MemberRow, exam: ClassExam | null, now: Date, nameOf: (key: string) => string): AtRisk | null {
  const reasons: string[] = [];
  let severity = 0;
  const days = exam ? Math.ceil((exam.dueAt.getTime() - now.getTime()) / DAY) : null;
  const idle = m.lastActive ? Math.floor((now.getTime() - m.lastActive.getTime()) / DAY) : null;
  const topicName = (r: TopicReadiness | null | undefined) => {
    const t = r && m.topics.find((x) => x.id === r.topicId);
    return t ? nameOf(topicKey(t.name)) : null;
  };

  if (exam && row.exam) {
    const weakest = topicName(row.exam.next);
    if (row.exam.level === "not_ready") {
      severity += 3;
      reasons.push(`Not ready for ${exam.title}${weakest ? `: ${weakest} at ${row.exam.next?.score}` : ""}`);
    } else if (row.exam.level === "unmeasured" && days !== null && days <= 7) {
      severity += 2;
      reasons.push(`Hasn't shown ${weakest ?? "the exam topics"} yet, ${days <= 1 ? "exam is tomorrow" : `exam in ${days} days`}`);
    }
    const wrong = row.exam.topics.filter((t) => latest(m.evidence, t.topicId)?.confidentWrong).map(topicName).filter(Boolean);
    if (wrong.length) {
      severity += 1;
      reasons.push(`Sure about something wrong in ${wrong.join(", ")}`);
    }
  }
  // Weak foundations predict trouble even before the exam topics are measured.
  if (row.exam?.level !== "not_ready") {
    const weak = Object.entries(row.cells).filter(([, c]) => c.level === "not_ready");
    if (weak.length >= 2) {
      severity += 2;
      reasons.push(`Not ready in ${weak.length} topics, including ${nameOf(weak[0][0])}`);
    }
  }
  if (idle === null || idle >= 7) {
    // Inactivity alone matters only when a test is coming.
    if (severity > 0 || (days !== null && days <= 14)) {
      severity += 1;
      reasons.push(idle === null ? "Hasn't studied in Ready yet" : `No study in ${idle} days`);
    }
  }
  if (severity === 0) return null;
  const next = row.exam?.next ?? worstCell(row.cells);
  return { studentId: m.studentId, name: m.name, severity, reasons, teachNext: topicName(next), textsOn: m.textsOn ?? false, lastTexted: m.lastTexted ?? null };
}

function worstCell(cells: Record<string, TopicReadiness>): TopicReadiness | null {
  const list = Object.values(cells).filter((c) => c.level !== "ready");
  list.sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || (a.score ?? 0) - (b.score ?? 0));
  return list[0] ?? null;
}

function latest(evidence: Evidence[], topicId: string): Evidence | undefined {
  let best: Evidence | undefined;
  for (const e of evidence) if (e.topicId === topicId && (!best || e.createdAt > best.createdAt)) best = e;
  return best;
}

function avg(values: number[]): number | null {
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

/** "PHARM-7KQ2": readable, no 0/O or 1/I. */
export function makeJoinCode(displayCode: string, random: () => number = Math.random): string {
  const letters = displayCode.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5) || "CLASS";
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const tail = Array.from({ length: 4 }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
  return `${letters}-${tail}`;
}

export function sharingConsentText(instructor: string, className: string): string {
  return (
    `Share my Ready progress in ${className} with ${instructor}: how ready I am for each topic and upcoming test, ` +
    `topics where I was sure but wrong, and when I last studied. My notes, files, what I said in sessions, ` +
    `and my phone number stay private. I can stop sharing at any time.`
  );
}
