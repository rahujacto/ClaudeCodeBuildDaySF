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
