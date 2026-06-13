import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConnection } from "@/lib/connections";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const shopify = await getConnection(supabase, "shopify");
  const connected = shopify?.status === "connected";

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome{user?.email ? `, ${user.email.split("@")[0]}` : ""}.
        </h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Your AI analyst is almost ready. Connect a data source, then ask it
          anything.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Shopify</CardTitle>
                {connected ? (
                  <Badge>Connected</Badge>
                ) : (
                  <Badge variant="secondary">Not connected</Badge>
                )}
              </div>
              <CardDescription>
                {connected
                  ? `Live: ${String(shopify?.config.domain ?? "")}`
                  : "Connect your store to pull live revenue, orders, and AOV."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button size="sm" render={<Link href="/connections" />}>
                {connected ? "Manage connection" : "Connect Shopify"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ask your analyst</CardTitle>
              <CardDescription>
                Natural-language questions, answered with real tool calls over
                your data. (Coming in the next build step.)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button size="sm" variant="outline" disabled>
                Chat — coming next
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
