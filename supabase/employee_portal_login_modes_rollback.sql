-- Roll back login-mode additions. Refuses destructive rollback after an
-- Admin-managed identity has been provisioned.
begin;

do $$
begin
  if exists (
    select 1 from public.employee_user_links
    where portal_login_mode = 'admin_managed' or portal_login_id is not null
  ) then
    raise exception 'Rollback refused: Admin-managed Portal identities exist';
  end if;
end $$;

drop function if exists public.portal_finalize_password_setup(uuid);
drop function if exists public.portal_admin_provision_login_v2(uuid, uuid, uuid, text, text, text);
drop function if exists public.portal_allocate_login_id(uuid);
drop function if exists public.portal_consume_login_attempt(text, integer, integer, integer);
drop table if exists public.portal_login_rate_limits;
drop sequence if exists public.portal_login_id_seq;
drop index if exists public.employee_user_links_portal_login_id_unique;
alter table public.employee_user_links
  drop constraint if exists employee_user_links_login_identity_check,
  drop constraint if exists employee_user_links_login_mode_check,
  drop column if exists portal_login_id,
  drop column if exists portal_login_mode;

-- The old authenticated completion RPC is intentionally not restored.
commit;
