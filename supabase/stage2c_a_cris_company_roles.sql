-- Stage 2C-A: assign Cris explicit company-scoped HR administration.
-- This migration intentionally does not modify global roles or section access.
DO $$
DECLARE
  v_user_id uuid;
  v_afs_id uuid;
  v_tnt_id uuid;
  v_zfs_id uuid;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower('cris.b@afstransco.com');
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'cris.b@afstransco.com was not found in auth.users';
  END IF;

  SELECT id INTO v_afs_id FROM public.companies WHERE code = 'AFS';
  SELECT id INTO v_tnt_id FROM public.companies WHERE code = 'TNT';
  SELECT id INTO v_zfs_id FROM public.companies WHERE code = 'ZFS';
  IF v_afs_id IS NULL OR v_tnt_id IS NULL OR v_zfs_id IS NULL THEN
    RAISE EXCEPTION 'Expected canonical AFS/TNT/ZFS companies were not found';
  END IF;

  INSERT INTO public.user_company_roles (user_id, company_id, role)
  VALUES
    (v_user_id, v_afs_id, 'hr_admin'),
    (v_user_id, v_tnt_id, 'hr_admin'),
    (v_user_id, v_zfs_id, 'hr_admin')
  ON CONFLICT (user_id, company_id, role) DO NOTHING;
END $$;
