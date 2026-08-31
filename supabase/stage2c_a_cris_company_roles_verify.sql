SELECT
  u.id AS user_id,
  u.email,
  c.code AS company_code,
  c.id AS company_id,
  ucr.role
FROM auth.users u
JOIN public.user_company_roles ucr ON ucr.user_id = u.id
JOIN public.companies c ON c.id = ucr.company_id
WHERE lower(u.email) = lower('cris.b@afstransco.com')
ORDER BY c.code, ucr.role;

SELECT COUNT(*) AS expected_hr_admin_rows
FROM auth.users u
JOIN public.user_company_roles ucr ON ucr.user_id = u.id
JOIN public.companies c ON c.id = ucr.company_id
WHERE lower(u.email) = lower('cris.b@afstransco.com')
  AND ucr.role = 'hr_admin'
  AND c.code IN ('AFS', 'TNT', 'ZFS');

SELECT
  EXISTS (
    SELECT 1 FROM public.user_global_roles ugr
    JOIN auth.users u ON u.id = ugr.user_id
    WHERE lower(u.email) = lower('cris.b@afstransco.com')
      AND ugr.role = 'super_admin'
  ) AS cris_is_super_admin,
  (
    SELECT COALESCE(array_agg(usa.section_key ORDER BY usa.section_key), ARRAY[]::text[])
    FROM public.user_section_access usa
    JOIN auth.users u ON u.id = usa.user_id
    WHERE lower(u.email) = lower('cris.b@afstransco.com')
  ) AS cris_root_sections;
