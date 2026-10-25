// Decides whether to text a student right now, and what to say. Pure, so the
// rules that protect students (consent, their hours, a daily cap, no repeats,
// snooze) are easy to test. The I/O lives in ./service.ts.
import type { DeadlineReadiness } from "@/lib/readiness";

export const DAILY_CAP = 2; // the consent text promises "up to 2 texts a day"
const REPEAT_HOURS = 20;
const LOOKAHEAD_DAYS = 7;

export type NudgeCandidate = {
  deadline: { id: string; title: string; kind: "exam" | "quiz" | "assignment" | "other"; dueAt: Date };
  readiness: DeadlineReadiness;
  topicId: string | null;
  topicName: string | null;
};

export type Channel = "push" | "sms";

export type NudgeContext = {
  now: Date;
  timezone: string;
  /** How this student can be reached right now, or null if they haven't turned reminders on. */
  channel: Channel | null;
  window: { start: number; end: number } | null;
  /** Outbound texts in the last 24 hours. */
  recent: { kind: string; deadlineId: string | null; topicId: string | null; at: Date }[];
  snoozedUntil: Date | null;
  candidates: NudgeCandidate[];
};

export type NudgePlan = { send: true; candidate: NudgeCandidate } | { send: false; reason: string };

export function planNudge(ctx: NudgeContext, opts: { ignoreWindow?: boolean; ignoreSnooze?: boolean } = {}): NudgePlan {
  if (!ctx.channel) return { send: false, reason: "Hasn't turned on reminders" };
  if (!opts.ignoreWindow && !inWindow(ctx.now, ctx.timezone, ctx.window)) return { send: false, reason: "Outside their texting hours" };
  if (!opts.ignoreSnooze && ctx.snoozedUntil && ctx.snoozedUntil > ctx.now) return { send: false, reason: "Snoozed" };
  const today = localDay(ctx.now, ctx.timezone);
  const sentToday = ctx.recent.filter((m) => localDay(m.at, ctx.timezone) === today).length;
  if (sentToday >= DAILY_CAP) return { send: false, reason: `Already texted ${DAILY_CAP} times today` };

  const repeatCutoff = ctx.now.getTime() - REPEAT_HOURS * 3600_000;
  const worth = ctx.candidates
    .filter((c) => c.deadline.dueAt > ctx.now && c.deadline.dueAt.getTime() - ctx.now.getTime() <= LOOKAHEAD_DAYS * 864e5)
    .filter((c) => worthATest(c, ctx.now))
    .sort((a, b) => a.deadline.dueAt.getTime() - b.deadline.dueAt.getTime());
  const due = worth.filter((c) => !ctx.recent.some((m) => m.deadlineId === c.deadline.id && m.topicId === c.topicId && m.at.getTime() > repeatCutoff));
  if (due[0]) return { send: true, candidate: due[0] };
  return { send: false, reason: worth[0] ? `Already texted about ${worth[0].topicName ?? "this"} today` : "Ready for everything this week" };
}

/** Not ready or unmeasured is worth a text all week; "getting there" only in the last two days. */
function worthATest(c: NudgeCandidate, now: Date) {
  if (!c.topicId) return false;
  const level = c.readiness.level;
  if (level === "not_ready" || level === "unmeasured") return true;
  return level === "getting_there" && c.deadline.dueAt.getTime() - now.getTime() <= 2 * 864e5;
}

export function nudgeText(c: NudgeCandidate, now: Date, timezone: string, link: string, from?: string): string {
  const what = shortTitle(c.deadline.title);
  const when = dayLabel(c.deadline.dueAt, now, timezone);
  const topic = c.topicName ?? "the weakest topic";
  const why =
    c.readiness.level === "not_ready"
      ? `${topic} didn't hold up when you taught it.`
      : c.readiness.level === "unmeasured"
        ? `You haven't taught ${topic} yet.`
        : `${topic} is close but not solid.`;
  const lead = from ? `${from} asked Ready to check in. ` : "Ready: ";
  return `${lead}${what} is ${when}. ${why} Teach it in 10 min: ${link} Reply LATER to snooze, STOP to opt out.`;
}

/** The same nudge as a phone notification: a short title, a body, and the buttons from the service worker. */
export function nudgePush(c: NudgeCandidate, now: Date, timezone: string, from?: string): { title: string; body: string } {
  const what = shortTitle(c.deadline.title);
  const when = dayLabel(c.deadline.dueAt, now, timezone);
  const topic = c.topicName ?? "the weakest topic";
  const why =
    c.readiness.level === "not_ready"
      ? `${topic} didn't hold up when you taught it.`
      : c.readiness.level === "unmeasured"
        ? `You haven't taught ${topic} yet.`
        : `${topic} is close but not solid.`;
  return { title: `${what} is ${when}`, body: `${from ? `${from} asked Ready to check in. ` : ""}${why} Teach it in 10 minutes.` };
}

export const YES_REPLY = (link: string, topic: string | null) => `Here you go${topic ? `: ${topic}` : ""}. ${link}`;
export const SNOOZE_REPLY = "Okay, no more nudges until tomorrow. Reply YES any time for a session link.";
export const UNKNOWN_REPLY = "Reply YES for a 10-minute session link, LATER to snooze until tomorrow, or STOP to opt out.";
export const NOTHING_DUE_REPLY = "Nothing urgent right now. You're on track for this week's tests. Open Ready any time to keep it fresh.";

export type InboundIntent = "yes" | "later" | "other";

export function inboundIntent(body: string): InboundIntent {
  const t = body.trim().toLowerCase().replace(/[.!]+$/, "");
  if (/^(y|yes|yeah|yep|ok|okay|sure|go|ready|link|send it)$/.test(t)) return "yes";
  if (/^(later|tomorrow|snooze|not now|busy|no)$/.test(t)) return "later";
  return "other";
}

export function inWindow(now: Date, timezone: string, window: { start: number; end: number } | null): boolean {
  if (!window) return false;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(now));
  return hour >= window.start && hour < window.end;
}

const localDay = (d: Date, timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d);

function dayLabel(due: Date, now: Date, timezone: string): string {
  const days = Math.round((Date.parse(localDay(due, timezone)) - Date.parse(localDay(now, timezone))) / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(due);
}

/** "Exam 2: Cardiovascular Drugs" stays; very long titles are cut so the text fits one or two segments. */
function shortTitle(title: string) {
  return title.length > 48 ? `${title.slice(0, title.lastIndexOf(" ", 46))}…` : title;
}
