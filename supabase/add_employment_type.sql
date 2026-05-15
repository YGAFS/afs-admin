-- ============================================================
-- employment_type 컬럼 추가
-- Supabase SQL Editor에서 실행
-- ============================================================

-- office    = 사무실 근무 (근태 캘린더 표시)
-- remote    = 해외/재택 원격 근무 (근태 캘린더 제외)
-- contractor = 외주/IC (근태 캘린더 제외)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS employment_type text DEFAULT 'office';
