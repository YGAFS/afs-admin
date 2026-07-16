-- Utility Vendors table
create table if not exists utility_vendors (
  id              uuid primary key default gen_random_uuid(),
  company_id      text not null check (company_id in ('afs', 'tnt', 'zfs')),
  name            text not null,
  service_type    text,
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  contract_start  date,
  contract_end    date,
  onedrive_url    text,
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- RLS
alter table utility_vendors enable row level security;

create policy "utility_vendors_select" on utility_vendors
  for select using (true);

create policy "utility_vendors_insert" on utility_vendors
  for insert with check (true);

create policy "utility_vendors_update" on utility_vendors
  for update using (true);

create policy "utility_vendors_delete" on utility_vendors
  for delete using (true);
