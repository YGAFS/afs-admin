-- Employee Portal login modes: email-managed and admin-managed.
-- Additive migration intended to run after employee_portal_accounts_v2.sql.
begin;

alter table public.employee_user_links
  add column if not exists portal_login_mode text not null default 'email',
  add column if not exists portal_login_id text;

alter table public.employee_user_links
  drop constraint if exists employee_user_links_login_mode_check,
  drop constraint if exists employee_user_links_login_identity_check;

alter table public.employee_user_links
  add constraint employee_user_links_login_mode_check
    check (portal_login_mode in ('email', 'admin_managed')),
  add constraint employee_user_links_login_identity_check
    check (
      (portal_login_mode = 'email' and portal_login_id is null)
      or
      (portal_login_mode = 'admin_managed' and portal_login_id ~ '^A[0-9]{3,}$')
    );

create unique index if not exists employee_user_links_portal_login_id_unique
  on public.employee_user_links (lower(portal_login_id))
  where portal_login_id is not null;

create sequence if not exists public.portal_login_id_seq as bigint start with 1 increment by 1 no cycle;
revoke all on sequence public.portal_login_id_seq from public, anon, authenticated;

-- No public policies are created. Only the service role can use this table and
-- its functions. Keys are SHA-256 bucket identifiers, never raw IPs/Login IDs.
create table if not exists public.portal_login_rate_limits (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default clock_timestamp(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.portal_login_rate_limits enable row level security;
revoke all on table public.portal_login_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.portal_login_rate_limits to service_role;

create or replace function public.portal_consume_login_attempt(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer,
  p_block_seconds integer
)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.portal_login_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_key_hash !~ '^[0-9a-f]{64}$'
     or p_limit < 1
     or p_window_seconds < 1
     or p_block_seconds < 1 then
    return false;
  end if;

  insert into public.portal_login_rate_limits (key_hash, window_started_at, attempt_count, updated_at)
  values (p_key_hash, v_now, 0, v_now)
  on conflict (key_hash) do nothing;

  select * into v_row
  from public.portal_login_rate_limits
  where key_hash = p_key_hash
  for update;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    update public.portal_login_rate_limits set updated_at = v_now where key_hash = p_key_hash;
    return false;
  end if;

  if v_row.window_started_at + pg_catalog.make_interval(secs => p_window_seconds) <= v_now then
    update public.portal_login_rate_limits
       set window_started_at = v_now,
           attempt_count = 1,
           blocked_until = null,
           updated_at = v_now
     where key_hash = p_key_hash;
    return true;
  end if;

  if v_row.attempt_count + 1 > p_limit then
    update public.portal_login_rate_limits
       set attempt_count = attempt_count + 1,
           blocked_until = v_now + pg_catalog.make_interval(secs => p_block_seconds),
           updated_at = v_now
     where key_hash = p_key_hash;
    return false;
  end if;

  update public.portal_login_rate_limits
     set attempt_count = attempt_count + 1,
         blocked_until = null,
         updated_at = v_now
   where key_hash = p_key_hash;
  return true;
end;
$$;

revoke all on function public.portal_consume_login_attempt(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.portal_consume_login_attempt(text, integer, integer, integer) to service_role;

create or replace function public.portal_allocate_login_id(p_actor_user_id uuid)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_login_id text;
begin
  if not exists (
    select 1 from public.user_profiles p
    join public.user_global_roles r on r.user_id = p.user_id
    where p.user_id = p_actor_user_id
      and p.status = 'active'
      and r.role = 'super_admin'
  ) then raise exception 'Forbidden'; end if;

  loop
    v_login_id := 'A' || pg_catalog.lpad(pg_catalog.nextval('public.portal_login_id_seq')::text, 3, '0');
    exit when not exists (
      select 1 from public.employee_user_links
      where lower(portal_login_id) = lower(v_login_id)
    );
  end loop;
  return v_login_id;
end;
$$;

revoke all on function public.portal_allocate_login_id(uuid) from public, anon, authenticated;
grant execute on function public.portal_allocate_login_id(uuid) to service_role;

create or replace function public.portal_admin_provision_login_v2(
  p_actor_user_id uuid,
  p_employee_id uuid,
  p_auth_user_id uuid,
  p_login_mode text,
  p_portal_login_id text,
  p_login_email text
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_login_id text := upper(nullif(trim(p_portal_login_id), ''));
  v_login_email text := lower(nullif(trim(p_login_email), ''));
begin
  if not exists (
    select 1 from public.user_profiles p
    join public.user_global_roles r on r.user_id = p.user_id
    where p.user_id = p_actor_user_id
      and p.status = 'active'
      and r.role = 'super_admin'
  ) then raise exception 'Forbidden'; end if;

  if p_login_mode not in ('email', 'admin_managed') then raise exception 'Invalid login mode'; end if;
  if p_login_mode = 'email' and (v_login_email is null or v_login_id is not null) then
    raise exception 'Email-managed login requires only a login email';
  end if;
  if p_login_mode = 'admin_managed' and (v_login_id is null or v_login_id !~ '^A[0-9]{3,}$' or v_login_email is not null) then
    raise exception 'Admin-managed login requires only a valid Login ID';
  end if;

  select * into v_employee from public.employees where id = p_employee_id for update;
  if v_employee.id is null then raise exception 'Employee not found'; end if;
  if not v_employee.is_active
     or (v_employee.end_date is not null and v_employee.end_date < public.portal_business_date()) then
    raise exception 'Employee is not active';
  end if;
  if exists (select 1 from public.employee_user_links where employee_id = p_employee_id or user_id = p_auth_user_id) then
    raise exception 'Employee or Auth user is already linked';
  end if;

  if p_login_mode = 'email' then
    if v_employee.work_email is not null and lower(v_employee.work_email) <> v_login_email then
      raise exception 'Employee work email does not match requested login email';
    end if;
    update public.employees set work_email = coalesce(work_email, v_login_email) where id = p_employee_id;
  end if;

  insert into public.user_profiles (user_id, display_name, email_label, status)
  values (
    p_auth_user_id,
    v_employee.name,
    case when p_login_mode = 'email' then v_login_email else v_login_id end,
    'active'
  )
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        email_label = excluded.email_label,
        status = 'active',
        updated_at = clock_timestamp();

  insert into public.employee_user_links (
    employee_id, user_id, portal_status, password_setup_required,
    portal_login_mode, portal_login_id
  ) values (
    p_employee_id, p_auth_user_id, 'pending', true,
    p_login_mode, v_login_id
  );

  insert into public.portal_audit_events (
    actor_user_id, target_employee_id, event_type, metadata
  ) values (
    p_actor_user_id,
    p_employee_id,
    'login_created',
    jsonb_build_object('mode', p_login_mode, 'login_id', v_login_id)
  );
end;
$$;

revoke all on function public.portal_admin_provision_login_v2(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.portal_admin_provision_login_v2(uuid, uuid, uuid, text, text, text) to service_role;

-- This function is never executable by an employee. The authenticated setup
-- endpoint first updates Supabase Auth, then invokes this with service-role.
create or replace function public.portal_finalize_password_setup(p_user_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.employee_user_links l
     set portal_status = 'active',
         password_setup_required = false,
         disabled_at = null,
         disabled_by = null,
         updated_at = clock_timestamp()
    from public.employees e, public.user_profiles p
   where l.user_id = p_user_id
     and e.id = l.employee_id
     and p.user_id = l.user_id
     and p.status = 'active'
     and l.portal_status in ('pending', 'active')
     and l.password_setup_required = true
     and e.is_active = true
     and (e.end_date is null or e.end_date >= public.portal_business_date());

  get diagnostics v_updated = row_count;
  if v_updated = 1 then return true; end if;

  return exists (
    select 1
    from public.employee_user_links l
    join public.employees e on e.id = l.employee_id
    join public.user_profiles p on p.user_id = l.user_id
    where l.user_id = p_user_id
      and p.status = 'active'
      and l.portal_status = 'active'
      and l.password_setup_required = false
      and e.is_active = true
      and (e.end_date is null or e.end_date >= public.portal_business_date())
  );
end;
$$;

revoke all on function public.portal_finalize_password_setup(uuid) from public, anon, authenticated;
grant execute on function public.portal_finalize_password_setup(uuid) to service_role;

-- Remove the previous independently callable completion path. Password setup
-- completion is now coupled to a successful Auth password update server-side.
drop function if exists public.complete_portal_password_setup();

commit;
