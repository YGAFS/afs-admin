-- Employee Portal PTO policies. Apply manually in Supabase SQL Editor.
create table if not exists public.company_policy_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  policy_type text not null default 'pto' check (policy_type = 'pto'),
  storage_path text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (company_id, policy_type)
);
alter table public.company_policy_documents enable row level security;
insert into storage.buckets (id, name, public) values ('company-policies', 'company-policies', false) on conflict (id) do nothing;
