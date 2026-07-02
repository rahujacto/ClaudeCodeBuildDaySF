import type {
  AdapterContext,
  DataAdapter,
  DateRange,
  ShopifyChannelMetric,
  ShopifyDailyMetric,
} from "./types";
import { addDays } from "@/lib/dates";

const API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2025-10";
const MAX_PAGES = 60; // safety cap: 250 orders/page → up to 15k orders/range

/** Local calendar date (YYYY-MM-DD) of an ISO instant in the shop's timezone. */
function localDate(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** Normalize whatever the user pasted into a bare `*.myshopify.com` host. */
export function normalizeShopDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  d = d.split("/")[0];
  if (!d.includes(".")) d = `${d}.myshopify.com`;
  return d;
}

class ShopifyError extends Error {}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Token minting (client-credentials grant) ────────────────────────────────
// Custom apps created in the Shopify Dev Dashboard authenticate with a
// Client ID + Client secret. We exchange those for a short-lived Admin API
// access token server-side and cache it until shortly before it expires, so
// we never have to store (or expire on) a raw token.
type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

async function mintAccessToken(
  domain: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const cacheKey = `${domain}:${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });

  if (res.status === 401 || res.status === 403) {
    throw new ShopifyError(
      "Shopify rejected the Client ID / secret (401/403). Double-check both values.",
    );
  }
  if (res.status === 404) {
    throw new ShopifyError(
      `Store not found at ${domain}. Check the store domain (e.g. your-store.myshopify.com).`,
    );
  }
  if (!res.ok) {
    throw new ShopifyError(`Could not mint token (HTTP ${res.status}).`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new ShopifyError("Shopify did not return a token.");

  tokenCache.set(cacheKey, {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  });
  return json.access_token;
}

// ── GraphQL with throttle/back-off ──────────────────────────────────────────
type GraphQLResult<T> = {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
};

async function shopifyGraphQL<T>(
  domain: string,
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
  attempt = 0,
): Promise<T> {
  const res = await fetch(
    `https://${domain}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    },
  );

  if (res.status === 401 || res.status === 403) {
    throw new ShopifyError(
      "Shopify rejected the token (401/403). Check the app's Admin API scopes (read_orders).",
    );
  }
  if (res.status === 429) {
    if (attempt < 4) {
      await sleep(500 * (attempt + 1));
      return shopifyGraphQL<T>(domain, token, query, variables, attempt + 1);
    }
    throw new ShopifyError("Shopify rate limit hit — please retry shortly.");
  }
  if (!res.ok) throw new ShopifyError(`Shopify API error (HTTP ${res.status}).`);

  const json = (await res.json()) as GraphQLResult<T>;
  if (json.errors?.length) {
    const throttled = json.errors.some((e) => e.extensions?.code === "THROTTLED");
    if (throttled && attempt < 4) {
      await sleep(700 * (attempt + 1));
      return shopifyGraphQL<T>(domain, token, query, variables, attempt + 1);
    }
    throw new ShopifyError(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) throw new ShopifyError("Shopify returned no data.");
  return json.data;
}

// ── Save & Test: mint + pull ONE real order ─────────────────────────────────
const TEST_QUERY = /* GraphQL */ `
  query LatestOrder {
    shop { name myshopifyDomain currencyCode }
    orders(first: 1, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          name
          createdAt
          totalPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }
  }
`;

type TestData = {
  shop: { name: string; myshopifyDomain: string; currencyCode: string };
  orders: {
    edges: Array<{
      node: {
        name: string;
        createdAt: string;
        totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
      };
    }>;
  };
};

export type ShopifyTestResult = {
  ok: boolean;
  message: string;
  /** Canonical *.myshopify.com domain, resolved from the live shop. */
  canonicalDomain?: string;
  sample?: {
    shopName: string;
    orderName: string;
    createdAt: string;
    amount: number;
    currency: string;
  };
};

/** Verifies credentials by minting a token and pulling the latest order. */
export async function testShopifyConnection(
  rawDomain: string,
  clientId: string,
  clientSecret: string,
): Promise<ShopifyTestResult> {
  const domain = normalizeShopDomain(rawDomain);
  try {
    const token = await mintAccessToken(domain, clientId, clientSecret);
    const data = await shopifyGraphQL<TestData>(domain, token, TEST_QUERY);
    const canonicalDomain = data.shop.myshopifyDomain || domain;
    const edge = data.orders.edges[0];
    if (!edge) {
      return {
        ok: true,
        canonicalDomain,
        message: `Connected to ${data.shop.name}, but no orders found yet.`,
      };
    }
    return {
      ok: true,
      canonicalDomain,
      message: `Connected to ${data.shop.name}. Pulled latest order ${edge.node.name}.`,
      sample: {
        shopName: data.shop.name,
        orderName: edge.node.name,
        createdAt: edge.node.createdAt,
        amount: Number(edge.node.totalPriceSet.shopMoney.amount),
        currency: edge.node.totalPriceSet.shopMoney.currencyCode,
      },
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof ShopifyError
          ? err.message
          : "Could not reach Shopify. Check the domain, Client ID, and secret.",
    };
  }
}

// ── Primary domain (for matching to a GA4 web stream) ───────────────────────
const PRIMARY_DOMAIN_QUERY = /* GraphQL */ `
  query { shop { myshopifyDomain primaryDomain { host url } } }
`;

/** Returns the store's candidate hosts: primary storefront domain + myshopify. */
export async function fetchShopifyHosts(
  rawDomain: string,
  clientId: string,
  clientSecret: string,
): Promise<string[]> {
  const domain = normalizeShopDomain(rawDomain);
  const token = await mintAccessToken(domain, clientId, clientSecret);
  const data = await shopifyGraphQL<{
    shop: { myshopifyDomain: string; primaryDomain: { host: string } };
  }>(domain, token, PRIMARY_DOMAIN_QUERY);
  return [data.shop.primaryDomain?.host, data.shop.myshopifyDomain, domain].filter(
    (h): h is string => !!h,
  );
}

// ── Metrics: paginate orders in range → ShopifyDailyMetric[] ────────────────
const ORDERS_QUERY = /* GraphQL */ `
  query Orders($query: String!, $cursor: String) {
    shop { ianaTimezone }
    orders(first: 250, query: $query, after: $cursor, sortKey: CREATED_AT) {
      edges {
        node {
          createdAt
          totalPriceSet { shopMoney { amount } }
          totalRefundedSet { shopMoney { amount } }
          customer { id numberOfOrders }
          sourceName
          app { name }
          channelInformation {
            channelDefinition { channelName subChannelName handle }
            app { title }
          }
          customerJourneySummary {
            lastVisit {
              source
              utmParameters { source }
            }
          }
          lineItems(first: 10) {
            edges {
              node {
                title
                quantity
                discountedTotalSet { shopMoney { amount } }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

type OrderNode = {
  createdAt: string;
  totalPriceSet: { shopMoney: { amount: string } };
  totalRefundedSet: { shopMoney: { amount: string } } | null;
  customer: { id: string; numberOfOrders: number } | null;
  sourceName: string | null;
  app: { name: string } | null;
  channelInformation: {
    channelDefinition: {
      channelName: string;
      subChannelName: string | null;
      handle: string;
    } | null;
    app: { title: string } | null;
  } | null;
  customerJourneySummary: {
    lastVisit: {
      source: string | null;
      utmParameters: { source: string | null } | null;
    } | null;
  } | null;
  lineItems: {
    edges: Array<{
      node: {
        title: string;
        quantity: number;
        discountedTotalSet: { shopMoney: { amount: string } } | null;
      };
    }>;
  };
};

type OrdersData = {
  shop: { ianaTimezone: string };
  orders: {
    edges: Array<{ node: OrderNode }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type DayAgg = {
  orders: number;
  revenue: number;
  refunds: number;
  newCustomers: number;
  productQty: Map<string, number>;
};

export type ProductMetric = {
  title: string;
  quantity: number;
  revenue: number;
  orders: number;
};

export type ShopifyData = {
  daily: ShopifyDailyMetric[];
  /** Product-level aggregation across the whole range (for breakdowns). */
  products: ProductMetric[];
  /** Sales-channel aggregation, incl. AI chatbot storefronts (ChatGPT, Claude…). */
  channels: ShopifyChannelMetric[];
};

// ── Sales-channel attribution ───────────────────────────────────────────────
// Agentic (AI) storefronts don't have their own Shopify sales channel — the
// buyer checks out on the Online Store via the AI's in-app browser, so the
// channel is "Online Store". The only thing identifying the AI surface is the
// customer-journey REFERRER (customerJourneySummary.lastVisit.source / utm),
// e.g. "https://chatgpt.com/". So we detect AI storefronts by referrer host,
// and fall back to the native sales channel for everything else.

// AI *chatbot* storefronts, detected by referrer host / utm source. The Shop
// app is a marketplace (not a chatbot), so it's handled separately below and
// NOT flagged AI.
const AI_REFERRER_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /chatgpt\.com|chat\.openai\.com|openai/, label: "ChatGPT" },
  { re: /copilot\.microsoft|copilot|bing\.com/, label: "Microsoft Copilot" },
  { re: /perplexity\.ai/, label: "Perplexity" },
  { re: /gemini\.google|bard\.google/, label: "Google Gemini" },
  { re: /claude\.ai/, label: "Claude" },
];

/** Resolve an order's sales channel to a friendly name + AI flag. */
function resolveChannel(node: OrderNode): { channel: string; ai: boolean } {
  // 1. Referrer-driven AI chatbot storefronts (checkout lands on Online Store).
  const lv = node.customerJourneySummary?.lastVisit;
  const referrers = [lv?.source, lv?.utmParameters?.source]
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase());
  for (const ref of referrers) {
    for (const { re, label } of AI_REFERRER_PATTERNS) {
      if (re.test(ref)) return { channel: label, ai: true };
    }
  }

  // 2. Native sales channel (Online Store, Shop, Facebook, POS, Draft Orders…).
  const def = node.channelInformation?.channelDefinition;
  const raw =
    def?.channelName ||
    node.channelInformation?.app?.title ||
    node.app?.name ||
    node.sourceName ||
    "Unknown";

  // Shop (marketplace) — reached via the native "Shop" sales channel OR a
  // shop.app referral. Grouped under one "Shop" row, but not counted as AI.
  const isShop =
    /^shop$/i.test(raw.trim()) || referrers.some((r) => /shop\.app/.test(r));
  if (isShop) return { channel: "Shop", ai: false };

  return { channel: raw, ai: false };
}

type ChannelAgg = {
  ai: boolean;
  orders: number;
  revenue: number;
  newCustomers: number;
};

/**
 * Single paginated pull → both daily metrics and a product breakdown.
 * Used by the dashboard and the chat tools so we query Shopify once per range.
 */
export async function fetchShopifyData(
  rawDomain: string,
  clientId: string,
  clientSecret: string,
  range: DateRange,
): Promise<ShopifyData> {
  const domain = normalizeShopDomain(rawDomain);
  const token = await mintAccessToken(domain, clientId, clientSecret);
  // Widen the UTC filter by ±1 day so we don't miss orders that fall inside the
  // range once converted to the shop's local timezone; we filter precisely below.
  const query =
    `created_at:>=${addDays(range.start, -1)}T00:00:00Z ` +
    `created_at:<=${addDays(range.end, 1)}T23:59:59Z`;

  const byDay = new Map<string, DayAgg>();
  const byChannel = new Map<string, ChannelAgg>();
  const seenCustomers = new Set<string>();
  const products = new Map<string, ProductMetric>();
  let shopTz = "UTC";

  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: OrdersData = await shopifyGraphQL<OrdersData>(
      domain,
      token,
      ORDERS_QUERY,
      { query, cursor },
    );
    shopTz = data.shop?.ianaTimezone || shopTz;

    for (const { node } of data.orders.edges) {
      // Bucket by the order's date in the SHOP's timezone (matches Shopify admin),
      // and drop anything outside the requested range after conversion.
      const day = localDate(node.createdAt, shopTz);
      if (day < range.start || day > range.end) continue;
      const agg = byDay.get(day) ?? {
        orders: 0,
        revenue: 0,
        refunds: 0,
        newCustomers: 0,
        productQty: new Map<string, number>(),
      };
      // Match Shopify Analytics "Total sales": order total (incl. tax + shipping)
      // minus refunds/returns. Previously refunds weren't subtracted, so Revenue
      // read high by the returns amount.
      const refunded = Number(node.totalRefundedSet?.shopMoney.amount) || 0;
      const revenue = (Number(node.totalPriceSet.shopMoney.amount) || 0) - refunded;
      agg.orders += 1;
      agg.revenue += revenue;
      agg.refunds += refunded;

      // Attribute this order to its sales channel (Online Store, ChatGPT, …).
      const { channel, ai } = resolveChannel(node);
      const chAgg = byChannel.get(channel) ?? {
        ai,
        orders: 0,
        revenue: 0,
        newCustomers: 0,
      };
      chAgg.orders += 1;
      chAgg.revenue += revenue;

      const cid = node.customer?.id;
      const isNew =
        !!cid && !seenCustomers.has(cid) && (node.customer?.numberOfOrders ?? 0) <= 1;
      if (cid && !seenCustomers.has(cid)) {
        seenCustomers.add(cid);
        if (isNew) agg.newCustomers += 1;
      }
      if (isNew) chAgg.newCustomers += 1;
      byChannel.set(channel, chAgg);

      const productsInOrder = new Set<string>();
      for (const { node: li } of node.lineItems.edges) {
        const qty = li.quantity || 0;
        const rev = Number(li.discountedTotalSet?.shopMoney.amount) || 0;
        agg.productQty.set(li.title, (agg.productQty.get(li.title) ?? 0) + qty);

        const p = products.get(li.title) ?? {
          title: li.title,
          quantity: 0,
          revenue: 0,
          orders: 0,
        };
        p.quantity += qty;
        p.revenue += rev;
        if (!productsInOrder.has(li.title)) {
          p.orders += 1;
          productsInOrder.add(li.title);
        }
        products.set(li.title, p);
      }
      byDay.set(day, agg);
    }

    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  const daily = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, agg]) => ({
      source: "shopify" as const,
      date,
      orders: agg.orders,
      revenue: round2(agg.revenue),
      refunds: round2(agg.refunds),
      newCustomers: agg.newCustomers,
      topProduct: topOf(agg.productQty),
    }));

  const productList = [...products.values()]
    .map((p) => ({ ...p, revenue: round2(p.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);

  const channels: ShopifyChannelMetric[] = [...byChannel.entries()]
    .map(([channel, c]) => ({
      channel,
      ai: c.ai,
      orders: c.orders,
      revenue: round2(c.revenue),
      newCustomers: c.newCustomers,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return { daily, products: productList, channels };
}

/** Daily metrics only (adapter interface). */
export async function fetchShopifyDailyMetrics(
  rawDomain: string,
  clientId: string,
  clientSecret: string,
  range: DateRange,
): Promise<ShopifyDailyMetric[]> {
  return (await fetchShopifyData(rawDomain, clientId, clientSecret, range)).daily;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function topOf(m: Map<string, number>): string | undefined {
  let best: string | undefined;
  let bestQty = -1;
  for (const [title, qty] of m) {
    if (qty > bestQty) {
      best = title;
      bestQty = qty;
    }
  }
  return best;
}

// ── DataAdapter implementation (used by chat tools / dashboard) ─────────────
// config: { domain, clientId }   secret: clientSecret
export const shopifyAdapter: DataAdapter = {
  source: "shopify",
  label: "Shopify",
  async isConnected(ctx: AdapterContext) {
    const secret = await ctx.getSecret();
    return Boolean(secret && ctx.config.domain && ctx.config.clientId);
  },
  async test(ctx: AdapterContext) {
    const clientSecret = await ctx.getSecret();
    const domain = ctx.config.domain as string | undefined;
    const clientId = ctx.config.clientId as string | undefined;
    if (!clientSecret || !domain || !clientId)
      return { ok: false, message: "Shopify is not configured." };
    const r = await testShopifyConnection(domain, clientId, clientSecret);
    return { ok: r.ok, message: r.message };
  },
  async getMetrics(ctx: AdapterContext, range: DateRange) {
    const clientSecret = await ctx.getSecret();
    const domain = ctx.config.domain as string | undefined;
    const clientId = ctx.config.clientId as string | undefined;
    if (!clientSecret || !domain || !clientId) return [];
    return fetchShopifyDailyMetrics(domain, clientId, clientSecret, range);
  },
};
