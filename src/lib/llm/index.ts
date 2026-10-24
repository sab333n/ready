import { env } from "@/lib/env";
import { anthropicProvider } from "./anthropic";
import type { LlmProvider } from "./types";

export * from "./types";

let override: LlmProvider | null | undefined;

/** Returns the configured provider, or null when LLM features are off (LLM_PROVIDER=none). */
export function getLlm(): LlmProvider | null {
  if (override !== undefined) return override;
  if (env.llmProvider === "anthropic") return anthropicProvider(env.llmModel);
  return null;
}

/** Tests swap in a fake provider. */
export function setLlmForTesting(provider: LlmProvider | null | undefined) {
  override = provider;
}
