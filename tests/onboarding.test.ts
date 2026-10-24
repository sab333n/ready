import { describe, expect, it } from "vitest";
import { applyAnswer, nextStep, parseGoals, parseHourRange, transcript, type Answers } from "@/lib/onboarding/flow";

function run(replies: string[]) {
  let a: Answers = {};
  const errors: string[] = [];
  for (const r of replies) {
    const res = applyAnswer(a, r);
    if (res.error) errors.push(res.error);
    a = res.answers;
  }
  return { a, errors };
}

describe("onboarding flow", () => {
  it("walks the nursing persona from first question to done", () => {
    const { a, errors } = run([
      "Demo University",
      "Nursing",
      "Sophomore",
      "Also NCLEX",
      "Pass pharm with a 3.5 and land a summer externship",
      "Nights",
      "Short bursts (10–20 min)",
      "6pm-10pm",
      "(555) 201-3344",
      "Yes, I agree",
    ]);
    expect(errors).toEqual([]);
    expect(nextStep(a)).toBeNull();
    expect(a.goals?.map((g) => g.kind)).toEqual(["semester", "licensing_exam", "gpa", "internship"]);
    expect(a.goals?.find((g) => g.kind === "licensing_exam")?.target).toBe("NCLEX");
    expect(a.textWindow).toEqual({ start: 18, end: 22 });
    expect(a.phone).toBe("+15552013344");
    expect(a.smsConsent?.granted).toBe(true);
    expect(a.smsConsent?.textShown).toContain("STOP");
    expect(a.smsConsent?.textShown).toContain("(555) 201-3344");
  });

  it("asks about the major's licensing exam without assuming", () => {
    const q = nextStep({ school: "X", major: "Accounting", year: "Junior" })!;
    expect(q.id).toBe("goals");
    expect(q.question({ major: "Accounting" })).toMatch(/CPA exam/);
    expect(q.question({ major: "Art History" })).toMatch(/something bigger/);
  });

  it("re-asks on an answer it can't read and keeps progress", () => {
    const start: Answers = { school: "X", major: "Nursing", year: "Soph", goals: [], vision: "ok", studyTime: "night", sessionLength: "short" };
    const res = applyAnswer(start, "whenever lol");
    expect(res.error).toMatch(/time range/);
    expect(res.answers).toBe(start);
  });

  it("skips the consent question when the student skips texting", () => {
    const { a } = run(["State U", "Nursing", "Senior", "Just this semester", "Pass everything", "Mornings", "Long", "8am-11am", "skip"]);
    expect(a.phone).toBeNull();
    expect(nextStep(a)).toBeNull();
    expect(a.smsConsent).toBeUndefined();
  });

  it("requires an explicit yes or no for SMS consent", () => {
    const before = run(["State U", "Nursing", "Senior", "Just this semester", "Pass", "Mornings", "Long", "8am-11am", "5552013344"]).a;
    expect(applyAnswer(before, "maybe").error).toMatch(/yes or no/);
    expect(applyAnswer(before, "no thanks").answers.smsConsent?.granted).toBe(false);
  });

  it("rebuilds the transcript from stored answers", () => {
    const { a } = run(["Demo U", "Nursing"]);
    const lines = transcript(a, { school: "Demo U", major: "Nursing" });
    expect(lines.map((l) => l.from)).toEqual(["bot", "me", "bot", "me"]);
  });
});

describe("parsers", () => {
  it.each([
    ["5pm-9pm", { start: 17, end: 21 }],
    ["5 to 9 pm", { start: 17, end: 21 }],
    ["8am–11am", { start: 8, end: 11 }],
    ["17:00-21:00", { start: 17, end: 21 }],
    ["11am - 2pm", { start: 11, end: 14 }],
    ["12pm–9pm", { start: 12, end: 21 }],
  ])("reads %s", (input, expected) => {
    expect(parseHourRange(input)).toEqual(expected);
  });

  it("rejects backwards or empty windows", () => {
    expect(parseHourRange("9pm-5pm")).toBeNull();
    expect(parseHourRange("evenings")).toBeNull();
  });

  it("treats 'just this semester' as no exam", () => {
    expect(parseGoals("Just this semester", "Nursing").map((g) => g.kind)).toEqual(["semester"]);
    expect(parseGoals("also the nclex and an externship", "Nursing").map((g) => g.kind)).toEqual(["semester", "licensing_exam", "internship"]);
  });
});
