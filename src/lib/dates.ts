import type { DateRange } from "@/lib/adapters/types";

export type RangePreset = "7d" | "30d" | "90d" | "ytd";

export const PRESETS: { key: RangePreset; label: string; days?: number }[] = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "ytd", label: "YTD" },
];

/** Year-to-date: Jan 1 of the current year through today. */
export function ytdRange(today = todayUTC()): DateRange {
  return { start: `${today.slice(0, 4)}-01-01`, end: today };
}

/** Resolve a preset key to a concrete date range. */
export function rangeForPreset(key: RangePreset, today = todayUTC()): DateRange {
  if (key === "ytd") return ytdRange(today);
  const days = PRESETS.find((p) => p.key === key)?.days ?? 30;
  return rangeForDays(days, today);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Inclusive day count between two YYYY-MM-DD dates. */
export function daysInclusive(range: DateRange): number {
  const a = new Date(`${range.start}T00:00:00Z`).getTime();
  const b = new Date(`${range.end}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

/** The N-day range ending today (inclusive). */
export function rangeForDays(days: number, today = todayUTC()): DateRange {
  return { start: addDays(today, -(days - 1)), end: today };
}

/** The equal-length period immediately before `range`. */
export function previousRange(range: DateRange): DateRange {
  const len = daysInclusive(range);
  return { start: addDays(range.start, -len), end: addDays(range.start, -1) };
}

/** Shift a YYYY-MM-DD date back by `n` calendar years (same month/day). */
export function shiftYears(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y - n, m - 1, d)).toISOString().slice(0, 10);
}

// ── Comparison periods ──────────────────────────────────────────────────────

export type CompareMode = "none" | "previous" | "previous_dow" | "previous_year";

/** Comparison options shown in the range picker, in menu order. */
export const COMPARE_OPTIONS: { key: CompareMode; label: string }[] = [
  { key: "previous", label: "Previous period" },
  { key: "previous_dow", label: "Previous period (match day of week)" },
  { key: "previous_year", label: "Previous year" },
  { key: "none", label: "No comparison" },
];

export function compareLabel(mode: CompareMode): string {
  return COMPARE_OPTIONS.find((o) => o.key === mode)?.label ?? "Previous period";
}

/** Parse ?compare= into a valid mode; defaults to the immediately-prior period. */
export function parseCompare(value?: string): CompareMode {
  return COMPARE_OPTIONS.some((o) => o.key === value)
    ? (value as CompareMode)
    : "previous";
}

/**
 * The comparison range for `range` under `mode`, or null for "none".
 *
 * - `previous`      — the equal-length period immediately before.
 * - `previous_dow`  — same length, shifted back a whole number of weeks so the
 *                     weekdays line up (nearest full weeks ≥ the period length,
 *                     so it never overlaps the selected range).
 * - `previous_year` — the same calendar dates one year earlier.
 */
export function comparisonRange(range: DateRange, mode: CompareMode): DateRange | null {
  switch (mode) {
    case "none":
      return null;
    case "previous":
      return previousRange(range);
    case "previous_dow": {
      const shift = Math.ceil(daysInclusive(range) / 7) * 7;
      return { start: addDays(range.start, -shift), end: addDays(range.end, -shift) };
    }
    case "previous_year":
      return { start: shiftYears(range.start, 1), end: shiftYears(range.end, 1) };
  }
}

/** Parse ?start=&end= search params into a valid range, else default to 30d. */
export function parseRange(
  start?: string,
  end?: string,
  fallbackDays = 30,
): DateRange {
  const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (ok(start) && ok(end) && start! <= end!) return { start: start!, end: end! };
  return rangeForDays(fallbackDays);
}

export function presetForRange(range: DateRange): RangePreset | null {
  if (range.end !== todayUTC()) return null;
  if (range.start === `${range.end.slice(0, 4)}-01-01`) return "ytd";
  const days = daysInclusive(range);
  return PRESETS.find((p) => p.days === days)?.key ?? null;
}

export function formatRangeLabel(range: DateRange): string {
  const fmt = (s: string) =>
    new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return `${fmt(range.start)} – ${fmt(range.end)}`;
}
