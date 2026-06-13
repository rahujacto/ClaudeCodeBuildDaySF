import type Anthropic from "@anthropic-ai/sdk";
import type { ShopifyData } from "@/lib/adapters/shopify";
import type { DateRange, SourceId } from "@/lib/adapters/types";

/**
 * Resolver bound to the signed-in user's connections. The chat route builds
 * one of these (RLS-scoped) and the tool executor calls through it, so every
 * number the agent reports traces to that user's live data.
 */
export type DataResolver = {
  connectedSources: SourceId[];
  /** Fetch Shopify data for a range (cached per range within a request). */
  getShopify: (range: DateRange) => Promise<ShopifyData>;
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
            "revenue, orders, aov, refunds, new_customers (Shopify metrics)",
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
      "Rank performers by a metric. For Shopify, dimension is 'product' and metric is revenue, quantity, or orders.",
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

function metricValue(data: ShopifyData, metric: string): number {
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
      return revenue;
  }
}

function summarize(data: ShopifyData, range: DateRange) {
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

function notConnected(source: string) {
  return {
    error: `The "${source}" source is not connected for this user. Only Shopify is connected. Tell the user GA4/Google Ads aren't connected yet rather than inventing numbers.`,
  };
}

// ── Executor ─────────────────────────────────────────────────────────────────
export function createToolExecutor(resolver: DataResolver, today: string) {
  async function run(name: string, input: Record<string, unknown>) {
    const source = String(input.source ?? "shopify");
    if (source !== "shopify") return notConnected(source);
    if (!resolver.connectedSources.includes("shopify"))
      return { error: "Shopify is not connected. Ask the user to connect it on the Connections page." };

    switch (name) {
      case "get_metrics_summary": {
        const range = { start: String(input.start), end: String(input.end) };
        const data = await resolver.getShopify(range);
        return summarize(data, range);
      }

      case "compare_periods": {
        const metric = String(input.metric ?? "revenue");
        const cur = input.current as DateRange;
        const prev = input.previous as DateRange;
        const [curData, prevData] = await Promise.all([
          resolver.getShopify(cur),
          resolver.getShopify(prev),
        ]);
        const current = metricValue(curData, metric);
        const previous = metricValue(prevData, metric);
        const delta = round2(current - previous);
        return {
          source: "shopify",
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
        if (input.dimension !== "product")
          return { error: `Shopify only supports the 'product' dimension; got '${input.dimension}'.` };
        const range = { start: String(input.start), end: String(input.end) };
        const metric = String(input.metric ?? "revenue").toLowerCase();
        const order = input.order === "asc" ? "asc" : "desc";
        const limit = Math.min(Number(input.limit ?? 5) || 5, 20);
        const data = await resolver.getShopify(range);
        const key =
          metric === "quantity" ? "quantity" : metric === "orders" ? "orders" : "revenue";
        const sorted = [...data.products].sort((a, b) =>
          order === "asc" ? a[key] - b[key] : b[key] - a[key],
        );
        return {
          source: "shopify",
          dimension: "product",
          metric: key,
          order,
          range,
          results: sorted.slice(0, limit),
        };
      }

      case "detect_anomalies": {
        const lookback = Math.max(1, Number(input.lookbackDays ?? 7) || 7);
        const curRange = { start: addDays(today, -(lookback - 1)), end: today };
        const prevRange = {
          start: addDays(today, -(2 * lookback - 1)),
          end: addDays(today, -lookback),
        };
        const [curData, prevData] = await Promise.all([
          resolver.getShopify(curRange),
          resolver.getShopify(prevRange),
        ]);
        const metrics = ["revenue", "orders", "aov"] as const;
        const thresholds: Record<string, number> = { revenue: 20, orders: 20, aov: 10 };
        const findings = metrics.map((m) => {
          const current = metricValue(curData, m);
          const previous = metricValue(prevData, m);
          const pct = previous !== 0 ? round1(((current - previous) / previous) * 100) : null;
          const isAnomaly = pct !== null && Math.abs(pct) >= thresholds[m];
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
          source: "shopify",
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
