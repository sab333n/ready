// The lesson map is derived. Nothing stores "current" or "done" on a node.
import type { StrandResult } from "@/lib/diagnostic/engine";

export type PlanStatus = "current" | "held" | "gap" | "upcoming" | "goal";
export type PlanNode = { id: string; name: string; status: PlanStatus };

const HELD = new Set(["solid", "core"]);
const GAP = new Set(["shaky", "basic", "gap"]);

/** Dependency order in, a status per node out. The open question wins over every other status. */
export function lessonPlan(args: {
  goalId: string;
  strands: { topicId: string; name: string }[];
  results: Pick<StrandResult, "topicId" | "edge">[];
  currentTopicId: string | null;
}): PlanNode[] {
  const edge = new Map(args.results.map((r) => [r.topicId, r.edge]));
  return args.strands.map((s) => {
    const found = edge.get(s.topicId) ?? "untested";
    if (s.topicId === args.currentTopicId) return { id: s.topicId, name: s.name, status: "current" };
    if (HELD.has(found)) return { id: s.topicId, name: s.name, status: s.topicId === args.goalId ? "goal" : "held" };
    if (GAP.has(found)) return { id: s.topicId, name: s.name, status: "gap" };
    if (s.topicId === args.goalId) return { id: s.topicId, name: s.name, status: "goal" };
    return { id: s.topicId, name: s.name, status: "upcoming" };
  });
}
