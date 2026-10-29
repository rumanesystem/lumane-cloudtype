-- ============================================================
-- 2026-10-29 관리자 로그인 유지 표 (lumane.admin_sessions)
--
-- 목적: 한 번 로그인한 기기는 로그아웃 전까지 유지 · 운영 배포·서버 재시작에도 유지.
--   - 지금까지는 로그인 정보를 서버 메모리에만 들고 있어서 재시작하면 전부 풀렸음.
--   - 저장하는 것: 로그인 표의 sha256 해시 · 이메일 · CSRF 해시 · 만든 시각.
--     토큰 원문과 비밀번호는 저장하지 않음.
--
-- 실행 위치: Supabase Dashboard → SQL Editor (yqjyaxceeovllkuknvrf)
-- 순서: 이 SQL 먼저 실행 → 그 다음 코드 배포 (push).
--   (순서가 바뀌어도 잠기지는 않음 · 표가 생기기 전까지는 예전처럼 재시작하면 로그인이 풀림)
-- 여러 번 실행해도 안전함.
-- ============================================================

create table if not exists lumane.admin_sessions (
  token_hash  text primary key,
  email       text not null,
  csrf_hashes jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

-- 서버(service_role)가 이 표를 읽고 쓸 권한 · lumane 스키마의 새 표는 자동으로 주어지지 않음.
-- (10-29 운영에서 이 줄이 빠져 관리자 로그인이 "저장하지 못했습니다"로 막혔음 → 이 줄 실행으로 해결)
grant select, insert, update, delete on lumane.admin_sessions to service_role;

-- 서버는 secret key 로 접근하므로 RLS 를 켜도 동작함.
-- 정책을 만들지 않아 공개 키(anon)로는 읽기·쓰기 모두 막힘.
alter table lumane.admin_sessions enable row level security;

-- 확인: 표가 있으면 끝 (처음엔 0줄).
select to_regclass('lumane.admin_sessions') as admin_sessions_table,
       (select count(*) from lumane.admin_sessions) as rows;

-- ------------------------------------------------------------
-- [필요할 때만] 기기 강제 로그아웃
--   기기를 잃어버렸거나 다른 사람이 쓰게 됐을 때 실행.
--   지운 뒤 그 기기는 다음 로그인 확인 때 로그인 화면으로 감
--   (관리자 화면은 1분 간격으로 확인 · 그 밖의 요청은 서버가 5분 간격으로 DB 와 맞춰 봄).
--
-- 특정 계정의 모든 기기:
--   delete from lumane.admin_sessions where email = '관리자이메일';
-- 전체 관리자 모든 기기:
--   delete from lumane.admin_sessions;
-- ------------------------------------------------------------
