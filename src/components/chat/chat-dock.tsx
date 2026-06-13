"use client";

import { useEffect, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { Chat } from "./chat";

export function ChatDock({ shopifyConnected }: { shopifyConnected: boolean }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Decide initial state on the client: remembered preference, else open on
  // desktop / closed on mobile. Avoids SSR hydration mismatch.
  useEffect(() => {
    const stored = localStorage.getItem("pulse_chat_open");
    if (stored !== null) setOpen(stored === "1");
    else setOpen(window.matchMedia("(min-width: 1024px)").matches);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("pulse_chat_open", open ? "1" : "0");
    document.body.classList.toggle("pulse-chat-open", open);
    return () => document.body.classList.remove("pulse-chat-open");
  }, [open, mounted]);

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
    <aside className="fixed bottom-0 right-0 top-14 z-30 flex w-full flex-col border-l border-zinc-200 bg-white shadow-2xl sm:max-w-[400px] dark:border-zinc-800 dark:bg-zinc-950">
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
