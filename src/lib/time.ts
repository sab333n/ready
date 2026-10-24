// Small time-zone helpers built on Intl, so we don't need a date library.

/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffset(instant: number, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - instant;
}

/** "2026-11-12" + "14:00" (or null → 23:59) in America/New_York → Date. */
export function zonedDate(date: string, time: string | null, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time ?? "23:59").split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  let instant = naive - tzOffset(naive, tz);
  instant = naive - tzOffset(instant, tz); // second pass handles DST edges
  return new Date(instant);
}

export function localDateKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
