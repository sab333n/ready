import { describe, expect, it } from "vitest";
import { deadlineReadiness, deadlineTopics, topicReadiness, type Evidence } from "@/lib/readiness";

const NOW = new Date("2026-10-25T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 864e5);
const ev = (topicId: string, source: Evidence["source"], score: number, age = 0, confidentWrong = false): Evidence => ({
  topicId,
  source,
  score,
  confidentWrong,
  createdAt: daysAgo(age),
});

const topics = [
  { id: "pk", courseId: "pharm", name: "Pharmacokinetics and Pharmacodynamics", prerequisites: [] },
  { id: "htn", courseId: "pharm", name: "Antihypertensives", prerequisites: ["Pharmacokinetics and Pharmacodynamics"] },
  { id: "cardiac", courseId: "pharm", name: "Cardiac Drugs", prerequisites: ["Antihypertensives"] },
  { id: "anticoag", courseId: "pharm", name: "Anticoagulants", prerequisites: [] },
  { id: "resp", courseId: "pharm", name: "Respiratory Drugs", prerequisites: [] },
  { id: "ans", courseId: "pharm", name: "Autonomic Nervous System Drugs", prerequisites: [] },
];

describe("topic readiness", () => {
  it("is unmeasured without evidence", () => {
    expect(topicReadiness("pk", [], NOW)).toMatchObject({ level: "unmeasured", score: null });
  });

  it("weights recent teaching over an old diagnostic", () => {
    const r = topicReadiness("pk", [ev("pk", "diagnostic", 20, 30), ev("pk", "teach", 90, 1)], NOW);
    expect(r.level).toBe("ready");
    expect(r.score).toBeGreaterThanOrEqual(75);
  });

  it("marks a confident wrong answer as the riskiest state", () => {
    expect(topicReadiness("pk", [ev("pk", "teach", 80, 0, true)], NOW)).toMatchObject({ level: "getting_there", score: 70 });
    expect(topicReadiness("pk", [ev("pk", "diagnostic", 30)], NOW).level).toBe("not_ready");
  });
});

describe("which topics a deadline tests", () => {
  it("matches named topics and what they build on", () => {
    const names = (title: string, kind: "exam" | "quiz" = "exam") => deadlineTopics({ courseId: "pharm", title, kind }, topics).map((t) => t.id);
    expect(names("Exam 2: Cardiovascular Drugs")).toEqual(["htn", "cardiac"]);
    expect(names("Quiz 4: Anticoagulants", "quiz")).toEqual(["anticoag"]);
    expect(names("Quiz 3: Autonomic Drugs", "quiz")).toEqual(["ans"]);
    expect(names("Exam 3: Respiratory and GI Drugs")).toEqual(["resp"]);
  });

  it("treats an unnamed exam as the whole course, and ignores assignments", () => {
    expect(deadlineTopics({ courseId: "pharm", title: "Final Exam", kind: "exam" }, topics)).toHaveLength(topics.length);
    expect(deadlineTopics({ courseId: "pharm", title: "Pop quiz", kind: "quiz" }, topics)).toEqual([]);
    expect(deadlineTopics({ courseId: "pharm", title: "Drug Card Set 4 (Cardiac)", kind: "assignment" }, topics)).toEqual([]);
  });
});

describe("deadline readiness", () => {
  it("is as ready as its weakest topic and names what to teach next", () => {
    const covered = topics.filter((t) => t.id === "htn" || t.id === "cardiac");
    const byTopic = new Map([
      ["htn", topicReadiness("htn", [ev("htn", "teach", 90)], NOW)],
      ["cardiac", topicReadiness("cardiac", [ev("cardiac", "diagnostic", 20)], NOW)],
    ]);
    const r = deadlineReadiness(covered, byTopic)!;
    expect(r.level).toBe("not_ready");
    expect(r.next?.topicId).toBe("cardiac");
    expect(r.measured).toBe(2);
  });

  it("asks to measure before calling anything ready", () => {
    const covered = topics.filter((t) => t.id === "htn" || t.id === "cardiac");
    const byTopic = new Map([["htn", topicReadiness("htn", [ev("htn", "teach", 90)], NOW)]]);
    const r = deadlineReadiness(covered, byTopic)!;
    expect(r.level).toBe("unmeasured");
    expect(r.next?.topicId).toBe("cardiac");
  });

  it("has nothing to say about a deadline with no topics", () => {
    expect(deadlineReadiness([], new Map())).toBeNull();
  });
});
