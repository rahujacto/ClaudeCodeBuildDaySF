export type DateRange = { start: string; end: string };
export type SourceId =
  | "shopify"
  | "ga4"
  | "google_ads"
  | "meta_ads"
  | "email"
  | "instagram"
  | "tiktok";

export type ConnectionStatus =
  | "connected"
  | "seeded"
  | "disconnected"
  | "coming_soon";

export interface ShopifyDailyMetric {
  source: "shopify";
  date: string;
  orders: number;
  revenue: number;
  refunds: number;
  newCustomers: number;
  topProduct?: string;
}

/** Revenue/orders attributed to a single sales channel over the range. */
export interface ShopifyChannelMetric {
  /** Friendly channel name, e.g. "Online Store", "ChatGPT", "Shop". */
  channel: string;
  /** True for agentic AI storefronts (ChatGPT, Copilot, Shop, etc.). */
  ai: boolean;
  orders: number;
  revenue: number;
  newCustomers: number;
}

/** Revenue/orders attributed to a shipping state/region over the range. */
export interface ShopifyStateMetric {
  /** Display label, e.g. "California" or "Ontario, CA". */
  state: string;
  orders: number;
  revenue: number;
}

export interface Ga4DailyMetric {
  source: "ga4";
  date: string;
  sessions: number;
  users: number;
  newUsers: number;
  conversions: number;
  channel: string;
  topPage?: string;
}

export interface GoogleAdsDailyMetric {
  source: "google_ads";
  date: string;
  campaign: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conversionValue: number; // for ROAS
}

export interface MetaAdsDailyMetric {
  source: "meta_ads";
  date: string;
  campaign: string;
  account?: string; // which ad account (for multi-account breakdown)
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conversionValue: number; // for ROAS
}

export type MetaAccount = {
  adAccountId: string;
  accountName: string;
  currency?: string;
};

/** Organic social summary over a range (shared shape for Instagram + TikTok). */
export interface SocialData {
  followers: number;
  /** Posts/videos published within the range. */
  posts: number;
  likes: number;
  comments: number;
  shares: number;
  /** Reach (Instagram) or video views (TikTok) within the range. */
  views: number;
  /** likes + comments + shares. */
  interactions: number;
  /** interactions ÷ views, as a percent. */
  engagementRate: number;
}

export type DailyMetric =
  | ShopifyDailyMetric
  | Ga4DailyMetric
  | GoogleAdsDailyMetric
  | MetaAdsDailyMetric;

export interface AdapterContext {
  userId: string;
  /** Non-secret fields from connections.config (domain, property id, …). */
  config: Record<string, unknown>;
  /** Decrypts the stored secret server-side. Returns null if none stored. */
  getSecret: () => Promise<string | null>;
}

export interface DataAdapter {
  source: SourceId;
  label: string;
  isConnected(ctx: AdapterContext): Promise<boolean>;
  /** Used by the Connections "Save & Test" button. */
  test(ctx: AdapterContext): Promise<{ ok: boolean; message: string }>;
  getMetrics(ctx: AdapterContext, range: DateRange): Promise<DailyMetric[]>;
}
