-- Stage 2A residual patch: utility_user_roles
-- Apply only after deploying the matching fail-closed client code.
-- This migration is intentionally limited to utility_user_roles.

begin;

-- Prevent a concurrent write between the baseline assertion and the seed.
lock table public.utility_user_roles
  in share row exclusive mode;

-- Production baseline assertion: this table was verified to be empty.
do $$
begin
  if exists (select 1 from public.utility_user_roles) then
    raise exception 'Baseline assertion failed: utility_user_roles is not empty';
  end if;
end
$$;

-- Seed only the confirmed existing Utility administrator.
-- AP roles are deliberately not inferred from user_access.
insert into public.utility_user_roles (user_id, email, role)
values (
  'c29b67d9-3841-41ce-8c40-fb9f7f18bf17'::uuid,
  'admin@afstransco.com',
  'admin'
);

do $$
begin
  if (
    select count(*) from public.utility_user_roles
  ) <> 1
  or not exists (
    select 1
    from public.utility_user_roles
    where user_id = 'c29b67d9-3841-41ce-8c40-fb9f7f18bf17'::uuid
      and email = 'admin@afstransco.com'
      and role = 'admin'
  ) then
    raise exception 'Utility admin seed verification failed';
  end if;
end
$$;

drop policy if exists "roles_all" on public.utility_user_roles;
drop policy if exists "roles_select" on public.utility_user_roles;

alter table public.utility_user_roles enable row level security;

-- PUBLIC was not present in the baseline ACL, so do not grant anything to it.
revoke all privileges
  on table public.utility_user_roles
  from public;

revoke all privileges
  on table public.utility_user_roles
  from anon;

revoke all privileges
  on table public.utility_user_roles
  from authenticated;

grant select
  on table public.utility_user_roles
  to authenticated;

-- Preserve service_role access explicitly without revoking its baseline ACL.
grant select, insert, update, delete
  on table public.utility_user_roles
  to service_role;

create policy "utility_user_roles_self_select"
  on public.utility_user_roles
  for select
  to authenticated
  using (user_id = auth.uid());

commit;
