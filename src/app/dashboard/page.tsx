import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { RangeSelector } from "@/components/dashboard/range-selector";
import { AgentBootstrap } from "@/components/agent/agent-bootstrap";
import {
  RangeLoadingProvider,
  RangeSpinner,
  MetricCardBody,
} from "@/components/dashboard/range-loading";
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
import { getConnections, adapterContextFromRow } from "@/lib/connections";
import { getCurrentOrg } from "@/lib/org";
import { socialChannelRevenue, type ShopifyData } from "@/lib/adapters/shopify";
import { loadShopifyDataForRanges } from "@/lib/shopify-cache";
import type { DateRange, MetaAccount, SocialData } from "@/lib/adapters/types";
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
import { PlatformTag } from "@/components/dashboard/platform-tag";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import { BrandIcon } from "@/components/brand-icon";
import { DollarSign, Activity, Megaphone, Share2, Mail, Gauge } from "lucide-react";
import {
  ChannelComparisonChart,
  type ChannelComparisonPoint,
} from "@/components/dashboard/channel-comparison-chart";
import { Sparkline, type SparklinePoint } from "@/components/dashboard/sparkline";
import { fetchMailchimpData, type MailchimpData } from "@/lib/adapters/mailchimp";
import { fetchInstagramData } from "@/lib/adapters/instagram";
import { fetchTiktokData } from "@/lib/adapters/tiktok";
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
import { bySchool, type SchoolTraffic } from "@/lib/schools";
import { SchoolChart } from "@/components/dashboard/school-chart";
import {
  parseRange,
  comparisonRange,
  parseCompare,
  compareLabel,
  presetForRange,
  formatRangeLabel,
  ytdRange,
} from "@/lib/dates";
import {
  MetricCardSkeleton,
  OverviewSectionSkeleton,
  RevenueSectionSkeleton,
  TrafficSectionSkeleton,
  AdsSectionSkeleton,
  EmailSectionSkeleton,
  SocialsSectionSkeleton,
  ChartCardSkeleton,
  TopProductsSkeleton,
} from "./skeletons";

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

type ShopifyTotals = ReturnType<typeof totals>;

function pct(cur: number, prev: number): number | null {
  return prev !== 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
}

/** Log how long a provider block takes so slow sources are visible in server logs. */
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    console.log(`[dashboard] ${label} ${Date.now() - t0}ms`);
  }
}

function ga4Totals(data: Ga4Data) {
  return {
    sessions: data.daily.reduce((s, d) => s + d.sessions, 0),
    users: data.daily.reduce((s, d) => s + d.users, 0),
    newUsers: data.daily.reduce((s, d) => s + d.newUsers, 0),
  };
}

/**
 * Cross-platform advertising rollup (Google Ads + Meta), blended into one set
 * of totals. Shared by the Ads section's top rollup row and the Overview's
 * verdict — one source of truth for "what did ads do overall."
 */
function blendedAds(
  adsCur: AdsTotals | null,
  adsPrev: AdsTotals | null,
  metaCur: AdsTotals | null,
  metaPrev: AdsTotals | null,
  metaReachTotal: { reach: number },
  metaReachTotalPrev: { reach: number },
) {
  const spend = (adsCur?.spend ?? 0) + (metaCur?.spend ?? 0);
  const impressions = (adsCur?.impressions ?? 0) + (metaCur?.impressions ?? 0);
  const value = (adsCur?.conversionValue ?? 0) + (metaCur?.conversionValue ?? 0);
  const spendPrev = (adsPrev?.spend ?? 0) + (metaPrev?.spend ?? 0);
  const imprPrev = (adsPrev?.impressions ?? 0) + (metaPrev?.impressions ?? 0);
  const valuePrev = (adsPrev?.conversionValue ?? 0) + (metaPrev?.conversionValue ?? 0);
  return {
    spend,
    impressions,
    value,
    valuePrev,
    roas: spend ? value / spend : 0,
    reach: metaReachTotal.reach, // unique reach is Meta-only
    ecpm: impressions ? (spend / impressions) * 1000 : 0,
    spendPrev,
    imprPrev,
    roasPrev: spendPrev ? valuePrev / spendPrev : 0,
    reachPrev: metaReachTotalPrev.reach,
    ecpmPrev: imprPrev ? (spendPrev / imprPrev) * 1000 : 0,
  };
}

// ── Per-provider load results (each section awaits only what it needs) ──────

type SpendDay = { date: string; spend: number; conversionValue: number };

type ShopifyResult = {
  cur: ShopifyData | null;
  prevData: ShopifyData | null;
  error: string | null;
};

type Ga4Result = {
  ga4Cur: Ga4Data | null;
  ga4Prev: Ga4Data | null;
  schoolTraffic: SchoolTraffic[];
  ga4Regions: Ga4Region[];
};

type AdsResult = {
  adsCur: AdsTotals | null;
  adsPrev: AdsTotals | null;
  adsCampaigns: AdsCampaign[];
  adsAudience: AdsSegment[];
  adsGeo: AdsSegment[];
  adsLive: boolean;
  adsTargetingLive: boolean;
  adsSpendDaily: SpendDay[];
  /** Why this load fell back to seeded data, when the connection is meant to be live. */
  adsError: string | null;
};

type MetaResult = {
  metaCur: AdsTotals | null;
  metaPrev: AdsTotals | null;
  metaCampaigns: AdsCampaign[];
  metaPerAccount: MetaAccountTotals[];
  metaPerAccountPrev: MetaAccountTotals[];
  metaReach: MetaReach[];
  metaReachPrev: MetaReach[];
  metaReachTotal: { reach: number; frequency: number };
  metaReachTotalPrev: { reach: number; frequency: number };
  metaAudience: AdsSegment[];
  metaGeo: AdsSegment[];
  metaSpendDaily: SpendDay[];
};

type MailResult = { mailCur: MailchimpData | null; mailPrev: MailchimpData | null };

type SocialResult = {
  igCur: SocialData | null;
  igPrev: SocialData | null;
  ttCur: SocialData | null;
  ttPrev: SocialData | null;
  /** Why a connected platform still failed to load data this time (null = expected/no error). */
  igError: string | null;
  ttError: string | null;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string; compare?: string }>;
}) {
  const sp = await searchParams;
  // Default to Year-to-date when no explicit range is in the URL.
  const range = sp.start && sp.end ? parseRange(sp.start, sp.end) : ytdRange();
  const compare = parseCompare(sp.compare);
  // The comparison range that drives every "vs" delta; null when comparison is
  // off, in which case each provider skips its prior-period fetch and deltas hide.
  const prev = comparisonRange(range, compare);

  const supabase = await createSupabaseServerClient();
  // Auth check and org resolution are independent round-trips.
  const [userRes, { orgId }] = await Promise.all([
    supabase.auth.getUser(),
    getCurrentOrg(supabase),
  ]);
  const user = userRes.data.user;

  // All seven connection rows in one query instead of seven sequential ones.
  const conns = await timed("connections", () =>
    getConnections(supabase, orgId, [
      "shopify",
      "ga4",
      "google_ads",
      "meta_ads",
      "email",
      "instagram",
      "tiktok",
    ]),
  );
  const row = conns.shopify ?? null;
  const ga4Row = conns.ga4 ?? null;
  const adsRow = conns.google_ads ?? null;
  const metaRow = conns.meta_ads ?? null;
  const emailRow = conns.email ?? null;
  const igRow = conns.instagram ?? null;
  const ttRow = conns.tiktok ?? null;

  const connected = row?.status === "connected";
  const ga4Connected =
    ga4Row?.status === "connected" && Boolean(ga4Row?.config?.propertyId);
  const adsConnected = adsRow?.status === "seeded" || adsRow?.status === "connected";
  const metaAccounts: MetaAccount[] =
    metaRow?.status === "connected"
      ? Array.isArray(metaRow.config?.accounts)
        ? (metaRow.config.accounts as MetaAccount[])
        : metaRow.config?.adAccountId
          ? [{ adAccountId: metaRow.config.adAccountId as string, accountName: (metaRow.config.accountName as string) ?? "" }]
          : []
      : [];
  const metaConnected = metaAccounts.length > 0;
  const emailConnected = emailRow?.status === "connected";
  const igConnected = igRow?.status === "connected" && Boolean(igRow?.config?.igUserId);
  const ttConnected = ttRow?.status === "connected";

  async function loadShopify(): Promise<ShopifyResult> {
    if (!connected || !user) return { cur: null, prevData: null, error: null };
    try {
      const ctx = adapterContextFromRow(user.id, row);
      const secret = await ctx.getSecret();
      const clientId = ctx.config.clientId as string;
      const domain = ctx.config.domain as string;
      if (!secret || !clientId || !domain) throw new Error("Shopify is not fully configured.");
      const [cur, prevData] = await loadShopifyDataForRanges(
        supabase,
        orgId,
        { domain, clientId, secret },
        prev ? [range, prev] : [range],
      );
      return { cur, prevData: prevData ?? null, error: null };
    } catch (e) {
      return {
        cur: null,
        prevData: null,
        error: e instanceof Error ? e.message : "Could not load Shopify data.",
      };
    }
  }

  // GA4 (optional, independent of Shopify).
  async function loadGa4(): Promise<Ga4Result> {
    const out: Ga4Result = { ga4Cur: null, ga4Prev: null, schoolTraffic: [], ga4Regions: [] };
    if (!ga4Connected || !user) return out;
    try {
      const gctx = adapterContextFromRow(user.id, ga4Row);
      const refresh = await gctx.getSecret();
      const propertyId = gctx.config.propertyId as string;
      if (refresh && propertyId) {
        const [c, p, st, rg] = await Promise.all([
          fetchGa4Data(refresh, propertyId, range),
          prev ? fetchGa4Data(refresh, propertyId, prev) : Promise.resolve(null),
          fetchGa4SchoolTraffic(refresh, propertyId, range),
          fetchGa4Regions(refresh, propertyId, range),
        ]);
        out.ga4Cur = c;
        out.ga4Prev = p;
        out.schoolTraffic = st;
        out.ga4Regions = rg;
      }
    } catch {
      // GA4 is optional on the dashboard; ignore failures
    }
    return out;
  }

  // Google Ads — live when the connection is `connected`, else seeded.
  async function loadAds(): Promise<AdsResult> {
    const out: AdsResult = {
      adsCur: null,
      adsPrev: null,
      adsCampaigns: [],
      adsAudience: [],
      adsGeo: [],
      adsLive: false,
      adsTargetingLive: false,
      adsSpendDaily: [],
      adsError: null,
    };
    if (!adsConnected || !user) return out;
    const [curRows, prevRows, targeting] = await Promise.all([
      loadGoogleAdsDaily(orgId, adsRow, range),
      prev ? loadGoogleAdsDaily(orgId, adsRow, prev) : Promise.resolve(null),
      loadGoogleAdsTargeting(orgId, adsRow, range),
    ]);
    out.adsLive = curRows.live;
    out.adsError = curRows.error;
    out.adsCur = adsTotals(curRows.rows);
    out.adsPrev = prevRows ? adsTotals(prevRows.rows) : null;
    out.adsCampaigns = adsByCampaign(curRows.rows);
    out.adsAudience = targeting.audience;
    out.adsGeo = targeting.geo;
    out.adsTargetingLive = targeting.live;
    out.adsSpendDaily = curRows.rows.map((r) => ({
      date: r.date,
      spend: r.spend,
      conversionValue: r.conversionValue,
    }));
    return out;
  }

  // Meta Ads (live Marketing API, one or more ad accounts).
  async function loadMeta(): Promise<MetaResult> {
    const out: MetaResult = {
      metaCur: null,
      metaPrev: null,
      metaCampaigns: [],
      metaPerAccount: [],
      metaPerAccountPrev: [],
      metaReach: [],
      metaReachPrev: [],
      metaReachTotal: { reach: 0, frequency: 0 },
      metaReachTotalPrev: { reach: 0, frequency: 0 },
      metaAudience: [],
      metaGeo: [],
      metaSpendDaily: [],
    };
    if (!metaConnected || !user) return out;
    try {
      const mctx = adapterContextFromRow(user.id, metaRow);
      const token = await mctx.getSecret();
      if (token) {
        // Start the optional targeting breakdowns alongside the core metrics —
        // they're awaited separately so a failure there never drops spend/ROAS.
        const breakdowns = Promise.all([
          fetchMetaAudience(metaAccounts, token, range),
          fetchMetaGeo(metaAccounts, token, range),
        ]);
        breakdowns.catch(() => {});
        const [mc, mp, mr, mrp] = await Promise.all([
          fetchMetaAdsForAccounts(metaAccounts, token, range),
          prev ? fetchMetaAdsForAccounts(metaAccounts, token, prev) : Promise.resolve([]),
          fetchMetaReachForAccounts(metaAccounts, token, range),
          prev ? fetchMetaReachForAccounts(metaAccounts, token, prev) : Promise.resolve([]),
        ]);
        out.metaCur = adsTotals(mc);
        out.metaPrev = adsTotals(mp);
        out.metaCampaigns = adsByCampaign(mc);
        out.metaPerAccount = metaByAccount(mc);
        out.metaPerAccountPrev = metaByAccount(mp);
        out.metaReach = mr;
        out.metaReachPrev = mrp;
        out.metaReachTotal = combineReach(mr);
        out.metaReachTotalPrev = combineReach(mrp);
        out.metaSpendDaily = mc.map((r) => ({
          date: r.date,
          spend: r.spend,
          conversionValue: r.conversionValue,
        }));
        try {
          const [aud, geo] = await breakdowns;
          out.metaAudience = aud;
          out.metaGeo = geo;
        } catch {
          // breakdowns unavailable (permissions / API) — hide the panel
        }
      }
    } catch {
      // Meta is live; token may expire — degrade gracefully
    }
    return out;
  }

  // Email marketing (Mailchimp), stored under the generic "email" source.
  async function loadMail(): Promise<MailResult> {
    const out: MailResult = { mailCur: null, mailPrev: null };
    if (!emailConnected || !user) return out;
    try {
      const ectx = adapterContextFromRow(user.id, emailRow);
      const apiKey = await ectx.getSecret();
      if (apiKey) {
        const [mc, mp] = await Promise.all([
          fetchMailchimpData(apiKey, range),
          prev ? fetchMailchimpData(apiKey, prev) : Promise.resolve(null),
        ]);
        out.mailCur = mc;
        out.mailPrev = mp;
      }
    } catch {
      // Email is optional on the dashboard; ignore failures.
    }
    return out;
  }

  // Organic social (Instagram + TikTok), stored under their own sources.
  async function loadSocial(): Promise<SocialResult> {
    const out: SocialResult = {
      igCur: null,
      igPrev: null,
      ttCur: null,
      ttPrev: null,
      igError: null,
      ttError: null,
    };
    if (!user) return out;
    if (igConnected) {
      try {
        const ictx = adapterContextFromRow(user.id, igRow);
        const token = await ictx.getSecret();
        const igUserId = ictx.config.igUserId as string;
        if (!token || !igUserId) throw new Error("Instagram is not fully configured.");
        const [c, p] = await Promise.all([
          fetchInstagramData(token, igUserId, range),
          prev ? fetchInstagramData(token, igUserId, prev) : Promise.resolve(null),
        ]);
        out.igCur = c;
        out.igPrev = p;
      } catch (err) {
        // Token expired/revoked, missing insights permission, etc. — keep the
        // reason so the dashboard can explain why a "connected" platform still
        // shows no data, instead of looking indistinguishable from disconnected.
        out.igError = err instanceof Error ? err.message : "Live pull failed.";
      }
    }
    if (ttConnected) {
      try {
        const tctx = adapterContextFromRow(user.id, ttRow);
        const token = await tctx.getSecret();
        if (!token) throw new Error("TikTok is not fully configured.");
        const [c, p] = await Promise.all([
          fetchTiktokData(token, range),
          prev ? fetchTiktokData(token, prev) : Promise.resolve(null),
        ]);
        out.ttCur = c;
        out.ttPrev = p;
      } catch (err) {
        out.ttError = err instanceof Error ? err.message : "Live pull failed.";
      }
    }
    return out;
  }

  // Kick every provider off now, but don't await: each section below suspends
  // on only the promises it needs, so fast sources paint while slow ones load.
  const shopifyP = timed("shopify", loadShopify);
  const ga4P = timed("ga4", loadGa4);
  const adsP = timed("google-ads", loadAds);
  const metaP = timed("meta", loadMeta);
  const mailP = timed("mailchimp", loadMail);
  const socialP = timed("social", loadSocial);
  void timed("total", async () => {
    await Promise.all([shopifyP, ga4P, adsP, metaP, mailP, socialP]);
  });

  const ga4Label = ga4Row?.config?.displayName
    ? `Google Analytics · ${String(ga4Row.config.displayName)}`
    : "Google Analytics";

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      {connected && <AgentBootstrap />}
      <RangeLoadingProvider>
      <main className="app-main @container mx-auto w-full max-w-5xl flex-1 px-6 py-8 transition-[padding]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {connected
                ? `${row?.config?.domain ?? "Shopify"} · ${formatRangeLabel(range)}${
                    compare !== "none" ? ` · vs ${compareLabel(compare).toLowerCase()}` : ""
                  }`
                : "Connect Shopify to see live metrics."}
            </p>
          </div>
          {connected && (
            <RangeSelector
              active={presetForRange(range)}
              start={range.start}
              end={range.end}
              compare={compare}
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
        ) : (
          <>
            <Suspense fallback={<OverviewSectionSkeleton />}>
              <OverviewSection
                shopifyP={shopifyP}
                adsP={adsP}
                metaP={metaP}
                mailP={mailP}
                socialP={socialP}
                range={range}
              />
            </Suspense>

            <Suspense fallback={<RevenueSectionSkeleton fiveCols={ga4Connected} />}>
              <RevenueSection shopifyP={shopifyP} ga4P={ga4P} ga4Connected={ga4Connected} />
            </Suspense>

            {ga4Connected && (
              <Suspense fallback={<TrafficSectionSkeleton label={ga4Label} />}>
                <TrafficSection ga4P={ga4P} label={ga4Label} />
              </Suspense>
            )}

            {(adsConnected || metaConnected) && (
              <Suspense fallback={<AdsSectionSkeleton />}>
                <AdsSection
                  adsP={adsP}
                  metaP={metaP}
                  adsConnected={adsConnected}
                  metaConnected={metaConnected}
                  metaAccounts={metaAccounts}
                />
              </Suspense>
            )}

            <Suspense fallback={<EmailSectionSkeleton />}>
              <EmailSection mailP={mailP} emailConnected={emailConnected} />
            </Suspense>

            <Suspense fallback={<SocialsSectionSkeleton />}>
              <SocialsSection
                socialP={socialP}
                shopifyP={shopifyP}
                igConnected={igConnected}
                ttConnected={ttConnected}
              />
            </Suspense>

            <Suspense fallback={<ChartCardSkeleton />}>
              <CombinedChartCard
                shopifyP={shopifyP}
                ga4P={ga4P}
                adsP={adsP}
                metaP={metaP}
                ga4Connected={ga4Connected}
                range={range}
              />
            </Suspense>

            <Suspense fallback={null}>
              <SchoolsCard shopifyP={shopifyP} ga4P={ga4P} ga4Connected={ga4Connected} />
            </Suspense>

            <Suspense fallback={<TopProductsSkeleton />}>
              <TopProductsCard shopifyP={shopifyP} />
            </Suspense>
          </>
        )}
      </main>
      </RangeLoadingProvider>
    </div>
  );
}

// ── Streaming sections (async server components; each awaits its own data) ──

/**
 * Cross-platform decision-support summary — the "single pane" view. Sits
 * above every per-platform section (which stay exactly as they are) and
 * answers "what's the big picture, and where should the next dollar go."
 * Awaits every connected source together (following CombinedChartCard's
 * multi-source precedent) since a partial verdict isn't a verdict.
 */
async function OverviewSection({
  shopifyP,
  adsP,
  metaP,
  mailP,
  socialP,
  range,
}: {
  shopifyP: Promise<ShopifyResult>;
  adsP: Promise<AdsResult>;
  metaP: Promise<MetaResult>;
  mailP: Promise<MailResult>;
  socialP: Promise<SocialResult>;
  range: DateRange;
}) {
  const [{ cur, prevData }, adsRes, metaRes, mailRes, socialRes] = await Promise.all([
    shopifyP,
    adsP,
    metaP,
    mailP,
    socialP,
  ]);
  const { adsCur, adsPrev } = adsRes;
  const { metaCur, metaPrev, metaReachTotal, metaReachTotalPrev } = metaRes;
  const { mailCur, mailPrev } = mailRes;
  const { igCur, igPrev, ttCur, ttPrev } = socialRes;

  if (!cur) return null;
  const shopifyTotals = totals(cur);
  const prevTotals = prevData ? totals(prevData) : null;
  const revenue = shopifyTotals.revenue;
  const prevRevenue = prevTotals?.revenue ?? null;

  const ads = blendedAds(adsCur, adsPrev, metaCur, metaPrev, metaReachTotal, metaReachTotalPrev);
  const marketingPct = revenue ? (ads.value / revenue) * 100 : 0;
  const marketingPctPrev = prevRevenue ? (ads.valuePrev / prevRevenue) * 100 : null;
  const revenueGrowth = pct(revenue, prevRevenue ?? 0);

  // Channel comparison — Shopify/Google Ads/Meta Ads have real spend/revenue/
  // ROAS; Email and Social don't report revenue attribution in their APIs, so
  // those two rows show their best available engagement metric instead of a
  // fabricated number (never invent a figure — same rule the rest of the app follows).
  const socialInteractions = (igCur?.interactions ?? 0) + (ttCur?.interactions ?? 0);
  const socialInteractionsPrev = (igPrev?.interactions ?? 0) + (ttPrev?.interactions ?? 0);
  const socialConnected = Boolean(igCur || ttCur);

  type ChannelRow = {
    slug: string;
    name: string;
    spend: string;
    value: string;
    roas: string;
    growth: number | null;
    connected: boolean;
  };
  const rows: ChannelRow[] = [
    {
      slug: "shopify",
      name: "Shopify (all channels)",
      spend: "—",
      value: `$${Math.round(revenue).toLocaleString()}`,
      roas: "—",
      growth: prevRevenue !== null ? revenueGrowth : null,
      connected: true,
    },
    {
      slug: "googleads",
      name: "Google Ads",
      spend: adsCur ? `$${Math.round(adsCur.spend).toLocaleString()}` : "—",
      value: adsCur ? `$${Math.round(adsCur.conversionValue).toLocaleString()}` : "—",
      roas: adsCur ? `${adsCur.roas.toFixed(2)}×` : "—",
      growth: adsCur && adsPrev ? pct(adsCur.conversionValue, adsPrev.conversionValue) : null,
      connected: Boolean(adsCur),
    },
    {
      slug: "meta",
      name: "Meta Ads",
      spend: metaCur ? `$${Math.round(metaCur.spend).toLocaleString()}` : "—",
      value: metaCur ? `$${Math.round(metaCur.conversionValue).toLocaleString()}` : "—",
      roas: metaCur ? `${metaCur.roas.toFixed(2)}×` : "—",
      growth: metaCur && metaPrev ? pct(metaCur.conversionValue, metaPrev.conversionValue) : null,
      connected: Boolean(metaCur),
    },
    {
      slug: "mailchimp",
      name: "Email",
      spend: "—",
      value: mailCur
        ? `${mailCur.subscribers.toLocaleString()} subs · ${mailCur.clickRate.toFixed(1)}% click`
        : "—",
      roas: "—",
      growth: mailCur && mailPrev ? pct(mailCur.subscribers, mailPrev.subscribers) : null,
      connected: Boolean(mailCur),
    },
    {
      slug: "instagram",
      name: "Social",
      spend: "—",
      value: socialConnected ? `${socialInteractions.toLocaleString()} interactions` : "—",
      roas: "—",
      growth: socialConnected ? pct(socialInteractions, socialInteractionsPrev) : null,
      connected: socialConnected,
    },
  ];

  const chartData: ChannelComparisonPoint[] = [
    { channel: "Shopify", spend: null, value: revenue },
    { channel: "Google Ads", spend: adsCur?.spend ?? null, value: adsCur?.conversionValue ?? null },
    { channel: "Meta Ads", spend: metaCur?.spend ?? null, value: metaCur?.conversionValue ?? null },
  ];

  return (
    <Card className="mt-2 @container">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="size-4 text-muted-foreground" />
          Overview
        </CardTitle>
        <CardDescription>
          Cross-platform snapshot, {formatRangeLabel(range)} — where growth is
          coming from, and where to put the next dollar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 @xl:grid-cols-4">
          <MetricCard
            label="Total revenue"
            value={`$${Math.round(revenue).toLocaleString()}`}
            delta={prevRevenue !== null ? revenueGrowth : null}
          />
          <MetricCard
            label="Blended ROAS"
            value={`${ads.roas.toFixed(2)}×`}
            delta={pct(ads.roas, ads.roasPrev)}
          />
          <MetricCard
            label="Marketing-driven revenue"
            value={`${marketingPct.toFixed(1)}%`}
            delta={marketingPctPrev !== null ? pct(marketingPct, marketingPctPrev) : null}
          />
          <MetricCard
            label="Revenue growth"
            value={prevRevenue !== null ? `${revenueGrowth !== null && revenueGrowth >= 0 ? "+" : ""}${revenueGrowth ?? 0}%` : "—"}
            delta={null}
          />
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-xs font-medium text-muted-foreground">
                <th className="pb-2 text-left font-medium">Channel</th>
                <th className="pb-2 text-right font-medium">Spend</th>
                <th className="pb-2 text-right font-medium">Revenue / value</th>
                <th className="pb-2 text-right font-medium">ROAS</th>
                <th className="pb-2 text-right font-medium">Growth</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.slug} className="border-t border-border">
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <BrandIcon slug={r.slug} label={r.name} className="size-4" />
                      <span className={r.connected ? "" : "text-muted-foreground"}>{r.name}</span>
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {r.connected ? r.spend : "Not connected"}
                  </td>
                  <td className="py-2 text-right tabular-nums">{r.connected ? r.value : "—"}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {r.connected ? r.roas : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {r.growth === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={r.growth >= 0 ? "text-brand" : "text-rose-600 dark:text-rose-400"}>
                        {r.growth >= 0 ? "▲" : "▼"} {Math.abs(r.growth)}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            Shopify shows total store revenue across all channels (including
            ad-driven sales, not just organic). Email and Social don&apos;t
            report revenue attribution today, so those rows show their best
            available engagement metric instead of a guessed number.
          </p>
        </div>

        <div className="mt-6">
          <ChannelComparisonChart data={chartData} />
        </div>
      </CardContent>
    </Card>
  );
}

async function RevenueSection({
  shopifyP,
  ga4P,
  ga4Connected,
}: {
  shopifyP: Promise<ShopifyResult>;
  ga4P: Promise<Ga4Result>;
  ga4Connected: boolean;
}) {
  const { cur, prevData, error } = await shopifyP;
  if (error) {
    return (
      <Card className="mt-8 border-destructive/30">
        <CardHeader>
          <CardTitle>Couldn&apos;t load data</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!cur) return null;

  const t = totals(cur);
  const tp = prevData ? totals(prevData) : null;

  // Daily trend lines for the KPI cards — free, cur.daily is already loaded for the totals above.
  const revenueTrend = cur.daily.map((d) => ({ date: d.date, value: d.revenue }));
  const ordersTrend = cur.daily.map((d) => ({ date: d.date, value: d.orders }));
  const aovTrend = cur.daily.map((d) => ({ date: d.date, value: d.orders ? d.revenue / d.orders : 0 }));
  const newCustomersTrend = cur.daily.map((d) => ({ date: d.date, value: d.newCustomers }));

  // School + shipping-state breakdowns, both range-filtered like the metrics.
  const schoolSales = bySchool(cur.products, []);
  const stateSales = cur.states;

  // Sales-channel breakdown (incl. agentic AI storefronts).
  const channelMax = cur.channels[0]?.revenue ?? 0;
  const aiRevenue = cur.channels.reduce((s, c) => s + (c.ai ? c.revenue : 0), 0);
  const aiSharePct = t.revenue ? Math.round((aiRevenue / t.revenue) * 1000) / 10 : 0;

  return (
    <Section
      title="Revenue"
      icon={<DollarSign className="size-5" />}
      sublabel={<PlatformTag slug="shopify" name="Shopify" />}
      prominent
    >
      <div
        className={`mt-2 grid grid-cols-2 gap-4 ${
          ga4Connected ? "@xl:grid-cols-3 @4xl:grid-cols-5" : "@3xl:grid-cols-4"
        }`}
      >
        <MetricCard
          label="Revenue"
          value={`$${Math.round(t.revenue).toLocaleString()}`}
          delta={pct(t.revenue, tp?.revenue ?? 0)}
          sparkline={revenueTrend}
        />
        <MetricCard
          label="Orders"
          value={t.orders.toLocaleString()}
          delta={pct(t.orders, tp?.orders ?? 0)}
          sparkline={ordersTrend}
        />
        <MetricCard
          label="AOV"
          value={`$${t.aov.toFixed(2)}`}
          delta={pct(t.aov, tp?.aov ?? 0)}
          sparkline={aovTrend}
        />
        {ga4Connected && (
          <Suspense fallback={<MetricCardSkeleton />}>
            <ConvRateCard t={t} tp={tp} ga4P={ga4P} />
          </Suspense>
        )}
        <MetricCard
          label="New customers"
          value={t.newCustomers.toLocaleString()}
          delta={pct(t.newCustomers, tp?.newCustomers ?? 0)}
          sparkline={newCustomersTrend}
        />
      </div>

      {cur.channels.length > 0 && (
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
              {cur.channels.slice(0, 8).map((c) => (
                <li key={c.channel} className="flex items-center gap-3 text-sm">
                  <span className="flex w-44 shrink-0 items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
                    <span className="truncate">{c.channel}</span>
                    {c.ai && (
                      <Badge variant="brand" className="h-auto shrink-0 px-1.5 py-0.5 text-[10px] tracking-wide">
                        AI
                      </Badge>
                    )}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className={`h-2 rounded-full ${c.ai ? "bg-brand" : "bg-blue-500"}`}
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

      {(schoolSales.length > 0 || stateSales.length > 0) && (
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
          {schoolSales.length > 0 && (
            <CollapsibleCard
              className=""
              title="Sales by school"
              description="Revenue by school, this range"
            >
              <BreakdownBarList
                rows={schoolSales.slice(0, 10).map((s) => ({
                  label: s.school,
                  revenue: s.revenue,
                  count: s.units,
                }))}
                countLabel="units"
              />
            </CollapsibleCard>
          )}
          {stateSales.length > 0 && (
            <CollapsibleCard
              className=""
              title="Sales by state"
              description="Revenue by shipping state, this range"
            >
              <BreakdownBarList
                rows={stateSales.slice(0, 10).map((s) => ({
                  label: s.state,
                  revenue: s.revenue,
                  count: s.orders,
                }))}
                countLabel="ord"
              />
            </CollapsibleCard>
          )}
        </div>
      )}
    </Section>
  );
}

/** Ranked bar list of revenue rows (schools, states, …) inside a collapsible. */
function BreakdownBarList({
  rows,
  countLabel,
}: {
  rows: Array<{ label: string; revenue: number; count: number }>;
  countLabel: string;
}) {
  const max = rows[0]?.revenue ?? 0;
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 truncate text-zinc-700 dark:text-zinc-300">
            {r.label}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-2 rounded-full bg-blue-500"
              style={{ width: `${max ? Math.round((r.revenue / max) * 100) : 0}%` }}
            />
          </div>
          <span className="w-20 shrink-0 text-right font-medium tabular-nums">
            ${Math.round(r.revenue).toLocaleString()}
          </span>
          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-zinc-400">
            {r.count.toLocaleString()} {countLabel}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Conversion rate = Shopify orders ÷ GA4 sessions. Lives in its own Suspense
 * slot inside the Revenue grid so Shopify metrics never wait on GA4.
 */
async function ConvRateCard({
  t,
  tp,
  ga4P,
}: {
  t: ShopifyTotals;
  tp: ShopifyTotals | null;
  ga4P: Promise<Ga4Result>;
}) {
  const { ga4Cur, ga4Prev } = await ga4P;
  const g = ga4Cur ? ga4Totals(ga4Cur) : null;
  const gp = ga4Prev ? ga4Totals(ga4Prev) : null;
  const convRate = g && g.sessions ? (t.orders / g.sessions) * 100 : null;
  if (convRate === null) return null;
  const convRatePrev = tp && gp && gp.sessions ? (tp.orders / gp.sessions) * 100 : null;
  return (
    <MetricCard
      label="Conversion rate"
      value={`${convRate.toFixed(2)}%`}
      delta={pct(convRate, convRatePrev ?? 0)}
    />
  );
}

async function TrafficSection({ ga4P, label }: { ga4P: Promise<Ga4Result>; label: string }) {
  const { ga4Cur, ga4Prev, ga4Regions } = await ga4P;
  if (!ga4Cur) return null;
  const g = ga4Totals(ga4Cur);
  const gp = ga4Prev ? ga4Totals(ga4Prev) : null;
  const ga4Max = ga4Cur.channels[0]?.sessions ?? 0;
  const regionMax = ga4Regions[0]?.sessions ?? 0;

  const sessionsTrend = ga4Cur.daily.map((d) => ({ date: d.date, value: d.sessions }));
  const usersTrend = ga4Cur.daily.map((d) => ({ date: d.date, value: d.users }));
  const newUsersTrend = ga4Cur.daily.map((d) => ({ date: d.date, value: d.newUsers }));

  return (
    <Section
      title="Traffic"
      icon={<Activity className="size-5" />}
      prominent
      sublabel={<PlatformTag slug="googleanalytics" name={label} />}
    >
      <div className="mt-2 grid grid-cols-3 gap-4">
        <MetricCard
          label="Sessions"
          value={g.sessions.toLocaleString()}
          delta={pct(g.sessions, gp?.sessions ?? 0)}
          sparkline={sessionsTrend}
        />
        <MetricCard
          label="Users"
          value={g.users.toLocaleString()}
          delta={pct(g.users, gp?.users ?? 0)}
          sparkline={usersTrend}
        />
        <MetricCard
          label="New users"
          value={g.newUsers.toLocaleString()}
          delta={pct(g.newUsers, gp?.newUsers ?? 0)}
          sparkline={newUsersTrend}
        />
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <CollapsibleCard
          className=""
          title="Top channels"
          description="By sessions, this range"
        >
          {ga4Cur.channels.length ? (
            <ul className="flex flex-col gap-2.5">
              {ga4Cur.channels.slice(0, 6).map((c) => (
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
  );
}

async function AdsSection({
  adsP,
  metaP,
  adsConnected,
  metaConnected,
  metaAccounts,
}: {
  adsP: Promise<AdsResult>;
  metaP: Promise<MetaResult>;
  adsConnected: boolean;
  metaConnected: boolean;
  metaAccounts: MetaAccount[];
}) {
  const [adsRes, metaRes] = await Promise.all([adsP, metaP]);
  const {
    adsCur,
    adsPrev,
    adsCampaigns,
    adsAudience,
    adsGeo,
    adsLive,
    adsTargetingLive,
    adsError,
    adsSpendDaily,
  } = adsRes;
  const {
    metaCur,
    metaPrev,
    metaCampaigns,
    metaPerAccount,
    metaPerAccountPrev,
    metaReach,
    metaReachPrev,
    metaReachTotal,
    metaReachTotalPrev,
    metaAudience,
    metaGeo,
    metaSpendDaily,
  } = metaRes;

  // Spend + ROAS trend lines for the Ads sub-sections' KPI cards.
  const adsSpendTrend = adsSpendDaily.map((d) => ({ date: d.date, value: d.spend }));
  const adsRoasTrend = adsSpendDaily.map((d) => ({
    date: d.date,
    value: d.spend ? d.conversionValue / d.spend : 0,
  }));
  const metaSpendTrend = metaSpendDaily.map((d) => ({ date: d.date, value: d.spend }));
  const metaRoasTrend = metaSpendDaily.map((d) => ({
    date: d.date,
    value: d.spend ? d.conversionValue / d.spend : 0,
  }));

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

  // Cross-platform advertising rollup (Google Ads + Meta).
  const allAds = blendedAds(adsCur, adsPrev, metaCur, metaPrev, metaReachTotal, metaReachTotalPrev);

  return (
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
          <div className="mt-2 grid grid-cols-2 gap-4 @xl:grid-cols-3 @4xl:grid-cols-5">
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
              label="eCPM"
              value={`$${allAds.ecpm.toFixed(2)}`}
              delta={pct(allAds.ecpm, allAds.ecpmPrev)}
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
          {adsError && (
            <WarningBanner
              className="mt-2"
              action={
                <Link
                  href="/connections"
                  className="text-sm font-medium text-amber-900 underline dark:text-amber-100"
                >
                  Reconnect Google Ads
                </Link>
              }
            >
              Live Google Ads pull failed, so the numbers below are seeded
              (not real): <span className="font-medium">{adsError}</span>
            </WarningBanner>
          )}
          <div className="mt-2 grid grid-cols-2 gap-4 @3xl:grid-cols-4">
            <MetricCard
              label="Ad spend"
              value={`$${Math.round(adsCur.spend).toLocaleString()}`}
              delta={pct(adsCur.spend, adsPrev?.spend ?? 0)}
              sparkline={adsSpendTrend}
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
              sparkline={adsRoasTrend}
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
          <div className="mt-2 grid grid-cols-2 gap-4 @2xl:grid-cols-3">
            <MetricCard
              label="Ad spend"
              value={`$${Math.round(metaCur.spend).toLocaleString()}`}
              delta={pct(metaCur.spend, metaPrev?.spend ?? 0)}
              sparkline={metaSpendTrend}
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
              sparkline={metaRoasTrend}
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
                  <div className="mt-2 grid grid-cols-2 gap-4 @2xl:grid-cols-3">
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
  );
}

async function EmailSection({
  mailP,
  emailConnected,
}: {
  mailP: Promise<MailResult>;
  emailConnected: boolean;
}) {
  const { mailCur, mailPrev } = await mailP;
  return (
    <Section
      title="Email Marketing"
      icon={<Mail className="size-5" />}
      sublabel={<PlatformTag slug="mailchimp" name="Mailchimp" />}
      prominent
    >
      {emailConnected && mailCur ? (
        <div className="mt-2 grid grid-cols-2 gap-4 @3xl:grid-cols-4">
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
  );
}

async function SocialsSection({
  socialP,
  shopifyP,
  igConnected,
  ttConnected,
}: {
  socialP: Promise<SocialResult>;
  shopifyP: Promise<ShopifyResult>;
  igConnected: boolean;
  ttConnected: boolean;
}) {
  const [{ igCur, igPrev, ttCur, ttPrev, igError, ttError }, { cur, prevData }] = await Promise.all([
    socialP,
    shopifyP,
  ]);

  // "Associated revenue" = Shopify orders attributed to that platform's own
  // sales channel (installed Instagram/TikTok Shop app), not ad spend — these
  // are organic connectors, distinct from Meta Ads.
  const igRevenue = cur ? socialChannelRevenue(cur.channels, /instagram/i).revenue : 0;
  const igRevenuePrev = prevData ? socialChannelRevenue(prevData.channels, /instagram/i).revenue : null;
  const ttRevenue = cur ? socialChannelRevenue(cur.channels, /tiktok/i).revenue : 0;
  const ttRevenuePrev = prevData ? socialChannelRevenue(prevData.channels, /tiktok/i).revenue : null;

  return (
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
        Organic reach and engagement, plus revenue attributed via each
        platform&apos;s Shopify sales channel.
      </p>
      <div className="mt-3 flex flex-col gap-4">
        <SocialPlatformBlock
          slug="instagram"
          name="Instagram"
          postLabel="Posts"
          viewLabel="Reach"
          connected={igConnected}
          data={igCur}
          prevData={igPrev}
          revenue={igRevenue}
          prevRevenue={igRevenuePrev}
          error={igError}
        />
        <SocialPlatformBlock
          slug="tiktok"
          name="TikTok"
          postLabel="Videos"
          viewLabel="Views"
          connected={ttConnected}
          data={ttCur}
          prevData={ttPrev}
          revenue={ttRevenue}
          prevRevenue={ttRevenuePrev}
          error={ttError}
        />
      </div>
    </Section>
  );
}

function SocialPlatformBlock({
  slug,
  name,
  postLabel,
  viewLabel,
  connected,
  data,
  prevData,
  revenue,
  prevRevenue,
  error,
}: {
  slug: string;
  name: string;
  postLabel: string;
  viewLabel: string;
  connected: boolean;
  data: SocialData | null;
  prevData: SocialData | null;
  revenue: number;
  prevRevenue: number | null;
  error: string | null;
}) {
  if (!connected) return <SocialPlaceholder slug={slug} name={name} />;
  // Connected, but this load's live pull still failed (expired token, missing
  // permission, etc.) — say so instead of looking indistinguishable from
  // never having been connected in the first place.
  if (!data) {
    return (
      <WarningBanner
        title={
          <>
            <BrandIcon slug={slug} label={name} className="size-4" />
            {name}
          </>
        }
        action={
          <Link
            href="/connections"
            className="text-sm font-medium text-amber-900 underline dark:text-amber-100"
          >
            Reconnect {name}
          </Link>
        }
      >
        {error ?? "Couldn't load data for this range."}
      </WarningBanner>
    );
  }
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-medium">
        <BrandIcon slug={slug} label={name} className="size-4" />
        {name}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-4 @sm:grid-cols-3 @3xl:grid-cols-6">
        <MetricCard
          label="Followers"
          value={data.followers.toLocaleString()}
          delta={pct(data.followers, prevData?.followers ?? 0)}
        />
        <MetricCard
          label={postLabel}
          value={data.posts.toLocaleString()}
          delta={pct(data.posts, prevData?.posts ?? 0)}
        />
        <MetricCard
          label="Likes"
          value={data.likes.toLocaleString()}
          delta={pct(data.likes, prevData?.likes ?? 0)}
        />
        <MetricCard
          label={viewLabel}
          value={data.views.toLocaleString()}
          delta={pct(data.views, prevData?.views ?? 0)}
        />
        <MetricCard
          label="Interactions"
          value={data.interactions.toLocaleString()}
          delta={pct(data.interactions, prevData?.interactions ?? 0)}
        />
        <MetricCard
          label="Assoc. revenue"
          value={`$${Math.round(revenue).toLocaleString()}`}
          delta={prevRevenue !== null ? pct(revenue, prevRevenue) : null}
        />
      </div>
    </div>
  );
}

async function CombinedChartCard({
  shopifyP,
  ga4P,
  adsP,
  metaP,
  ga4Connected,
  range,
}: {
  shopifyP: Promise<ShopifyResult>;
  ga4P: Promise<Ga4Result>;
  adsP: Promise<AdsResult>;
  metaP: Promise<MetaResult>;
  ga4Connected: boolean;
  range: DateRange;
}) {
  const [{ cur }, { ga4Cur }, adsRes, metaRes] = await Promise.all([
    shopifyP,
    ga4P,
    adsP,
    metaP,
  ]);

  // Daily ad spend per date (Google Ads + Meta), for the combined chart.
  const adSpendDaily = [...adsRes.adsSpendDaily, ...metaRes.metaSpendDaily];
  const adSpendByDate = new Map<string, number>();
  for (const r of adSpendDaily) {
    adSpendByDate.set(r.date, (adSpendByDate.get(r.date) ?? 0) + r.spend);
  }
  const hasAds = adSpendDaily.length > 0;

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
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {ga4Connected ? "Revenue & traffic" : "Revenue trend"}
          <RangeSpinner className="size-4" />
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
  );
}

async function SchoolsCard({
  shopifyP,
  ga4P,
  ga4Connected,
}: {
  shopifyP: Promise<ShopifyResult>;
  ga4P: Promise<Ga4Result>;
  ga4Connected: boolean;
}) {
  const [{ cur }, { schoolTraffic }] = await Promise.all([shopifyP, ga4P]);
  const schools = cur ? bySchool(cur.products, schoolTraffic) : [];
  if (!schools.length) return null;
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Revenue by school
          <RangeSpinner className="size-4" />
        </CardTitle>
        <CardDescription>
          Top schools by revenue
          {ga4Connected ? " — hover for product-page traffic" : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SchoolChart data={schools} />
      </CardContent>
    </Card>
  );
}

async function TopProductsCard({ shopifyP }: { shopifyP: Promise<ShopifyResult> }) {
  const { cur } = await shopifyP;
  const products = cur?.products ?? [];
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Top products
          <RangeSpinner className="size-4" />
        </CardTitle>
        <CardDescription>By revenue, this range</CardDescription>
      </CardHeader>
      <CardContent>
        {products.length ? (
          <ul className="flex flex-col gap-2.5">
            {products.slice(0, 5).map((p, i) => (
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
      <Button size="sm" render={<Link href="/connections" />}>
        Connect
      </Button>
    </div>
  );
}

function MetricCard({
  label,
  value,
  delta,
  sparkline,
}: {
  label: string;
  value: string;
  delta: number | null;
  /** Optional recent-trend line — only passed where real daily data exists. */
  sparkline?: SparklinePoint[];
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <MetricCardBody>
      <div className="min-h-8 text-xs font-medium leading-tight text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tracking-tight tabular-nums">{value}</div>
      {sparkline && <Sparkline data={sparkline} className="mt-1.5 h-6" />}
      {delta !== null && (
        <div
          className={`mt-1 text-xs font-medium ${
            up ? "text-brand" : "text-rose-600 dark:text-rose-400"
          }`}
        >
          {up ? "▲" : "▼"} {Math.abs(delta)}%
        </div>
      )}
    </MetricCardBody>
  );
}
