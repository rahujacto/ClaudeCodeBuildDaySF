import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { requireAdminOrg } from "@/lib/org";
import { upsertConnection } from "@/lib/connections";
import { exchangeCodeForTokens } from "@/lib/adapters/ga4";

/** GA4 OAuth callback: store the refresh token, then let the card auto-detect. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const oauthError = searchParams.get("error");

  if (oauthError || !code) {
    return NextResponse.redirect(`${origin}/connections?ga4=error`);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login?next=/connections`);
  const org = await requireAdminOrg(supabase);
  if (!org) return NextResponse.redirect(`${origin}/connections?ga4=forbidden`);

  try {
    const tokens = await exchangeCodeForTokens(code, `${origin}/api/oauth/ga4/callback`);
    if (!tokens.refresh_token) {
      return NextResponse.redirect(`${origin}/connections?ga4=norefresh`);
    }

    // Store the refresh token; property is resolved next via auto-detect.
    const { error } = await upsertConnection(supabase, org.orgId, "ga4", {
      status: "connected",
      config: {},
      secret_ref: encryptSecret(tokens.refresh_token),
    });
    if (error) return NextResponse.redirect(`${origin}/connections?ga4=storefail`);

    return NextResponse.redirect(`${origin}/connections?ga4=connected`);
  } catch {
    return NextResponse.redirect(`${origin}/connections?ga4=error`);
  }
}
