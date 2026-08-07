import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { requireAdminOrg } from "@/lib/org";
import { upsertConnection, deleteConnection } from "@/lib/connections";
import {
  listInstagramAccounts,
  normalizeIgUserId,
  testInstagramConnection,
  InstagramTokenExpiredError,
} from "@/lib/adapters/instagram";
import { captureServer } from "@/lib/posthog-server";

/**
 * Save & Test for Instagram (organic social). The client only ever pastes a
 * token — if no account ID came with it, we auto-detect the linked Instagram
 * Business account(s) from the token itself (via the Facebook Pages it can
 * see). Multiple accounts (e.g. a token that manages several client Pages)
 * come back as `needsSelection` for the client to pick from. The token is
 * verified live, then encrypted; the account ID is non-secret and stored in
 * `config`.
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
  if (!accessToken) {
    return NextResponse.json({ ok: false, message: "Enter your Instagram access token." }, { status: 400 });
  }

  let igUserId = normalizeIgUserId(body.igUserId ?? "");
  if (!igUserId) {
    try {
      const candidates = await listInstagramAccounts(accessToken);
      if (candidates.length === 0) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "No Instagram Business account found for this token. Make sure the account is a Business/Creator account linked to a Facebook Page you admin, and the token includes instagram_basic + instagram_manage_insights.",
          },
          { status: 200 },
        );
      }
      if (candidates.length > 1) {
        return NextResponse.json({
          ok: false,
          needsSelection: true,
          candidates,
          message: `Found ${candidates.length} Instagram accounts on this token — pick one.`,
        });
      }
      igUserId = candidates[0].igUserId;
    } catch (err) {
      captureServer({
        distinctId: user.id,
        event: "connection_save_failed",
        properties: { source: "instagram", reason: "autodetect_failed" },
      });
      return NextResponse.json(
        {
          ok: false,
          message:
            err instanceof InstagramTokenExpiredError
              ? err.message
              : "Couldn't look up Instagram accounts for this token. Check it includes instagram_basic + instagram_manage_insights.",
        },
        { status: 200 },
      );
    }
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
