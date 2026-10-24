import { describe, expect, it } from "vitest";
import { loadPrompt } from "@/lib/prompts";

describe("prompts", () => {
  it("loads a versioned prompt and fills placeholders", () => {
    const p = loadPrompt("extract-course-material", 1, { today: "2026-10-24", filename: "s.pdf", text: "HELLO" });
    expect(p.id).toBe("extract-course-material.v1");
    expect(p.system).toContain("2026-10-24");
    expect(p.system).toMatch(/Never invent/);
    expect(p.user).toContain("HELLO");
  });

  it("fails loudly on a missing placeholder", () => {
    expect(() => loadPrompt("extract-course-material", 1, { today: "x" })).toThrow(/filename/);
  });
});
