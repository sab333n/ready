// A lesson = one session on one topic: diagnostic → teach → teach-back → reflection.
// This module is the only place that orchestrates the steps; pages and server
// actions call it, and it calls the database and the AI layer.
import { contentHash, saveMaterial, saveTopics, type Student } from "@/lib/db/repo";
import * as db from "@/lib/db/lessons";
import { ensureChunks } from "@/lib/importers";
import { chunkText, distinctiveTerms, rankChunks, terms } from "@/lib/materials/chunks";
import { acyclicEdges, diagnosticStrands, teachingOrder } from "@/lib/learn/prereqs";
import { nextQuestion, startingPoint, strandResult, type Strand, type StrandResult } from "@/lib/diagnostic/engine";
import { asksForGradedWork, GRADED_WORK_REPLY, nextSpeaker } from "@/lib/classroom/director";
import { defaultPersonas, PERSONAS, TEACH_BACK_PERSONA, type PersonaId } from "@/lib/classroom/personas";
import { buildPrereqEdges, checkCatch, gradeAnswer, makeQuestion, personaLine, planTeachBackMistake, reflectOnTeaching, type Passage } from "./ai";
import { generateOutline, outlineDocument } from "./outline";

type Who = Pick<Student, "id" | "major">;

// ---- passages --------------------------------------------------------------------

export type TopicPassages = { passages: (Passage & { source: string })[]; fromNotes: boolean };

/**
 * The student's own material for a topic: the source of truth for questions,
 * AI students, and grading. Notes and slides come first; a syllabus line only
 * counts when nothing else mentions the topic.
 */
export async function topicPassages(studentId: string, topic: { name: string; courseId: string }, limit = 6): Promise<TopicPassages> {
  await ensureChunks(studentId);
  const all = await db.studentPassages(studentId);
  const content = all.filter((p) => p.kind !== "syllabus" && (p.courseId === topic.courseId || p.courseId === null));
  // A passage must mention what makes the topic specific: "drug" alone doesn't make notes about respiratory drugs.
  const key = distinctiveTerms(topic.name);
  const mentionsTopic = (text: string) => terms(text).some((t) => key.includes(t));
  let ranked = rankChunks(content, topic.name, limit).filter((p) => mentionsTopic(p.text));
  const fromNotes = ranked.length > 0;
  if (!fromNotes) ranked = rankChunks(all, topic.name, limit);
  return {
    fromNotes,
    passages: ranked.map((p) => ({ id: p.id, text: p.text, source: `${p.filename}${p.page ? ` p.${p.page}` : ""}` })),
  };
}

// ---- prerequisite map & topic list --------------------------------------------------

export async function ensurePrereqMap(studentId: string, course: { id: string; displayCode: string; name: string | null; prereqMapBuiltAt: Date | null }) {
  if (course.prereqMapBuiltAt) return;
  const topics = await db.courseTopics(studentId, course.id);
  const existing = await db.courseEdges(course.id);
  const proposed = await buildPrereqEdges([course.displayCode, course.name].filter(Boolean).join(" "), topics);
  // Edges already stored (e.g. from a syllabus read by the LLM) win over new proposals.
  const { kept } = acyclicEdges(
    topics.map((t) => t.id),
    [...existing, ...proposed],
  );
  const reasons = new Map(proposed.map((e) => [`${e.topic}>${e.prerequisite}`, e.reason]));
  await db.addPrereqEdges(
    course.id,
    kept.map((e) => ({ ...e, reason: reasons.get(`${e.topic}>${e.prerequisite}`) })),
  );
}

export async function learnOverview(student: Who) {
  await ensureChunks(student.id); // once, before the per-topic lookups below run in parallel
  const courses = await db.coursesWithTopics(student.id);
  const out = [];
  for (const course of courses) {
    await ensurePrereqMap(student.id, course);
    const topics = await db.courseTopics(student.id, course.id);
    const edges = await db.courseEdges(course.id);
    const names = new Map(topics.map((t) => [t.id, t.name]));
    const ordered = teachingOrder(topics, edges);
    const withSources = await Promise.all(
      ordered.map(async (t) => {
        const { passages, fromNotes } = await topicPassages(student.id, { name: t.name, courseId: course.id }, 3);
        return {
          ...t,
          builtOn: edges.filter((e) => e.topic === t.id).map((e) => names.get(e.prerequisite)!),
          hasNotes: fromNotes,
          passageCount: passages.length,
        };
      }),
    );
    out.push({
      course,
      topics: withSources,
      edges: edges.map((e) => ({ topic: e.topic, prerequisite: e.prerequisite })),
    });
  }
  return out;
}

// ---- starting a lesson ---------------------------------------------------------------

/** Writes study notes for a topic that has none, so a lesson does not wait on slides. */
export async function ensureStudyOutline(studentId: string, topic: { id: string; name: string; courseId: string }) {
  const existing = await topicPassages(studentId, topic, 1);
  if (existing.fromNotes) return false;
  const sections = await generateOutline(topic.name);
  const text = outlineDocument(topic.name, sections);
  const saved = await saveMaterial(studentId, {
    filename: `Outline — ${topic.name}.txt`,
    mime: "text/plain",
    kind: "notes",
    text,
    contentHash: contentHash(new TextEncoder().encode(`outline:${topic.id}:${text}`)),
    courseId: topic.courseId,
  });
  await db.saveChunks(studentId, saved.id, chunkText(text));
  const before = await db.courseTopics(studentId, topic.courseId);
  if (before.length < 3) {
    await saveTopics(
      studentId,
      topic.courseId,
      sections.map((section, index) => ({ name: section.name, prerequisites: index === 0 ? [] : [sections[index - 1].name] })),
      saved.id,
    );
    const after = await db.courseTopics(studentId, topic.courseId);
    const last = after.find((row) => row.name.toLowerCase() === sections.at(-1)!.name.toLowerCase());
    if (last && last.id !== topic.id) {
      await db.addPrereqEdges(topic.courseId, [{ topic: topic.id, prerequisite: last.id, reason: "Ready wrote this outline" }]);
    }
  }
  return true;
}

export async function startLesson(student: Who, topicId: string, opts: { withRolePlayer: boolean; skipDiagnostic?: boolean; kind?: db.SessionKind }) {
  const topic = await db.getTopic(student.id, topicId);
  if (!topic) throw new Error("Topic not found");
  // Picking a topic again picks up where the student left off.
  const open = await db.openSessionFor(student.id, topic.id, opts.kind ?? "teach");
  if (open) return open;
  await ensureStudyOutline(student.id, topic);
  const topics = await db.courseTopics(student.id, topic.courseId);
  const edges = await db.courseEdges(topic.courseId);
  const names = new Map(topics.map((t) => [t.id, t.name]));
  const kind = opts.kind ?? "teach";
  // Prerequisites first (deepest foundation first), then the topic itself.
  // Practice always probes. A skipped check goes straight to the classroom.
  // A prerequisite is only probed when there are notes to ask from; a syllabus line is not material.
  const prerequisites: Strand[] = [];
  if (!(opts.skipDiagnostic && kind === "teach")) {
    for (const id of diagnosticStrands(topic.id, edges)) {
      const prereq = { name: names.get(id)!, courseId: topic.courseId };
      if ((await topicPassages(student.id, prereq, 1)).fromNotes) prerequisites.push({ topicId: id, name: prereq.name });
    }
  }
  let strands: Strand[] = opts.skipDiagnostic && kind === "teach" ? [] : [...prerequisites, { topicId: topic.id, name: topic.name }];
  // A teaching session doesn't re-probe what was measured in the last few days; practice always asks.
  if (kind === "teach") {
    const recent = await db.recentlyMeasured(student.id, strands.map((s) => s.topicId));
    strands = strands.filter((s) => !recent.has(s.topicId));
  }
  const session = await db.createSession(student.id, topic.id, defaultPersonas(student.major, opts.withRolePlayer), strands, kind);
  if (session.stage === "teach") await openClassroom(session);
  // The first question is written here, not while the page renders.
  else await currentDiagnosticItem(session);
  return session;
}

async function openClassroom(session: db.SessionRow, start?: StrandResult | null) {
  const topic = (await db.getTopic(session.studentId, session.topicId))!;
  const list = session.personas.map((p) => PERSONAS[p].name);
  const names = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0];
  const advice = start && start.topicId !== session.topicId ? ` Your diagnostic suggests starting with ${start.name}, since ${topic.name} builds on it.` : "";
  const memory = await classroomMemory(session);
  const points = memory?.focus.map((f, i) => `(${i + 1}) ${f.replace(/[.\s]+$/, "")}`).join(" ");
  const recap = memory ? ` Last time (${memory.when}) you explained ${memory.score}% of the key points. The class will come back to what didn't land: ${points}.` : "";
  await db.addTurn(session.id, {
    stage: "teach",
    speaker: "system",
    text: `Teach ${names} about ${topic.name}. Explain it in your own words; they'll ask questions and push back. Tap Sure or Unsure after you explain a key point.${advice}${recap}`,
  });
}

/** What the class remembers from the last finished session on this topic: the points that didn't land. */
export async function classroomMemory(session: Pick<db.SessionRow, "id" | "studentId" | "topicId">) {
  const last = await db.lastReflection(session.studentId, session.topicId, session.id);
  if (!last) return null;
  const r = last.reflection as Reflection;
  const missed = r.keyPoints.filter((k) => k.verdict !== "correct").map((k) => k.point);
  const focus = [...(r.mistake && !r.mistake.caught ? [r.mistake.correction] : []), ...missed].slice(0, 2);
  if (focus.length === 0) return null;
  const days = Math.floor((Date.now() - new Date(last.endedAt).getTime()) / 864e5);
  return { focus, score: r.teachScore, when: days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago` };
}

// ---- diagnostic -----------------------------------------------------------------------

/** The question waiting for an answer, if any. Read-only, so pages can call it while rendering. */
export async function openDiagnosticItem(session: db.SessionRow) {
  return (await db.listItems(session.id)).find((i) => i.score === null) ?? null;
}

/** Returns the open question, creating (and committing) the next one if needed. Call from actions, not renders. */
export async function currentDiagnosticItem(session: db.SessionRow) {
  const items = await db.listItems(session.id);
  const open = items.find((i) => i.score === null);
  if (open) return open;
  const next = nextQuestion(session.strands, items);
  if (!next) return null;
  const topic = (await db.getTopic(session.studentId, next.strand.topicId))!;
  const { passages, fromNotes } = await topicPassages(session.studentId, topic);
  const asked = items.filter((i) => i.topicId === next.strand.topicId).map((i) => i.question);
  // Questions come from notes only. Syllabus policy lines ("all graded work must be your own") make nonsense questions.
  const q = await makeQuestion(next.strand.name, next.level, fromNotes ? passages : [], asked);
  if (!q) {
    // Nothing in the materials to ask from: record it as untested and move on.
    return db.commitItem(session.id, {
      topicId: next.strand.topicId,
      level: next.level,
      question: `Your materials don't cover ${next.strand.name} yet. In a sentence, what do you know about it?`,
      answerKey: "(no materials uploaded for this topic)",
      chunkId: null,
    });
  }
  return db.commitItem(session.id, { topicId: next.strand.topicId, level: next.level, question: q.question, answerKey: q.answerKey, chunkId: q.chunkId });
}

export async function answerDiagnostic(session: db.SessionRow, itemId: string, answer: string, confidence: "sure" | "unsure" | null) {
  const item = (await db.listItems(session.id)).find((i) => i.id === itemId);
  if (!item || item.score !== null) throw new Error("That question was already answered.");
  const [passage] = item.chunkId ? await db.passagesById(session.studentId, [item.chunkId]) : [];
  const grade = await gradeAnswer(item.question, item.answerKey, passage?.text ?? "", answer);
  await db.gradeItem(item.id, { answer, confidence, score: grade.score, rationale: grade.rationale });
  if (!nextQuestion(session.strands, await db.listItems(session.id))) await finishDiagnostic(session);
  else await currentDiagnosticItem(session);
  return { score: grade.score, rationale: grade.rationale, answerKey: item.answerKey, source: passage ? `${passage.filename}${passage.page ? ` p.${passage.page}` : ""}` : null };
}

export async function diagnosticResults(session: db.SessionRow) {
  const items = await db.listItems(session.id);
  const results = session.strands.map((s) => strandResult(s, items));
  return { results, start: startingPoint(results) };
}

async function finishDiagnostic(session: db.SessionRow) {
  const { results, start } = await diagnosticResults(session);
  const source = session.type === "practice" ? "practice" : "diagnostic";
  for (const r of results) {
    if (r.edge === "untested") continue;
    await db.addTopicScore({
      studentId: session.studentId,
      topicId: r.topicId,
      sessionId: session.id,
      source,
      score: r.score,
      confidentWrong: r.confidentWrong,
      detail: { edge: r.edge },
    });
  }
  if (session.type === "practice") {
    await db.setStage(session.id, "done");
    return;
  }
  await db.setStage(session.id, "teach");
  await openClassroom(session, start);
}

export async function skipDiagnostic(session: db.SessionRow) {
  if (session.stage !== "diagnostic") return;
  await db.setStage(session.id, "teach");
  await openClassroom(session);
}

// ---- classroom --------------------------------------------------------------------------

export type ClassroomReply = {
  /** Text mode: the persona's line, already saved. */
  line?: { speaker: PersonaId | "system"; text: string; seq: number };
  /** Voice mode: who should speak and the director note to give their voice session. */
  voice?: { speaker: PersonaId; note: string | null };
  caught?: boolean;
};

export async function learnerSays(session: db.SessionRow, text: string, confidence: "sure" | "unsure" | null): Promise<ClassroomReply> {
  if (session.stage !== "teach" && session.stage !== "teach_back") throw new Error("This session isn't in the classroom.");
  const clean = text.trim().slice(0, 2000);
  if (!clean) throw new Error("Say something first.");
  await db.addTurn(session.id, { stage: session.stage, speaker: "learner", text: clean, confidence });

  if (asksForGradedWork(clean)) {
    const seq = await db.addTurn(session.id, { stage: session.stage, speaker: "system", text: GRADED_WORK_REPLY });
    return { line: { speaker: "system", text: GRADED_WORK_REPLY, seq } };
  }

  const turns = await db.listTurns(session.id);
  let speaker = nextSpeaker(session.personas, turns, clean);
  let cue: string | null = null;
  let offlineText: string | undefined;
  let caught: boolean | undefined;

  if (session.stage === "teach" && turns.filter((t) => t.speaker === "learner").length === 1) {
    const memory = await classroomMemory(session);
    if (memory) offlineText = `Last time we never really got to this part. Can you explain it? "${memory.focus[0]}"`;
    if (memory) cue = `You were in this class last time. After reacting to what the teacher said, ask them to explain this, which they skipped or got wrong last time: "${memory.focus[0]}". Don't say it was wrong; just ask.`;
  }

  if (session.stage === "teach_back") {
    const outcome = await teachBackFollowUp(session, turns);
    if (outcome) {
      speaker = outcome.speaker;
      cue = outcome.cue;
      offlineText = outcome.offlineText;
      caught = outcome.caught;
    }
  }
  return respond(session, speaker, cue, turns, caught, offlineText);
}

async function respond(
  session: db.SessionRow,
  speaker: PersonaId,
  cue: string | null,
  turns: db.TurnRow[],
  caught?: boolean,
  offlineText?: string,
): Promise<ClassroomReply> {
  if (session.mode === "voice") return { voice: { speaker, note: cue }, caught };
  const topic = (await db.getTopic(session.studentId, session.topicId))!;
  const { passages } = await topicPassages(session.studentId, topic);
  const text = await personaLine({ speaker, personas: session.personas, topic: topic.name, passages, turns, cue: cue ?? undefined, offlineText });
  const seq = await db.addTurn(session.id, { stage: session.stage, speaker, text });
  return { line: { speaker, text, seq }, caught };
}

/** Voice mode: the browser reports what a voice student actually said. */
export async function personaSaid(session: db.SessionRow, persona: PersonaId, text: string, interrupted: boolean) {
  if (!session.personas.includes(persona) || !text.trim()) return;
  const seq = await db.addTurn(session.id, { stage: session.stage, speaker: persona, text: text.trim().slice(0, 2000), interrupted });
  const mistake = await db.getMistake(session.id);
  if (session.stage === "teach_back" && mistake && mistake.persona === persona && mistake.spokenTurnSeq === null) {
    await db.markMistakeSpoken(session.id, seq);
  }
}

export async function setMode(session: db.SessionRow, mode: "text" | "voice") {
  await db.setMode(session.id, mode);
}

// ---- teach-back ---------------------------------------------------------------------------

export async function beginTeachBack(session: db.SessionRow): Promise<ClassroomReply & { error?: string }> {
  if (session.stage !== "teach") throw new Error("Teach-back starts after teaching.");
  const topic = (await db.getTopic(session.studentId, session.topicId))!;
  const turns = await db.listTurns(session.id);
  const teaching = turns.filter((t) => t.speaker === "learner").map((t) => t.text).join("\n");
  const { passages, fromNotes } = await topicPassages(session.studentId, topic);
  if (!fromNotes) return { error: `Upload notes or slides on ${topic.name} first; teach-back needs them to check the facts.` };

  const persona = session.personas.includes(TEACH_BACK_PERSONA) ? TEACH_BACK_PERSONA : session.personas[0];
  const plan = await planTeachBackMistake(topic.name, teaching, passages);
  if (!plan) return { error: "Couldn't find a fact in your notes to build the teach-back from. Try adding more detailed notes." };

  // Planned and stored BEFORE it is spoken, so grading can't drift to what was said.
  await db.planMistake(session.id, topic.id, { persona, claim: plan.claim, correction: plan.correction, chunkId: plan.chunkId });
  await db.setStage(session.id, "teach_back");
  await db.addTurn(session.id, {
    stage: "teach_back",
    speaker: "system",
    text: `${PERSONAS[persona].name} will now explain it back to you, with one mistake hidden in it. Catch it and correct it.`,
  });

  if (session.mode === "voice") {
    return {
      voice: {
        speaker: persona,
        note: `Retell what the teacher taught in 2–3 sentences, in your own voice, with exactly this meaning: "${plan.summary}" Say the part "${plan.claim}" confidently, as if you believe it. Then ask if you got it right.`,
      },
    };
  }
  const seq = await db.addTurn(session.id, { stage: "teach_back", speaker: persona, text: plan.summary });
  await db.markMistakeSpoken(session.id, seq);
  return { line: { speaker: persona, text: plan.summary, seq } };
}

/** After the teach-back summary: did the learner catch it? Decides the next cue. */
async function teachBackFollowUp(session: db.SessionRow, turns: db.TurnRow[]) {
  const mistake = await db.getMistake(session.id);
  if (!mistake || mistake.spokenTurnSeq === null || mistake.caught !== null) return null;
  const replies = turns.filter((t) => t.speaker === "learner" && t.seq > mistake.spokenTurnSeq!);
  const verdict = await checkCatch(mistake.claim, mistake.correction, replies.map((r) => r.text));
  const persona = mistake.persona;

  if (verdict.caught) {
    const by = replies.find((r) => verdict.evidence && r.text.includes(verdict.evidence.slice(0, 30))) ?? replies.at(-1)!;
    await db.markMistakeOutcome(session.id, true, by.seq, verdict.evidence);
    await db.addTurn(session.id, { stage: "teach_back", speaker: "system", text: "You caught the mistake." });
    return {
      speaker: persona,
      caught: true,
      cue: `The teacher just correctly caught your mistake ("${mistake.claim}"). In one or two sentences, admit it genuinely and restate the correct idea: "${mistake.correction}"`,
      offlineText: `Oh, you're right, I mixed that up. ${mistake.correction}`,
    };
  }
  if (replies.length >= 2) {
    // Safety net: never leave a wrong idea standing. Recorded as missed.
    await db.markMistakeOutcome(session.id, false, null, null);
    await db.addTurn(session.id, { stage: "teach_back", speaker: "system", text: "The mistake slipped through. It's in your reflection." });
    return {
      speaker: persona,
      caught: false,
      cue: `Nobody corrected you, but you realize you said something wrong: "${mistake.claim}". Correct yourself out loud: "${mistake.correction}"`,
      offlineText: `Wait, actually I think I got something wrong. My notes say: ${mistake.correction}`,
    };
  }
  return {
    speaker: persona,
    caught: undefined,
    cue: "Ask the teacher whether everything in your summary was right. Don't hint at which part.",
    offlineText: "So did I get all of that right? Is anything in there off?",
  };
}

// ---- reflection --------------------------------------------------------------------------

export type Reflection = {
  topic: string;
  teachScore: number;
  keyPoints: {
    point: string;
    verdict: "correct" | "wrong" | "skipped";
    quote: string | null;
    note: string | null;
    source: string | null;
    confidence: "sure" | "unsure" | null;
    confidentWrong: boolean;
  }[];
  strengths: string[];
  improve: string[];
  confidentWrong: string[];
  mistake: { claim: string; correction: string; caught: boolean | null; evidence: string | null; source: string | null } | null;
  diagnostic: StrandResult[];
  usedLlm: boolean;
};

/**
 * Ends the lesson and writes evidence rows.
 *   teach score      = 100 × correct key points ÷ key points  (wrong and skipped count 0)
 *   teach-back score = 100 if the planted mistake was caught, 0 if it was missed
 * Phase 3 combines these with diagnostic scores and recency into readiness.
 */
export async function finishLesson(session: db.SessionRow): Promise<Reflection> {
  if (session.reflection) return session.reflection as Reflection;
  const topic = (await db.getTopic(session.studentId, session.topicId))!;
  const turns = await db.listTurns(session.id);
  const { passages } = await topicPassages(session.studentId, topic);
  const sourceOf = new Map((await db.passagesById(session.studentId, passages.map((p) => p.id))).map((p) => [p.id, `${p.filename}${p.page ? ` p.${p.page}` : ""}`]));

  const learnerTurns = turns.filter((t) => t.speaker === "learner");
  const out = await reflectOnTeaching(topic.name, passages, turns.filter((t) => t.stage === "teach" || t.stage === "teach_back"));
  const keyPoints = out.keyPoints.map((k) => {
    const confidence = k.turn ? learnerTurns.find((t) => t.seq === k.turn)?.confidence ?? null : null;
    return {
      point: k.point,
      verdict: k.verdict,
      quote: k.quote,
      note: k.note,
      source: k.chunkId ? sourceOf.get(k.chunkId) ?? null : null,
      confidence,
      confidentWrong: k.verdict === "wrong" && confidence === "sure",
    };
  });

  const items = await db.listItems(session.id);
  const confidentWrong = [
    ...keyPoints.filter((k) => k.confidentWrong).map((k) => k.point),
    ...items.filter((i) => i.confidence === "sure" && (i.score ?? 10) <= 3).map((i) => `Diagnostic: ${i.question}`),
  ];

  const total = Math.max(keyPoints.length, 1);
  const teachScore = Math.round((100 * keyPoints.filter((k) => k.verdict === "correct").length) / total);
  const mistakeRow = await db.getMistake(session.id);
  const mistakeSource = mistakeRow?.chunkId ? (await db.passagesById(session.studentId, [mistakeRow.chunkId]))[0] : undefined;

  if (learnerTurns.length > 0) {
    await db.addTopicScore({
      studentId: session.studentId,
      topicId: topic.id,
      sessionId: session.id,
      source: "teach",
      score: teachScore,
      confidentWrong: keyPoints.some((k) => k.confidentWrong),
      detail: { keyPoints: keyPoints.length, correct: keyPoints.filter((k) => k.verdict === "correct").length },
    });
  }
  if (mistakeRow?.spokenTurnSeq) {
    const caught = mistakeRow.caught === true;
    if (mistakeRow.caught === null) await db.markMistakeOutcome(session.id, false, null, null);
    await db.addTopicScore({
      studentId: session.studentId,
      topicId: topic.id,
      sessionId: session.id,
      source: "teach_back",
      score: caught ? 100 : 0,
      detail: { claim: mistakeRow.claim },
    });
  }

  const reflection: Reflection = {
    topic: topic.name,
    teachScore,
    keyPoints,
    strengths: out.strengths,
    improve: out.improve,
    confidentWrong,
    mistake: mistakeRow?.spokenTurnSeq
      ? {
          claim: mistakeRow.claim,
          correction: mistakeRow.correction,
          caught: mistakeRow.caught === true,
          evidence: mistakeRow.evidence,
          source: mistakeSource ? `${mistakeSource.filename}${mistakeSource.page ? ` p.${mistakeSource.page}` : ""}` : null,
        }
      : null,
    diagnostic: (await diagnosticResults(session)).results,
    usedLlm: out.usedLlm,
  };
  await db.saveReflection(session.id, reflection);
  return reflection;
}
