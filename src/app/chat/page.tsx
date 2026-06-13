import { AppHeader } from "@/components/app-header";
import { Chat } from "@/components/chat/chat";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConnection } from "@/lib/connections";

export default async function ChatPage() {
  const supabase = await createSupabaseServerClient();
  const shopify = await getConnection(supabase, "shopify");
  const connected = shopify?.status === "connected";

  return (
    <div className="flex h-[100dvh] flex-col">
      <AppHeader />
      <Chat shopifyConnected={connected} />
    </div>
  );
}
