import type { z } from "zod";

export type LlmImage = { mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; base64: string };

export type GenerateObjectRequest<T extends z.ZodType> = {
  system: string;
  prompt: string;
  schema: T;
  images?: LlmImage[];
  maxTokens?: number;
};

// Every provider (Claude today, Gemini later) implements this one interface,
// so callers never import a vendor SDK directly.
export interface LlmProvider {
  name: string;
  generateObject<T extends z.ZodType>(req: GenerateObjectRequest<T>): Promise<z.infer<T>>;
}

export class LlmError extends Error {}
