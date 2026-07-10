import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { AgentEditor } from "@/components/agent/agent-editor";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConnection } from "@/lib/connections";
import { getCurrentOrg } from "@/lib/org";
import { getAgentProfile } from "@/lib/agent";

export default async function AgentPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { orgId, role } = await getCurrentOrg(supabase);
  const [profile, shopify] = await Promise.all([
    getAgentProfile(supabase, orgId),
    getConnection(supabase, orgId, "shopify"),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="app-main mx-auto w-full max-w-5xl flex-1 px-6 py-10 transition-[padding]">
        <h1 className="text-2xl font-semibold tracking-tight">Agent</h1>
        <p className="mt-1 max-w-2xl text-zinc-600 dark:text-zinc-400">
          The system prompt behind the Pulse assistant — what it knows about your
          business, customers, competitors, and ad strategy. Generated from your
          website and store data on first login; edit any layer or regenerate it.
          The assistant uses this to optimize ad spend across platforms.
        </p>
        <AgentEditor
          initialProfile={profile}
          isAdmin={role === "admin"}
          shopifyConnected={shopify?.status === "connected"}
        />
      </main>
    </div>
  );
}
