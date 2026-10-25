// Decides who speaks next. The same rules run in text and voice mode, so the
// conversation behaves the same whichever way the student teaches.
import { PERSONAS, type PersonaId } from "./personas";

export type TurnLite = { speaker: string; text: string };

export function nextSpeaker(personas: PersonaId[], turns: TurnLite[], learnerText: string): PersonaId {
  // 1. Called on by name → that student answers.
  const lower = learnerText.toLowerCase();
  const named = personas.find((id) => {
    const first = PERSONAS[id].name.toLowerCase().replace(/^mr\.\s*/, "");
    return new RegExp(`\\b${first}\\b`).test(lower) || (id === "patient" && /\bpatient\b/.test(lower));
  });
  if (named) return named;

  const aiTurns = turns.filter((t) => t.speaker !== "learner" && t.speaker !== "system");
  const last = aiTurns.at(-1)?.speaker;

  // 2. A causal claim invites the skeptic; jargon-heavy or long turns invite the beginner.
  const claims = /\b(because|so that|which means|therefore|causes?|leads? to|results? in)\b/i.test(learnerText);
  const dense = learnerText.split(/\s+/).length > 45 || (learnerText.match(/\b[a-z]{12,}\b/gi)?.length ?? 0) >= 2;
  const preferred: PersonaId | undefined =
    claims && personas.includes("jordan") ? "jordan" : dense && personas.includes("maya") ? "maya" : undefined;
  if (preferred && preferred !== last) return preferred;

  // 3. Otherwise rotate so nobody dominates.
  const idx = last ? personas.indexOf(last as PersonaId) : -1;
  return personas[(idx + 1) % personas.length];
}

/** The learner asking the class to do graded work. We refuse and redirect to teaching. */
export function asksForGradedWork(text: string): boolean {
  return /\b(do|solve|answer|finish|complete|write)\b.{0,40}\b(my|the|this)\b.{0,30}\b(homework|hw|assignment|quiz|exam|test|problem set|pearson|mastering|lab report|care plan)\b/i.test(
    text,
  ) || /\b(give|tell|send)\b.{0,20}\b(me )?\b(the )?answers?\b.{0,30}\b(homework|hw|assignment|quiz|exam|test|pearson)\b/i.test(text);
}

export const GRADED_WORK_REPLY =
  "I can't help with graded work, but I can help you learn it. Pick the idea behind that question and teach it to Maya and Jordan; once you can explain it, the assignment gets much easier.";
