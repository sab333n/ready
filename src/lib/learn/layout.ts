// Places a course's topics on a canvas. Roots sit toward the middle; each
// prerequisite step moves outward. Courses share the circle when there are several.

export type GraphCourse = {
  id: string;
  code: string;
  color: string;
  topics: { id: string; name: string }[];
  edges: { topic: string; prerequisite: string }[];
};

export type PlacedNode = { id: string; name: string; course: string; color: string; x: number; y: number };

const PER_ROW = 4;

export function placeGraph(courses: GraphCourse[], width = 1000): { nodes: PlacedNode[]; links: { from: string; to: string }[]; height: number } {
  const nodes: PlacedNode[] = [];
  const links: { from: string; to: string }[] = [];
  let y = 70;
  for (const course of courses) {
    if (course.topics.length === 0) continue;
    const ids = course.topics.map((t) => t.id);
    const depth = depths(ids, course.edges);
    const maxDepth = Math.max(0, ...ids.map((id) => depth.get(id) ?? 0));
    for (let d = 0; d <= maxDepth; d++) {
      const group = course.topics.filter((t) => (depth.get(t.id) ?? 0) === d);
      for (let i = 0; i < group.length; i += PER_ROW) {
        const row = group.slice(i, i + PER_ROW);
        row.forEach((topic, col) => {
          nodes.push({
            id: topic.id,
            name: topic.name,
            course: course.code,
            color: course.color,
            x: ((col + 0.5) / row.length) * width,
            y,
          });
        });
        y += 120;
      }
    }
    const known = new Set(ids);
    for (const edge of course.edges) {
      if (known.has(edge.topic) && known.has(edge.prerequisite)) links.push({ from: edge.prerequisite, to: edge.topic });
    }
    y += 40;
  }
  return { nodes, links, height: Math.max(y + 40, 360) };
}

function depths(ids: string[], edges: { topic: string; prerequisite: string }[]) {
  const depth = new Map(ids.map((id) => [id, 0]));
  const prereqs = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) prereqs.get(edge.topic)?.push(edge.prerequisite);
  let changed = true;
  for (let guard = 0; changed && guard < ids.length + 1; guard++) {
    changed = false;
    for (const id of ids) {
      const next = Math.max(0, ...(prereqs.get(id) ?? []).map((p) => (depth.get(p) ?? 0) + 1));
      if (next !== depth.get(id)) {
        depth.set(id, next);
        changed = true;
      }
    }
  }
  return depth;
}
