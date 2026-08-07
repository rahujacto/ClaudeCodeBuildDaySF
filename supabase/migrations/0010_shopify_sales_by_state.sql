-- 0010: Sales-by-state breakdown on the Shopify day cache.
--
-- Adds a per-day shipping-state jsonb breakdown (mirrors products/channels),
-- then resets the sync cursor so the backfill re-pulls history and populates
-- states for existing rows. Upserts are idempotent; while the re-backfill runs,
-- reads fall back to the live (short-TTL cached) Shopify pull as usual.

alter table public.shopify_daily
  add column if not exists states jsonb not null default '[]'; -- [{state, orders, revenue}]

update public.shopify_sync_state
set backfill_done = false,
    backfill_until = null;
