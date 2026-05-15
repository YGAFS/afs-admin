-- ============================================================
-- 결제일 카운트 + 다중 직원 연결
-- Supabase SQL Editor에서 실행
-- ============================================================

-- 1. subscriptions에 billing_day 추가 (매월 N일 자동 결제일)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_day int;  -- 1~31, NULL이면 수동 날짜

-- 2. 구독-직원 다중 연결 조인 테이블
CREATE TABLE IF NOT EXISTS subscription_employees (
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id)     ON DELETE CASCADE,
  PRIMARY KEY (subscription_id, employee_id)
);
