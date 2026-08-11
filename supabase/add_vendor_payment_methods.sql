-- ============================================================
-- Link payment_methods to specific vendors (many-to-many), so an
-- already-registered payment method can be reused across vendors
-- instead of re-entering it every time.
-- Safe to run multiple times.
-- ============================================================

create table if not exists vendor_payment_methods (
  vendor_id           uuid not null references utility_vendors(id) on delete cascade,
  payment_method_id   uuid not null references payment_methods(id) on delete cascade,
  created_at          timestamptz not null default now(),
  primary key (vendor_id, payment_method_id)
);

alter table vendor_payment_methods enable row level security;

create policy "vendor_payment_methods_select" on vendor_payment_methods
  for select to authenticated using (true);
create policy "vendor_payment_methods_all" on vendor_payment_methods
  for all to authenticated using (true) with check (true);
