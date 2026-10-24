"use server";

import { applyAnswer, nextStep } from "@/lib/onboarding/flow";
import { completeOnboarding, onboardingState, saveOnboardingState, type OnboardingState } from "@/lib/db/repo";
import { currentStudent } from "@/lib/auth/session";
import { viewFor, type ChatView } from "./view";

export async function sendAnswer(input: string): Promise<ChatView> {
  const student = await currentStudent();
  if (!student) throw new Error("Not signed in");
  const state = onboardingState(student);
  const step = nextStep(state.answers);
  if (!step) return viewFor(state);

  const text = input.slice(0, 500);
  const { answers, error } = applyAnswer(state.answers, text);
  if (error) return viewFor(state, error);

  const next: OnboardingState = { answers, replies: { ...state.replies, [step.id]: text } };
  await saveOnboardingState(student.id, next);
  if (!nextStep(answers)) await completeOnboarding(student.id, answers);
  return viewFor(next);
}

/** Lets the student change an answer: forget everything from that step on. */
export async function restartOnboarding(): Promise<ChatView> {
  const student = await currentStudent();
  if (!student) throw new Error("Not signed in");
  const fresh: OnboardingState = { answers: {}, replies: {} };
  await saveOnboardingState(student.id, fresh);
  return viewFor(fresh);
}
