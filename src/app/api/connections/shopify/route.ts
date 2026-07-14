import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { requireAdminOrg } from "@/lib/org";
import { upsertConnection, deleteConnection } from "@/lib/connections";
import {
  normalizeShopDomain,
  testShopifyConnection,
} from "@/lib/adapters/shopify";
import { captureServer } from "@/lib/posthog-server";

/**
 * Save & Test for the Shopify connection (Dev Dashboard client-credentials app).
 * 1. Verify the user is signed in.
 * 2. Mint a token from Client ID + secret and pull ONE real order to verify.
 * 3. Only on success: store domain + Client ID (config) and the encrypted
 *    Client secret. A fresh access token is minted server-side on demand.
 *
 * The Client secret is never returned to the client, never logged.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });
  }
  const org = await requireAdminOrg(supabase);
  if (!org) {
    return NextResponse.json(
      { ok: false, message: "Only admins can manage connectors." },
      { status: 403 },
    );
  }

  let body: { domain?: string; clientId?: string; clientSecret?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });
  }

  const domainRaw = (body.domain ?? "").trim();
  const clientId = (body.clientId ?? "").trim();
  const clientSecret = (body.clientSecret ?? "").trim();
  if (!domainRaw || !clientId || !clientSecret) {
    return NextResponse.json(
      { ok: false, message: "Store domain, Client ID, and Client secret are all required." },
      { status: 400 },
    );
  }

  // Live verification (mint + one-order pull) before we store anything.
  const result = await testShopifyConnection(domainRaw, clientId, clientSecret);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 200 });
  }

  const domain = result.canonicalDomain ?? normalizeShopDomain(domainRaw);

  const { error } = await upsertConnection(supabase, org.orgId, "shopify", {
    status: "connected",
    config: { domain, clientId },
    secret_ref: encryptSecret(clientSecret),
  });

  if (error) {
    return NextResponse.json(
      { ok: false, message: `Test passed, but storing failed: ${error.message}` },
      { status: 500 },
    );
  }

  captureServer({ distinctId: user.id, event: "shopify_connection_saved_server", properties: { domain } });

  return NextResponse.json({
    ok: true,
    message: result.message,
    sample: result.sample,
    domain,
  });
}

/** Disconnect Shopify. */
export async function DELETE() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });
  }
  const org = await requireAdminOrg(supabase);
  if (!org) return NextResponse.json({ ok: false }, { status: 403 });
  await deleteConnection(supabase, org.orgId, "shopify");
  captureServer({ distinctId: user.id, event: "shopify_connection_deleted_server" });
  return NextResponse.json({ ok: true });
}
