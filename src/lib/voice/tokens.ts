// Mints short-lived Gemini Live tokens so the browser can talk to the voice
// API directly (Next.js route handlers can't hold WebSockets). Each token is
// locked to one persona's model, voice and instructions, and works once.
import { GoogleGenAI, Modality } from "@google/genai";
import { env } from "@/lib/env";
import { loadPrompt } from "@/lib/prompts";
import { PERSONAS, type PersonaId } from "@/lib/classroom/personas";

export type VoiceSeat = { persona: PersonaId; name: string; token: string; model: string; voice: string };

export const voiceEnabled = () => Boolean(env.geminiApiKey);

export function liveConfig(persona: PersonaId, topic: string, passages: string) {
  const p = PERSONAS[persona];
  const prompt = loadPrompt("live-student", 1, { name: p.name, topic, trait: p.trait, passages });
  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: p.voice } } },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 500, prefixPaddingMs: 200 } },
    systemInstruction: prompt.system,
  };
}

export async function mintVoiceSeats(personas: PersonaId[], topic: string, passages: string): Promise<VoiceSeat[]> {
  if (!env.geminiApiKey) throw new Error("Voice needs GEMINI_API_KEY. Text mode works without it.");
  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey, httpOptions: { apiVersion: "v1alpha" } });
  const expireTime = new Date(Date.now() + 30 * 60_000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 2 * 60_000).toISOString();
  return Promise.all(
    personas.map(async (persona) => {
      const token = await ai.authTokens.create({
        config: {
          uses: 1,
          expireTime,
          newSessionExpireTime,
          liveConnectConstraints: { model: env.voiceModel, config: liveConfig(persona, topic, passages) },
          lockAdditionalFields: [],
        },
      });
      if (!token.name) throw new Error("Gemini didn't return a voice token.");
      return { persona, name: PERSONAS[persona].name, token: token.name, model: env.voiceModel, voice: PERSONAS[persona].voice };
    }),
  );
}
