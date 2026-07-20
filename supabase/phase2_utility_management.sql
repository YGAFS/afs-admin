-- ============================================================
-- Phase 2: Utility Management — Locations, Contacts, Accounts
-- Safe to run multiple times (IF NOT EXISTS / IF EXISTS guards)
-- Does NOT delete or overwrite any existing data
-- ============================================================

-- ── 1. utility_locations ────────────────────────────────────
create table if not exists utility_locations (
  id          uuid primary key default gen_random_uuid(),
  company_id  text not null check (company_id in ('afs', 'tnt', 'zfs')),
  region      text,           -- Province / State (e.g. 'British Columbia')
  city        text not null,
  name        text not null,  -- Full location name (e.g. 'Surrey Head Office')
  address     text,
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table utility_locations enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='utility_locations' and policyname='utility_locations_select') then
    create policy "utility_locations_select" on utility_locations for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='utility_locations' and policyname='utility_locations_insert') then
    create policy "utility_locations_insert" on utility_locations for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='utility_locations' and policyname='utility_locations_update') then
    create policy "utility_locations_update" on utility_locations for update using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='utility_locations' and policyname='utility_locations_delete') then
    create policy "utility_locations_delete" on utility_locations for delete using (true);
  end if;
end $$;

-- ── 2. Seed known locations (skip if already seeded) ────────
insert into utility_locations (company_id, region, city, name) values
  ('afs', 'British Columbia', 'Surrey',     'Surrey Office'),
  ('tnt', 'Ontario',          'Cambridge',  'Cambridge'),
  ('tnt', 'Ontario',          'Biscayne',   'Biscayne'),
  ('tnt', 'Ontario',          'Pickering',  'Pickering'),
  ('zfs', 'California',       'Fontana',    'Fontana')
on conflict do nothing;

-- ── 3. utility_vendor_contacts ──────────────────────────────
create table if not exists utility_vendor_contacts (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references utility_vendors(id) on delete cascade,
  name        text not null,
  title       text,
  email       text,
  phone       text,
  is_primary  boolean default false,
  notes       text,
  created_at  timestamptz default now()
);

alter table utility_vendor_contacts enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='utility_vendor_contacts' and policyname='utility_vendor_contacts_select') then
    create policy "utility_vendor_contacts_select" on utility_vendor_contacts for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='utility_vendor_contacts' and policyname='utility_vendor_contacts_insert') then
    create policy "utility_vendor_contacts_insert" on utility_vendor_contacts for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='utility_vendor_contacts' and policyname='utility_vendor_contacts_update') then
    create policy "utility_vendor_contacts_update" on utility_vendor_contacts for update using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='utility_vendor_contacts' and policyname='utility_vendor_contacts_delete') then
    create policy "utility_vendor_contacts_delete" on utility_vendor_contacts for delete using (true);
  end if;
end $$;

-- Migrate existing single-contact fields → utility_vendor_contacts
-- Only migrates vendors that have a contact_name and haven't been migrated yet
insert into utility_vendor_contacts (vendor_id, name, email, phone, is_primary)
select v.id, v.contact_name, v.contact_email, v.contact_phone, true
from utility_vendors v
where v.contact_name is not null
  and v.contact_name <> ''
  and not exists (
    select 1 from utility_vendor_contacts vc where vc.vendor_id = v.id
  );

-- ── 4. utility_service_accounts ─────────────────────────────
create table if not exists utility_service_accounts (
  id                  uuid primary key default gen_random_uuid(),
  vendor_id           uuid not null references utility_vendors(id) on delete cascade,
  location_id         uuid references utility_locations(id) on delete set null,
  account_number      text not null,
  service_label       text,           -- Optional override label (e.g. 'Main Meter', 'Sub Meter')
  billing_portal_url  text,           -- Account-specific portal URL (overrides vendor-level)
  is_active           boolean default true,
  notes               text,
  created_at          timestamptz default now()
);

alter table utility_service_accounts enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='utility_service_accounts' and policyname='utility_service_accounts_select') then
    create policy "utility_service_accounts_select" on utility_service_accounts for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='utility_service_accounts' and policyname='utility_service_accounts_insert') then
    create policy "utility_service_accounts_insert" on utility_service_accounts for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='utility_service_accounts' and policyname='utility_service_accounts_update') then
    create policy "utility_service_accounts_update" on utility_service_accounts for update using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='utility_service_accounts' and policyname='utility_service_accounts_delete') then
    create policy "utility_service_accounts_delete" on utility_service_accounts for delete using (true);
  end if;
end $$;

-- ── 5. utility_document_links ───────────────────────────────
create table if not exists utility_document_links (
  id             uuid primary key default gen_random_uuid(),
  vendor_id      uuid references utility_vendors(id) on delete cascade,
  location_id    uuid references utility_locations(id) on delete set null,
  name           text not null,        -- e.g. 'Service Agreement', 'Rate Schedule 2026'
  document_type  text default 'contract',  -- 'contract' | 'rate_schedule' | 'terms' | 'other'
  onedrive_url   text not null,
  created_at     timestamptz default now()
);

alter table utility_document_links enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='utility_document_links' and policyname='utility_document_links_select') then
    create policy "utility_document_links_select" on utility_document_links for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='utility_document_links' and policyname='utility_document_links_insert') then
    create policy "utility_document_links_insert" on utility_document_links for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='utility_document_links' and policyname='utility_document_links_update') then
    create policy "utility_document_links_update" on utility_document_links for update using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='utility_document_links' and policyname='utility_document_links_delete') then
    create policy "utility_document_links_delete" on utility_document_links for delete using (true);
  end if;
end $$;

-- Migrate existing onedrive_url in utility_vendors → utility_document_links
insert into utility_document_links (vendor_id, name, document_type, onedrive_url)
select v.id, 'Contract Document', 'contract', v.onedrive_url
from utility_vendors v
where v.onedrive_url is not null
  and v.onedrive_url <> ''
  and not exists (
    select 1 from utility_document_links dl where dl.vendor_id = v.id
  );

-- ── 6. Add columns to utility_vendors ───────────────────────
alter table utility_vendors
  add column if not exists website_url        text,
  add column if not exists billing_portal_url text;

-- ── 7. Add location_id to utility_bills (optional, for future) ──
alter table utility_bills
  add column if not exists location_id uuid references utility_locations(id) on delete set null;
