-- ============================================================
-- utility_credits — standalone account-balance adjustments not tied to
-- any specific bill (e.g. a duplicate/overpayment made to a vendor).
-- Reduces that account's running balance shown in the Utility Bills
-- "All Bills" table (grouped by company_id + utility_name + account_number,
-- same key used to group bills there).
-- Safe to run multiple times.
-- ============================================================

create table if not exists utility_credits (
  id              uuid primary key default gen_random_uuid(),
  company_id      text not null check (company_id in ('afs', 'tnt', 'zfs')),
  utility_name    text not null,
  account_number  text,
  amount          numeric(10,2) not null check (amount > 0),
  credit_date     date,
  note            text,
  created_at      timestamptz not null default now()
);

create index if not exists utility_credits_account_idx
  on utility_credits (company_id, utility_name, account_number);

alter table utility_credits enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='utility_credits' and policyname='utility_credits_select') then
    create policy "utility_credits_select" on utility_credits for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='utility_credits' and policyname='utility_credits_all') then
    create policy "utility_credits_all" on utility_credits for all to authenticated using (true) with check (true);
  end if;
end $$;
