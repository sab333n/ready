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

export function geminiProvider(model: string): LlmProvider {
  if (!env.geminiApiKey) throw new LlmError("Set GEMINI_API_KEY to use the Gemini reader.");
  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
  return {
    name: `gemini:${model}`,
    async generateObject<T extends z.ZodType>(req: GenerateObjectRequest<T>) {
      let response;
      try {
        response = await ai.models.generateContent({
          model,
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
      } catch (err) {
        const message = err instanceof Error ? err.message : "Gemini request failed.";
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
