import { NextResponse, type NextRequest } from "next/server";
import { GA4_SCOPE, googleClientCreds } from "@/lib/adapters/ga4";

/** Kick off the GA4 data-OAuth consent (separate from Google login). */
export async function GET(request: NextRequest) {
  const { origin } = new URL(request.url);
  const { id } = googleClientCreds();
  const redirectUri = `${origin}/api/oauth/ga4/callback`;

  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GA4_SCOPE,
    access_type: "offline",
    // select_account → always show the Google account chooser (so you can pick
    // a different account, e.g. the one with access to the store's GA4);
    // consent → guarantee a refresh_token.
    prompt: "select_account consent",
    include_granted_scopes: "true",
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  );
}
