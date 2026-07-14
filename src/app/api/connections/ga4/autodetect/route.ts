import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getConnection, upsertConnection } from "@/lib/connections";
import { requireAdminOrg } from "@/lib/org";
import { fetchShopifyHosts } from "@/lib/adapters/shopify";
import {
  getAccessToken,
  listProperties,
  matchProperty,
  testGa4,
  Ga4Error,
} from "@/lib/adapters/ga4";
import { captureServer } from "@/lib/posthog-server";

/**
 * After GA4 OAuth, list the account's properties and try to auto-match the one
 * whose web stream matches the connected Shopify store's domain. On a match,
 * save it and verify with a live pull. Otherwise return candidates to pick from.
 */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const org = await requireAdminOrg(supabase);
  if (!org) return NextResponse.json({ error: "Only admins can manage connectors." }, { status: 403 });

  const ga4 = await getConnection(supabase, org.orgId, "ga4");
  if (!ga4?.secret_ref) {
    return NextResponse.json({ error: "GA4 is not connected." }, { status: 400 });
  }

  try {
    const refreshToken = decryptSecret(ga4.secret_ref);
    const token = await getAccessToken(refreshToken);
    const properties = await listProperties(token);

    // Gather the Shopify store's hosts for matching.
    let storeHosts: string[] = [];
    const shop = await getConnection(supabase, org.orgId, "shopify");
    if (shop?.status === "connected" && shop.secret_ref) {
      try {
        storeHosts = await fetchShopifyHosts(
          shop.config.domain as string,
          shop.config.clientId as string,
          decryptSecret(shop.secret_ref),
        );
      } catch {
        // matching is best-effort
      }
    }

    const matched = matchProperty(properties, storeHosts);
    const candidates = properties.map((p) => ({
      propertyId: p.propertyId,
      displayName: p.displayName,
      url: p.urls[0] ?? null,
    }));

    if (matched) {
      const test = await testGa4(refreshToken, matched.propertyId);
      await upsertConnection(supabase, org.orgId, "ga4", {
        status: "connected",
        config: {
          propertyId: matched.propertyId,
          displayName: matched.displayName,
          url: matched.urls[0] ?? null,
          autoMatched: true,
        },
        secret_ref: encryptSecret(refreshToken),
      });
      captureServer({
        distinctId: user.id,
        event: "connection_saved",
        properties: { source: "ga4", auto_matched: true },
      });
      return NextResponse.json({
        matched: {
          propertyId: matched.propertyId,
          displayName: matched.displayName,
          url: matched.urls[0] ?? null,
        },
        sessions: test.sessions,
        storeHosts,
        candidates,
      });
    }

    return NextResponse.json({ matched: null, storeHosts, candidates });
  } catch (err) {
    const message = err instanceof Ga4Error ? err.message : "Auto-detect failed.";
    captureServer({
      distinctId: user.id,
      event: "connection_save_failed",
      properties: { source: "ga4", reason: "autodetect_failed", message },
    });
    return NextResponse.json({ error: message }, { status: 200 });
  }
}
