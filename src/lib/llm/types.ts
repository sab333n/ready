import type { z } from "zod";

export type LlmImage = { mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; base64: string };

export type GenerateObjectRequest<T extends z.ZodType> = {
  /** Which prompt produced this request (e.g. "grade-answer.v1"), for logs and test fakes. */
  promptId: string;
  system: string;
  prompt: string;
  schema: T;
  images?: LlmImage[];
  maxTokens?: number;
};

// Every provider (Gemini or Claude) implements this one interface,
// so callers never import a vendor SDK directly.
export interface LlmProvider {
  name: string;
  generateObject<T extends z.ZodType>(req: GenerateObjectRequest<T>): Promise<z.infer<T>>;
}

export class LlmError extends Error {}
