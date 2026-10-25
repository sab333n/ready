import { describe, expect, it } from "vitest";
import { inboundIntent, inWindow, nudgePush, nudgeText, planNudge, type NudgeCandidate, type NudgeContext } from "@/lib/sms/nudge";

// Sunday Oct 25, 2026, 6pm in Chicago.
const NOW = new Date("2026-10-25T23:00:00Z");
const TZ = "America/Chicago";
const days = (n: number) => new Date(NOW.getTime() + n * 864e5);

const candidate = (id: string, dueIn: number, level: NudgeCandidate["readiness"]["level"], topic = "Antihypertensives"): NudgeCandidate => ({
  deadline: { id, title: `Exam ${id}`, kind: "exam", dueAt: days(dueIn) },
  readiness: { level, topics: [], measured: 0, next: null },
  topicId: `t-${topic}`,
  topicName: topic,
});

const ctx = (over: Partial<NudgeContext> = {}): NudgeContext => ({
  now: NOW,
  timezone: TZ,
  channel: "sms",
  window: { start: 17, end: 21 },
  recent: [],
  snoozedUntil: null,
  candidates: [candidate("3", 9, "not_ready"), candidate("2", 4, "not_ready"), candidate("1", 2, "ready")],
  ...over,
});

describe("when Ready texts", () => {
  it("picks the soonest test that isn't ready", () => {
    const plan = planNudge(ctx());
    expect(plan.send && plan.candidate.deadline.id).toBe("2");
  });

  it("never nudges without a way to reach them, or outside their hours", () => {
    expect(planNudge(ctx({ channel: null }))).toEqual({ send: false, reason: "Hasn't turned on reminders" });
    expect(planNudge(ctx({ window: { start: 8, end: 11 } }))).toEqual({ send: false, reason: "Outside their texting hours" });
    expect(planNudge(ctx({ window: { start: 8, end: 11 } }), { ignoreWindow: true }).send).toBe(true);
  });

  it("caps at two a day, skips repeats, and honors snooze", () => {
    const texted = { kind: "nudge", deadlineId: "x", topicId: "y", at: new Date(NOW.getTime() - 3600_000) };
    expect(planNudge(ctx({ recent: [texted, texted] })).send).toBe(false);
    const sameTopic = { kind: "nudge", deadlineId: "2", topicId: "t-Antihypertensives", at: new Date(NOW.getTime() - 3600_000) };
    expect(planNudge(ctx({ recent: [sameTopic], candidates: [candidate("2", 4, "not_ready")] }))).toEqual({ send: false, reason: "Already texted about Antihypertensives today" });
    expect(planNudge(ctx({ snoozedUntil: days(0.5) }))).toEqual({ send: false, reason: "Snoozed" });
  });

  it("only nudges 'getting there' in the last two days", () => {
    expect(planNudge(ctx({ candidates: [candidate("a", 5, "getting_there")] })).send).toBe(false);
    expect(planNudge(ctx({ candidates: [candidate("a", 1.5, "getting_there")] })).send).toBe(true);
  });

  it("checks the hour in the student's own time zone", () => {
    expect(inWindow(NOW, TZ, { start: 17, end: 21 })).toBe(true);
    expect(inWindow(NOW, "America/New_York", { start: 17, end: 19 })).toBe(false); // 7pm there
  });
});

describe("the text itself", () => {
  it("names the test, the day, the topic, and how to opt out", () => {
    const text = nudgeText(candidate("2", 4, "not_ready"), NOW, TZ, "https://ready.test/t/abc");
    expect(text).toBe(
      "Ready: Exam 2 is Thursday. Antihypertensives didn't hold up when you taught it. Teach it in 10 min: https://ready.test/t/abc Reply LATER to snooze, STOP to opt out.",
    );
    expect(nudgeText(candidate("2", 1, "unmeasured"), NOW, TZ, "L", "Dr. Rivera")).toMatch(/^Dr\. Rivera asked Ready to check in\. Exam 2 is tomorrow\. You haven't taught/);
  });

  it("fits a phone notification", () => {
    expect(nudgePush(candidate("2", 4, "not_ready"), NOW, TZ)).toEqual({
      title: "Exam 2 is Thursday",
      body: "Antihypertensives didn't hold up when you taught it. Teach it in 10 minutes.",
    });
  });

  it("reads replies", () => {
    expect(inboundIntent("Yes!")).toBe("yes");
    expect(inboundIntent("ok")).toBe("yes");
    expect(inboundIntent("later")).toBe("later");
    expect(inboundIntent("what is this")).toBe("other");
  });
});
