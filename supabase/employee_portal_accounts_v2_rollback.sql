-- Roll back Employee Portal account lifecycle v2.
-- WARNING: this removes v2 audit rows and lifecycle/email fields.
begin;

drop trigger if exists protect_employee_history_from_delete on public.employees;
drop function if exists public.protect_employee_history_from_delete();

drop function if exists public.portal_admin_set_account_enabled(uuid, uuid, boolean, text);
drop function if exists public.portal_admin_reset_login(uuid, uuid);
drop function if exists public.portal_admin_provision_login(uuid, uuid, uuid, text);
drop function if exists public.audit_admin_portal_view(uuid);
drop function if exists public.complete_portal_password_setup();

drop policy if exists employee_user_links_super_admin_select on public.employee_user_links;
drop policy if exists employee_portal_super_admin_leave_select on public.leave_entries;
drop policy if exists employee_portal_super_admin_employee_select on public.employees;
drop policy if exists employee_portal_authenticated_company_select on public.companies;

drop policy if exists user_company_roles_self_select on public.user_company_roles;
create policy user_company_roles_self_select on public.user_company_roles
  for select to authenticated using (user_id = auth.uid());

revoke select on public.employees, public.leave_entries from authenticated;

-- Restore the pre-v2 Stage 2C link predicate.
create or replace function public.stage2c_is_linked_employee(p_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.stage2c_is_active_user() and exists (
    select 1 from public.employee_user_links
    where employee_id = p_employee_id and user_id = auth.uid()
  );
$$;

grant execute on function public.stage2c_is_linked_employee(uuid) to authenticated;

drop table if exists public.portal_audit_events;

alter table public.employee_user_links
  drop constraint if exists employee_user_links_portal_status_check,
  drop column if exists portal_status,
  drop column if exists password_setup_required,
  drop column if exists disabled_at,
  drop column if exists disabled_by,
  drop column if exists archived_login_email,
  drop column if exists updated_at;

drop index if exists public.employees_active_work_email_unique;
alter table public.employees drop column if exists work_email;

-- Shared HR compatibility columns and their grants are intentionally retained.
-- They may predate Portal v2 and are not Portal account data.

drop function if exists public.portal_business_date();

commit;
