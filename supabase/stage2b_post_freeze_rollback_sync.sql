-- Emergency rollback preparation after AUTHZ_PERMISSION_MUTATION_FREEZE was
-- not maintained. Re-enable freeze in BOTH deployments before running this SQL.
-- This synchronizes the current UUID permission state back to legacy tables,
-- then a separate logical rollback may clear authz_migrated_at.

begin;

lock table
  public.user_profiles,
  public.user_section_access,
  public.app_user_roles,
  public.user_access,
  public.app_access
in share row exclusive mode;

do $assert$
begin
  if (select count(*) from public.user_profiles where authz_migrated_at is not null) = 0 then
    raise exception 'rollback sync requires at least one UUID-migrated profile';
  end if;
end;
$assert$;

-- UUID section deny is represented as an explicit empty legacy array, never by
-- deleting the row (which would revive the legacy full-access interpretation).
insert into public.user_access (email, allowed_sections)
select
  lower(u.email),
  coalesce(
    (
      select array_agg(sa.section_key order by sa.section_key)
      from public.user_section_access sa
      where sa.user_id = p.user_id
    ),
    '{}'::text[]
  )
from public.user_profiles p
join auth.users u on u.id = p.user_id
where p.authz_migrated_at is not null
on conflict (email) do update
set allowed_sections = excluded.allowed_sections;

-- Reconstruct the legacy Warehousing role from UUID app roles. A missing UUID
-- app role means the legacy row must not survive the rollback.
delete from public.app_access aa
using public.user_profiles p
join auth.users u on u.id = p.user_id
where p.authz_migrated_at is not null
  and lower(aa.email) = lower(u.email)
  and aa.app = 'warehousing';

insert into public.app_access (email, app, role)
select lower(u.email), ar.app_key, ar.role
from public.user_profiles p
join auth.users u on u.id = p.user_id
join public.app_user_roles ar on ar.user_id = p.user_id
where p.authz_migrated_at is not null;

commit;

-- After this script succeeds, run stage2b_logical_rollback.sql while freeze is
-- still true, then deploy the legacy code. Do not drop UUID tables yet.
