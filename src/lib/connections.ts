import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "./crypto";
import type { AdapterContext, SourceId } from "./adapters/types";

export type ConnectionRow = {
  id: string;
  user_id: string;
  source: SourceId;
  status: string;
  config: Record<string, unknown>;
  secret_ref: string | null;
};

/** Fetch the signed-in user's connection row for a source (RLS-scoped). */
export async function getConnection(
  supabase: SupabaseClient,
  source: SourceId,
): Promise<ConnectionRow | null> {
  const { data } = await supabase
    .from("connections")
    .select("id,user_id,source,status,config,secret_ref")
    .eq("source", source)
    .maybeSingle();
  return (data as ConnectionRow | null) ?? null;
}

export async function listConnections(
  supabase: SupabaseClient,
): Promise<ConnectionRow[]> {
  const { data } = await supabase
    .from("connections")
    .select("id,user_id,source,status,config,secret_ref");
  return (data as ConnectionRow[] | null) ?? [];
}

/**
 * Build an AdapterContext from a stored connection row. The secret is
 * decrypted lazily and only on the server.
 */
export function adapterContextFromRow(
  userId: string,
  row: ConnectionRow | null,
): AdapterContext {
  return {
    userId,
    config: row?.config ?? {},
    getSecret: async () =>
      row?.secret_ref ? decryptSecret(row.secret_ref) : null,
  };
}
