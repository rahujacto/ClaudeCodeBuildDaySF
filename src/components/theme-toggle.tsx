"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

const noopSubscribe = () => () => {};

/** True only after hydration — lets a component render a fixed placeholder on
 *  the server (which doesn't know the client's theme) with no hydration
 *  mismatch, and no setState-in-effect. */
function useMounted() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * Light/dark toggle. Guards on `mounted` — the server has no idea what theme
 * the client prefers, so rendering the real icon before hydration would
 * mismatch. A fixed-size placeholder keeps the header's layout stable either way.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  if (!mounted) {
    return <Button variant="ghost" size="icon-sm" disabled aria-hidden />;
  }

  const isDark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
