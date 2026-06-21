-- Connections/metric_cache are org-scoped since 0002 (org_id + org-based RLS).
-- The legacy `user_id NOT NULL` column is now vestigial — its unique constraint
-- and "own rows" policy were dropped in 0002 — but it still blocks INSERTs from
-- the org-keyed upsert (which sets org_id, not user_id). Relax it so connecting
-- a brand-new source (e.g. reconnecting GA4 after its row was removed) succeeds.
alter table public.connections   alter column user_id drop not null;
alter table public.metric_cache  alter column user_id drop not null;
