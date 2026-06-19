"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PRESETS, rangeForPreset, type RangePreset } from "@/lib/dates";

export function RangeSelector({
  active,
  start,
  end,
}: {
  active: RangePreset | null;
  start: string;
  end: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);
  const today = new Date().toISOString().slice(0, 10);

  function go(s: string, e: string) {
    // Cookie lets the chat agent default to the same window the user is viewing.
    document.cookie = `pulse_range=${s}..${e}; path=/; max-age=2592000; samesite=lax`;
    startTransition(() => {
      router.push(`/dashboard?start=${s}&end=${e}`);
      router.refresh();
    });
  }

  function selectPreset(key: RangePreset) {
    const r = rangeForPreset(key);
    setOpen(false);
    go(r.start, r.end);
  }

  function applyCustom() {
    if (!from || !to) return;
    const [s, e] = from <= to ? [from, to] : [to, from];
    setOpen(false);
    go(s, e);
  }

  const baseBtn =
    "rounded-md px-3 py-1 text-sm font-medium transition disabled:opacity-60";
  const activeBtn = "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900";
  const idleBtn = "text-zinc-600 hover:text-foreground dark:text-zinc-400";

  return (
    <div className="relative">
      <div
        className={`inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-900 ${
          pending ? "opacity-60" : ""
        }`}
      >
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => selectPreset(p.key)}
            disabled={pending}
            className={`${baseBtn} ${active === p.key ? activeBtn : idleBtn}`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => {
            setFrom(start);
            setTo(end);
            setOpen((o) => !o);
          }}
          disabled={pending}
          className={`${baseBtn} ${active === null ? activeBtn : idleBtn}`}
        >
          Custom
        </button>
      </div>

      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 z-20 mt-2 flex items-end gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              From
              <input
                type="date"
                value={from}
                max={to || today}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-sm dark:border-zinc-800"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              To
              <input
                type="date"
                value={to}
                min={from || undefined}
                max={today}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-sm dark:border-zinc-800"
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
        </>
      )}
    </div>
  );
}
