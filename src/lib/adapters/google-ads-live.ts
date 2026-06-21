import { decryptSecret } from "@/lib/crypto";
import type { ConnectionRow } from "@/lib/connections";
import type { DateRange, GoogleAdsDailyMetric } from "./types";
import { seededGoogleAdsDaily } from "./google-ads";

// Pin the Google Ads REST API version. Bump in one place when Google retires it.
const API_VERSION = "v18";

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

type SearchRow = {
  segments?: { date?: string };
  campaign?: { name?: string };
  metrics?: {
    costMicros?: string | number;
    clicks?: string | number;
    impressions?: string | number;
    conversions?: string | number;
    conversionsValue?: string | number;
  };
};

/**
 * Live Google Ads pull via the REST searchStream endpoint. Throws on any API
 * error (surfacing Google's literal message, minus secrets) so callers can
 * decide whether to fall back to seeded data.
 */
export async function fetchGoogleAdsLive(
  creds: GoogleAdsLiveCreds,
  range: DateRange,
): Promise<GoogleAdsDailyMetric[]> {
  const accessToken = await accessTokenFromRefresh(creds.clientId, creds.clientSecret, creds.refreshToken);
  const customer = onlyDigits(creds.customerId);
  const login = onlyDigits(creds.loginCustomerId ?? "");

  const query =
    "SELECT segments.date, campaign.name, metrics.cost_micros, metrics.clicks, " +
    "metrics.impressions, metrics.conversions, metrics.conversions_value " +
    `FROM campaign WHERE segments.date BETWEEN '${range.start}' AND '${range.end}'`;

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
  const batches = JSON.parse(text) as Array<{ results?: SearchRow[] }>;
  const rows: GoogleAdsDailyMetric[] = [];
  for (const batch of batches) {
    for (const r of batch.results ?? []) {
      rows.push({
        source: "google_ads",
        date: r.segments?.date ?? range.start,
        campaign: r.campaign?.name ?? "(unknown)",
        spend: Number(r.metrics?.costMicros ?? 0) / 1_000_000,
        clicks: Number(r.metrics?.clicks ?? 0),
        impressions: Number(r.metrics?.impressions ?? 0),
        conversions: Number(r.metrics?.conversions ?? 0),
        conversionValue: Number(r.metrics?.conversionsValue ?? 0),
      });
    }
  }
  return rows;
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
