-- ============================================================
-- Purchase Request attachments + audit trail. Run after
-- warehousing_purchase_requests.sql. Safe to run multiple times.
-- ============================================================

create table if not exists purchase_request_attachments (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references purchase_requests(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_type text,
  uploaded_by text not null,
  created_at timestamptz not null default now()
);

alter table purchase_request_attachments enable row level security;
create policy "pra_select" on purchase_request_attachments for select to authenticated using (true);
create policy "pra_all"    on purchase_request_attachments for all    to authenticated using (true) with check (true);

-- Audit trail — written app-side at every status-changing action and every
-- PO-field edit (old→new value goes in `detail`), matching this project's
-- established convention of encoding business rules in app code, not
-- database triggers.
create table if not exists purchase_request_activity (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references purchase_requests(id) on delete cascade,
  actor_email text not null,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists pra_activity_request_idx on purchase_request_activity (purchase_request_id, created_at);

alter table purchase_request_activity enable row level security;
create policy "activity_select" on purchase_request_activity for select to authenticated using (true);
create policy "activity_insert" on purchase_request_activity for insert to authenticated with check (true);
