-- connections is org-scoped since 0002 (org_id + org-based RLS). The legacy
-- `user_id NOT NULL` column is now vestigial — its unique constraint and
-- "own rows" policy were dropped in 0002 — but it still blocks INSERTs from the
-- org-keyed upsert (which sets org_id, not user_id). Relax it so connecting a
-- brand-new source (e.g. reconnecting GA4 after its row was removed) succeeds.
--
-- (metric_cache.user_id is part of that table's primary key, so it stays NOT
-- NULL; the cache path is keyed differently and isn't affected here.)
alter table public.connections alter column user_id drop not null;
