-- ============================================================
-- utility_bill_imports — audit/ledger table for the local PDF
-- ingestion worker (tools/utility_bill_ingestor). One row per PDF ever
-- processed, whatever the outcome. Used for:
--   * duplicate detection across worker restarts (source_file_hash)
--   * a full audit trail of automated bill imports
-- Safe to run multiple times. Does not touch any existing table's data.
-- ============================================================

create table if not exists utility_bill_imports (
  id                    uuid primary key default gen_random_uuid(),
  original_filename     text not null,
  normalized_filename   text,
  source_file_hash      text not null,
  source_path           text,
  archived_path         text,
  status                text not null check (status in ('completed', 'needs_review', 'failed', 'duplicate')),
  detected_vendor       text,
  detected_company_id   text,
  detected_site         text,
  parsed_data           jsonb,
  confidence            numeric(4,3),
  warnings              jsonb,
  error_message         text,
  utility_bill_id        uuid references utility_bills(id) on delete set null,
  created_at            timestamptz not null default now(),
  processed_at          timestamptz
);

create unique index if not exists utility_bill_imports_hash_idx
  on utility_bill_imports (source_file_hash);

create index if not exists utility_bill_imports_status_idx
  on utility_bill_imports (status);

alter table utility_bill_imports enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='utility_bill_imports' and policyname='utility_bill_imports_select') then
    create policy "utility_bill_imports_select" on utility_bill_imports for select to authenticated using (true);
  end if;
end $$;

-- No insert/update/delete policy for the anon/authenticated roles on
-- purpose — the ingestor worker writes using the service_role key, which
-- bypasses RLS entirely. This keeps the import ledger read-only from the
-- Next.js app (browsing/audit only) unless you deliberately add a write
-- policy later (e.g. for an in-app "retry" button).
