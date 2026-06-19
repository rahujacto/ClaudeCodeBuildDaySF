import { AppHeader } from "@/components/app-header";
import { TeamManager } from "@/components/team/team-manager";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentOrg, getOrgMembers, getOrgInvites } from "@/lib/org";

export default async function TeamPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { orgId, role } = await getCurrentOrg(supabase);
  const isAdmin = role === "admin";

  const [members, invites] = await Promise.all([
    getOrgMembers(supabase, orgId),
    isAdmin ? getOrgInvites(supabase, orgId) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="app-main mx-auto w-full max-w-5xl flex-1 px-6 py-10 transition-[padding]">
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          {isAdmin
            ? "Invite teammates to share your connected data. Admins manage connectors; members get view-only access to dashboards and the assistant."
            : "Everyone here shares the same connected data. Connectors are managed by your admins."}
        </p>

        <TeamManager
          isAdmin={isAdmin}
          currentUserId={user?.id ?? ""}
          initialMembers={members}
          initialInvites={invites}
        />
      </main>
    </div>
  );
}
