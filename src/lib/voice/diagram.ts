import { GoogleGenAI, Modality } from "@google/genai";
import { env } from "@/lib/env";
import { geminiFailure, markModelDown, modelOrder } from "@/lib/llm/gemini";
import { diagramPrompt } from "./studio";

export const imageModels = () =>
  (process.env.IMAGE_MODEL ?? "gemini-3.1-flash-image,gemini-2.5-flash-image")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

/** A whiteboard doodle from the image model. The caller shows it and sends it to the live students. */
export async function generateDiagram(topic: string, teacherText: string): Promise<{ base64: string; mime: string }> {
  if (!env.geminiApiKey) throw new Error("Diagrams need GEMINI_API_KEY.");
  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey, httpOptions: { timeout: 60_000 } });
  let quota = false;
  for (const model of modelOrder(imageModels())) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: diagramPrompt(topic, teacherText),
        config: { responseModalities: [Modality.TEXT, Modality.IMAGE] },
      });
      for (const candidate of response.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.inlineData?.data) return { base64: part.inlineData.data, mime: part.inlineData.mimeType ?? "image/png" };
        }
      }
    } catch (err) {
      const failure = geminiFailure(err);
      if (!failure) throw err;
      quota ||= failure === "quota";
      markModelDown(model, failure);
    }
  }
  throw new Error(quota ? "Diagrams are out of quota on this Gemini key. Keep explaining out loud." : "The image model didn't return a diagram.");
}
