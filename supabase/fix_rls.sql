-- ============================================================
-- RLS 비활성화 (licenses, assets와 동일하게 맞춤)
-- Supabase SQL Editor에서 실행
-- ============================================================
ALTER TABLE subscriptions          DISABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_employees DISABLE ROW LEVEL SECURITY;
