import type Anthropic from "@anthropic-ai/sdk";
import type { ShopifyData } from "@/lib/adapters/shopify";
import type { Ga4Data } from "@/lib/adapters/ga4";
import type { DateRange, SourceId } from "@/lib/adapters/types";
import { bySchool, type SchoolTraffic } from "@/lib/schools";

/**
 * Resolver bound to the signed-in user's connections. The chat route builds
 * one of these (RLS-scoped) and the tool executor calls through it, so every
 * number the agent reports traces to that user's live data.
 */
export type DataResolver = {
  connectedSources: SourceId[];
  /** Fetch Shopify data for a range (cached per range within a request). */
  getShopify: (range: DateRange) => Promise<ShopifyData>;
  /** Fetch GA4 data for a range (cached per range within a request). */
  getGa4: (range: DateRange) => Promise<Ga4Data>;
  /** Fetch GA4 product-page traffic by school for a range. */
  getGa4SchoolTraffic: (range: DateRange) => Promise<SchoolTraffic[]>;
};

// ── Tool definitions (the agentic core) ─────────────────────────────────────
export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_metrics_summary",
    description:
      "Aggregated totals for a source over a date range (revenue, orders, AOV, refunds, new customers, top product). Use this for 'how did X do' questions.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["shopify", "ga4", "google_ads"] },
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
        source: { type: "string", enum: ["shopify", "ga4", "google_ads"] },
        metric: {
          type: "string",
          description:
            "Shopify: revenue, orders, aov, refunds, new_customers. GA4: sessions, users, new_users.",
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
      "Rank performers by a metric. Shopify: dimension 'product', metric revenue/quantity/orders. GA4: dimension 'channel', metric sessions/users.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["shopify", "ga4", "google_ads"] },
        dimension: { type: "string", enum: ["product", "campaign", "channel"] },
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
        source: { type: "string", enum: ["shopify", "ga4", "google_ads"] },
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

// ── Executor ─────────────────────────────────────────────────────────────────
export function createToolExecutor(resolver: DataResolver, today: string) {
  function ensure(source: string): { error: string } | null {
    if (source !== "shopify" && source !== "ga4")
      return { error: `Source "${source}" is not supported.` };
    if (!resolver.connectedSources.includes(source as SourceId)) {
      const have = resolver.connectedSources.join(", ") || "none";
      return {
        error: `"${source}" is not connected for this user (connected: ${have}). Tell the user to connect it on the Connections page — do not invent numbers.`,
      };
    }
    return null;
  }

  const metricFor = (source: string, data: ShopifyData | Ga4Data, metric: string) =>
    source === "ga4"
      ? ga4Metric(data as Ga4Data, metric)
      : shopifyMetric(data as ShopifyData, metric);

  const get = (source: string, range: DateRange) =>
    source === "ga4" ? resolver.getGa4(range) : resolver.getShopify(range);

  async function run(name: string, input: Record<string, unknown>) {
    const source = String(input.source ?? "shopify");
    const gate = ensure(source);
    if (gate) return gate;

    switch (name) {
      case "get_metrics_summary": {
        const range = { start: String(input.start), end: String(input.end) };
        const data = await get(source, range);
        return source === "ga4"
          ? ga4Summary(data as Ga4Data, range)
          : shopifySummary(data as ShopifyData, range);
      }

      case "compare_periods": {
        const metric = String(input.metric ?? (source === "ga4" ? "sessions" : "revenue"));
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
            : ["revenue", "orders", "aov"];
        const thresholds: Record<string, number> = {
          revenue: 20, orders: 20, aov: 10, sessions: 25, users: 25, newUsers: 25,
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
