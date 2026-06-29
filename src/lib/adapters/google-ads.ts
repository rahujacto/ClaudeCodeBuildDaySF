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
      const impressions = Math.round(c.impr * weekend * (0.82 + 0.36 * r()));
      const ctr = c.ctr * (0.85 + 0.3 * r());
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

// ── Targeting breakdowns (audience + geo) ───────────────────────────────────
export type AdsSegment = AdsTotals & { segment: string };

export type SegmentWeight = { label: string; spendW: number; roasMul: number };

/** Seeded audience age buckets — share of spend + relative ROAS. */
export const ADS_AUDIENCE_SEGMENTS: SegmentWeight[] = [
  { label: "25–34", spendW: 0.32, roasMul: 1.18 },
  { label: "35–44", spendW: 0.26, roasMul: 1.06 },
  { label: "45–54", spendW: 0.16, roasMul: 0.96 },
  { label: "18–24", spendW: 0.14, roasMul: 0.82 },
  { label: "55–64", spendW: 0.08, roasMul: 0.84 },
  { label: "65+", spendW: 0.04, roasMul: 0.7 },
];

/** Seeded geographic regions — US states for the cap & gown store. */
export const ADS_GEO_REGIONS: SegmentWeight[] = [
  { label: "California", spendW: 0.21, roasMul: 1.12 },
  { label: "Texas", spendW: 0.13, roasMul: 0.98 },
  { label: "New York", spendW: 0.12, roasMul: 1.08 },
  { label: "Florida", spendW: 0.1, roasMul: 0.92 },
  { label: "Illinois", spendW: 0.07, roasMul: 0.9 },
  { label: "Massachusetts", spendW: 0.06, roasMul: 1.2 },
  { label: "Pennsylvania", spendW: 0.06, roasMul: 0.9 },
  { label: "Other states", spendW: 0.25, roasMul: 0.86 },
];

/**
 * Split aggregate ad totals across fixed targeting segments with a per-segment
 * relative ROAS — deterministic, so seeded Google Ads renders a believable
 * audience/geo breakdown. `spendW` is each segment's share of spend; `roasMul`
 * scales its conversions + value so ROAS and CPA differ across segments.
 */
export function seededAdsSegments(rows: AdRow[], segs: SegmentWeight[]): AdsSegment[] {
  const t = adsTotals(rows);
  const wSum = segs.reduce((s, x) => s + x.spendW, 0) || 1;
  const vNorm = segs.reduce((s, x) => s + x.spendW * x.roasMul, 0) || 1;
  return segs
    .map((s) => {
      const w = s.spendW / wSum; // share of spend / clicks / impressions
      const vw = (s.spendW * s.roasMul) / vNorm; // share of conversions / value
      const row: AdRow = {
        campaign: s.label,
        spend: round2(t.spend * w),
        clicks: Math.round(t.clicks * w),
        impressions: Math.round(t.impressions * w),
        conversions: Math.round(t.conversions * vw),
        conversionValue: round2(t.conversionValue * vw),
      };
      return { segment: s.label, ...adsTotals([row]) };
    })
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
