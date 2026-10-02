-- Employee Portal account lifecycle, RLS enforcement, and audit support.
-- Account-management remains feature-flagged off until pilot approval.
--
-- Employment access boundary:
--   * employees.is_active = false blocks access immediately.
--   * end_date is inclusive in America/Vancouver: an otherwise active employee
--     can access through end_date and is blocked starting the next local date.
--
-- This migration deliberately does not backfill work_email, reconcile existing
-- employee status inconsistencies, link Auth users, or modify auth.users.

begin;

do $preflight$
begin
  if to_regclass('public.employees') is null
     or to_regclass('public.leave_entries') is null
     or to_regclass('public.companies') is null
     or to_regclass('public.user_profiles') is null
     or to_regclass('public.user_global_roles') is null
     or to_regclass('public.user_company_roles') is null
     or to_regclass('public.employee_user_links') is null then
    raise exception 'Employee Portal v2 prerequisite tables are missing';
  end if;

  if exists (
    select 1
    from (values
      ('stage2c_is_active_user'),
      ('stage2c_is_super_admin'),
      ('stage2c_has_hr_company')
    ) required(proname)
    where not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = required.proname
    )
  ) then
    raise exception 'Stage 2C authorization functions must be installed first';
  end if;
end;
$preflight$;

-- Staging originally needed these existing HR fields added by hand. Keep the
-- Portal migration independently replayable without changing any existing
-- Production column definitions or values.
alter table public.employees
  add column if not exists team text,
  add column if not exists position text,
  add column if not exists vacation_allowance numeric default 24,
  add column if not exists uses_accrual boolean default false,
  add column if not exists is_exempt boolean default false,
  add column if not exists probation_end date,
  add column if not exists employment_type text default 'office',
  add column if not exists manager_name text,
  add column if not exists sort_order integer default 99,
  add column if not exists probation_start date,
  add column if not exists work_email text;

alter table public.leave_entries
  add column if not exists reported_at timestamptz;

create unique index if not exists employees_active_work_email_unique
  on public.employees (lower(work_email))
  where work_email is not null and is_active = true;

alter table public.employee_user_links
  add column if not exists portal_status text not null default 'active',
  add column if not exists password_setup_required boolean not null default false,
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_by uuid references auth.users(id),
  add column if not exists archived_login_email text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.employee_user_links
  drop constraint if exists employee_user_links_portal_status_check;

alter table public.employee_user_links
  add constraint employee_user_links_portal_status_check
  check (portal_status in ('pending', 'active', 'disabled'));

create table if not exists public.portal_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  target_employee_id uuid references public.employees(id) on delete set null,
  event_type text not null check (event_type in (
    'admin_portal_viewed',
    'login_created',
    'login_reset',
    'account_disabled',
    'account_enabled'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists portal_audit_events_target_created_idx
  on public.portal_audit_events (target_employee_id, created_at desc);

create index if not exists portal_audit_events_actor_created_idx
  on public.portal_audit_events (actor_user_id, created_at desc);

alter table public.portal_audit_events enable row level security;
revoke all on public.portal_audit_events from public, anon, authenticated;
grant select, insert on public.portal_audit_events to service_role;

-- User JWTs may read HR rows, but existing Stage 2C RLS remains the final
-- authority. No employee DML grant is added.
grant select on public.companies, public.employees, public.leave_entries,
  public.user_company_roles to authenticated;

-- Portal users need the display name/code for their own company. Existing
-- company/HR admins retain their Stage 2C company scope, while super_admin can
-- read all companies. This policy adds SELECT only.
drop policy if exists employee_portal_authenticated_company_select on public.companies;
create policy employee_portal_authenticated_company_select
  on public.companies
  for select to authenticated
  using (
    public.stage2c_is_super_admin()
    or public.stage2c_has_hr_company(id)
    or exists (
      select 1
      from public.employees e
      where e.company_id = companies.id
        and public.stage2c_is_linked_employee(e.id)
    )
  );

-- The user-access panel needs super_admin to inspect company-role assignments.
-- Normal users remain limited to their own rows.
drop policy if exists user_company_roles_self_select on public.user_company_roles;
create policy user_company_roles_self_select
  on public.user_company_roles
  for select to authenticated
  using (user_id = auth.uid() or public.stage2c_is_super_admin());

-- Make the read-only Admin View grant explicit instead of relying only on
-- stage2c_has_hr_company(), which also resolves true for super_admin. These
-- permissive SELECT policies add no employee mutation privileges.
drop policy if exists employee_portal_super_admin_employee_select on public.employees;
create policy employee_portal_super_admin_employee_select
  on public.employees
  for select to authenticated
  using (public.stage2c_is_super_admin());

drop policy if exists employee_portal_super_admin_leave_select on public.leave_entries;
create policy employee_portal_super_admin_leave_select
  on public.leave_entries
  for select to authenticated
  using (public.stage2c_is_super_admin());

-- Employee links remain self-readable and become readable by super_admin for
-- account-management status. Mutations remain service-role/RPC only.
drop policy if exists employee_user_links_super_admin_select on public.employee_user_links;
create policy employee_user_links_super_admin_select
  on public.employee_user_links
  for select to authenticated
  using (public.stage2c_is_super_admin());

create or replace function public.portal_business_date()
returns date
language sql stable
set search_path = ''
as $$
  select (current_timestamp at time zone 'America/Vancouver')::date;
$$;

-- This function is consumed by the existing employees/leave_entries SELECT
-- policies. It blocks stale access tokens immediately after Reset Login or
-- Disable Account because every database request re-evaluates current state.
create or replace function public.stage2c_is_linked_employee(p_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.stage2c_is_active_user() and exists (
    select 1
    from public.employee_user_links l
    join public.employees e on e.id = l.employee_id
    where l.employee_id = p_employee_id
      and l.user_id = auth.uid()
      and l.portal_status = 'active'
      and l.password_setup_required = false
      and e.is_active = true
      and (e.end_date is null or e.end_date >= public.portal_business_date())
  );
$$;

-- Completes invite/recovery password setup without exposing service-role
-- credentials. The caller may only complete their own linked account.
create or replace function public.complete_portal_password_setup()
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if auth.uid() is null then
    return false;
  end if;

  update public.employee_user_links l
     set portal_status = 'active',
         password_setup_required = false,
         disabled_at = null,
         disabled_by = null,
         updated_at = clock_timestamp()
    from public.employees e, public.user_profiles p
   where l.user_id = auth.uid()
     and e.id = l.employee_id
     and p.user_id = l.user_id
     and p.status = 'active'
     and l.portal_status in ('pending', 'active')
     and l.password_setup_required = true
     and e.is_active = true
     and (e.end_date is null or e.end_date >= public.portal_business_date());

  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    return true;
  end if;

  -- A normal employee-initiated Forgot Password recovery does not set the
  -- setup-required flag. Treat an already-active eligible link as complete
  -- without mutating it; invite/Admin Reset still require the update above.
  return exists (
    select 1
    from public.employee_user_links l
    join public.employees e on e.id = l.employee_id
    join public.user_profiles p on p.user_id = l.user_id
    where l.user_id = auth.uid()
      and p.status = 'active'
      and l.portal_status = 'active'
      and l.password_setup_required = false
      and e.is_active = true
      and (e.end_date is null or e.end_date >= public.portal_business_date())
  );
end;
$$;

revoke all on function public.complete_portal_password_setup() from public, anon;
grant execute on function public.complete_portal_password_setup() to authenticated;

-- Called with the super_admin's JWT so an Admin View is auditable without
-- using service-role for the actual Employee/PTO read.
create or replace function public.audit_admin_portal_view(p_employee_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.stage2c_is_super_admin() then
    raise exception 'Forbidden';
  end if;
  if not exists (select 1 from public.employees where id = p_employee_id) then
    raise exception 'Employee not found';
  end if;

  insert into public.portal_audit_events (
    actor_user_id, target_employee_id, event_type
  ) values (
    auth.uid(), p_employee_id, 'admin_portal_viewed'
  );
end;
$$;

revoke all on function public.audit_admin_portal_view(uuid) from public, anon;
grant execute on function public.audit_admin_portal_view(uuid) to authenticated;

-- Auth provisioning is initiated through Supabase Admin invite APIs. This RPC
-- atomically records the public-schema profile/link after Auth returns a UUID.
create or replace function public.portal_admin_provision_login(
  p_actor_user_id uuid,
  p_employee_id uuid,
  p_auth_user_id uuid,
  p_login_email text
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
begin
  if not exists (
    select 1 from public.user_profiles p
    join public.user_global_roles r on r.user_id = p.user_id
    where p.user_id = p_actor_user_id
      and p.status = 'active'
      and r.role = 'super_admin'
  ) then
    raise exception 'Forbidden';
  end if;

  select * into v_employee
  from public.employees
  where id = p_employee_id
  for update;

  if v_employee.id is null then raise exception 'Employee not found'; end if;
  if not v_employee.is_active
     or (v_employee.end_date is not null and v_employee.end_date < public.portal_business_date()) then
    raise exception 'Employee is not active';
  end if;
  if exists (select 1 from public.employee_user_links where employee_id = p_employee_id or user_id = p_auth_user_id) then
    raise exception 'Employee or Auth user is already linked';
  end if;
  if v_employee.work_email is not null and lower(v_employee.work_email) <> lower(p_login_email) then
    raise exception 'Employee work email does not match requested login email';
  end if;

  update public.employees
     set work_email = coalesce(work_email, lower(p_login_email))
   where id = p_employee_id;

  insert into public.user_profiles (user_id, display_name, email_label, status)
  values (p_auth_user_id, v_employee.name, lower(p_login_email), 'active')
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        email_label = excluded.email_label,
        status = 'active',
        updated_at = clock_timestamp();

  insert into public.employee_user_links (
    employee_id, user_id, portal_status, password_setup_required
  ) values (
    p_employee_id, p_auth_user_id, 'pending', true
  );

  insert into public.portal_audit_events (
    actor_user_id, target_employee_id, event_type
  ) values (
    p_actor_user_id, p_employee_id, 'login_created'
  );
end;
$$;

revoke all on function public.portal_admin_provision_login(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.portal_admin_provision_login(uuid, uuid, uuid, text) to service_role;

create or replace function public.portal_admin_reset_login(
  p_actor_user_id uuid,
  p_employee_id uuid
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if not exists (
    select 1 from public.user_profiles p
    join public.user_global_roles r on r.user_id = p.user_id
    where p.user_id = p_actor_user_id
      and p.status = 'active'
      and r.role = 'super_admin'
  ) then raise exception 'Forbidden'; end if;

  select user_id into v_user_id
  from public.employee_user_links
  where employee_id = p_employee_id and portal_status <> 'disabled'
  for update;

  if v_user_id is null then raise exception 'Active employee login not found'; end if;

  update public.employee_user_links
     set password_setup_required = true,
         updated_at = clock_timestamp()
   where employee_id = p_employee_id;

  -- Refresh sessions are removed. Outstanding stateless JWTs are still
  -- blocked immediately by the current-state RLS check above.
  delete from auth.sessions where user_id = v_user_id;

  insert into public.portal_audit_events (
    actor_user_id, target_employee_id, event_type
  ) values (
    p_actor_user_id, p_employee_id, 'login_reset'
  );

  return v_user_id;
end;
$$;

revoke all on function public.portal_admin_reset_login(uuid, uuid) from public, anon, authenticated;
grant execute on function public.portal_admin_reset_login(uuid, uuid) to service_role;

create or replace function public.portal_admin_set_account_enabled(
  p_actor_user_id uuid,
  p_employee_id uuid,
  p_enabled boolean,
  p_archived_login_email text default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if not exists (
    select 1 from public.user_profiles p
    join public.user_global_roles r on r.user_id = p.user_id
    where p.user_id = p_actor_user_id
      and p.status = 'active'
      and r.role = 'super_admin'
  ) then raise exception 'Forbidden'; end if;

  select user_id into v_user_id
  from public.employee_user_links
  where employee_id = p_employee_id
  for update;

  if v_user_id is null then raise exception 'Employee login not found'; end if;

  if p_enabled then
    if not exists (
      select 1
      from public.employees e
      where e.id = p_employee_id
        and e.is_active = true
        and (e.end_date is null or e.end_date >= public.portal_business_date())
    ) then raise exception 'Employee is not active'; end if;

    if exists (
      select 1 from public.employee_user_links
      where employee_id = p_employee_id and archived_login_email is not null
    ) then raise exception 'Archived login requires a new provisioning review'; end if;

    update public.user_profiles set status = 'active', updated_at = clock_timestamp()
    where user_id = v_user_id;
    update public.employee_user_links
       set portal_status = 'active', disabled_at = null, disabled_by = null,
           updated_at = clock_timestamp()
     where employee_id = p_employee_id;
  else
    update public.user_profiles set status = 'inactive', updated_at = clock_timestamp()
    where user_id = v_user_id;
    update public.employee_user_links
       set portal_status = 'disabled', disabled_at = clock_timestamp(),
           disabled_by = p_actor_user_id,
           archived_login_email = coalesce(archived_login_email, p_archived_login_email),
           updated_at = clock_timestamp()
     where employee_id = p_employee_id;
    delete from auth.sessions where user_id = v_user_id;
  end if;

  insert into public.portal_audit_events (
    actor_user_id, target_employee_id, event_type,
    metadata
  ) values (
    p_actor_user_id,
    p_employee_id,
    case when p_enabled then 'account_enabled' else 'account_disabled' end,
    case when p_archived_login_email is null then '{}'::jsonb else '{"login_archived":true}'::jsonb end
  );

  return v_user_id;
end;
$$;

revoke all on function public.portal_admin_set_account_enabled(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.portal_admin_set_account_enabled(uuid, uuid, boolean, text) to service_role;

-- Preserve historical HR/PTO rows. Only a relation-free mistaken record may
-- be hard-deleted through the existing HR API.
create or replace function public.protect_employee_history_from_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.leave_entries where employee_id = old.id)
     or exists (select 1 from public.employee_user_links where employee_id = old.id) then
    raise exception 'Employee with PTO history or Portal login cannot be deleted; deactivate instead';
  end if;
  return old;
end;
$$;

drop trigger if exists protect_employee_history_from_delete on public.employees;
create trigger protect_employee_history_from_delete
before delete on public.employees
for each row execute function public.protect_employee_history_from_delete();

grant execute on function public.portal_business_date() to authenticated, service_role;
grant execute on function public.stage2c_is_linked_employee(uuid) to authenticated;

commit;
