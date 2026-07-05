"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

const steps = [
  { type: "user", text: "How did my Shopify store do last week vs the week before?", delay: 1000 },
  { type: "tool_start", text: "Comparing periods", delay: 1000 },
  { type: "tool_end", text: "Comparing periods", detail: "revenue: 18,115 vs 32,741 (−44.7%)", delay: 1500 },
  { type: "tool_start", text: "Scanning for anomalies", delay: 500 },
  { type: "tool_end", text: "Scanning for anomalies", detail: "AOV steady · orders −45%", delay: 2000 },
  { type: "assistant", text: "Revenue fell 44.7% to $18,115 last week. AOV held steady (+0.7%) while orders nearly halved — a traffic problem, not a pricing one.", highlight: "Audit the top of funnel for a conversion cliff starting ~6/7 and restore any paused campaign to recover the ~55 lost orders.", delay: 800 },
];

export function InteractiveDemo() {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    let timeout: NodeJS.Timeout;

    const advance = () => {
      if (currentStep < steps.length) {
        timeout = setTimeout(() => {
          setCurrentStep((prev) => prev + 1);
        }, steps[currentStep].delay);
      } else {
          timeout = setTimeout(() => {
             setCurrentStep(0);
          }, 5000);
      }
    };

    advance();
    return () => clearTimeout(timeout);
  }, [currentStep]);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 min-h-[300px]">
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900 min-h-[36px]">
          {currentStep > 0 ? steps[0].text : <span className="animate-pulse">...</span>}
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        {currentStep >= 1 && (
            <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
            {currentStep === 1 ? <Loader2 className="size-3 animate-spin text-zinc-500" /> : <span>✅</span>}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
                Comparing periods
            </span>
            {currentStep > 1 && (
                <span className="font-mono text-[11px] text-zinc-500 animate-in fade-in">
                revenue: 18,115 vs 32,741 (−44.7%)
                </span>
            )}
            </div>
        )}

        {currentStep >= 3 && (
            <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
            {currentStep === 3 ? <Loader2 className="size-3 animate-spin text-zinc-500" /> : <span>✅</span>}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
                Scanning for anomalies
            </span>
            {currentStep > 3 && (
                <span className="font-mono text-[11px] text-zinc-500 animate-in fade-in">
                AOV steady · orders −45%
                </span>
            )}
            </div>
        )}
      </div>

      {currentStep >= 5 && (
        <div className="mt-3 rounded-xl bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 animate-in fade-in slide-in-from-bottom-2">
          <strong>Revenue fell 44.7% to $18,115</strong> last week. AOV held
          steady (+0.7%) while orders nearly halved — a traffic problem, not a
          pricing one.{" "}
          <span className="text-emerald-700 dark:text-emerald-400">
            Audit the top of funnel for a conversion cliff starting ~6/7 and
            restore any paused campaign to recover the ~55 lost orders.
          </span>
        </div>
      )}
    </div>
  );
}
