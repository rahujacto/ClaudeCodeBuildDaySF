import type { DateRange, MetaAccount, MetaAdsDailyMetric } from "./types";
import { adsTotals, type AdsTotals, type AdRow, type AdsSegment } from "./google-ads";

const GRAPH = "https://graph.facebook.com/v21.0";
const MAX_PAGES = 30;

/** Accept "act_123", "123", or with spaces/dashes → returns bare numeric id. */
export function normalizeAdAccountId(input: string): string {
  return input.trim().replace(/^act_/i, "").replace(/[^0-9]/g, "");
}

class MetaError extends Error {}

type MetaErrorBody = {
  error?: { message?: string; code?: number; type?: string; error_subcode?: number };
};

/** Thrown when the stored token is expired/invalid — surfaces a reconnect hint. */
export class MetaTokenExpiredError extends MetaError {}

async function graphGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json()) as T & MetaErrorBody;
  if (!res.ok || json.error) {
    const e = json.error;
    const expired =
      e?.code === 190 ||
      e?.type === "OAuthException" ||
      /access token|session has expired|expired/i.test(e?.message ?? "");
    if (expired) {
      throw new MetaTokenExpiredError(
        "Meta Ads access token has expired — reconnect it on the Connections page (Meta Ads → Edit).",
      );
    }
    throw new MetaError(e?.message ?? `Meta API error (HTTP ${res.status}).`);
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

// ── Reach & frequency (unique people) ───────────────────────────────────────
// Reach is unique people, so it CANNOT be summed across days — we query it at
// the account level over the whole range to get a true unique count. Frequency
// is Meta's avg impressions-per-person for that account/range.
export type MetaReach = { account: string; reach: number; frequency: number; impressions: number };

type ReachRow = { reach?: string; frequency?: string; impressions?: string };

export async function fetchMetaReachForAccounts(
  accounts: MetaAccount[],
  token: string,
  range: DateRange,
): Promise<MetaReach[]> {
  return Promise.all(
    accounts.map(async (a) => {
      const id = normalizeAdAccountId(a.adAccountId);
      const params = new URLSearchParams({
        level: "account",
        fields: "reach,frequency,impressions",
        time_range: JSON.stringify({ since: range.start, until: range.end }),
        access_token: token,
      });
      const data = await graphGet<{ data: ReachRow[] }>(
        `${GRAPH}/act_${id}/insights?${params.toString()}`,
      );
      const row = data.data?.[0] ?? {};
      return {
        account: a.accountName || `act_${id}`,
        reach: Number(row.reach) || 0,
        frequency: Number(row.frequency) || 0,
        impressions: Number(row.impressions) || 0,
      };
    }),
  );
}

/** Combine per-account reach. Frequency = total impressions ÷ combined reach. */
export function combineReach(rows: MetaReach[]): { reach: number; frequency: number } {
  const reach = rows.reduce((s, r) => s + r.reach, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  return { reach, frequency: reach ? Math.round((impressions / reach) * 100) / 100 : 0 };
}

// ── Targeting breakdowns (audience + geo) ───────────────────────────────────
// Meta's insights endpoint segments the same spend/conversion fields by a
// `breakdowns` dimension (age,gender / region). We query at account level over
// the whole range and aggregate matching segments across all ad accounts.
type BreakdownRow = InsightRow & {
  age?: string;
  gender?: string;
  region?: string;
  country?: string;
};

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

async function fetchMetaBreakdown(
  accounts: MetaAccount[],
  token: string,
  range: DateRange,
  breakdowns: string,
  label: (r: BreakdownRow) => string,
): Promise<AdsSegment[]> {
  const bySegment = new Map<string, AdRow[]>();
  await Promise.all(
    accounts.map(async (a) => {
      const id = normalizeAdAccountId(a.adAccountId);
      const params = new URLSearchParams({
        level: "account",
        breakdowns,
        fields: "spend,impressions,clicks,actions,action_values",
        time_range: JSON.stringify({ since: range.start, until: range.end }),
        limit: "500",
        access_token: token,
      });
      let url: string | undefined = `${GRAPH}/act_${id}/insights?${params.toString()}`;
      for (let page = 0; page < MAX_PAGES && url; page++) {
        const data: InsightsResponse = await graphGet<InsightsResponse>(url);
        for (const row of data.data as BreakdownRow[]) {
          const key = label(row).trim() || "(unknown)";
          const arr = bySegment.get(key) ?? [];
          arr.push({
            campaign: key,
            spend: Math.round((Number(row.spend) || 0) * 100) / 100,
            clicks: Number(row.clicks) || 0,
            impressions: Number(row.impressions) || 0,
            conversions: Math.round(purchaseValue(row.actions)),
            conversionValue: Math.round(purchaseValue(row.action_values) * 100) / 100,
          });
          bySegment.set(key, arr);
        }
        url = data.paging?.next;
      }
    }),
  );
  return [...bySegment.entries()]
    .map(([segment, rows]) => ({ segment, ...adsTotals(rows) }))
    .sort((a, b) => b.spend - a.spend);
}

/** Audience breakdown by age + gender (spend/ROAS per segment). */
export function fetchMetaAudience(
  accounts: MetaAccount[],
  token: string,
  range: DateRange,
): Promise<AdsSegment[]> {
  return fetchMetaBreakdown(accounts, token, range, "age,gender", (r) =>
    [r.age, r.gender && r.gender !== "unknown" ? titleCase(r.gender) : null]
      .filter(Boolean)
      .join(" · "),
  );
}

/** Geographic breakdown by region (US states). */
export function fetchMetaGeo(
  accounts: MetaAccount[],
  token: string,
  range: DateRange,
): Promise<AdsSegment[]> {
  return fetchMetaBreakdown(accounts, token, range, "region", (r) => r.region ?? "");
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
