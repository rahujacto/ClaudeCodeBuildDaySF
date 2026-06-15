import type { DateRange, MetaAccount, MetaAdsDailyMetric } from "./types";
import { adsTotals, type AdsTotals } from "./google-ads";

const GRAPH = "https://graph.facebook.com/v21.0";
const MAX_PAGES = 30;

/** Accept "act_123", "123", or with spaces/dashes → returns bare numeric id. */
export function normalizeAdAccountId(input: string): string {
  return input.trim().replace(/^act_/i, "").replace(/[^0-9]/g, "");
}

class MetaError extends Error {}

type MetaErrorBody = { error?: { message?: string; code?: number; type?: string } };

async function graphGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json()) as T & MetaErrorBody;
  if (!res.ok || json.error) {
    const msg = json.error?.message ?? `Meta API error (HTTP ${res.status}).`;
    throw new MetaError(msg);
  }
  return json;
}

// ── Save & Test ─────────────────────────────────────────────────────────────
export type MetaTestResult = {
  ok: boolean;
  message: string;
  accountName?: string;
  currency?: string;
};

export async function testMetaConnection(
  rawAccountId: string,
  token: string,
): Promise<MetaTestResult> {
  const id = normalizeAdAccountId(rawAccountId);
  if (!id) return { ok: false, message: "Enter a valid Ad Account ID." };
  try {
    const data = await graphGet<{ name: string; currency: string }>(
      `${GRAPH}/act_${id}?fields=name,currency&access_token=${encodeURIComponent(token)}`,
    );
    return {
      ok: true,
      message: `Connected to ${data.name} (${data.currency}).`,
      accountName: data.name,
      currency: data.currency,
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof MetaError
          ? err.message
          : "Couldn't reach Meta. Check the Ad Account ID and token (needs ads_read).",
    };
  }
}

// ── Insights → daily campaign metrics ───────────────────────────────────────
type MetaAction = { action_type: string; value: string };
type InsightRow = {
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
  date_start: string;
};
type InsightsResponse = { data: InsightRow[]; paging?: { next?: string } };

// Pick a single purchase value without double-counting overlapping action types.
const PURCHASE_PRIORITY = [
  "omni_purchase",
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_web_purchase",
];
function purchaseValue(actions?: MetaAction[]): number {
  if (!actions?.length) return 0;
  for (const type of PURCHASE_PRIORITY) {
    const hit = actions.find((a) => a.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  // fall back to any purchase-like type
  const any = actions.find((a) => a.action_type.includes("purchase"));
  return any ? Number(any.value) || 0 : 0;
}

export async function fetchMetaAdsDaily(
  rawAccountId: string,
  token: string,
  range: DateRange,
  accountLabel?: string,
): Promise<MetaAdsDailyMetric[]> {
  const id = normalizeAdAccountId(rawAccountId);
  const params = new URLSearchParams({
    level: "campaign",
    time_increment: "1",
    fields: "campaign_name,spend,impressions,clicks,actions,action_values",
    time_range: JSON.stringify({ since: range.start, until: range.end }),
    limit: "500",
    access_token: token,
  });

  const rows: MetaAdsDailyMetric[] = [];
  let url: string | undefined = `${GRAPH}/act_${id}/insights?${params.toString()}`;
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const data: InsightsResponse = await graphGet<InsightsResponse>(url);
    for (const row of data.data) {
      rows.push({
        source: "meta_ads",
        date: row.date_start,
        campaign: row.campaign_name ?? "(unnamed)",
        account: accountLabel ?? `act_${id}`,
        spend: Math.round((Number(row.spend) || 0) * 100) / 100,
        clicks: Number(row.clicks) || 0,
        impressions: Number(row.impressions) || 0,
        conversions: Math.round(purchaseValue(row.actions)),
        conversionValue: Math.round(purchaseValue(row.action_values) * 100) / 100,
      });
    }
    url = data.paging?.next;
  }
  return rows;
}

/** Fetch daily rows across multiple ad accounts (one shared token). */
export async function fetchMetaAdsForAccounts(
  accounts: MetaAccount[],
  token: string,
  range: DateRange,
): Promise<MetaAdsDailyMetric[]> {
  const perAccount = await Promise.all(
    accounts.map((a) =>
      fetchMetaAdsDaily(a.adAccountId, token, range, a.accountName || `act_${a.adAccountId}`),
    ),
  );
  return perAccount.flat();
}

export type MetaAccountTotals = AdsTotals & { account: string };

/** Aggregate rows into per-account totals (e.g. Instagram vs Facebook). */
export function metaByAccount(rows: MetaAdsDailyMetric[]): MetaAccountTotals[] {
  const byAcct = new Map<string, MetaAdsDailyMetric[]>();
  for (const r of rows) {
    const k = r.account ?? "(unknown)";
    const arr = byAcct.get(k) ?? [];
    arr.push(r);
    byAcct.set(k, arr);
  }
  return [...byAcct.entries()]
    .map(([account, rs]) => ({ account, ...adsTotals(rs) }))
    .sort((a, b) => b.spend - a.spend);
}
