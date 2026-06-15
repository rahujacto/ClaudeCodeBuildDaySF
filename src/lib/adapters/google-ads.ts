import type { DateRange, GoogleAdsDailyMetric } from "./types";

/**
 * Google Ads is SEEDED today (live pulls require Google Ads API Basic Access,
 * which takes separate approval — see README §2). We generate ~deterministic
 * daily campaign data so the dashboard + chat render real ROAS/CPA/CTR, with a
 * deliberate CPA-spike anomaly in the last 7 days for the proactive insight.
 */

const CAMPAIGNS = [
  { name: "Brand — Cap & Gown", impr: 1700, ctr: 0.11, cpc: 0.6, cvr: 0.14, aov: 240 },
  { name: "Shopping — All Regalia", impr: 9000, ctr: 0.025, cpc: 0.85, cvr: 0.05, aov: 260 },
  { name: "Doctoral Regalia — Generic", impr: 5200, ctr: 0.04, cpc: 1.35, cvr: 0.045, aov: 300 },
  { name: "UCLA Regalia — Exact", impr: 2200, ctr: 0.07, cpc: 1.05, cvr: 0.09, aov: 280 },
  { name: "Retargeting — Cart Abandon", impr: 1200, ctr: 0.09, cpc: 0.5, cvr: 0.18, aov: 230 },
];

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function eachDay(range: DateRange): string[] {
  const out: string[] = [];
  const d = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
function daysFromToday(date: string): number {
  const today = new Date().toISOString().slice(0, 10);
  return (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000;
}

export function seededGoogleAdsDaily(seed: string, range: DateRange): GoogleAdsDailyMetric[] {
  const rows: GoogleAdsDailyMetric[] = [];
  for (const date of eachDay(range)) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6 ? 0.72 : 1;
    const recent = daysFromToday(date) < 7; // anomaly window
    for (const c of CAMPAIGNS) {
      const r = mulberry32(hashStr(`${seed}|${date}|${c.name}`));
      let impressions = Math.round(c.impr * weekend * (0.82 + 0.36 * r()));
      let ctr = c.ctr * (0.85 + 0.3 * r());
      let cpc = c.cpc * (0.9 + 0.2 * r());
      let cvr = c.cvr * (0.85 + 0.3 * r());
      const aov = c.aov * (0.9 + 0.2 * r());

      // Deliberate anomaly: generic doctoral campaign's CPC spikes recently
      // while conversion rate drops → CPA spike, ROAS collapse.
      if (recent && c.name.startsWith("Doctoral")) {
        cpc *= 2.2;
        cvr *= 0.55;
      }

      const clicks = Math.max(0, Math.round(impressions * ctr));
      const spend = Math.round(clicks * cpc * 100) / 100;
      const conversions = Math.round(clicks * cvr);
      const conversionValue = Math.round(conversions * aov * 100) / 100;
      rows.push({
        source: "google_ads",
        date,
        campaign: c.name,
        spend,
        clicks,
        impressions,
        conversions,
        conversionValue,
      });
    }
  }
  return rows;
}

// ── aggregation (shared by Google Ads + Meta Ads) ───────────────────────────
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Structural row both ad sources satisfy. */
export type AdRow = {
  campaign: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conversionValue: number;
};

export type AdsTotals = {
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conversionValue: number;
  ctr: number; // %
  cpc: number;
  cpa: number;
  roas: number;
};

export function adsTotals(rows: AdRow[]): AdsTotals {
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const conversions = rows.reduce((s, r) => s + r.conversions, 0);
  const conversionValue = rows.reduce((s, r) => s + r.conversionValue, 0);
  return {
    spend: round2(spend),
    clicks,
    impressions,
    conversions,
    conversionValue: round2(conversionValue),
    ctr: impressions ? round2((clicks / impressions) * 100) : 0,
    cpc: clicks ? round2(spend / clicks) : 0,
    cpa: conversions ? round2(spend / conversions) : 0,
    roas: spend ? round2(conversionValue / spend) : 0,
  };
}

export type AdsCampaign = AdsTotals & { campaign: string };

export function adsByCampaign(rows: AdRow[]): AdsCampaign[] {
  const byName = new Map<string, AdRow[]>();
  for (const r of rows) {
    const arr = byName.get(r.campaign) ?? [];
    arr.push(r);
    byName.set(r.campaign, arr);
  }
  return [...byName.entries()]
    .map(([campaign, rs]) => ({ campaign, ...adsTotals(rs) }))
    .sort((a, b) => b.spend - a.spend);
}

/** Named metric accessor for the chat tools. */
export function adsMetric(rows: AdRow[], metric: string): number {
  const t = adsTotals(rows);
  const m = metric.toLowerCase().replace(/[\s_]/g, "");
  switch (m) {
    case "clicks": return t.clicks;
    case "impressions": return t.impressions;
    case "conversions": return t.conversions;
    case "conversionvalue": return t.conversionValue;
    case "ctr": return t.ctr;
    case "cpc": return t.cpc;
    case "cpa": return t.cpa;
    case "roas": return t.roas;
    case "spend":
    default: return t.spend;
  }
}
