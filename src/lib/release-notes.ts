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
    ],
  },
  {
    version: "0.5",
    date: "2026-06-13",
    title: "Dashboard & assistant upgrades",
    items: [
      { kind: "new", text: "Persistent, minimizable assistant docked on every page." },
      { kind: "new", text: "Combined revenue + traffic chart and a Year-to-Date range." },
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
