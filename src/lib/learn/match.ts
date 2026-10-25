/** Picks the topic a learner named. Exact, then the shortest containing name, then shared words. */
export function pickTopic<T extends { name: string }>(goal: string, topics: T[]): T | null {
  const q = goal.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return null;
  const exact = topics.filter((t) => t.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const contains = topics.filter((t) => t.name.toLowerCase().includes(q));
  if (contains.length >= 1) return [...contains].sort((a, b) => a.name.length - b.name.length)[0];
  const words = q.split(" ").filter((w) => w.length > 2);
  if (words.length === 0) return null;
  let best: { topic: T; score: number } | null = null;
  for (const topic of topics) {
    const name = topic.name.toLowerCase();
    const score = words.filter((w) => name.includes(w)).length;
    if (!best || score > best.score || (score === best.score && topic.name.length < best.topic.name.length)) best = { topic, score };
  }
  if (!best || best.score === 0) return null;
  const need = words.length === 1 ? 1 : Math.ceil(words.length / 2);
  return best.score >= need ? best.topic : null;
}
