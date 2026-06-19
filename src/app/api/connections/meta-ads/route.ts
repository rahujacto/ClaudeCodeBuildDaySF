import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import {
  getConnection,
  upsertConnection,
  updateConnectionConfig,
  deleteConnection,
} from "@/lib/connections";
import { requireAdminOrg } from "@/lib/org";
import { normalizeAdAccountId, testMetaConnection } from "@/lib/adapters/meta-ads";
import type { MetaAccount } from "@/lib/adapters/types";

/** Read accounts from a meta_ads config (with legacy single-account fallback). */
function readAccounts(config: Record<string, unknown> | undefined): MetaAccount[] {
  if (!config) return [];
  if (Array.isArray(config.accounts)) return config.accounts as MetaAccount[];
  if (config.adAccountId)
    return [
      {
        adAccountId: config.adAccountId as string,
        accountName: (config.accountName as string) ?? "",
        currency: (config.currency as string) ?? undefined,
      },
    ];
  return [];
}

/**
 * Add an ad account (POST {adAccountId, accessToken?}), or remove one
 * (POST {removeAccountId}). One shared ads_read token across accounts.
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

  let body: { adAccountId?: string; accessToken?: string; removeAccountId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });
  }

  const existing = await getConnection(supabase, org.orgId, "meta_ads");
  let accounts = readAccounts(existing?.config);
  const storedToken = existing?.secret_ref ? decryptSecret(existing.secret_ref) : null;

  // ── remove an account ──
  if (body.removeAccountId) {
    const removeId = normalizeAdAccountId(body.removeAccountId);
    accounts = accounts.filter((a) => a.adAccountId !== removeId);
    if (!accounts.length) {
      await deleteConnection(supabase, org.orgId, "meta_ads");
      return NextResponse.json({ ok: true, accounts: [] });
    }
    await updateConnectionConfig(supabase, org.orgId, "meta_ads", { accounts });
    return NextResponse.json({ ok: true, accounts });
  }

  // ── add / update an account ──
  const adAccountId = normalizeAdAccountId(body.adAccountId ?? "");
  const token = (body.accessToken ?? "").trim() || storedToken;
  if (!adAccountId) {
    return NextResponse.json({ ok: false, message: "Ad Account ID is required." }, { status: 400 });
  }
  if (!token) {
    return NextResponse.json(
      { ok: false, message: "Paste an access token (ads_read) to connect the first account." },
      { status: 400 },
    );
  }

  const result = await testMetaConnection(adAccountId, token);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 200 });
  }

  accounts = [
    ...accounts.filter((a) => a.adAccountId !== adAccountId),
    {
      adAccountId,
      accountName: result.accountName ?? `act_${adAccountId}`,
      currency: result.currency,
    },
  ];

  const { error } = await upsertConnection(supabase, org.orgId, "meta_ads", {
    status: "connected",
    config: { accounts },
    secret_ref: encryptSecret(token),
  });
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, message: result.message, accounts });
}

export async function DELETE() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const org = await requireAdminOrg(supabase);
  if (!org) return NextResponse.json({ ok: false }, { status: 403 });
  await deleteConnection(supabase, org.orgId, "meta_ads");
  return NextResponse.json({ ok: true });
}
