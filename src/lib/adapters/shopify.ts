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

type GraphQLResult<T> = {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: { cost?: unknown };
};

class ShopifyError extends Error {}

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
      "Shopify rejected the token (401/403). Check the Admin API access token and that the app has read_orders scope.",
    );
  }
  if (res.status === 404) {
    throw new ShopifyError(
      `Store not found at ${domain}. Check the store domain (e.g. your-store.myshopify.com).`,
    );
  }
  if (res.status === 429) {
    // REST-style rate limit; back off and retry.
    if (attempt < 4) {
      await sleep(500 * (attempt + 1));
      return shopifyGraphQL<T>(domain, token, query, variables, attempt + 1);
    }
    throw new ShopifyError("Shopify rate limit hit — please retry shortly.");
  }
  if (!res.ok) {
    throw new ShopifyError(`Shopify API error (HTTP ${res.status}).`);
  }

  const json = (await res.json()) as GraphQLResult<T>;

  if (json.errors?.length) {
    const throttled = json.errors.some(
      (e) => e.extensions?.code === "THROTTLED",
    );
    if (throttled && attempt < 4) {
      await sleep(700 * (attempt + 1));
      return shopifyGraphQL<T>(domain, token, query, variables, attempt + 1);
    }
    throw new ShopifyError(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) throw new ShopifyError("Shopify returned no data.");
  return json.data;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Save & Test: pull ONE real order ───────────────────────────────────────
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
  sample?: {
    shopName: string;
    orderName: string;
    createdAt: string;
    amount: number;
    currency: string;
  };
};

/** Verifies credentials by pulling the single most recent order. */
export async function testShopifyConnection(
  rawDomain: string,
  token: string,
): Promise<ShopifyTestResult> {
  const domain = normalizeShopDomain(rawDomain);
  try {
    const data = await shopifyGraphQL<TestData>(domain, token, TEST_QUERY);
    const edge = data.orders.edges[0];
    if (!edge) {
      return {
        ok: true,
        message: `Connected to ${data.shop.name}, but no orders found yet.`,
      };
    }
    const amount = Number(edge.node.totalPriceSet.shopMoney.amount);
    return {
      ok: true,
      message: `Connected to ${data.shop.name}. Pulled latest order ${edge.node.name}.`,
      sample: {
        shopName: data.shop.name,
        orderName: edge.node.name,
        createdAt: edge.node.createdAt,
        amount,
        currency: edge.node.totalPriceSet.shopMoney.currencyCode,
      },
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof ShopifyError
          ? err.message
          : "Could not reach Shopify. Check the domain and token.",
    };
  }
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
          lineItems(first: 5) {
            edges { node { title quantity } }
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
  lineItems: { edges: Array<{ node: { title: string; quantity: number } }> };
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

export async function fetchShopifyDailyMetrics(
  rawDomain: string,
  token: string,
  range: DateRange,
): Promise<ShopifyDailyMetric[]> {
  const domain = normalizeShopDomain(rawDomain);
  const query = `created_at:>=${range.start} created_at:<=${range.end}`;

  const byDay = new Map<string, DayAgg>();
  const seenCustomers = new Set<string>();

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
        // "New to this window" the first time we see the customer.
        if ((node.customer?.numberOfOrders ?? 0) <= 1) agg.newCustomers += 1;
      }

      for (const { node: li } of node.lineItems.edges) {
        agg.productQty.set(
          li.title,
          (agg.productQty.get(li.title) ?? 0) + (li.quantity || 0),
        );
      }
      byDay.set(day, agg);
    }

    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, agg]) => ({
      source: "shopify" as const,
      date,
      orders: agg.orders,
      revenue: Math.round(agg.revenue * 100) / 100,
      refunds: Math.round(agg.refunds * 100) / 100,
      newCustomers: agg.newCustomers,
      topProduct: topOf(agg.productQty),
    }));
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
export const shopifyAdapter: DataAdapter = {
  source: "shopify",
  label: "Shopify",
  async isConnected(ctx: AdapterContext) {
    const token = await ctx.getSecret();
    return Boolean(token && ctx.config.domain);
  },
  async test(ctx: AdapterContext) {
    const token = await ctx.getSecret();
    const domain = ctx.config.domain as string | undefined;
    if (!token || !domain)
      return { ok: false, message: "Shopify is not configured." };
    const r = await testShopifyConnection(domain, token);
    return { ok: r.ok, message: r.message };
  },
  async getMetrics(ctx: AdapterContext, range: DateRange) {
    const token = await ctx.getSecret();
    const domain = ctx.config.domain as string | undefined;
    if (!token || !domain) return [];
    return fetchShopifyDailyMetrics(domain, token, range);
  },
};
