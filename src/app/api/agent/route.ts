import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { getAgentProfile, saveAgentProfile, type AgentLayers } from "@/lib/agent";

/** GET — the org's agent profile (null if never generated). */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { orgId, role } = await getCurrentOrg(supabase);
  const profile = await getAgentProfile(supabase, orgId);
  return NextResponse.json({ profile, isAdmin: role === "admin" });
}

/** PUT — save hand-edited layers (admins only). */
export async function PUT(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { orgId, role } = await getCurrentOrg(supabase);
  if (role !== "admin") {
    return NextResponse.json({ error: "Only admins can edit the agent." }, { status: 403 });
  }

  let body: { layers?: AgentLayers };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!body.layers || typeof body.layers !== "object") {
    return NextResponse.json({ error: "Missing layers." }, { status: 400 });
  }

  const { error } = await saveAgentProfile(supabase, orgId, user.id, body.layers, false);
  if (error) return NextResponse.json({ error }, { status: 500 });
  const profile = await getAgentProfile(supabase, orgId);
  return NextResponse.json({ profile });
}
