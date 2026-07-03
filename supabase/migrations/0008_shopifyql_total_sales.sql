-- 0008: authoritative daily revenue from Shopify's own Analytics engine.
-- shopifyqlQuery (read_reports scope) returns the exact "Total sales" the
-- merchant sees in Shopify Analytics. Stored per day; NULL = not yet synced
-- (read path falls back to our order-derived approximation).
alter table public.shopify_daily
  add column if not exists total_sales numeric(14,2);
