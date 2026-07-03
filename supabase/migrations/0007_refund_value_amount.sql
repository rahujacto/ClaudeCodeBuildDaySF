-- 0007: Shopify values "Returns" at the returned items' SALE value (subtotal +
-- tax + refunded shipping), not the cash refunded — e.g. exchanges and store
-- credit reduce Total sales with little/no cash movement, while order-level
-- deposit refunds (no line items) don't reduce Total sales at all. Store that
-- valuation per refund so range revenue = gross − item-valued returns by
-- processed date, matching Shopify Analytics' ledger.
alter table public.shopify_refunds
  add column if not exists value_amount numeric(14,2) not null default 0;
