-- Add the TNT and ZFS HR manager identities after the Supabase Auth users
-- have been created. Run in the Supabase SQL Editor with service access.
-- The script is idempotent and fails if either Auth identity or company is
-- missing, so a typo cannot create a partially scoped manager.

begin;

do $$
begin
  if not exists (select 1 from auth.users where lower(email) = 'tntadmin@tnt-expresslines.com' and deleted_at is null) then
    raise exception 'Auth user not found: tntadmin@tnt-expresslines.com';
  end if;
  if not exists (select 1 from auth.users where lower(email) = 'admin@zenithfortio.com' and deleted_at is null) then
    raise exception 'Auth user not found: admin@zenithfortio.com';
  end if;
  if not exists (select 1 from public.companies where upper(code) = 'TNT') then
    raise exception 'Company not found: TNT';
  end if;
  if not exists (select 1 from public.companies where upper(code) = 'ZFS') then
    raise exception 'Company not found: ZFS';
  end if;
end;
$$;

insert into public.user_profiles (user_id, display_name, email_label, status, authz_migrated_at)
select u.id,
       case lower(u.email)
         when 'tntadmin@tnt-expresslines.com' then 'TNT Admin'
         when 'admin@zenithfortio.com' then 'ZFS Admin'
       end,
       lower(u.email), 'active', now()
  from auth.users u
 where lower(u.email) in ('tntadmin@tnt-expresslines.com', 'admin@zenithfortio.com')
   and u.deleted_at is null
on conflict (user_id) do update
  set display_name = excluded.display_name,
      email_label = excluded.email_label,
      status = 'active',
      authz_migrated_at = coalesce(user_profiles.authz_migrated_at, excluded.authz_migrated_at),
      updated_at = now();

insert into public.user_company_roles (user_id, company_id, role)
select u.id, c.id, 'company_admin'
  from auth.users u
  join public.companies c on upper(c.code) = case lower(u.email)
    when 'tntadmin@tnt-expresslines.com' then 'TNT'
    when 'admin@zenithfortio.com' then 'ZFS'
  end
 where lower(u.email) in ('tntadmin@tnt-expresslines.com', 'admin@zenithfortio.com')
   and u.deleted_at is null
on conflict (user_id, company_id, role) do nothing;

insert into public.user_section_access (user_id, section_key)
select u.id, 'hr'
  from auth.users u
 where lower(u.email) in ('tntadmin@tnt-expresslines.com', 'admin@zenithfortio.com')
   and u.deleted_at is null
on conflict (user_id, section_key) do nothing;

commit;

-- Verification
select lower(u.email) as email, upper(c.code) as company_code, r.role, a.section_key
  from auth.users u
  join public.user_company_roles r on r.user_id = u.id
  join public.companies c on c.id = r.company_id
  join public.user_section_access a on a.user_id = u.id and a.section_key = 'hr'
 where lower(u.email) in ('tntadmin@tnt-expresslines.com', 'admin@zenithfortio.com')
 order by email;
