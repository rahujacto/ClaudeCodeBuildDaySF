// Release notes — append a new entry at the TOP for every release.
export type ChangeKind = "new" | "improved" | "fixed";
export type Release = {
  version: string;
  date: string; // YYYY-MM-DD
  title: string;
  items: { kind: ChangeKind; text: string }[];
};

export const RELEASES: Release[] = [
  {
    version: "1.8",
    date: "2026-07-05",
    title: "Faster dashboard",
    items: [
      { kind: "improved", text: "The dashboard now loads all data sources in parallel instead of one after another — total load time is set by your slowest source, not the sum of all of them." },
      { kind: "improved", text: "Fewer round-trips per load: one batched connection lookup, shared Google sign-in tokens across GA4 and Google Ads calls, and Mailchimp queries run side by side." },
      { kind: "fixed", text: "Meta targeting breakdowns no longer hold up the core spend and ROAS metrics — they load alongside them." },
    ],
  },
  {
    version: "1.7",
    date: "2026-07-02",
    title: "Fast, always-fresh Shopify metrics",
    items: [
      { kind: "improved", text: "Shopify metrics are now served from a day-granular cache — any range, including full-year views, loads instantly with zero risk of Shopify rate limits." },
      { kind: "improved", text: "A background sync (every few minutes) backfills 24 months of history and re-syncs days whose orders changed, so refunds and edits to old orders stay reconciled with Shopify." },
      { kind: "improved", text: "Revenue verified against Shopify Analytics “Total sales” on live data — matches within 0.3%." },
    ],
  },
  {
    version: "1.6",
    date: "2026-06-29",
    title: "Ad targeting breakdowns",
    items: [
      { kind: "new", text: "New “Targeting details” panel under each ad platform — see how spend and ROAS break down by audience and by geography, collapsed by default so it's there when you want it." },
      { kind: "new", text: "Audience and region come straight from the source: Google Ads (age + region) via the Google Ads API and Meta (age, gender + region) via the Marketing API, with a seeded fallback if a live pull fails." },
    ],
  },
  {
    version: "1.5",
    date: "2026-06-23",
    title: "Email Marketing (Mailchimp)",
    items: [
      { kind: "new", text: "Mailchimp connector — paste your API key (verified live, then encrypted) to track email marketing." },
      { kind: "new", text: "New Email Marketing dashboard section: subscribers, campaigns sent, average open rate, and click rate." },
    ],
  },
  {
    version: "1.4",
    date: "2026-06-23",
    title: "Four-section dashboard",
    items: [
      { kind: "improved", text: "The dashboard is now organized into four prominent sections: Revenue (Shopify), Traffic (GA4), Ads (Google + Meta), and Socials." },
      { kind: "new", text: "Socials section (Instagram, TikTok) added as placeholders — organic-social tracking coming soon." },
      { kind: "improved", text: "Each section is collapsible and labeled with its platform icon." },
    ],
  },
  {
    version: "1.3",
    date: "2026-06-23",
    title: "Live Google Ads + cross-platform view",
    items: [
      { kind: "new", text: "Google Ads is now LIVE — real campaign spend, ROAS, CPA, and conversions via the Google Ads API." },
      { kind: "new", text: "“All advertising” summary: total ad spend, impressions, blended ROAS, and reach across Google Ads + Meta." },
      { kind: "new", text: "Total ad spend is now plotted on the Revenue & traffic chart." },
      { kind: "improved", text: "Each dashboard section is collapsible and labeled with its platform icon (Shopify, GA4, Google Ads, Meta)." },
    ],
  },
  {
    version: "1.2",
    date: "2026-06-21",
    title: "Meta reach & frequency",
    items: [
      { kind: "new", text: "Meta Ads now shows unique reach and frequency — overall and per account — queried at the range level so reach is truly unique, not double-counted across days." },
      { kind: "improved", text: "Each Meta account is labeled by name (Instagram vs Facebook), with the combined roll-up marked “All accounts.”" },
      { kind: "improved", text: "If a Meta token expires, the dashboard shows a reconnect prompt instead of silently hiding the section." },
    ],
  },
  {
    version: "1.1",
    date: "2026-06-20",
    title: "Live Google Ads",
    items: [
      { kind: "new", text: "Google Ads can now pull live campaign data via the Google Ads API — add a refresh token and the connector flips from Seeded to Live." },
      { kind: "improved", text: "Dashboard and assistant label Google Ads metrics as live vs seeded, and the connector falls back to seeded data automatically if a live pull ever fails." },
    ],
  },
  {
    version: "1.0",
    date: "2026-06-13",
    title: "Release notes",
    items: [
      { kind: "new", text: "This page — see everything that's shipped, updated with every release." },
    ],
  },
  {
    version: "0.9",
    date: "2026-06-13",
    title: "Teams & roles",
    items: [
      { kind: "new", text: "Org workspaces — invite teammates to share your connected data; no re-setup." },
      { kind: "new", text: "Admin & Member roles: admins manage connectors, members get view-only dashboards + assistant." },
      { kind: "improved", text: "Connectors are now enforced per-org at the database with role-based RLS, not just in the UI." },
      { kind: "improved", text: "Cancel a pending invite from the Team page." },
      { kind: "new", text: "Invite emails — invitees get a sign-in link (when email delivery is configured)." },
    ],
  },
  {
    version: "0.8",
    date: "2026-06-13",
    title: "Meta Ads",
    items: [
      { kind: "new", text: "Meta Ads connector via the live Marketing API (spend, ROAS, CPA, conversions)." },
      { kind: "new", text: "Connect multiple ad accounts and compare Instagram vs Facebook side by side." },
      { kind: "fixed", text: "Graceful handling when an ad token expires — the assistant answers with your other sources." },
    ],
  },
  {
    version: "0.7",
    date: "2026-06-13",
    title: "Google Ads & marketing insights",
    items: [
      { kind: "new", text: "Google Ads connector with ROAS / CPA / CTR and campaign performance." },
      { kind: "new", text: "“Where to spend your next marketing dollar” quadrant — scale winners, fix leaks." },
      { kind: "new", text: "Revenue by school joined with product-page traffic (revenue per visit)." },
    ],
  },
  {
    version: "0.6",
    date: "2026-06-13",
    title: "Google Analytics",
    items: [
      { kind: "new", text: "GA4 connector via Google OAuth (read-only)." },
      { kind: "new", text: "Auto-detects the GA4 property that matches your store's domain — no Property ID hunting." },
      { kind: "new", text: "Sessions, users, and channel mix on the dashboard and in chat." },
      { kind: "new", text: "Conversion rate (orders ÷ sessions) in the Shopify metrics when GA4 is connected." },
    ],
  },
  {
    version: "0.5",
    date: "2026-06-13",
    title: "Dashboard & assistant upgrades",
    items: [
      { kind: "new", text: "Persistent, minimizable assistant docked on every page." },
      { kind: "new", text: "Combined revenue + traffic chart and a Year-to-Date range." },
      { kind: "new", text: "Custom date range — pick any from/to window on the dashboard." },
      { kind: "improved", text: "Date range now drives both the charts and what the assistant sees." },
    ],
  },
  {
    version: "0.3",
    date: "2026-06-13",
    title: "Agentic assistant",
    items: [
      { kind: "new", text: "Ask questions in plain English — real tool calls over your data, never guessed numbers." },
      { kind: "new", text: "Proactive anomaly detection with one concrete recommended action." },
    ],
  },
  {
    version: "0.1",
    date: "2026-06-13",
    title: "Launch",
    items: [
      { kind: "new", text: "Google sign-in with per-tenant data isolation." },
      { kind: "new", text: "Live Shopify connector — revenue, orders, AOV, top products, sales trend." },
      { kind: "new", text: "Secrets encrypted server-side, never exposed to the browser." },
    ],
  },
];
