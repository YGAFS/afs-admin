-- Utility Bill Management Tables
-- Run this in the Supabase SQL Editor

-- Payment methods master list
create table if not exists payment_methods (
  id            uuid primary key default gen_random_uuid(),
  company_id    text not null check (company_id in ('afs', 'tnt', 'zfs')),
  label         text not null,
  holder_name   text,
  card_brand    text,
  bank_name     text,
  is_auto       boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now()
);

-- Utility bills
create table if not exists utility_bills (
  id                  uuid primary key default gen_random_uuid(),
  company_id          text not null check (company_id in ('afs', 'tnt', 'zfs')),
  utility_name        text not null,
  provider            text,
  amount              numeric(10,2),
  currency            text not null default 'CAD' check (currency in ('CAD', 'USD')),
  due_date            date,
  billing_period      text,
  billing_month       int check (billing_month between 1 and 12),
  is_auto_pay         boolean not null default false,
  payment_method_id   uuid references payment_methods(id) on delete set null,
  onedrive_file_url   text,
  is_paid             boolean not null default false,
  paid_at             timestamptz,
  paid_by             text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Trigger to keep updated_at fresh
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger utility_bills_updated_at
  before update on utility_bills
  for each row execute function set_updated_at();

-- User roles for utility dashboard (admin | ap)
create table if not exists utility_user_roles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  email         text not null,
  role          text not null default 'ap' check (role in ('admin', 'ap')),
  notify_email  text,
  created_at    timestamptz not null default now(),
  unique(user_id)
);

-- RLS: authenticated users can read all; write restricted by role
alter table utility_bills enable row level security;
alter table payment_methods enable row level security;
alter table utility_user_roles enable row level security;

-- Bills: anyone logged in can read
create policy "bills_select" on utility_bills for select to authenticated using (true);
-- Bills: admin only for insert/update/delete (enforced in app layer for now)
create policy "bills_all"    on utility_bills for all    to authenticated using (true) with check (true);

-- Payment methods
create policy "pm_select" on payment_methods for select to authenticated using (true);
create policy "pm_all"    on payment_methods for all    to authenticated using (true) with check (true);

-- User roles: anyone can read their own row; admin manages via Supabase dashboard
create policy "roles_select" on utility_user_roles for select to authenticated using (true);
create policy "roles_all"    on utility_user_roles for all    to authenticated using (true) with check (true);
