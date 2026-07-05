import { Pulse, RevenueSectionSkeleton, TrafficSectionSkeleton } from "./skeletons";

/**
 * Route-level fallback shown the instant navigation to /dashboard starts,
 * before the server has resolved auth/org/connections. Mirrors the page shell
 * (header bar + title row) so the first real paint doesn't shift layout.
 */
export default function DashboardLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-black/80">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
          <Pulse className="h-4 w-64" />
          <Pulse className="h-8 w-24 rounded-md" />
        </div>
      </header>
      <main className="app-main mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <Pulse className="mt-2 h-3.5 w-56" />
          </div>
          <Pulse className="h-8 w-72 rounded-lg" />
        </div>
        <RevenueSectionSkeleton fiveCols={false} />
        <TrafficSectionSkeleton label="Google Analytics" />
      </main>
    </div>
  );
}
