-- Attendance flags: mark late arrival / early leave with an optional time and reason,
-- independent of leave codes and notes (a day can have any combination of all three).
CREATE TABLE IF NOT EXISTS attendance_flags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date         date NOT NULL,
  flag_type    text NOT NULL CHECK (flag_type IN ('late', 'early_leave')),
  time         text,
  reason       text,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (employee_id, date, flag_type)
);

ALTER TABLE attendance_flags DISABLE ROW LEVEL SECURITY;
