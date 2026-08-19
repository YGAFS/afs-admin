-- ============================================================
-- Purchase Request / Procurement Workflow — core schema.
-- Additive-only; reuses existing `payment_methods` (card label),
-- `utility_locations` (delivery location), and the existing
-- `set_updated_at()` trigger function (defined in utility_tables.sql).
-- Run after warehousing_app_access.sql. Safe to run multiple times.
-- ============================================================

-- ── Categories: admin-editable lookup, not a hardcoded enum ────────────────
-- requires_identifier drives the "SKU or Product URL required at submit"
-- validation rule in app code (lib/purchaseRequestStatus.ts) — data-driven
-- so it can change without a code deploy.

create table if not exists purchase_categories (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null unique,
  requires_identifier boolean not null default false,
  is_active           boolean not null default true,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now()
);

alter table purchase_categories enable row level security;
create policy "purchase_categories_select" on purchase_categories for select to authenticated using (true);
create policy "purchase_categories_all"    on purchase_categories for all    to authenticated using (true) with check (true);

insert into purchase_categories (name, requires_identifier, sort_order) values
  ('Warehouse Supplies', true,  1),
  ('Office Supplies',    false, 2),
  ('Labels/Packaging',   true,  3),
  ('Equipment',          true,  4),
  ('Maintenance',        false, 5),
  ('IT/Electronics',     true,  6),
  ('Other',              false, 7)
on conflict (name) do nothing;

-- ── Customers: minimal directory, not a CRM ─────────────────────────────────

create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  company_id  text not null check (company_id in ('afs', 'tnt', 'zfs')),
  name        text not null,
  code        text,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table customers enable row level security;
create policy "customers_select" on customers for select to authenticated using (true);
create policy "customers_all"    on customers for all    to authenticated using (true) with check (true);

-- ── Request number generator: PR-2026-0087, resets per calendar year ───────

create table if not exists purchase_request_counters (
  year     int primary key,
  next_seq int not null default 1
);

create or replace function next_purchase_request_number() returns text
language plpgsql as $$
declare
  yr  int := extract(year from now())::int;
  seq int;
begin
  insert into purchase_request_counters (year, next_seq) values (yr, 2)
  on conflict (year) do update set next_seq = purchase_request_counters.next_seq + 1
  returning next_seq - 1 into seq;
  return 'PR-' || yr || '-' || lpad(seq::text, 4, '0');
end;
$$;

-- ── purchase_requests: one wide table (matches the utility_bills precedent —
-- one row per bill holds vendor/amount/payment/paid-status all inline; the
-- purchasing/PO/accounting "sections" here are 1:1 with the parent request
-- by construction, so normalizing them into child tables would only add
-- joins with no benefit) ─────────────────────────────────────────────────

create table if not exists purchase_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique default next_purchase_request_number(),
  company_id text not null check (company_id in ('afs', 'tnt', 'zfs')),

  -- Requester / status
  requested_by_email text not null,
  status text not null default 'draft' check (status in (
    'draft', 'submitted', 'under_review', 'more_info_requested',
    'approved', 'rejected', 'ordered', 'awaiting_po', 'po_received',
    'awaiting_bookkeeping', 'accounting_recorded', 'customer_billed', 'closed'
  )),

  -- Request details
  item_name text not null,
  description text,
  quantity numeric,
  unit_type text,
  product_url text,
  sku text,
  specifications text,
  preferred_vendor text,
  estimated_price numeric(10,2),
  needed_by_date date,
  delivery_method text check (delivery_method in ('delivery', 'pickup', 'other')),
  delivery_location_id uuid references utility_locations(id) on delete set null,
  business_reason text,
  notes text,
  category_id uuid references purchase_categories(id) on delete set null,

  -- Customer chargeback / PO
  is_customer_chargeback boolean not null default false,
  customer_id uuid references customers(id) on delete set null,
  po_required text check (po_required in ('yes', 'no', 'unknown')) default 'unknown',
  billing_notes text,
  po_number text,
  po_entered_by text,
  po_entered_at timestamptz,
  customer_billing_status text check (customer_billing_status in ('not_applicable', 'pending', 'billed')) default 'not_applicable',
  customer_billed_by text,
  customer_billed_at timestamptz,

  -- Purchasing section
  vendor text,
  actual_quantity numeric,
  subtotal numeric(10,2),
  tax numeric(10,2),
  shipping numeric(10,2),
  total numeric(10,2),
  currency text default 'CAD' check (currency in ('CAD', 'USD')),
  payment_method_id uuid references payment_methods(id) on delete set null,
  order_date date,
  order_number text,
  expected_delivery_date date,
  actual_delivery_date date,
  purchase_notes text,
  purchased_by text,

  -- Accounting section
  ready_for_bookkeeping boolean not null default false,
  ready_for_bookkeeping_at timestamptz,
  sent_to_bookkeeping_at timestamptz,
  sent_to_bookkeeping_by text,
  accounting_recorded boolean not null default false,
  accounting_recorded_by text,
  accounting_recorded_at timestamptz,

  -- Approval
  reviewed_by text,
  reviewed_at timestamptz,
  rejection_reason text,

  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger purchase_requests_updated_at
  before update on purchase_requests
  for each row execute function set_updated_at();

create index if not exists purchase_requests_status_idx     on purchase_requests (status);
create index if not exists purchase_requests_requester_idx  on purchase_requests (requested_by_email);
create index if not exists purchase_requests_company_idx    on purchase_requests (company_id);

alter table purchase_requests enable row level security;
-- Row-level RLS kept open (using(true)) per this project's established
-- convention (every existing table does this — see CLAUDE.md). Per-role
-- restriction (e.g. hiding card details from requesters) is enforced at
-- the app layer (lib/purchaseRequestAccess.ts), not here — see the plan
-- doc for the column-level-security tradeoff this was a deliberate call on.
create policy "purchase_requests_select" on purchase_requests for select to authenticated using (true);
create policy "purchase_requests_all"    on purchase_requests for all    to authenticated using (true) with check (true);
