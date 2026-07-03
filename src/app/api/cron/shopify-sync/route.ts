import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runShopifySync } from "@/lib/shopify-cache";

export const maxDuration = 60;

/**
 * Cron (every 5 min, see vercel.json): advance the Shopify Postgres cache for
 * every org with a connected store — backfill first, then incremental
 * (updated_at) refresh so refunds/edits to old orders stay reconciled.
 *
 * Auth: when CRON_SECRET is set, Vercel Cron sends it as a Bearer token and we
 * require it. Writes use the service role (no user session in a cron).
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is not configured." },
      { status: 503 },
    );
  }
  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: conns, error } = await sb
    .from("connections")
    .select("org_id")
    .eq("source", "shopify")
    .eq("status", "connected");
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  const orgs = [...new Set((conns ?? []).map((c) => c.org_id as string))];
  const budget = Math.max(10_000, Math.floor(45_000 / Math.max(1, orgs.length)));
  const results = [];
  for (const orgId of orgs) {
    results.push({ orgId, ...(await runShopifySync(sb, orgId, budget)) });
  }
  return NextResponse.json({ ok: true, orgs: orgs.length, results });
}
