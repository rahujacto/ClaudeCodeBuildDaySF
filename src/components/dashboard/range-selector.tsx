"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { PRESETS, rangeForDays, type RangePreset } from "@/lib/dates";

export function RangeSelector({ active }: { active: RangePreset | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function select(days: number) {
    const range = rangeForDays(days);
    // Cookie lets the chat agent default to the same window the user is viewing.
    document.cookie = `pulse_range=${range.start}..${range.end}; path=/; max-age=2592000; samesite=lax`;
    startTransition(() => {
      router.push(`/dashboard?start=${range.start}&end=${range.end}`);
      router.refresh();
    });
  }

  return (
    <div
      className={`inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-900 ${
        pending ? "opacity-60" : ""
      }`}
    >
      {PRESETS.map((p) => (
        <button
          key={p.key}
          onClick={() => select(p.days)}
          disabled={pending}
          className={`rounded-md px-3 py-1 text-sm font-medium transition ${
            active === p.key
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-600 hover:text-foreground dark:text-zinc-400"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
