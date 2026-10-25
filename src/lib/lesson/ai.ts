// Every AI step of a lesson, each with an LLM path and an offline path. The
// offline path runs when LLM_PROVIDER=none, and as a fallback if a call fails,
// so a session never dead-ends because a model call went wrong.
import { z } from "zod";
import { getLlm } from "@/lib/llm";
import { loadPrompt } from "@/lib/prompts";
import type { Level } from "@/lib/diagnostic/engine";
import type { Edge } from "@/lib/learn/prereqs";
import { PERSONAS, type PersonaId } from "@/lib/classroom/personas";
import {
  offlineCaught,
  offlineGrade,
  offlineKeyPoints,
  offlinePersonaLine,
  offlinePlantMistake,
  offlineQuestion,
  sentencesOf,
  type Passage,
} from "@/lib/offline";
import { termOverlap } from "@/lib/materials/chunks";

export type { Passage };

/** Labels passages P1..Pn for prompts; the model cites labels, we map back to ids. */
function labelled(passages: Passage[]) {
  const text = passages.map((p, i) => `[P${i + 1}] ${p.text}`).join("\n\n");
  const idFor = (label: string | null | undefined) => {
    const n = Number(String(label ?? "").replace(/\D/g, ""));
    return passages[n - 1]?.id ?? null;
  };
  return { text, idFor };
}

async function withFallback<T>(name: string, llmCall: (() => Promise<T>) | null, offline: () => T): Promise<T> {
  if (!llmCall) return offline();
  try {
    return await llmCall();
  } catch (err) {
    console.error(`[lesson] ${name} failed, using offline engine`, err);
    return offline();
  }
}

// ---- prerequisite map ------------------------------------------------------------

const PrereqSchema = z.object({
  edges: z.array(z.object({ topic: z.string(), prerequisite: z.string(), reason: z.string() })),
});

export async function buildPrereqEdges(course: string, topics: { id: string; name: string }[]): Promise<(Edge & { reason: string })[]> {
  const llm = getLlm();
  if (!llm || topics.length < 2) return [];
  // Short ids keep the model from mangling UUIDs.
  const short = topics.map((t, i) => ({ ...t, key: `T${i + 1}` }));
  const p = loadPrompt("prereq-map", 1, { course, topics: short.map((t) => `${t.key}: ${t.name}`).join("\n") });
  const byKey = new Map(short.map((t) => [t.key, t.id]));
  return withFallback(
    "prereq-map",
    async () => {
      const out = await llm.generateObject({ promptId: p.id, system: p.system, prompt: p.user, schema: PrereqSchema });
      return out.edges
        .map((e) => ({ topic: byKey.get(e.topic) ?? "", prerequisite: byKey.get(e.prerequisite) ?? "", reason: e.reason }))
        .filter((e) => e.topic && e.prerequisite);
    },
    () => [],
  );
}

// ---- diagnostic --------------------------------------------------------------------

const QuestionSchema = z.object({ question: z.string(), answerKey: z.string(), passage: z.string() });

export async function makeQuestion(topic: string, level: Level, passages: Passage[], asked: string[]) {
  const llm = getLlm();
  const { text, idFor } = labelled(passages);
  const offline = () => {
    const q = offlineQuestion(topic, level, passages, asked);
    return q && { question: q.question, answerKey: q.answerKey, chunkId: q.passageId };
  };
  if (passages.length === 0) return null;
  return withFallback(
    "diagnostic-question",
    llm &&
      (async () => {
        const p = loadPrompt("diagnostic-question", 1, { topic, level, passages: text, asked: asked.length ? asked.join(" | ") : "(none)" });
        const out = await llm.generateObject({ promptId: p.id, system: p.system, prompt: p.user, schema: QuestionSchema, maxTokens: 2000 });
        return { question: out.question, answerKey: out.answerKey, chunkId: idFor(out.passage) };
      }),
    offline,
  );
}

const GradeSchema = z.object({ score: z.number().int().min(0).max(10), rationale: z.string(), misconception: z.string().nullable() });

export async function gradeAnswer(question: string, answerKey: string, passage: string, answer: string) {
  const llm = getLlm();
  return withFallback(
    "grade-answer",
    llm &&
      (async () => {
        const p = loadPrompt("grade-answer", 1, { question, answerKey, passage: passage || "(none)", answer: answer || "(no answer)" });
        const out = await llm.generateObject({ promptId: p.id, system: p.system, prompt: p.user, schema: GradeSchema, maxTokens: 2000 });
        return { ...out, score: Math.max(0, Math.min(10, Math.round(out.score))) };
      }),
    () => offlineGrade(answerKey, answer),
  );
}

// ---- classroom ------------------------------------------------------------------------

const LineSchema = z.object({ line: z.string() });

export type TranscriptLine = { seq: number; speaker: string; text: string };

export function formatTranscript(turns: TranscriptLine[]) {
  return turns
    .filter((t) => t.speaker !== "system")
    .map((t) => `${t.speaker === "learner" ? `#${t.seq} Teacher` : PERSONAS[t.speaker as PersonaId]?.name ?? t.speaker}: ${t.text}`)
    .join("\n");
}

export async function personaLine(args: {
  speaker: PersonaId;
  personas: PersonaId[];
  topic: string;
  passages: Passage[];
  turns: TranscriptLine[];
  cue?: string;
  /** What to say without an LLM when there is a director note. */
  offlineText?: string;
}) {
  const llm = getLlm();
  const learnerTurns = args.turns.filter((t) => t.speaker === "learner");
  const lastLearner = learnerTurns.at(-1)?.text ?? "";
  return withFallback(
    "classroom-turn",
    llm &&
      (async () => {
        const p = loadPrompt("classroom-turn", 1, {
          topic: args.topic,
          personas: args.personas.map((id) => `- ${PERSONAS[id].name} (${PERSONAS[id].role}): ${PERSONAS[id].trait}`).join("\n"),
          speaker: PERSONAS[args.speaker].name,
          cue: args.cue ? `\nDirector note for this turn (follow it, never mention it): ${args.cue}` : "",
          passages: labelled(args.passages).text,
          transcript: formatTranscript(args.turns.slice(-16)),
        });
        const out = await llm.generateObject({ promptId: p.id, system: p.system, prompt: p.user, schema: LineSchema, maxTokens: 2000 });
        return stripName(out.line, args.speaker);
      }),
    () => args.offlineText ?? offlinePersonaLine(args.speaker, lastLearner, args.passages, learnerTurns.length),
  );
}

function stripName(line: string, speaker: PersonaId) {
  return line.replace(new RegExp(`^\\s*${PERSONAS[speaker].name}\\s*:\\s*`, "i"), "").trim();
}

// ---- planted mistake -------------------------------------------------------------------

const MistakeSchema = z.object({ claim: z.string(), correction: z.string(), passage: z.string(), summary: z.string() });

export async function planTeachBackMistake(topic: string, teaching: string, passages: Passage[]) {
  const llm = getLlm();
  const { text, idFor } = labelled(passages);
  const offline = () => {
    const m = offlinePlantMistake(passages);
    return m && { claim: m.claim, correction: m.correction, chunkId: m.passageId, summary: m.summary };
  };
  return withFallback(
    "plant-mistake",
    llm &&
      (async () => {
        const p = loadPrompt("plant-mistake", 1, { topic, teaching: teaching || "(the teacher has not said much yet)", passages: text });
        const out = await llm.generateObject({ promptId: p.id, system: p.system, prompt: p.user, schema: MistakeSchema, maxTokens: 3000 });
        return { claim: out.claim, correction: out.correction, chunkId: idFor(out.passage), summary: out.summary };
      }),
    offline,
  );
}

const CatchSchema = z.object({ caught: z.boolean(), evidence: z.string().nullable() });

export async function checkCatch(claim: string, correction: string, replies: string[]) {
  const llm = getLlm();
  const joined = replies.join("\n");
  return withFallback(
    "check-catch",
    llm &&
      (async () => {
        const p = loadPrompt("check-catch", 1, { claim, correction, replies: joined });
        return llm.generateObject({ promptId: p.id, system: p.system, prompt: p.user, schema: CatchSchema, maxTokens: 1000 });
      }),
    () => {
      const hit = replies.find((r) => offlineCaught(claim, correction, r));
      return { caught: Boolean(hit), evidence: hit ?? null };
    },
  );
}

// ---- reflection ----------------------------------------------------------------------------

const ReflectionSchema = z.object({
  keyPoints: z.array(
    z.object({
      point: z.string(),
      passage: z.string(),
      verdict: z.enum(["correct", "wrong", "skipped"]),
      turn: z.number().int().nullable(),
      quote: z.string().nullable(),
      note: z.string().nullable(),
    }),
  ),
  strengths: z.array(z.string()),
  improve: z.array(z.string()),
});

export type KeyPointVerdict = {
  point: string;
  chunkId: string | null;
  verdict: "correct" | "wrong" | "skipped";
  turn: number | null;
  quote: string | null;
  note: string | null;
};

export async function reflectOnTeaching(topic: string, passages: Passage[], turns: TranscriptLine[]) {
  const llm = getLlm();
  const { text, idFor } = labelled(passages);
  const teacherTurns = turns.filter((t) => t.speaker === "learner");
  return withFallback(
    "reflection",
    llm &&
      (async () => {
        const p = loadPrompt("reflection", 1, { topic, passages: text, transcript: formatTranscript(turns) || "(no turns)" });
        const out = await llm.generateObject({ promptId: p.id, system: p.system, prompt: p.user, schema: ReflectionSchema, maxTokens: 6000 });
        const keyPoints: KeyPointVerdict[] = out.keyPoints.map((k) => ({
          point: k.point,
          chunkId: idFor(k.passage),
          verdict: k.verdict,
          turn: k.turn,
          quote: k.quote,
          note: k.note,
        }));
        return { keyPoints, strengths: out.strengths, improve: out.improve, usedLlm: true };
      }),
    () => {
      const keyPoints: KeyPointVerdict[] = offlineKeyPoints(passages).map((k) => {
        let best: { t: TranscriptLine; o: number } | null = null;
        for (const t of teacherTurns) {
          const o = Math.max(termOverlap(k.point, t.text), ...sentencesOf(t.text).map((s) => termOverlap(k.point, s)));
          if (!best || o > best.o) best = { t, o };
        }
        const graded = best ? offlineGrade(k.point, best.t.text) : null;
        const verdict = !best || best.o < 0.3 ? "skipped" : graded && graded.score <= 2 ? "wrong" : "correct";
        return {
          point: k.point,
          chunkId: k.passageId,
          verdict,
          turn: verdict === "skipped" ? null : best!.t.seq,
          quote: verdict === "skipped" ? null : bestSentence(k.point, best!.t.text),
          note: verdict === "wrong" ? graded!.rationale : null,
        };
      });
      const correct = keyPoints.filter((k) => k.verdict === "correct");
      return {
        keyPoints,
        strengths: correct.length ? [`You covered ${correct.length} of ${keyPoints.length} key points from your notes.`] : [],
        improve: keyPoints.filter((k) => k.verdict === "skipped").slice(0, 2).map((k) => `Explain this next time: ${k.point}`),
        usedLlm: false,
      };
    },
  );
}

/** The learner's sentence that best matches a key point, for quoting. */
function bestSentence(point: string, text: string): string {
  const sentences = sentencesOf(text);
  if (sentences.length === 0) return text.slice(0, 200);
  return sentences.reduce((a, b) => (termOverlap(point, b) > termOverlap(point, a) ? b : a));
}
