import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { normalizeAdAccountId, testMetaConnection } from "@/lib/adapters/meta-ads";

/**
 * Save & Test for Meta Ads (live Marketing API). Verify the token + ad account
 * by reading the account, then store the token encrypted.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });
  }

  let body: { adAccountId?: string; accessToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });
  }

  const adAccountId = normalizeAdAccountId(body.adAccountId ?? "");
  const accessToken = (body.accessToken ?? "").trim();
  if (!adAccountId || !accessToken) {
    return NextResponse.json(
      { ok: false, message: "Ad Account ID and access token are required." },
      { status: 400 },
    );
  }

  const result = await testMetaConnection(adAccountId, accessToken);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 200 });
  }

  const { error } = await supabase.from("connections").upsert(
    {
      user_id: user.id,
      source: "meta_ads",
      status: "connected",
      config: {
        adAccountId,
        accountName: result.accountName ?? null,
        currency: result.currency ?? null,
      },
      secret_ref: encryptSecret(accessToken),
    },
    { onConflict: "user_id,source" },
  );

  if (error) {
    return NextResponse.json(
      { ok: false, message: `Test passed, but storing failed: ${error.message}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, message: result.message, accountName: result.accountName });
}

export async function DELETE() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await supabase.from("connections").delete().eq("source", "meta_ads");
  return NextResponse.json({ ok: true });
}
