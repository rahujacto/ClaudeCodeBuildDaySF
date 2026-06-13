import Link from "next/link";
import { Button } from "@/components/ui/button";

const capabilities = [
  {
    title: "Asks your data, not its memory",
    body: "Every number traces to a real tool call over your connected store — never a hallucinated figure.",
  },
  {
    title: "Computes the comparisons",
    body: "Deltas, AOV, ROAS, CPA, conversion rate, top and bottom performers — derived on demand.",
  },
  {
    title: "Flags what's off, proactively",
    body: "“Revenue's up but AOV slipped 15% this week” — surfaced before you think to ask.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 dark:bg-black">
      <main className="flex w-full max-w-3xl flex-1 flex-col justify-center gap-12 py-24">
        <div className="flex flex-col gap-6">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Pulse · AI business analyst
          </span>
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
            The analyst your store never had.
          </h1>
          <p className="max-w-xl text-pretty text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Connect your own Shopify, GA4, and Ads, then just ask. Pulse runs
            real tool calls over <em>your</em> data, computes the comparisons,
            and recommends the next move — in plain English.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button size="lg" render={<Link href="/login" />}>
              Sign in with Google
            </Button>
            <span className="text-sm text-zinc-500">
              Bring your own keys · your data stays yours
            </span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {capabilities.map((c) => (
            <div
              key={c.title}
              className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {c.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {c.body}
              </p>
            </div>
          ))}
        </div>
      </main>
      <footer className="w-full max-w-3xl py-6 text-xs text-zinc-400">
        Built for Claude Build Day · powered by Claude Opus 4.8
      </footer>
    </div>
  );
}
