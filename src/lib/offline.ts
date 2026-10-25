// Offline engine: deterministic stand-ins for every AI step, used when no LLM
// is configured (LLM_PROVIDER=none) and in tests. It is honest about being
// simple: questions come straight from the student's passages, grading is
// word overlap, and the planted mistake flips one relationship word.
import { logicalLines, terms, termOverlap } from "@/lib/materials/chunks";
import type { Level } from "@/lib/diagnostic/engine";
import { PERSONAS, type PersonaId } from "@/lib/classroom/personas";

export type Passage = { id: string; text: string };

// ---- diagnostic -------------------------------------------------------------

export function offlineQuestion(topic: string, level: Level, passages: Passage[], asked: string[]) {
  const sentences = passages.flatMap((p) => sentencesOf(p.text).map((s) => ({ passage: p, s })));
  const relevant = sentences.filter(({ s }) => terms(s).length >= 5);
  const unused = relevant.filter(({ s }) => !asked.some((q) => q.includes(s.slice(0, 40))));
  const pick = (unused.length ? unused : relevant)[level === "basic" ? 0 : level === "core" ? 1 : 2] ?? relevant[0];
  if (!pick) return null;
  const prompts: Record<Level, string> = {
    basic: `In one sentence: what does "${topic}" refer to in your notes?`,
    core: `Explain in your own words: how or why does this work in "${topic}"?`,
    deeper: `Apply it: what would you expect to happen, and why, based on this idea from "${topic}"?`,
  };
  return { question: `${prompts[level]} (Hint: ${hintOf(pick.s)})`, answerKey: pick.s, passageId: pick.passage.id };
}

export function offlineGrade(answerKey: string, answer: string) {
  const cleaned = answer.trim();
  if (!cleaned || /^(i don'?t know|idk|no idea|not sure)\.?$/i.test(cleaned)) {
    return { score: 0, rationale: "No answer given.", misconception: null };
  }
  const overlap = termOverlap(answerKey, cleaned);
  const flipped = contradicts(answerKey, cleaned);
  if (flipped) return { score: 2, rationale: `Your answer says "${flipped.said}" where your notes say "${flipped.notes}".`, misconception: flipped.said };
  const score = overlap >= 0.6 ? 9 : overlap >= 0.4 ? 7 : overlap >= 0.25 ? 5 : overlap >= 0.12 ? 3 : 1;
  const rationale =
    score >= 7
      ? "Matches the key idea in your notes."
      : score >= 5
        ? "Partly there; some of the key idea from your notes is missing."
        : "Doesn't yet match what your notes say.";
  return { score, rationale: `${rationale} (Offline grading compares your words with your notes.)`, misconception: null };
}

// ---- classroom ----------------------------------------------------------------

export function offlinePersonaLine(persona: PersonaId, learnerText: string, passages: Passage[], turnIndex: number): string {
  const keyword = pickKeyword(learnerText) ?? "that";
  const snippet = clip(sentencesOf(passages[turnIndex % Math.max(passages.length, 1)]?.text ?? "")[0] ?? "", 160);
  const lines: Record<PersonaId, string[]> = {
    maya: [
      `Okay, can you say that more simply? What does "${keyword}" actually mean?`,
      `Could you give me an example? I kind of follow, but I can't picture it yet.`,
      `Wait, I lost you at "${keyword}". Can you go back one step?`,
    ],
    jordan: [
      `Why is that true, though? What's actually happening with "${keyword}"?`,
      snippet ? `My notes say "${snippet}". How does that fit with what you just said?` : `How do you know that's always the case?`,
      `Is there an exception? When would "${keyword}" not work that way?`,
    ],
    patient: [
      `So if I'm taking this, what should I watch out for?`,
      `Is that something I'd feel? How would I know it's working?`,
      `Can I take it with my other medicines?`,
    ],
    classmate: [
      `How does "${keyword}" connect to what we covered last week?`,
      `Do you think that's what they'll ask on the exam?`,
      `So what's the one thing to remember about this?`,
    ],
  };
  const options = lines[persona];
  return options[turnIndex % options.length];
}

// ---- planted mistake -------------------------------------------------------------

const FLIPS: [string, string][] = [
  ["increases", "decreases"],
  ["increase", "decrease"],
  ["raises", "lowers"],
  ["raise", "lower"],
  ["higher", "lower"],
  ["slows", "speeds up"],
  ["blocks", "activates"],
  ["block", "activate"],
  ["inhibits", "stimulates"],
  ["inhibit", "stimulate"],
  ["dilates", "constricts"],
  ["vasodilation", "vasoconstriction"],
  ["hypokalemia", "hyperkalemia"],
  ["hypotension", "hypertension"],
  ["bradycardia", "tachycardia"],
  ["before", "after"],
  ["more", "less"],
  ["positive", "negative"],
];

/** Flips one relationship word in a passage sentence to make a plausible, checkable error. */
export function offlinePlantMistake(passages: Passage[]): { claim: string; correction: string; passageId: string; summary: string } | null {
  for (const p of passages) {
    for (const s of sentencesOf(p.text)) {
      for (const [a, b] of FLIPS) {
        for (const [from, to] of [
          [a, b],
          [b, a],
        ]) {
          const re = new RegExp(`\\b${from}\\b`, "i");
          if (re.test(s) && terms(s).length >= 5) {
            const claim = s.replace(re, (m) => matchCase(m, to));
            return {
              claim,
              correction: s,
              passageId: p.id,
              summary: `Okay, let me try to say it back. ${claim} I think that's the main idea, right?`,
            };
          }
        }
      }
    }
  }
  return null;
}

/** The teacher caught it if they push back AND restore the right relationship. */
export function offlineCaught(claim: string, correction: string, reply: string): boolean {
  const pushback = /\b(no|not|isn'?t|wrong|incorrect|actually|opposite|mistake|backwards|careful|nope)\b/i.test(reply);
  const diff = changedWords(correction, claim);
  // Compare word stems loosely so "decrease" matches "decreases".
  const restores =
    diff.length === 0
      ? termOverlap(correction, reply) > 0.4
      : diff.some((w) => new RegExp(`\\b${escape(w.slice(0, Math.max(4, w.length - 2)))}`, "i").test(reply));
  return pushback && restores;
}

// ---- reflection -------------------------------------------------------------------

export function offlineKeyPoints(passages: Passage[], max = 5): { point: string; passageId: string }[] {
  const out: { point: string; passageId: string }[] = [];
  for (const p of passages) {
    for (const s of sentencesOf(p.text)) {
      if (terms(s).length >= 6 && out.length < max) out.push({ point: s, passageId: p.id });
    }
  }
  return out;
}

// ---- helpers --------------------------------------------------------------------

export function sentencesOf(text: string): string[] {
  // Lines first, so a heading ("Cardiac Drugs") never glues onto the next sentence.
  return logicalLines(text)
    .flatMap((line) => line.match(/[^.!?]+[.!?]+/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 30);
}

function hintOf(sentence: string): string {
  // Original words (not stems), longest first: the most specific ones.
  const words = [...new Set(sentence.match(/\b[a-zA-Z][a-zA-Z-]{5,}\b/g) ?? [])].filter((w) => terms(w).length > 0);
  const picked = words.sort((a, b) => b.length - a.length).slice(0, 3).map((w) => w.toLowerCase());
  return `think about ${picked.join(", ")}`;
}

/** Shortens at a word boundary so quotes don't end mid-word. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, text.lastIndexOf(" ", max)).replace(/[,;:]$/, "")}…`;
}

function pickKeyword(text: string): string | null {
  const words = text.match(/\b[a-zA-Z][a-zA-Z-]{6,}\b/g);
  return words ? words.sort((a, b) => b.length - a.length)[0].toLowerCase() : null;
}

function contradicts(key: string, answer: string): { said: string; notes: string } | null {
  for (const [a, b] of FLIPS) {
    for (const [inKey, inAnswer] of [
      [a, b],
      [b, a],
    ]) {
      if (new RegExp(`\\b${inKey}\\b`, "i").test(key) && new RegExp(`\\b${inAnswer}\\b`, "i").test(answer) && !new RegExp(`\\b${inKey}\\b`, "i").test(answer)) {
        return { said: inAnswer, notes: inKey };
      }
    }
  }
  return null;
}

function changedWords(original: string, altered: string): string[] {
  const alt = new Set(altered.toLowerCase().split(/\W+/));
  return original
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w && !alt.has(w));
}

function matchCase(source: string, target: string) {
  return source[0] === source[0].toUpperCase() ? target[0].toUpperCase() + target.slice(1) : target;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const personaName = (id: PersonaId) => PERSONAS[id].name;
