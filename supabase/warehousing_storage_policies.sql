-- ============================================================
-- Storage RLS policies for the `purchase-attachments` bucket.
--
-- The bucket itself must be created first via the Supabase Dashboard
-- (Storage → New Bucket → name "purchase-attachments" → uncheck "Public")
-- -- bucket creation isn't exposed through a plain SQL migration.
-- Run this file AFTER creating that bucket. Safe to run multiple times.
-- ============================================================

drop policy if exists "purchase_attachments_select" on storage.objects;
drop policy if exists "purchase_attachments_insert" on storage.objects;
drop policy if exists "purchase_attachments_delete" on storage.objects;

create policy "purchase_attachments_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'purchase-attachments');

create policy "purchase_attachments_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'purchase-attachments');

create policy "purchase_attachments_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'purchase-attachments');
