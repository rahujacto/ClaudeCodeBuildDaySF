"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  "How did the store do last week vs the week before?",
  "Anything I should be worried about?",
  "What are my top products this month?",
];

const TOOL_LABEL: Record<string, string> = {
  get_metrics_summary: "Pulling metrics summary",
  compare_periods: "Comparing periods",
  breakdown_by_dimension: "Ranking performers",
  detect_anomalies: "Scanning for anomalies",
  suggest_revenue_optimizations: "Analyzing cross-platform data",
  draft_bid_adjustment: "Drafting budget changes",
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
                        s.name === "draft_bid_adjustment" && s.done ? <ActionCard key={s.id} step={s} /> : <ToolChip key={s.id} step={s} />
                      ))}
                    </div>
                  )}
                  {m.content ? (
                    <div className="whitespace-pre-wrap text-sm leading-6 text-zinc-800 dark:text-zinc-200">
                      {m.content}
                    </div>
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


function ActionCard({ step }: { step: ToolStep }) {
  const [status, setStatus] = useState<"pending" | "loading" | "applied" | "dismissed">("pending");

  let payload: Record<string, string | number> | null = null;
  try {
    payload = JSON.parse(step.summary ?? "{}")?.payload;
  } catch {
    payload = null;
  }

  if (!payload) return null;

  async function apply() {
    setStatus("loading");
    try {
      const res = await fetch("/api/actions/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) setStatus("applied");
      else setStatus("pending");
    } catch {
      setStatus("pending");
    }
  }

  if (status === "dismissed") {
      return (
        <div className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900 opacity-50">
            <span>❌</span>
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Dismissed budget change for {payload.campaign}</span>
        </div>
      );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 mt-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="text-lg">⚡</span>
          Suggested action · Ad Budget
        </div>
        {status === "pending" && (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                Needs approval
            </span>
        )}
        {status === "applied" && (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                Applied
            </span>
        )}
      </div>

      <p className="mt-4 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
        {payload.reasoning}
      </p>

      <div className="mt-4 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-950">
        <div className="text-xs font-medium text-zinc-500">
          Proposed change
        </div>
        <div className="mt-1 text-sm">
          Raise daily budget on <span className="font-medium">&quot;{payload.campaign}&quot;</span> from{" "}
          <span className="font-mono">${payload.current_budget}</span> →{" "}
          <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
            ${payload.recommended_budget}
          </span>
        </div>
      </div>

      {status !== "applied" && (
          <div className="mt-4 flex gap-2">
            <button
                onClick={apply}
                disabled={status === "loading"}
                className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {status === "loading" ? "Applying..." : "Approve & apply"}
            </button>
            <button
                onClick={() => setStatus("dismissed")}
                disabled={status === "loading"}
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-400 disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
      )}
    </div>
  );
}
