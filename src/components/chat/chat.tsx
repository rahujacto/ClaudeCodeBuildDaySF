"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatMarkdown } from "./chat-markdown";
import posthog from "posthog-js";

type ToolStep = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  summary?: string;
  done: boolean;
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  steps?: ToolStep[];
};

const SUGGESTIONS = [
  "How do I optimize my spend across platforms to increase sales?",
  "How did the store do last week vs the week before?",
  "Anything I should be worried about?",
  "What are my top products this month?",
];

const TOOL_LABEL: Record<string, string> = {
  get_metrics_summary: "Pulling metrics summary",
  compare_periods: "Comparing periods",
  breakdown_by_dimension: "Ranking performers",
  detect_anomalies: "Scanning for anomalies",
};

export function Chat({ shopifyConnected }: { shopifyConnected: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    posthog.capture("chat_message_sent", { message_length: q.length, conversation_turn: messages.filter((m) => m.role === "user").length + 1 });

    const history: Msg[] = [...messages, { role: "user", content: q }];
    const assistant: Msg = { role: "assistant", content: "", steps: [] };
    setMessages([...history, assistant]);
    scrollToBottom();

    // Update the in-progress assistant message immutably.
    const update = (fn: (m: Msg) => Msg) =>
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = fn(next[next.length - 1]);
        return next;
      });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok || !res.body) {
        const msg = res.status === 401 ? "Please sign in again." : "Request failed.";
        update((m) => ({ ...m, content: msg }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const evt = JSON.parse(line.slice(6));

          if (evt.type === "text") {
            update((m) => ({ ...m, content: m.content + evt.text }));
          } else if (evt.type === "tool_use") {
            update((m) => ({
              ...m,
              steps: [
                ...(m.steps ?? []),
                { id: evt.id, name: evt.name, input: evt.input, done: false },
              ],
            }));
          } else if (evt.type === "tool_result") {
            update((m) => ({
              ...m,
              steps: (m.steps ?? []).map((s) =>
                s.id === evt.id ? { ...s, summary: evt.summary, done: true } : s,
              ),
            }));
          } else if (evt.type === "error") {
            update((m) => ({
              ...m,
              content: m.content + `\n\n_⚠️ ${evt.message}_`,
            }));
          }
          scrollToBottom();
        }
      }
    } catch {
      update((m) => ({ ...m, content: m.content || "Network error — please retry." }));
    } finally {
      setBusy(false);
      scrollToBottom();
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6">
          {empty && (
            <div className="mt-10 flex flex-col items-center gap-5 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-2xl">
                📊
              </div>
              <div>
                <h2 className="text-lg font-semibold">Ask your analyst</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {shopifyConnected
                    ? "Real answers from live tool calls over your Shopify data."
                    : "Connect Shopify first to get live answers."}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={busy || !shopifyConnected}
                    className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              {m.role === "user" ? (
                <div className="max-w-[85%] rounded-2xl bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
                  {m.content}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {!!m.steps?.length && (
                    <div className="flex flex-col gap-1.5">
                      {m.steps.map((s) => (
                        <ToolChip key={s.id} step={s} />
                      ))}
                    </div>
                  )}
                  {m.content ? (
                    <ChatMarkdown content={m.content} />
                  ) : (
                    busy && <ThinkingDots />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-black/80">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-3"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={shopifyConnected ? "Ask about your store…" : "Connect Shopify to start"}
            disabled={busy || !shopifyConnected}
            autoFocus
          />
          <Button type="submit" disabled={busy || !input.trim() || !shopifyConnected}>
            {busy ? "…" : "Ask"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function ToolChip({ step }: { step: ToolStep }) {
  const label = TOOL_LABEL[step.name] ?? step.name;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">
      <span className={`mt-0.5 ${step.done ? "" : "animate-pulse"}`}>
        {step.done ? "✅" : "⚙️"}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          {label}
        </span>
        {step.summary && (
          <span className="font-mono text-[11px] text-zinc-500">{step.summary}</span>
        )}
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 text-zinc-400">
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current" />
    </div>
  );
}
