import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { requireAdminOrg } from "@/lib/org";
import { upsertConnection, deleteConnection } from "@/lib/connections";
import { fetchGoogleAdsLive } from "@/lib/adapters/google-ads-live";
import { rangeForPreset } from "@/lib/dates";
import { captureServer } from "@/lib/posthog-server";

/**
 * Google Ads connector. Stores the API credentials (encrypted) and, when a
 * refresh token is present, attempts a live pull to flip the source to
 * `connected`. Without live creds — or if the developer token still only has
 * Test Access — it stays `seeded` and the product runs on realistic seeded
 * campaign data (README §2).
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
    loginCustomerId?: string;
    developerToken?: string;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
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

  const loginCustomerId = (body.loginCustomerId ?? "").trim();
  const clientId = (body.clientId ?? "").trim();
  const developerToken = (body.developerToken ?? "").trim();
  const clientSecret = (body.clientSecret ?? "").trim();
  const refreshToken = (body.refreshToken ?? "").trim();

  // Encrypt the sensitive fields together. Decryption happens only server-side.
  const secretPayload = JSON.stringify({ developerToken, clientSecret, refreshToken });
  const config = { customerId, clientId, loginCustomerId };

  // If we have everything needed for a live pull, test it now. Success → flip to
  // `connected` (real data). Failure (e.g. token still on Test Access) → keep
  // the encrypted creds but stay `seeded`, surfacing Google's literal reason.
  const effectiveClientId = clientId || process.env.GOOGLE_OAUTH_CLIENT_ID || "";
  const effectiveClientSecret = clientSecret || process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
  const canTryLive = Boolean(developerToken && refreshToken && effectiveClientId && effectiveClientSecret);

  let status: "seeded" | "connected" = "seeded";
  let liveError: string | null = null;
  if (canTryLive) {
    try {
      await fetchGoogleAdsLive(
        {
          customerId,
          loginCustomerId,
          clientId: effectiveClientId,
          clientSecret: effectiveClientSecret,
          developerToken,
          refreshToken,
        },
        rangeForPreset("7d"),
      );
      status = "connected";
    } catch (err) {
      liveError = err instanceof Error ? err.message : "Live pull failed.";
    }
  }

  const { error } = await upsertConnection(supabase, org.orgId, "google_ads", {
    status,
    config,
    secret_ref: encryptSecret(secretPayload),
  });

  if (error) {
    captureServer({
      distinctId: user.id,
      event: "connection_save_failed",
      properties: { source: "google_ads", reason: "storage_failed" },
    });
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  captureServer({
    distinctId: user.id,
    event: "connection_saved",
    properties: {
      source: "google_ads",
      live: status === "connected",
      ...(liveError ? { live_error: liveError } : {}),
    },
  });

  if (status === "connected") {
    return NextResponse.json({ ok: true, live: true, message: "Live Google Ads connected ✓" });
  }
  return NextResponse.json({
    ok: true,
    live: false,
    message: liveError
      ? `Saved, but live pull failed — showing seeded data. ${liveError}`
      : canTryLive
        ? "Saved. Showing seeded campaign data."
        : "Saved. Add a refresh token to go live; showing seeded campaign data for now.",
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
  captureServer({ distinctId: user.id, event: "connection_deleted", properties: { source: "google_ads" } });
  return NextResponse.json({ ok: true });
}
