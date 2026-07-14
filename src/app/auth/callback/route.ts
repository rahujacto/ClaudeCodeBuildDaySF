import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { captureServer } from "@/lib/posthog-server";

/** OAuth callback: exchange the code for a session, then redirect. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const userId = data.user?.id;
      if (userId) {
        captureServer({
          distinctId: userId,
          event: "user_authenticated",
          properties: { provider: "google", $set: { email: data.user?.email } },
        });
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
