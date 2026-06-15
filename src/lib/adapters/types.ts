export type DateRange = { start: string; end: string };
export type SourceId = "shopify" | "ga4" | "google_ads" | "meta_ads" | "email";

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
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conversionValue: number; // for ROAS
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
