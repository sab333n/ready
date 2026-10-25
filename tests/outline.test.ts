import { describe, expect, it } from "vitest";
import { offlineOutline, outlineDocument } from "@/lib/lesson/outline";

describe("topic outline", () => {
  it("names the topic in every section so the class can teach without slides", () => {
    const sections = offlineOutline("Respiratory Drugs");
    expect(sections.length).toBeGreaterThanOrEqual(4);
    expect(sections.every((section) => section.text.includes("Respiratory Drugs"))).toBe(true);
    expect(outlineDocument("Respiratory Drugs", sections)).toMatch(/^Respiratory Drugs/);
  });
});