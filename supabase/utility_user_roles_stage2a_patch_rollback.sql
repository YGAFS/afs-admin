-- Rollback for utility_user_roles_stage2a_patch.sql
-- Restores the captured Production baseline.
-- Do not run unless rollback is explicitly required.

begin;

lock table public.utility_user_roles
  in share row exclusive mode;

drop policy if exists "utility_user_roles_self_select"
  on public.utility_user_roles;

-- Remove only ACL changes made by the patch.
revoke all privileges
  on table public.utility_user_roles
  from anon;

revoke all privileges
  on table public.utility_user_roles
  from authenticated;

-- Restore the captured direct ACL for anon.
grant delete, insert, maintain, references, select, trigger, truncate, update
  on table public.utility_user_roles
  to anon;

-- Restore the captured direct ACL for authenticated.
grant delete, insert, maintain, references, select, trigger, truncate, update
  on table public.utility_user_roles
  to authenticated;

-- PUBLIC had no explicit baseline ACL and is intentionally untouched.
-- postgres and service_role were not revoked by the patch and are untouched.

do $$
declare
  row_count integer;
begin
  select count(*)
    into row_count
    from public.utility_user_roles;

  if row_count <> 1
     or not exists (
       select 1
       from public.utility_user_roles
       where user_id = 'c29b67d9-3841-41ce-8c40-fb9f7f18bf17'::uuid
         and email = 'admin@afstransco.com'
         and role = 'admin'
     ) then
    raise exception 'Rollback aborted: unexpected utility_user_roles data';
  end if;

  delete from public.utility_user_roles
  where user_id = 'c29b67d9-3841-41ce-8c40-fb9f7f18bf17'::uuid
    and email = 'admin@afstransco.com'
    and role = 'admin';
end
$$;

create policy "roles_all"
  on public.utility_user_roles
  for all
  to authenticated
  using (true)
  with check (true);

create policy "roles_select"
  on public.utility_user_roles
  for select
  to authenticated
  using (true);

commit;
