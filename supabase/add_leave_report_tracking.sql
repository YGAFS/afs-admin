-- Track leave entries that have already been included in an attendance email report.
-- Run this in the Supabase SQL Editor before deploying the UI change.

alter table public.leave_entries
  add column if not exists reported_at timestamptz,
  add column if not exists reported_to text,
  add column if not exists reported_cc text[],
  add column if not exists reported_subject text,
  add column if not exists reported_by text;

comment on column public.leave_entries.reported_at is
  'Time when this leave entry was included in an attendance email report.';
comment on column public.leave_entries.reported_to is
  'Primary recipient email used for the latest attendance report containing this entry.';
comment on column public.leave_entries.reported_cc is
  'CC recipient emails used for the latest attendance report containing this entry.';
comment on column public.leave_entries.reported_subject is
  'Subject used for the latest attendance report containing this entry.';
comment on column public.leave_entries.reported_by is
  'Microsoft account or selected sender email that sent the latest attendance report.';
