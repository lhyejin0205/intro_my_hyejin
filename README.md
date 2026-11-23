# 임혜진 포트폴리오 — 공개 소개 페이지 + 패스키 비공개 영역

- 공개 소개 페이지(1번 과제): `index.html` — 누구나 볼 수 있습니다.
- 비공개 영역(8번 과제): `private.html` — 패스키로 로그인한 본인만 자기 메모를 봅니다.

## 구조

| 경로 | 내용 |
| --- | --- |
| `index.html` | 공개 소개 페이지 (메뉴에 `🔒 Private` 링크) |
| `private.html`, `private.js` | 패스키 가입·로그인·로그아웃, 패스키 추가·삭제, 비공개 메모 화면 |
| `api/passkey.js` | WebAuthn 등록·로그인 검증, 세션, 패스키 삭제 |
| `api/private.js` | 비공개 메모 API (세션의 본인 것만) |
| `lib/` | 쿠키·출처 검사, 세션, 저장소(Supabase REST) |
| `supabase/t08-schema.sql` | `t08_*` 표. RLS 켜고 브라우저 역할 권한 없음 |
| `test/passkey.test.js` | 가상 패스키로 하는 서버 시험 (`npm test`) |
| `docs/T08-인증-설명서.md` | 인증 구현 설명서 |

## 설정 (Vercel 환경변수)

| 이름 | 값 |
| --- | --- |
| `SUPABASE_URL` | Supabase 프로젝트 주소 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서버 전용 비밀 키 (Secret으로 저장, 코드·채팅에 넣지 않음) |
| `T08_RP_ID`, `T08_ORIGINS` | (선택) 패스키 도메인과 허용 출처. 없으면 요청 주소로 정함 |

## 로컬에서 확인

```bash
npm install
npm test
node scripts/dev-server.mjs
```

`dev-server`는 기본으로 메모리 저장소를 써서 실제 DB를 건드리지 않습니다. http://localhost:3000/private.html 에서 화면을 볼 수 있습니다.
