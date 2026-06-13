import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConnection, adapterContextFromRow } from "@/lib/connections";
import { fetchShopifyData, type ShopifyData } from "@/lib/adapters/shopify";
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
) {
  const connectedLine = connected.length
    ? `Connected sources: ${connected.join(", ")}${shopDomain ? ` (Shopify store: ${shopDomain})` : ""}.`
    : "No data sources are connected yet.";
  const rangeLine = dashboardRange
    ? `\nThe user's dashboard is currently set to ${dashboardRange.start} → ${dashboardRange.end}. When they ask about performance without specifying exact dates, default to THIS range (and compare it to the equal-length period before it).`
    : "";
  return `You are Pulse, an AI business analyst for a small e-commerce store owner. Today's date is ${today}.

${connectedLine}${rangeLine}
GA4 and Google Ads are NOT connected yet — if asked about them, say so plainly; never invent numbers for them.

Rules:
- ALWAYS use the tools to get real numbers. Never state a metric you did not get from a tool call.
- Lead with the number, then the comparison/context, then ONE concrete recommended action tied to the data.
- For open-ended questions like "how am I doing?" or "anything I should worry about?", proactively call detect_anomalies first.
- When the user says "last week", "this month", etc., compute the exact date ranges from today's date (${today}). A week is 7 days. "Last week" = the 7 days ending today unless the user means calendar weeks.
- Be concise. Use plain language a non-technical owner understands. Format money as $ with thousands separators.
- AOV = revenue / orders. If a tool returns an error, tell the user what's missing rather than guessing.`;
}

type ClientMessage = { role: "user" | "assistant"; content: string };

function sse(controller: ReadableStreamDefaultController, event: object) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
}

/** Short, client-safe summary of a tool result for the trace UI. */
function summarizeResult(name: string, result: Record<string, unknown>): string {
  if ("error" in result) return String(result.error);
  if (name === "get_metrics_summary")
    return `$${Number(result.revenue).toLocaleString()} revenue · ${result.orders} orders · $${result.aov} AOV`;
  if (name === "compare_periods") {
    const pct = result.pctChange;
    return `${result.metric}: ${result.current} vs ${result.previous} (${pct === null ? "n/a" : `${Number(pct) >= 0 ? "+" : ""}${pct}%`})`;
  }
  if (name === "breakdown_by_dimension") {
    const top = (result.results as Array<{ title: string }>)?.[0];
    return `${(result.results as unknown[])?.length ?? 0} ${result.dimension}s ranked by ${result.metric}${top ? ` · top: ${top.title}` : ""}`;
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

  // Build an RLS-scoped resolver from the user's Shopify connection.
  const shopifyRow = await getConnection(supabase, "shopify");
  const connected: SourceId[] = shopifyRow?.status === "connected" ? ["shopify"] : [];
  const shopDomain = shopifyRow?.config?.domain as string | undefined;
  const ctx = adapterContextFromRow(user.id, shopifyRow);

  const cache = new Map<string, Promise<ShopifyData>>();
  const resolver: DataResolver = {
    connectedSources: connected,
    getShopify: (range: DateRange) => {
      const key = `${range.start}|${range.end}`;
      let p = cache.get(key);
      if (!p) {
        p = (async () => {
          const secret = await ctx.getSecret();
          const clientId = ctx.config.clientId as string;
          if (!secret || !shopDomain || !clientId) throw new Error("Shopify not configured");
          return fetchShopifyData(shopDomain, clientId, secret, range);
        })();
        cache.set(key, p);
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
            system: systemPrompt(today, connected, shopDomain, dashboardRange),
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
        sse(controller, {
          type: "error",
          message: err instanceof Error ? err.message : "Something went wrong.",
        });
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
