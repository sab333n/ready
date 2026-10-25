import { describe, expect, it } from "vitest";
import { classReport, makeJoinCode, type MemberData } from "@/lib/classes/report";

const NOW = new Date("2026-10-25T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 864e5);

function member(name: string, scores: Record<string, number | null>, opts: { wrong?: string; lastActive?: Date | null; exam?: boolean } = {}): MemberData {
  const names = ["Antihypertensives", "Cardiac Drugs", "Anticoagulants"];
  const topics = names.map((n, i) => ({ id: `${name}-${i}`, courseId: `${name}-c`, name: n, position: i, prerequisites: n === "Cardiac Drugs" ? ["Antihypertensives"] : [] }));
  return {
    studentId: name,
    name,
    lastActive: opts.lastActive === undefined ? days(-1) : opts.lastActive,
    topics,
    deadlines: opts.exam === false ? [] : [{ id: `${name}-e`, courseId: `${name}-c`, title: "Exam 2: Cardiovascular Drugs", kind: "exam", dueAt: days(4) }],
    evidence: topics
      .filter((t) => scores[t.name] != null)
      .map((t) => ({ topicId: t.id, source: "teach" as const, score: scores[t.name]!, confidentWrong: opts.wrong === t.name, createdAt: days(-2) })),
  };
}

describe("class report", () => {
  const members = [
    member("Ana", { Antihypertensives: 90, "Cardiac Drugs": 85 }),
    member("Ben", { Antihypertensives: 80, "Cardiac Drugs": 40 }, { wrong: "Cardiac Drugs" }),
    member("Cy", { Antihypertensives: 70 }, { lastActive: days(-9) }),
  ];
  const report = classReport(members, NOW);

  it("finds the shared next exam and counts readiness for it", () => {
    expect(report.exam).toMatchObject({ title: "Exam 2: Cardiovascular Drugs", counts: { ready: 1, not_ready: 1, unmeasured: 1, getting_there: 0 } });
  });

  it("orders columns by syllabus position and averages measured scores", () => {
    expect(report.topics.map((t) => t.name)).toEqual(["Antihypertensives", "Cardiac Drugs", "Anticoagulants"]);
    expect(report.topics[1]).toMatchObject({ measured: 2, average: 58, confidentWrong: 1, notReady: 1 });
    expect(report.topics[2]).toMatchObject({ measured: 0, average: null });
  });

  it("lists who is at risk, worst first, with reasons", () => {
    expect(report.atRisk.map((r) => r.name)).toEqual(["Ben", "Cy"]);
    expect(report.atRisk[0].reasons.join(" ")).toMatch(/Not ready for Exam 2.*Cardiac Drugs at 30/);
    expect(report.atRisk[0].reasons.join(" ")).toMatch(/Sure about something wrong in Cardiac Drugs/);
    expect(report.atRisk[1].reasons).toEqual(["Hasn't shown Cardiac Drugs yet, exam in 4 days", "No study in 9 days"]);
    expect(report.atRisk[1].teachNext).toBe("Cardiac Drugs");
  });

  it("has no exam when it isn't on enough calendars", () => {
    expect(classReport([member("Ana", {}, { exam: false })], NOW).exam).toBeNull();
  });
});

describe("join codes", () => {
  it("are readable and start with the course letters", () => {
    expect(makeJoinCode("PHARM 201", () => 0)).toBe("PHARM-AAAA");
    expect(makeJoinCode("201", () => 0.999)).toBe("CLASS-9999");
  });
});
