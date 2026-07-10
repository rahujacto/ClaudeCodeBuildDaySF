import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConnections, adapterContextFromRow } from "@/lib/connections";
import { getCurrentOrg } from "@/lib/org";
import { loadShopifyData } from "@/lib/shopify-cache";
import { loadGoogleAdsDaily } from "@/lib/adapters/google-ads-live";
import { adsByCampaign, adsTotals, type AdRow } from "@/lib/adapters/google-ads";
import { fetchMetaAdsForAccounts } from "@/lib/adapters/meta-ads";
import type { MetaAccount } from "@/lib/adapters/types";
import { ytdRange } from "@/lib/dates";
import {
  AGENT_LAYERS,
  saveAgentProfile,
  getAgentProfile,
  type AgentLayers,
} from "@/lib/agent";

export const maxDuration = 60;

const MODEL = "claude-opus-4-8";

/** Fetch the storefront and reduce it to readable text (capped). */
async function fetchSiteText(domain: string): Promise<string> {
  try {
    const res = await fetch(`https://${domain}`, {
      redirect: "follow",
      headers: { "User-Agent": "PulseAgent/1.0 (+business-profile-generation)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6_000);
  } catch {
    return "";
  }
}

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { orgId, role } = await getCurrentOrg(supabase);
  if (role !== "admin") {
    return NextResponse.json({ error: "Only admins can generate the agent." }, { status: 403 });
  }

  const conns = await getConnections(supabase, orgId, ["shopify", "google_ads", "meta_ads"]);
  const shopifyRow = conns.shopify ?? null;
  if (shopifyRow?.status !== "connected") {
    return NextResponse.json(
      { error: "Connect Shopify first — the profile is generated from your store." },
      { status: 400 },
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const range = ytdRange(today);
  const domain = String(shopifyRow.config?.domain ?? "");

  // Gather signals in parallel; each source is optional except Shopify.
  const shopCtx = adapterContextFromRow(user.id, shopifyRow);
  const adsRow = conns.google_ads ?? null;
  const metaRow = conns.meta_ads ?? null;
  const metaAccounts: MetaAccount[] =
    metaRow?.status === "connected" && Array.isArray(metaRow.config?.accounts)
      ? (metaRow.config.accounts as MetaAccount[])
      : [];

  const [shop, site, googleAds, metaAds] = await Promise.all([
    (async () => {
      const secret = await shopCtx.getSecret();
      const clientId = shopCtx.config.clientId as string;
      if (!secret || !clientId || !domain) throw new Error("Shopify is not fully configured.");
      return loadShopifyData(supabase, orgId, { domain, clientId, secret }, range);
    })(),
    fetchSiteText(domain),
    (async () => {
      if (adsRow?.status !== "seeded" && adsRow?.status !== "connected") return null;
      try {
        return (await loadGoogleAdsDaily(orgId, adsRow, range)).rows;
      } catch {
        return null;
      }
    })(),
    (async () => {
      if (!metaAccounts.length) return null;
      try {
        const mctx = adapterContextFromRow(user.id, metaRow);
        const token = await mctx.getSecret();
        return token ? await fetchMetaAdsForAccounts(metaAccounts, token, range) : null;
      } catch {
        return null;
      }
    })(),
  ]).catch((e) => {
    throw e instanceof Error ? e : new Error("Could not load store data.");
  });

  const revenue = Math.round(shop.daily.reduce((s, d) => s + d.revenue, 0));
  const orders = shop.daily.reduce((s, d) => s + d.orders, 0);
  const adsBlock = (rows: AdRow[] | null) =>
    rows
      ? {
          totals: adsTotals(rows),
          topCampaigns: adsByCampaign(rows).slice(0, 12),
        }
      : null;

  const evidence = {
    storeDomain: domain,
    range,
    shopify: {
      revenue,
      orders,
      aov: orders ? Math.round((revenue / orders) * 100) / 100 : 0,
      topProducts: shop.products.slice(0, 15),
      salesChannels: shop.channels,
    },
    googleAds: adsBlock(googleAds as AdRow[] | null),
    metaAds: adsBlock(metaAds as AdRow[] | null),
    websiteText: site || "(website unreachable)",
  };

  const layerSpec = AGENT_LAYERS.map((l) => `- "${l.key}" (${l.title}): ${l.description}`).join("\n");

  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4_000,
    system: `You write the layered system prompt for "Pulse", an agentic ad manager for a small e-commerce business. The owner wants this agent to replace a person who manually optimizes ad spend across platforms (Google Ads, Meta, email).

Write each layer as tight, factual markdown (bullets over prose, ~120-180 words per layer). Ground every claim in the evidence provided — store data, campaign performance, and website text. For competitors, reason from the industry and website (do not invent specific company facts you are unsure of; frame them as the competitive landscape). Write in second person about the agent ("You manage…"). Today's date is ${today}.`,
    tools: [
      {
        name: "save_agent_profile",
        description: "Save the generated agent profile layers.",
        input_schema: {
          type: "object" as const,
          properties: Object.fromEntries(
            AGENT_LAYERS.map((l) => [l.key, { type: "string", description: l.description }]),
          ),
          required: AGENT_LAYERS.map((l) => l.key),
        },
      },
    ],
    tool_choice: { type: "tool", name: "save_agent_profile" },
    messages: [
      {
        role: "user",
        content: `Generate the agent profile layers:\n${layerSpec}\n\nEvidence (year-to-date):\n${JSON.stringify(evidence)}`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return NextResponse.json({ error: "Generation failed — please retry." }, { status: 502 });
  }

  const layers = toolUse.input as AgentLayers;
  const { error } = await saveAgentProfile(supabase, orgId, user.id, layers, true);
  if (error) return NextResponse.json({ error }, { status: 500 });

  const profile = await getAgentProfile(supabase, orgId);
  return NextResponse.json({ profile });
}
