import { AppHeader } from "@/components/app-header";
import { ShopifyCard } from "@/components/connections/shopify-card";
import { Ga4Card } from "@/components/connections/ga4-card";
import { GoogleAdsCard } from "@/components/connections/google-ads-card";
import { MetaAdsCard } from "@/components/connections/meta-ads-card";
import { BrandIcon } from "@/components/brand-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConnection } from "@/lib/connections";
import { getCurrentOrg } from "@/lib/org";

/** Turn a GA4 OAuth callback code (+ raw reason) into a human message. */
function ga4ErrorMessage(code: string, reason?: string): string {
  const detail = reason ? decodeURIComponent(reason) : "";
  switch (code) {
    case "forbidden":
      return "Only an admin can connect Google Analytics.";
    case "norefresh":
      return "Google didn't return a refresh token. Remove the app at myaccount.google.com/permissions, then reconnect.";
    case "storefail":
      return detail
        ? `Signed in, but couldn't save the connection: ${detail}`
        : "Signed in, but couldn't save the connection. Please retry.";
    case "error":
    default:
      return detail
        ? `Google sign-in didn't complete: ${detail}`
        : "Google sign-in didn't complete. Please try again.";
  }
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ ga4?: string; reason?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { orgId, role } = await getCurrentOrg(supabase);
  const isAdmin = role === "admin";

  const shopify = await getConnection(supabase, orgId, "shopify");
  const ga4 = await getConnection(supabase, orgId, "ga4");
  const googleAds = await getConnection(supabase, orgId, "google_ads");
  const metaAds = await getConnection(supabase, orgId, "meta_ads");

  const ga4OauthError =
    sp.ga4 && sp.ga4 !== "connected" ? ga4ErrorMessage(sp.ga4, sp.reason) : undefined;

  const metaAccounts = Array.isArray(metaAds?.config?.accounts)
    ? (metaAds.config.accounts as { adAccountId: string; accountName: string }[])
    : metaAds?.config?.adAccountId
      ? [
          {
            adAccountId: metaAds.config.adAccountId as string,
            accountName: (metaAds.config.accountName as string) ?? "",
          },
        ]
      : [];

  // Read-only view for members.
  const statuses: { slug: string; name: string; label: string; on: boolean }[] = [
    { slug: "shopify", name: "Shopify", on: shopify?.status === "connected", label: shopify?.status === "connected" ? "Connected" : "Not connected" },
    { slug: "googleanalytics", name: "Google Analytics", on: ga4?.status === "connected", label: ga4?.status === "connected" ? "Connected" : "Not connected" },
    { slug: "googleads", name: "Google Ads", on: googleAds?.status === "seeded" || googleAds?.status === "connected", label: googleAds?.status === "connected" ? "Live" : googleAds?.status ? "Seeded" : "Not connected" },
    { slug: "meta", name: "Meta Ads", on: metaAccounts.length > 0, label: metaAccounts.length ? `${metaAccounts.length} account${metaAccounts.length > 1 ? "s" : ""}` : "Not connected" },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="app-main mx-auto w-full max-w-5xl flex-1 px-6 py-10 transition-[padding]">
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          {isAdmin
            ? "Bring your own keys. Secrets are encrypted before they touch the database and only ever decrypted on the server."
            : "These data sources are managed by your org's admins. You can view all the data on the dashboard and ask the assistant."}
        </p>

        {isAdmin ? (
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
            <GoogleAdsCard
              initialSeeded={googleAds?.status === "seeded" || googleAds?.status === "connected"}
              initialConnected={googleAds?.status === "connected"}
              initialCustomerId={(googleAds?.config?.customerId as string) ?? ""}
              initialLoginCustomerId={(googleAds?.config?.loginCustomerId as string) ?? ""}
            />
            <MetaAdsCard initialAccounts={metaAccounts} />
          </div>
        ) : (
          <div className="mt-8 grid gap-3">
            {statuses.map((s) => (
              <Card key={s.slug}>
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-3">
                    <BrandIcon slug={s.slug} label={s.name} />
                    <span className="font-medium">{s.name}</span>
                  </div>
                  <Badge variant={s.on ? "default" : "secondary"}>{s.label}</Badge>
                </CardContent>
              </Card>
            ))}
            <p className="mt-2 text-sm text-zinc-500">
              Need to change a connector? Ask an admin on your{" "}
              <a href="/team" className="font-medium text-foreground hover:underline">
                team
              </a>
              .
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
