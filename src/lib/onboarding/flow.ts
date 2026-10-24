// Conversational onboarding as a pure state machine: given the answers so far,
// what do we ask next, and how do we read the reply? No I/O here, so it is easy
// to test and the server stays the single source of truth for progress.
import { hintForMajor } from "./majors";
import { formatPhone, normalizePhone } from "@/lib/sms/phone";
import { smsConsentText } from "@/lib/sms/keywords";

export type GoalKind = "semester" | "licensing_exam" | "internship" | "gpa" | "clinicals" | "other";
export type GoalAnswer = { kind: GoalKind; label: string; target?: string };

export type Answers = {
  school?: string;
  major?: string;
  year?: string;
  goals?: GoalAnswer[];
  vision?: string;
  studyTime?: "morning" | "afternoon" | "night" | "mixed";
  sessionLength?: "short" | "long";
  textWindow?: { start: number; end: number };
  phone?: string | null; // null = student chose not to get texts
  smsConsent?: { granted: boolean; textShown: string };
};

type Parsed = { ok: true; patch: Partial<Answers> } | { ok: false, error: string };

export type Step = {
  id: string;
  question: (a: Answers) => string;
  chips?: (a: Answers) => string[];
  parse: (input: string, a: Answers) => Parsed;
  skip?: (a: Answers) => boolean;
};

const ok = (patch: Partial<Answers>): Parsed => ({ ok: true, patch });
const fail = (error: string): Parsed => ({ ok: false, error });

function required(field: "school" | "major" | "year", error: string) {
  return (input: string): Parsed => (input.trim().length >= 2 ? ok({ [field]: input.trim() }) : fail(error));
}

const YES = /^(y|yes|yeah|yep|sure|ok|okay|i agree|agree)\b/i;
const NO = /^(n|no|nope|no thanks|not now)\b/i;

export const STEPS: Step[] = [
  {
    id: "school",
    question: () => "Hi! I'll help you get ready for what's coming this semester. First, what school do you go to?",
    parse: required("school", "What's the name of your school?"),
  },
  {
    id: "major",
    question: () => "What's your major?",
    parse: required("major", "What's your major? (e.g. Nursing, Accounting, Computer Science)"),
  },
  {
    id: "year",
    question: () => "And what year are you in?",
    chips: () => ["Freshman", "Sophomore", "Junior", "Senior", "Grad student"],
    parse: required("year", "What year are you in?"),
  },
  {
    id: "goals",
    question: (a) => {
      const hint = hintForMajor(a.major);
      const bigger = [hint?.exam, hint?.career].filter(Boolean).join(" or ");
      return bigger
        ? `Is this just about this semester, or are you also working toward ${bigger}?`
        : "Is this just about this semester, or are you also working toward something bigger, like a licensing exam, grad-school test, or internship?";
    },
    chips: (a) => {
      const hint = hintForMajor(a.major);
      return [
        "Just this semester",
        hint?.exam ? `Also ${hint.exam.replace(/^the /, "")}` : "Also a licensing exam",
        hint?.career ? `Also ${hint.career.replace(/^an? /, "")}` : "Also an internship",
      ];
    },
    parse: (input, a) => ok({ goals: parseGoals(input, a.major) }),
  },
  {
    id: "vision",
    question: () =>
      "What does a good semester look like for you? A GPA target, landing an internship or externship, getting through clinicals… anything goes.",
    parse: (input, a) => {
      if (input.trim().length < 2) return fail("Tell me in a few words what a good semester looks like.");
      return ok({ vision: input.trim(), goals: mergeGoals(a.goals ?? [], parseVision(input)) });
    },
  },
  {
    id: "studyTime",
    question: () => "When do you study best?",
    chips: () => ["Mornings", "Afternoons", "Nights", "It varies"],
    parse: (input) => {
      const t = input.toLowerCase();
      if (/morning|early|\bam\b/.test(t)) return ok({ studyTime: "morning" });
      if (/afternoon|midday|lunch/.test(t)) return ok({ studyTime: "afternoon" });
      if (/night|evening|late|\bpm\b/.test(t)) return ok({ studyTime: "night" });
      if (/var|mix|depend|any|both/.test(t)) return ok({ studyTime: "mixed" });
      return fail("Mornings, afternoons, nights, or it varies?");
    },
  },
  {
    id: "sessionLength",
    question: () => "Do you prefer short bursts or long sessions?",
    chips: () => ["Short bursts (10–20 min)", "Long sessions (45+ min)"],
    parse: (input) => {
      const t = input.toLowerCase();
      if (/short|burst|quick|10|15|20/.test(t)) return ok({ sessionLength: "short" });
      if (/long|deep|45|hour|60/.test(t)) return ok({ sessionLength: "long" });
      return fail("Short bursts or long sessions?");
    },
  },
  {
    id: "textWindow",
    question: () => "When is it OK for me to text you? Give me a window, like “5pm–9pm”.",
    chips: () => ["5pm–9pm", "8am–11am", "12pm–9pm"],
    parse: (input) => {
      const w = parseHourRange(input);
      return w ? ok({ textWindow: w }) : fail("Try a time range like “6pm–10pm”.");
    },
  },
  {
    id: "phone",
    question: () => "What number should I text? (US numbers; type “skip” if you'd rather not get texts.)",
    parse: (input) => {
      if (/^\s*(skip|no|none|no thanks)\s*$/i.test(input)) return ok({ phone: null });
      const phone = normalizePhone(input);
      return phone ? ok({ phone }) : fail("That doesn't look like a phone number. Try something like (555) 123-4567, or type “skip”.");
    },
  },
  {
    id: "smsConsent",
    skip: (a) => !a.phone,
    question: (a) => `${consentTextFor(a)} Do you agree?`,
    chips: () => ["Yes, I agree", "No thanks"],
    parse: (input, a) => {
      const textShown = consentTextFor(a);
      if (YES.test(input.trim())) return ok({ smsConsent: { granted: true, textShown } });
      if (NO.test(input.trim())) return ok({ smsConsent: { granted: false, textShown } });
      return fail("Please answer yes or no. You can change this any time, and STOP always works.");
    },
  },
];

export function consentTextFor(a: Answers): string {
  const w = a.textWindow ? `between ${formatHour(a.textWindow.start)} and ${formatHour(a.textWindow.end)}` : "during your chosen hours";
  return smsConsentText(a.phone ? formatPhone(a.phone) : "your number", w);
}

export function nextStep(a: Answers): Step | null {
  for (const step of STEPS) {
    if (step.skip?.(a)) continue;
    if (!answered(step.id, a)) return step;
  }
  return null;
}

function answered(id: string, a: Answers): boolean {
  if (id === "phone") return a.phone !== undefined;
  return a[id as keyof Answers] !== undefined;
}

/** Applies one reply. Returns the updated answers, or an error to show the student. */
export function applyAnswer(a: Answers, input: string): { answers: Answers; error?: string } {
  const step = nextStep(a);
  if (!step) return { answers: a };
  const result = step.parse(input, a);
  if (!result.ok) return { answers: a, error: result.error };
  return { answers: { ...a, ...result.patch } };
}

/** Rebuilds the chat transcript (questions + replies) from stored answers. */
export function transcript(a: Answers, replies: Record<string, string>) {
  const lines: { from: "bot" | "me"; text: string }[] = [];
  let partial: Answers = {};
  for (const step of STEPS) {
    if (step.skip?.(partial)) continue;
    if (!answered(step.id, a)) break;
    lines.push({ from: "bot", text: step.question(partial) });
    if (replies[step.id]) lines.push({ from: "me", text: replies[step.id] });
    partial = { ...partial, [step.id]: a[step.id as keyof Answers] };
  }
  return lines;
}

// ---- parsers --------------------------------------------------------------

export function parseGoals(input: string, major?: string): GoalAnswer[] {
  const t = input.toLowerCase();
  const goals: GoalAnswer[] = [{ kind: "semester", label: "Do well this semester" }];
  const hint = hintForMajor(major);
  const examNamed = t.match(/\b(nclex|naplex|cpa|mcat|lsat|gre|gmat|fe exam|boards?)\b/);
  if (examNamed || /licens|exam|board|also|both/.test(t)) {
    const name = examNamed ? examNamed[1].toUpperCase() : hint?.exam?.replace(/^the /, "") ?? "licensing exam";
    if (!/just|only/.test(t) || examNamed) goals.push({ kind: "licensing_exam", label: `Prepare for ${name}`, target: name });
  }
  if (/intern|extern|co-?op|job|research/.test(t)) {
    goals.push({ kind: "internship", label: hint?.career ? `Land ${hint.career}` : "Land an internship" });
  }
  return goals;
}

export function parseVision(input: string): GoalAnswer[] {
  const t = input.toLowerCase();
  const goals: GoalAnswer[] = [];
  const gpa = t.match(/\b([0-4]\.\d{1,2})\b/);
  if (gpa) goals.push({ kind: "gpa", label: `GPA ${gpa[1]}+`, target: gpa[1] });
  if (/clinical/.test(t)) goals.push({ kind: "clinicals", label: "Do well in clinicals" });
  if (/intern|extern|co-?op/.test(t)) goals.push({ kind: "internship", label: /extern/.test(t) ? "Land an externship" : "Land an internship" });
  return goals;
}

function mergeGoals(existing: GoalAnswer[], extra: GoalAnswer[]): GoalAnswer[] {
  const out = [...existing];
  for (const g of extra) if (!out.some((e) => e.kind === g.kind)) out.push(g);
  return out;
}

/** "5pm-9pm", "5 to 9 pm", "17:00-21:00", "8am–11am" → local hours {start, end}. */
export function parseHourRange(input: string): { start: number; end: number } | null {
  const t = input.toLowerCase().replace(/\s+/g, " ").trim();
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return null;
  const endMer = m[6];
  const startMer = m[3] ?? (endMer && Number(m[1]) <= Number(m[4]) ? endMer : undefined);
  const start = to24(Number(m[1]), startMer);
  const end = to24(Number(m[4]), endMer);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

function to24(h: number, mer?: string): number | null {
  if (h > 24) return null;
  if (!mer) return h;
  if (h < 1 || h > 12) return null;
  if (mer === "am") return h === 12 ? 0 : h;
  return h === 12 ? 12 : h + 12;
}

export function formatHour(h: number): string {
  if (h === 0 || h === 24) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
