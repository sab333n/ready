import { describe, expect, it } from "vitest";
import { inferYear, heuristicExtract } from "@/lib/materials/heuristic";
import { pdfToText } from "@/lib/materials/extract";
import { syllabusPdf } from "../scripts/make-fixtures";

describe("offline syllabus reader", () => {
  it("pulls course, deadlines and topics out of the sample PDF", async () => {
    const text = await pdfToText(await syllabusPdf());
    const x = heuristicExtract(text, new Date("2026-10-24"));
    expect(x.course.code).toBe("PHARM 201");
    expect(x.course.name).toMatch(/Pharmacology for Nursing Practice/);
    expect(x.topics.map((t) => t.name)).toContain("Cardiac Drugs");
    expect(x.topics).toHaveLength(10);
    const exam2 = x.deadlines.find((d) => d.title.startsWith("Exam 2"))!;
    expect(exam2).toMatchObject({ kind: "exam", date: "2026-10-29", time: "10:00" });
    expect(x.deadlines.find((d) => /mini-project/.test(d.title))).toMatchObject({
      title: "Drug interaction mini-project",
      kind: "assignment",
      date: "2026-11-24",
      time: null,
    });
    // Office hours line has a time but no date or deadline word: ignored.
    expect(x.deadlines.some((d) => /office/i.test(d.title))).toBe(false);
  });

  it("puts yearless dates in the current academic term", () => {
    const oct = new Date("2026-10-24");
    expect(inferYear(12, oct)).toBe(2026);
    expect(inferYear(1, oct)).toBe(2027);
    expect(inferYear(11, new Date("2027-02-01"))).toBe(2026);
  });
});
