import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The agent profile is the layered system prompt behind the Pulse assistant:
 * durable knowledge about the business (auto-generated from the website +
 * connected data, then hand-editable) that grounds every recommendation the
 * assistant makes — the goal being an agentic ad manager that can replace a
 * human manually optimizing spend across platforms.
 */

export type AgentLayerKey =
  | "core"
  | "business_model"
  | "customers"
  | "competitors"
  | "ad_strategy";

export type AgentLayers = Partial<Record<AgentLayerKey, string>>;

export type AgentProfile = {
  layers: AgentLayers;
  generatedAt: string | null;
  updatedAt: string | null;
};

/** Layer metadata: UI titles/help text double as generation guidance. */
export const AGENT_LAYERS: {
  key: AgentLayerKey;
  title: string;
  description: string;
}[] = [
  {
    key: "core",
    title: "Core",
    description:
      "Who the business is and the agent's mission: act as this business's cross-platform ad manager (Google Ads, Meta, email), replacing a human who manually optimizes spend. Tone, guardrails, and what 'good' looks like (e.g. protect blended ROAS while scaling revenue).",
  },
  {
    key: "business_model",
    title: "Business model",
    description:
      "What the store sells and how it makes money: product lines, price points, AOV, margins if known, seasonality (e.g. graduation season peaks), sales channels, and top products.",
  },
  {
    key: "customers",
    title: "Customers",
    description:
      "Who buys and why: segments (e.g. graduating students, parents, school administrators), purchase triggers and timing, geography, and what messaging resonates with each segment.",
  },
  {
    key: "competitors",
    title: "Competitors",
    description:
      "The competitive landscape: direct competitors (including official school bookstores and marketplace sellers), how this business differentiates (price, speed, quality), and what that implies for bidding and positioning.",
  },
  {
    key: "ad_strategy",
    title: "Ad strategy",
    description:
      "Current advertising posture and playbook: platforms in use, budget split, ROAS targets and floors, top and underperforming campaigns, scaling rules (when to shift budget between platforms/campaigns), and experiments worth running.",
  },
];

/** Compose the layers into the block the chat assistant receives. */
export function composeAgentKnowledge(layers: AgentLayers): string {
  const parts: string[] = [];
  for (const { key, title } of AGENT_LAYERS) {
    const text = layers[key]?.trim();
    if (text) parts.push(`### ${title}\n${text}`);
  }
  if (!parts.length) return "";
  // Cap so a runaway edit can't blow up every chat request.
  return parts.join("\n\n").slice(0, 12_000);
}

export async function getAgentProfile(
  supabase: SupabaseClient,
  orgId: string,
): Promise<AgentProfile | null> {
  const { data, error } = await supabase
    .from("agent_profiles")
    .select("layers, generated_at, updated_at")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    layers: (data.layers as AgentLayers) ?? {},
    generatedAt: data.generated_at,
    updatedAt: data.updated_at,
  };
}

export async function saveAgentProfile(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  layers: AgentLayers,
  generated: boolean,
): Promise<{ error: string | null }> {
  const clean: AgentLayers = {};
  for (const { key } of AGENT_LAYERS) {
    const v = layers[key];
    if (typeof v === "string" && v.trim()) clean[key] = v.trim().slice(0, 8_000);
  }
  const { error } = await supabase.from("agent_profiles").upsert(
    {
      org_id: orgId,
      layers: clean,
      updated_by: userId,
      ...(generated ? { generated_at: new Date().toISOString() } : {}),
    },
    { onConflict: "org_id" },
  );
  return { error: error ? error.message : null };
}
