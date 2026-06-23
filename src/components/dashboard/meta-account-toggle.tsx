"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Toggles visibility of the per-account Meta breakdown. The breakdown itself is
 * server-rendered and passed as children; only the open/closed state is client.
 */
export function MetaAccountToggle({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronDown
          className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
        {open ? "Hide account breakdown" : `Show by account (${count})`}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </>
  );
}
