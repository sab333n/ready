import { describe, expect, it } from "vitest";
import { assignmentsToDeadlines, canvasOrigin, htmlToText, readingFiles } from "@/lib/canvas/api";

const NOW = new Date("2026-10-25T12:00:00Z");

describe("canvas", () => {
  it("keeps the school host and rejects a local address", () => {
    expect(canvasOrigin("https://ulm.instructure.com/courses/1").origin).toBe("https://ulm.instructure.com");
    expect(canvasOrigin("canvas.example.edu").origin).toBe("https://canvas.example.edu");
    expect(() => canvasOrigin("http://canvas.example.edu")).toThrow(/https/);
    expect(() => canvasOrigin("https://localhost/api")).toThrow(/Canvas address/);
  });

  it("turns upcoming assignments into deadlines and skips ones with no due date", () => {
    const items = assignmentsToDeadlines(
      [{ id: 9, name: "Pharmacology for Nursing Practice", course_code: "PHARM 201" }],
      [
        { id: 3, course_id: 9, name: "Quiz 4: Anticoagulants", due_at: "2026-11-05T23:59:00Z" },
        { id: 4, course_id: 9, name: "Office hours", due_at: "2026-11-06T15:00:00Z" },
        { id: 5, course_id: 9, name: "No date yet", due_at: null },
      ],
      NOW,
    );
    expect(items.map((i) => i.title)).toEqual(["Quiz 4: Anticoagulants"]);
    expect(items[0].kind).toBe("quiz");
    expect(items[0].course?.code).toBe("PHARM201");
    expect(items[0].uid).toBe("canvas-9-3");
  });

  it("keeps the syllabus text and the posted readings, and leaves homework files alone", () => {
    expect(htmlToText("<h1>PHARM 201</h1><p>Week 1: Cardiac drugs</p><script>alert(1)</script>")).toBe("PHARM 201\nWeek 1: Cardiac drugs");
    const picked = readingFiles([
      { id: 1, display_name: "PHARM 201 Syllabus.pdf", "content-type": "application/pdf", size: 1000 },
      { id: 2, display_name: "Week 2 lecture slides.pdf", "content-type": "application/pdf", size: 1000 },
      { id: 3, display_name: "Homework 3.pdf", "content-type": "application/pdf", size: 1000 },
      { id: 4, display_name: "Syllabus.pdf", "content-type": "application/pdf", locked: true, size: 1000 },
      { id: 5, display_name: "lecture.mp4", "content-type": "video/mp4", size: 1000 },
    ]);
    expect(picked.map((file) => file.id)).toEqual([1, 2]);
  });
});
