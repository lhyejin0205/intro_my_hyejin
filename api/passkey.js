// [개발 · 인증] 패스키 등록·로그인·로그아웃·추가 등록·삭제 (WebAuthn)
//   POST /api/passkey?action=register-options | register-verify | login-options | login-verify | logout | delete
//   GET  /api/passkey?action=me
// 비밀번호는 없다. 서버는 공개키만 저장하고, 매번 새 챌린지에 대한 서명을 확인한다.
import { randomUUID } from 'node:crypto';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { send, sendError, readBody, parseCookies, cookie, relyingParty, assertSameOrigin, HttpError } from '../lib/http.js';
import { store } from '../lib/db.js';
import { CHALLENGE_COOKIE, currentUser, requireUser, startSession, clearSessionCookie } from '../lib/session.js';

const RP_NAME = '임혜진 포트폴리오';
const CHALLENGE_TTL_SEC = 300;
const MAX_PASSKEYS = 10;
const HANDLE_RE = /^[a-z0-9_-]{3,30}$/;

const b64u = {
  enc: (bytes) => Buffer.from(bytes).toString('base64url'),
  dec: (s) => new Uint8Array(Buffer.from(s, 'base64url')),
};
const uuidBytes = (uuid) => new Uint8Array(Buffer.from(uuid.replace(/-/g, ''), 'hex'));

function cleanText(v, max) {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return s.length ? s.slice(0, max) : '';
}

function publicPasskey(p) {
  return {
    id: p.id,
    nickname: p.nickname || '이름 없는 패스키',
    device_type: p.device_type,
    backed_up: !!p.backed_up,
    created_at: p.created_at,
    last_used_at: p.last_used_at,
  };
}

async function saveChallenge(db, rp, purpose, challenge, extra) {
  const id = randomUUID();
  await db.createChallenge({
    id, purpose, challenge,
    user_id: extra.user_id || null,
    meta: extra.meta || {},
    expires_at: new Date(Date.now() + CHALLENGE_TTL_SEC * 1000).toISOString(),
  });
  return cookie(CHALLENGE_COOKIE, id, { maxAge: CHALLENGE_TTL_SEC, secure: rp.secure });
}

/** 챌린지는 한 번만 쓸 수 있다(꺼내면서 지운다). */
async function takeChallenge(req, db, purpose) {
  const id = parseCookies(req)[CHALLENGE_COOKIE];
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, '인증 요청이 만료됐습니다. 처음부터 다시 시도하세요.', 'no_challenge');
  const ch = await db.takeChallenge(id);
  if (!ch || ch.purpose !== purpose || new Date(ch.expires_at).getTime() <= Date.now()) {
    throw new HttpError(400, '인증 요청이 만료됐습니다. 처음부터 다시 시도하세요.', 'no_challenge');
  }
  return ch;
}

function credentialFromBody(body) {
  const r = body && body.response;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.response) {
    throw new HttpError(400, '패스키 응답이 없습니다.', 'bad_response');
  }
  return r;
}

const actions = {
  async 'register-options'(req, db, rp) {
    const body = readBody(req);
    const me = await currentUser(req, db);
    let opts;
    let meta;
    let userId;
    if (me) {
      // 로그인한 상태: 내 계정에 패스키 하나 더
      const mine = await db.listPasskeys(me.id);
      if (mine.length >= MAX_PASSKEYS) throw new HttpError(409, `패스키는 ${MAX_PASSKEYS}개까지 등록할 수 있습니다.`, 'too_many');
      userId = me.id;
      meta = { mode: 'add', nickname: cleanText(body.nickname, 40) };
      opts = await generateRegistrationOptions({
        rpName: RP_NAME, rpID: rp.rpID,
        userName: me.handle, userDisplayName: me.display_name, userID: uuidBytes(me.id),
        attestationType: 'none',
        excludeCredentials: mine.map((p) => ({ id: p.id, transports: p.transports || undefined })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      });
    } else {
      // 새 계정 만들기
      const handle = cleanText(body.handle, 30).toLowerCase();
      const displayName = cleanText(body.displayName, 40) || handle;
      if (!HANDLE_RE.test(handle)) throw new HttpError(400, '아이디는 영어 소문자·숫자·-·_ 로 3~30자입니다.', 'bad_handle');
      if (await db.getUserByHandle(handle)) throw new HttpError(409, '이미 쓰이고 있는 아이디입니다.', 'handle_taken');
      userId = randomUUID();
      meta = { mode: 'new', handle, displayName, nickname: cleanText(body.nickname, 40) };
      opts = await generateRegistrationOptions({
        rpName: RP_NAME, rpID: rp.rpID,
        userName: handle, userDisplayName: displayName, userID: uuidBytes(userId),
        attestationType: 'none',
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      });
    }
    const c = await saveChallenge(db, rp, 'register', opts.challenge, { user_id: userId, meta });
    return [200, { ok: true, options: opts }, [c]];
  },

  async 'register-verify'(req, db, rp) {
    const body = readBody(req);
    const response = credentialFromBody(body);
    const ch = await takeChallenge(req, db, 'register');
    const meta = ch.meta || {};
    const me = await currentUser(req, db);
    if (meta.mode === 'add' && (!me || me.id !== ch.user_id)) {
      throw new HttpError(401, '패스키를 추가하려면 먼저 로그인하세요.', 'unauthenticated');
    }

    let v;
    try {
      v = await verifyRegistrationResponse({
        response, expectedChallenge: ch.challenge, expectedOrigin: rp.origins, expectedRPID: rp.rpID,
        requireUserVerification: false,
      });
    } catch (e) {
      throw new HttpError(400, `패스키를 확인하지 못했습니다. (${e.message})`, 'verify_failed');
    }
    if (!v.verified) throw new HttpError(400, '패스키를 확인하지 못했습니다.', 'verify_failed');
    const info = v.registrationInfo;

    const cookies = [cookie('pk_challenge', '', { maxAge: 0, secure: rp.secure })];
    if (meta.mode === 'new') {
      await db.createUser({ id: ch.user_id, handle: meta.handle, display_name: meta.displayName });
    }
    await db.addPasskey({
      id: info.credential.id,
      user_id: ch.user_id,
      public_key: b64u.enc(info.credential.publicKey),
      counter: info.credential.counter,
      transports: info.credential.transports || response.response.transports || null,
      device_type: info.credentialDeviceType,
      backed_up: info.credentialBackedUp,
      nickname: meta.nickname || (meta.mode === 'new' ? '첫 패스키' : '추가한 패스키'),
    });
    if (meta.mode === 'new') cookies.push(await startSession(db, ch.user_id, rp));
    return [200, { ok: true, mode: meta.mode }, cookies];
  },

  async 'login-options'(req, db, rp) {
    const opts = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'preferred' });
    const c = await saveChallenge(db, rp, 'login', opts.challenge, {});
    return [200, { ok: true, options: opts }, [c]];
  },

  async 'login-verify'(req, db, rp) {
    const body = readBody(req);
    const response = credentialFromBody(body);
    const ch = await takeChallenge(req, db, 'login');
    const pk = await db.getPasskey(response.id);
    if (!pk) throw new HttpError(401, '등록되지 않은 패스키입니다.', 'unknown_passkey');
    let v;
    try {
      v = await verifyAuthenticationResponse({
        response, expectedChallenge: ch.challenge, expectedOrigin: rp.origins, expectedRPID: rp.rpID,
        credential: { id: pk.id, publicKey: b64u.dec(pk.public_key), counter: Number(pk.counter) || 0, transports: pk.transports || undefined },
        requireUserVerification: false,
      });
    } catch (e) {
      throw new HttpError(401, `패스키 서명을 확인하지 못했습니다. (${e.message})`, 'verify_failed');
    }
    if (!v.verified) throw new HttpError(401, '패스키 서명을 확인하지 못했습니다.', 'verify_failed');
    await db.touchPasskey(pk.id, v.authenticationInfo.newCounter, new Date().toISOString());
    const cookies = [cookie('pk_challenge', '', { maxAge: 0, secure: rp.secure }), await startSession(db, pk.user_id, rp)];
    return [200, { ok: true }, cookies];
  },

  async logout(req, db, rp) {
    const me = await currentUser(req, db);
    if (me) await db.deleteSession(me.tokenHash);
    return [200, { ok: true }, [clearSessionCookie(rp)]];
  },

  async me(req, db) {
    const me = await requireUser(req, db);
    const passkeys = await db.listPasskeys(me.id);
    return [200, { ok: true, user: { handle: me.handle, display_name: me.display_name }, passkeys: passkeys.map(publicPasskey) }];
  },

  async delete(req, db) {
    const me = await requireUser(req, db);
    const { id } = readBody(req);
    if (typeof id !== 'string' || !id || id.length > 512) throw new HttpError(400, '지울 패스키를 고르세요.', 'bad_id');
    const mine = await db.listPasskeys(me.id);
    if (!mine.some((p) => p.id === id)) throw new HttpError(404, '내 패스키 중에 그런 패스키가 없습니다.', 'not_found');
    if (mine.length <= 1) throw new HttpError(409, '마지막 패스키는 지울 수 없습니다. 다른 패스키를 먼저 추가하세요.', 'last_passkey');
    const n = await db.deletePasskey(me.id, id);
    if (!n) throw new HttpError(404, '내 패스키 중에 그런 패스키가 없습니다.', 'not_found');
    return [200, { ok: true }];
  },
};

const GET_ACTIONS = new Set(['me']);

export default async function handler(req, res) {
  try {
    const action = String((req.query && req.query.action) || new URL(req.url, 'http://x').searchParams.get('action') || '');
    const fn = actions[action];
    if (!fn) throw new HttpError(404, '알 수 없는 요청입니다.', 'unknown_action');
    const wantGet = GET_ACTIONS.has(action);
    if ((wantGet && req.method !== 'GET') || (!wantGet && req.method !== 'POST')) {
      throw new HttpError(405, '허용되지 않은 방식입니다.', 'method_not_allowed');
    }
    const rp = relyingParty(req);
    assertSameOrigin(req, rp);
    const db = store();
    if (Math.random() < 0.05) db.purgeExpired(new Date().toISOString()).catch(() => {});
    const [status, body, cookies] = await fn(req, db, rp);
    send(res, status, body, cookies || []);
  } catch (e) {
    sendError(res, e);
  }
}
