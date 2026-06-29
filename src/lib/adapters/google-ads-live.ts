import { decryptSecret } from "@/lib/crypto";
import type { ConnectionRow } from "@/lib/connections";
import type { DateRange, GoogleAdsDailyMetric } from "./types";
import {
  seededGoogleAdsDaily,
  seededAdsSegments,
  adsTotals,
  ADS_AUDIENCE_SEGMENTS,
  ADS_GEO_REGIONS,
  type AdRow,
  type AdsSegment,
} from "./google-ads";

// Pin the Google Ads REST API version. Bump in one place when Google retires it.
const API_VERSION = "v21";

export type GoogleAdsLiveCreds = {
  customerId: string;
  loginCustomerId?: string; // the MCC the customer is linked under
  clientId: string;
  clientSecret: string;
  developerToken: string;
  refreshToken: string;
};

/** Stored secret blob shape (encrypted at rest, decrypted server-side only). */
type GoogleAdsSecret = {
  developerToken?: string;
  clientSecret?: string;
  refreshToken?: string;
};

const onlyDigits = (s: string) => s.replace(/\D/g, "");

/** Exchange a long-lived refresh token for a short-lived access token. */
async function accessTokenFromRefresh(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "OAuth token refresh failed");
  }
  return json.access_token;
}

type GoogleMetrics = {
  costMicros?: string | number;
  clicks?: string | number;
  impressions?: string | number;
  conversions?: string | number;
  conversionsValue?: string | number;
};

type SearchRow = {
  segments?: { date?: string };
  campaign?: { name?: string };
  metrics?: GoogleMetrics;
};

/**
 * Run a read-only GAQL query against the REST searchStream endpoint and return
 * the flattened result rows. Throws on any API error (surfacing Google's literal
 * message, minus secrets) so callers can decide whether to fall back to seeded
 * data. Accepts a pre-fetched access token so several breakdown queries in one
 * dashboard load share a single OAuth exchange.
 */
async function runSearchStream<T>(
  creds: GoogleAdsLiveCreds,
  accessToken: string,
  query: string,
): Promise<T[]> {
  const customer = onlyDigits(creds.customerId);
  const login = onlyDigits(creds.loginCustomerId ?? "");

  const res = await fetch(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${customer}/googleAds:searchStream`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": creds.developerToken,
        ...(login ? { "login-customer-id": login } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );

  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j?.error?.message || j?.[0]?.error?.message || text;
    } catch {
      /* keep raw text */
    }
    throw new Error(`Google Ads API ${res.status}: ${msg}`);
  }

  // searchStream returns an array of batches, each with a results[] array.
  const batches = JSON.parse(text) as Array<{ results?: T[] }>;
  return batches.flatMap((b) => b.results ?? []);
}

const adRowFromMetrics = (segment: string, m?: GoogleMetrics): AdRow => ({
  campaign: segment,
  spend: Number(m?.costMicros ?? 0) / 1_000_000,
  clicks: Number(m?.clicks ?? 0),
  impressions: Number(m?.impressions ?? 0),
  conversions: Number(m?.conversions ?? 0),
  conversionValue: Number(m?.conversionsValue ?? 0),
});

/** Group labelled metric rows into per-segment totals, sorted by spend. */
function aggregateSegments(items: { key: string; m?: GoogleMetrics }[]): AdsSegment[] {
  const by = new Map<string, AdRow[]>();
  for (const it of items) {
    const arr = by.get(it.key) ?? [];
    arr.push(adRowFromMetrics(it.key, it.m));
    by.set(it.key, arr);
  }
  return [...by.entries()]
    .map(([segment, rs]) => ({ segment, ...adsTotals(rs) }))
    .sort((a, b) => b.spend - a.spend);
}

/**
 * Live Google Ads pull via the REST searchStream endpoint. Throws on any API
 * error so callers can decide whether to fall back to seeded data.
 */
export async function fetchGoogleAdsLive(
  creds: GoogleAdsLiveCreds,
  range: DateRange,
): Promise<GoogleAdsDailyMetric[]> {
  const accessToken = await accessTokenFromRefresh(creds.clientId, creds.clientSecret, creds.refreshToken);
  const query =
    "SELECT segments.date, campaign.name, metrics.cost_micros, metrics.clicks, " +
    "metrics.impressions, metrics.conversions, metrics.conversions_value " +
    `FROM campaign WHERE segments.date BETWEEN '${range.start}' AND '${range.end}'`;

  const results = await runSearchStream<SearchRow>(creds, accessToken, query);
  return results.map((r) => ({
    source: "google_ads",
    date: r.segments?.date ?? range.start,
    campaign: r.campaign?.name ?? "(unknown)",
    spend: Number(r.metrics?.costMicros ?? 0) / 1_000_000,
    clicks: Number(r.metrics?.clicks ?? 0),
    impressions: Number(r.metrics?.impressions ?? 0),
    conversions: Number(r.metrics?.conversions ?? 0),
    conversionValue: Number(r.metrics?.conversionsValue ?? 0),
  }));
}

// ── Targeting breakdowns (audience by age, geo by region) ───────────────────
const AGE_RANGE_LABEL: Record<string, string> = {
  AGE_RANGE_18_24: "18–24",
  AGE_RANGE_25_34: "25–34",
  AGE_RANGE_35_44: "35–44",
  AGE_RANGE_45_54: "45–54",
  AGE_RANGE_55_64: "55–64",
  AGE_RANGE_65_UP: "65+",
  AGE_RANGE_UNDETERMINED: "Undetermined",
};

type AgeRow = { adGroupCriterion?: { ageRange?: { type?: string } }; metrics?: GoogleMetrics };

/** Audience breakdown by age range (age_range_view). */
async function fetchGoogleAdsAge(
  creds: GoogleAdsLiveCreds,
  accessToken: string,
  range: DateRange,
): Promise<AdsSegment[]> {
  const query =
    "SELECT ad_group_criterion.age_range.type, metrics.cost_micros, metrics.clicks, " +
    "metrics.impressions, metrics.conversions, metrics.conversions_value " +
    `FROM age_range_view WHERE segments.date BETWEEN '${range.start}' AND '${range.end}'`;
  const rows = await runSearchStream<AgeRow>(creds, accessToken, query);
  return aggregateSegments(
    rows.map((r) => ({
      key: AGE_RANGE_LABEL[r.adGroupCriterion?.ageRange?.type ?? ""] ?? "Undetermined",
      m: r.metrics,
    })),
  );
}

type GeoRow = { segments?: { geoTargetRegion?: string }; metrics?: GoogleMetrics };
type GeoConstantRow = { geoTargetConstant?: { id?: string | number; name?: string } };

/**
 * Geo breakdown by region (geographic_view, physical location of the user).
 * The region segment comes back as a `geoTargetConstants/{id}` resource name, so
 * a second query resolves those ids to human-readable region names.
 */
async function fetchGoogleAdsGeo(
  creds: GoogleAdsLiveCreds,
  accessToken: string,
  range: DateRange,
): Promise<AdsSegment[]> {
  const query =
    "SELECT segments.geo_target_region, metrics.cost_micros, metrics.clicks, " +
    "metrics.impressions, metrics.conversions, metrics.conversions_value " +
    `FROM geographic_view WHERE segments.date BETWEEN '${range.start}' AND '${range.end}' ` +
    "AND geographic_view.location_type = 'LOCATION_OF_PRESENCE'";
  const rows = await runSearchStream<GeoRow>(creds, accessToken, query);

  const ids = [
    ...new Set(
      rows
        .map((r) => r.segments?.geoTargetRegion)
        .filter((rn): rn is string => !!rn)
        .map((rn) => rn.split("/")[1]),
    ),
  ];
  const names = await resolveGeoNames(creds, accessToken, ids);

  return aggregateSegments(
    rows.map((r) => {
      const id = r.segments?.geoTargetRegion?.split("/")[1] ?? "";
      return { key: names.get(id) ?? "Unknown region", m: r.metrics };
    }),
  );
}

/** Resolve geo target constant ids → region names (geo_target_constant). */
async function resolveGeoNames(
  creds: GoogleAdsLiveCreds,
  accessToken: string,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const query =
    "SELECT geo_target_constant.id, geo_target_constant.name " +
    `FROM geo_target_constant WHERE geo_target_constant.id IN (${ids.join(",")})`;
  const rows = await runSearchStream<GeoConstantRow>(creds, accessToken, query);
  for (const r of rows) {
    const id = String(r.geoTargetConstant?.id ?? "");
    if (id) map.set(id, r.geoTargetConstant?.name ?? id);
  }
  return map;
}

/** Pull the live creds out of a connection row, falling back to env OAuth client. */
export function liveCredsFromRow(row: ConnectionRow | null): GoogleAdsLiveCreds | null {
  if (!row?.secret_ref) return null;
  let secret: GoogleAdsSecret;
  try {
    secret = JSON.parse(decryptSecret(row.secret_ref)) as GoogleAdsSecret;
  } catch {
    return null;
  }
  const cfg = (row.config ?? {}) as { customerId?: string; clientId?: string; loginCustomerId?: string };
  const clientId = cfg.clientId || process.env.GOOGLE_OAUTH_CLIENT_ID || "";
  const clientSecret = secret.clientSecret || process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
  if (!cfg.customerId || !clientId || !clientSecret || !secret.developerToken || !secret.refreshToken) {
    return null;
  }
  return {
    customerId: cfg.customerId,
    loginCustomerId: cfg.loginCustomerId,
    clientId,
    clientSecret,
    developerToken: secret.developerToken,
    refreshToken: secret.refreshToken,
  };
}

/**
 * Resolve Google Ads daily rows for the dashboard/chat. Uses the live API when
 * the connection is `connected` and fully credentialed; otherwise (or on any
 * live error) returns deterministic seeded data so the product still renders.
 */
export async function loadGoogleAdsDaily(
  orgId: string,
  row: ConnectionRow | null,
  range: DateRange,
): Promise<{ rows: GoogleAdsDailyMetric[]; live: boolean }> {
  if (row?.status === "connected") {
    const creds = liveCredsFromRow(row);
    if (creds) {
      try {
        return { rows: await fetchGoogleAdsLive(creds, range), live: true };
      } catch {
        // Token expired / access revoked / version retired — degrade to seeded.
      }
    }
  }
  return { rows: seededGoogleAdsDaily(orgId, range), live: false };
}

/**
 * Resolve Google Ads targeting breakdowns (audience by age, geo by region) for
 * the dashboard. Live via the API when the connection is `connected` and fully
 * credentialed; otherwise (or on any live error) falls back to a deterministic
 * seeded split so the panel still renders.
 */
export async function loadGoogleAdsTargeting(
  orgId: string,
  row: ConnectionRow | null,
  range: DateRange,
): Promise<{ audience: AdsSegment[]; geo: AdsSegment[]; live: boolean }> {
  if (row?.status === "connected") {
    const creds = liveCredsFromRow(row);
    if (creds) {
      try {
        const accessToken = await accessTokenFromRefresh(
          creds.clientId,
          creds.clientSecret,
          creds.refreshToken,
        );
        const [audience, geo] = await Promise.all([
          fetchGoogleAdsAge(creds, accessToken, range),
          fetchGoogleAdsGeo(creds, accessToken, range),
        ]);
        return { audience, geo, live: true };
      } catch {
        // Token expired / access revoked / view unavailable — degrade to seeded.
      }
    }
  }
  const rows = seededGoogleAdsDaily(orgId, range);
  return {
    audience: seededAdsSegments(rows, ADS_AUDIENCE_SEGMENTS),
    geo: seededAdsSegments(rows, ADS_GEO_REGIONS),
    live: false,
  };
}
