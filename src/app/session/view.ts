import * as db from "@/lib/db/lessons";
import { PERSONAS } from "@/lib/classroom/personas";
import { diagnosticResults, openDiagnosticItem, topicPassages } from "@/lib/lesson/service";
import type { StrandResult } from "@/lib/diagnostic/engine";
import { lessonPlan, type PlanNode } from "@/lib/learn/plan";
import { voiceEnabled } from "@/lib/voice/tokens";

export type LessonView = {
  id: string;
  topic: string;
  topicId: string;
  course: string;
  kind: db.SessionKind;
  stage: db.Stage;
  mode: "text" | "voice";
  plan: PlanNode[];
  personas: { id: string; name: string; role: string; color: string }[];
  diagnostic: {
    current: { id: string; question: string; strand: string; level: string; number: number; strandCount: number } | null;
    answered: { question: string; strand: string; score: number; rationale: string; answerKey: string; confidence: string | null }[];
    results: StrandResult[];
  };
  turns: { seq: number; speaker: string; text: string; confidence: "sure" | "unsure" | null; interrupted: boolean }[];
  hasNotes: boolean;
  generatedOutline: boolean;
  voiceAvailable: boolean;
  mistake: { caught: boolean | null; spoken: boolean } | null;
};

export async function lessonView(session: db.SessionRow): Promise<LessonView> {
  const topic = (await db.getTopic(session.studentId, session.topicId))!;
  const current = session.stage === "diagnostic" ? await openDiagnosticItem(session) : null;
  const items = await db.listItems(session.id);
  const strandName = (id: string) => session.strands.find((s) => s.topicId === id)?.name ?? topic.name;
  const { fromNotes, passages } = await topicPassages(session.studentId, topic, 3);
  const mistake = await db.getMistake(session.id);
  const report = await diagnosticResults(session);
  const strands = session.strands.length ? session.strands : [{ topicId: topic.id, name: topic.name }];
  const currentTopicId = session.stage === "diagnostic" ? (current?.topicId ?? null) : session.stage === "done" ? null : (report.start?.topicId ?? topic.id);
  return {
    id: session.id,
    topic: topic.name,
    topicId: topic.id,
    course: topic.courseCode,
    kind: session.type === "practice" ? "practice" : "teach",
    stage: session.stage,
    mode: session.mode,
    plan: lessonPlan({ goalId: topic.id, strands, results: report.results, currentTopicId }),
    personas: session.personas.map((p) => ({ id: p, name: PERSONAS[p].name, role: PERSONAS[p].role, color: PERSONAS[p].color })),
    diagnostic: {
      current: current && {
        id: current.id,
        question: current.question,
        strand: strandName(current.topicId),
        level: current.level,
        number: items.filter((i) => i.score !== null).length + 1,
        strandCount: session.strands.length,
      },
      answered: items
        .filter((i) => i.score !== null)
        .map((i) => ({
          question: i.question,
          strand: strandName(i.topicId),
          score: i.score!,
          rationale: i.rationale ?? "",
          answerKey: i.answerKey,
          confidence: i.confidence,
        })),
      results: report.results,
    },
    turns: (await db.listTurns(session.id)).map((t) => ({ seq: t.seq, speaker: t.speaker, text: t.text, confidence: t.confidence, interrupted: t.interrupted })),
    hasNotes: fromNotes,
    generatedOutline: passages.some((passage) => passage.source.startsWith("Outline —")),
    voiceAvailable: voiceEnabled(),
    mistake: mistake && { caught: mistake.caught, spoken: mistake.spokenTurnSeq !== null },
  };
}
