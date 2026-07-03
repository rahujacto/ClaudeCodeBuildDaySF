import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConnection, adapterContextFromRow } from "@/lib/connections";
import { getCurrentOrg } from "@/lib/org";
import { fetchShopifyData, type ShopifyData } from "@/lib/adapters/shopify";
import { fetchGa4Data, fetchGa4SchoolTraffic, type Ga4Data } from "@/lib/adapters/ga4";
import { loadGoogleAdsDaily, liveCredsFromRow } from "@/lib/adapters/google-ads-live";
import { fetchMetaAdsForAccounts } from "@/lib/adapters/meta-ads";
import { fetchMailchimpData, type MailchimpData } from "@/lib/adapters/mailchimp";
import type { MetaAccount } from "@/lib/adapters/types";
import type { SchoolTraffic } from "@/lib/schools";

function readMetaAccounts(config: Record<string, unknown> | undefined): MetaAccount[] {
  if (!config) return [];
  if (Array.isArray(config.accounts)) return config.accounts as MetaAccount[];
  if (config.adAccountId)
    return [{ adAccountId: config.adAccountId as string, accountName: (config.accountName as string) ?? "" }];
  return [];
}
import { CHAT_TOOLS, createToolExecutor, type DataResolver } from "@/lib/chat/tools";
import type { DateRange, SourceId } from "@/lib/adapters/types";

export const maxDuration = 60;

const MODEL = "claude-opus-4-8";
const MAX_TURNS = 8;

function systemPrompt(
  today: string,
  connected: SourceId[],
  shopDomain?: string,
  dashboardRange?: { start: string; end: string },
  adsLive = false,
) {
  const connectedLine = connected.length
    ? `Connected sources: ${connected.join(", ")}${shopDomain ? ` (Shopify store: ${shopDomain})` : ""}.`
    : "No data sources are connected yet.";
  const notConnected = (["shopify", "ga4", "google_ads", "meta_ads", "email"] as SourceId[]).filter(
    (s) => !connected.includes(s),
  );
  const notConnectedLine = notConnected.length
    ? `\nNOT connected: ${notConnected.join(", ")} — if asked about these, say so plainly; never invent numbers.`
    : "";
  const ga4Note = connected.includes("ga4")
    ? "\nGA4 metrics available via the tools: sessions, users, new_users, and channel breakdowns."
    : "";
  const adsNote = connected.includes("google_ads")
    ? adsLive
      ? "\nGoogle Ads is LIVE (real campaign data via the Google Ads API)."
      : "\nGoogle Ads is SEEDED data (live pulls deferred) — when you cite Ads numbers (spend, ROAS, CPA, conversions, by campaign), briefly note they're seeded."
    : "";
  const rangeLine = dashboardRange
    ? `\nThe user's dashboard is currently set to ${dashboardRange.start} → ${dashboardRange.end}. When they ask about performance without specifying exact dates, default to THIS range (and compare it to the equal-length period before it).`
    : "";
  return `You are Pulse, an AI business analyst for a small e-commerce store owner. Today's date is ${today}.

${connectedLine}${notConnectedLine}${ga4Note}${adsNote}${rangeLine}

Rules:
- ALWAYS use the tools to get real numbers. Never state a metric you did not get from a tool call.
- Lead with the number, then the comparison/context, then ONE concrete recommended action tied to the data.
- For open-ended questions like "how am I doing?" or "anything I should worry about?", proactively call detect_anomalies first.
- When the user says "last week", "this month", etc., compute the exact date ranges from today's date (${today}). A week is 7 days. "Last week" = the 7 days ending today unless the user means calendar weeks.
- Be concise. Use plain language a non-technical owner understands. Format money as $ with thousands separators.
- AOV = revenue / orders.
- If a tool returns an error for ONE source (e.g. an expired Meta token), do NOT fail the whole answer: briefly note that source is temporarily unavailable (and how to fix it, e.g. "reconnect Meta Ads"), then answer using the other connected sources. Never present the raw error as the entire response.`;
}

type ClientMessage = { role: "user" | "assistant"; content: string };

function sse(controller: ReadableStreamDefaultController, event: object) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
}

/** Short, client-safe summary of a tool result for the trace UI. */
function summarizeResult(name: string, result: Record<string, unknown>): string {
  if ("error" in result) return String(result.error);
  if (name === "get_metrics_summary") {
    if (result.source === "ga4")
      return `${Number(result.sessions).toLocaleString()} sessions · ${Number(result.users).toLocaleString()} users`;
    if (result.source === "email")
      return `${Number(result.subscribers).toLocaleString()} subs · ${result.campaignsSent} campaigns`;
    if (result.source === "google_ads" || result.source === "meta_ads")
      return `$${Number(result.spend).toLocaleString()} spend · ${result.conversions} conv · ${result.roas}× ROAS`;
    return `$${Number(result.revenue).toLocaleString()} revenue · ${result.orders} orders · $${result.aov} AOV`;
  }
  if (name === "compare_periods") {
    const pct = result.pctChange;
    return `${result.metric}: ${result.current} vs ${result.previous} (${pct === null ? "n/a" : `${Number(pct) >= 0 ? "+" : ""}${pct}%`})`;
  }
  if (name === "breakdown_by_dimension") {
    const top = (result.results as Array<{ title?: string; channel?: string; campaign?: string; account?: string }>)?.[0];
    const topLabel = top?.title ?? top?.channel ?? top?.campaign ?? top?.account;
    return `${(result.results as unknown[])?.length ?? 0} ${result.dimension}s ranked by ${result.metric}${topLabel ? ` · top: ${topLabel}` : ""}`;
  }
  if (name === "breakdown_by_school") {
    const top = (result.results as Array<{ school: string }>)?.[0];
    return `${result.schoolCount} schools · $${Number(result.totalRevenue).toLocaleString()}${top ? ` · top: ${top.school}` : ""}`;
  }
  if (name === "suggest_revenue_optimizations") {
    return `Fetched cross-platform data for ${(result.range as {start: string; end: string})?.start || 'unknown'} to ${(result.range as {start: string; end: string})?.end || 'unknown'}`;
  }
  if (name === "detect_anomalies") {
    const found = (result.anomaliesFound as unknown[])?.length ?? 0;
    return `${found} anomaly${found === 1 ? "" : "ies"} found over last ${result.lookbackDays}d`;
  }
  return "done";
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { messages?: ClientMessage[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const clientMessages = (body.messages ?? []).filter(
    (m) => (m.role === "user" || m.role === "assistant") && m.content?.trim(),
  );
  if (!clientMessages.length) {
    return NextResponse.json({ error: "No messages." }, { status: 400 });
  }

  // Build an RLS-scoped resolver from the org's connections.
  const { orgId } = await getCurrentOrg(supabase);
  const [shopifyRow, ga4Row, adsRow, metaRow, emailRow] = await Promise.all([
    getConnection(supabase, orgId, "shopify"),
    getConnection(supabase, orgId, "ga4"),
    getConnection(supabase, orgId, "google_ads"),
    getConnection(supabase, orgId, "meta_ads"),
    getConnection(supabase, orgId, "email"),
  ]);
  const connected: SourceId[] = [];
  if (shopifyRow?.status === "connected") connected.push("shopify");
  const ga4PropertyId = ga4Row?.config?.propertyId as string | undefined;
  if (ga4Row?.status === "connected" && ga4PropertyId) connected.push("ga4");
  const adsConnected = adsRow?.status === "seeded" || adsRow?.status === "connected";
  if (adsConnected) connected.push("google_ads");
  const adsLive = adsRow?.status === "connected" && liveCredsFromRow(adsRow) !== null;
  const metaAccounts = metaRow?.status === "connected" ? readMetaAccounts(metaRow.config) : [];
  if (metaAccounts.length) connected.push("meta_ads");
  const metaCtx = adapterContextFromRow(user.id, metaRow);

  if (emailRow?.status === "connected") connected.push("email");
  const emailCtx = adapterContextFromRow(user.id, emailRow);
  const mailchimpKeyCache = new Map<string, string>();

  const shopDomain = shopifyRow?.config?.domain as string | undefined;
  const shopCtx = adapterContextFromRow(user.id, shopifyRow);
  const ga4Ctx = adapterContextFromRow(user.id, ga4Row);

  const shopCache = new Map<string, Promise<ShopifyData>>();
  const ga4Cache = new Map<string, Promise<Ga4Data>>();
  const ga4TrafficCache = new Map<string, Promise<SchoolTraffic[]>>();
  const metaCache = new Map<string, ReturnType<typeof fetchMetaAdsForAccounts>>();
  const mailCache = new Map<string, Promise<MailchimpData>>();
  const resolver: DataResolver = {
    connectedSources: connected,
    adsLive,
    getShopify: (range: DateRange) => {
      const key = `${range.start}|${range.end}`;
      let p = shopCache.get(key);
      if (!p) {
        p = (async () => {
          const secret = await shopCtx.getSecret();
          const clientId = shopCtx.config.clientId as string;
          if (!secret || !shopDomain || !clientId) throw new Error("Shopify not configured");
          return fetchShopifyData(shopDomain, clientId, secret, range);
        })();
        shopCache.set(key, p);
      }
      return p;
    },
    getGa4: (range: DateRange) => {
      const key = `${range.start}|${range.end}`;
      let p = ga4Cache.get(key);
      if (!p) {
        p = (async () => {
          const refresh = await ga4Ctx.getSecret();
          if (!refresh || !ga4PropertyId) throw new Error("GA4 not configured");
          return fetchGa4Data(refresh, ga4PropertyId, range);
        })();
        ga4Cache.set(key, p);
      }
      return p;
    },
    getGa4SchoolTraffic: (range: DateRange) => {
      const key = `${range.start}|${range.end}`;
      let p = ga4TrafficCache.get(key);
      if (!p) {
        p = (async () => {
          const refresh = await ga4Ctx.getSecret();
          if (!refresh || !ga4PropertyId) throw new Error("GA4 not configured");
          return fetchGa4SchoolTraffic(refresh, ga4PropertyId, range);
        })();
        ga4TrafficCache.set(key, p);
      }
      return p;
    },
    getGoogleAds: async (range: DateRange) => (await loadGoogleAdsDaily(orgId, adsRow, range)).rows,
    getMetaAds: (range: DateRange) => {
      const key = `${range.start}|${range.end}`;
      let p = metaCache.get(key);
      if (!p) {
        p = (async () => {
          const token = await metaCtx.getSecret();
          if (!token || !metaAccounts.length) throw new Error("Meta Ads not configured");
          return fetchMetaAdsForAccounts(metaAccounts, token, range);
        })();
        metaCache.set(key, p);
      }
      return p;
    },
    getMailchimp: (range: DateRange) => {
      const key = `${range.start}|${range.end}`;
      let p = mailCache.get(key);
      if (!p) {
        p = (async () => {
          let apiKey = mailchimpKeyCache.get("key");
          if (!apiKey) {
            apiKey = (await emailCtx.getSecret()) || undefined;
            if (apiKey) mailchimpKeyCache.set("key", apiKey);
          }
          if (!apiKey) throw new Error("Mailchimp not configured");
          return fetchMailchimpData(apiKey, range);
        })();
        mailCache.set(key, p);
      }
      return p;
    },
  };

  const today = new Date().toISOString().slice(0, 10);

  // The dashboard date-range selector writes this cookie, so the agent defaults
  // to the same window the user is currently viewing.
  let dashboardRange: { start: string; end: string } | undefined;
  const rangeCookie = request.cookies.get("pulse_range")?.value;
  const m = rangeCookie?.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (m) dashboardRange = { start: m[1], end: m[2] };

  const runTool = createToolExecutor(resolver, today);
  const anthropic = new Anthropic();

  const messages: Anthropic.MessageParam[] = clientMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const response = await anthropic.messages.create({
            model: MODEL,
            max_tokens: 16000,
            thinking: { type: "adaptive" },
            system: systemPrompt(today, connected, shopDomain, dashboardRange, adsLive),
            tools: CHAT_TOOLS,
            messages,
          });

          for (const block of response.content) {
            if (block.type === "text" && block.text.trim()) {
              sse(controller, { type: "text", text: block.text });
            }
          }

          if (response.stop_reason !== "tool_use") {
            break;
          }

          const toolUses = response.content.filter((b) => b.type === "tool_use");
          messages.push({ role: "assistant", content: response.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            sse(controller, {
              type: "tool_use",
              id: tu.id,
              name: tu.name,
              input: tu.input,
            });
            let result: Record<string, unknown>;
            try {
              result = await runTool(tu.name, tu.input as Record<string, unknown>);
            } catch (err) {
              result = {
                error: err instanceof Error ? err.message : "Tool execution failed.",
              };
            }
            sse(controller, {
              type: "tool_result",
              id: tu.id,
              name: tu.name,
              summary: summarizeResult(tu.name, result),
            });
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify(result),
            });
          }
          messages.push({ role: "user", content: toolResults });
        }
        sse(controller, { type: "done" });
      } catch (err) {
        const status = (err as { status?: number })?.status;
        const message =
          status === 401
            ? "The assistant's API key is invalid or expired. The app owner needs to update ANTHROPIC_API_KEY."
            : status === 429
              ? "The assistant is rate-limited right now — please try again in a moment."
              : err instanceof Error
                ? err.message
                : "Something went wrong.";
        sse(controller, { type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
