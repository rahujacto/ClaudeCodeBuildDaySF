import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { requireAdminOrg } from "@/lib/org";
import { upsertConnection, deleteConnection } from "@/lib/connections";
import { testTiktokConnection } from "@/lib/adapters/tiktok";
import { captureServer } from "@/lib/posthog-server";

/**
 * Save & Test for TikTok (organic social). Stored under the "tiktok" source.
 * The account is derived from the token itself — no separate ID to enter.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });

  const org = await requireAdminOrg(supabase);
  if (!org) {
    return NextResponse.json(
      { ok: false, message: "Only admins can manage connectors." },
      { status: 403 },
    );
  }

  let body: { accessToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });
  }

  const accessToken = (body.accessToken ?? "").trim();
  if (!accessToken) {
    return NextResponse.json({ ok: false, message: "Enter your TikTok access token." }, { status: 400 });
  }

  const test = await testTiktokConnection(accessToken);
  if (!test.ok) {
    captureServer({
      distinctId: user.id,
      event: "connection_save_failed",
      properties: { source: "tiktok", reason: "verification_failed", message: test.message },
    });
    return NextResponse.json({ ok: false, message: test.message }, { status: 200 });
  }

  const { error } = await upsertConnection(supabase, org.orgId, "tiktok", {
    status: "connected",
    config: { displayName: test.displayName ?? "" },
    secret_ref: encryptSecret(accessToken),
  });
  if (error) {
    captureServer({
      distinctId: user.id,
      event: "connection_save_failed",
      properties: { source: "tiktok", reason: "storage_failed" },
    });
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  captureServer({
    distinctId: user.id,
    event: "connection_saved",
    properties: { source: "tiktok" },
  });
  return NextResponse.json({ ok: true, message: test.message, displayName: test.displayName });
}

export async function DELETE() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const org = await requireAdminOrg(supabase);
  if (!org) return NextResponse.json({ ok: false }, { status: 403 });
  await deleteConnection(supabase, org.orgId, "tiktok");
  captureServer({ distinctId: user.id, event: "connection_deleted", properties: { source: "tiktok" } });
  return NextResponse.json({ ok: true });
}
