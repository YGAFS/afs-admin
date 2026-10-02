-- Run after employee_portal_accounts_v2.sql. This script uses the first active
-- linked account, mutates it only inside a transaction, and always rolls back.

begin;

create temp table portal_v2_test_context on commit drop as
select l.employee_id, l.user_id, e.company_id,
       admin_user.user_id as admin_user_id,
       (select count(*) from public.companies) as company_count,
       (select count(*) from public.user_company_roles) as company_role_count
from public.employee_user_links l
join public.user_profiles p on p.user_id = l.user_id
join public.employees e on e.id = l.employee_id
cross join lateral (
  select r.user_id
  from public.user_global_roles r
  join public.user_profiles admin_profile on admin_profile.user_id = r.user_id
  where r.role = 'super_admin' and admin_profile.status = 'active'
  limit 1
) admin_user
where p.status = 'active'
  and l.portal_status = 'active'
  and l.password_setup_required = false
  and e.is_active = true
  and (e.end_date is null or e.end_date >= public.portal_business_date())
limit 1;

-- The verification deliberately switches to the authenticated database role.
-- Granting this transaction-local table avoids testing with owner privileges.
grant select on portal_v2_test_context to authenticated;

do $$
begin
  if (select count(*) from portal_v2_test_context) <> 1 then
    raise exception 'Staging verification requires exactly one selected active linked account';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'companies'
      and policyname = 'employee_portal_authenticated_company_select'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_company_roles'
      and policyname = 'user_company_roles_self_select'
  ) then
    raise exception 'Portal company/authorization RLS policies are missing';
  end if;

  if exists (
    select 1
    from (values
      ('employees', 'team'),
      ('employees', 'position'),
      ('employees', 'vacation_allowance'),
      ('employees', 'uses_accrual'),
      ('employees', 'is_exempt'),
      ('employees', 'probation_end'),
      ('employees', 'employment_type'),
      ('employees', 'manager_name'),
      ('employees', 'sort_order'),
      ('employees', 'probation_start'),
      ('employees', 'work_email'),
      ('leave_entries', 'reported_at')
    ) required(table_name, column_name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = required.table_name
        and c.column_name = required.column_name
    )
  ) then
    raise exception 'Portal/HR compatibility columns are missing';
  end if;
end $$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id from portal_v2_test_context),
    'role', 'authenticated'
  )::text,
  true
);

set local role authenticated;
do $$
begin
  if (select count(*) from public.employees where id = (select employee_id from portal_v2_test_context)) <> 1 then
    raise exception 'Active employee self-read should be allowed';
  end if;
  if exists (select 1 from public.employees where id <> (select employee_id from portal_v2_test_context)) then
    raise exception 'Employee must not read another employee row';
  end if;
  if (select count(*) from public.companies where id = (select company_id from portal_v2_test_context)) <> 1 then
    raise exception 'Employee must be able to read their own company';
  end if;
end $$;
reset role;

-- The same target row is visible with the super_admin's own JWT/RLS context.
-- The admin identity is not changed to, or impersonated as, the employee.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select admin_user_id from portal_v2_test_context),
    'role', 'authenticated'
  )::text,
  true
);

set local role authenticated;
do $$
begin
  if (select count(*) from public.employees where id = (select employee_id from portal_v2_test_context)) <> 1 then
    raise exception 'super_admin Admin View employee read should be allowed';
  end if;
  perform count(*) from public.leave_entries
  where employee_id = (select employee_id from portal_v2_test_context);
  if (select count(*) from public.companies) <> (select company_count from portal_v2_test_context) then
    raise exception 'super_admin must be able to read all companies';
  end if;
  if (select count(*) from public.user_company_roles) <> (select company_role_count from portal_v2_test_context) then
    raise exception 'super_admin must be able to read all company-role assignments';
  end if;
end $$;
reset role;

-- Restore the original employee JWT claims for stale-token checks.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id from portal_v2_test_context),
    'role', 'authenticated'
  )::text,
  true
);

-- Simulate Admin Reset Login while the original JWT claims remain unchanged.
update public.employee_user_links
set password_setup_required = true
where employee_id = (select employee_id from portal_v2_test_context);

set local role authenticated;
do $$
begin
  if exists (select 1 from public.employees where id = (select employee_id from portal_v2_test_context)) then
    raise exception 'Stale employee token retained access after Reset Login';
  end if;
  if exists (select 1 from public.leave_entries where employee_id = (select employee_id from portal_v2_test_context)) then
    raise exception 'Stale employee token retained PTO access after Reset Login';
  end if;
end $$;
reset role;

update public.employee_user_links
set password_setup_required = false,
    portal_status = 'disabled'
where employee_id = (select employee_id from portal_v2_test_context);

set local role authenticated;
do $$
begin
  if exists (select 1 from public.employees where id = (select employee_id from portal_v2_test_context)) then
    raise exception 'Stale employee token retained access after Disable Account';
  end if;
  if exists (select 1 from public.leave_entries where employee_id = (select employee_id from portal_v2_test_context)) then
    raise exception 'Stale employee token retained PTO access after Disable Account';
  end if;
end $$;
reset role;

rollback;
