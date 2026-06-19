import type { SupabaseClient } from "@supabase/supabase-js";

export type OrgRole = "admin" | "member";
export type CurrentOrg = { orgId: string; role: OrgRole };

export type OrgMember = {
  user_id: string;
  email: string;
  role: OrgRole;
  created_at: string;
};
export type OrgInvite = { email: string; role: OrgRole; created_at: string };

/**
 * Resolve the signed-in user's current org + role. Claims any pending email
 * invites first, and creates a personal org (admin) if the user has none.
 */
export async function getCurrentOrg(supabase: SupabaseClient): Promise<CurrentOrg> {
  await supabase.rpc("claim_invites");

  const { data } = await supabase
    .from("org_members")
    .select("org_id, role")
    .order("created_at", { ascending: true });

  if (data && data.length) {
    return { orgId: data[0].org_id as string, role: data[0].role as OrgRole };
  }

  const { data: orgId } = await supabase.rpc("create_org", { p_name: "My Org" });
  return { orgId: orgId as string, role: "admin" };
}

/** Resolve org + require admin for connector writes. Returns null if not admin. */
export async function requireAdminOrg(
  supabase: SupabaseClient,
): Promise<{ orgId: string } | null> {
  const { orgId, role } = await getCurrentOrg(supabase);
  return role === "admin" ? { orgId } : null;
}

export async function getOrgMembers(
  supabase: SupabaseClient,
  orgId: string,
): Promise<OrgMember[]> {
  const { data } = await supabase.rpc("org_members_list", { p_org: orgId });
  return (data as OrgMember[] | null) ?? [];
}

export async function getOrgInvites(
  supabase: SupabaseClient,
  orgId: string,
): Promise<OrgInvite[]> {
  const { data } = await supabase.rpc("org_invites_list", { p_org: orgId });
  return (data as OrgInvite[] | null) ?? [];
}

export async function inviteMember(
  supabase: SupabaseClient,
  orgId: string,
  email: string,
  role: OrgRole,
) {
  return supabase.rpc("invite_member", { p_org: orgId, p_email: email, p_role: role });
}

export async function removeMember(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
) {
  return supabase.rpc("remove_member", { p_org: orgId, p_user: userId });
}

export async function setMemberRole(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  role: OrgRole,
) {
  return supabase.rpc("set_member_role", { p_org: orgId, p_user: userId, p_role: role });
}
