-- 크몽 모니터링 상태 저장 테이블
-- Supabase SQL Editor에서 실행

CREATE TABLE IF NOT EXISTS kmong_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 초기 데이터
INSERT INTO kmong_state (key, value) VALUES
  ('alarms',     '{"inboxes":0,"orders":0,"kmong":0}'),
  ('last_check', now()::TEXT)
ON CONFLICT (key) DO NOTHING;
