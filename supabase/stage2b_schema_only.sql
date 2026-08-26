-- Stage 2B schema-only migration.
-- Deliberately fail-fast: this file must not be rerun against an existing schema.
begin;

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email_label text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  authz_migrated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_global_roles (
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  role text not null check (role in ('super_admin')),
  primary key (user_id, role)
);

create table public.user_company_roles (
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  role text not null check (role in ('company_admin', 'hr_admin')),
  primary key (user_id, company_id, role)
);

create table public.employee_user_links (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  user_id uuid not null unique references public.user_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.user_section_access (
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  section_key text not null check (section_key in ('hr', 'utilities', 'licenses', 'assets', 'supplies', 'admin')),
  primary key (user_id, section_key)
);

create table public.app_user_roles (
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  app_key text not null check (app_key in ('warehousing')),
  role text not null check (role in ('requester', 'purchasing', 'operations', 'bookkeeping', 'admin')),
  primary key (user_id, app_key)
);

create index user_profiles_authz_migrated_idx
  on public.user_profiles (authz_migrated_at)
  where authz_migrated_at is not null;
create index user_company_roles_company_idx
  on public.user_company_roles (company_id, user_id);
create index user_section_access_user_idx
  on public.user_section_access (user_id);
create index app_user_roles_app_role_idx
  on public.app_user_roles (app_key, role);

alter table public.user_profiles enable row level security;
alter table public.user_global_roles enable row level security;
alter table public.user_company_roles enable row level security;
alter table public.employee_user_links enable row level security;
alter table public.user_section_access enable row level security;
alter table public.app_user_roles enable row level security;

revoke all privileges on table
  public.user_profiles,
  public.user_global_roles,
  public.user_company_roles,
  public.employee_user_links,
  public.user_section_access,
  public.app_user_roles
from public, anon, authenticated;

grant select on table
  public.user_profiles,
  public.user_global_roles,
  public.user_company_roles,
  public.employee_user_links,
  public.user_section_access,
  public.app_user_roles
to authenticated;

grant select, insert, update, delete on table
  public.user_profiles,
  public.user_global_roles,
  public.user_company_roles,
  public.employee_user_links,
  public.user_section_access,
  public.app_user_roles
to service_role;

create policy user_profiles_self_select on public.user_profiles
  for select to authenticated using (user_id = auth.uid());
create policy user_global_roles_self_select on public.user_global_roles
  for select to authenticated using (user_id = auth.uid());
create policy user_company_roles_self_select on public.user_company_roles
  for select to authenticated using (user_id = auth.uid());
create policy employee_user_links_self_select on public.employee_user_links
  for select to authenticated using (user_id = auth.uid());
create policy user_section_access_self_select on public.user_section_access
  for select to authenticated using (user_id = auth.uid());
create policy app_user_roles_self_select on public.app_user_roles
  for select to authenticated using (user_id = auth.uid());

create function public.replace_user_section_access(
  p_user_id uuid,
  p_section_keys text[]
)
returns void
as $stage2b$
begin
  if p_section_keys is null then
    raise exception 'p_section_keys must not be null';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_section_keys) as requested(section_key)
    where requested.section_key not in ('hr', 'utilities', 'licenses', 'assets', 'supplies', 'admin')
  ) then
    raise exception 'invalid root section key';
  end if;

  delete from public.user_section_access
  where user_id = p_user_id;

  insert into public.user_section_access (user_id, section_key)
  select p_user_id, requested.section_key
  from pg_catalog.unnest(p_section_keys) as requested(section_key);
end;
$stage2b$
language plpgsql
security definer
set search_path = '';

revoke all on function public.replace_user_section_access(uuid, text[]) from public, anon, authenticated;
grant execute on function public.replace_user_section_access(uuid, text[]) to service_role;

commit;
