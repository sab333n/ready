// Detects the learner starting to talk over an AI student (barge-in) from mic
// loudness. While a student is playing through the speakers the mic also hears
// them, so the threshold rises during playback; speech must also hold for a
// short time so a cough or click doesn't cut a student off.

export type BargeInOptions = {
  quietThreshold: number; // RMS that counts as speech when nothing is playing
  playingThreshold: number; // higher bar while a student is speaking (echo guard)
  holdMs: number; // speech must last this long
  warmupMs: number; // ignore the mic just after it starts (startup pops)
};

export const DEFAULT_BARGE_IN: BargeInOptions = { quietThreshold: 0.02, playingThreshold: 0.06, holdMs: 220, warmupMs: 600 };

export class BargeInDetector {
  private aboveSince: number | null = null;
  private fired = false;
  constructor(
    private readonly startedAt: number,
    private readonly opts: BargeInOptions = DEFAULT_BARGE_IN,
  ) {}

  /** Feed one loudness sample. Returns true exactly once per stretch of speech. */
  feed(level: number, playing: boolean, now: number): boolean {
    if (now - this.startedAt < this.opts.warmupMs) return false;
    const threshold = playing ? this.opts.playingThreshold : this.opts.quietThreshold;
    if (level < threshold) {
      this.aboveSince = null;
      this.fired = false;
      return false;
    }
    this.aboveSince ??= now;
    if (!this.fired && now - this.aboveSince >= this.opts.holdMs) {
      this.fired = true;
      return true;
    }
    return false;
  }
}
