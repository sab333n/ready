import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { env } from "@/lib/env";
import { LlmError, type GenerateObjectRequest, type LlmProvider } from "./types";

const SCHEMA_KEYS = new Set([
  "$id",
  "$defs",
  "$ref",
  "$anchor",
  "type",
  "format",
  "title",
  "description",
  "enum",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
  "oneOf",
  "properties",
  "additionalProperties",
  "required",
  "propertyOrdering",
]);

/** Gemini accepts a subset of JSON Schema. Drop the rest, but keep property names. */
function geminiSchema(node: unknown, map = false): unknown {
  if (Array.isArray(node)) return node.map((item) => geminiSchema(item));
  if (!node || typeof node !== "object") return node;
  const source = node as Record<string, unknown>;
  if (map) {
    return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, geminiSchema(value)]));
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!SCHEMA_KEYS.has(key)) continue;
    out[key] = key === "properties" || key === "$defs" ? geminiSchema(value, true) : geminiSchema(value);
  }
  return out;
}

// Models that just failed are skipped for a while, so one exhausted quota doesn't
// slow every later call down with a doomed request.
const COOLDOWN_MS = { quota: 10 * 60_000, busy: 60_000, gone: 24 * 60 * 60_000 } as const;
const downUntil = new Map<string, number>();

type Failure = keyof typeof COOLDOWN_MS;

/** Why a Gemini call failed, when trying another model could help. */
export function geminiFailure(err: unknown): Failure | null {
  const status = (err as { status?: unknown })?.status;
  const text = err instanceof Error ? err.message : String(err);
  if (status === 429 || /RESOURCE_EXHAUSTED|"code":\s*429/.test(text)) return "quota";
  if (status === 500 || status === 503 || status === 504 || /UNAVAILABLE|DEADLINE_EXCEEDED|"code":\s*50[034]|timed? ?out|aborted/i.test(text)) return "busy";
  if (status === 404 || /NOT_FOUND|"code":\s*404/.test(text)) return "gone";
  return null;
}

/** Healthy models first, in configured order; cooling-down ones only as a last resort. */
export function modelOrder(models: string[], now = Date.now()): string[] {
  const unique = [...new Set(models)];
  const up = unique.filter((m) => (downUntil.get(m) ?? 0) <= now);
  return up.length ? up : unique;
}

export function markModelDown(model: string, failure: Failure, now = Date.now()) {
  downUntil.set(model, now + COOLDOWN_MS[failure]);
}

export function resetModelHealthForTesting() {
  downUntil.clear();
}

export function geminiProvider(model: string, fallbacks: string[] = []): LlmProvider {
  if (!env.geminiApiKey) throw new LlmError("Set GEMINI_API_KEY to use the Gemini reader.");
  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey, httpOptions: { timeout: 45_000 } });
  return {
    name: `gemini:${model}`,
    async generateObject<T extends z.ZodType>(req: GenerateObjectRequest<T>) {
      let response;
      let lastError: unknown;
      for (const candidate of modelOrder([model, ...fallbacks])) {
        try {
          response = await ai.models.generateContent({
            model: candidate,
            contents: [
              {
                role: "user",
                parts: [
                  ...(req.images ?? []).map((img) => ({ inlineData: { mimeType: img.mediaType, data: img.base64 } })),
                  { text: req.prompt },
                ],
              },
            ],
            config: {
              systemInstruction: req.system,
              responseMimeType: "application/json",
              responseJsonSchema: geminiSchema(req.schema.toJSONSchema()),
              maxOutputTokens: req.maxTokens ?? 8000,
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            },
          });
          break;
        } catch (err) {
          lastError = err;
          const failure = geminiFailure(err);
          if (!failure) break;
          markModelDown(candidate, failure);
        }
      }
      if (!response) {
        const message = lastError instanceof Error ? lastError.message : "Gemini request failed.";
        throw new LlmError(message.slice(0, 300));
      }
      const text = response.text;
      if (!text) throw new LlmError("Gemini returned no answer.");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new LlmError("Gemini returned output that wasn't JSON.");
      }
      const checked = req.schema.safeParse(parsed);
      if (!checked.success) throw new LlmError("Gemini returned output that didn't match the schema.");
      return checked.data;
    },
  };
}
