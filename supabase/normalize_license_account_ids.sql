-- Normalize legacy internal M365 account labels to the canonical A001 format.
-- This intentionally does not touch utility account_number values.
-- Review the preview query before running the UPDATE in Supabase SQL Editor.

select id, account_id,
       'A' || lpad(substring(trim(account_id) from '^A-?(\d{1,3})$'), 3, '0') as normalized_account_id
from licenses
where trim(account_id) ~* '^A-?\d{1,3}$'
  and trim(account_id) !~* '^A\d{3}$';

update licenses
set account_id = 'A' || lpad(substring(trim(account_id) from '^A-?(\d{1,3})$'), 3, '0')
where trim(account_id) ~* '^A-?\d{1,3}$'
  and trim(account_id) !~* '^A\d{3}$';

-- Verify there are no duplicate labels before/after adding a database constraint.
select account_id, count(*)
from licenses
group by account_id
having count(*) > 1;
