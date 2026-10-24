import { describe, expect, it } from "vitest";
import { normalizeFeedUrl, parseIcs, splitCourse } from "@/lib/calendar/ics";
import { demoIcs } from "../scripts/make-fixtures";

const NOW = new Date("2026-10-24T12:00:00Z");

describe("parseIcs", () => {
  const items = parseIcs(demoIcs(), NOW);

  it("reads Canvas assignments with course codes and skips lectures", () => {
    expect(items).toHaveLength(13);
    expect(items.some((i) => /lecture/i.test(i.title))).toBe(false);
    const exam = items.find((i) => i.title === "Exam 2: Cardiovascular Drugs")!;
    expect(exam.kind).toBe("exam");
    expect(exam.course).toEqual({ code: "PHARM201", displayCode: "PHARM 201", name: "Pharmacology" });
    expect(exam.dueAt.toISOString()).toBe("2026-10-29T14:00:00.000Z");
  });

  it("classifies quizzes and assignments and keeps all-day items", () => {
    expect(items.find((i) => i.title.startsWith("Quiz 4"))?.kind).toBe("quiz");
    expect(items.find((i) => i.title === "Care Plan 2")?.kind).toBe("assignment");
    expect(items.find((i) => i.title === "Drug Card Set 4 (Cardiac)")?.kind).toBe("assignment");
    expect(items.find((i) => i.title === "Head-to-Toe Assessment Video")?.kind).toBe("assignment");
    const allDay = items.find((i) => i.title === "Midterm Skills Check-off")!;
    expect(allDay.allDay).toBe(true);
    // Due 11:59pm on Nov 17 in the student's time zone (EST = UTC-5), not the server's.
    expect(allDay.dueAt.toISOString()).toBe("2026-11-18T04:59:00.000Z");
    expect(parseIcs(demoIcs(), NOW, "America/Los_Angeles").find((i) => i.allDay)!.dueAt.toISOString()).toBe("2026-11-18T07:59:00.000Z");
  });

  it("drops events far outside the semester window", () => {
    expect(parseIcs(demoIcs(), new Date("2028-01-01"))).toHaveLength(0);
  });
});

describe("splitCourse", () => {
  it("handles Moodle categories and code prefixes", () => {
    expect(splitCourse("Quiz 2 closes", ["NURS210"]).course?.code).toBe("NURS210");
    expect(splitCourse("ACCT-2101: Homework 5").course?.displayCode).toBe("ACCT 2101");
    expect(splitCourse("Homework 5").course).toBeNull();
  });
});

describe("normalizeFeedUrl", () => {
  it("turns webcal into https and blocks private addresses", () => {
    expect(normalizeFeedUrl("webcal://canvas.x.edu/feeds/abc.ics").toString()).toBe("https://canvas.x.edu/feeds/abc.ics");
    expect(() => normalizeFeedUrl("http://canvas.x.edu/a.ics")).toThrow(/https/);
    expect(() => normalizeFeedUrl("https://192.168.1.4/a.ics")).toThrow(/private/);
    expect(normalizeFeedUrl("http://localhost:3000/demo/demo-canvas.ics", true).hostname).toBe("localhost");
  });
});
