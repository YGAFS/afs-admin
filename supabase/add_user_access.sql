-- ============================================================
-- Per-user section access control
-- Restricts which top-level sidebar sections (/hr, /utilities,
-- /licenses, /assets, /supplies, /admin) a user can see and reach.
-- A user with NO row here (or allowed_sections = null) has full access
-- to every section — this is the default for existing users.
-- Safe to run multiple times.
-- ============================================================

create table if not exists user_access (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique,
  allowed_sections text[],  -- null = full access; e.g. '{utilities}' = Utility Dashboard only
  created_at       timestamptz not null default now()
);

alter table user_access enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='user_access' and policyname='user_access_select') then
    create policy "user_access_select" on user_access for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='user_access' and policyname='user_access_all') then
    create policy "user_access_all" on user_access for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Example: restrict YG to the Utility Dashboard only
insert into user_access (email, allowed_sections)
values ('yungyeong.j@afstransco.com', array['utilities'])
on conflict (email) do update set allowed_sections = excluded.allowed_sections;
