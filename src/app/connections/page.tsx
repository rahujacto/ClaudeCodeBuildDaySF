import { AppHeader } from "@/components/app-header";
import { ShopifyCard } from "@/components/connections/shopify-card";
import { Ga4Card } from "@/components/connections/ga4-card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConnection } from "@/lib/connections";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ ga4?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const shopify = await getConnection(supabase, "shopify");
  const ga4 = await getConnection(supabase, "ga4");

  const ga4OauthError =
    sp.ga4 && sp.ga4 !== "connected" ? sp.ga4 : undefined;

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="app-main mx-auto w-full max-w-3xl flex-1 px-6 py-10 transition-[padding]">
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Bring your own keys. Secrets are encrypted before they touch the
          database and only ever decrypted on the server.
        </p>

        <div className="mt-8 grid gap-4">
          <ShopifyCard
            initialStatus={shopify?.status === "connected" ? "connected" : "disconnected"}
            initialDomain={(shopify?.config?.domain as string) ?? ""}
            initialClientId={(shopify?.config?.clientId as string) ?? ""}
          />
          <Ga4Card
            connected={ga4?.status === "connected"}
            propertyId={(ga4?.config?.propertyId as string) ?? undefined}
            displayName={(ga4?.config?.displayName as string) ?? undefined}
            autoMatched={Boolean(ga4?.config?.autoMatched)}
            oauthError={ga4OauthError}
          />
        </div>
      </main>
    </div>
  );
}
