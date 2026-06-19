import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { requireAdminOrg } from "@/lib/org";
import { upsertConnection, deleteConnection } from "@/lib/connections";

/**
 * Google Ads connector. Collects the API fields (developer token, client
 * id/secret, customer id) and marks the source SEEDED — live pulls are deferred
 * until the developer token has Google Ads API Basic Access (README §2).
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

  let body: {
    customerId?: string;
    developerToken?: string;
    clientId?: string;
    clientSecret?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });
  }

  const customerId = (body.customerId ?? "").trim();
  if (!customerId) {
    return NextResponse.json(
      { ok: false, message: "Customer ID is required." },
      { status: 400 },
    );
  }

  // Encrypt the sensitive fields together (used once live access is granted).
  const secretPayload = JSON.stringify({
    developerToken: (body.developerToken ?? "").trim(),
    clientSecret: (body.clientSecret ?? "").trim(),
  });

  const { error } = await upsertConnection(supabase, org.orgId, "google_ads", {
    status: "seeded",
    config: { customerId, clientId: (body.clientId ?? "").trim() },
    secret_ref: encryptSecret(secretPayload),
  });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    message: "Saved. Showing seeded campaign data (live pulls deferred).",
  });
}

export async function DELETE() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const org = await requireAdminOrg(supabase);
  if (!org) return NextResponse.json({ ok: false }, { status: 403 });
  await deleteConnection(supabase, org.orgId, "google_ads");
  return NextResponse.json({ ok: true });
}
