import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getConnection } from "@/lib/connections";
import { testGa4, Ga4Error } from "@/lib/adapters/ga4";

/** Manually select a GA4 property (when auto-detect found no match). */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });

  let body: { propertyId?: string; displayName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });
  }
  const propertyId = (body.propertyId ?? "").trim();
  if (!propertyId) {
    return NextResponse.json({ ok: false, message: "Property ID required." }, { status: 400 });
  }

  const ga4 = await getConnection(supabase, "ga4");
  if (!ga4?.secret_ref) {
    return NextResponse.json({ ok: false, message: "Connect Google Analytics first." }, { status: 400 });
  }

  try {
    const refreshToken = decryptSecret(ga4.secret_ref);
    const test = await testGa4(refreshToken, propertyId);
    await supabase.from("connections").upsert(
      {
        user_id: user.id,
        source: "ga4",
        status: "connected",
        config: { propertyId, displayName: body.displayName ?? null, autoMatched: false },
        secret_ref: encryptSecret(refreshToken),
      },
      { onConflict: "user_id,source" },
    );
    return NextResponse.json({
      ok: true,
      message: `Connected. ${test.sessions.toLocaleString()} sessions in the last 7 days.`,
      sessions: test.sessions,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Ga4Error ? err.message : "Test failed." },
      { status: 200 },
    );
  }
}

export async function DELETE() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await supabase.from("connections").delete().eq("source", "ga4");
  return NextResponse.json({ ok: true });
}
