import type { ReactNode } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { RangeSelector } from "@/components/dashboard/range-selector";
import { CombinedChart, type ComboPoint } from "@/components/dashboard/combined-chart";
import { Button } from "@/components/ui/button";
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
import { fetchShopifyDataCached, type ShopifyData } from "@/lib/adapters/shopify";
import {
  fetchGa4Data,
  fetchGa4SchoolTraffic,
  fetchGa4Regions,
  type Ga4Data,
  type Ga4Region,
} from "@/lib/adapters/ga4";
import {
  adsTotals,
  adsByCampaign,
  type AdsTotals,
  type AdsCampaign,
  type AdsSegment,
} from "@/lib/adapters/google-ads";
import { loadGoogleAdsDaily, loadGoogleAdsTargeting } from "@/lib/adapters/google-ads-live";
import { MetaAccountToggle } from "@/components/dashboard/meta-account-toggle";
import { Section } from "@/components/dashboard/section";
import { CollapsibleCard } from "@/components/dashboard/collapsible-card";
import { BrandIcon } from "@/components/brand-icon";
import { DollarSign, Activity, Megaphone, Share2, Mail } from "lucide-react";
import { fetchMailchimpData, type MailchimpData } from "@/lib/adapters/mailchimp";
import {
  fetchMetaAdsForAccounts,
  metaByAccount,
  fetchMetaReachForAccounts,
  combineReach,
  fetchMetaAudience,
  fetchMetaGeo,
  type MetaAccountTotals,
  type MetaReach,
} from "@/lib/adapters/meta-ads";
import type { MetaAccount } from "@/lib/adapters/types";
import { bySchool, type SchoolTraffic } from "@/lib/schools";
import { SchoolChart } from "@/components/dashboard/school-chart";
import {
  parseRange,
  previousRange,
  presetForRange,
  formatRangeLabel,
  ytdRange,
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
  // Default to Year-to-date when no explicit range is in the URL.
  const range = sp.start && sp.end ? parseRange(sp.start, sp.end) : ytdRange();
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
        fetchShopifyDataCached(orgId, domain, clientId, secret, range),
        fetchShopifyDataCached(orgId, domain, clientId, secret, prev),
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
  let ga4Regions: Ga4Region[] = [];
  if (ga4Connected && user) {
    try {
      const gctx = adapterContextFromRow(user.id, ga4Row);
      const refresh = await gctx.getSecret();
      const propertyId = gctx.config.propertyId as string;
      if (refresh && propertyId) {
        const [c, p, st, rg] = await Promise.all([
          fetchGa4Data(refresh, propertyId, range),
          fetchGa4Data(refresh, propertyId, prev),
          fetchGa4SchoolTraffic(refresh, propertyId, range),
          fetchGa4Regions(refresh, propertyId, range),
        ]);
        ga4Cur = c;
        ga4Prev = p;
        schoolTraffic = st;
        ga4Regions = rg;
      }
    } catch {
      // GA4 is optional on the dashboard; ignore failures
    }
  }
  const schools = cur ? bySchool(cur.products, schoolTraffic) : [];

  // Daily ad spend per date (Google Ads + Meta), for the combined chart.
  const adSpendDaily: { date: string; spend: number }[] = [];

  // Google Ads — live when the connection is `connected`, else seeded.
  const adsRow = await getConnection(supabase, orgId, "google_ads");
  const adsConnected = adsRow?.status === "seeded" || adsRow?.status === "connected";
  let adsCur: AdsTotals | null = null;
  let adsPrev: AdsTotals | null = null;
  let adsCampaigns: AdsCampaign[] = [];
  let adsAudience: AdsSegment[] = [];
  let adsGeo: AdsSegment[] = [];
  let adsLive = false;
  let adsTargetingLive = false;
  if (adsConnected && user) {
    const [curRows, prevRows, targeting] = await Promise.all([
      loadGoogleAdsDaily(orgId, adsRow, range),
      loadGoogleAdsDaily(orgId, adsRow, prev),
      loadGoogleAdsTargeting(orgId, adsRow, range),
    ]);
    adsLive = curRows.live;
    adsCur = adsTotals(curRows.rows);
    adsPrev = adsTotals(prevRows.rows);
    adsCampaigns = adsByCampaign(curRows.rows);
    adsAudience = targeting.audience;
    adsGeo = targeting.geo;
    adsTargetingLive = targeting.live;
    adSpendDaily.push(...curRows.rows.map((r) => ({ date: r.date, spend: r.spend })));
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
  let metaPerAccountPrev: MetaAccountTotals[] = [];
  let metaReach: MetaReach[] = [];
  let metaReachPrev: MetaReach[] = [];
  let metaReachTotal = { reach: 0, frequency: 0 };
  let metaReachTotalPrev = { reach: 0, frequency: 0 };
  let metaAudience: AdsSegment[] = [];
  let metaGeo: AdsSegment[] = [];
  if (metaConnected && user) {
    try {
      const mctx = adapterContextFromRow(user.id, metaRow);
      const token = await mctx.getSecret();
      if (token) {
        const [mc, mp, mr, mrp] = await Promise.all([
          fetchMetaAdsForAccounts(metaAccounts, token, range),
          fetchMetaAdsForAccounts(metaAccounts, token, prev),
          fetchMetaReachForAccounts(metaAccounts, token, range),
          fetchMetaReachForAccounts(metaAccounts, token, prev),
        ]);
        metaCur = adsTotals(mc);
        metaPrev = adsTotals(mp);
        metaCampaigns = adsByCampaign(mc);
        metaPerAccount = metaByAccount(mc);
        metaPerAccountPrev = metaByAccount(mp);
        metaReach = mr;
        metaReachPrev = mrp;
        metaReachTotal = combineReach(mr);
        metaReachTotalPrev = combineReach(mrp);
        adSpendDaily.push(...mc.map((r) => ({ date: r.date, spend: r.spend })));
        // Targeting breakdowns are optional — a failure here must not drop the
        // core spend/ROAS metrics fetched above.
        try {
          const [aud, geo] = await Promise.all([
            fetchMetaAudience(metaAccounts, token, range),
            fetchMetaGeo(metaAccounts, token, range),
          ]);
          metaAudience = aud;
          metaGeo = geo;
        } catch {
          // breakdowns unavailable (permissions / API) — hide the panel
        }
      }
    } catch {
      // Meta is live; token may expire — degrade gracefully
    }
  }
  // Label every CONNECTED account (even zero-spend ones, which produce no data
  // rows and would otherwise drop out of the by-account breakdown).
  const metaZero = adsTotals([]);
  const metaNamed = metaConnected
    ? metaAccounts.map((acc) => {
        const name = (acc.accountName || "").trim() || `act_${acc.adAccountId}`;
        const cur =
          metaPerAccount.find((a) => a.account === name) ?? { ...metaZero, account: name };
        const prv = metaPerAccountPrev.find((a) => a.account === name);
        const reach = metaReach.find((r) => r.account === name);
        const reachPrev = metaReachPrev.find((r) => r.account === name);
        return { name, cur, prv, reach, reachPrev };
      })
    : [];

  // Email marketing (Mailchimp), stored under the generic "email" source.
  const emailRow = await getConnection(supabase, orgId, "email");
  const emailConnected = emailRow?.status === "connected";
  let mailCur: MailchimpData | null = null;
  let mailPrev: MailchimpData | null = null;
  if (emailConnected && user) {
    try {
      const ectx = adapterContextFromRow(user.id, emailRow);
      const apiKey = await ectx.getSecret();
      if (apiKey) {
        const [mc, mp] = await Promise.all([
          fetchMailchimpData(apiKey, range),
          fetchMailchimpData(apiKey, prev),
        ]);
        mailCur = mc;
        mailPrev = mp;
      }
    } catch {
      // Email is optional on the dashboard; ignore failures.
    }
  }

  const g = ga4Cur ? ga4Totals(ga4Cur) : null;
  const gp = ga4Prev ? ga4Totals(ga4Prev) : null;
  const ga4Max = ga4Cur?.channels[0]?.sessions ?? 0;
  const regionMax = ga4Regions[0]?.sessions ?? 0;

  const t = cur ? totals(cur) : null;
  const tp = prevData ? totals(prevData) : null;

  // Sales-channel breakdown (incl. agentic AI storefronts).
  const channelMax = cur?.channels[0]?.revenue ?? 0;
  const aiRevenue = cur?.channels.reduce((s, c) => s + (c.ai ? c.revenue : 0), 0) ?? 0;
  const aiSharePct =
    t && t.revenue ? Math.round((aiRevenue / t.revenue) * 1000) / 10 : 0;

  // Conversion rate = Shopify orders ÷ GA4 sessions (needs GA4 for sessions).
  const convRate = t && g && g.sessions ? (t.orders / g.sessions) * 100 : null;
  const convRatePrev = tp && gp && gp.sessions ? (tp.orders / gp.sessions) * 100 : null;

  // Cross-platform advertising rollup (Google Ads + Meta).
  const adSpendByDate = new Map<string, number>();
  for (const r of adSpendDaily) {
    adSpendByDate.set(r.date, (adSpendByDate.get(r.date) ?? 0) + r.spend);
  }
  const hasAds = adSpendDaily.length > 0;
  const allAds = (() => {
    const spend = (adsCur?.spend ?? 0) + (metaCur?.spend ?? 0);
    const impressions = (adsCur?.impressions ?? 0) + (metaCur?.impressions ?? 0);
    const value = (adsCur?.conversionValue ?? 0) + (metaCur?.conversionValue ?? 0);
    const spendPrev = (adsPrev?.spend ?? 0) + (metaPrev?.spend ?? 0);
    const imprPrev = (adsPrev?.impressions ?? 0) + (metaPrev?.impressions ?? 0);
    const valuePrev = (adsPrev?.conversionValue ?? 0) + (metaPrev?.conversionValue ?? 0);
    return {
      spend,
      impressions,
      roas: spend ? value / spend : 0,
      reach: metaReachTotal.reach, // unique reach is Meta-only
      spendPrev,
      imprPrev,
      roasPrev: spendPrev ? valuePrev / spendPrev : 0,
      reachPrev: metaReachTotalPrev.reach,
    };
  })();

  // Merge Shopify revenue + GA4 sessions + ad spend per day for the combined chart.
  const revByDate = new Map(cur?.daily.map((d) => [d.date, d.revenue]) ?? []);
  const sessByDate = new Map(ga4Cur?.daily.map((d) => [d.date, d.sessions]) ?? []);
  const allDates = [...new Set([...revByDate.keys(), ...sessByDate.keys()])].sort();
  const chartData: ComboPoint[] = allDates.map((date) => ({
    date,
    revenue: revByDate.get(date) ?? 0,
    sessions: ga4Connected ? (sessByDate.get(date) ?? 0) : null,
    adSpend: hasAds ? (adSpendByDate.get(date) ?? 0) : null,
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
            <Section
              title="Revenue"
              icon={<DollarSign className="size-5" />}
              sublabel={<PlatformTag slug="shopify" name="Shopify" />}
              prominent
            >
              <div
                className={`mt-2 grid grid-cols-2 gap-4 ${
                  convRate !== null ? "sm:grid-cols-3 xl:grid-cols-5" : "lg:grid-cols-4"
                }`}
              >
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
                {convRate !== null && (
                  <MetricCard
                    label="Conversion rate"
                    value={`${convRate.toFixed(2)}%`}
                    delta={pct(convRate, convRatePrev ?? 0)}
                  />
                )}
                <MetricCard
                  label="New customers"
                  value={t!.newCustomers.toLocaleString()}
                  delta={pct(t!.newCustomers, tp?.newCustomers ?? 0)}
                />
              </div>

              {cur!.channels.length > 0 && (
                <div className="mt-4">
                  <CollapsibleCard
                    className=""
                    title="Sales by channel"
                    description={
                      aiRevenue > 0
                        ? `$${Math.round(aiRevenue).toLocaleString()} from AI storefronts (${aiSharePct}% of revenue), this range`
                        : "Revenue by sales channel, this range"
                    }
                  >
                    <ul className="flex flex-col gap-2.5">
                      {cur!.channels.slice(0, 8).map((c) => (
                        <li key={c.channel} className="flex items-center gap-3 text-sm">
                          <span className="flex w-44 shrink-0 items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
                            <span className="truncate">{c.channel}</span>
                            {c.ai && (
                              <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                                AI
                              </span>
                            )}
                          </span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <div
                              className={`h-2 rounded-full ${c.ai ? "bg-emerald-500" : "bg-blue-500"}`}
                              style={{
                                width: `${channelMax ? Math.round((c.revenue / channelMax) * 100) : 0}%`,
                              }}
                            />
                          </div>
                          <span className="w-24 shrink-0 text-right font-medium tabular-nums">
                            ${Math.round(c.revenue).toLocaleString()}
                          </span>
                          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-zinc-400">
                            {c.orders.toLocaleString()} ord
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CollapsibleCard>
                </div>
              )}
            </Section>

            {ga4Connected && g && (
              <Section
                title="Traffic"
                icon={<Activity className="size-5" />}
                prominent
                sublabel={
                  <PlatformTag
                    slug="googleanalytics"
                    name={
                      ga4Row?.config?.displayName
                        ? `Google Analytics · ${String(ga4Row.config.displayName)}`
                        : "Google Analytics"
                    }
                  />
                }
              >
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

                <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
                <CollapsibleCard
                  className=""
                  title="Top channels"
                  description="By sessions, this range"
                >
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
                </CollapsibleCard>

                <CollapsibleCard
                  className=""
                  title="Top locations"
                  description="Top 10 states/regions by sessions, this range"
                >
                  {ga4Regions.length ? (
                    <ul className="flex flex-col gap-2.5">
                      {ga4Regions.map((rg) => (
                        <li key={rg.region} className="flex items-center gap-3 text-sm">
                          <span className="w-44 shrink-0 truncate text-zinc-700 dark:text-zinc-300">
                            {rg.region}
                          </span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <div
                              className="h-2 rounded-full bg-blue-500"
                              style={{
                                width: `${regionMax ? Math.round((rg.sessions / regionMax) * 100) : 0}%`,
                              }}
                            />
                          </div>
                          <span className="w-20 shrink-0 text-right font-medium tabular-nums">
                            {rg.sessions.toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-zinc-500">No location data.</p>
                  )}
                </CollapsibleCard>
                </div>
              </Section>
            )}

            {(adsConnected || metaConnected) && (
              <Section
                title="Ads"
                icon={<Megaphone className="size-5" />}
                sublabel={
                  <span className="inline-flex items-center gap-3">
                    <PlatformTag slug="googleads" name="Google Ads" />
                    <PlatformTag slug="meta" name="Meta" />
                  </span>
                }
                prominent
              >
                {(adsCur || metaCur) && (
                  <>
                <div className="mt-2 grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <MetricCard
                    label="Total ad spend"
                    value={`$${Math.round(allAds.spend).toLocaleString()}`}
                    delta={pct(allAds.spend, allAds.spendPrev)}
                  />
                  <MetricCard
                    label="Impressions"
                    value={allAds.impressions.toLocaleString()}
                    delta={pct(allAds.impressions, allAds.imprPrev)}
                  />
                  <MetricCard
                    label="Blended ROAS"
                    value={`${allAds.roas.toFixed(2)}×`}
                    delta={pct(allAds.roas, allAds.roasPrev)}
                  />
                  <MetricCard
                    label="Unique reach"
                    value={allAds.reach.toLocaleString()}
                    delta={pct(allAds.reach, allAds.reachPrev)}
                  />
                </div>
                <p className="mt-2 text-xs text-zinc-400">
                  Google Ads + Meta combined. Unique reach is Meta-only.
                </p>
                  </>
                )}

                {adsConnected && adsCur && (
                  <Section
                    title="Google Ads"
                    slug="googleads"
                    sublabel={adsLive ? "live" : "seeded"}
                  >
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

                <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
                <CollapsibleCard
                  className=""
                  title="Campaign performance"
                  description={`By spend, this range (${adsLive ? "live" : "seeded"})`}
                >
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-2 text-sm">
                    <div className="text-xs font-medium text-zinc-500">Campaign</div>
                    <div className="text-right text-xs font-medium text-zinc-500">Spend</div>
                    <div className="text-right text-xs font-medium text-zinc-500">ROAS</div>
                    <div className="text-right text-xs font-medium text-zinc-500">CPA</div>
                    {adsCampaigns.map((c) => (
                      <RowCells key={c.campaign} c={c} />
                    ))}
                  </div>
                </CollapsibleCard>

                {(adsAudience.length > 0 || adsGeo.length > 0) && (
                  <CollapsibleCard
                    className=""
                    title="Targeting details"
                    description={`Audience & geography — this range (${
                      adsTargetingLive ? "live" : "seeded"
                    })`}
                  >
                    <TargetingBreakdown audience={adsAudience} geo={adsGeo} />
                  </CollapsibleCard>
                )}
                </div>
              </Section>
            )}

            {metaConnected && metaCur && (
              <Section
                title="Meta Ads"
                slug="meta"
                sublabel={`live · ${metaAccounts.length} account${
                  metaAccounts.length > 1 ? "s" : ""
                }`}
              >
                {/* Overall Meta metrics (all accounts combined) shown by default. */}
                <div className="mt-2 grid grid-cols-2 gap-4 md:grid-cols-3">
                  <MetricCard
                    label="Ad spend"
                    value={`$${Math.round(metaCur.spend).toLocaleString()}`}
                    delta={pct(metaCur.spend, metaPrev?.spend ?? 0)}
                  />
                  <MetricCard
                    label="Unique reach"
                    value={metaReachTotal.reach.toLocaleString()}
                    delta={pct(metaReachTotal.reach, metaReachTotalPrev.reach)}
                  />
                  <MetricCard
                    label="Frequency"
                    value={`${metaReachTotal.frequency.toFixed(2)}×`}
                    delta={pct(metaReachTotal.frequency, metaReachTotalPrev.frequency)}
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
                {metaNamed.length > 1 && (
                  <MetaAccountToggle count={metaNamed.length}>
                    {metaNamed.map(({ name, cur, prv, reach, reachPrev }) => (
                      <div key={name} className="mt-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                          {name}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-4 md:grid-cols-3">
                          <MetricCard
                            label="Ad spend"
                            value={`$${Math.round(cur.spend).toLocaleString()}`}
                            delta={pct(cur.spend, prv?.spend ?? 0)}
                          />
                          <MetricCard
                            label="Unique reach"
                            value={(reach?.reach ?? 0).toLocaleString()}
                            delta={pct(reach?.reach ?? 0, reachPrev?.reach ?? 0)}
                          />
                          <MetricCard
                            label="Frequency"
                            value={`${(reach?.frequency ?? 0).toFixed(2)}×`}
                            delta={pct(reach?.frequency ?? 0, reachPrev?.frequency ?? 0)}
                          />
                          <MetricCard
                            label="Conversions"
                            value={cur.conversions.toLocaleString()}
                            delta={pct(cur.conversions, prv?.conversions ?? 0)}
                          />
                          <MetricCard
                            label="ROAS"
                            value={`${cur.roas.toFixed(2)}×`}
                            delta={pct(cur.roas, prv?.roas ?? 0)}
                          />
                          <MetricCard
                            label="CPA"
                            value={`$${cur.cpa.toFixed(2)}`}
                            delta={pct(cur.cpa, prv?.cpa ?? 0)}
                          />
                        </div>
                      </div>
                    ))}
                  </MetaAccountToggle>
                )}

                <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
                {metaCampaigns.length > 0 && (
                  <CollapsibleCard
                    className=""
                    title="Meta campaign performance"
                    description="By spend, this range (live)"
                  >
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-2 text-sm">
                      <div className="text-xs font-medium text-zinc-500">Campaign</div>
                      <div className="text-right text-xs font-medium text-zinc-500">Spend</div>
                      <div className="text-right text-xs font-medium text-zinc-500">ROAS</div>
                      <div className="text-right text-xs font-medium text-zinc-500">CPA</div>
                      {metaCampaigns.slice(0, 8).map((c) => (
                        <RowCells key={c.campaign} c={c} />
                      ))}
                    </div>
                  </CollapsibleCard>
                )}

                {(metaAudience.length > 0 || metaGeo.length > 0) && (
                  <CollapsibleCard
                    className=""
                    title="Targeting details"
                    description="Audience & geography — this range (live)"
                  >
                    <TargetingBreakdown audience={metaAudience} geo={metaGeo} />
                  </CollapsibleCard>
                )}
                </div>
              </Section>
            )}

            {metaConnected && !metaCur && (
              <>
                <RowLabel>
                  Meta Ads
                  <span className="ml-2 font-normal normal-case text-amber-500">
                    needs reconnecting
                  </span>
                </RowLabel>
                <Card className="mt-2 border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30">
                  <CardContent className="flex flex-col items-start gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      Your Meta access token expired or was revoked, so live spend,
                      ROAS, and CPA can&apos;t be loaded right now. Reconnect to restore them.
                    </p>
                    <Button size="sm" render={<Link href="/connections" />}>
                      Reconnect Meta Ads
                    </Button>
                  </CardContent>
                </Card>
              </>
            )}
              </Section>
            )}

            <Section
              title="Email Marketing"
              icon={<Mail className="size-5" />}
              sublabel={<PlatformTag slug="mailchimp" name="Mailchimp" />}
              prominent
            >
              {emailConnected && mailCur ? (
                <div className="mt-2 grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <MetricCard
                    label="Subscribers"
                    value={mailCur.subscribers.toLocaleString()}
                    delta={null}
                  />
                  <MetricCard
                    label="Campaigns sent"
                    value={mailCur.campaignsSent.toLocaleString()}
                    delta={pct(mailCur.campaignsSent, mailPrev?.campaignsSent ?? 0)}
                  />
                  <MetricCard
                    label="Avg open rate"
                    value={`${mailCur.openRate.toFixed(1)}%`}
                    delta={pct(mailCur.openRate, mailPrev?.openRate ?? 0)}
                  />
                  <MetricCard
                    label="Avg click rate"
                    value={`${mailCur.clickRate.toFixed(1)}%`}
                    delta={pct(mailCur.clickRate, mailPrev?.clickRate ?? 0)}
                  />
                </div>
              ) : (
                <div className="mt-3 flex items-center justify-between rounded-xl border border-dashed border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="flex items-center gap-3">
                    <BrandIcon slug="mailchimp" label="Mailchimp" className="size-6 opacity-80" />
                    <div>
                      <div className="text-sm font-medium">Mailchimp</div>
                      <div className="text-xs text-zinc-400">Not connected</div>
                    </div>
                  </div>
                  <Button size="sm" render={<Link href="/connections" />}>
                    Connect
                  </Button>
                </div>
              )}
            </Section>

            <Section
              title="Socials"
              icon={<Share2 className="size-5" />}
              sublabel={
                <span className="inline-flex items-center gap-3">
                  <PlatformTag slug="instagram" name="Instagram" />
                  <PlatformTag slug="tiktok" name="TikTok" />
                </span>
              }
              prominent
            >
              <p className="mt-2 text-sm text-zinc-500">
                Connect your organic social accounts to track followers,
                engagement, and reach alongside revenue and ads.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SocialPlaceholder slug="instagram" name="Instagram" />
                <SocialPlaceholder slug="tiktok" name="TikTok" />
              </div>
            </Section>

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
                  <CombinedChart
                  data={chartData}
                  hasGa4={ga4Connected && !!ga4Cur}
                  hasAds={hasAds}
                />
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

            <Card className="mt-4">
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

/** Side-by-side audience + geography breakdown tables (collapsed by default). */
function TargetingBreakdown({
  audience,
  geo,
}: {
  audience: AdsSegment[];
  geo: AdsSegment[];
}) {
  return (
    <div className="grid gap-6">
      <BreakdownTable title="By audience" rows={audience} />
      <BreakdownTable title="By geography" rows={geo} />
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: AdsSegment[] }) {
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0) || 1;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </div>
      {rows.length ? (
        <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 text-sm">
          <div className="text-xs font-medium text-zinc-500">Segment</div>
          <div className="text-right text-xs font-medium text-zinc-500">Spend</div>
          <div className="text-right text-xs font-medium text-zinc-500">ROAS</div>
          {rows.slice(0, 8).map((r) => (
            <SegRow key={r.segment} r={r} totalSpend={totalSpend} />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-zinc-400">No data in this range.</p>
      )}
    </div>
  );
}

function SegRow({ r, totalSpend }: { r: AdsSegment; totalSpend: number }) {
  return (
    <>
      <div className="truncate">
        {r.segment}
        <span className="ml-1.5 text-xs text-zinc-400">
          {Math.round((r.spend / totalSpend) * 100)}%
        </span>
      </div>
      <div className="text-right tabular-nums">
        ${Math.round(r.spend).toLocaleString()}
      </div>
      <div
        className={`text-right tabular-nums ${
          r.roas < 2 ? "font-medium text-amber-600 dark:text-amber-400" : ""
        }`}
      >
        {r.roas.toFixed(2)}×
      </div>
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

/** Small platform chip (brand logo + name) used in section sublabels. */
function PlatformTag({ slug, name }: { slug: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 normal-case text-zinc-500 dark:text-zinc-400">
      <BrandIcon slug={slug} label={name} className="size-4" />
      {name}
    </span>
  );
}

/** Not-yet-connected social platform card (organic Instagram / TikTok). */
function SocialPlaceholder({ slug, name }: { slug: string; name: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-dashed border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center gap-3">
        <BrandIcon slug={slug} label={name} className="size-6 opacity-80" />
        <div>
          <div className="text-sm font-medium">{name}</div>
          <div className="text-xs text-zinc-400">Not connected</div>
        </div>
      </div>
      <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500 dark:bg-zinc-800">
        Coming soon
      </span>
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
    <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="min-h-8 text-xs font-medium leading-tight text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tracking-tight tabular-nums">{value}</div>
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
