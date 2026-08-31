-- Stage 2C-B HR RLS rollback (PREPARED ONLY — DO NOT RUN YET)
BEGIN;

-- Rollback is only valid against the Stage 2C-B state created by the forward migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('employees'::text), ('leave_entries'::text), ('attendance_notes'::text), ('attendance_flags'::text)
    ) AS t(tablename)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t.tablename
        AND c.relrowsecurity = true AND c.relforcerowsecurity = false
    )
    OR has_table_privilege('authenticated', 'public.' || t.tablename, 'SELECT')
  ) THEN
    RAISE EXCEPTION 'Stage 2C-B rollback mismatch: RLS or authenticated privileges do not match the post-migration state';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'attendance_notes'
      AND policyname = 'stage2c_attendance_notes_select'
  ) THEN
    RAISE EXCEPTION 'Stage 2C-B rollback mismatch: scoped attendance_notes policies are absent';
  END IF;
END $$;

DROP POLICY IF EXISTS stage2c_employees_select ON public.employees;
DROP POLICY IF EXISTS stage2c_employees_insert ON public.employees;
DROP POLICY IF EXISTS stage2c_employees_update ON public.employees;
DROP POLICY IF EXISTS stage2c_employees_delete ON public.employees;
DROP POLICY IF EXISTS stage2c_leave_entries_select ON public.leave_entries;
DROP POLICY IF EXISTS stage2c_leave_entries_insert ON public.leave_entries;
DROP POLICY IF EXISTS stage2c_leave_entries_update ON public.leave_entries;
DROP POLICY IF EXISTS stage2c_leave_entries_delete ON public.leave_entries;
DROP POLICY IF EXISTS stage2c_attendance_notes_select ON public.attendance_notes;
DROP POLICY IF EXISTS stage2c_attendance_notes_insert ON public.attendance_notes;
DROP POLICY IF EXISTS stage2c_attendance_notes_update ON public.attendance_notes;
DROP POLICY IF EXISTS stage2c_attendance_notes_delete ON public.attendance_notes;
DROP POLICY IF EXISTS stage2c_attendance_flags_select ON public.attendance_flags;
DROP POLICY IF EXISTS stage2c_attendance_flags_insert ON public.attendance_flags;
DROP POLICY IF EXISTS stage2c_attendance_flags_update ON public.attendance_flags;
DROP POLICY IF EXISTS stage2c_attendance_flags_delete ON public.attendance_flags;

ALTER TABLE public.employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_entries DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_flags DISABLE ROW LEVEL SECURITY;

CREATE POLICY allow_all_attendance_notes ON public.attendance_notes
  FOR ALL TO public USING (true) WITH CHECK (true);

REVOKE ALL ON public.employees, public.leave_entries, public.attendance_notes, public.attendance_flags FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees, public.leave_entries, public.attendance_notes, public.attendance_flags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees, public.leave_entries, public.attendance_notes, public.attendance_flags TO service_role;

REVOKE EXECUTE ON FUNCTION public.stage2c_is_active_user() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.stage2c_is_super_admin() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.stage2c_has_hr_company(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.stage2c_is_linked_employee(uuid) FROM authenticated;

DROP FUNCTION IF EXISTS public.stage2c_has_hr_company(uuid);
DROP FUNCTION IF EXISTS public.stage2c_is_linked_employee(uuid);
DROP FUNCTION IF EXISTS public.stage2c_is_super_admin();
DROP FUNCTION IF EXISTS public.stage2c_is_active_user();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('employees'::text, false), ('leave_entries'::text, false), ('attendance_notes'::text, true), ('attendance_flags'::text, false)
    ) AS expected(tablename, rls_enabled)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = expected.tablename
        AND c.relrowsecurity = expected.rls_enabled AND c.relforcerowsecurity = false
    )
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'attendance_notes'
      AND policyname = 'allow_all_attendance_notes' AND cmd = 'ALL'
      AND roles = ARRAY['public']::name[]
      AND COALESCE(qual, '') IN ('true', '(true)')
      AND COALESCE(with_check, '') IN ('true', '(true)')
  ) THEN
    RAISE EXCEPTION 'Stage 2C-B rollback failed to restore the verified baseline';
  END IF;
END $$;

COMMIT;
