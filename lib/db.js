// [개발 · DB구축] 패스키·세션·비공개 메모 저장소
// 운영: Supabase(PostgreSQL) REST API를 서버 전용 비밀 키로 호출한다. 표에는 행 수준 보안(RLS)이 켜져 있고
//       공개 키(anon)·로그인 역할(authenticated)에는 권한이 없으므로, 브라우저에서는 이 표를 직접 읽을 수 없다.
// 시험: T08_DB=memory 이면 메모리 저장소를 쓴다(test/ 에서 사용).
import { HttpError } from './http.js';

function supabaseStore() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
  if (!url || !key) {
    throw new HttpError(503, '서버 저장소 설정(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)이 아직 없습니다.', 'not_configured');
  }
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

  async function call(method, path, body, prefer) {
    const h = { ...headers };
    if (prefer) h.Prefer = prefer;
    const r = await fetch(`${url}/rest/v1/${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) {
      const err = new Error(`supabase ${method} ${path.split('?')[0]} ${r.status}: ${data && data.message}`);
      err.pgCode = data && data.code;
      throw err;
    }
    return data;
  }
  const q = encodeURIComponent;

  return {
    async createChallenge(row) {
      await call('POST', 't08_challenges', row, 'return=minimal');
    },
    async takeChallenge(id) {
      const rows = await call('DELETE', `t08_challenges?id=eq.${q(id)}`, undefined, 'return=representation');
      return rows[0] || null;
    },
    async purgeExpired(nowIso) {
      await call('DELETE', `t08_challenges?expires_at=lt.${q(nowIso)}`, undefined, 'return=minimal');
      await call('DELETE', `t08_sessions?expires_at=lt.${q(nowIso)}`, undefined, 'return=minimal');
    },
    async getUserByHandle(handle) {
      return (await call('GET', `t08_users?handle=eq.${q(handle)}&select=*`))[0] || null;
    },
    async getUser(id) {
      return (await call('GET', `t08_users?id=eq.${q(id)}&select=*`))[0] || null;
    },
    async createUser(row) {
      try {
        await call('POST', 't08_users', row, 'return=minimal');
      } catch (e) {
        if (e.pgCode === '23505') throw new HttpError(409, '이미 쓰이고 있는 아이디입니다.', 'handle_taken');
        throw e;
      }
    },
    async listPasskeys(userId) {
      return call('GET', `t08_passkeys?user_id=eq.${q(userId)}&select=*&order=created_at.asc`);
    },
    async getPasskey(id) {
      return (await call('GET', `t08_passkeys?id=eq.${q(id)}&select=*`))[0] || null;
    },
    async addPasskey(row) {
      try {
        await call('POST', 't08_passkeys', row, 'return=minimal');
      } catch (e) {
        if (e.pgCode === '23505') throw new HttpError(409, '이미 등록된 패스키입니다.', 'passkey_exists');
        throw e;
      }
    },
    async touchPasskey(id, counter, at) {
      await call('PATCH', `t08_passkeys?id=eq.${q(id)}`, { counter, last_used_at: at }, 'return=minimal');
    },
    async deletePasskey(userId, id) {
      const rows = await call('DELETE', `t08_passkeys?id=eq.${q(id)}&user_id=eq.${q(userId)}`, undefined, 'return=representation');
      return rows.length;
    },
    async createSession(row) {
      await call('POST', 't08_sessions', row, 'return=minimal');
    },
    async getSession(tokenHash) {
      return (await call('GET', `t08_sessions?token_hash=eq.${q(tokenHash)}&select=*`))[0] || null;
    },
    async deleteSession(tokenHash) {
      await call('DELETE', `t08_sessions?token_hash=eq.${q(tokenHash)}`, undefined, 'return=minimal');
    },
    async listNotes(userId) {
      return call('GET', `t08_notes?user_id=eq.${q(userId)}&select=id,body,created_at&order=created_at.desc`);
    },
    async addNote(row) {
      const rows = await call('POST', 't08_notes', row, 'return=representation');
      return rows[0];
    },
    async deleteNote(userId, id) {
      const rows = await call('DELETE', `t08_notes?id=eq.${q(id)}&user_id=eq.${q(userId)}`, undefined, 'return=representation');
      return rows.length;
    },
  };
}

// ───────── 시험용 메모리 저장소 ─────────
const mem = { challenges: new Map(), users: new Map(), passkeys: new Map(), sessions: new Map(), notes: new Map() };
export function resetMemoryStore() { for (const m of Object.values(mem)) m.clear(); }

function memoryStore() {
  const clone = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));
  return {
    async createChallenge(row) { mem.challenges.set(row.id, clone(row)); },
    async takeChallenge(id) { const r = mem.challenges.get(id) || null; mem.challenges.delete(id); return clone(r); },
    async purgeExpired() {},
    async getUserByHandle(handle) { return clone([...mem.users.values()].find((u) => u.handle === handle)); },
    async getUser(id) { return clone(mem.users.get(id)); },
    async createUser(row) {
      if ([...mem.users.values()].some((u) => u.handle === row.handle)) throw new HttpError(409, '이미 쓰이고 있는 아이디입니다.', 'handle_taken');
      mem.users.set(row.id, { ...clone(row), created_at: new Date().toISOString() });
    },
    async listPasskeys(userId) { return clone([...mem.passkeys.values()].filter((p) => p.user_id === userId)); },
    async getPasskey(id) { return clone(mem.passkeys.get(id)); },
    async addPasskey(row) {
      if (mem.passkeys.has(row.id)) throw new HttpError(409, '이미 등록된 패스키입니다.', 'passkey_exists');
      mem.passkeys.set(row.id, { ...clone(row), created_at: new Date().toISOString(), last_used_at: null });
    },
    async touchPasskey(id, counter, at) { const p = mem.passkeys.get(id); if (p) Object.assign(p, { counter, last_used_at: at }); },
    async deletePasskey(userId, id) { const p = mem.passkeys.get(id); if (!p || p.user_id !== userId) return 0; mem.passkeys.delete(id); return 1; },
    async createSession(row) { mem.sessions.set(row.token_hash, clone(row)); },
    async getSession(h) { return clone(mem.sessions.get(h)); },
    async deleteSession(h) { mem.sessions.delete(h); },
    async listNotes(userId) { return clone([...mem.notes.values()].filter((n) => n.user_id === userId).reverse()).map(({ id, body, created_at }) => ({ id, body, created_at })); },
    async addNote(row) { const n = { ...clone(row), created_at: new Date().toISOString() }; mem.notes.set(n.id, n); return clone(n); },
    async deleteNote(userId, id) { const n = mem.notes.get(id); if (!n || n.user_id !== userId) return 0; mem.notes.delete(id); return 1; },
  };
}

export function store() {
  return process.env.T08_DB === 'memory' ? memoryStore() : supabaseStore();
}
