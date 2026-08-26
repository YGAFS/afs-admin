-- Stage 2B UUID authorization cutover.
-- DO NOT RUN until:
--   1) schema-only migration is complete;
--   2) both Root and Warehousing deployments have AUTHZ_PERMISSION_MUTATION_FREEZE=true;
--   3) legacy fallback and frozen-mutation smoke tests pass.
-- This script is intentionally fail-fast and atomic.

begin;

lock table
  public.user_profiles,
  public.user_global_roles,
  public.user_company_roles,
  public.employee_user_links,
  public.user_section_access,
  public.app_user_roles,
  public.user_access,
  public.app_access,
  public.utility_user_roles
in share row exclusive mode;

-- The cutover must start from an untouched UUID authorization model.
do $assert$
declare
  v_table text;
  v_count bigint;
begin
  foreach v_table in array array[
    'user_profiles', 'user_global_roles', 'user_company_roles',
    'employee_user_links', 'user_section_access', 'app_user_roles'
  ] loop
    execute format('select count(*) from public.%I', v_table) into v_count;
    if v_count <> 0 then
      raise exception 'Stage 2B cutover requires public.% to be empty; found % rows', v_table, v_count;
    end if;
  end loop;
end;
$assert$;

-- Assert the exact Production legacy inventory approved for this cutover.
do $assert$
begin
  if (select count(*) from public.user_access) <> 3 then
    raise exception 'user_access baseline mismatch: expected 3 rows';
  end if;
  if not exists (
    select 1 from public.user_access
    where lower(email) = 'accounting@afstransco.com'
      and allowed_sections = array['utilities']::text[]
  ) then raise exception 'user_access baseline mismatch: accounting'; end if;
  if not exists (
    select 1 from public.user_access
    where lower(email) = 'cris.b@afstransco.com'
      and allowed_sections = array['hr','utilities','licenses','assets','supplies']::text[]
  ) then raise exception 'user_access baseline mismatch: cris'; end if;
  if not exists (
    select 1 from public.user_access
    where lower(email) = 'yungyeong.j@afstransco.com'
      and allowed_sections = array['utilities']::text[]
  ) then raise exception 'user_access baseline mismatch: yungyeong'; end if;

  if (select count(*) from public.app_access) <> 1 then
    raise exception 'app_access baseline mismatch: expected 1 row';
  end if;
  if not exists (
    select 1 from public.app_access
    where lower(email) = 'admin@afstransco.com'
      and app = 'warehousing'
      and role = 'admin'
  ) then raise exception 'app_access baseline mismatch: admin warehousing role'; end if;

  if (select count(*) from public.utility_user_roles) <> 1 then
    raise exception 'utility_user_roles baseline mismatch: expected 1 row';
  end if;
  if not exists (
    select 1 from public.utility_user_roles
    where lower(email) = 'admin@afstransco.com'
      and user_id = 'c29b67d9-3841-41ce-8c40-fb9f7f18bf17'::uuid
      and role = 'admin'
  ) then raise exception 'utility_user_roles baseline mismatch: admin role'; end if;
end;
$assert$;

-- Assert the exact four active auth identities before any profile is created.
do $assert$
begin
  if (select count(*) from auth.users where email is not null and deleted_at is null) <> 4 then
    raise exception 'auth.users baseline mismatch: expected 4 active email accounts';
  end if;
  if not exists (select 1 from auth.users where id = 'c29b67d9-3841-41ce-8c40-fb9f7f18bf17'::uuid and lower(email) = 'admin@afstransco.com' and deleted_at is null) then raise exception 'auth mapping mismatch: admin'; end if;
  if not exists (select 1 from auth.users where id = '02c91b44-2d40-4d97-9b6c-2bea88a9ab72'::uuid and lower(email) = 'accounting@afstransco.com' and deleted_at is null) then raise exception 'auth mapping mismatch: accounting'; end if;
  if not exists (select 1 from auth.users where id = '917c90a3-6a6b-4d34-9354-5b7df15f59c9'::uuid and lower(email) = 'cris.b@afstransco.com' and deleted_at is null) then raise exception 'auth mapping mismatch: cris'; end if;
  if not exists (select 1 from auth.users where id = '766bd724-c766-4257-8312-e48623a535f3'::uuid and lower(email) = 'yungyeong.j@afstransco.com' and deleted_at is null) then raise exception 'auth mapping mismatch: yungyeong'; end if;
end;
$assert$;

-- Explicit profile backfill. No employee-user links are inferred here.
insert into public.user_profiles (user_id, display_name, email_label, status)
values
  ('c29b67d9-3841-41ce-8c40-fb9f7f18bf17', 'Admin', 'admin@afstransco.com', 'active'),
  ('02c91b44-2d40-4d97-9b6c-2bea88a9ab72', 'Accounting', 'accounting@afstransco.com', 'active'),
  ('917c90a3-6a6b-4d34-9354-5b7df15f59c9', 'Cris B.', 'cris.b@afstransco.com', 'active'),
  ('766bd724-c766-4257-8312-e48623a535f3', 'Yungyeong J.', 'yungyeong.j@afstransco.com', 'active');

insert into public.user_global_roles (user_id, role)
values ('c29b67d9-3841-41ce-8c40-fb9f7f18bf17', 'super_admin');

-- Explicit legacy user_access -> UUID section grants. Legacy NULL/full-access is
-- not generalized; only the confirmed ADMIN_EMAILS administrator receives all keys.
insert into public.user_section_access (user_id, section_key)
select 'c29b67d9-3841-41ce-8c40-fb9f7f18bf17'::uuid, requested.section_key
  from unnest(array['hr','utilities','licenses','assets','supplies','admin']::text[]) as requested(section_key)
  where requested.section_key is not null
union all
select '02c91b44-2d40-4d97-9b6c-2bea88a9ab72'::uuid, 'utilities'
union all
select '917c90a3-6a6b-4d34-9354-5b7df15f59c9'::uuid, requested.section_key
from unnest(array['hr','utilities','licenses','assets','supplies']::text[]) as requested(section_key)
union all
select '766bd724-c766-4257-8312-e48623a535f3'::uuid, 'utilities';

-- Explicit legacy app_access -> UUID Warehousing role.
insert into public.app_user_roles (user_id, app_key, role)
values ('c29b67d9-3841-41ce-8c40-fb9f7f18bf17', 'warehousing', 'admin');

-- utility_user_roles is already UUID-based. Preserve its existing row as the
-- Utility role source of truth; do not create a duplicate utility role model.
do $assert$
begin
  if (select count(*) from public.utility_user_roles where user_id = 'c29b67d9-3841-41ce-8c40-fb9f7f18bf17'::uuid and role = 'admin') <> 1 then
    raise exception 'Utility UUID role preservation assertion failed';
  end if;
end;
$assert$;

-- Result row assertions run before the cutover marker is written.
do $assert$
begin
  if (select count(*) from public.user_profiles) <> 4 then raise exception 'user_profiles backfill mismatch'; end if;
  if (select count(*) from public.user_global_roles) <> 1 then raise exception 'user_global_roles backfill mismatch'; end if;
  if (select count(*) from public.user_section_access) <> 13 then raise exception 'user_section_access backfill mismatch'; end if;
  if (select count(*) from public.app_user_roles) <> 1 then raise exception 'app_user_roles backfill mismatch'; end if;
  if (select count(*) from public.user_company_roles) <> 0 then raise exception 'unexpected user_company_roles rows'; end if;
  if (select count(*) from public.employee_user_links) <> 0 then raise exception 'unexpected employee_user_links rows'; end if;
end;
$assert$;

-- Result privilege assertions: authenticated can only SELECT; service_role has
-- only the intended CRUD grant on the new authorization tables.
do $assert$
declare
  v_table text;
begin
  foreach v_table in array array[
    'user_profiles', 'user_global_roles', 'user_company_roles',
    'employee_user_links', 'user_section_access', 'app_user_roles'
  ] loop
    if not has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') then
      raise exception 'authenticated privilege assertion failed for %', v_table;
    end if;
    if not has_table_privilege('service_role', format('public.%I', v_table), 'SELECT')
       or not has_table_privilege('service_role', format('public.%I', v_table), 'INSERT')
       or not has_table_privilege('service_role', format('public.%I', v_table), 'UPDATE')
       or not has_table_privilege('service_role', format('public.%I', v_table), 'DELETE') then
      raise exception 'service_role privilege assertion failed for %', v_table;
    end if;
  end loop;
end;
$assert$;

-- This is deliberately the final cutover operation.
update public.user_profiles
set authz_migrated_at = clock_timestamp(), updated_at = clock_timestamp()
where user_id in (
  'c29b67d9-3841-41ce-8c40-fb9f7f18bf17'::uuid,
  '02c91b44-2d40-4d97-9b6c-2bea88a9ab72'::uuid,
  '917c90a3-6a6b-4d34-9354-5b7df15f59c9'::uuid,
  '766bd724-c766-4257-8312-e48623a535f3'::uuid
);

do $assert$
begin
  if (select count(*) from public.user_profiles where authz_migrated_at is not null) <> 4 then
    raise exception 'authz_migrated_at final cutover assertion failed';
  end if;
end;
$assert$;

commit;
