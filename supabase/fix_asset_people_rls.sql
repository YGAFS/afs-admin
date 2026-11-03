-- Fix: Manage External People was blocked by RLS on asset_people.
-- Run once in the Supabase SQL Editor for an existing database.
-- The assets page currently accesses this table through the same direct client
-- as the existing assets table, so both tables must have the same RLS setting.

ALTER TABLE public.asset_people DISABLE ROW LEVEL SECURITY;
