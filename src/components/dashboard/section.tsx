"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { BrandIcon } from "@/components/brand-icon";

/**
 * Collapsible dashboard section with an optional platform icon in the header.
 * Defaults to open; the chevron + whole header row toggles it.
 */
export function Section({
  title,
  slug,
  sublabel,
  defaultOpen = true,
  children,
}: {
  title: string;
  slug?: string;
  sublabel?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        {slug && <BrandIcon slug={slug} className="size-4" />}
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {title}
        </span>
        {sublabel && (
          <span className="text-xs font-normal normal-case text-zinc-400">{sublabel}</span>
        )}
        <ChevronDown
          className={`ml-auto size-4 text-zinc-400 transition-transform ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>
      {open && <div>{children}</div>}
    </section>
  );
}
