-- ============================================================
-- Add default location_id to utility_vendors
-- Safe to run multiple times
-- ============================================================

alter table utility_vendors
  add column if not exists location_id uuid references utility_locations(id) on delete set null;
