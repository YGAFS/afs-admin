-- Track cancelled utility services without deleting their vendor or bill history.
-- Run once in the Supabase SQL Editor before deploying the UI changes.

alter table public.utility_vendors
  add column if not exists status text not null default 'active'
  check (status in ('active', 'cancelled'));

update public.utility_vendors
set status = 'cancelled'
where (company_id = 'afs' and lower(trim(name)) = 'biscayne rogers')
   or (company_id = 'tnt' and lower(trim(name)) = 'richmond rogers');

create index if not exists utility_vendors_status_idx
  on public.utility_vendors (company_id, status);
