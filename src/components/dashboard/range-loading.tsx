"use client";

import {
  createContext,
  useCallback,
  useContext,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

type RangeLoading = {
  /** True while a range/comparison change is being fetched on the server. */
  pending: boolean;
  /** Navigate to a new dashboard URL inside a transition so the old cards stay
   *  visible (dimmed with a spinner) instead of blanking out. */
  navigate: (url: string) => void;
};

const RangeLoadingContext = createContext<RangeLoading>({
  pending: false,
  navigate: () => {},
});

export function RangeLoadingProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigate = useCallback(
    (url: string) => {
      startTransition(() => {
        router.push(url);
        router.refresh();
      });
    },
    [router],
  );
  return (
    <RangeLoadingContext.Provider value={{ pending, navigate }}>
      {children}
    </RangeLoadingContext.Provider>
  );
}

export function useRangeLoading() {
  return useContext(RangeLoadingContext);
}

/** Spinner that shows only while a range change is being fetched. Drop it into
 *  any card/section header so each one signals it's refreshing. */
export function RangeSpinner({ className = "" }: { className?: string }) {
  const { pending } = useRangeLoading();
  if (!pending) return null;
  return (
    <Loader2
      className={`animate-spin text-zinc-400 ${className}`}
      aria-label="Refreshing"
    />
  );
}

/**
 * Metric-card container that, while a range change is being fetched, greys out
 * its content and overlays a centred spinner — so the shown numbers clearly
 * read as stale/loading rather than current.
 */
export function MetricCardBody({ children }: { children: ReactNode }) {
  const { pending } = useRangeLoading();
  return (
    <div className="relative min-w-0 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div
        className={`transition-opacity ${pending ? "opacity-30" : ""}`}
        aria-hidden={pending}
      >
        {children}
      </div>
      {pending && (
        <div className="absolute inset-0 grid place-items-center">
          <Loader2 className="size-5 animate-spin text-zinc-400" aria-label="Refreshing" />
        </div>
      )}
    </div>
  );
}
