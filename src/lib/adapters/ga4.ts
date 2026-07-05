import type { DateRange, Ga4DailyMetric } from "./types";
import { schoolFromPath, type SchoolTraffic } from "@/lib/schools";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const DATA = "https://analyticsdata.googleapis.com/v1beta";

export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export class Ga4Error extends Error {}

export function googleClientCreds() {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) throw new Ga4Error("Google OAuth client is not configured.");
  return { id, secret };
}

/** Exchange an authorization code for tokens (incl. refresh_token). */
export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const { id, secret } = googleClientCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Ga4Error(`Token exchange failed (${res.status}).`);
  return (await res.json()) as { access_token: string; refresh_token?: string };
}

// Google access tokens live ~60 min; cache per refresh token so one dashboard
// load (4 GA4 report calls) does a single OAuth exchange instead of four.
// Concurrent callers share the in-flight promise.
const TOKEN_TTL_MS = 10 * 60_000;
const tokenCache = new Map<string, { token: Promise<string>; expires: number }>();

/** Get an access token from a stored refresh token (cached ~10 min). */
export function getAccessToken(refreshToken: string): Promise<string> {
  const hit = tokenCache.get(refreshToken);
  if (hit && Date.now() < hit.expires) return hit.token;
  const token = requestAccessToken(refreshToken);
  tokenCache.set(refreshToken, { token, expires: Date.now() + TOKEN_TTL_MS });
  token.catch(() => {
    if (tokenCache.get(refreshToken)?.token === token) tokenCache.delete(refreshToken);
  });
  return token;
}

async function requestAccessToken(refreshToken: string): Promise<string> {
  const { id, secret } = googleClientCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!res.ok)
    throw new Ga4Error("Couldn't refresh the Google token — please reconnect GA4.");
  const j = (await res.json()) as { access_token: string };
  return j.access_token;
}

async function adminGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${ADMIN}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detail = j?.error?.message ?? "";
    } catch {
      // non-JSON error body
    }
    throw new Ga4Error(detail || `Analytics Admin API error (${res.status}).`);
  }
  return (await res.json()) as T;
}

export type Ga4Property = {
  propertyId: string;
  displayName: string;
  urls: string[];
};

/** List all GA4 properties the account can access, with their web-stream URLs. */
export async function listProperties(token: string): Promise<Ga4Property[]> {
  const sum = await adminGet<{
    accountSummaries?: {
      propertySummaries?: { property: string; displayName: string }[];
    }[];
  }>("accountSummaries?pageSize=200", token);

  const base: { propertyId: string; displayName: string }[] = [];
  for (const acc of sum.accountSummaries ?? [])
    for (const p of acc.propertySummaries ?? [])
      base.push({ propertyId: p.property.split("/")[1], displayName: p.displayName });

  const out: Ga4Property[] = [];
  for (const p of base.slice(0, 25)) {
    let urls: string[] = [];
    try {
      const ds = await adminGet<{
        dataStreams?: { webStreamData?: { defaultUri?: string } }[];
      }>(`properties/${p.propertyId}/dataStreams`, token);
      urls = (ds.dataStreams ?? [])
        .map((s) => s.webStreamData?.defaultUri)
        .filter((u): u is string => !!u);
    } catch {
      // stream listing may fail for some property types; skip URLs
    }
    out.push({ ...p, urls });
  }
  return out;
}

export function hostOf(u: string): string {
  try {
    return new URL(u.startsWith("http") ? u : `https://${u}`).host
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

function hostsRelated(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Pick the property whose web stream matches one of the store's hosts —
 * exact, or a subdomain relationship (shop.capgown.com ↔ capgown.com).
 */
export function matchProperty(
  props: Ga4Property[],
  storeHosts: string[],
): Ga4Property | null {
  const targets = storeHosts
    .map((h) => h.replace(/^www\./, "").toLowerCase())
    .filter(Boolean);
  for (const p of props)
    for (const u of p.urls) {
      const h = hostOf(u);
      if (targets.some((t) => hostsRelated(h, t))) return p;
    }
  return null;
}

// ── Data API ────────────────────────────────────────────────────────────────
type RunReportBody = Record<string, unknown>;
type ReportResponse = {
  rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
};

export async function runReport(
  token: string,
  propertyId: string,
  body: RunReportBody,
): Promise<ReportResponse> {
  const res = await fetch(`${DATA}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detail = j?.error?.message ?? "";
    } catch {
      // non-JSON error body
    }
    if (res.status === 404) throw new Ga4Error("GA4 property not found.");
    if (res.status === 401 || res.status === 403)
      throw new Ga4Error(
        detail || "GA4 denied access to this property for your account.",
      );
    throw new Ga4Error(detail || `GA4 Data API error (${res.status}).`);
  }
  return (await res.json()) as ReportResponse;
}

export type Ga4Channel = { channel: string; sessions: number; users: number };
export type Ga4Data = { daily: Ga4DailyMetric[]; channels: Ga4Channel[] };

// "activeUsers" is GA4's headline "Users" metric in the UI; "totalUsers" reads
// higher and is what the client saw as a mismatch.
const DAILY_METRICS = ["sessions", "activeUsers", "newUsers"] as const;

export async function fetchGa4Data(
  refreshToken: string,
  propertyId: string,
  range: DateRange,
): Promise<Ga4Data> {
  const token = await getAccessToken(refreshToken);

  const daysReport = await runReport(token, propertyId, {
    dateRanges: [{ startDate: range.start, endDate: range.end }],
    dimensions: [{ name: "date" }],
    metrics: DAILY_METRICS.map((name) => ({ name })),
    orderBys: [{ dimension: { dimensionName: "date" } }],
    limit: 100000,
  });

  const daily: Ga4DailyMetric[] = (daysReport.rows ?? []).map((row) => {
    const d = row.dimensionValues[0].value; // YYYYMMDD
    const m = row.metricValues.map((v) => Number(v.value) || 0);
    return {
      source: "ga4",
      date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      sessions: m[0],
      users: m[1],
      newUsers: m[2],
      conversions: 0,
      channel: "",
    };
  });

  let channels: Ga4Channel[] = [];
  try {
    const ch = await runReport(token, propertyId, {
      dateRanges: [{ startDate: range.start, endDate: range.end }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 25,
    });
    channels = (ch.rows ?? []).map((row) => ({
      channel: row.dimensionValues[0].value,
      sessions: Number(row.metricValues[0].value) || 0,
      users: Number(row.metricValues[1].value) || 0,
    }));
  } catch {
    // channel breakdown is optional
  }

  return { daily, channels };
}

export type Ga4Region = { region: string; sessions: number; users: number };

/**
 * Top locations by sessions, using GA4's `region` dimension (US states, plus
 * international regions/provinces). Drops "(not set)" rows and returns the top 10.
 */
export async function fetchGa4Regions(
  refreshToken: string,
  propertyId: string,
  range: DateRange,
): Promise<Ga4Region[]> {
  const token = await getAccessToken(refreshToken);
  const r = await runReport(token, propertyId, {
    dateRanges: [{ startDate: range.start, endDate: range.end }],
    dimensions: [{ name: "region" }],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 15,
  });
  return (r.rows ?? [])
    .map((row) => ({
      region: row.dimensionValues[0].value,
      sessions: Number(row.metricValues[0].value) || 0,
      users: Number(row.metricValues[1].value) || 0,
    }))
    .filter((x) => x.region && x.region !== "(not set)")
    .slice(0, 10);
}

/** Product-page traffic (pageviews + sessions) aggregated by school. */
export async function fetchGa4SchoolTraffic(
  refreshToken: string,
  propertyId: string,
  range: DateRange,
): Promise<SchoolTraffic[]> {
  const token = await getAccessToken(refreshToken);
  const r = await runReport(token, propertyId, {
    dateRanges: [{ startDate: range.start, endDate: range.end }],
    dimensions: [{ name: "pagePath" }],
    metrics: [{ name: "screenPageViews" }, { name: "sessions" }],
    dimensionFilter: {
      filter: {
        fieldName: "pagePath",
        stringFilter: { matchType: "CONTAINS", value: "/products/" },
      },
    },
    limit: 2000,
  });
  const agg = new Map<string, SchoolTraffic>();
  for (const row of r.rows ?? []) {
    const s = schoolFromPath(row.dimensionValues[0].value);
    if (!s) continue;
    const cur = agg.get(s.key) ?? { key: s.key, label: s.label, pageviews: 0, sessions: 0 };
    cur.pageviews += Number(row.metricValues[0].value) || 0;
    cur.sessions += Number(row.metricValues[1].value) || 0;
    agg.set(s.key, cur);
  }
  return [...agg.values()];
}

/** Save & Test: pull last 7 days of sessions to verify the property works. */
export async function testGa4(refreshToken: string, propertyId: string) {
  const token = await getAccessToken(refreshToken);
  const r = await runReport(token, propertyId, {
    dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }],
  });
  const row = r.rows?.[0];
  return {
    ok: true,
    sessions: Number(row?.metricValues?.[0]?.value ?? 0),
    users: Number(row?.metricValues?.[1]?.value ?? 0),
  };
}
