// Readiness is derived, never stored: every diagnostic answer, teaching session
// and teach-back leaves a score row, and this module turns those rows into
// "are you ready for Thursday's exam?" Pure, so it is easy to test.
import { distinctiveTerms, terms } from "@/lib/materials/chunks";

export type Evidence = {
  topicId: string;
  source: "diagnostic" | "teach" | "teach_back" | "practice";
  score: number;
  confidentWrong: boolean;
  createdAt: Date;
};

export type Level = "not_ready" | "unmeasured" | "getting_there" | "ready";

export type TopicReadiness = { topicId: string; level: Level; score: number | null; lastAt: Date | null };

/** Worst first, so sorting by this order surfaces what needs work. */
export const LEVEL_ORDER: Level[] = ["not_ready", "unmeasured", "getting_there", "ready"];

export const LEVEL_LABEL: Record<Level, string> = {
  not_ready: "Not ready",
  unmeasured: "Not measured yet",
  getting_there: "Getting there",
  ready: "Ready",
};

// Explaining it yourself is the strongest signal; one caught (or missed) mistake the weakest.
const SOURCE_WEIGHT: Record<Evidence["source"], number> = { teach: 1, practice: 1, diagnostic: 0.8, teach_back: 0.5 };
const HALF_LIFE_DAYS = 14;
const RECENT = 6;
export const READY = 75;
export const GETTING_THERE = 50;

export function topicReadiness(topicId: string, evidence: Evidence[], now = new Date()): TopicReadiness {
  const mine = evidence
    .filter((e) => e.topicId === topicId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, RECENT);
  if (mine.length === 0) return { topicId, level: "unmeasured", score: null, lastAt: null };
  let total = 0;
  let weights = 0;
  for (const e of mine) {
    const ageDays = Math.max(0, (now.getTime() - e.createdAt.getTime()) / 864e5);
    const w = SOURCE_WEIGHT[e.source] * 0.5 ** (ageDays / HALF_LIFE_DAYS);
    total += w * e.score;
    weights += w;
  }
  // Being sure about something wrong is the riskiest state before an exam.
  const penalty = mine[0].confidentWrong ? 10 : 0;
  const score = Math.max(0, Math.round(total / weights) - penalty);
  return { topicId, level: levelFor(score), score, lastAt: mine[0].createdAt };
}

export function levelFor(score: number): Level {
  return score >= READY ? "ready" : score >= GETTING_THERE ? "getting_there" : "not_ready";
}

type TopicRef = { id: string; courseId: string; name: string; prerequisites?: string[] };
type DeadlineRef = { courseId: string | null; title: string; kind: "exam" | "quiz" | "assignment" | "other" };

const NOT_A_TOPIC = new Set(["exam", "quiz", "test", "final", "midterm", "chapter", "week", "module", "unit", "drug", "and"].map((w) => terms(w)[0] ?? w));

/**
 * Topics a deadline tests: the course topics its title names ("Quiz 4: Anticoagulants"),
 * plus what those build on directly. An exam that names none covers the whole course.
 */
export function deadlineTopics<T extends TopicRef>(deadline: DeadlineRef, topics: T[]): T[] {
  if (!deadline.courseId || (deadline.kind !== "exam" && deadline.kind !== "quiz")) return [];
  const course = topics.filter((t) => t.courseId === deadline.courseId);
  const title = terms(deadline.title)
    .filter((w) => !NOT_A_TOPIC.has(w))
    .map(root);
  const named = course.filter((t) => distinctiveTerms(t.name).map(root).some((w) => title.includes(w)));
  if (named.length === 0) return deadline.kind === "exam" ? course : [];
  const wanted = new Set(named.flatMap((t) => [t.name, ...(t.prerequisites ?? [])].map((n) => n.toLowerCase())));
  return course.filter((t) => wanted.has(t.name.toLowerCase()));
}

// "cardiac" and "cardiovascular", "hypertension" and "antihypertensives" share a root.
const root = (word: string) => word.replace(/^anti/, "").slice(0, 5);

export type DeadlineReadiness = {
  level: Level;
  topics: TopicReadiness[];
  measured: number;
  /** What to teach next: the weakest topic, unmeasured ones in course order. */
  next: TopicReadiness | null;
};

export function deadlineReadiness(covered: TopicRef[], byTopic: Map<string, TopicReadiness>): DeadlineReadiness | null {
  if (covered.length === 0) return null;
  const topics = covered.map((t) => byTopic.get(t.id) ?? { topicId: t.id, level: "unmeasured" as const, score: null, lastAt: null });
  const rank = (r: TopicReadiness) => LEVEL_ORDER.indexOf(r.level);
  const sorted = [...topics].sort((a, b) => rank(a) - rank(b) || (a.score ?? 0) - (b.score ?? 0));
  const worst = sorted[0];
  return {
    level: worst.level,
    topics,
    measured: topics.filter((t) => t.level !== "unmeasured").length,
    next: worst.level === "ready" ? null : worst,
  };
}
