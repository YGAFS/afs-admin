-- Add 'C' (Special Leave — company-granted, e.g. compassionate/consolation leave)
-- to leave_code check constraint. Unlike other codes, 'C' does not deduct from
-- the employee's annual leave allowance.
ALTER TABLE leave_entries DROP CONSTRAINT leave_entries_leave_code_check;

ALTER TABLE leave_entries ADD CONSTRAINT leave_entries_leave_code_check
  CHECK (leave_code IN ('L','L1','L2','L3','S','S1','S2','S3','W','W1','W2','W3','T','T1','T2','T3','B','O','C'));
