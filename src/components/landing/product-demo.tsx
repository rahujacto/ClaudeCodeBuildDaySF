"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, Loader2, RotateCcw } from "lucide-react";

const QUESTION = "How did the store do last week vs the week before?";

const ANSWER =
  "Last week revenue was $31,825, up 44% from $22,131 the week before. Orders rose 125 vs 101 (+24%) and AOV climbed to ~$255 vs ~$219 (+16%) — bigger baskets drove the gain on top of more orders, so the lift is healthy. The AOV jump points at the high-ticket doctoral sets.";

const TOOLS = [
  { label: "Comparing periods", result: "revenue: 31,825 vs 22,131 (+43.8%)" },
  { label: "Comparing periods", result: "orders: 125 vs 101 (+23.8%)" },
];

type Snapshot = {
  typed: number;
  toolsDone: number;
  toolRunning: boolean;
  answerChars: number;
  actionVisible: boolean;
  applied: boolean;
};

const START: Snapshot = {
  typed: 0,
  toolsDone: 0,
  toolRunning: false,
  answerChars: 0,
  actionVisible: false,
  applied: false,
};

const FINAL: Snapshot = {
  typed: QUESTION.length,
  toolsDone: TOOLS.length,
  toolRunning: false,
  answerChars: ANSWER.length,
  actionVisible: true,
  applied: true,
};

function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function ProductDemo() {
  const [frame, setFrame] = useState<Snapshot>(START);
  const [active, setActive] = useState(false);
  const [runId, setRunId] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );

  // With reduced motion, skip the animation and show the finished session.
  const s = reduced ? FINAL : frame;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setActive(entry.isIntersecting),
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (reduced || !active) return;
    let cancelled = false;
    const live = () => !cancelled;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    (async () => {
      while (live()) {
        await sleep(50);
        if (!live()) return;
        setFrame(START);
        await sleep(750);

        // Type the question
        for (let i = 1; i <= QUESTION.length; i++) {
          if (!live()) return;
          setFrame((p) => ({ ...p, typed: i }));
          await sleep(28);
        }
        await sleep(500);

        // Run the tools one by one
        for (let t = 0; t < TOOLS.length; t++) {
          if (!live()) return;
          setFrame((p) => ({ ...p, toolRunning: true }));
          await sleep(950);
          if (!live()) return;
          setFrame((p) => ({ ...p, toolRunning: false, toolsDone: t + 1 }));
          await sleep(350);
        }
        await sleep(400);

        // Stream the answer
        for (let i = 4; i <= ANSWER.length; i += 4) {
          if (!live()) return;
          setFrame((p) => ({ ...p, answerChars: Math.min(i, ANSWER.length) }));
          await sleep(24);
        }
        if (!live()) return;
        setFrame((p) => ({ ...p, answerChars: ANSWER.length }));
        await sleep(700);

        // Propose the action, then approve it
        setFrame((p) => ({ ...p, actionVisible: true }));
        await sleep(1800);
        if (!live()) return;
        setFrame((p) => ({ ...p, applied: true }));
        await sleep(4000);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, reduced, runId]);

  return (
    <div ref={rootRef}>
      {/* Browser chrome */}
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3 border-b border-zinc-100 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <span className="size-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <span className="size-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
          </div>
          <div className="flex-1 text-center">
            <span className="inline-block rounded-md bg-white px-3 py-0.5 text-[11px] text-zinc-400 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              pulse — dashboard
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setFrame(START);
              setRunId((n) => n + 1);
            }}
            aria-label="Replay demo"
            className="text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <RotateCcw className="size-3.5" />
          </button>
        </div>

        <div className="flex min-h-[430px] flex-col gap-3 p-5 sm:p-6">
          {/* User message */}
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
              {QUESTION.slice(0, s.typed)}
              {s.typed > 0 && s.typed < QUESTION.length && (
                <span className="ml-px inline-block h-[1em] w-px translate-y-[2px] animate-pulse bg-current" />
              )}
              {s.typed === 0 && <span className="opacity-40">…</span>}
            </div>
          </div>

          {/* Tool calls */}
          <div className="flex flex-col gap-1.5">
            {TOOLS.map((tool, i) => {
              const done = i < s.toolsDone;
              const running = i === s.toolsDone && s.toolRunning;
              if (!done && !running) return null;
              return (
                <div
                  key={tool.result}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950"
                >
                  {done ? (
                    <Check
                      className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                      strokeWidth={2.5}
                    />
                  ) : (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-zinc-400" />
                  )}
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {tool.label}
                  </span>
                  {done && (
                    <span className="font-mono text-[11px] text-zinc-500">
                      {tool.result}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Streamed answer */}
          {s.answerChars > 0 && (
            <div className="rounded-xl bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
              {ANSWER.slice(0, s.answerChars)}
            </div>
          )}

          {/* Suggested action */}
          {s.actionVisible && (
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-500">
                  Suggested action · Google Ads
                </span>
                {s.applied ? (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    Applied
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                    Needs approval
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-zinc-800 dark:text-zinc-200">
                Raise daily budget on the{" "}
                <span className="font-medium">“Doctoral Regalia”</span>{" "}
                campaign from <span className="font-mono">$40</span> →{" "}
                <span className="font-mono">$65</span> — projected{" "}
                <span className="text-emerald-600 dark:text-emerald-400">
                  +8–10 orders/week
                </span>{" "}
                at current ROAS.
              </p>
              <div className="mt-3 flex items-center gap-2">
                {s.applied ? (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white">
                    <Check className="size-3.5" strokeWidth={2.5} />
                    Budget updated
                  </span>
                ) : (
                  <>
                    <span className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white">
                      Approve &amp; apply
                    </span>
                    <span className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                      Dismiss
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-zinc-400">
        Simulated session — this is the real product flow on example data.
      </p>
    </div>
  );
}
