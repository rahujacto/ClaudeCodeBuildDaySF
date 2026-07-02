import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { getConnection, adapterContextFromRow } from "@/lib/connections";
import { probeShopifyChannels } from "@/lib/adapters/shopify";

// TEMPORARY diagnostic: GET /api/debug/shopify-channels
// Returns distinct order-attribution signatures for the last N orders so we
// can see how agentic (ChatGPT/Copilot) orders are actually labeled.
// Remove once channel attribution is confirmed.
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { orgId } = await getCurrentOrg(supabase);
  const row = await getConnection(supabase, orgId, "shopify");
  if (row?.status !== "connected") {
    return NextResponse.json({ error: "Shopify not connected." }, { status: 400 });
  }

  const ctx = adapterContextFromRow(user.id, row);
  const secret = await ctx.getSecret();
  const clientId = ctx.config.clientId as string | undefined;
  const domain = ctx.config.domain as string | undefined;
  if (!secret || !clientId || !domain) {
    return NextResponse.json({ error: "Shopify not fully configured." }, { status: 400 });
  }

  try {
    const rows = await probeShopifyChannels(domain, clientId, secret, 500);
    return NextResponse.json({ ordersSampled: 500, signatures: rows });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Probe failed." },
      { status: 500 },
    );
  }
}
