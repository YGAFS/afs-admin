-- ============================================================
-- Add is_auto_pay to utility_service_accounts, so a vendor's specific
-- account can be flagged auto-pay from the Vendor edit modal instead of
-- only per-bill or via the ingestor's Python vendor config.
-- Safe to run multiple times.
-- ============================================================

alter table utility_service_accounts
  add column if not exists is_auto_pay boolean not null default false;
