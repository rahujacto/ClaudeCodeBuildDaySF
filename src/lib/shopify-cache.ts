import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { decryptSecret } from "@/lib/crypto";
import { addDays, todayUTC } from "@/lib/dates";
import type { DateRange, ShopifyChannelMetric, ShopifyDailyMetric } from "@/lib/adapters/types";
import {
  fetchShopifyDayRows,
  fetchShopifyDataCached,
  fetchShopifyqlTotalSales,
  fetchUpdatedOrderDays,
  type ProductMetric,
  type ShopifyData,
} from "@/lib/adapters/shopify";

/**
 * Postgres-backed Shopify metrics cache.
 *
 * Write side (runShopifySync): backfills day-granular aggregates going backwards
 * from today, then keeps them fresh incrementally via Shopify's updated_at —
 * so refunds/edits to OLD orders re-sync their days instead of drifting.
 * Refunds are also stored per-refund, bucketed by PROCESSED date, which lets
 * the read side reproduce Shopify Analytics' ledger-style "Total sales".
 *
 * Read side (loadShopifyData): serves any range from day rows (fast SQL, zero
 * Shopify calls); falls back to the live pull when the range isn't covered yet
 * or the cache has gone stale (cron dead).
 */

const BACKFILL_DAYS = 750; // ~24 months → prior-period compare works for 1-year ranges
const CHUNK_DAYS = 30;
const STALE_MS = 30 * 60_000; // cache considered dead if no sync ran in 30 min
const SELF_SYNC_MS = 5 * 60_000; // page loads top up the sync if older than this

type SyncState = {
  org_id: string;
  backfill_until: string | null;
  backfill_done: boolean;
  updated_cursor: string | null;
  last_run_at: string | null;
  last_error: string | null;
};

export type ShopifyCreds = { domain: string; clientId: string; secret: string };

async function credsForOrg(sb: SupabaseClient, orgId: string): Promise<ShopifyCreds | null> {
  const { data } = await sb
    .from("connections")
    .select("status,config,secret_ref")
    .eq("org_id", orgId)
    .eq("source", "shopify")
    .maybeSingle();
  if (data?.status !== "connected" || !data.secret_ref) return null;
  const domain = data.config?.domain as string | undefined;
  const clientId = data.config?.clientId as string | undefined;
  if (!domain || !clientId) return null;
  return { domain, clientId, secret: decryptSecret(data.secret_ref) };
}

async function upsertWindow(
  sb: SupabaseClient,
  orgId: string,
  pulled: Awaited<ReturnType<typeof fetchShopifyDayRows>>,
) {
  if (pulled.days.length) {
    const rows = pulled.days.map((d) => ({
      org_id: orgId,
      day: d.day,
      orders: d.orders,
      gross: d.gross,
      revenue_current: d.revenueCurrent,
      refunds_order_dated: d.refundsOrderDated,
      new_customers: d.newCustomers,
      products: d.products,
      channels: d.channels,
      synced_at: new Date().toISOString(),
    }));
    const { error } = await sb.from("shopify_daily").upsert(rows, { onConflict: "org_id,day" });
    if (error) throw new Error(`shopify_daily upsert: ${error.message}`);
  }
  if (pulled.refunds.length) {
    const rows = pulled.refunds.map((r) => ({
      org_id: orgId,
      refund_id: r.refundId,
      order_day: r.orderDay,
      processed_day: r.processedDay,
      amount: r.amount,
      value_amount: r.valueAmount,
      synced_at: new Date().toISOString(),
    }));
    const { error } = await sb.from("shopify_refunds").upsert(rows, { onConflict: "org_id,refund_id" });
    if (error) throw new Error(`shopify_refunds upsert: ${error.message}`);
  }
}

/**
 * Overlay Shopify's OWN Analytics numbers (ShopifyQL total_sales) onto the day
 * rows. Upsert-only-this-column: existing rows keep their order-derived fields;
 * days QL knows about that we have no row for (e.g. returns-only days) get a
 * zero-orders row. Throws when read_reports is unavailable — callers swallow it
 * and the read path falls back to the order-derived approximation.
 */
async function syncQlWindow(
  sb: SupabaseClient,
  orgId: string,
  creds: ShopifyCreds,
  range: DateRange,
) {
  const days = await fetchShopifyqlTotalSales(creds.domain, creds.clientId, creds.secret, range);
  if (days.length) {
    const rows = days.map((d) => ({ org_id: orgId, day: d.day, total_sales: d.totalSales }));
    const { error } = await sb.from("shopify_daily").upsert(rows, { onConflict: "org_id,day" });
    if (error) throw new Error(`shopify_daily QL upsert: ${error.message}`);
  }
  // Row-days QL didn't mention have no sales activity per Shopify — mark 0 so
  // the gap-fill loop terminates and reads don't fall back for those days.
  await sb
    .from("shopify_daily")
    .update({ total_sales: 0 })
    .eq("org_id", orgId)
    .gte("day", range.start)
    .lte("day", range.end)
    .is("total_sales", null);
}

/** Group a set of days into contiguous ranges so we pull few windows. */
function toRanges(days: string[]): DateRange[] {
  const sorted = [...days].sort();
  const out: DateRange[] = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && addDays(last.end, 1) >= d) last.end = d > last.end ? d : last.end;
    else out.push({ start: d, end: d });
  }
  return out;
}

/**
 * Advance the sync for one org within a time budget. Safe to call from the
 * cron (service role) or opportunistically from page loads (member RLS) —
 * upserts are idempotent, so overlapping runs are harmless.
 */
export async function runShopifySync(
  sb: SupabaseClient,
  orgId: string,
  budgetMs = 45_000,
): Promise<{ ok: boolean; did: string[]; error?: string }> {
  const deadline = Date.now() + budgetMs;
  const did: string[] = [];
  const creds = await credsForOrg(sb, orgId);
  if (!creds) return { ok: false, did, error: "Shopify not connected" };

  const today = todayUTC();
  const target = addDays(today, -(BACKFILL_DAYS - 1));

  let { data: state } = (await sb
    .from("shopify_sync_state")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle()) as { data: SyncState | null };
  if (!state) {
    state = {
      org_id: orgId,
      backfill_until: null,
      backfill_done: false,
      updated_cursor: null,
      last_run_at: null,
      last_error: null,
    };
    await sb.from("shopify_sync_state").upsert(state, { onConflict: "org_id" });
  }

  const save = async (patch: Partial<SyncState>) => {
    Object.assign(state!, patch);
    await sb
      .from("shopify_sync_state")
      .update({ ...patch, last_run_at: new Date().toISOString() })
      .eq("org_id", orgId);
  };

  try {
    // Phase 1 — backfill backwards from today in CHUNK_DAYS windows.
    while (!state.backfill_done && Date.now() < deadline - 8_000) {
      const end = state.backfill_until ? addDays(state.backfill_until, -1) : today;
      if (end < target) {
        await save({ backfill_done: true });
        break;
      }
      const start = addDays(end, -(CHUNK_DAYS - 1)) > target ? addDays(end, -(CHUNK_DAYS - 1)) : target;
      const pulled = await fetchShopifyDayRows(creds.domain, creds.clientId, creds.secret, { start, end });
      await upsertWindow(sb, orgId, pulled);
      try {
        await syncQlWindow(sb, orgId, creds, { start, end });
      } catch {
        /* read_reports unavailable — order-derived numbers still serve */
      }
      await save({ backfill_until: start, backfill_done: start === target, last_error: null });
      did.push(`backfill ${start}..${end} (${pulled.days.length}d)`);
    }

    // Phase 2 — incremental: re-pull days whose orders changed (refunds/edits),
    // plus always today+yesterday.
    if (state.backfill_done && Date.now() < deadline - 5_000) {
      const since = state.updated_cursor ?? new Date(Date.now() - 60 * 60_000).toISOString();
      // 2-min overlap so we never miss an update racing the cursor.
      const overlapped = new Date(Date.parse(since) - 2 * 60_000).toISOString();
      const upd = await fetchUpdatedOrderDays(creds.domain, creds.clientId, creds.secret, overlapped);
      upd.days.add(today);
      upd.days.add(addDays(today, -1));
      // Never re-pull days older than the backfill window (no rows to fix there).
      const days = [...upd.days].filter((d) => d >= target);
      for (const range of toRanges(days)) {
        if (Date.now() > deadline - 3_000) break;
        const pulled = await fetchShopifyDayRows(creds.domain, creds.clientId, creds.secret, range);
        await upsertWindow(sb, orgId, pulled);
        try {
          await syncQlWindow(sb, orgId, creds, range);
        } catch {
          /* read_reports unavailable — order-derived numbers still serve */
        }
        did.push(`refresh ${range.start}..${range.end}`);
      }
      // If capped, advance only to the max updatedAt actually processed.
      const cursor = upd.capped && upd.maxUpdatedAt ? upd.maxUpdatedAt : new Date().toISOString();
      await save({ updated_cursor: cursor, last_error: null });
    }

    // Phase 3 — ShopifyQL gap-fill: days backfilled before QL existed (or while
    // the scope was missing) get Shopify's authoritative total_sales, in
    // 180-day windows until the whole history is covered.
    if (state.backfill_done) {
      while (Date.now() < deadline - 5_000) {
        const { data: gap } = await sb
          .from("shopify_daily")
          .select("day")
          .eq("org_id", orgId)
          .is("total_sales", null)
          .gte("day", target)
          .order("day")
          .limit(1);
        const gapDay = gap?.[0]?.day ? String(gap[0].day) : null;
        if (!gapDay) break;
        const end = addDays(gapDay, 179) < today ? addDays(gapDay, 179) : today;
        try {
          await syncQlWindow(sb, orgId, creds, { start: gapDay, end });
          did.push(`ql ${gapDay}..${end}`);
        } catch {
          did.push("ql unavailable (read_reports scope?)");
          break;
        }
      }
    }
    return { ok: true, did };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sync failed";
    await save({ last_error: msg });
    return { ok: false, did, error: msg };
  }
}

// ── Read side ────────────────────────────────────────────────────────────────

type DailyRow = {
  day: string;
  orders: number;
  gross: number;
  revenue_current: number;
  refunds_order_dated: number;
  new_customers: number;
  total_sales: number | string | null; // Shopify's own Analytics number (authoritative)
  products: ProductMetric[];
  channels: ShopifyChannelMetric[];
};

/**
 * Serve ShopifyData for a range from the Postgres cache.
 *
 * Revenue per day = shopify_daily.total_sales — Shopify's OWN Analytics
 * "Total sales" via ShopifyQL, i.e. an exact match with the merchant's
 * Analytics page. Days the QL sync hasn't covered (or if read_reports is ever
 * lost) fall back to our order-derived approximation: gross that day −
 * item-valued returns processed that day (verified within ~0.15% on live
 * data). Days are fully additive, so any custom range reconciles the same way.
 *
 * Falls back to the live pull when the range isn't backfilled yet or the cache
 * is stale; page loads also opportunistically advance the sync (after response).
 */
export async function loadShopifyData(
  sb: SupabaseClient,
  orgId: string,
  creds: ShopifyCreds,
  range: DateRange,
): Promise<ShopifyData> {
  const [data] = await loadShopifyDataForRanges(sb, orgId, creds, [range]);
  return data;
}

/**
 * Same as loadShopifyData for several ranges at once (e.g. current + prior
 * period): one sync-state read and at most one self-sync kick, ranges served
 * in parallel.
 */
export async function loadShopifyDataForRanges(
  sb: SupabaseClient,
  orgId: string,
  creds: ShopifyCreds,
  ranges: DateRange[],
): Promise<ShopifyData[]> {
  const { data: state } = (await sb
    .from("shopify_sync_state")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle()) as { data: SyncState | null };

  const lastRun = state?.last_run_at ? Date.parse(state.last_run_at) : 0;
  const fresh = Date.now() - lastRun < STALE_MS;

  // Keep the cache advancing even without a working cron: after the response,
  // spend a small budget on backfill/incremental if nothing ran recently.
  if (!state || Date.now() - lastRun > SELF_SYNC_MS) {
    try {
      after(() => runShopifySync(sb, orgId, 25_000).catch(() => {}));
    } catch {
      /* outside a request scope (e.g. tests) — cron will cover it */
    }
  }

  return Promise.all(
    ranges.map((range) => {
      const covered =
        !!state &&
        (state.backfill_done || (state.backfill_until !== null && state.backfill_until <= range.start));
      if (!covered || !fresh) {
        return fetchShopifyDataCached(orgId, creds.domain, creds.clientId, creds.secret, range);
      }
      return serveRangeFromCache(sb, orgId, creds, range);
    }),
  );
}

async function serveRangeFromCache(
  sb: SupabaseClient,
  orgId: string,
  creds: ShopifyCreds,
  range: DateRange,
): Promise<ShopifyData> {
  const [dailyRes, refundRes] = await Promise.all([
    sb
      .from("shopify_daily")
      .select("day,orders,gross,revenue_current,refunds_order_dated,new_customers,total_sales,products,channels")
      .eq("org_id", orgId)
      .gte("day", range.start)
      .lte("day", range.end)
      .order("day"),
    sb
      .from("shopify_refunds")
      .select("processed_day,amount,value_amount")
      .eq("org_id", orgId)
      .gte("processed_day", range.start)
      .lte("processed_day", range.end),
  ]);
  if (dailyRes.error || refundRes.error) {
    return fetchShopifyDataCached(orgId, creds.domain, creds.clientId, creds.secret, range);
  }

  // Returns valued the Shopify way (item value, not cash), by processed day.
  const returnsByDay = new Map<string, number>();
  for (const r of refundRes.data ?? []) {
    const day = String(r.processed_day);
    returnsByDay.set(day, (returnsByDay.get(day) ?? 0) + Number(r.value_amount));
  }

  const rows = (dailyRes.data ?? []) as unknown as DailyRow[];
  const allDays = new Set<string>([...rows.map((r) => String(r.day)), ...returnsByDay.keys()]);
  const rowByDay = new Map(rows.map((r) => [String(r.day), r]));

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const daily: ShopifyDailyMetric[] = [...allDays]
    .sort()
    .map((day) => {
      const r = rowByDay.get(day);
      const returns = returnsByDay.get(day) ?? 0;
      const topProduct = r?.products?.length
        ? [...r.products].sort((a, b) => b.quantity - a.quantity)[0].title
        : undefined;
      return {
        source: "shopify" as const,
        date: day,
        orders: Number(r?.orders ?? 0),
        // Prefer Shopify's OWN Analytics "Total sales" (ShopifyQL — exact match
        // with the merchant's Analytics page); fall back to our order-derived
        // approximation (gross − item-valued returns processed that day) for
        // days the QL sync hasn't covered. Can go negative on return-heavy
        // days, same as Shopify's chart.
        revenue:
          r?.total_sales != null
            ? round2(Number(r.total_sales))
            : round2(Number(r?.gross ?? 0) - returns),
        refunds: round2(returns),
        newCustomers: Number(r?.new_customers ?? 0),
        topProduct,
      };
    });

  // Merge per-day product/channel breakdowns across the range.
  const products = new Map<string, ProductMetric>();
  const channels = new Map<string, ShopifyChannelMetric>();
  for (const r of rows) {
    for (const p of r.products ?? []) {
      const acc = products.get(p.title) ?? { title: p.title, quantity: 0, revenue: 0, orders: 0 };
      acc.quantity += p.quantity;
      acc.revenue = round2(acc.revenue + p.revenue);
      acc.orders += p.orders;
      products.set(p.title, acc);
    }
    for (const c of r.channels ?? []) {
      const acc =
        channels.get(c.channel) ??
        ({ channel: c.channel, ai: c.ai, orders: 0, revenue: 0, newCustomers: 0 } as ShopifyChannelMetric);
      acc.orders += c.orders;
      acc.revenue = round2(acc.revenue + c.revenue);
      acc.newCustomers += c.newCustomers;
      channels.set(c.channel, acc);
    }
  }

  return {
    daily,
    products: [...products.values()].sort((a, b) => b.revenue - a.revenue),
    channels: [...channels.values()].sort((a, b) => b.revenue - a.revenue),
  };
}
