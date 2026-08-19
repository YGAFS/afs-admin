-- ============================================================
-- Small key/value settings table — used for the bookkeeper recipient
-- email (admin-editable via /admin, not an env var, so it can change
-- without a redeploy — the brief explicitly asks not to hardcode
-- arbitrary email addresses). Safe to run multiple times.
-- ============================================================

create table if not exists warehousing_settings (
  key         text primary key,
  value       text,
  updated_at  timestamptz not null default now()
);

alter table warehousing_settings enable row level security;
create policy "warehousing_settings_select" on warehousing_settings for select to authenticated using (true);
create policy "warehousing_settings_all"    on warehousing_settings for all    to authenticated using (true) with check (true);
