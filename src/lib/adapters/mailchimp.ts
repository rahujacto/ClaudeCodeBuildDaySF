import type { DateRange } from "./types";

/**
 * Mailchimp Marketing API connector (read-only). The API key encodes its data
 * center as a suffix (e.g. "…-us21" → us21.api.mailchimp.com). Auth is HTTP
 * Basic with any username + the API key as the password.
 */

class MailchimpError extends Error {}

/** Pull the data-center prefix from the key suffix (xxxx-us21 → us21). */
export function deriveServerPrefix(apiKey: string): string | null {
  const m = apiKey.trim().match(/-([a-z]+\d+)$/i);
  return m ? m[1] : null;
}

function authHeader(apiKey: string): string {
  return "Basic " + Buffer.from(`anystring:${apiKey.trim()}`).toString("base64");
}

async function mcGet<T>(apiKey: string, path: string): Promise<T> {
  const dc = deriveServerPrefix(apiKey);
  if (!dc) throw new MailchimpError("That doesn't look like a Mailchimp API key (missing the -usXX suffix).");
  const res = await fetch(`https://${dc}.api.mailchimp.com/3.0${path}`, {
    headers: { Authorization: authHeader(apiKey) },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & { title?: string; detail?: string };
  if (!res.ok) {
    if (res.status === 401) throw new MailchimpError("Mailchimp rejected the API key (unauthorized).");
    throw new MailchimpError(json?.detail || json?.title || `Mailchimp API error (HTTP ${res.status}).`);
  }
  return json;
}

// ── Save & Test ─────────────────────────────────────────────────────────────
export type MailchimpTestResult = {
  ok: boolean;
  message: string;
  accountName?: string;
  serverPrefix?: string;
};

export async function testMailchimpConnection(apiKey: string): Promise<MailchimpTestResult> {
  const dc = deriveServerPrefix(apiKey);
  if (!dc) return { ok: false, message: "Enter a valid Mailchimp API key (ends in -usXX)." };
  try {
    const root = await mcGet<{ account_name?: string }>(apiKey, "/");
    return {
      ok: true,
      message: `Connected to ${root.account_name ?? "Mailchimp"}.`,
      accountName: root.account_name,
      serverPrefix: dc,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof MailchimpError ? err.message : "Couldn't reach Mailchimp. Check the API key.",
    };
  }
}

// ── Metrics ─────────────────────────────────────────────────────────────────
export type MailchimpData = {
  subscribers: number;
  campaignsSent: number;
  openRate: number; // %
  clickRate: number; // %
};

type CampaignRow = {
  send_time?: string;
  report_summary?: { open_rate?: number; click_rate?: number };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function fetchMailchimpData(apiKey: string, range: DateRange): Promise<MailchimpData> {
  // Current audience size (account-wide snapshot).
  const root = await mcGet<{ total_subscribers?: number }>(apiKey, "/");

  // Campaigns sent within the range, with their report summaries.
  const params = new URLSearchParams({
    status: "sent",
    since_send_time: `${range.start}T00:00:00+00:00`,
    before_send_time: `${range.end}T23:59:59+00:00`,
    count: "500",
    fields: "campaigns.send_time,campaigns.report_summary",
  });
  const data = await mcGet<{ campaigns?: CampaignRow[] }>(apiKey, `/campaigns?${params.toString()}`);
  const campaigns = data.campaigns ?? [];

  const n = campaigns.length;
  const sumOpen = campaigns.reduce((s, c) => s + (c.report_summary?.open_rate ?? 0), 0);
  const sumClick = campaigns.reduce((s, c) => s + (c.report_summary?.click_rate ?? 0), 0);

  return {
    subscribers: root.total_subscribers ?? 0,
    campaignsSent: n,
    openRate: n ? round2((sumOpen / n) * 100) : 0,
    clickRate: n ? round2((sumClick / n) * 100) : 0,
  };
}
