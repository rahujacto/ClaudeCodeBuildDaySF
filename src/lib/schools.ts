// Shared school parsing + aggregation, used by both the chat tool and the
// dashboard so Shopify revenue and GA4 product-page traffic join on the same key.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Parse the school from a Shopify product title ("… for UCLA"). */
export function schoolFromTitle(title: string): { key: string; label: string } | null {
  const m = title.match(/ for (.+)$/i);
  if (!m) return null;
  const label = m[1].trim().replace(/[.,]+$/, "");
  return label ? { key: norm(label), label } : null;
}

/** Parse the school from a GA4 product page path ("/products/…-for-ucla"). */
export function schoolFromPath(path: string): { key: string; label: string } | null {
  const slug = (path.split("/products/")[1] || "").split(/[/?#]/)[0];
  const m = slug.match(/(?:^|-)for-(.+)$/);
  if (!m) return null;
  const label = m[1].replace(/-/g, " ").trim();
  return label ? { key: norm(label), label } : null;
}

export type SchoolRow = {
  key: string;
  school: string;
  revenue: number;
  units: number;
  pageviews: number;
  sessions: number;
  revenuePerView: number | null;
};

export type SchoolTraffic = {
  key: string;
  label: string;
  pageviews: number;
  sessions: number;
};

/** Join Shopify product revenue with GA4 product-page traffic, by school. */
export function bySchool(
  products: { title: string; revenue: number; quantity: number }[],
  traffic: SchoolTraffic[],
): SchoolRow[] {
  const rev = new Map<string, number>();
  const units = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const p of products) {
    const s = schoolFromTitle(p.title);
    if (!s) continue;
    labels.set(s.key, s.label);
    rev.set(s.key, (rev.get(s.key) ?? 0) + p.revenue);
    units.set(s.key, (units.get(s.key) ?? 0) + p.quantity);
  }
  const pv = new Map<string, number>();
  const ss = new Map<string, number>();
  for (const t of traffic) {
    if (!labels.has(t.key)) labels.set(t.key, t.label);
    pv.set(t.key, (pv.get(t.key) ?? 0) + t.pageviews);
    ss.set(t.key, (ss.get(t.key) ?? 0) + t.sessions);
  }
  const keys = new Set([...rev.keys(), ...pv.keys()]);
  return [...keys]
    .map((k) => {
      const revenue = Math.round((rev.get(k) ?? 0) * 100) / 100;
      const pageviews = pv.get(k) ?? 0;
      return {
        key: k,
        school: labels.get(k) ?? k,
        revenue,
        units: units.get(k) ?? 0,
        pageviews,
        sessions: ss.get(k) ?? 0,
        revenuePerView: pageviews ? Math.round((revenue / pageviews) * 100) / 100 : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}
