import { z } from "zod";
import { getLlm } from "@/lib/llm";
import { loadPrompt } from "@/lib/prompts";

export type OutlineSection = { name: string; text: string };

const OutlineSchema = z.object({
  sections: z.array(z.object({ name: z.string(), text: z.string() })).min(4).max(6),
});

/** A specific outline when the model is on, otherwise a plain four-part scaffold that still names the topic. */
export async function generateOutline(topic: string): Promise<OutlineSection[]> {
  const llm = getLlm();
  if (!llm) return offlineOutline(topic);
  try {
    const prompt = loadPrompt("topic-outline", 1, { topic });
    const out = await llm.generateObject({ promptId: prompt.id, system: prompt.system, prompt: prompt.user, schema: OutlineSchema, maxTokens: 2500 });
    const sections = out.sections
      .map((section) => ({ name: section.name.trim().slice(0, 80), text: section.text.trim() }))
      .filter((section) => section.name && section.text);
    return sections.length >= 4 ? sections : offlineOutline(topic);
  } catch (err) {
    console.error("[lesson] topic outline failed, using offline scaffold", err);
    return offlineOutline(topic);
  }
}

export function offlineOutline(topic: string): OutlineSection[] {
  return [
    {
      name: `What ${topic} is`.slice(0, 80),
      text: `${topic} is defined by the thing it changes and the thing it leaves alone. Say what counts as ${topic} and what people confuse it with. A useful first sentence names that difference with a concrete case, not a dictionary line.`,
    },
    {
      name: `How ${topic} works`.slice(0, 80),
      text: `${topic} happens in a short sequence. Teach the order of the steps and what each step changes. Then say which step fails first when the usual conditions are missing.`,
    },
    {
      name: `Why ${topic} matters`.slice(0, 80),
      text: `The point of ${topic} is the outcome it produces. Describe that outcome, then what would be different if ${topic} did not happen. Use one real situation a student in this subject would recognize.`,
    },
    {
      name: `Checking ${topic}`.slice(0, 80),
      text: `A check for ${topic} is a case you can walk through. State the case, say what ${topic} predicts, and say what result would show the explanation is wrong.`,
    },
  ];
}

export function outlineDocument(topic: string, sections: OutlineSection[]): string {
  return [topic, ...sections.map((section) => `${section.name}\n${section.text}`)].join("\n\n");
}
