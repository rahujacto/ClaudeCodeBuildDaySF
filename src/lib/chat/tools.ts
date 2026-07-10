import type Anthropic from "@anthropic-ai/sdk";
import type { ShopifyData } from "@/lib/adapters/shopify";
import type { MailchimpData } from "@/lib/adapters/mailchimp";
import type { Ga4Data } from "@/lib/adapters/ga4";
import { adsMetric, adsTotals, adsByCampaign, type AdRow } from "@/lib/adapters/google-ads";
import { metaByAccount } from "@/lib/adapters/meta-ads";
import type {
  DateRange,
  GoogleAdsDailyMetric,
  MetaAdsDailyMetric,
  SourceId,
} from "@/lib/adapters/types";
import { bySchool, type SchoolTraffic } from "@/lib/schools";
import { ytdRange, comparisonRange, previousRange } from "@/lib/dates";

/**
 * Resolver bound to the signed-in user's connections. The chat route builds
 * one of these (RLS-scoped) and the tool executor calls through it, so every
 * number the agent reports traces to that user's live data.
 */
export type DataResolver = {
  connectedSources: SourceId[];
  /** Whether Google Ads is pulling live data (vs. seeded). */
  adsLive?: boolean;
  /** Fetch Shopify data for a range (cached per range within a request). */
  getShopify: (range: DateRange) => Promise<ShopifyData>;
  /** Fetch GA4 data for a range (cached per range within a request). */
  getGa4: (range: DateRange) => Promise<Ga4Data>;
  /** Fetch GA4 product-page traffic by school for a range. */
  getGa4SchoolTraffic: (range: DateRange) => Promise<SchoolTraffic[]>;
  /** Fetch Google Ads daily campaign rows for a range (seeded). */
  getGoogleAds: (range: DateRange) => Promise<GoogleAdsDailyMetric[]>;
  /** Fetch Meta Ads daily campaign rows for a range (live Marketing API). */
  getMetaAds: (range: DateRange) => Promise<MetaAdsDailyMetric[]>;
  /** Fetch Mailchimp account summary for a range. */
  getMailchimp: (range: DateRange) => Promise<MailchimpData>;
};

// ── Tool definitions (the agentic core) ─────────────────────────────────────
export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: "suggest_revenue_optimizations",
    description:
      "Looks across all connected sources (Shopify, Google Ads, Meta Ads, Mailchimp) for the year-to-date range (the default) AND the day-of-week-matched previous period, returning per-platform spend, revenue, and ROAS for BOTH periods plus the ROAS change. Use this to analyze cross-platform performance and recommend where to shift ad budget to increase sales (scale platforms/campaigns with high, stable-or-rising ROAS; pull back on low or falling ROAS). Call this proactively when a user asks how to optimize spend or grow revenue.",
    input_schema: {
      type: "object",
      properties: {
        start: {
          type: "string",
          description: "YYYY-MM-DD inclusive. Defaults to year-to-date (Jan 1 of the current year).",
        },
        end: {
          type: "string",
          description: "YYYY-MM-DD inclusive. Defaults to today.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_metrics_summary",
    description:
      "Aggregated totals for a source over a date range (revenue, orders, AOV, refunds, new customers, top product). Use this for 'how did X do' questions.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["shopify", "ga4", "google_ads", "meta_ads", "email"] },
        start: { type: "string", description: "YYYY-MM-DD inclusive" },
        end: { type: "string", description: "YYYY-MM-DD inclusive" },
      },
      required: ["source", "start", "end"],
    },
  },
  {
    name: "compare_periods",
    description:
      "Compare a single metric between two date ranges; returns both values, the delta, and % change. Use for 'this week vs last week' style questions.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["shopify", "ga4", "google_ads", "meta_ads", "email"] },
        metric: {
          type: "string",
          description:
            "Shopify: revenue, orders, aov, refunds, new_customers. GA4: sessions, users, new_users. Ads (google_ads/meta_ads): spend, conversions, roas, cpa, ctr, cpc, clicks, impressions. Email: subscribers, campaignsSent, openRate, clickRate.",
        },
        current: {
          type: "object",
          properties: {
            start: { type: "string" },
            end: { type: "string" },
          },
          required: ["start", "end"],
        },
        previous: {
          type: "object",
          properties: {
            start: { type: "string" },
            end: { type: "string" },
          },
          required: ["start", "end"],
        },
      },
      required: ["source", "metric", "current", "previous"],
    },
  },
  {
    name: "breakdown_by_dimension",
    description:
      "Rank performers by a metric. Shopify: dimension 'product', metric revenue/quantity/orders. GA4: dimension 'channel', metric sessions/users. Ads (google_ads/meta_ads): dimension 'campaign', metric spend/roas/cpa/conversions/clicks/ctr. meta_ads also supports dimension 'account' to compare ad accounts (e.g. Instagram vs Facebook).",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["shopify", "ga4", "google_ads", "meta_ads"] },
        dimension: { type: "string", enum: ["product", "campaign", "channel", "account"] },
        metric: { type: "string", description: "revenue, quantity, or orders" },
        start: { type: "string" },
        end: { type: "string" },
        order: { type: "string", enum: ["asc", "desc"], default: "desc" },
        limit: { type: "number", default: 5 },
      },
      required: ["source", "dimension", "metric", "start", "end"],
    },
  },
  {
    name: "breakdown_by_school",
    description:
      "Break revenue (Shopify) down by university/school, joined with product-page traffic (GA4): revenue, units, sessions, revenuePerView, and revenuePerSession. This store sells graduation regalia per school. Use for any 'by school' / 'which schools' question, including marketing-allocation questions: schools with HIGH revenuePerSession but LOW sessions are under-advertised (scale spend); schools with HIGH sessions but LOW revenuePerSession have a page/price problem (don't add spend).",
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string", description: "YYYY-MM-DD inclusive" },
        end: { type: "string", description: "YYYY-MM-DD inclusive" },
        order: {
          type: "string",
          enum: ["asc", "desc"],
          default: "desc",
          description: "Sort by revenue; asc surfaces under-performers.",
        },
        limit: { type: "number", default: 10 },
      },
      required: ["start", "end"],
    },
  },
  {
    name: "detect_anomalies",
    description:
      "Scan the most recent N days vs the prior N days for spikes/drops in revenue, orders, and AOV. Use this proactively on open-ended 'how am I doing' or 'anything I should worry about' questions.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["shopify", "ga4", "google_ads", "meta_ads", "email"] },
        lookbackDays: { type: "number", default: 7 },
      },
      required: ["source"],
    },
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Shopify computations ──────────────────────────────────────────────────
function shopifyMetric(data: ShopifyData, metric: string): number {
  const m = metric.toLowerCase();
  const revenue = data.daily.reduce((s, d) => s + d.revenue, 0);
  const orders = data.daily.reduce((s, d) => s + d.orders, 0);
  switch (m) {
    case "revenue":
      return round2(revenue);
    case "orders":
      return orders;
    case "aov":
      return orders ? round2(revenue / orders) : 0;
    case "refunds":
      return round2(data.daily.reduce((s, d) => s + d.refunds, 0));
    case "new_customers":
    case "newcustomers":
      return data.daily.reduce((s, d) => s + d.newCustomers, 0);
    default:
      return round2(revenue);
  }
}

function shopifySummary(data: ShopifyData, range: DateRange) {
  const revenue = round2(data.daily.reduce((s, d) => s + d.revenue, 0));
  const orders = data.daily.reduce((s, d) => s + d.orders, 0);
  return {
    source: "shopify",
    start: range.start,
    end: range.end,
    revenue,
    orders,
    aov: orders ? round2(revenue / orders) : 0,
    refunds: round2(data.daily.reduce((s, d) => s + d.refunds, 0)),
    newCustomers: data.daily.reduce((s, d) => s + d.newCustomers, 0),
    topProductByRevenue: data.products[0]
      ? { title: data.products[0].title, revenue: data.products[0].revenue }
      : null,
    channels: data.channels.map((c) => ({
      channel: c.channel,
      ai: c.ai,
      revenue: c.revenue,
      orders: c.orders,
    })),
    aiRevenue: round2(
      data.channels.reduce((s, c) => s + (c.ai ? c.revenue : 0), 0),
    ),
    daysWithData: data.daily.length,
    currency: "USD",
  };
}

// ── GA4 computations ────────────────────────────────────────────────────────
function ga4Metric(data: Ga4Data, metric: string): number {
  const m = metric.toLowerCase().replace(/[\s_]/g, "");
  const sum = (k: "sessions" | "users" | "newUsers") =>
    data.daily.reduce((s, d) => s + d[k], 0);
  switch (m) {
    case "users":
    case "totalusers":
      return sum("users");
    case "newusers":
      return sum("newUsers");
    case "sessions":
    default:
      return sum("sessions");
  }
}

function adsSummary(
  rows: AdRow[],
  range: DateRange,
  source: "google_ads" | "meta_ads",
  note?: string,
) {
  const t = adsTotals(rows);
  const top = adsByCampaign(rows);
  return {
    source,
    start: range.start,
    end: range.end,
    ...(note ? { note } : {}),
    spend: t.spend,
    conversions: t.conversions,
    conversionValue: t.conversionValue,
    clicks: t.clicks,
    impressions: t.impressions,
    ctr: t.ctr,
    cpc: t.cpc,
    cpa: t.cpa,
    roas: t.roas,
    topCampaignBySpend: top[0] ? { campaign: top[0].campaign, spend: top[0].spend, roas: top[0].roas } : null,
  };
}

function ga4Summary(data: Ga4Data, range: DateRange) {
  return {
    source: "ga4",
    start: range.start,
    end: range.end,
    sessions: ga4Metric(data, "sessions"),
    users: ga4Metric(data, "users"),
    newUsers: ga4Metric(data, "newUsers"),
    topChannel: data.channels[0]
      ? { channel: data.channels[0].channel, sessions: data.channels[0].sessions }
      : null,
    daysWithData: data.daily.length,
  };
}

function emailSummary(data: MailchimpData, range: DateRange) {
  return {
    source: "email",
    start: range.start,
    end: range.end,
    subscribers: data.subscribers,
    campaignsSent: data.campaignsSent,
    openRate: data.openRate,
    clickRate: data.clickRate,
  };
}


// ── Executor ─────────────────────────────────────────────────────────────────
export function createToolExecutor(resolver: DataResolver, today: string) {
  const SUPPORTED = ["shopify", "ga4", "google_ads", "meta_ads", "email"];
  function ensure(source: string): { error: string } | null {
    if (!SUPPORTED.includes(source))
      return { error: `Source "${source}" is not supported.` };
    if (!resolver.connectedSources.includes(source as SourceId)) {
      const have = resolver.connectedSources.join(", ") || "none";
      return {
        error: `"${source}" is not connected for this user (connected: ${have}). Tell the user to connect it on the Connections page — do not invent numbers.`,
      };
    }
    return null;
  }

  type AnyData = ShopifyData | Ga4Data | GoogleAdsDailyMetric[] | MetaAdsDailyMetric[] | MailchimpData;
  const isAds = (s: string) => s === "google_ads" || s === "meta_ads";
  const emailMetric = (data: MailchimpData, metric: string) => {
    if (metric === "subscribers") return data.subscribers;
    if (metric === "campaignsSent") return data.campaignsSent;
    if (metric === "openRate") return data.openRate;
    if (metric === "clickRate") return data.clickRate;
    return 0;
  };
  const metricFor = (source: string, data: AnyData | MailchimpData, metric: string) =>
    source === "ga4"
      ? ga4Metric(data as Ga4Data, metric)
      : isAds(source)
        ? adsMetric(data as AdRow[], metric)
        : source === "email"
          ? emailMetric(data as MailchimpData, metric)
          : shopifyMetric(data as ShopifyData, metric);

  const get = (source: string, range: DateRange): Promise<AnyData> =>
    source === "ga4"
      ? resolver.getGa4(range)
      : source === "google_ads"
        ? resolver.getGoogleAds(range)
        : source === "meta_ads"
          ? resolver.getMetaAds(range)
          : source === "email"
            ? resolver.getMailchimp(range)
            : resolver.getShopify(range);

  async function run(name: string, input: Record<string, unknown>) {
    const source = String(input.source ?? "shopify");

    // suggest_revenue_optimizations spans all sources and checks connectivity
    // per-source internally; every other tool gates on its `source` (Shopify for
    // breakdown_by_school, which needs Shopify orders) so we never invent numbers.
    if (name !== "suggest_revenue_optimizations") {
      const gate = ensure(source);
      if (gate) return gate;
    }

    switch (name) {

      case "suggest_revenue_optimizations": {
        // Default to year-to-date; the caller may override with start/end.
        const hasRange = typeof input.start === "string" && typeof input.end === "string";
        const range: DateRange = hasRange
          ? { start: String(input.start), end: String(input.end) }
          : ytdRange(today);
        // Compare against the day-of-week-matched previous period (same span
        // shifted back whole weeks) so ROAS and spend are like-for-like.
        const previous = comparisonRange(range, "previous_dow") ?? previousRange(range);

        const wantShopify = resolver.connectedSources.includes("shopify");
        const wantGoogle = resolver.connectedSources.includes("google_ads");
        const wantMeta = resolver.connectedSources.includes("meta_ads");
        const wantEmail = resolver.connectedSources.includes("email");

        const [shopCur, shopPrev, gaCur, gaPrev, metaCur, metaPrev, mail] =
          await Promise.all([
            wantShopify ? resolver.getShopify(range) : Promise.resolve(null),
            wantShopify ? resolver.getShopify(previous) : Promise.resolve(null),
            wantGoogle ? resolver.getGoogleAds(range) : Promise.resolve(null),
            wantGoogle ? resolver.getGoogleAds(previous) : Promise.resolve(null),
            wantMeta ? resolver.getMetaAds(range) : Promise.resolve(null),
            wantMeta ? resolver.getMetaAds(previous) : Promise.resolve(null),
            wantEmail ? resolver.getMailchimp(range) : Promise.resolve(null),
          ]);

        const adsBlock = (cur: AdRow[] | null, prev: AdRow[] | null) => {
          if (!cur) return null;
          const t = adsTotals(cur);
          const p = prev ? adsTotals(prev) : null;
          const totals = (x: typeof t) => ({
            spend: x.spend,
            revenue: x.conversionValue,
            conversions: x.conversions,
            roas: x.roas,
            cpa: x.cpa,
          });
          return {
            current: totals(t),
            previous: p ? totals(p) : null,
            roasChangePct: p && p.roas !== 0 ? round1(((t.roas - p.roas) / p.roas) * 100) : null,
            spendChangePct: p && p.spend !== 0 ? round1(((t.spend - p.spend) / p.spend) * 100) : null,
            topCampaigns: adsByCampaign(cur).slice(0, 8),
          };
        };

        const shopBlock = (cur: ShopifyData | null, prev: ShopifyData | null) => {
          if (!cur) return null;
          const rev = shopifyMetric(cur, "revenue");
          const prevRev = prev ? shopifyMetric(prev, "revenue") : null;
          return {
            current: { revenue: rev, orders: shopifyMetric(cur, "orders") },
            previous: prev ? { revenue: prevRev, orders: shopifyMetric(prev, "orders") } : null,
            revenueChangePct:
              prevRev && prevRev !== 0 ? round1(((rev - prevRev) / prevRev) * 100) : null,
            topProducts: cur.products.slice(0, 5),
          };
        };

        return {
          range,
          comparison: { label: "Previous period (match day of week)", ...previous },
          message:
            "Analyze ROAS and spend efficiency per platform for `range` vs the day-of-week-matched `comparison` period. Recommend where to shift budget: scale platforms/campaigns with high, stable-or-rising ROAS and headroom (low spend); pull back where ROAS is low or falling. Directly compare Google Ads vs Meta ROAS. Present a compact markdown table (columns: Platform, Spend, Revenue, ROAS, ROAS vs prev) so it renders as a chart, then give ONE concrete budget-shift action.",
          data: {
            shopify: shopBlock(shopCur, shopPrev),
            googleAds: adsBlock(gaCur as AdRow[] | null, gaPrev as AdRow[] | null),
            metaAds: adsBlock(metaCur as AdRow[] | null, metaPrev as AdRow[] | null),
            email: mail ? { openRate: mail.openRate, clickRate: mail.clickRate } : null,
          },
        };
      }
      case "get_metrics_summary": {
        const range = { start: String(input.start), end: String(input.end) };
        const data = await get(source, range);
        return source === "ga4"
          ? ga4Summary(data as Ga4Data, range)
          : source === "google_ads"
            ? adsSummary(
                data as GoogleAdsDailyMetric[],
                range,
                "google_ads",
                resolver.adsLive ? undefined : "seeded data (live Google Ads deferred)",
              )
            : source === "meta_ads"
              ? adsSummary(data as MetaAdsDailyMetric[], range, "meta_ads")
              : source === "email"
                ? emailSummary(data as MailchimpData, range)
                : shopifySummary(data as ShopifyData, range);
      }

      case "compare_periods": {
        const defaultMetric =
          source === "ga4" ? "sessions" : source === "email" ? "campaignsSent" : isAds(source) ? "spend" : "revenue";
        const metric = String(input.metric ?? defaultMetric);
        const cur = input.current as DateRange;
        const prev = input.previous as DateRange;
        const [curData, prevData] = await Promise.all([get(source, cur), get(source, prev)]);
        const current = metricFor(source, curData, metric);
        const previous = metricFor(source, prevData, metric);
        const delta = round2(current - previous);
        return {
          source,
          metric,
          current,
          previous,
          delta,
          pctChange: previous !== 0 ? round1((delta / previous) * 100) : null,
          currentRange: cur,
          previousRange: prev,
        };
      }

      case "breakdown_by_dimension": {
        const range = { start: String(input.start), end: String(input.end) };
        const order = input.order === "asc" ? "asc" : "desc";
        const limit = Math.min(Number(input.limit ?? 5) || 5, 20);

        if (source === "ga4") {
          const data = (await resolver.getGa4(range)) as Ga4Data;
          const key = String(input.metric ?? "sessions").toLowerCase() === "users" ? "users" : "sessions";
          const sorted = [...data.channels].sort((a, b) =>
            order === "asc" ? a[key] - b[key] : b[key] - a[key],
          );
          return { source, dimension: "channel", metric: key, order, range, results: sorted.slice(0, limit) };
        }

        if (isAds(source)) {
          const rows = (await get(source, range)) as AdRow[];
          const metric = String(input.metric ?? "spend").toLowerCase();
          const validKey = (m: string) =>
            (["spend", "roas", "cpa", "conversions", "clicks", "ctr"].includes(m) ? m : "spend");

          // Meta multi-account: compare ad accounts (e.g. Instagram vs Facebook).
          if (source === "meta_ads" && input.dimension === "account") {
            const groups = metaByAccount(rows as MetaAdsDailyMetric[]);
            const key = validKey(metric) as keyof (typeof groups)[number];
            const sorted = [...groups].sort((a, b) =>
              order === "asc"
                ? (a[key] as number) - (b[key] as number)
                : (b[key] as number) - (a[key] as number),
            );
            return { source, dimension: "account", metric: key, order, range, results: sorted.slice(0, limit) };
          }

          const campaigns = adsByCampaign(rows);
          const key = validKey(metric) as keyof (typeof campaigns)[number];
          const sorted = [...campaigns].sort((a, b) =>
            order === "asc"
              ? (a[key] as number) - (b[key] as number)
              : (b[key] as number) - (a[key] as number),
          );
          return { source, dimension: "campaign", metric: key, order, range, results: sorted.slice(0, limit) };
        }

        if (input.dimension && input.dimension !== "product")
          return { error: `Shopify only supports the 'product' dimension; got '${input.dimension}'.` };
        const data = (await resolver.getShopify(range)) as ShopifyData;
        const metric = String(input.metric ?? "revenue").toLowerCase();
        const key = metric === "quantity" ? "quantity" : metric === "orders" ? "orders" : "revenue";
        const sorted = [...data.products].sort((a, b) =>
          order === "asc" ? a[key] - b[key] : b[key] - a[key],
        );
        return { source, dimension: "product", metric: key, order, range, results: sorted.slice(0, limit) };
      }

      case "breakdown_by_school": {
        const range = { start: String(input.start), end: String(input.end) };
        const order = input.order === "asc" ? "asc" : "desc";
        const limit = Math.min(Number(input.limit ?? 10) || 10, 25);
        const shopData = (await resolver.getShopify(range)) as ShopifyData;
        let traffic: SchoolTraffic[] = [];
        if (resolver.connectedSources.includes("ga4")) {
          try {
            traffic = await resolver.getGa4SchoolTraffic(range);
          } catch {
            // GA4 traffic is optional; revenue-only is still useful
          }
        }
        let rows = bySchool(shopData.products, traffic);
        if (order === "asc") rows = [...rows].reverse();
        return {
          dimension: "school",
          range,
          ga4Joined: traffic.length > 0,
          totalRevenue: Math.round(rows.reduce((s, r) => s + r.revenue, 0)),
          schoolCount: rows.length,
          results: rows.slice(0, limit),
        };
      }

      case "detect_anomalies": {
        const lookback = Math.max(1, Number(input.lookbackDays ?? 7) || 7);
        const curRange = { start: addDays(today, -(lookback - 1)), end: today };
        const prevRange = {
          start: addDays(today, -(2 * lookback - 1)),
          end: addDays(today, -lookback),
        };
        const [curData, prevData] = await Promise.all([get(source, curRange), get(source, prevRange)]);
        const metrics =
          source === "ga4"
            ? ["sessions", "users", "newUsers"]
            : source === "email"
              ? ["openRate", "clickRate"]
              : isAds(source)
                ? ["spend", "conversions", "cpa", "roas"]
                : ["revenue", "orders", "aov"];
        const thresholds: Record<string, number> = {
          revenue: 20, orders: 20, aov: 10, sessions: 25, users: 25, newUsers: 25,
          spend: 20, conversions: 20, cpa: 20, roas: 20, openRate: 15, clickRate: 15,
        };
        const findings = metrics.map((m) => {
          const current = metricFor(source, curData, m);
          const previous = metricFor(source, prevData, m);
          const pct = previous !== 0 ? round1(((current - previous) / previous) * 100) : null;
          const isAnomaly = pct !== null && Math.abs(pct) >= (thresholds[m] ?? 20);
          return {
            metric: m,
            current,
            previous,
            pctChange: pct,
            isAnomaly,
            direction: pct === null ? "n/a" : pct >= 0 ? "up" : "down",
          };
        });
        return {
          source,
          lookbackDays: lookback,
          currentRange: curRange,
          previousRange: prevRange,
          findings,
          anomaliesFound: findings.filter((f) => f.isAnomaly),
        };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }
  return run;
}
