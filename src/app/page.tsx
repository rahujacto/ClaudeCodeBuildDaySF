import Link from "next/link";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductDemo } from "@/components/landing/product-demo";

const integrations: {
  name: string;
  slug?: string;
  live?: boolean;
}[] = [
  { slug: "shopify", name: "Shopify", live: true },
  { slug: "googleanalytics", name: "Google Analytics" },
  { slug: "googleads", name: "Google Ads" },
  { slug: "meta", name: "Meta Ads" },
  { slug: "mailchimp", name: "Mailchimp" },
  { name: "Shippo" }, // no Simple Icons logo — rendered with an inline icon
];

const capabilities = [
  {
    title: "Every number has a source",
    body: "Answers come from live queries against your connected accounts. If a source is down, Pulse says so instead of guessing.",
  },
  {
    title: "Does the math for you",
    body: "Deltas, AOV, ROAS, CPA, conversion rate, best and worst performers — computed for whatever range you're looking at.",
  },
  {
    title: "Speaks up first",
    body: "“Revenue's up but AOV slipped 15% this week” — surfaced before you thought to ask, with one concrete thing to do about it.",
  },
];

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-emerald-500" />
      {children}
    </li>
  );
}

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
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">
          Agentic marketing manager for Shopify
        </p>
        <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          The marketing manager your store never had.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Pulse connects to Shopify, GA4, Google Ads, Meta, and Mailchimp. It
          answers with live queries against your own data, tells you what
          changed and why it matters, and makes the changes you approve.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button size="lg" render={<Link href="/login" />}>
            Sign in with Google
          </Button>
          <Button size="lg" variant="outline" render={<a href="#how" />}>
            Watch the demo
          </Button>
          <span className="text-sm text-zinc-500">
            Bring your own keys. Your data stays yours.
          </span>
        </div>
      </section>

      {/* Integrations */}
      <section className="border-y border-zinc-100 bg-zinc-50/60 py-16 dark:border-zinc-900 dark:bg-zinc-950/40">
        <div className="mx-auto w-full max-w-5xl px-6">
          <h2 className="text-2xl font-semibold tracking-tight">
            Works with the tools your store already runs on
          </h2>
          <p className="mt-2 max-w-xl text-zinc-600 dark:text-zinc-400">
            Paste a key or connect with OAuth on the Connections page. Secrets
            are encrypted on the server and never reach the browser.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {integrations.map((it) => (
              <div
                key={it.name}
                className="group relative flex flex-col items-center justify-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-6 transition hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                {it.live && (
                  <span className="absolute right-2 top-2 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    Live
                  </span>
                )}
                {it.slug ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`https://cdn.simpleicons.org/${it.slug}`}
                    alt={`${it.name} logo`}
                    width={32}
                    height={32}
                    className="size-8"
                  />
                ) : (
                  <Truck className="size-8 text-emerald-600 dark:text-emerald-400" strokeWidth={1.5} />
                )}
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  {it.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works — live demo */}
      <section id="how" className="mx-auto w-full max-w-5xl scroll-mt-20 px-6 py-20">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Ask in plain English. Check the work.
          </h2>
          <p className="mt-4 text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Every answer starts with tool calls against your live data. You
            see each query as it runs, the numbers it returns, and the
            reasoning that follows — then Pulse proposes the fix and applies
            it once you approve.
          </p>
        </div>
        <div className="mt-10">
          <ProductDemo />
        </div>
        <ul className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-sm text-zinc-600 dark:text-zinc-400">
          <Bullet>Live queries you can inspect, over data you own</Bullet>
          <Bullet>Week-over-week and year-over-year math done for you</Bullet>
          <Bullet>One specific recommendation, not a page of hedging</Bullet>
        </ul>
      </section>

      {/* Agentic actions */}
      <section className="mx-auto w-full max-w-5xl px-6 py-20">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          {/* Approval card mockup */}
          <div className="order-2 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm lg:order-1 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                Suggested action · Google Ads → Shopify
              </div>
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                Needs approval
              </span>
            </div>

            <p className="mt-4 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
              <strong>“Doctoral Hood — Westfield University”</strong> is
              converting <strong>2.3× above your account average</strong> over
              the last 48h — but its ad set is capped at budget and losing
              impression share.
            </p>

            <div className="mt-4 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-950">
              <div className="text-xs font-medium text-zinc-500">
                Proposed change
              </div>
              <div className="mt-1 text-sm">
                Raise daily budget on the{" "}
                <span className="font-medium">“Westfield Regalia”</span> creative from{" "}
                <span className="font-mono">$60</span> →{" "}
                <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  $100
                </span>
              </div>
              <div className="mt-2 text-xs text-zinc-500">
                Projected: <span className="text-emerald-600 dark:text-emerald-400">+6–9 orders/day</span> at current ROAS
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white">
                Approve &amp; apply
              </button>
              <button className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                Dismiss
              </button>
            </div>
            <p className="mt-3 text-center text-[11px] text-zinc-400">
              Every change is logged and reversible
            </p>
          </div>

          {/* Copy */}
          <div className="order-1 lg:order-2">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Finds the winner. Drafts the change. Waits for you.
            </h2>
            <p className="mt-4 max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
              When a product converts well but its campaign is capped, Pulse
              notices, writes up the change it wants to make, and shows the
              projected impact. Nothing runs until you approve it.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
              <Bullet>Works across sources — a Shopify winner becomes a Google Ads budget change</Bullet>
              <Bullet>Approval first — no silent edits to your campaigns</Bullet>
              <Bullet>Small, reversible steps instead of big rewrites</Bullet>
            </ul>
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
          Your store already has the data.
          <br className="hidden sm:block" /> Now it has the manager.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Connecting your tools takes a few minutes. The first useful answer
          takes about one more.
        </p>
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
