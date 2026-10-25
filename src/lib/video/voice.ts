// Narration with Gemini text-to-speech. Each scene becomes one WAV clip. Raw PCM
// responses are wrapped in a WAV header so every browser can play them.
import { GoogleGenAI, Modality } from "@google/genai";
import { env } from "@/lib/env";
import { geminiFailure, markModelDown, modelOrder } from "@/lib/llm/gemini";

export const ttsModels = () =>
  (process.env.TTS_MODEL ?? "gemini-3.8-flash-tts,gemini-3.8-flash-lite-tts,gemini-2.5-flash-preview-tts")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

export const VOICE = process.env.TTS_VOICE ?? "Kore";

export async function narrate(text: string): Promise<{ mime: string; audio: Buffer } | null> {
  if (!env.geminiApiKey) return null;
  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey, httpOptions: { timeout: 60_000 } });
  for (const model of modelOrder(ttsModels())) {
    try {
      const r = await ai.models.generateContent({
        model,
        contents: `Read aloud in a warm, clear, unhurried teaching voice:\n${text}`,
        config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
      });
      const part = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!part?.inlineData?.data) continue;
      const bytes = Buffer.from(part.inlineData.data, "base64");
      const mime = (part.inlineData.mimeType ?? "").toLowerCase();
      if (mime.includes("wav")) return { mime: "audio/wav", audio: bytes };
      const rate = Number(mime.match(/rate=(\d+)/)?.[1] ?? 24000);
      return { mime: "audio/wav", audio: pcmToWav(bytes, rate) };
    } catch (err) {
      const failure = geminiFailure(err);
      if (!failure) throw err;
      markModelDown(model, failure);
    }
  }
  return null;
}

/** 16-bit little-endian mono PCM → a playable WAV file. */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
