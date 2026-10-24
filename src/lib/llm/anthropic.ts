import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { LlmError, type GenerateObjectRequest, type LlmProvider } from "./types";

export function anthropicProvider(model: string): LlmProvider {
  const client = new Anthropic();
  return {
    name: `anthropic:${model}`,
    async generateObject<T extends z.ZodType>(req: GenerateObjectRequest<T>) {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [
        ...(req.images ?? []).map(
          (img): Anthropic.Beta.BetaImageBlockParam => ({
            type: "image",
            source: { type: "base64", media_type: img.mediaType, data: img.base64 },
          }),
        ),
        { type: "text", text: req.prompt },
      ];
      const response = await client.beta.messages.parse({
        model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages: [{ role: "user", content }],
        output_config: { effort: "low", format: betaZodOutputFormat(req.schema) },
        // If a safety classifier declines, the API retries on a suitable fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason === "refusal") throw new LlmError("The model declined to process this file.");
      if (response.stop_reason === "max_tokens") throw new LlmError("The file was too long to process in one pass.");
      if (response.parsed_output == null) throw new LlmError("The model returned output that didn't match the schema.");
      return response.parsed_output as z.infer<T>;
    },
  };
}
