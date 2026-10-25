import { describe, expect, it } from "vitest";
import { downsamplePcm16Base64, pcm16ToFloat32, rms, sampleRateOf } from "@/lib/voice/audio";
import { BargeInDetector } from "@/lib/voice/barge-in";
import { classLine, yourTurn } from "@/lib/voice/messages";

describe("audio helpers", () => {
  it("decodes little-endian 16-bit PCM", () => {
    const bytes = new Uint8Array([0x00, 0x40, 0x00, 0xc0, 0xff, 0x7f]);
    const out = pcm16ToFloat32(bytes);
    expect(Array.from(out)).toEqual([0.5, -0.5, 32767 / 32768]);
    expect(rms([0.5, -0.5])).toBe(0.5);
    expect(sampleRateOf("audio/pcm;rate=24000")).toBe(24000);
  });

  it("downsamples mic audio to 16 kHz PCM", () => {
    const input = new Float32Array(48).fill(0.5);
    const back = pcm16ToFloat32(Uint8Array.from(atob(downsamplePcm16Base64(input, 48_000)), (c) => c.charCodeAt(0)));
    expect(back.length).toBe(16);
    expect(back[0]).toBeCloseTo(0.5, 2);
  });
});

describe("barge-in detection", () => {
  it("needs sustained speech, fires once, and ignores warm-up noise", () => {
    const d = new BargeInDetector(0);
    expect(d.feed(0.5, false, 100)).toBe(false); // warm-up
    expect(d.feed(0.05, false, 1000)).toBe(false);
    expect(d.feed(0.05, false, 1100)).toBe(false);
    expect(d.feed(0.05, false, 1250)).toBe(true);
    expect(d.feed(0.05, false, 1400)).toBe(false); // same stretch
    expect(d.feed(0.0, false, 1500)).toBe(false);
    expect(d.feed(0.05, false, 1600)).toBe(false);
    expect(d.feed(0.05, false, 1850)).toBe(true); // new stretch
  });

  it("uses a higher bar while a student is playing (echo guard)", () => {
    const d = new BargeInDetector(0);
    expect(d.feed(0.04, true, 1000)).toBe(false);
    expect(d.feed(0.04, true, 1300)).toBe(false); // echo-level sound never interrupts
    expect(d.feed(0.1, true, 1400)).toBe(false);
    expect(d.feed(0.1, true, 1650)).toBe(true);
  });
});

describe("voice messages", () => {
  it("only YOUR TURN messages ask a student to speak", () => {
    expect(classLine("Teacher", "hi")).toBe('[Class] Teacher: "hi"');
    expect(yourTurn("Beta blockers slow the heart.", null)).toMatch(/^YOUR TURN\. The teacher just said/);
    expect(yourTurn(null, "Retell it")).toContain("Director note");
  });
});
