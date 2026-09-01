-- Phase 1 (manual rollout): add signed HR authorization claims to Supabase JWTs.
-- Do not run automatically. After review, run this SQL and enable the
-- public.custom_access_token_hook function in Supabase Auth > Hooks.
-- Employee Portal authorization does not consume these claims.

begin;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (event->>'user_id')::uuid;
  v_claims jsonb := coalesce(event->'claims', '{}'::jsonb);
  v_metadata jsonb := coalesce(event->'claims'->'app_metadata', '{}'::jsonb);
  v_status text;
  v_hr_role text := 'none';
  v_company_ids jsonb := '[]'::jsonb;
begin
  select p.status
    into v_status
    from public.user_profiles p
   where p.user_id = v_user_id;

  if v_status = 'active' then
    if exists (
      select 1 from public.user_global_roles g
       where g.user_id = v_user_id and g.role = 'super_admin'
    ) then
      v_hr_role := 'super_admin';
      select coalesce(jsonb_agg(c.id order by c.code), '[]'::jsonb)
        into v_company_ids
        from public.companies c;
    else
      select case
               when bool_or(r.role = 'company_admin') then 'company_admin'
               when bool_or(r.role = 'hr_admin') then 'hr_admin'
               else 'none'
             end,
             coalesce(jsonb_agg(distinct r.company_id), '[]'::jsonb)
        into v_hr_role, v_company_ids
        from public.user_company_roles r
       where r.user_id = v_user_id;
    end if;
  end if;

  v_metadata := v_metadata || jsonb_build_object(
    'hr_role', v_hr_role,
    'hr_company_ids', v_company_ids,
    'hr_active', (v_status = 'active')
  );
  v_claims := jsonb_set(v_claims, '{app_metadata}', v_metadata, true);
  return jsonb_build_object('claims', v_claims);
end;
$$;

revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

commit;

-- Manual Dashboard step after SQL review:
-- Authentication → Hooks → Custom Access Token →
-- public.custom_access_token_hook
