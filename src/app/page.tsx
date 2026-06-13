import Link from "next/link";
import { Button } from "@/components/ui/button";

const integrations = [
  { slug: "shopify", name: "Shopify", live: true },
  { slug: "googleanalytics", name: "Google Analytics" },
  { slug: "googleads", name: "Google Ads" },
  { slug: "meta", name: "Meta Ads" },
  { slug: "mailchimp", name: "Mailchimp" },
  { slug: "klaviyo", name: "Klaviyo" },
];

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
    <div className="flex flex-1 flex-col bg-white text-zinc-900 dark:bg-black dark:text-zinc-50">
      {/* Top nav */}
      <header className="sticky top-0 z-10 border-b border-zinc-100 bg-white/70 backdrop-blur dark:border-zinc-900 dark:bg-black/70">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <span className="size-2.5 rounded-full bg-emerald-500" />
            Pulse
          </div>
          <Button size="sm" render={<Link href="/login" />}>
            Sign in
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto w-full max-w-5xl px-6 pb-20 pt-20 sm:pt-28">
        <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          AI business analyst · powered by Claude Opus 4.8
        </span>
        <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          The analyst your online store{" "}
          <span className="italic text-emerald-600 dark:text-emerald-400">
            never had.
          </span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Small businesses run on a dozen disconnected tools — Shopify, GA4,
          Ads, email — with no analyst and no single place to manage it all.
          Pulse is your one-stop shop: a{" "}
          <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
            single pane of glass
          </strong>{" "}
          that runs real tool calls over <em>your</em> data, then tells you what
          to do next — in plain English.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button size="lg" render={<Link href="/login" />}>
            Sign in with Google
          </Button>
          <Button size="lg" variant="outline" render={<a href="#how" />}>
            See it work
          </Button>
          <span className="text-sm text-zinc-500">
            Bring your own keys · your data stays yours
          </span>
        </div>
      </section>

      {/* Integrations — Postman-style logo grid */}
      <section className="border-y border-zinc-100 bg-zinc-50/60 py-16 dark:border-zinc-900 dark:bg-zinc-950/40">
        <div className="mx-auto w-full max-w-5xl px-6">
          <h2 className="text-2xl font-semibold tracking-tight">
            Connects to the tools your online store already runs on
          </h2>
          <p className="mt-2 max-w-xl text-zinc-600 dark:text-zinc-400">
            Paste a key or OAuth-connect on the Connections page. Secrets are
            encrypted server-side — never exposed to the browser.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {integrations.map((it) => (
              <div
                key={it.slug}
                className="group relative flex flex-col items-center justify-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-6 transition hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                {it.live && (
                  <span className="absolute right-2 top-2 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    Live
                  </span>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://cdn.simpleicons.org/${it.slug}`}
                  alt={`${it.name} logo`}
                  width={32}
                  height={32}
                  className="size-8"
                />
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  {it.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works — chat mockup */}
      <section id="how" className="mx-auto w-full max-w-5xl scroll-mt-20 px-6 py-20">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Ask a question.{" "}
              <span className="italic text-emerald-600 dark:text-emerald-400">
                Watch it work.
              </span>
            </h2>
            <p className="mt-4 max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
              No dashboards to read, no SQL to write. Pulse fires the tool calls
              live, pulls the real numbers, and hands you the decision — with the
              reasoning shown.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
              {[
                "Tool calls you can see, over data you own",
                "Period-over-period deltas computed on the fly",
                "One concrete recommendation, never generic advice",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <span className="mt-0.5 text-emerald-500">✓</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Mockup */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
                How did my online store do last week vs the week before?
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
                <span>✅</span>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  Comparing periods
                </span>
                <span className="font-mono text-[11px] text-zinc-500">
                  revenue: 18,115 vs 32,741 (−44.7%)
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
                <span>✅</span>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  Scanning for anomalies
                </span>
                <span className="font-mono text-[11px] text-zinc-500">
                  AOV steady · orders −45%
                </span>
              </div>
            </div>
            <div className="mt-3 rounded-xl bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
              <strong>Revenue fell 44.7% to $18,115</strong> last week. AOV held
              steady (+0.7%) while orders nearly halved — a traffic problem, not a
              pricing one.{" "}
              <span className="text-emerald-700 dark:text-emerald-400">
                Audit the top of funnel for a conversion cliff starting ~6/7 and
                restore any paused campaign to recover the ~55 lost orders.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="border-t border-zinc-100 bg-zinc-50/60 py-16 dark:border-zinc-900 dark:bg-zinc-950/40">
        <div className="mx-auto grid w-full max-w-5xl gap-4 px-6 sm:grid-cols-3">
          {capabilities.map((c) => (
            <div
              key={c.title}
              className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <h3 className="text-base font-semibold">{c.title}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {c.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto w-full max-w-5xl px-6 py-20 text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Stop reading dashboards. Start asking questions.
        </h2>
        <div className="mt-6 flex justify-center">
          <Button size="lg" render={<Link href="/login" />}>
            Sign in with Google
          </Button>
        </div>
      </section>

      <footer className="border-t border-zinc-100 py-8 dark:border-zinc-900">
        <div className="mx-auto w-full max-w-5xl px-6 text-xs text-zinc-400">
          Pulse · built for Claude Build Day · powered by Claude Opus 4.8
        </div>
      </footer>
    </div>
  );
}
