// The prerequisite map is a DAG over a course's topics. These functions are pure
// so the ordering rules are easy to test and reason about.

export type Edge = { topic: string; prerequisite: string };

/**
 * Keeps edges in the given order, dropping any that would create a cycle or
 * point at an unknown topic. Earlier edges win, so callers put the most
 * trustworthy edges first.
 */
export function acyclicEdges(topicIds: string[], edges: Edge[]): { kept: Edge[]; dropped: Edge[] } {
  const known = new Set(topicIds);
  const prereqsOf = new Map<string, Set<string>>(topicIds.map((t) => [t, new Set()]));
  const kept: Edge[] = [];
  const dropped: Edge[] = [];
  for (const e of edges) {
    const invalid =
      !known.has(e.topic) || !known.has(e.prerequisite) || e.topic === e.prerequisite || reaches(prereqsOf, e.prerequisite, e.topic);
    if (invalid) {
      dropped.push(e);
      continue;
    }
    if (prereqsOf.get(e.topic)!.has(e.prerequisite)) continue;
    prereqsOf.get(e.topic)!.add(e.prerequisite);
    kept.push(e);
  }
  return { kept, dropped };
}

/** Does `from` (transitively) depend on `to`? */
function reaches(prereqsOf: Map<string, Set<string>>, from: string, to: string): boolean {
  const stack = [from];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const p of prereqsOf.get(cur) ?? []) stack.push(p);
  }
  return false;
}

/**
 * Teaching order: every topic comes after its prerequisites; ties keep the
 * syllabus order (`position`). Kahn's algorithm with a position-ordered queue.
 */
export function teachingOrder<T extends { id: string; position: number }>(topics: T[], edges: Edge[]): T[] {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const indegree = new Map(topics.map((t) => [t.id, 0]));
  const dependents = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.topic) || !byId.has(e.prerequisite)) continue;
    indegree.set(e.topic, indegree.get(e.topic)! + 1);
    dependents.set(e.prerequisite, [...(dependents.get(e.prerequisite) ?? []), e.topic]);
  }
  const ready = topics.filter((t) => indegree.get(t.id) === 0);
  const out: T[] = [];
  while (ready.length) {
    ready.sort((a, b) => a.position - b.position);
    const t = ready.shift()!;
    out.push(t);
    for (const d of dependents.get(t.id) ?? []) {
      indegree.set(d, indegree.get(d)! - 1);
      if (indegree.get(d) === 0) ready.push(byId.get(d)!);
    }
  }
  // Cycles can't exist if edges went through acyclicEdges, but never lose topics.
  for (const t of topics) if (!out.includes(t)) out.push(t);
  return out;
}

/**
 * The prerequisites a diagnostic should probe for `topicId`, nearest first,
 * returned in dependency order (deepest foundation first).
 */
export function diagnosticStrands(topicId: string, edges: Edge[], max = 2): string[] {
  const direct = (id: string) => edges.filter((e) => e.topic === id).map((e) => e.prerequisite);
  const found: string[] = [];
  let frontier = direct(topicId);
  while (frontier.length && found.length < max) {
    const next: string[] = [];
    for (const p of frontier) {
      if (found.length >= max) break;
      if (!found.includes(p)) {
        found.push(p);
        next.push(...direct(p));
      }
    }
    frontier = next;
  }
  return found.reverse();
}
