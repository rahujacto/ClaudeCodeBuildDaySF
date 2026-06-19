import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  requireAdminOrg,
  inviteMember,
  removeMember,
  setMemberRole,
  getOrgMembers,
  getOrgInvites,
  type OrgRole,
} from "@/lib/org";

/** Admin-only team actions: invite / remove / change-role. */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });

  const org = await requireAdminOrg(supabase);
  if (!org) {
    return NextResponse.json({ ok: false, message: "Only admins can manage the team." }, { status: 403 });
  }

  let body: { action?: string; email?: string; userId?: string; role?: OrgRole };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });
  }

  const role: OrgRole = body.role === "admin" ? "admin" : "member";

  try {
    if (body.action === "invite") {
      const email = (body.email ?? "").trim();
      if (!email || !email.includes("@")) {
        return NextResponse.json({ ok: false, message: "Enter a valid email." }, { status: 400 });
      }
      await inviteMember(supabase, org.orgId, email, role);
    } else if (body.action === "remove") {
      if (body.userId === user.id) {
        return NextResponse.json({ ok: false, message: "You can't remove yourself." }, { status: 400 });
      }
      await removeMember(supabase, org.orgId, body.userId ?? "");
    } else if (body.action === "role") {
      await setMemberRole(supabase, org.orgId, body.userId ?? "", role);
    } else {
      return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Action failed." },
      { status: 200 },
    );
  }

  const [members, invites] = await Promise.all([
    getOrgMembers(supabase, org.orgId),
    getOrgInvites(supabase, org.orgId),
  ]);
  return NextResponse.json({ ok: true, members, invites });
}
