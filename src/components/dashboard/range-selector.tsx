"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  PRESETS,
  COMPARE_OPTIONS,
  rangeForPreset,
  formatRangeLabel,
  compareLabel,
  type RangePreset,
  type CompareMode,
} from "@/lib/dates";

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
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);
  const today = new Date().toISOString().slice(0, 10);

  function go(s: string, e: string, cmp: CompareMode) {
    // Cookie lets the chat agent default to the same window the user is viewing.
    document.cookie = `pulse_range=${s}..${e}; path=/; max-age=2592000; samesite=lax`;
    const q = new URLSearchParams({ start: s, end: e });
    // "previous" is the default, so omit it to keep URLs clean.
    if (cmp !== "previous") q.set("compare", cmp);
    startTransition(() => {
      router.push(`/dashboard?${q.toString()}`);
      router.refresh();
    });
  }

  function selectPreset(key: RangePreset) {
    const r = rangeForPreset(key);
    setOpen(false);
    go(r.start, r.end, compare);
  }

  function selectCompare(mode: CompareMode) {
    go(start, end, mode);
  }

  function applyCustom() {
    if (!from || !to) return;
    const [s, e] = from <= to ? [from, to] : [to, from];
    setOpen(false);
    go(s, e, compare);
  }

  const rowBase =
    "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition disabled:opacity-60";
  const rowActive =
    "bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900";
  const rowIdle =
    "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <div className="relative">
      <button
        onClick={() => {
          setFrom(start);
          setTo(end);
          setOpen((o) => !o);
        }}
        disabled={pending}
        className={`inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium shadow-sm transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 ${
          pending ? "opacity-60" : ""
        }`}
      >
        <span className="tabular-nums">{formatRangeLabel({ start, end })}</span>
        {compare !== "none" && (
          <span className="hidden text-xs font-normal text-zinc-400 sm:inline">
            vs {compareLabel(compare)}
          </span>
        )}
        <svg
          viewBox="0 0 12 12"
          className={`size-3 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
            <div className="px-1.5 pb-1 pt-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Date range
            </div>
            <div className="flex flex-col gap-0.5">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => selectPreset(p.key)}
                  disabled={pending}
                  className={`${rowBase} ${active === p.key ? rowActive : rowIdle}`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="mt-1.5 flex items-end gap-2 rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/50">
              <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-500">
                From
                <input
                  type="date"
                  value={from}
                  max={to || today}
                  onChange={(e) => setFrom(e.target.value)}
                  className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-500">
                To
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  max={today}
                  onChange={(e) => setTo(e.target.value)}
                  className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <button
                onClick={applyCustom}
                disabled={!from || !to || pending}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Apply
              </button>
            </div>

            <div className="my-1.5 h-px bg-zinc-100 dark:bg-zinc-800" />

            <div className="px-1.5 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Compare to
            </div>
            <div className="flex flex-col gap-0.5">
              {COMPARE_OPTIONS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => selectCompare(c.key)}
                  disabled={pending}
                  className={`${rowBase} ${compare === c.key ? rowActive : rowIdle}`}
                >
                  <span>{c.label}</span>
                  {compare === c.key && (
                    <svg viewBox="0 0 12 12" className="size-3.5 shrink-0" aria-hidden>
                      <path d="M2.5 6.5 5 9l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
