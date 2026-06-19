import type { ReactNode } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { RangeSelector } from "@/components/dashboard/range-selector";
import { CombinedChart, type ComboPoint } from "@/components/dashboard/combined-chart";
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
import { getCurrentOrg } from "@/lib/org";
import { fetchShopifyData, type ShopifyData } from "@/lib/adapters/shopify";
import { fetchGa4Data, fetchGa4SchoolTraffic, type Ga4Data } from "@/lib/adapters/ga4";
import { seededGoogleAdsDaily, adsTotals, adsByCampaign, type AdsTotals, type AdsCampaign } from "@/lib/adapters/google-ads";
import { fetchMetaAdsForAccounts, metaByAccount, type MetaAccountTotals } from "@/lib/adapters/meta-ads";
import type { MetaAccount } from "@/lib/adapters/types";
import { bySchool, type SchoolTraffic } from "@/lib/schools";
import { SchoolChart } from "@/components/dashboard/school-chart";
import { ConversionQuadrant } from "@/components/dashboard/conversion-quadrant";
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

function ga4Totals(data: Ga4Data) {
  return {
    sessions: data.daily.reduce((s, d) => s + d.sessions, 0),
    users: data.daily.reduce((s, d) => s + d.users, 0),
    newUsers: data.daily.reduce((s, d) => s + d.newUsers, 0),
  };
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
  const { orgId } = await getCurrentOrg(supabase);
  const row = await getConnection(supabase, orgId, "shopify");
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

  // GA4 (optional, independent of Shopify).
  const ga4Row = await getConnection(supabase, orgId, "ga4");
  const ga4Connected =
    ga4Row?.status === "connected" && Boolean(ga4Row?.config?.propertyId);
  let ga4Cur: Ga4Data | null = null;
  let ga4Prev: Ga4Data | null = null;
  let schoolTraffic: SchoolTraffic[] = [];
  if (ga4Connected && user) {
    try {
      const gctx = adapterContextFromRow(user.id, ga4Row);
      const refresh = await gctx.getSecret();
      const propertyId = gctx.config.propertyId as string;
      if (refresh && propertyId) {
        const [c, p, st] = await Promise.all([
          fetchGa4Data(refresh, propertyId, range),
          fetchGa4Data(refresh, propertyId, prev),
          fetchGa4SchoolTraffic(refresh, propertyId, range),
        ]);
        ga4Cur = c;
        ga4Prev = p;
        schoolTraffic = st;
      }
    } catch {
      // GA4 is optional on the dashboard; ignore failures
    }
  }
  const schools = cur ? bySchool(cur.products, schoolTraffic) : [];

  // Google Ads (seeded).
  const adsRow = await getConnection(supabase, orgId, "google_ads");
  const adsConnected = adsRow?.status === "seeded" || adsRow?.status === "connected";
  let adsCur: AdsTotals | null = null;
  let adsPrev: AdsTotals | null = null;
  let adsCampaigns: AdsCampaign[] = [];
  if (adsConnected && user) {
    adsCur = adsTotals(seededGoogleAdsDaily(orgId, range));
    adsPrev = adsTotals(seededGoogleAdsDaily(orgId, prev));
    adsCampaigns = adsByCampaign(seededGoogleAdsDaily(orgId, range));
  }

  // Meta Ads (live Marketing API, one or more ad accounts).
  const metaRow = await getConnection(supabase, orgId, "meta_ads");
  const metaAccounts: MetaAccount[] =
    metaRow?.status === "connected"
      ? Array.isArray(metaRow.config?.accounts)
        ? (metaRow.config.accounts as MetaAccount[])
        : metaRow.config?.adAccountId
          ? [{ adAccountId: metaRow.config.adAccountId as string, accountName: (metaRow.config.accountName as string) ?? "" }]
          : []
      : [];
  const metaConnected = metaAccounts.length > 0;
  let metaCur: AdsTotals | null = null;
  let metaPrev: AdsTotals | null = null;
  let metaCampaigns: AdsCampaign[] = [];
  let metaPerAccount: MetaAccountTotals[] = [];
  if (metaConnected && user) {
    try {
      const mctx = adapterContextFromRow(user.id, metaRow);
      const token = await mctx.getSecret();
      if (token) {
        const [mc, mp] = await Promise.all([
          fetchMetaAdsForAccounts(metaAccounts, token, range),
          fetchMetaAdsForAccounts(metaAccounts, token, prev),
        ]);
        metaCur = adsTotals(mc);
        metaPrev = adsTotals(mp);
        metaCampaigns = adsByCampaign(mc);
        metaPerAccount = metaByAccount(mc);
      }
    } catch {
      // Meta is live; token may expire — degrade gracefully
    }
  }
  const g = ga4Cur ? ga4Totals(ga4Cur) : null;
  const gp = ga4Prev ? ga4Totals(ga4Prev) : null;
  const ga4Max = ga4Cur?.channels[0]?.sessions ?? 0;

  const t = cur ? totals(cur) : null;
  const tp = prevData ? totals(prevData) : null;

  // Merge Shopify revenue + GA4 sessions per day for the combined chart.
  const revByDate = new Map(cur?.daily.map((d) => [d.date, d.revenue]) ?? []);
  const sessByDate = new Map(ga4Cur?.daily.map((d) => [d.date, d.sessions]) ?? []);
  const allDates = [...new Set([...revByDate.keys(), ...sessByDate.keys()])].sort();
  const chartData: ComboPoint[] = allDates.map((date) => ({
    date,
    revenue: revByDate.get(date) ?? 0,
    sessions: ga4Connected ? (sessByDate.get(date) ?? 0) : null,
  }));

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="app-main mx-auto w-full max-w-5xl flex-1 px-6 py-8 transition-[padding]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {connected
                ? `${row?.config?.domain ?? "Shopify"} · ${formatRangeLabel(range)}`
                : "Connect Shopify to see live metrics."}
            </p>
          </div>
          {connected && (
            <RangeSelector
              active={presetForRange(range)}
              start={range.start}
              end={range.end}
            />
          )}
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
            <RowLabel>Shopify</RowLabel>
            <div className="mt-2 grid grid-cols-2 gap-4 lg:grid-cols-4">
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

            {ga4Connected && g && (
              <>
                <RowLabel>
                  Google Analytics
                  {ga4Row?.config?.displayName ? (
                    <span className="ml-2 font-normal normal-case text-zinc-400">
                      {String(ga4Row.config.displayName)}
                    </span>
                  ) : null}
                </RowLabel>
                <div className="mt-2 grid grid-cols-3 gap-4">
                  <MetricCard
                    label="Sessions"
                    value={g.sessions.toLocaleString()}
                    delta={pct(g.sessions, gp?.sessions ?? 0)}
                  />
                  <MetricCard
                    label="Users"
                    value={g.users.toLocaleString()}
                    delta={pct(g.users, gp?.users ?? 0)}
                  />
                  <MetricCard
                    label="New users"
                    value={g.newUsers.toLocaleString()}
                    delta={pct(g.newUsers, gp?.newUsers ?? 0)}
                  />
                </div>

                <Card className="mt-4">
                  <CardHeader>
                    <CardTitle className="text-base">Top channels</CardTitle>
                    <CardDescription>By sessions, this range</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {ga4Cur!.channels.length ? (
                      <ul className="flex flex-col gap-2.5">
                        {ga4Cur!.channels.slice(0, 6).map((c) => (
                          <li key={c.channel} className="flex items-center gap-3 text-sm">
                            <span className="w-44 shrink-0 text-zinc-700 dark:text-zinc-300">
                              {c.channel}
                            </span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                              <div
                                className="h-2 rounded-full bg-blue-500"
                                style={{
                                  width: `${ga4Max ? Math.round((c.sessions / ga4Max) * 100) : 0}%`,
                                }}
                              />
                            </div>
                            <span className="w-20 shrink-0 text-right font-medium tabular-nums">
                              {c.sessions.toLocaleString()}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-zinc-500">No channel data.</p>
                    )}
                  </CardContent>
                </Card>
              </>
            )}

            {adsConnected && adsCur && (
              <>
                <RowLabel>
                  Google Ads
                  <span className="ml-2 font-normal normal-case text-zinc-400">
                    seeded
                  </span>
                </RowLabel>
                <div className="mt-2 grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <MetricCard
                    label="Ad spend"
                    value={`$${Math.round(adsCur.spend).toLocaleString()}`}
                    delta={pct(adsCur.spend, adsPrev?.spend ?? 0)}
                  />
                  <MetricCard
                    label="Conversions"
                    value={adsCur.conversions.toLocaleString()}
                    delta={pct(adsCur.conversions, adsPrev?.conversions ?? 0)}
                  />
                  <MetricCard
                    label="ROAS"
                    value={`${adsCur.roas.toFixed(2)}×`}
                    delta={pct(adsCur.roas, adsPrev?.roas ?? 0)}
                  />
                  <MetricCard
                    label="CPA"
                    value={`$${adsCur.cpa.toFixed(2)}`}
                    delta={pct(adsCur.cpa, adsPrev?.cpa ?? 0)}
                  />
                </div>

                <Card className="mt-4">
                  <CardHeader>
                    <CardTitle className="text-base">Campaign performance</CardTitle>
                    <CardDescription>By spend, this range (seeded)</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-2 text-sm">
                      <div className="text-xs font-medium text-zinc-500">Campaign</div>
                      <div className="text-right text-xs font-medium text-zinc-500">Spend</div>
                      <div className="text-right text-xs font-medium text-zinc-500">ROAS</div>
                      <div className="text-right text-xs font-medium text-zinc-500">CPA</div>
                      {adsCampaigns.map((c) => (
                        <RowCells key={c.campaign} c={c} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {metaConnected && metaCur && (
              <>
                <RowLabel>
                  Meta Ads
                  <span className="ml-2 font-normal normal-case text-zinc-400">
                    live · {metaAccounts.length} account{metaAccounts.length > 1 ? "s" : ""}
                  </span>
                </RowLabel>
                <div className="mt-2 grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <MetricCard
                    label="Ad spend"
                    value={`$${Math.round(metaCur.spend).toLocaleString()}`}
                    delta={pct(metaCur.spend, metaPrev?.spend ?? 0)}
                  />
                  <MetricCard
                    label="Conversions"
                    value={metaCur.conversions.toLocaleString()}
                    delta={pct(metaCur.conversions, metaPrev?.conversions ?? 0)}
                  />
                  <MetricCard
                    label="ROAS"
                    value={`${metaCur.roas.toFixed(2)}×`}
                    delta={pct(metaCur.roas, metaPrev?.roas ?? 0)}
                  />
                  <MetricCard
                    label="CPA"
                    value={`$${metaCur.cpa.toFixed(2)}`}
                    delta={pct(metaCur.cpa, metaPrev?.cpa ?? 0)}
                  />
                </div>
                {metaPerAccount.length > 1 && (
                  <Card className="mt-4">
                    <CardHeader>
                      <CardTitle className="text-base">By ad account</CardTitle>
                      <CardDescription>Instagram vs Facebook (live)</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-2 text-sm">
                        <div className="text-xs font-medium text-zinc-500">Account</div>
                        <div className="text-right text-xs font-medium text-zinc-500">Spend</div>
                        <div className="text-right text-xs font-medium text-zinc-500">ROAS</div>
                        <div className="text-right text-xs font-medium text-zinc-500">CPA</div>
                        {metaPerAccount.map((a) => (
                          <RowCells key={a.account} c={{ ...a, campaign: a.account }} />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {metaCampaigns.length > 0 && (
                  <Card className="mt-4">
                    <CardHeader>
                      <CardTitle className="text-base">Meta campaign performance</CardTitle>
                      <CardDescription>By spend, this range (live)</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-2 text-sm">
                        <div className="text-xs font-medium text-zinc-500">Campaign</div>
                        <div className="text-right text-xs font-medium text-zinc-500">Spend</div>
                        <div className="text-right text-xs font-medium text-zinc-500">ROAS</div>
                        <div className="text-right text-xs font-medium text-zinc-500">CPA</div>
                        {metaCampaigns.slice(0, 8).map((c) => (
                          <RowCells key={c.campaign} c={c} />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="text-base">
                  {ga4Connected ? "Revenue & traffic" : "Revenue trend"}
                </CardTitle>
                <CardDescription>
                  Over {formatRangeLabel(range)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {chartData.length ? (
                  <CombinedChart data={chartData} hasGa4={ga4Connected && !!ga4Cur} />
                ) : (
                  <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
                    No data in this range.
                  </div>
                )}
              </CardContent>
            </Card>

            {schools.length > 0 && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle className="text-base">Revenue by school</CardTitle>
                  <CardDescription>
                    Top schools by revenue
                    {ga4Connected ? " — hover for product-page traffic" : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <SchoolChart data={schools} />
                </CardContent>
              </Card>
            )}

            {ga4Connected && schools.some((s) => s.sessions > 0) && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle className="text-base">
                    Where to spend your next marketing dollar
                  </CardTitle>
                  <CardDescription>
                    Each school by product-page traffic vs. revenue per session.
                    Top-left converts well but is under-visited; bottom-right gets
                    traffic that isn&apos;t converting.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ConversionQuadrant data={schools} />
                </CardContent>
              </Card>
            )}

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
                    The assistant is docked on the right and uses this same date
                    range. Ask it what changed and what to do next.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-zinc-500">
                    Look for{" "}
                    <span className="font-medium text-foreground">
                      “Ask Pulse”
                    </span>{" "}
                    on the right →
                  </p>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function RowCells({ c }: { c: AdsCampaign }) {
  const lowRoas = c.roas < 2;
  return (
    <>
      <div className="truncate">{c.campaign}</div>
      <div className="text-right tabular-nums">${Math.round(c.spend).toLocaleString()}</div>
      <div
        className={`text-right tabular-nums ${lowRoas ? "font-medium text-amber-600 dark:text-amber-400" : ""}`}
      >
        {c.roas.toFixed(2)}×
      </div>
      <div className="text-right tabular-nums">${c.cpa.toFixed(2)}</div>
    </>
  );
}

function RowLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </h2>
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
