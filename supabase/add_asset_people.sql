-- Asset People: non-HR assignees (contractors, foreign team, etc.)
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS asset_people (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name    TEXT NOT NULL,
  email   TEXT,
  company TEXT
);

ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_people_id UUID REFERENCES asset_people(id);
