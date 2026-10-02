-- Production-only assertions for Employee Portal v2 rollout.
--
-- Run these statements in the SAME transaction as
-- employee_portal_accounts_v2.sql, immediately before COMMIT. Any assertion
-- failure aborts the transaction. This file performs no persistent writes.

create temp table employee_portal_v2_production_context on commit drop as
select
  'f92744b5-d28a-476c-b34e-198ced787983'::uuid as pilot_employee_id,
  '766bd724-c766-4257-8312-e48623a535f3'::uuid as pilot_user_id,
  (
    select r.user_id
    from public.user_global_roles r
    join public.user_profiles p on p.user_id = r.user_id
    where r.role = 'super_admin' and p.status = 'active'
    order by r.user_id
    limit 1
  ) as super_admin_user_id,
  (
    select r.user_id
    from public.user_company_roles r
    join public.user_profiles p on p.user_id = r.user_id
    where r.role in ('hr_admin', 'company_admin')
      and p.status = 'active'
    order by r.user_id
    limit 1
  ) as hr_user_id;

grant select on employee_portal_v2_production_context to authenticated;

do $production_invariants$
declare
  v_context employee_portal_v2_production_context%rowtype;
begin
  select * into strict v_context
  from employee_portal_v2_production_context;

  if (select count(*) from public.employees) <> 42 then
    raise exception 'Production invariant failed: employees must remain 42';
  end if;
  if (select count(*) from public.leave_entries) <> 1141 then
    raise exception 'Production invariant failed: leave_entries must remain 1141';
  end if;
  if (select count(*) from auth.users) <> 5 then
    raise exception 'Production invariant failed: auth.users must remain 5';
  end if;
  if (select count(*) from public.user_profiles) <> 4 then
    raise exception 'Production invariant failed: user_profiles must remain 4';
  end if;
  if (select count(*) from public.employee_user_links) <> 1 then
    raise exception 'Production invariant failed: employee_user_links must remain 1';
  end if;
  if (
    select count(*)
    from public.employees
    where is_active = true
      and end_date is not null
      and end_date < (current_timestamp at time zone 'America/Vancouver')::date
  ) <> 7 then
    raise exception 'Production invariant failed: termination inconsistencies must remain 7';
  end if;
  if (
    select count(*)
    from auth.users u
    left join public.user_profiles p on p.user_id = u.id
    where p.user_id is null and lower(coalesce(u.email, '')) like '%timothy%'
  ) <> 1 then
    raise exception 'Production invariant failed: Timothy unprofiled Auth account changed';
  end if;
  if (
    select count(*)
    from public.employee_user_links l
    join auth.users u on u.id = l.user_id
    where lower(coalesce(u.email, '')) like '%timothy%'
  ) <> 0 then
    raise exception 'Production invariant failed: Timothy account linkage changed';
  end if;
  if not exists (
    select 1
    from public.employee_user_links l
    join public.employees e on e.id = l.employee_id
    join auth.users u on u.id = l.user_id
    where l.employee_id = v_context.pilot_employee_id
      and l.user_id = v_context.pilot_user_id
      and e.name = 'Yungyeong Jang'
      and lower(u.email) = 'yungyeong.j@afstransco.com'
      and l.portal_status = 'active'
      and l.password_setup_required = false
  ) then
    raise exception 'Production invariant failed: intended pilot link/defaults do not match';
  end if;
  if v_context.super_admin_user_id is null then
    raise exception 'Production invariant failed: active super_admin missing';
  end if;
  if v_context.hr_user_id is null then
    raise exception 'Production invariant failed: active HR/company admin missing';
  end if;
  if to_regclass('public.portal_audit_events') is null then
    raise exception 'Production invariant failed: portal_audit_events missing';
  end if;
  if (select count(*) from public.portal_audit_events) <> 0 then
    raise exception 'Production invariant failed: migration must not create audit rows';
  end if;
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'employee_user_links'
      and c.conname = 'employee_user_links_portal_status_check'
  ) then
    raise exception 'Production invariant failed: portal_status constraint missing';
  end if;
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'employees'
      and t.tgname = 'protect_employee_history_from_delete'
      and not t.tgisinternal
  ) then
    raise exception 'Production invariant failed: hard-delete trigger missing';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'employees'
      and policyname = 'employee_portal_super_admin_employee_select'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'leave_entries'
      and policyname = 'employee_portal_super_admin_leave_select'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'companies'
      and policyname = 'employee_portal_authenticated_company_select'
  ) then
    raise exception 'Production invariant failed: Portal RLS policies missing';
  end if;
end;
$production_invariants$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', pilot_user_id::text,
    'role', 'authenticated'
  )::text,
  true
)
from employee_portal_v2_production_context;
set local role authenticated;

do $employee_rls$
declare
  v_pilot_employee_id uuid;
begin
  select pilot_employee_id into strict v_pilot_employee_id
  from employee_portal_v2_production_context;

  if (select count(*) from public.employees) <> 1
     or not exists (select 1 from public.employees where id = v_pilot_employee_id) then
    raise exception 'Employee RLS failed: own employee row not exclusively visible';
  end if;
  if exists (select 1 from public.employees where id <> v_pilot_employee_id) then
    raise exception 'Employee RLS failed: cross-employee row visible';
  end if;
  if exists (select 1 from public.leave_entries where employee_id <> v_pilot_employee_id) then
    raise exception 'Employee RLS failed: cross-employee PTO row visible';
  end if;
  if (select count(*) from public.employee_user_links) <> 1 then
    raise exception 'Employee RLS failed: own link not visible';
  end if;
end;
$employee_rls$;

reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', super_admin_user_id::text,
    'role', 'authenticated'
  )::text,
  true
)
from employee_portal_v2_production_context;
set local role authenticated;

do $super_admin_rls$
begin
  if (select count(*) from public.employees) <> 42 then
    raise exception 'super_admin RLS failed: employees not fully visible';
  end if;
  if (select count(*) from public.leave_entries) <> 1141 then
    raise exception 'super_admin RLS failed: leave_entries not fully visible';
  end if;
  if (select count(*) from public.employee_user_links) <> 1 then
    raise exception 'super_admin RLS failed: employee link not visible';
  end if;
  if (select count(*) from public.user_company_roles) <> 3 then
    raise exception 'super_admin RLS failed: company roles not fully visible';
  end if;
end;
$super_admin_rls$;

reset role;

create temp table employee_portal_v2_hr_expected on commit drop as
with allowed_companies as (
  select distinct r.company_id
  from employee_portal_v2_production_context c
  join public.user_company_roles r on r.user_id = c.hr_user_id
  where r.role in ('hr_admin', 'company_admin')
)
select
  (
    select count(*)
    from public.employees e
    where e.company_id in (select company_id from allowed_companies)
  ) as employee_count,
  (
    select count(*)
    from public.leave_entries le
    join public.employees e on e.id = le.employee_id
    where e.company_id in (select company_id from allowed_companies)
  ) as leave_count;

grant select on employee_portal_v2_hr_expected to authenticated;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', hr_user_id::text,
    'role', 'authenticated'
  )::text,
  true
)
from employee_portal_v2_production_context;
set local role authenticated;

do $hr_rls$
declare
  v_expected employee_portal_v2_hr_expected%rowtype;
begin
  select * into strict v_expected from employee_portal_v2_hr_expected;
  if (select count(*) from public.employees) <> v_expected.employee_count then
    raise exception 'HR RLS failed: employee scope changed';
  end if;
  if (select count(*) from public.leave_entries) <> v_expected.leave_count then
    raise exception 'HR RLS failed: PTO scope changed';
  end if;
end;
$hr_rls$;

reset role;

select jsonb_build_object(
  'status', 'PASS',
  'employees', (select count(*) from public.employees),
  'leave_entries', (select count(*) from public.leave_entries),
  'auth_users', (select count(*) from auth.users),
  'user_profiles', (select count(*) from public.user_profiles),
  'employee_links', (select count(*) from public.employee_user_links),
  'termination_inconsistencies', (
    select count(*) from public.employees
    where is_active = true
      and end_date is not null
      and end_date < (current_timestamp at time zone 'America/Vancouver')::date
  ),
  'pilot_defaults_ok', exists (
    select 1 from public.employee_user_links
    where employee_id = 'f92744b5-d28a-476c-b34e-198ced787983'::uuid
      and user_id = '766bd724-c766-4257-8312-e48623a535f3'::uuid
      and portal_status = 'active'
      and password_setup_required = false
  ),
  'timothy_unchanged', (
    select count(*) from auth.users u
    left join public.user_profiles p on p.user_id = u.id
    where p.user_id is null and lower(coalesce(u.email, '')) like '%timothy%'
  ) = 1
) as employee_portal_v2_production_verify;
