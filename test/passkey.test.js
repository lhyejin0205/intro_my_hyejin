// [유지보수 · 검증] 가상 패스키(실제 P-256 키와 서명)로 서버 흐름 전체를 시험한다.
// 실행: npm test   (메모리 저장소를 쓰므로 실제 DB를 건드리지 않는다)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

process.env.T08_DB = 'memory';
delete process.env.T08_RP_ID;
delete process.env.T08_ORIGINS;

const { default: passkey } = await import('../api/passkey.js');
const { default: priv } = await import('../api/private.js');
const { resetMemoryStore } = await import('../lib/db.js');

const HOST = 'localhost:3000';
const ORIGIN = `http://${HOST}`;
const RP_ID = 'localhost';

// ───────── 아주 작은 CBOR 인코더 (정수·바이트·문자열·맵) ─────────
function cborHead(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
}
function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? cborHead(0, v) : cborHead(1, -1 - v);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([cborHead(3, b.length), b]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([cborHead(2, v.length), v]);
  if (v instanceof Map) {
    const parts = [cborHead(5, v.size)];
    for (const [k, val] of v) parts.push(cbor(k), cbor(val));
    return Buffer.concat(parts);
  }
  throw new Error('unsupported cbor value');
}

const b64u = (b) => Buffer.from(b).toString('base64url');
const sha = (b) => createHash('sha256').update(b).digest();

/** 브라우저와 인증기를 흉내 내는 가상 패스키 */
function makeDevice(origin = ORIGIN, rpId = RP_ID) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = randomBytes(16);
  let counter = 0;
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  let userHandle = null;

  return {
    id: b64u(credId),
    register(options, overrides = {}) {
      userHandle = options.user.id;
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: overrides.origin || origin, crossOrigin: false }));
      const flags = 0x01 | 0x04 | 0x40; // UP, UV, AT
      const authData = Buffer.concat([
        sha(Buffer.from(rpId)), Buffer.from([flags]), Buffer.alloc(4),
        Buffer.alloc(16), Buffer.from([0, credId.length]), credId, cose,
      ]);
      const attObj = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      return {
        id: b64u(credId), rawId: b64u(credId), type: 'public-key',
        response: { clientDataJSON: b64u(clientData), attestationObject: b64u(attObj), transports: ['internal'] },
        clientExtensionResults: {}, authenticatorAttachment: 'platform',
      };
    },
    login(options, overrides = {}) {
      counter += 1;
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: overrides.origin || origin, crossOrigin: false }));
      const cnt = Buffer.alloc(4); cnt.writeUInt32BE(counter);
      const authData = Buffer.concat([sha(Buffer.from(rpId)), Buffer.from([0x01 | 0x04]), cnt]);
      let signature = sign('sha256', Buffer.concat([authData, sha(clientData)]), privateKey);
      if (overrides.tamper) signature = Buffer.from(signature.map((x, i) => (i === signature.length - 1 ? x ^ 1 : x)));
      return {
        id: b64u(credId), rawId: b64u(credId), type: 'public-key',
        response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(signature), userHandle },
        clientExtensionResults: {}, authenticatorAttachment: 'platform',
      };
    },
  };
}

/** 쿠키를 기억하는 가상 브라우저 */
function makeBrowser(origin = ORIGIN) {
  const jar = new Map();
  async function call(handler, method, path, body, extraHeaders = {}) {
    const url = new URL(path, ORIGIN);
    const req = {
      method, url: url.pathname + url.search,
      query: Object.fromEntries(url.searchParams),
      headers: { host: HOST, origin, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...extraHeaders },
      body,
    };
    const out = { status: 0, headers: {}, body: null };
    const res = {
      set statusCode(v) { out.status = v; }, get statusCode() { return out.status; },
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      end(s) { out.body = s ? JSON.parse(s) : null; },
    };
    await handler(req, res);
    for (const c of [].concat(out.headers['set-cookie'] || [])) {
      const [pair] = c.split(';');
      const [k, ...rest] = pair.split('=');
      const v = rest.join('=');
      if (/Max-Age=0/.test(c) || v === '') jar.delete(k); else jar.set(k, v);
    }
    return out;
  }
  return {
    jar,
    pk: (method, action, body) => call(passkey, method, `/api/passkey?action=${action}`, body),
    priv: (method, q = '', body) => call(priv, method, `/api/private${q}`, body),
  };
}

async function signUp(browser, device, handle) {
  const o = await browser.pk('POST', 'register-options', { handle, displayName: handle.toUpperCase() });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  const v = await browser.pk('POST', 'register-verify', { response: device.register(o.body.options) });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return v;
}
async function logIn(browser, device, overrides) {
  const o = await browser.pk('POST', 'login-options', {});
  assert.equal(o.status, 200);
  return browser.pk('POST', 'login-verify', { response: device.login(o.body.options, overrides) });
}

beforeEach(() => resetMemoryStore());

test('가입 → 내 정보 → 로그아웃 → 패스키로 다시 로그인', async () => {
  const b = makeBrowser(); const d = makeDevice();
  await signUp(b, d, 'alice');
  assert.ok(b.jar.get('pk_session'), '가입하면 세션 쿠키가 생긴다');
  const me = await b.pk('GET', 'me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.handle, 'alice');
  assert.equal(me.body.passkeys.length, 1);

  assert.equal((await b.pk('POST', 'logout', {})).status, 200);
  assert.equal((await b.pk('GET', 'me')).status, 401, '로그아웃하면 내 정보가 거절된다');

  const login = await logIn(b, d);
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal((await b.pk('GET', 'me')).status, 200);
});

test('패스키 추가 등록과 삭제, 마지막 패스키는 지울 수 없음', async () => {
  const b = makeBrowser(); const d1 = makeDevice(); const d2 = makeDevice();
  await signUp(b, d1, 'alice');
  const o = await b.pk('POST', 'register-options', { nickname: '노트북' });
  assert.equal(o.status, 200);
  assert.equal(o.body.options.excludeCredentials.length, 1, '이미 있는 패스키는 다시 등록하지 않게 알려 준다');
  const v = await b.pk('POST', 'register-verify', { response: d2.register(o.body.options) });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  let me = await b.pk('GET', 'me');
  assert.equal(me.body.passkeys.length, 2);

  // 두 번째 기기로도 로그인된다
  await b.pk('POST', 'logout', {});
  assert.equal((await logIn(b, d2)).status, 200);

  assert.equal((await b.pk('POST', 'delete', { id: d1.id })).status, 200);
  me = await b.pk('GET', 'me');
  assert.deepEqual(me.body.passkeys.map((p) => p.id), [d2.id]);
  const last = await b.pk('POST', 'delete', { id: d2.id });
  assert.equal(last.status, 409);
  assert.equal(last.body.code, 'last_passkey');

  // 지운 패스키로는 로그인할 수 없다
  await b.pk('POST', 'logout', {});
  const gone = await logIn(b, d1);
  assert.equal(gone.status, 401);
  assert.equal(gone.body.code, 'unknown_passkey');
});

test('다른 계정의 비공개 자료와 패스키에는 접근할 수 없음', async () => {
  const a = makeBrowser(); const da = makeDevice();
  const b = makeBrowser(); const db = makeDevice();
  await signUp(a, da, 'alice');
  await signUp(b, db, 'bob');

  const note = await a.priv('POST', '', { body: '앨리스만 보는 메모 (예시)' });
  assert.equal(note.status, 201);
  const aliceNoteId = note.body.note.id;

  const bobList = await b.priv('GET');
  assert.equal(bobList.status, 200);
  assert.equal(bobList.body.notes.length, 0, 'bob은 alice의 메모를 볼 수 없다');

  const bobDelete = await b.priv('DELETE', `?id=${aliceNoteId}`);
  assert.equal(bobDelete.status, 404, 'bob은 alice의 메모를 지울 수 없다');
  assert.equal((await a.priv('GET')).body.notes.length, 1, 'alice의 메모는 그대로');

  const bobDelKey = await b.pk('POST', 'delete', { id: da.id });
  assert.equal(bobDelKey.status, 404, 'bob은 alice의 패스키를 지울 수 없다');

  // bob이 alice의 패스키 기기를 가진 게 아니면 alice로 로그인할 수 없다: bob 기기 서명은 bob 계정으로만 이어진다
  await b.pk('POST', 'logout', {});
  assert.equal((await logIn(b, db)).status, 200);
  assert.equal((await b.pk('GET', 'me')).body.user.handle, 'bob');
});

test('로그인하지 않으면 비공개 자료와 내 정보가 거절됨', async () => {
  const anon = makeBrowser();
  assert.equal((await anon.priv('GET')).status, 401);
  assert.equal((await anon.priv('POST', '', { body: 'x' })).status, 401);
  assert.equal((await anon.pk('GET', 'me')).status, 401);
});

test('가짜 세션 쿠키는 통하지 않음', async () => {
  const b = makeBrowser();
  b.jar.set('pk_session', b64u(randomBytes(32)));
  assert.equal((await b.priv('GET')).status, 401);
});

test('다른 사이트에서 보낸 요청은 거절(Origin 검사)', async () => {
  const evil = makeBrowser('https://evil.example');
  const r = await evil.pk('POST', 'login-options', {});
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'bad_origin');
});

test('다른 사이트에서 만든 패스키 응답·변조된 서명·재사용된 챌린지는 거절', async () => {
  const b = makeBrowser(); const d = makeDevice();
  await signUp(b, d, 'alice');
  await b.pk('POST', 'logout', {});

  const wrongOrigin = await logIn(b, d, { origin: 'https://evil.example' });
  assert.equal(wrongOrigin.status, 401, '다른 출처에서 서명한 응답');

  const tampered = await logIn(b, d, { tamper: true });
  assert.equal(tampered.status, 401, '변조된 서명');

  // 챌린지 재사용: 같은 응답을 두 번 보낸다
  const o = await b.pk('POST', 'login-options', {});
  const resp = d.login(o.body.options);
  const challengeCookie = b.jar.get('pk_challenge');
  assert.equal((await b.pk('POST', 'login-verify', { response: resp })).status, 200);
  b.jar.set('pk_challenge', challengeCookie);
  const replay = await b.pk('POST', 'login-verify', { response: resp });
  assert.equal(replay.status, 400, '이미 쓴 챌린지');
  assert.equal(replay.body.code, 'no_challenge');
});

test('아이디 규칙과 중복 아이디', async () => {
  const b = makeBrowser();
  assert.equal((await b.pk('POST', 'register-options', { handle: 'A!' })).status, 400);
  await signUp(b, makeDevice(), 'alice');
  const c = makeBrowser();
  const dup = await c.pk('POST', 'register-options', { handle: 'alice' });
  assert.equal(dup.status, 409);
});
