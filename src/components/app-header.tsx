import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConnection } from "@/lib/connections";
import { getCurrentOrg } from "@/lib/org";
import { Button } from "@/components/ui/button";
import { ChatDock } from "@/components/chat/chat-dock";

export async function AppHeader() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let connected = false;
  if (user) {
    const { orgId } = await getCurrentOrg(supabase);
    const shopify = await getConnection(supabase, orgId, "shopify");
    connected = shopify?.status === "connected";
  }

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-black/80">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
              <span className="size-2 rounded-full bg-emerald-500" />
              Pulse
            </Link>
            <nav className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
              <Link href="/dashboard" className="hover:text-foreground">
                Dashboard
              </Link>
              <Link href="/connections" className="hover:text-foreground">
                Connections
              </Link>
              <Link href="/team" className="hover:text-foreground">
                Team
              </Link>
              <Link href="/release-notes" className="hover:text-foreground">
                What&apos;s new
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {user?.email && (
              <span className="hidden text-sm text-zinc-500 sm:inline">
                {user.email}
              </span>
            )}
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <ChatDock shopifyConnected={connected} />
    </>
  );
}
