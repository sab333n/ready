"use server";

import { redirect } from "next/navigation";
import { currentStudent } from "@/lib/auth/session";
import * as db from "@/lib/db/lessons";
import * as lesson from "@/lib/lesson/service";
import { isPersonaId, type PersonaId } from "@/lib/classroom/personas";
import { z } from "zod";
import { getLlm } from "@/lib/llm";
import { loadPrompt } from "@/lib/prompts";
import { generateDiagram } from "@/lib/voice/diagram";
import { coachFallback } from "@/lib/voice/studio";
import { mintVoiceSeats, type VoiceSeat } from "@/lib/voice/tokens";
import { pickTopic } from "@/lib/learn/match";
import { ensureNamedTopic } from "@/lib/db/repo";
import { lessonView, type LessonView } from "./view";

type Confidence = "sure" | "unsure" | null;
export type ActionResult = { view: LessonView; voice?: { speaker: PersonaId; note: string | null }; error?: string };

async function load(sessionId: string) {
  const student = await currentStudent();
  if (!student) throw new Error("Please sign in again.");
  const session = await db.getSession(student.id, sessionId);
  if (!session) throw new Error("Session not found.");
  return { student, session };
}

const fresh = async (sessionId: string) => (await load(sessionId)).session;
const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

export async function startLessonAction(form: FormData) {
  const student = await currentStudent();
  if (!student) redirect("/");
  const session = await lesson.startLesson(student, String(form.get("topicId")), {
    withRolePlayer: form.get("rolePlayer") === "on",
    skipDiagnostic: form.get("skipDiagnostic") === "on",
    kind: form.get("kind") === "practice" ? "practice" : "teach",
  });
  redirect(`/session/${session.id}`);
}

/** Starts a teaching or practice session from the words typed on the graph. */
export async function startGoalAction(form: FormData) {
  const student = await currentStudent();
  if (!student) redirect("/");
  const goal = String(form.get("goal") ?? "").trim().slice(0, 200);
  const kind = form.get("kind") === "practice" ? "practice" : "teach";
  const back = kind === "practice" ? "/learn?mode=practice" : "/learn";
  if (!goal) redirect(back);
  const overview = await lesson.learnOverview(student);
  const topics = overview.flatMap((c) => c.topics.map((t) => ({ id: t.id, name: t.name, hasNotes: t.hasNotes })));
  const match = pickTopic(goal, topics);
  // A name that is not on the map becomes its own topic, so "calculus" can start without a syllabus.
  const topicId = match?.id ?? (await ensureNamedTopic(student.id, goal)).id;
  const session = await lesson.startLesson(student, topicId, { withRolePlayer: /nurs|pharm|health/i.test(student.major ?? ""), kind });
  redirect(`/session/${session.id}`);
}

export async function answerDiagnosticAction(sessionId: string, itemId: string, answer: string, confidence: Confidence): Promise<ActionResult> {
  const { session } = await load(sessionId);
  try {
    await lesson.answerDiagnostic(session, itemId, answer.slice(0, 2000), confidence);
  } catch (err) {
    return { view: await lessonView(session), error: message(err) };
  }
  return { view: await lessonView(await fresh(sessionId)) };
}

export async function skipDiagnosticAction(sessionId: string): Promise<ActionResult> {
  const { session } = await load(sessionId);
  await lesson.skipDiagnostic(session);
  return { view: await lessonView(await fresh(sessionId)) };
}

export async function sayAction(sessionId: string, text: string, confidence: Confidence): Promise<ActionResult> {
  const { session } = await load(sessionId);
  try {
    const reply = await lesson.learnerSays(session, text, confidence);
    return { view: await lessonView(await fresh(sessionId)), voice: reply.voice };
  } catch (err) {
    return { view: await lessonView(session), error: message(err) };
  }
}

export async function tagConfidenceAction(sessionId: string, confidence: "sure" | "unsure"): Promise<ActionResult> {
  const { session } = await load(sessionId);
  await db.tagLastLearnerTurn(session.id, confidence);
  return { view: await lessonView(session) };
}

export async function teachBackAction(sessionId: string): Promise<ActionResult> {
  const { session } = await load(sessionId);
  try {
    const r = await lesson.beginTeachBack(session);
    return { view: await lessonView(await fresh(sessionId)), voice: r.voice, error: r.error };
  } catch (err) {
    return { view: await lessonView(session), error: message(err) };
  }
}

export async function setModeAction(sessionId: string, mode: "text" | "voice"): Promise<ActionResult> {
  const { session } = await load(sessionId);
  await lesson.setMode(session, mode);
  return { view: await lessonView(await fresh(sessionId)) };
}

/** Voice mode: short-lived tokens, one per AI student. */
export async function voiceSeatsAction(sessionId: string): Promise<{ seats?: VoiceSeat[]; error?: string }> {
  const { session } = await load(sessionId);
  try {
    const topic = (await db.getTopic(session.studentId, session.topicId))!;
    const { passages } = await lesson.topicPassages(session.studentId, topic);
    return { seats: await mintVoiceSeats(session.personas, topic.name, passages.map((p) => p.text).join("\n\n")) };
  } catch (err) {
    return { error: message(err) };
  }
}

const Tip = z.object({ tip: z.string() });

/** One coaching sentence from what the learner just taught. */
export async function coachTipAction(sessionId: string, teacherText: string): Promise<{ tip: string }> {
  const { session } = await load(sessionId);
  const fallback = coachFallback(teacherText);
  const llm = getLlm();
  if (!llm) return { tip: fallback };
  try {
    const topic = await db.getTopic(session.studentId, session.topicId);
    const prompt = loadPrompt("coach-tip", 1, { topic: topic?.name ?? "the topic", text: teacherText.slice(0, 600) });
    const out = await llm.generateObject({ promptId: prompt.id, system: prompt.system, prompt: prompt.user, schema: Tip, maxTokens: 200 });
    return { tip: out.tip.trim() || fallback };
  } catch {
    return { tip: fallback };
  }
}

/** Draws the diagram the teacher asked for. The browser shows it and sends it to the live students. */
export async function drawDiagramAction(sessionId: string, teacherText: string): Promise<{ base64?: string; mime?: string; error?: string }> {
  const { session } = await load(sessionId);
  try {
    const topic = await db.getTopic(session.studentId, session.topicId);
    return await generateDiagram(topic?.name ?? "the topic", teacherText);
  } catch (err) {
    return { error: message(err) };
  }
}

export async function personaSaidAction(sessionId: string, persona: string, text: string, interrupted: boolean): Promise<ActionResult> {
  const { session } = await load(sessionId);
  if (isPersonaId(persona)) await lesson.personaSaid(session, persona, text, interrupted);
  return { view: await lessonView(await fresh(sessionId)) };
}

export async function finishAction(sessionId: string) {
  const { session } = await load(sessionId);
  await lesson.finishLesson(session);
  redirect(`/session/${sessionId}`);
}
