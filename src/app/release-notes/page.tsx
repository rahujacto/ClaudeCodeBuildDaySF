import { AppHeader } from "@/components/app-header";
import { RELEASES, type ChangeKind } from "@/lib/release-notes";

const KIND_STYLE: Record<ChangeKind, string> = {
  new: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  improved: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  fixed: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

function fmtDate(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function ReleaseNotesPage() {
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="app-main mx-auto w-full max-w-3xl flex-1 px-6 py-10 transition-[padding]">
        <h1 className="text-2xl font-semibold tracking-tight">Release notes</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          What&apos;s new in Pulse.
        </p>

        <div className="mt-8 flex flex-col gap-8">
          {RELEASES.map((r) => (
            <section key={r.version} className="flex flex-col gap-3">
              <div className="flex items-baseline gap-3">
                <h2 className="text-lg font-semibold tracking-tight">{r.title}</h2>
                <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:border-zinc-800">
                  v{r.version}
                </span>
                <span className="text-xs text-zinc-400">{fmtDate(r.date)}</span>
              </div>
              <ul className="flex flex-col gap-2">
                {r.items.map((it, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${KIND_STYLE[it.kind]}`}
                    >
                      {it.kind}
                    </span>
                    <span className="leading-6 text-zinc-700 dark:text-zinc-300">
                      {it.text}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
