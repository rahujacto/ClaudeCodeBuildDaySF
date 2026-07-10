"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { BrandIcon } from "@/components/brand-icon";
import { RangeSpinner } from "@/components/dashboard/range-loading";

/**
 * Collapsible dashboard section.
 * - `prominent` renders a larger top-level group header (Revenue / Traffic / …).
 * - `slug` (one) or `slugs` (several) show platform brand icons in the header.
 */
export function Section({
  title,
  slug,
  slugs,
  icon,
  sublabel,
  prominent = false,
  defaultOpen = true,
  children,
}: {
  title: string;
  slug?: string;
  slugs?: string[];
  icon?: ReactNode; // generic (non-brand) heading icon; takes precedence over slugs
  sublabel?: ReactNode;
  prominent?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const icons = slugs ?? (slug ? [slug] : []);

  return (
    <section
      className={
        prominent
          ? "mt-8 border-t border-zinc-200 pt-5 dark:border-zinc-800 first:mt-6 first:border-t-0 first:pt-0"
          : "mt-5"
      }
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        {icon
          ? <span className="flex items-center text-zinc-500 dark:text-zinc-400">{icon}</span>
          : icons.map((s) => (
              <BrandIcon key={s} slug={s} className={prominent ? "size-5" : "size-4"} />
            ))}
        <span
          className={
            prominent
              ? "text-base font-semibold text-foreground"
              : "text-xs font-semibold uppercase tracking-wide text-zinc-500"
          }
        >
          {title}
        </span>
        {sublabel && (
          <span className="text-xs font-normal normal-case text-zinc-400">{sublabel}</span>
        )}
        {prominent && <RangeSpinner className="size-4" />}
        <ChevronDown
          className={`ml-auto text-zinc-400 transition-transform ${
            prominent ? "size-5" : "size-4"
          } ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && <div>{children}</div>}
    </section>
  );
}
