// The lesson script: scenes of on-screen points plus narration. Written by the
// LLM when it is on, otherwise built from the offline outline so a video still works.
import { z } from "zod";
import { getLlm } from "@/lib/llm";
import { loadPrompt } from "@/lib/prompts";
import { offlineOutline } from "@/lib/lesson/outline";

export type Scene = { title: string; points: string[]; narration: string };
export type VideoScript = { title: string; scenes: Scene[]; usedLlm: boolean };

const ScriptSchema = z.object({
  title: z.string(),
  scenes: z
    .array(z.object({ title: z.string(), points: z.array(z.string()).min(1).max(4), narration: z.string() }))
    .min(3)
    .max(7),
});

export async function writeVideoScript(args: { course: string; topic: string; focus: string | null; confidentWrong: number }): Promise<VideoScript> {
  const llm = getLlm();
  if (llm) {
    try {
      const misconception =
        args.confidentWrong > 0
          ? `${args.confidentWrong} students in this class were confident about something wrong here, so name the most common misconception about "${args.topic}" and correct it.`
          : `Name the most common misconception about "${args.topic}" and correct it.`;
      const p = loadPrompt("lesson-video", 1, { course: args.course, topic: args.topic, focus: args.focus?.trim() || "(none)", misconception });
      const out = await llm.generateObject({ promptId: p.id, system: p.system, prompt: p.user, schema: ScriptSchema, maxTokens: 4000 });
      const scenes = out.scenes.map(clean).filter((s) => s.title && s.narration);
      if (scenes.length >= 3) return { title: out.title.trim().slice(0, 80) || args.topic, scenes, usedLlm: true };
    } catch (err) {
      console.error("[video] script failed, using the offline outline", err);
    }
  }
  return offlineScript(args.topic);
}

function clean(s: Scene): Scene {
  return {
    title: s.title.trim().slice(0, 60),
    points: s.points.map((p) => p.trim().slice(0, 80)).filter(Boolean).slice(0, 3),
    narration: s.narration.replace(/[*_#`]/g, "").replace(/\s+/g, " ").trim().slice(0, 600),
  };
}

export function offlineScript(topic: string): VideoScript {
  const sections = offlineOutline(topic);
  const scenes: Scene[] = sections.map((section) => ({
    title: section.name,
    points: section.text.split(/(?<=\.)\s+/).slice(0, 2).map((s) => s.replace(/\.$/, "")),
    narration: section.text,
  }));
  scenes.push({
    title: "Now teach it back",
    points: [`Explain ${topic} in your own words`, "Maya and Jordan will ask questions"],
    narration: `Now it's your turn. Open Ready and explain ${topic} to the AI students in your own words. That's how you'll know it holds up.`,
  });
  return { title: topic, scenes, usedLlm: false };
}
