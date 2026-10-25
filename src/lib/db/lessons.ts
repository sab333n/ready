// Database access for Phase 2 (materials passages, prerequisite map, sessions).
// Every query is scoped by student_id, directly or through the session.
import { sql } from "./index";
import type { Chunk } from "@/lib/materials/chunks";
import type { Edge } from "@/lib/learn/prereqs";
import type { Level, Strand } from "@/lib/diagnostic/engine";
import type { PersonaId } from "@/lib/classroom/personas";

// ---- passages ----------------------------------------------------------------

/** Idempotent and safe to run concurrently (two requests may backfill the same material). */
export async function saveChunks(studentId: string, materialId: string, chunks: Chunk[]) {
  await sql.begin(async (tx) => {
    for (const c of chunks) {
      await tx`
        insert into material_chunks (material_id, student_id, ordinal, page, text)
        values (${materialId}, ${studentId}, ${c.ordinal}, ${c.page}, ${c.text})
        on conflict (material_id, ordinal) do update set page = excluded.page, text = excluded.text`;
    }
    await tx`delete from material_chunks where material_id = ${materialId} and ordinal >= ${chunks.length}`;
  });
}

export async function materialsWithoutChunks(studentId: string) {
  return sql<{ id: string; extractedText: string }[]>`
    select m.id, m.extracted_text from materials m
    where m.student_id = ${studentId}
      and not exists (select 1 from material_chunks c where c.material_id = m.id)`;
}

export type PassageRow = { id: string; text: string; page: number | null; filename: string; kind: string; courseId: string | null };

/** Every passage the student uploaded, with where it came from. */
export async function studentPassages(studentId: string) {
  return sql<PassageRow[]>`
    select c.id, c.text, c.page, m.filename, m.kind, m.course_id
    from material_chunks c join materials m on m.id = c.material_id
    where c.student_id = ${studentId}
    order by m.created_at, c.ordinal`;
}

export async function passagesById(studentId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return sql<PassageRow[]>`
    select c.id, c.text, c.page, m.filename, m.kind, m.course_id
    from material_chunks c join materials m on m.id = c.material_id
    where c.student_id = ${studentId} and c.id in ${sql(ids)}`;
}

// ---- topics & prerequisite map ------------------------------------------------

export type TopicRow = { id: string; courseId: string; name: string; position: number };

export async function getTopic(studentId: string, topicId: string) {
  const [t] = await sql<(TopicRow & { courseCode: string; courseName: string | null })[]>`
    select t.id, t.course_id, t.name, t.position, c.display_code as course_code, c.name as course_name
    from topics t join courses c on c.id = t.course_id
    where t.id = ${topicId} and t.student_id = ${studentId}`;
  return t ?? null;
}

export async function courseTopics(studentId: string, courseId: string) {
  return sql<TopicRow[]>`
    select id, course_id, name, position from topics
    where student_id = ${studentId} and course_id = ${courseId} order by position`;
}

export async function courseEdges(courseId: string) {
  return sql<(Edge & { reason: string | null })[]>`
    select tp.topic_id as topic, tp.prerequisite_id as prerequisite, tp.reason
    from topic_prerequisites tp join topics t on t.id = tp.topic_id
    where t.course_id = ${courseId}`;
}

export async function coursesWithTopics(studentId: string) {
  return sql<{ id: string; displayCode: string; name: string | null; color: string; prereqMapBuiltAt: Date | null }[]>`
    select c.id, c.display_code, c.name, c.color, c.prereq_map_built_at from courses c
    where c.student_id = ${studentId} and exists (select 1 from topics t where t.course_id = c.id)
    order by c.display_code`;
}

export async function addPrereqEdges(courseId: string, edges: (Edge & { reason?: string })[]) {
  await sql.begin(async (tx) => {
    for (const e of edges) {
      await tx`
        insert into topic_prerequisites (topic_id, prerequisite_id, reason)
        values (${e.topic}, ${e.prerequisite}, ${e.reason ?? null})
        on conflict (topic_id, prerequisite_id) do update set reason = coalesce(excluded.reason, topic_prerequisites.reason)`;
    }
    await tx`update courses set prereq_map_built_at = now() where id = ${courseId}`;
  });
}

// ---- sessions -------------------------------------------------------------------

export type Stage = "diagnostic" | "teach" | "teach_back" | "done";

export type SessionKind = "teach" | "practice";

export type SessionRow = {
  id: string;
  studentId: string;
  topicId: string;
  type: SessionKind;
  stage: Stage;
  mode: "text" | "voice";
  personas: PersonaId[];
  strands: Strand[];
  reflection: unknown;
  startedAt: Date;
  endedAt: Date | null;
};

export async function createSession(studentId: string, topicId: string, personas: PersonaId[], strands: Strand[], kind: SessionKind = "teach") {
  const [s] = await sql<SessionRow[]>`
    insert into sessions (student_id, topic_id, personas, strands, stage, type)
    values (${studentId}, ${topicId}, ${personas}, ${sql.json(strands)}, ${strands.length ? "diagnostic" : "teach"}, ${kind})
    returning *`;
  return s;
}

export async function getSession(studentId: string, sessionId: string) {
  const [s] = await sql<SessionRow[]>`select * from sessions where id = ${sessionId} and student_id = ${studentId}`;
  return s ?? null;
}

export async function setStage(sessionId: string, stage: Stage) {
  await sql`update sessions set stage = ${stage}, ended_at = ${stage === "done" ? new Date() : null} where id = ${sessionId}`;
}

export async function setMode(sessionId: string, mode: "text" | "voice") {
  await sql`update sessions set mode = ${mode} where id = ${sessionId}`;
}

export async function saveReflection(sessionId: string, reflection: unknown) {
  await sql`update sessions set reflection = ${sql.json(reflection as never)}, stage = 'done', ended_at = now() where id = ${sessionId}`;
}

export async function recentSessions(studentId: string, limit = 10) {
  return sql<{ id: string; topicName: string; stage: Stage; type: SessionKind; startedAt: Date }[]>`
    select s.id, t.name as topic_name, s.stage, s.type, s.started_at from sessions s join topics t on t.id = s.topic_id
    where s.student_id = ${studentId} order by s.started_at desc limit ${limit}`;
}

// ---- turns ------------------------------------------------------------------------

export type TurnRow = {
  seq: number;
  stage: Stage;
  speaker: string;
  text: string;
  confidence: "sure" | "unsure" | null;
  interrupted: boolean;
};

export async function addTurn(
  sessionId: string,
  t: { stage: Stage; speaker: string; text: string; confidence?: "sure" | "unsure" | null; interrupted?: boolean },
): Promise<number> {
  const [row] = await sql<{ seq: number }[]>`
    insert into session_turns (session_id, seq, stage, speaker, text, confidence, interrupted)
    values (${sessionId}, (select coalesce(max(seq), 0) + 1 from session_turns where session_id = ${sessionId}),
            ${t.stage}, ${t.speaker}, ${t.text}, ${t.confidence ?? null}, ${t.interrupted ?? false})
    returning seq`;
  return row.seq;
}

export async function listTurns(sessionId: string) {
  return sql<TurnRow[]>`select seq, stage, speaker, text, confidence, interrupted from session_turns where session_id = ${sessionId} order by seq`;
}

/** Sure/unsure tag on the learner's most recent turn. */
export async function tagLastLearnerTurn(sessionId: string, confidence: "sure" | "unsure") {
  await sql`
    update session_turns set confidence = ${confidence}
    where session_id = ${sessionId} and seq = (
      select max(seq) from session_turns where session_id = ${sessionId} and speaker = 'learner')`;
}

// ---- diagnostic -----------------------------------------------------------------------

export type ItemRow = {
  id: string;
  topicId: string;
  ordinal: number;
  level: Level;
  question: string;
  answerKey: string;
  chunkId: string | null;
  learnerAnswer: string | null;
  confidence: "sure" | "unsure" | null;
  score: number | null;
  rationale: string | null;
};

/** Commit: the answer key is stored with the question, before the learner sees it. */
export async function commitItem(
  sessionId: string,
  i: { topicId: string; level: Level; question: string; answerKey: string; chunkId: string | null },
) {
  const [row] = await sql<ItemRow[]>`
    insert into diagnostic_items (session_id, topic_id, ordinal, level, question, answer_key, chunk_id)
    values (${sessionId}, ${i.topicId}, (select coalesce(max(ordinal), 0) + 1 from diagnostic_items where session_id = ${sessionId}),
            ${i.level}, ${i.question}, ${i.answerKey}, ${i.chunkId})
    returning *`;
  return row;
}

export async function listItems(sessionId: string) {
  return sql<ItemRow[]>`select * from diagnostic_items where session_id = ${sessionId} order by ordinal`;
}

/** Records the answer and grade. The answer key column is never written here. */
export async function gradeItem(itemId: string, a: { answer: string; confidence: "sure" | "unsure" | null; score: number; rationale: string }) {
  await sql`
    update diagnostic_items set learner_answer = ${a.answer}, confidence = ${a.confidence}, score = ${a.score},
      rationale = ${a.rationale}, answered_at = now()
    where id = ${itemId} and score is null`;
}

// ---- planted mistake --------------------------------------------------------------------

export type MistakeRow = {
  id: string;
  persona: PersonaId;
  claim: string;
  correction: string;
  chunkId: string | null;
  spokenTurnSeq: number | null;
  caught: boolean | null;
  caughtTurnSeq: number | null;
  evidence: string | null;
};

export async function planMistake(sessionId: string, topicId: string, m: { persona: PersonaId; claim: string; correction: string; chunkId: string | null }) {
  const [row] = await sql<MistakeRow[]>`
    insert into planted_mistakes (session_id, topic_id, persona, claim, correction, chunk_id)
    values (${sessionId}, ${topicId}, ${m.persona}, ${m.claim}, ${m.correction}, ${m.chunkId})
    on conflict (session_id) do update set session_id = excluded.session_id
    returning *`;
  return row;
}

export async function getMistake(sessionId: string) {
  const [row] = await sql<MistakeRow[]>`select * from planted_mistakes where session_id = ${sessionId}`;
  return row ?? null;
}

export async function markMistakeSpoken(sessionId: string, seq: number) {
  await sql`update planted_mistakes set spoken_turn_seq = ${seq} where session_id = ${sessionId} and spoken_turn_seq is null`;
}

export async function markMistakeOutcome(sessionId: string, caught: boolean, seq: number | null, evidence: string | null) {
  await sql`
    update planted_mistakes set caught = ${caught}, caught_turn_seq = ${seq}, evidence = ${evidence}
    where session_id = ${sessionId} and caught is not true`;
}

// ---- evidence ---------------------------------------------------------------------------

export type ScoreInput = {
  studentId: string;
  topicId: string;
  sessionId: string;
  source: "diagnostic" | "teach" | "teach_back" | "practice";
  score: number;
  confidence?: "sure" | "unsure" | null;
  confidentWrong?: boolean;
  detail?: Record<string, unknown>;
};

export async function addTopicScore(s: ScoreInput) {
  await sql`
    insert into topic_scores (student_id, topic_id, session_id, source, score, confidence, confident_wrong, detail)
    values (${s.studentId}, ${s.topicId}, ${s.sessionId}, ${s.source}, ${Math.round(Math.max(0, Math.min(100, s.score)))},
            ${s.confidence ?? null}, ${s.confidentWrong ?? false}, ${sql.json((s.detail ?? {}) as never)})`;
}

export async function sessionScores(sessionId: string) {
  return sql<{ topicId: string; topicName: string; source: string; score: number; confidentWrong: boolean }[]>`
    select ts.topic_id, t.name as topic_name, ts.source, ts.score, ts.confident_wrong
    from topic_scores ts join topics t on t.id = ts.topic_id
    where ts.session_id = ${sessionId} order by ts.created_at`;
}

/** Recent evidence for readiness, newest first. */
export async function studentEvidence(studentId: string) {
  return sql<{ topicId: string; source: "diagnostic" | "teach" | "teach_back" | "practice"; score: number; confidentWrong: boolean; createdAt: Date }[]>`
    select topic_id, source, score, confident_wrong, created_at from topic_scores
    where student_id = ${studentId} and created_at > now() - interval '120 days'
    order by created_at desc`;
}
