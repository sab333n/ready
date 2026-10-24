import { nextStep, transcript } from "@/lib/onboarding/flow";
import type { OnboardingState } from "@/lib/db/repo";

export type ChatView = {
  lines: { from: "bot" | "me"; text: string }[];
  chips: string[];
  done: boolean;
  error?: string;
};

export function viewFor(state: OnboardingState, error?: string): ChatView {
  const lines = transcript(state.answers, state.replies);
  const step = nextStep(state.answers);
  if (step) lines.push({ from: "bot", text: step.question(state.answers) });
  return { lines, chips: step?.chips?.(state.answers) ?? [], done: !step, error };
}
