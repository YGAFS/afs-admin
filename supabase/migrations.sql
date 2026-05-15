-- ============================================================
-- AFS Admin — Supabase 마이그레이션
-- Supabase SQL Editor에서 실행하세요
-- ============================================================

-- 1. subscriptions 테이블 생성
--    (Acrobat Reader, Loadlink 등 M365 외 구독 서비스 관리)
CREATE TABLE IF NOT EXISTS subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_id        text,
  company       text,
  vendor        text,
  product       text,
  plan_name     text,
  billing_cycle text,               -- 'Monthly' | 'Annual' | 'One-time'
  cost_cad      numeric(10,2) DEFAULT 0,
  renewal_date  date,
  employee_id   uuid REFERENCES employees(id) ON DELETE SET NULL,
  owner         text,
  status        text DEFAULT 'Active',  -- 'Active' | 'Inactive'
  notes         text,
  created_at    timestamptz DEFAULT now()
);

-- 2. assets 테이블에 company 컬럼 추가
--    (직원 배정과 무관하게 회사별 자산 관리)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS company text;
