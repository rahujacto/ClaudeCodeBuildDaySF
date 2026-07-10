"use client";

import { useEffect, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { Chat } from "./chat";

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 340;
const MAX_WIDTH = 900;

export function ChatDock({ shopifyConnected }: { shopifyConnected: boolean }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  // The dock is a fixed-width drawer at sm+ (resizable); full-screen on mobile.
  const [isWide, setIsWide] = useState(false);

  // Decide initial state on the client: remembered preference, else open on
  // desktop / closed on mobile. Avoids SSR hydration mismatch.
  useEffect(() => {
    const stored = localStorage.getItem("pulse_chat_open");
    if (stored !== null) setOpen(stored === "1");
    else setOpen(window.matchMedia("(min-width: 1024px)").matches);
    const storedW = Number(localStorage.getItem("pulse_chat_width"));
    if (storedW >= MIN_WIDTH && storedW <= MAX_WIDTH) setWidth(storedW);
    setMounted(true);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setIsWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("pulse_chat_open", open ? "1" : "0");
    document.body.classList.toggle("pulse-chat-open", open);
    return () => document.body.classList.remove("pulse-chat-open");
  }, [open, mounted]);

  // Keep the dashboard's content-shift (--pulse-chat-width) and the saved
  // preference in sync with the current width.
  useEffect(() => {
    if (!mounted) return;
    document.body.style.setProperty("--pulse-chat-width", `${width}px`);
    localStorage.setItem("pulse_chat_width", String(width));
  }, [width, mounted]);

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    document.body.classList.add("pulse-chat-resizing");
    const cap = Math.min(MAX_WIDTH, window.innerWidth - 120);
    const onMove = (ev: PointerEvent) => {
      // Panel is right-anchored, so its width is the gap from the cursor to the
      // right edge of the viewport.
      const next = Math.min(Math.max(window.innerWidth - ev.clientX, MIN_WIDTH), cap);
      setWidth(next);
    };
    const onUp = () => {
      document.body.classList.remove("pulse-chat-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  if (!mounted) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        aria-label="Open Pulse assistant"
      >
        <MessageSquare className="size-4" />
        Ask Pulse
      </button>
    );
  }

  return (
    <aside
      className="fixed bottom-0 right-0 top-14 z-30 flex w-full flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      style={isWide ? { width: `${width}px`, maxWidth: "100vw" } : undefined}
    >
      {isWide && (
        <div
          onPointerDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize assistant panel"
          title="Drag to resize"
          className="group absolute left-0 top-0 z-40 flex h-full w-2 -translate-x-1/2 cursor-col-resize items-center justify-center"
        >
          <span className="h-full w-px bg-transparent transition group-hover:bg-emerald-500/60" />
        </div>
      )}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="size-2 rounded-full bg-emerald-500" />
          Pulse assistant
        </div>
        <button
          onClick={() => setOpen(false)}
          className="rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-foreground dark:hover:bg-zinc-800"
          aria-label="Minimize assistant"
        >
          <X className="size-4" />
        </button>
      </div>
      <Chat shopifyConnected={shopifyConnected} />
    </aside>
  );
}
