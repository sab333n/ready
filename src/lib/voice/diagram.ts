import { GoogleGenAI, Modality } from "@google/genai";
import { env } from "@/lib/env";
import { diagramPrompt } from "./studio";

export const imageModel = () => process.env.IMAGE_MODEL ?? "gemini-2.5-flash-image";

/** A whiteboard doodle from the image model. The caller shows it and sends it to the live students. */
export async function generateDiagram(topic: string, teacherText: string): Promise<{ base64: string; mime: string }> {
  if (!env.geminiApiKey) throw new Error("Diagrams need GEMINI_API_KEY.");
  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
  const response = await ai.models.generateContent({
    model: imageModel(),
    contents: diagramPrompt(topic, teacherText),
    config: { responseModalities: [Modality.TEXT, Modality.IMAGE] },
  });
  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data) return { base64: part.inlineData.data, mime: part.inlineData.mimeType ?? "image/png" };
    }
  }
  throw new Error("The image model didn't return a diagram.");
}
