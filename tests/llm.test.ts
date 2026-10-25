import { beforeEach, describe, expect, it } from "vitest";
import { geminiFailure, markModelDown, modelOrder, resetModelHealthForTesting } from "@/lib/llm/gemini";

describe("gemini model fallback", () => {
  beforeEach(() => resetModelHealthForTesting());

  it("classifies the failures another model can fix", () => {
    expect(geminiFailure(Object.assign(new Error("quota"), { status: 429 }))).toBe("quota");
    expect(geminiFailure(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'))).toBe("quota");
    expect(geminiFailure(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'))).toBe("busy");
    expect(geminiFailure(new Error('{"error":{"code":404,"status":"NOT_FOUND"}}'))).toBe("gone");
    expect(geminiFailure(new Error("Gemini returned output that wasn't JSON."))).toBeNull();
  });

  it("skips a model while it cools down, then tries it again", () => {
    const now = Date.now();
    expect(modelOrder(["main", "lite"], now)).toEqual(["main", "lite"]);
    markModelDown("main", "busy", now);
    expect(modelOrder(["main", "lite"], now + 1000)).toEqual(["lite"]);
    expect(modelOrder(["main", "lite"], now + 61_000)).toEqual(["main", "lite"]);
  });

  it("still tries every model when all are cooling down", () => {
    const now = Date.now();
    markModelDown("main", "quota", now);
    markModelDown("lite", "quota", now);
    expect(modelOrder(["main", "lite", "main"], now)).toEqual(["main", "lite"]);
  });
});
