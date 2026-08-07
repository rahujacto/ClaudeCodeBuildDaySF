-- 0011 — Instagram + TikTok connectors (organic social metrics).
-- Same connections/metric_cache tables as every other source; just widen the
-- `source` check constraint to accept the two new values.
alter table public.connections drop constraint if exists connections_source_check;
alter table public.connections add constraint connections_source_check
  check (source in ('shopify','ga4','google_ads','meta_ads','email','instagram','tiktok'));
