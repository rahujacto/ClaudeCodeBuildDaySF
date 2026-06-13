import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import {
  normalizeShopDomain,
  testShopifyConnection,
} from "@/lib/adapters/shopify";

/**
 * Save & Test for the Shopify connection.
 * 1. Verify the user is signed in.
 * 2. Test the credentials by pulling ONE real order via the GraphQL Admin API.
 * 3. Only on success: encrypt the token and upsert the connection row.
 *
 * The raw token is never returned to the client, never logged.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });
  }

  let body: { domain?: string; token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });
  }

  const domainRaw = (body.domain ?? "").trim();
  const token = (body.token ?? "").trim();
  if (!domainRaw || !token) {
    return NextResponse.json(
      { ok: false, message: "Store domain and access token are required." },
      { status: 400 },
    );
  }

  const domain = normalizeShopDomain(domainRaw);

  // Live verification against Shopify before we store anything.
  const result = await testShopifyConnection(domain, token);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 200 });
  }

  const { error } = await supabase.from("connections").upsert(
    {
      user_id: user.id,
      source: "shopify",
      status: "connected",
      config: { domain },
      secret_ref: encryptSecret(token),
    },
    { onConflict: "user_id,source" },
  );

  if (error) {
    return NextResponse.json(
      { ok: false, message: `Saved test passed, but storing failed: ${error.message}` },
      { status: 500 },
    );
  }

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
  await supabase.from("connections").delete().eq("source", "shopify");
  return NextResponse.json({ ok: true });
}
