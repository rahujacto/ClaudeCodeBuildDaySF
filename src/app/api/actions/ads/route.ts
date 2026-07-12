import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Simulate API delay to Google Ads/Meta
    await new Promise((resolve) => setTimeout(resolve, 1500));

    return NextResponse.json({
        ok: true,
        message: `Successfully adjusted budget for ${body.campaign} to $${body.recommended_budget}.`
    });
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
}
