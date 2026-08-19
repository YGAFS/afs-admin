-- ============================================================
-- app_access: the seed of a shared, cross-app identity system.
-- One row per (email, app) -- which AFS Internal apps a user can open,
-- and their role within that app. Additive-only: the existing HR app's
-- `user_access` table (allowed_sections, HR's own section-gating) is
-- untouched and unrelated to this table.
--
-- Unlike user_access (no row = full access), a missing row here means
-- NO access -- deliberate, since this seeds an app that handles
-- approvals and purchase/accounting data. Safe to run multiple times.
-- ============================================================

create table if not exists app_access (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  app         text not null,              -- e.g. 'warehousing'; future apps use their own value
  role        text not null,              -- app-defined; warehousing: requester|purchasing|operations|bookkeeping|admin
  created_at  timestamptz not null default now(),
  unique (email, app)
);

alter table app_access enable row level security;

create policy "app_access_select" on app_access
  for select to authenticated using (true);
create policy "app_access_all" on app_access
  for all to authenticated using (true) with check (true);

-- Seed the one known admin so someone can log in on day one and grant
-- everyone else's role via the /admin panel -- otherwise nobody could
-- reach the app at all after first deploy.
insert into app_access (email, app, role)
values ('admin@afstransco.com', 'warehousing', 'admin')
on conflict (email, app) do nothing;
