-- Stage 2C-B HR RLS (PREPARED ONLY — DO NOT RUN YET)
-- Scope: employees, leave_entries, attendance_notes, attendance_flags.
-- This migration intentionally excludes companies and does not assign roles/links.

BEGIN;

-- Fail fast unless the database still matches the verified pre-RLS baseline.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('employees'::text, false, false),
      ('leave_entries'::text, false, false),
      ('attendance_notes'::text, true, false),
      ('attendance_flags'::text, false, false)
    ) AS expected(tablename, rls_enabled, rls_forced)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = r.tablename
        AND c.relkind = 'r'
        AND c.relrowsecurity = r.rls_enabled
        AND c.relforcerowsecurity = r.rls_forced
    ) THEN
      RAISE EXCEPTION 'Stage 2C-B baseline mismatch: RLS state for public.%', r.tablename;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('employees', 'leave_entries', 'attendance_flags')) THEN
    RAISE EXCEPTION 'Stage 2C-B baseline mismatch: unexpected policy exists on employees, leave_entries, or attendance_flags';
  END IF;

  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'attendance_notes') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'attendance_notes'
         AND policyname = 'allow_all_attendance_notes'
         AND cmd = 'ALL' AND roles = ARRAY['public']::name[]
         AND COALESCE(qual, '') IN ('true', '(true)')
         AND COALESCE(with_check, '') IN ('true', '(true)')
     ) THEN
    RAISE EXCEPTION 'Stage 2C-B baseline mismatch: attendance_notes legacy policy is not the verified permissive policy';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('employees'::text), ('leave_entries'::text), ('attendance_notes'::text), ('attendance_flags'::text)
    ) AS t(tablename)
    WHERE NOT has_table_privilege('authenticated', 'public.' || t.tablename, 'SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('anon', 'public.' || t.tablename, 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.' || t.tablename, 'SELECT,INSERT,UPDATE,DELETE')
  ) THEN
    RAISE EXCEPTION 'Stage 2C-B baseline mismatch: verified table grants have changed';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.stage2c_is_active_user()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid() AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.stage2c_is_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.stage2c_is_active_user() AND EXISTS (
    SELECT 1 FROM public.user_global_roles
    WHERE user_id = auth.uid() AND role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.stage2c_has_hr_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.stage2c_is_super_admin() OR (
    public.stage2c_is_active_user() AND EXISTS (
      SELECT 1 FROM public.user_company_roles
      WHERE user_id = auth.uid()
        AND company_id = p_company_id
        AND role IN ('hr_admin', 'company_admin')
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.stage2c_is_linked_employee(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.stage2c_is_active_user() AND EXISTS (
    SELECT 1 FROM public.employee_user_links
    WHERE employee_id = p_employee_id AND user_id = auth.uid()
  );
$$;

-- Remove the existing unrestricted notes policy before installing scoped policies.
DROP POLICY IF EXISTS allow_all_attendance_notes ON public.attendance_notes;

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY stage2c_employees_select ON public.employees
  FOR SELECT TO authenticated
  USING (
    public.stage2c_is_active_user()
    AND (public.stage2c_has_hr_company(company_id) OR public.stage2c_is_linked_employee(id))
  );

CREATE POLICY stage2c_employees_insert ON public.employees
  FOR INSERT TO authenticated
  WITH CHECK (public.stage2c_has_hr_company(company_id));

CREATE POLICY stage2c_employees_update ON public.employees
  FOR UPDATE TO authenticated
  USING (public.stage2c_has_hr_company(company_id))
  WITH CHECK (public.stage2c_has_hr_company(company_id));

CREATE POLICY stage2c_employees_delete ON public.employees
  FOR DELETE TO authenticated
  USING (public.stage2c_has_hr_company(company_id));

CREATE POLICY stage2c_leave_entries_select ON public.leave_entries
  FOR SELECT TO authenticated
  USING (
    public.stage2c_is_active_user()
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = leave_entries.employee_id
        AND (public.stage2c_has_hr_company(e.company_id) OR public.stage2c_is_linked_employee(e.id))
    )
  );

CREATE POLICY stage2c_leave_entries_insert ON public.leave_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = leave_entries.employee_id
        AND public.stage2c_has_hr_company(e.company_id)
    )
  );

CREATE POLICY stage2c_leave_entries_update ON public.leave_entries
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = leave_entries.employee_id
        AND public.stage2c_has_hr_company(e.company_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = leave_entries.employee_id
        AND public.stage2c_has_hr_company(e.company_id)
    )
  );

CREATE POLICY stage2c_leave_entries_delete ON public.leave_entries
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = leave_entries.employee_id
        AND public.stage2c_has_hr_company(e.company_id)
    )
  );

CREATE POLICY stage2c_attendance_notes_select ON public.attendance_notes
  FOR SELECT TO authenticated
  USING (
    public.stage2c_is_active_user() AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = attendance_notes.employee_id
        AND public.stage2c_has_hr_company(e.company_id)
    )
  );

CREATE POLICY stage2c_attendance_notes_insert ON public.attendance_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = attendance_notes.employee_id
        AND public.stage2c_has_hr_company(e.company_id)
    )
  );

CREATE POLICY stage2c_attendance_notes_update ON public.attendance_notes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = attendance_notes.employee_id
        AND public.stage2c_has_hr_company(e.company_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = attendance_notes.employee_id
        AND public.stage2c_has_hr_company(e.company_id)
    )
  );

CREATE POLICY stage2c_attendance_notes_delete ON public.attendance_notes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = attendance_notes.employee_id
        AND public.stage2c_has_hr_company(e.company_id)
    )
  );

CREATE POLICY stage2c_attendance_flags_select ON public.attendance_flags
  FOR SELECT TO authenticated
  USING (
    public.stage2c_is_active_user() AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = attendance_flags.employee_id
        AND public.stage2c_has_hr_company(e.company_id)
    )
  );

CREATE POLICY stage2c_attendance_flags_insert ON public.attendance_flags
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = attendance_flags.employee_id
        AND public.stage2c_has_hr_company(e.company_id)
    )
  );

CREATE POLICY stage2c_attendance_flags_update ON public.attendance_flags
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = attendance_flags.employee_id
        AND public.stage2c_has_hr_company(e.company_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = attendance_flags.employee_id
        AND public.stage2c_has_hr_company(e.company_id)
    )
  );

CREATE POLICY stage2c_attendance_flags_delete ON public.attendance_flags
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = attendance_flags.employee_id
        AND public.stage2c_has_hr_company(e.company_id)
    )
  );

-- HR browser tables are now accessed through protected server APIs.
REVOKE ALL ON public.employees, public.leave_entries, public.attendance_notes, public.attendance_flags FROM anon, authenticated;

-- The protected APIs use service_role only after the server authorization check.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees, public.leave_entries, public.attendance_notes, public.attendance_flags TO service_role;

-- Policy helper functions must be callable during authenticated RLS evaluation.
GRANT EXECUTE ON FUNCTION public.stage2c_is_active_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.stage2c_is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.stage2c_has_hr_company(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stage2c_is_linked_employee(uuid) TO authenticated;

COMMIT;
