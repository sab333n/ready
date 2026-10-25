// Classroom extras adapted from Dasko: diagram requests, spoken language
// changes, and a short coaching line. Detection stays here so tests need no network.

export const CLASS_LANGUAGES = ["English", "Spanish", "French", "German", "Portuguese", "Hindi", "Arabic", "Simplified Chinese"] as const;
export type ClassLanguage = (typeof CLASS_LANGUAGES)[number];

const DIAGRAM_PATTERNS = [
  /\b(draw|sketch|make|create|generate)\s+(me\s+)?(a\s+)?(diagram|picture|image|drawing|sketch|chart|graph|flowchart|figure|illustration)\b/i,
  /\bshow\s+(me\s+)?(a\s+)?(diagram|picture|sketch|drawing|chart|graph|flowchart|figure|illustration)\b/i,
  /\bcan\s+you\s+(draw|sketch|make|create|generate)\b/i,
  /\b(put|write|draw)\s+(it|that|this)\s+on\s+(the\s+)?(board|whiteboard)\b/i,
  /\bvisuali[sz]e\s+(it|this|that)\b/i,
];

const DIAGRAM_COMPACT = ["drawdiagram", "drawadiagram", "sketchdiagram", "showmediagram", "onthewhiteboard", "ontheboard"];

/** True when the teacher explicitly asked for a picture, not "draw a conclusion". */
export function isDiagramRequest(text: string): boolean {
  if (DIAGRAM_PATTERNS.some((pattern) => pattern.test(text))) return true;
  const compact = text.replace(/\s+/g, "").toLowerCase();
  return DIAGRAM_COMPACT.some((phrase) => compact.includes(phrase));
}

export function diagramPrompt(topic: string, teacherText: string): string {
  return [
    `Generate an image: a quick, messy whiteboard doodle in black marker on white about "${topic}".`,
    `The teacher asked: "${teacherText.slice(0, 400)}"`,
    "Style: 3 to 5 short labels, big simple shapes, lots of white space, slightly crooked lines.",
    "No paragraphs, no bullet lists, and no deliberate mistakes.",
  ].join("\n");
}

const LANGUAGE_CUES: [RegExp, ClassLanguage][] = [
  [/vamos a hablar en español|en español|speak spanish|switch to spanish/i, "Spanish"],
  [/en français|parlons français|speak french|switch to french/i, "French"],
  [/auf deutsch|speak german|switch to german/i, "German"],
  [/em português|speak portuguese|switch to portuguese/i, "Portuguese"],
  [/हिंदी|speak hindi|switch to hindi/i, "Hindi"],
  [/بالعربي|speak arabic|switch to arabic/i, "Arabic"],
  [/用中文|现在我们用中文|简体|speak chinese|switch to chinese/i, "Simplified Chinese"],
  [/speak english|in english|back to english|switch to english/i, "English"],
];

/** A spoken request to change the class language, if this utterance contains one. */
export function languageCue(text: string): ClassLanguage | null {
  for (const [pattern, language] of LANGUAGE_CUES) if (pattern.test(text)) return language;
  return null;
}

export function languageNote(language: ClassLanguage): string {
  const script = language === "Simplified Chinese" ? " Use simplified characters only." : "";
  return `[The class language is now ${language}. From now on, speak only in ${language}.${script}]`;
}

/** One coaching line when the text model is off. */
export function coachFallback(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < 12) return "Add one concrete example before you move on.";
  if (!text.includes("?")) return "Pause and ask whether that landed.";
  return "Point at the board for the next step.";
}
