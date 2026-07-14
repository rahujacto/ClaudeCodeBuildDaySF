import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { requireAdminOrg } from "@/lib/org";
import { upsertConnection, deleteConnection } from "@/lib/connections";
import { testMailchimpConnection } from "@/lib/adapters/mailchimp";
import { captureServer } from "@/lib/posthog-server";

/**
 * Save & Test for Mailchimp (email marketing). Stored under the generic "email"
 * source with provider=mailchimp. The API key is verified live, then encrypted;
 * it's never returned to the client or logged.
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

  let body: { apiKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });
  }

  const apiKey = (body.apiKey ?? "").trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, message: "Enter your Mailchimp API key." }, { status: 400 });
  }

  const test = await testMailchimpConnection(apiKey);
  if (!test.ok) {
    captureServer({
      distinctId: user.id,
      event: "connection_save_failed",
      properties: { source: "email", reason: "verification_failed", message: test.message },
    });
    return NextResponse.json({ ok: false, message: test.message }, { status: 200 });
  }

  const { error } = await upsertConnection(supabase, org.orgId, "email", {
    status: "connected",
    config: {
      provider: "mailchimp",
      serverPrefix: test.serverPrefix,
      accountName: test.accountName ?? "",
    },
    secret_ref: encryptSecret(apiKey),
  });
  if (error) {
    captureServer({
      distinctId: user.id,
      event: "connection_save_failed",
      properties: { source: "email", reason: "storage_failed" },
    });
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  captureServer({
    distinctId: user.id,
    event: "connection_saved",
    properties: { source: "email", provider: "mailchimp" },
  });
  return NextResponse.json({ ok: true, message: test.message, accountName: test.accountName });
}

export async function DELETE() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const org = await requireAdminOrg(supabase);
  if (!org) return NextResponse.json({ ok: false }, { status: 403 });
  await deleteConnection(supabase, org.orgId, "email");
  captureServer({ distinctId: user.id, event: "connection_deleted", properties: { source: "email" } });
  return NextResponse.json({ ok: true });
}
