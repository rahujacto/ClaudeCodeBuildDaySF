"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** A Card whose body collapses; the header row toggles it. Defaults closed. */
export function CollapsibleCard({
  title,
  description,
  defaultOpen = false,
  className = "mt-4",
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full text-left"
      >
        <CardHeader className="grid-cols-[1fr_auto] items-center">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base">{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          <ChevronDown
            className={`size-4 text-zinc-400 transition-transform ${
              open ? "" : "-rotate-90"
            }`}
          />
        </CardHeader>
      </button>
      {open && <CardContent>{children}</CardContent>}
    </Card>
  );
}
