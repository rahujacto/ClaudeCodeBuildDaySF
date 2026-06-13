import type {
  AdapterContext,
  DataAdapter,
  DateRange,
  ShopifyDailyMetric,
} from "./types";

const API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2025-10";
const MAX_PAGES = 20; // safety cap: 250 orders/page

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
    orders(first: 250, query: $query, after: $cursor, sortKey: CREATED_AT) {
      edges {
        node {
          createdAt
          totalPriceSet { shopMoney { amount } }
          totalRefundedSet { shopMoney { amount } }
          customer { id numberOfOrders }
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
  const query = `created_at:>=${range.start} created_at:<=${range.end}`;

  const byDay = new Map<string, DayAgg>();
  const seenCustomers = new Set<string>();
  const products = new Map<string, ProductMetric>();

  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: OrdersData = await shopifyGraphQL<OrdersData>(
      domain,
      token,
      ORDERS_QUERY,
      { query, cursor },
    );

    for (const { node } of data.orders.edges) {
      const day = node.createdAt.slice(0, 10);
      const agg = byDay.get(day) ?? {
        orders: 0,
        revenue: 0,
        refunds: 0,
        newCustomers: 0,
        productQty: new Map<string, number>(),
      };
      agg.orders += 1;
      agg.revenue += Number(node.totalPriceSet.shopMoney.amount) || 0;
      agg.refunds += Number(node.totalRefundedSet?.shopMoney.amount) || 0;

      const cid = node.customer?.id;
      if (cid && !seenCustomers.has(cid)) {
        seenCustomers.add(cid);
        if ((node.customer?.numberOfOrders ?? 0) <= 1) agg.newCustomers += 1;
      }

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

  return { daily, products: productList };
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
