-- Add 'O' (Overtime) to leave_code check constraint
ALTER TABLE leave_entries DROP CONSTRAINT leave_entries_leave_code_check;

ALTER TABLE leave_entries ADD CONSTRAINT leave_entries_leave_code_check
  CHECK (leave_code IN ('L','L1','L2','L3','S','S1','S2','S3','W','W1','W2','W3','T','T1','T2','T3','B','O'));
