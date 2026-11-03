-- Asset People: non-HR assignees (contractors, foreign team, etc.)
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS asset_people (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name    TEXT NOT NULL,
  email   TEXT,
  company TEXT
);

ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_people_id UUID REFERENCES asset_people(id);

-- The app uses the same direct Supabase client for assets and external people.
-- Keep this table aligned with the existing assets table, which is not RLS-protected.
-- Without this, INSERT/SELECT fails with "new row violates row-level security policy".
ALTER TABLE asset_people DISABLE ROW LEVEL SECURITY;
