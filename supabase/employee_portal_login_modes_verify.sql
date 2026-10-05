-- Verify Employee Portal login modes. All row mutations are rolled back.
begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employee_user_links'
      and column_name = 'portal_login_mode'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employee_user_links'
      and column_name = 'portal_login_id'
  ) then raise exception 'Login mode columns are missing'; end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'employee_user_links'
      and indexname = 'employee_user_links_portal_login_id_unique'
      and indexdef ilike '%lower(portal_login_id)%'
  ) then raise exception 'Case-insensitive Login ID uniqueness is missing'; end if;

  if to_regclass('public.portal_login_id_seq') is null then
    raise exception 'Atomic Login ID sequence is missing';
  end if;
  if to_regclass('public.portal_login_rate_limits') is null then
    raise exception 'Server-side login rate-limit table is missing';
  end if;
  if to_regprocedure('public.complete_portal_password_setup()') is not null then
    raise exception 'Independent password setup completion RPC still exists';
  end if;
  if has_function_privilege('authenticated', 'public.portal_finalize_password_setup(uuid)', 'EXECUTE') then
    raise exception 'Authenticated users must not execute password setup finalization';
  end if;
  if has_function_privilege('anon', 'public.portal_allocate_login_id(uuid)', 'EXECUTE') then
    raise exception 'Anonymous users must not allocate Login IDs';
  end if;
  if has_table_privilege('authenticated', 'public.portal_login_rate_limits', 'SELECT') then
    raise exception 'Authenticated users must not read login rate-limit buckets';
  end if;
  if exists (
    select 1 from public.employee_user_links
    where portal_login_mode = 'email' and portal_login_id is not null
  ) then raise exception 'Email-managed account has a Login ID'; end if;
end $$;

-- Existing links migrate to email-managed without changing their identity or
-- lifecycle state. Exercise constraints using one existing link if available.
do $$
declare
  v_employee_id uuid;
begin
  select employee_id into v_employee_id from public.employee_user_links limit 1;
  if v_employee_id is not null then
    update public.employee_user_links
       set portal_login_mode = 'admin_managed', portal_login_id = 'A900000'
     where employee_id = v_employee_id;
    begin
      update public.employee_user_links set portal_login_id = 'a900000' where employee_id = v_employee_id;
      raise exception 'Lowercase Login ID should violate identity format';
    exception when check_violation then
      null;
    end;
  end if;
end $$;

rollback;
