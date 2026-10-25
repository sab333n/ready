// The 2–3 minute diagnostic: for each strand (prerequisites first, then the
// topic itself) find where understanding ends with at most two questions.
//
//   core question ──score ≥ 7──▶ deeper question  (find the ceiling)
//         │
//         └──score ≤ 3──▶ basic question           (find the floor)
//         └──4..6─────────▶ stop: "shaky"
//
// Pure: given the strands and the graded items so far, it says what to ask
// next and what each strand's result is.

export type Level = "basic" | "core" | "deeper";
export type Strand = { topicId: string; name: string };
export type GradedItem = { topicId: string; level: Level; score: number | null; confidence: "sure" | "unsure" | null };

export type StrandResult = {
  topicId: string;
  name: string;
  /** solid: core + deeper right · core: core right, deeper not · shaky: partial core ·
   *  basic: only the basics hold · gap: even the basics are missing · untested */
  edge: "solid" | "core" | "shaky" | "basic" | "gap" | "untested";
  /** 0–100, used as diagnostic evidence for readiness. */
  score: number;
  confidentWrong: boolean;
};

export const PASS = 7;
export const FAIL = 3;

export function nextQuestion(strands: Strand[], items: GradedItem[]): { strand: Strand; level: Level } | null {
  // An unanswered item must be answered first.
  if (items.some((i) => i.score === null)) return null;
  for (const strand of strands) {
    const mine = items.filter((i) => i.topicId === strand.topicId);
    const core = mine.find((i) => i.level === "core");
    if (!core) return { strand, level: "core" };
    if (mine.length >= 2) continue;
    if (core.score! >= PASS) return { strand, level: "deeper" };
    if (core.score! <= FAIL) return { strand, level: "basic" };
  }
  return null;
}

export function strandResult(strand: Strand, items: GradedItem[]): StrandResult {
  const mine = items.filter((i) => i.topicId === strand.topicId && i.score !== null);
  const at = (l: Level) => mine.find((i) => i.level === l)?.score ?? null;
  const core = at("core");
  const deeper = at("deeper");
  const basic = at("basic");
  const confidentWrong = mine.some((i) => i.confidence === "sure" && i.score! <= FAIL);
  const base = { topicId: strand.topicId, name: strand.name, confidentWrong };

  if (core === null) return { ...base, edge: "untested", score: 0 };
  if (core >= PASS && deeper !== null && deeper >= PASS) return { ...base, edge: "solid", score: 95 };
  if (core >= PASS) return { ...base, edge: "core", score: deeper === null ? 75 : 70 + deeper * 2 };
  if (core > FAIL) return { ...base, edge: "shaky", score: 40 + core * 3 };
  if (basic !== null && basic >= PASS) return { ...base, edge: "basic", score: 30 };
  return { ...base, edge: "gap", score: 10 + core * 2 };
}

/**
 * Where teaching should start: the first strand, in dependency order, that
 * isn't held well enough to build on. Null when everything holds.
 */
export function startingPoint(results: StrandResult[]): StrandResult | null {
  return results.find((r) => r.edge === "gap" || r.edge === "basic" || r.edge === "shaky") ?? null;
}

export const EDGE_LABEL: Record<StrandResult["edge"], string> = {
  solid: "Solid, including the harder question",
  core: "Core ideas hold",
  shaky: "Partly there",
  basic: "Only the basics hold",
  gap: "Not there yet",
  untested: "Not tested",
};
