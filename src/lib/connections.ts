import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "./crypto";
import type { AdapterContext, SourceId } from "./adapters/types";

export type ConnectionRow = {
  id: string;
  org_id: string;
  source: SourceId;
  status: string;
  config: Record<string, unknown>;
  secret_ref: string | null;
};

const COLS = "id,org_id,source,status,config,secret_ref";

/** Fetch an org's connection row for a source (RLS: org members can read). */
export async function getConnection(
  supabase: SupabaseClient,
  orgId: string,
  source: SourceId,
): Promise<ConnectionRow | null> {
  const { data } = await supabase
    .from("connections")
    .select(COLS)
    .eq("org_id", orgId)
    .eq("source", source)
    .maybeSingle();
  return (data as ConnectionRow | null) ?? null;
}

/** Upsert a connection for the org (RLS: only org admins can write). */
export async function upsertConnection(
  supabase: SupabaseClient,
  orgId: string,
  source: SourceId,
  fields: { status: string; config: Record<string, unknown>; secret_ref: string | null },
) {
  return supabase
    .from("connections")
    .upsert({ org_id: orgId, source, ...fields }, { onConflict: "org_id,source" });
}

export async function updateConnectionConfig(
  supabase: SupabaseClient,
  orgId: string,
  source: SourceId,
  config: Record<string, unknown>,
) {
  return supabase
    .from("connections")
    .update({ config })
    .eq("org_id", orgId)
    .eq("source", source);
}

export async function deleteConnection(
  supabase: SupabaseClient,
  orgId: string,
  source: SourceId,
) {
  return supabase.from("connections").delete().eq("org_id", orgId).eq("source", source);
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
