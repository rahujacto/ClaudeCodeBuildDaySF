-- 0006: Postgres cache for Shopify metrics.
--
-- shopify_daily     one row per (org, shop-local day) with the aggregates the
--                   dashboard needs; products/channels kept as jsonb breakdowns.
-- shopify_refunds   one row per refund, bucketed by PROCESSED date — this is
--                   what lets range revenue reproduce Shopify's ledger-style
--                   "Total sales" (gross by order date − returns by return date).
-- shopify_sync_state backfill + incremental cursors per org.
--
-- Rows are derived (re-computable) data with no secrets, so org members may
-- write them; the cron writes with the service role (bypasses RLS).

create table if not exists public.shopify_daily (
  org_id              uuid not null references public.orgs(id) on delete cascade,
  day                 date not null,
  orders              int not null default 0,
  gross               numeric(14,2) not null default 0, -- Σ totalPrice (order-dated)
  revenue_current     numeric(14,2) not null default 0, -- Σ currentTotalPrice (order-dated, post-refund)
  refunds_order_dated numeric(14,2) not null default 0, -- Σ totalRefunded attributed to order day
  new_customers       int not null default 0,
  products            jsonb not null default '[]',      -- [{title, quantity, revenue, orders}]
  channels            jsonb not null default '[]',      -- [{channel, ai, orders, revenue, newCustomers}]
  synced_at           timestamptz not null default now(),
  primary key (org_id, day)
);

create table if not exists public.shopify_refunds (
  org_id        uuid not null references public.orgs(id) on delete cascade,
  refund_id     text not null,
  order_day     date not null,   -- shop-local day the parent order was created
  processed_day date not null,   -- shop-local day the refund was created
  amount        numeric(14,2) not null default 0,
  synced_at     timestamptz not null default now(),
  primary key (org_id, refund_id)
);
create index if not exists shopify_refunds_processed
  on public.shopify_refunds (org_id, processed_day);

create table if not exists public.shopify_sync_state (
  org_id         uuid primary key references public.orgs(id) on delete cascade,
  backfill_until date,                        -- oldest day synced so far
  backfill_done  boolean not null default false,
  updated_cursor timestamptz,                 -- incremental high-water mark (order updated_at)
  last_run_at    timestamptz,
  last_error     text
);

alter table public.shopify_daily      enable row level security;
alter table public.shopify_refunds    enable row level security;
alter table public.shopify_sync_state enable row level security;

drop policy if exists "shopify daily read"  on public.shopify_daily;
create policy "shopify daily read"  on public.shopify_daily  for select
  using (public.is_org_member(org_id));
drop policy if exists "shopify daily write" on public.shopify_daily;
create policy "shopify daily write" on public.shopify_daily  for all
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

drop policy if exists "shopify refunds read"  on public.shopify_refunds;
create policy "shopify refunds read"  on public.shopify_refunds for select
  using (public.is_org_member(org_id));
drop policy if exists "shopify refunds write" on public.shopify_refunds;
create policy "shopify refunds write" on public.shopify_refunds for all
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

drop policy if exists "shopify sync read"  on public.shopify_sync_state;
create policy "shopify sync read"  on public.shopify_sync_state for select
  using (public.is_org_member(org_id));
drop policy if exists "shopify sync write" on public.shopify_sync_state;
create policy "shopify sync write" on public.shopify_sync_state for all
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
