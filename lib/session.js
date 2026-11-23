// [개발 · 인증] 로그인 세션: 무작위 토큰을 HttpOnly 쿠키로 주고, 서버에는 그 해시만 저장한다.
import { createHash, randomBytes } from 'node:crypto';
import { cookie, parseCookies, HttpError } from './http.js';

export const SESSION_COOKIE = 'pk_session';
export const CHALLENGE_COOKIE = 'pk_challenge';
const SESSION_DAYS = 7;

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export async function startSession(db, userId, rp) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  await db.createSession({
    token_hash: sha256(token),
    user_id: userId,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + SESSION_DAYS * 864e5).toISOString(),
  });
  return cookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400, secure: rp.secure });
}

/** 쿠키의 세션을 확인해 사용자를 돌려준다. 없거나 만료면 null. */
export async function currentUser(req, db) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || token.length > 200) return null;
  const s = await db.getSession(sha256(token));
  if (!s) return null;
  if (new Date(s.expires_at).getTime() <= Date.now()) {
    await db.deleteSession(s.token_hash);
    return null;
  }
  const user = await db.getUser(s.user_id);
  return user ? { ...user, tokenHash: s.token_hash } : null;
}

export async function requireUser(req, db) {
  const u = await currentUser(req, db);
  if (!u) throw new HttpError(401, '로그인이 필요합니다.', 'unauthenticated');
  return u;
}

export function clearSessionCookie(rp) {
  return cookie(SESSION_COOKIE, '', { maxAge: 0, secure: rp.secure });
}
