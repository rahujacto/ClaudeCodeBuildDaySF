import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { RangeSelector } from "@/components/dashboard/range-selector";
import { SalesChart, type ChartPoint } from "@/components/dashboard/sales-chart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConnection, adapterContextFromRow } from "@/lib/connections";
import { fetchShopifyData, type ShopifyData } from "@/lib/adapters/shopify";
import {
  parseRange,
  previousRange,
  presetForRange,
  formatRangeLabel,
} from "@/lib/dates";

function totals(data: ShopifyData) {
  const revenue = data.daily.reduce((s, d) => s + d.revenue, 0);
  const orders = data.daily.reduce((s, d) => s + d.orders, 0);
  return {
    revenue,
    orders,
    aov: orders ? revenue / orders : 0,
    newCustomers: data.daily.reduce((s, d) => s + d.newCustomers, 0),
  };
}

function pct(cur: number, prev: number): number | null {
  return prev !== 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const sp = await searchParams;
  const range = parseRange(sp.start, sp.end);
  const prev = previousRange(range);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const row = await getConnection(supabase, "shopify");
  const connected = row?.status === "connected";

  let cur: ShopifyData | null = null;
  let prevData: ShopifyData | null = null;
  let error: string | null = null;

  if (connected && user) {
    try {
      const ctx = adapterContextFromRow(user.id, row);
      const secret = await ctx.getSecret();
      const clientId = ctx.config.clientId as string;
      const domain = ctx.config.domain as string;
      if (!secret || !clientId || !domain) throw new Error("Shopify is not fully configured.");
      [cur, prevData] = await Promise.all([
        fetchShopifyData(domain, clientId, secret, range),
        fetchShopifyData(domain, clientId, secret, prev),
      ]);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not load Shopify data.";
    }
  }

  const t = cur ? totals(cur) : null;
  const tp = prevData ? totals(prevData) : null;
  const chartData: ChartPoint[] =
    cur?.daily.map((d) => ({ date: d.date, revenue: d.revenue, orders: d.orders })) ?? [];

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {connected
                ? `${row?.config?.domain ?? "Shopify"} · ${formatRangeLabel(range)}`
                : "Connect Shopify to see live metrics."}
            </p>
          </div>
          {connected && <RangeSelector active={presetForRange(range)} />}
        </div>

        {!connected ? (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>No data source connected</CardTitle>
              <CardDescription>
                Connect your Shopify store to see live revenue, orders, and AOV.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button size="sm" render={<Link href="/connections" />}>
                Connect Shopify
              </Button>
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="mt-8 border-destructive/30">
            <CardHeader>
              <CardTitle>Couldn&apos;t load data</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MetricCard
                label="Revenue"
                value={`$${Math.round(t!.revenue).toLocaleString()}`}
                delta={pct(t!.revenue, tp?.revenue ?? 0)}
              />
              <MetricCard
                label="Orders"
                value={t!.orders.toLocaleString()}
                delta={pct(t!.orders, tp?.orders ?? 0)}
              />
              <MetricCard
                label="AOV"
                value={`$${t!.aov.toFixed(2)}`}
                delta={pct(t!.aov, tp?.aov ?? 0)}
              />
              <MetricCard
                label="New customers"
                value={t!.newCustomers.toLocaleString()}
                delta={pct(t!.newCustomers, tp?.newCustomers ?? 0)}
              />
            </div>

            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-base">Revenue trend</CardTitle>
                <CardDescription>
                  vs. prior {formatRangeLabel(prev)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {chartData.length ? (
                  <SalesChart data={chartData} />
                ) : (
                  <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
                    No orders in this range.
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Top products</CardTitle>
                  <CardDescription>By revenue, this range</CardDescription>
                </CardHeader>
                <CardContent>
                  {cur!.products.length ? (
                    <ul className="flex flex-col gap-2.5">
                      {cur!.products.slice(0, 5).map((p, i) => (
                        <li key={p.title} className="flex items-center gap-3 text-sm">
                          <span className="w-4 text-zinc-400">{i + 1}</span>
                          <span className="flex-1 truncate">{p.title}</span>
                          <span className="font-medium tabular-nums">
                            ${Math.round(p.revenue).toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-zinc-500">No products in this range.</p>
                  )}
                </CardContent>
              </Card>

              <Card className="flex flex-col justify-between">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Ask your analyst</CardTitle>
                    <Badge variant="secondary">live</Badge>
                  </div>
                  <CardDescription>
                    The chat uses this same date range. Ask it what changed and
                    what to do next.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button size="sm" render={<Link href="/chat" />}>
                    Open chat
                  </Button>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function MetricCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta: number | null;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {delta !== null && (
        <div
          className={`mt-1 text-xs font-medium ${
            up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
          }`}
        >
          {up ? "▲" : "▼"} {Math.abs(delta)}% vs prior period
        </div>
      )}
    </div>
  );
}
