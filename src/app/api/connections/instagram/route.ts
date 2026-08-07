import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { requireAdminOrg } from "@/lib/org";
import { upsertConnection, deleteConnection } from "@/lib/connections";
import { normalizeIgUserId, testInstagramConnection } from "@/lib/adapters/instagram";
import { captureServer } from "@/lib/posthog-server";

/**
 * Save & Test for Instagram (organic social). The access token is verified
 * live against the given IG Business Account ID, then encrypted; the account
 * ID is non-secret and stored in `config`.
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

  let body: { accessToken?: string; igUserId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });
  }

  const accessToken = (body.accessToken ?? "").trim();
  const igUserId = normalizeIgUserId(body.igUserId ?? "");
  if (!igUserId) {
    return NextResponse.json({ ok: false, message: "Enter your Instagram Business Account ID." }, { status: 400 });
  }
  if (!accessToken) {
    return NextResponse.json({ ok: false, message: "Enter your Instagram access token." }, { status: 400 });
  }

  const test = await testInstagramConnection(accessToken, igUserId);
  if (!test.ok) {
    captureServer({
      distinctId: user.id,
      event: "connection_save_failed",
      properties: { source: "instagram", reason: "verification_failed", message: test.message },
    });
    return NextResponse.json({ ok: false, message: test.message }, { status: 200 });
  }

  const { error } = await upsertConnection(supabase, org.orgId, "instagram", {
    status: "connected",
    config: { igUserId, username: test.username ?? "" },
    secret_ref: encryptSecret(accessToken),
  });
  if (error) {
    captureServer({
      distinctId: user.id,
      event: "connection_save_failed",
      properties: { source: "instagram", reason: "storage_failed" },
    });
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  captureServer({
    distinctId: user.id,
    event: "connection_saved",
    properties: { source: "instagram" },
  });
  return NextResponse.json({ ok: true, message: test.message, username: test.username });
}

export async function DELETE() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const org = await requireAdminOrg(supabase);
  if (!org) return NextResponse.json({ ok: false }, { status: 403 });
  await deleteConnection(supabase, org.orgId, "instagram");
  captureServer({ distinctId: user.id, event: "connection_deleted", properties: { source: "instagram" } });
  return NextResponse.json({ ok: true });
}
