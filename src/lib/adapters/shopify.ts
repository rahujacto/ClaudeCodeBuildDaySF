import type {
  AdapterContext,
  DataAdapter,
  DateRange,
  ShopifyChannelMetric,
  ShopifyDailyMetric,
} from "./types";
import { unstable_cache } from "next/cache";
import { addDays } from "@/lib/dates";

const API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2025-10";
// 100 orders/page (see orders query) keeps each request's cost well under the
// rate-limit ceiling; the higher page cap covers a full year without truncating.
const MAX_PAGES = 120; // 100 orders/page → up to 12k orders/range

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
type ThrottleStatus = { currentlyAvailable?: number; restoreRate?: number };
type CostExt = { requestedQueryCost?: number; throttleStatus?: ThrottleStatus };
type GraphQLResult<T> = {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: { cost?: CostExt };
};

const MAX_ATTEMPTS = 6;

/**
 * How long to wait before retrying a throttled request: enough for the leaky
 * bucket to restore this request's cost, based on Shopify's reported restoreRate.
 * Falls back to a linear backoff when the cost extension isn't present.
 */
function throttleWaitMs(cost: CostExt | undefined, attempt: number): number {
  const rate = cost?.throttleStatus?.restoreRate ?? 50; // points/sec
  const need = cost?.requestedQueryCost ?? 100;
  const available = cost?.throttleStatus?.currentlyAvailable ?? 0;
  const deficit = Math.max(0, need - available);
  const byRate = deficit > 0 ? (deficit / rate) * 1000 : 0;
  return Math.min(8000, Math.max(700 * (attempt + 1), byRate + 250));
}

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
    if (attempt < MAX_ATTEMPTS) {
      await sleep(throttleWaitMs(undefined, attempt));
      return shopifyGraphQL<T>(domain, token, query, variables, attempt + 1);
    }
    throw new ShopifyError("Shopify rate limit hit — please retry shortly.");
  }
  if (!res.ok) throw new ShopifyError(`Shopify API error (HTTP ${res.status}).`);

  const json = (await res.json()) as GraphQLResult<T>;
  if (json.errors?.length) {
    const throttled = json.errors.some((e) => e.extensions?.code === "THROTTLED");
    if (throttled && attempt < MAX_ATTEMPTS) {
      // Wait for the leaky bucket to restore (cost-aware), then retry.
      await sleep(throttleWaitMs(json.extensions?.cost, attempt));
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
    orders(first: 100, query: $query, after: $cursor, sortKey: CREATED_AT) {
      edges {
        node {
          createdAt
          totalPriceSet { shopMoney { amount } }
          currentTotalPriceSet { shopMoney { amount } }
          totalRefundedSet { shopMoney { amount } }
          refunds { id createdAt totalRefundedSet { shopMoney { amount } } }
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
  currentTotalPriceSet: { shopMoney: { amount: string } } | null;
  totalRefundedSet: { shopMoney: { amount: string } } | null;
  refunds: Array<{
    id: string;
    createdAt: string;
    totalRefundedSet: { shopMoney: { amount: string } } | null;
  }>;
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
      // Match Shopify Analytics "Total sales": use currentTotalPriceSet — the
      // order total (incl. tax + shipping) AFTER returns, refunds, and edits.
      // (totalPriceSet − totalRefundedSet read ~4% high because refunds capture
      //  only money returned, not the full value of returns/exchanges/restocks.)
      const refunded = Number(node.totalRefundedSet?.shopMoney.amount) || 0;
      const revenue =
        Number(node.currentTotalPriceSet?.shopMoney.amount ?? node.totalPriceSet.shopMoney.amount) ||
        0;
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

// ── Day-granular rows for the Postgres cache (see lib/shopify-cache.ts) ─────
export type ShopifyDayRow = {
  day: string;
  orders: number;
  gross: number; // Σ totalPrice (order-dated)
  revenueCurrent: number; // Σ currentTotalPrice (order-dated, post-refund)
  refundsOrderDated: number;
  newCustomers: number;
  products: ProductMetric[];
  channels: ShopifyChannelMetric[];
};

export type ShopifyRefundRow = {
  refundId: string;
  orderDay: string; // shop-local day of the parent order
  processedDay: string; // shop-local day the refund was created
  amount: number;
};

/**
 * Pull a window of orders and aggregate PER DAY (shop-local), plus every refund
 * on those orders bucketed by its processed date. This is the sync engine's
 * source of truth — same query/attribution logic as fetchShopifyData, but with
 * per-day product/channel breakdowns so any custom range can be re-assembled
 * from day rows.
 */
export async function fetchShopifyDayRows(
  rawDomain: string,
  clientId: string,
  clientSecret: string,
  range: DateRange,
): Promise<{ days: ShopifyDayRow[]; refunds: ShopifyRefundRow[] }> {
  const domain = normalizeShopDomain(rawDomain);
  const token = await mintAccessToken(domain, clientId, clientSecret);
  const query =
    `created_at:>=${addDays(range.start, -1)}T00:00:00Z ` +
    `created_at:<=${addDays(range.end, 1)}T23:59:59Z`;

  type FullDayAgg = {
    orders: number;
    gross: number;
    revenueCurrent: number;
    refundsOrderDated: number;
    newCustomers: number;
    products: Map<string, ProductMetric>;
    channels: Map<string, ChannelAgg>;
  };
  const byDay = new Map<string, FullDayAgg>();
  const refunds: ShopifyRefundRow[] = [];
  const seenCustomers = new Set<string>();
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
      const day = localDate(node.createdAt, shopTz);
      if (day < range.start || day > range.end) continue;

      const agg = byDay.get(day) ?? {
        orders: 0,
        gross: 0,
        revenueCurrent: 0,
        refundsOrderDated: 0,
        newCustomers: 0,
        products: new Map<string, ProductMetric>(),
        channels: new Map<string, ChannelAgg>(),
      };
      const gross = Number(node.totalPriceSet.shopMoney.amount) || 0;
      const current =
        Number(node.currentTotalPriceSet?.shopMoney.amount ?? node.totalPriceSet.shopMoney.amount) || 0;
      agg.orders += 1;
      agg.gross += gross;
      agg.revenueCurrent += current;
      agg.refundsOrderDated += Number(node.totalRefundedSet?.shopMoney.amount) || 0;

      // Every refund on this order, dated by when it was PROCESSED.
      for (const r of node.refunds ?? []) {
        const amount = Number(r.totalRefundedSet?.shopMoney.amount) || 0;
        if (amount <= 0) continue;
        refunds.push({
          refundId: r.id,
          orderDay: day,
          processedDay: localDate(r.createdAt, shopTz),
          amount: round2(amount),
        });
      }

      const cid = node.customer?.id;
      const isNew =
        !!cid && !seenCustomers.has(cid) && (node.customer?.numberOfOrders ?? 0) <= 1;
      if (cid) seenCustomers.add(cid);
      if (isNew) agg.newCustomers += 1;

      const { channel, ai } = resolveChannel(node);
      const ch = agg.channels.get(channel) ?? { ai, orders: 0, revenue: 0, newCustomers: 0 };
      ch.orders += 1;
      ch.revenue += current;
      if (isNew) ch.newCustomers += 1;
      agg.channels.set(channel, ch);

      const productsInOrder = new Set<string>();
      for (const { node: li } of node.lineItems.edges) {
        const p = agg.products.get(li.title) ?? {
          title: li.title,
          quantity: 0,
          revenue: 0,
          orders: 0,
        };
        p.quantity += li.quantity || 0;
        p.revenue += Number(li.discountedTotalSet?.shopMoney.amount) || 0;
        if (!productsInOrder.has(li.title)) {
          p.orders += 1;
          productsInOrder.add(li.title);
        }
        agg.products.set(li.title, p);
      }
      byDay.set(day, agg);
    }

    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  const days = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, a]) => ({
      day,
      orders: a.orders,
      gross: round2(a.gross),
      revenueCurrent: round2(a.revenueCurrent),
      refundsOrderDated: round2(a.refundsOrderDated),
      newCustomers: a.newCustomers,
      products: [...a.products.values()]
        .map((p) => ({ ...p, revenue: round2(p.revenue) }))
        .sort((x, y) => y.revenue - x.revenue),
      channels: [...a.channels.entries()]
        .map(([channel, c]) => ({
          channel,
          ai: c.ai,
          orders: c.orders,
          revenue: round2(c.revenue),
          newCustomers: c.newCustomers,
        }))
        .sort((x, y) => y.revenue - x.revenue),
    }));

  return { days, refunds };
}

/**
 * Days whose orders changed since `sinceIso` (shop-local dates). Cheap query —
 * only createdAt/updatedAt — used by the incremental sync to know which days to
 * re-pull. Returns the max updatedAt seen so the cursor can advance safely even
 * when capped.
 */
export async function fetchUpdatedOrderDays(
  rawDomain: string,
  clientId: string,
  clientSecret: string,
  sinceIso: string,
  maxPages = 5,
): Promise<{ days: Set<string>; maxUpdatedAt: string | null; capped: boolean }> {
  const domain = normalizeShopDomain(rawDomain);
  const token = await mintAccessToken(domain, clientId, clientSecret);
  const QUERY = /* GraphQL */ `
    query Updated($query: String!, $cursor: String) {
      shop { ianaTimezone }
      orders(first: 100, query: $query, after: $cursor, sortKey: UPDATED_AT) {
        edges { node { createdAt updatedAt } }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
  type Row = { createdAt: string; updatedAt: string };
  type Data = {
    shop: { ianaTimezone: string };
    orders: {
      edges: Array<{ node: Row }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };

  const days = new Set<string>();
  let maxUpdatedAt: string | null = null;
  let capped = false;
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const data: Data = await shopifyGraphQL<Data>(domain, token, QUERY, {
      query: `updated_at:>=${sinceIso}`,
      cursor,
    });
    const tz = data.shop?.ianaTimezone || "UTC";
    for (const { node } of data.orders.edges) {
      days.add(localDate(node.createdAt, tz));
      if (!maxUpdatedAt || node.updatedAt > maxUpdatedAt) maxUpdatedAt = node.updatedAt;
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    if (page === maxPages - 1) capped = true;
    cursor = data.orders.pageInfo.endCursor;
  }
  return { days, maxUpdatedAt, capped };
}

// ── Durable per-org cache (Next Data Cache) ─────────────────────────────────
// A full-year range is an expensive live pull that gets re-requested on every
// dashboard load (and would throttle Shopify). Cache the result per org+range
// for a short TTL. Bump CACHE_VERSION whenever the metric definitions change so
// stale entries are ignored after a deploy.
const CACHE_VERSION = "2026-07-currentTotalPrice";
const CACHE_TTL_SECONDS = 600; // 10 minutes

/**
 * Cached Shopify pull. On a hit (within the TTL) returns instantly without
 * touching Shopify; on a miss fetches live and stores it. Keyed by org + shop +
 * range only — the secret is captured in the closure, never in the cache key.
 */
export function fetchShopifyDataCached(
  orgId: string,
  rawDomain: string,
  clientId: string,
  clientSecret: string,
  range: DateRange,
): Promise<ShopifyData> {
  const domain = normalizeShopDomain(rawDomain);
  const run = unstable_cache(
    (start: string, end: string) =>
      fetchShopifyData(domain, clientId, clientSecret, { start, end }),
    ["shopify-data", CACHE_VERSION, orgId, domain],
    { revalidate: CACHE_TTL_SECONDS },
  );
  return run(range.start, range.end);
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
