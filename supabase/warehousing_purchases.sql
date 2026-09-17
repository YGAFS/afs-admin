-- ============================================================
-- Warehousing purchase ledger — MVP foundation.
--
-- Keeps the existing purchase_requests workflow unchanged. A purchase may
-- optionally link back to a request, but the purchase ledger has its own
-- lifecycle and line items.
--
-- Reuses:
--   * utility_locations for company/location data
--   * payment_methods for saved company cards
--   * purchase_categories for purchasing categories
--   * purchase-attachments (private Storage bucket)
--
-- Safe to run multiple times after warehousing_purchase_requests.sql.
-- ============================================================

create table if not exists purchase_counters (
  year     integer primary key,
  next_seq integer not null default 1
);

create or replace function next_purchase_number() returns text
language plpgsql as $$
declare
  yr  integer := extract(year from now())::integer;
  seq integer;
begin
  insert into purchase_counters (year, next_seq) values (yr, 2)
  on conflict (year) do update set next_seq = purchase_counters.next_seq + 1
  returning next_seq - 1 into seq;
  return 'PUR-' || yr || '-' || lpad(seq::text, 4, '0');
end;
$$;

create table if not exists items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  category_id uuid references purchase_categories(id) on delete set null,
  image_url   text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists items_name_idx on items (lower(name));

create table if not exists item_vendor_refs (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references items(id) on delete cascade,
  vendor_name      text not null,
  vendor_key       text not null,
  vendor_sku       text,
  vendor_sku_key   text,
  product_url      text,
  created_at       timestamptz not null default now(),
  check (vendor_sku is not null or product_url is not null)
);

create unique index if not exists item_vendor_refs_vendor_sku_uidx
  on item_vendor_refs (vendor_key, vendor_sku_key)
  where vendor_sku_key is not null;

create unique index if not exists item_vendor_refs_product_url_uidx
  on item_vendor_refs (vendor_key, product_url)
  where product_url is not null;

create index if not exists item_vendor_refs_item_idx on item_vendor_refs (item_id);

create table if not exists purchases (
  id                       uuid primary key default gen_random_uuid(),
  purchase_number          text not null unique default next_purchase_number(),
  purchase_request_id      uuid references purchase_requests(id) on delete set null,
  company_id               text not null check (company_id in ('afs', 'tnt', 'zfs')),
  location_id              uuid references utility_locations(id) on delete set null,
  vendor_name              text,
  order_date               date,
  order_number             text,
  description              text,
  category_id              uuid references purchase_categories(id) on delete set null,
  subtotal                 numeric(12,2),
  tax                      numeric(12,2),
  shipping                 numeric(12,2),
  total                    numeric(12,2),
  currency                 text not null default 'CAD' check (currency in ('CAD', 'USD')),
  payment_method_id        uuid references payment_methods(id) on delete set null,
  card_last4_snapshot      text check (card_last4_snapshot is null or card_last4_snapshot ~ '^[0-9]{4}$'),
  status                   text not null default 'draft' check (status in ('draft', 'reviewed', 'sending', 'accepted_by_graph', 'send_failed')),
  created_by_user_id       uuid not null references auth.users(id),
  created_by_email         text not null,
  reviewed_at              timestamptz,
  accepted_by_graph_at     timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists purchases_created_idx on purchases (created_at desc);
create index if not exists purchases_company_date_idx on purchases (company_id, order_date desc);
create index if not exists purchases_request_idx on purchases (purchase_request_id) where purchase_request_id is not null;
create index if not exists purchases_status_idx on purchases (status);
create unique index if not exists purchases_vendor_order_uidx
  on purchases (company_id, lower(vendor_name), order_number)
  where vendor_name is not null and order_number is not null;

create table if not exists purchase_lines (
  id                      uuid primary key default gen_random_uuid(),
  purchase_id             uuid not null references purchases(id) on delete cascade,
  item_id                 uuid references items(id) on delete set null,
  raw_vendor_product_name text not null,
  vendor_sku              text,
  product_url             text,
  quantity                numeric(12,3),
  unit_price              numeric(12,2),
  line_subtotal           numeric(12,2),
  created_at              timestamptz not null default now()
);

create index if not exists purchase_lines_purchase_idx on purchase_lines (purchase_id);
create index if not exists purchase_lines_item_idx on purchase_lines (item_id) where item_id is not null;

create table if not exists purchase_attachments (
  id                  uuid primary key default gen_random_uuid(),
  purchase_id         uuid not null references purchases(id) on delete cascade,
  storage_path        text not null unique,
  file_name           text not null,
  mime_type           text,
  size_bytes          bigint,
  attachment_type     text not null default 'other' check (attachment_type in ('invoice', 'receipt', 'screenshot', 'other')),
  uploaded_by_user_id uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists purchase_attachments_purchase_idx on purchase_attachments (purchase_id, created_at);

create table if not exists purchase_email_attempts (
  id              uuid primary key default gen_random_uuid(),
  purchase_id     uuid not null references purchases(id) on delete cascade,
  idempotency_key text not null unique,
  recipient       text not null,
  subject         text not null,
  body            text not null,
  attempted_at    timestamptz not null default now(),
  accepted_at     timestamptz,
  status          text not null check (status in ('pending', 'sending', 'accepted_by_graph', 'failed')),
  error           text,
  created_by      uuid references auth.users(id) on delete set null
);

create index if not exists purchase_email_attempts_purchase_idx
  on purchase_email_attempts (purchase_id, attempted_at desc);

drop trigger if exists items_updated_at on items;
create trigger items_updated_at
  before update on items
  for each row execute function set_updated_at();

drop trigger if exists purchases_updated_at on purchases;
create trigger purchases_updated_at
  before update on purchases
  for each row execute function set_updated_at();

alter table items enable row level security;
alter table item_vendor_refs enable row level security;
alter table purchases enable row level security;
alter table purchase_lines enable row level security;
alter table purchase_attachments enable row level security;
alter table purchase_email_attempts enable row level security;

drop policy if exists "items_select" on items;
drop policy if exists "items_all" on items;
create policy "items_select" on items for select to authenticated using (true);
create policy "items_all" on items for all to authenticated using (true) with check (true);

drop policy if exists "item_vendor_refs_select" on item_vendor_refs;
drop policy if exists "item_vendor_refs_all" on item_vendor_refs;
create policy "item_vendor_refs_select" on item_vendor_refs for select to authenticated using (true);
create policy "item_vendor_refs_all" on item_vendor_refs for all to authenticated using (true) with check (true);

drop policy if exists "purchases_select" on purchases;
drop policy if exists "purchases_all" on purchases;
create policy "purchases_select" on purchases for select to authenticated using (true);
create policy "purchases_all" on purchases for all to authenticated using (true) with check (true);

drop policy if exists "purchase_lines_select" on purchase_lines;
drop policy if exists "purchase_lines_all" on purchase_lines;
create policy "purchase_lines_select" on purchase_lines for select to authenticated using (true);
create policy "purchase_lines_all" on purchase_lines for all to authenticated using (true) with check (true);

drop policy if exists "purchase_attachments_select" on purchase_attachments;
drop policy if exists "purchase_attachments_all" on purchase_attachments;
create policy "purchase_attachments_select" on purchase_attachments for select to authenticated using (true);
create policy "purchase_attachments_all" on purchase_attachments for all to authenticated using (true) with check (true);

drop policy if exists "purchase_email_attempts_select" on purchase_email_attempts;
drop policy if exists "purchase_email_attempts_all" on purchase_email_attempts;
create policy "purchase_email_attempts_select" on purchase_email_attempts for select to authenticated using (true);
create policy "purchase_email_attempts_all" on purchase_email_attempts for all to authenticated using (true) with check (true);

-- The existing private `purchase-attachments` Storage bucket and policies are
-- reused. New files are stored under purchases/<purchase-id>/... so they do
-- not collide with the legacy purchase-request attachment paths.
