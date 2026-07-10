"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import {
  PRESETS,
  COMPARE_OPTIONS,
  rangeForPreset,
  formatRangeLabel,
  compareLabel,
  type RangePreset,
  type CompareMode,
} from "@/lib/dates";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const todayStr = () => new Date().toISOString().slice(0, 10);

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Long display form: "July 1, 2025". */
function longDate(s: string): string {
  return new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function addMonths(y: number, m: number, n: number): [number, number] {
  const total = y * 12 + m + n;
  return [Math.floor(total / 12), ((total % 12) + 12) % 12];
}

export function RangeSelector({
  active,
  start,
  end,
  compare,
}: {
  active: RangePreset | null;
  start: string;
  end: string;
  compare: CompareMode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  // Draft selection, committed only on Apply.
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState<string | null>(end);
  const [hover, setHover] = useState<string | null>(null);
  const [preset, setPreset] = useState<RangePreset | null>(active);
  const [cmp, setCmp] = useState<CompareMode>(compare);
  // Left-hand month shown in the two-up calendar.
  const [[vy, vm], setView] = useState<[number, number]>(() => {
    const d = new Date(`${end}T00:00:00Z`);
    return addMonths(d.getUTCFullYear(), d.getUTCMonth(), -1);
  });

  const today = todayStr();

  function reset() {
    setFrom(start);
    setTo(end);
    setHover(null);
    setPreset(active);
    setCmp(compare);
    const d = new Date(`${end}T00:00:00Z`);
    setView(addMonths(d.getUTCFullYear(), d.getUTCMonth(), -1));
  }

  function go(s: string, e: string, c: CompareMode) {
    // Cookie lets the chat agent default to the same window the user is viewing.
    document.cookie = `pulse_range=${s}..${e}; path=/; max-age=2592000; samesite=lax`;
    const q = new URLSearchParams({ start: s, end: e });
    if (c !== "previous") q.set("compare", c); // "previous" is the default — omit
    startTransition(() => {
      router.push(`/dashboard?${q.toString()}`);
      router.refresh();
    });
  }

  function pickPreset(key: RangePreset) {
    const r = rangeForPreset(key);
    setFrom(r.start);
    setTo(r.end);
    setPreset(key);
    setHover(null);
    const d = new Date(`${r.end}T00:00:00Z`);
    setView(addMonths(d.getUTCFullYear(), d.getUTCMonth(), -1));
  }

  function pickDay(day: string) {
    if (day > today) return;
    setPreset(null);
    if (!from || to) {
      // No start yet, or the range is already complete — begin a fresh one.
      setFrom(day);
      setTo(null);
    } else if (day >= from) {
      setTo(day);
    } else {
      // Clicked before the start — swap so the earlier day is the start.
      setTo(from);
      setFrom(day);
    }
  }

  function apply() {
    const s = from;
    const e = to ?? from;
    setOpen(false);
    const [a, b] = s <= e ? [s, e] : [e, s];
    go(a, b, cmp);
  }

  // Effective end for range highlighting (live preview while picking).
  const effEnd = to ?? (hover && hover >= from ? hover : null);

  return (
    <div className="relative">
      <button
        onClick={() => {
          if (!open) reset();
          setOpen((o) => !o);
        }}
        disabled={pending}
        className={`inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium shadow-sm transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 ${
          pending ? "opacity-60" : ""
        }`}
      >
        <Calendar className="size-4 text-zinc-400" />
        <span className="tabular-nums">{formatRangeLabel({ start, end })}</span>
        {compare !== "none" && (
          <span className="hidden text-xs font-normal text-zinc-400 sm:inline">
            vs {compareLabel(compare)}
          </span>
        )}
        <ChevronDown
          className={`size-4 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 z-20 mt-2 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex">
              {/* Preset sidebar */}
              <div className="w-36 shrink-0 border-r border-zinc-100 bg-zinc-50/60 p-2 dark:border-zinc-800 dark:bg-zinc-800/30">
                <div className="flex flex-col gap-0.5">
                  {PRESETS.map((p) => (
                    <SidebarItem
                      key={p.key}
                      label={p.label}
                      selected={preset === p.key}
                      onClick={() => pickPreset(p.key)}
                    />
                  ))}
                  <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-700" />
                  <SidebarItem label="Custom range" selected={preset === null} readOnly />
                </div>
              </div>

              {/* Calendar area */}
              <div className="p-3">
                {/* From → To */}
                <div className="flex items-center gap-2">
                  <DateField label={from ? longDate(from) : "Start"} active={!to} />
                  <ArrowRight className="size-4 shrink-0 text-zinc-400" />
                  <DateField label={to ? longDate(to) : "End"} active={!!to} />
                </div>

                {/* Month nav + two months */}
                <div className="mt-3 flex items-start gap-6">
                  {[0, 1].map((offset) => {
                    const [cy, cm] = addMonths(vy, vm, offset);
                    const isRight = offset === 1;
                    return (
                      <div key={offset} className={isRight ? "hidden md:block" : ""}>
                        <div className="mb-2 flex h-6 items-center justify-between">
                          {/* Left month owns the prev arrow; on mobile it also owns
                              next (the right month is hidden). */}
                          {isRight ? (
                            <span className="size-6" />
                          ) : (
                            <NavBtn dir="prev" onClick={() => setView(addMonths(vy, vm, -1))} />
                          )}
                          <div className="text-sm font-semibold">
                            {MONTHS[cm]} {cy}
                          </div>
                          <NavBtn
                            dir="next"
                            className={isRight ? "" : "md:invisible"}
                            onClick={() => setView(addMonths(vy, vm, 1))}
                          />
                        </div>
                        <MonthGrid
                          year={cy}
                          month={cm}
                          from={from}
                          effEnd={effEnd}
                          today={today}
                          onPick={pickDay}
                          onHover={setHover}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer: comparison + actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 bg-zinc-50/60 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-800/30">
              <label className="flex items-center gap-2 text-xs text-zinc-500">
                Compare to
                <select
                  value={cmp}
                  onChange={(e) => setCmp(e.target.value as CompareMode)}
                  className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-foreground dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {COMPARE_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  onClick={apply}
                  disabled={!from || pending}
                  className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SidebarItem({
  label,
  selected,
  onClick,
  readOnly,
}: {
  label: string;
  selected: boolean;
  onClick?: () => void;
  readOnly?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition ${
        selected
          ? "bg-zinc-200/70 font-medium text-foreground dark:bg-zinc-700/60"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      } ${readOnly ? "cursor-default" : ""}`}
    >
      {label}
    </button>
  );
}

function DateField({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      className={`flex-1 rounded-md border px-3 py-1.5 text-sm ${
        active
          ? "border-zinc-900 dark:border-zinc-100"
          : "border-zinc-200 dark:border-zinc-700"
      }`}
    >
      {label}
    </div>
  );
}

function NavBtn({
  dir,
  onClick,
  className = "",
}: {
  dir: "prev" | "next";
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`grid size-6 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${className}`}
      aria-label={dir === "prev" ? "Previous month" : "Next month"}
    >
      {dir === "prev" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
    </button>
  );
}

function MonthGrid({
  year,
  month,
  from,
  effEnd,
  today,
  onPick,
  onHover,
}: {
  year: number;
  month: number;
  from: string;
  effEnd: string | null;
  today: string;
  onPick: (day: string) => void;
  onHover: (day: string | null) => void;
}) {
  const cells = useMemo(() => {
    const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const out: (string | null)[] = Array(firstWeekday).fill(null);
    for (let d = 1; d <= days; d++) out.push(ymd(year, month, d));
    return out;
  }, [year, month]);

  return (
    <div className="w-[224px]">
      <div className="mb-1 grid grid-cols-7">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1 text-center text-[11px] font-medium text-zinc-400">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (!day) return <div key={`b${i}`} className="h-8" />;
          const isStart = day === from;
          const isEnd = effEnd != null && day === effEnd;
          const inRange = effEnd != null && day > from && day < effEnd;
          const isEndpoint = isStart || isEnd;
          const disabled = day > today;
          // Range bar background (rounded on the ends of the selection).
          const barBg =
            inRange || (isEndpoint && effEnd != null && from !== effEnd)
              ? "bg-zinc-100 dark:bg-zinc-800"
              : "";
          const barRound =
            isStart && isEnd
              ? "rounded-full"
              : isStart
                ? "rounded-l-full"
                : isEnd
                  ? "rounded-r-full"
                  : "";
          return (
            <div
              key={day}
              className={`flex h-8 items-center justify-center ${barBg} ${barRound}`}
            >
              <button
                onClick={() => onPick(day)}
                onMouseEnter={() => onHover(day)}
                onMouseLeave={() => onHover(null)}
                disabled={disabled}
                className={`grid size-8 place-items-center rounded-full text-sm tabular-nums transition ${
                  isEndpoint
                    ? "bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : disabled
                      ? "cursor-not-allowed text-zinc-300 dark:text-zinc-600"
                      : "hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                {Number(day.slice(8))}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
