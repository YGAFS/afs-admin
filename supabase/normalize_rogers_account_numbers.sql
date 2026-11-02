-- Keep Rogers account numbers in the same display format used on the bills.
-- This is safe to run repeatedly; only the numeric-only variants are changed.

update public.utility_bills
set account_number = '5-0781-2423'
where company_id = 'afs'
  and lower(provider) = 'rogers'
  and regexp_replace(account_number, '[^0-9]', '', 'g') = '507812423';

update public.utility_bills
set account_number = '5-0882-6140'
where company_id = 'tnt'
  and lower(provider) = 'pickering rogers'
  and regexp_replace(account_number, '[^0-9]', '', 'g') = '508826140';

update public.utility_bills
set account_number = '5-0860-8702'
where company_id = 'tnt'
  and lower(provider) = 'richmond rogers'
  and regexp_replace(account_number, '[^0-9]', '', 'g') = '508608702';

update public.utility_service_accounts sa
set account_number = '5-0781-2423'
from public.utility_vendors v
where sa.vendor_id = v.id
  and v.company_id = 'afs'
  and lower(v.name) = 'rogers'
  and regexp_replace(sa.account_number, '[^0-9]', '', 'g') = '507812423';
