-- T08 · 내 소개 페이지에 패스키 달기
-- [개발 · DB구축 + 인증] 패스키 공개키, 로그인 세션, 비공개 메모를 저장하는 표
--
-- Supabase 대시보드 → SQL Editor 에 전부 붙여 넣고 Run 합니다. 여러 번 실행해도 안전합니다.
-- 이 표들은 Vercel 서버 함수만 서버 전용 비밀 키(service_role)로 읽고 씁니다.
-- 행 수준 보안(RLS)을 켜고 정책을 하나도 만들지 않으므로, 브라우저에서 쓰는 공개 키(anon)나
-- 로그인 역할(authenticated)로는 어떤 행도 읽거나 쓸 수 없습니다.

create extension if not exists pgcrypto;

create table if not exists public.t08_users (
  id           uuid primary key,
  handle       text not null unique check (handle ~ '^[a-z0-9_-]{3,30}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at   timestamptz not null default now()
);

create table if not exists public.t08_passkeys (
  id           text primary key,                      -- WebAuthn credential id (base64url)
  user_id      uuid not null references public.t08_users(id) on delete cascade,
  public_key   text not null,                         -- COSE 공개키 (base64url). 비밀키는 기기 밖으로 나오지 않는다
  counter      bigint not null default 0,
  transports   jsonb,
  device_type  text,                                  -- singleDevice | multiDevice
  backed_up    boolean not null default false,
  nickname     text check (nickname is null or char_length(nickname) <= 40),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists t08_passkeys_user_idx on public.t08_passkeys (user_id);

-- 등록·로그인 한 번에 한 번만 쓰는 챌린지 (5분 뒤 만료, 꺼내면서 지움)
create table if not exists public.t08_challenges (
  id         uuid primary key,
  purpose    text not null check (purpose in ('register', 'login')),
  challenge  text not null,
  user_id    uuid,
  meta       jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null
);

-- 로그인 세션: 쿠키에는 무작위 토큰, 여기에는 그 SHA-256 해시만 저장
create table if not exists public.t08_sessions (
  token_hash text primary key,
  user_id    uuid not null references public.t08_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists t08_sessions_user_idx on public.t08_sessions (user_id);

-- 비공개 영역의 자료
create table if not exists public.t08_notes (
  id         uuid primary key,
  user_id    uuid not null references public.t08_users(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists t08_notes_user_idx on public.t08_notes (user_id, created_at desc);

-- 브라우저 쪽 역할에는 아무 권한도 주지 않는다
do $$
declare
  t text;
begin
  foreach t in array array['t08_users', 't08_passkeys', 't08_challenges', 't08_sessions', 't08_notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
