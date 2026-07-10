-- Add issue_date and bill_number to utility_bills
-- Run in Supabase SQL Editor

ALTER TABLE utility_bills ADD COLUMN IF NOT EXISTS issue_date date;
ALTER TABLE utility_bills ADD COLUMN IF NOT EXISTS bill_number text;
