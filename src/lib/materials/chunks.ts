// Splits material text into citable passages and finds the ones relevant to a
// topic. Plain lexical scoring (TF-IDF over light stems): no embeddings needed
// at prototype scale, and results are deterministic and explainable.

export type Chunk = { ordinal: number; page: number | null; text: string };

const TARGET = 700;
const MAX = 1100;

/**
 * PDF text breaks lines wherever the page wrapped. Rejoin wrapped lines into
 * logical lines, but keep short unpunctuated lines (headings like "Cardiac
 * Drugs") on their own so they never glue onto the next sentence.
 */
export function logicalLines(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  const isHeading = (l: string) => l.length < 60 && !/[.!?,;:]$/.test(l) && !/^[a-z]/.test(l);
  for (const raw of text.split("\n")) {
    const line = raw.replace(/[ \t]+/g, " ").trim();
    if (!line) {
      if (buf) out.push(buf);
      buf = "";
      continue;
    }
    if (isHeading(line) || /^([•\-*]|\d+\.)\s/.test(line)) {
      if (buf) out.push(buf);
      buf = "";
      if (isHeading(line)) {
        out.push(line);
        continue;
      }
    }
    buf = buf ? `${buf} ${line}` : line;
    if (/[.!?]$/.test(line) && line.length < 80) {
      out.push(buf);
      buf = "";
    }
  }
  if (buf) out.push(buf);
  return out;
}

export function chunkText(text: string): Chunk[] {
  const pages = text.split("\f");
  const chunks: Chunk[] = [];
  pages.forEach((pageText, i) => {
    const page = pages.length > 1 ? i + 1 : null;
    const paragraphs = logicalLines(pageText);
    let buf = "";
    const flush = () => {
      if (buf.trim()) chunks.push({ ordinal: chunks.length, page, text: buf.trim() });
      buf = "";
    };
    for (const para of paragraphs) {
      if (para.length > MAX) {
        flush();
        for (const piece of splitLong(para)) chunks.push({ ordinal: chunks.length, page, text: piece });
        continue;
      }
      if (buf && buf.length + para.length + 1 > TARGET) flush();
      buf = buf ? `${buf}\n${para}` : para;
    }
    flush();
  });
  return chunks;
}

function splitLong(para: string): string[] {
  const sentences = para.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [para];
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (buf && buf.length + s.length > TARGET) {
      out.push(buf.trim());
      buf = "";
    }
    buf += s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const STOP = new Set(
  "a an and are as at be but by can do does for from has have how if in into is it its of on or that the their them then there these they this to was what when where which while who why will with you your not no also more most than such may might should would could each other only very just about over under after before between both during".split(
    " ",
  ),
);

/** Lowercase content words with a light stem ("drugs" → "drug", "blocking" → "block"). */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9-]+/g) ?? []).filter((w) => !STOP.has(w) && w.length > 2).map(stem);
}

function stem(w: string): string {
  return w
    .replace(/(ies)$/, "y")
    .replace(/(ing|ed)$/, "")
    .replace(/(es|s)$/, "")
    .replace(/-$/, "");
}

export type Scored<T> = T & { score: number };

/** Ranks chunks for a query. Chunks with no query term score 0 and are dropped. */
export function rankChunks<T extends { text: string }>(chunks: T[], query: string, limit = 6): Scored<T>[] {
  const q = [...new Set(terms(query))];
  if (q.length === 0) return [];
  const docs = chunks.map((c) => terms(c.text));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = chunks.length;
  return chunks
    .map((c, i) => {
      const tf = new Map<string, number>();
      for (const t of docs[i]) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const t of q) {
        const f = tf.get(t);
        if (!f) continue;
        score += (1 + Math.log(f)) * Math.log(1 + n / (df.get(t) ?? 1));
      }
      // Short chunks (headings) shouldn't outrank real passages.
      score *= Math.min(1, docs[i].length / 25);
      return { ...c, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Words too common in course topic names to identify a topic on their own.
const GENERIC = new Set(["drug", "medication", "introduction", "basic", "foundation", "principle", "overview", "part", "unit", "review", "concept"].map(stem));

/** The words that make a topic name specific ("Respiratory Drugs" → ["respiratory"]). */
export function distinctiveTerms(topicName: string): string[] {
  const all = [...new Set(terms(topicName))];
  const specific = all.filter((t) => !GENERIC.has(t));
  return specific.length ? specific : all;
}

/** Fraction of `reference` content words that appear in `answer` (0..1). */
export function termOverlap(reference: string, answer: string): number {
  const ref = new Set(terms(reference));
  if (ref.size === 0) return 0;
  const ans = new Set(terms(answer));
  let hit = 0;
  for (const t of ref) if (ans.has(t)) hit++;
  return hit / ref.size;
}

/** A syllabus lists deadlines; notes and slides explain content. */
export function looksLikeSyllabus(deadlineCount: number, text: string): boolean {
  return deadlineCount >= 3 || /\bsyllabus\b/i.test(text.slice(0, 2000));
}
