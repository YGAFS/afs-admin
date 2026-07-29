-- Allow multiple leave_entries rows per (employee_id, date) — one per leave_code —
-- so a single day can carry more than one status (e.g. AM Paid Leave + PM WFH).
-- Moves the uniqueness constraint from (employee_id, date) to (employee_id, date, leave_code).

DO $$
DECLARE
  cons_name text;
BEGIN
  SELECT c.conname INTO cons_name
  FROM pg_constraint c
  WHERE c.conrelid = 'leave_entries'::regclass
    AND c.contype = 'u'
    AND (
      SELECT array_agg(a.attname ORDER BY a.attname)
      FROM unnest(c.conkey) AS k(attnum)
      JOIN pg_attribute a ON a.attnum = k.attnum AND a.attrelid = c.conrelid
    ) = ARRAY['date', 'employee_id']::name[]
  LIMIT 1;

  IF cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE leave_entries DROP CONSTRAINT %I', cons_name);
  END IF;
END $$;

ALTER TABLE leave_entries
  ADD CONSTRAINT leave_entries_employee_date_code_key UNIQUE (employee_id, date, leave_code);
