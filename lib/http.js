// [개발 · 인증] 서버 함수가 함께 쓰는 HTTP 도우미: JSON 응답, 쿠키, 출처(Origin) 검사, 패스키 도메인 설정

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'error';
  }
}

export function send(res, status, body, cookies = []) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(JSON.stringify(body));
}

export function sendError(res, err) {
  if (err instanceof HttpError) {
    return send(res, err.status, { ok: false, code: err.code, message: err.message });
  }
  console.error(err);
  return send(res, 500, { ok: false, code: 'server_error', message: '서버에서 문제가 생겼습니다. 잠시 뒤에 다시 시도하세요.' });
}

export function readBody(req) {
  const b = req.body;
  if (b == null || b === '') return {};
  if (typeof b === 'string') {
    try { return JSON.parse(b); } catch { throw new HttpError(400, '요청 형식이 올바르지 않습니다.', 'bad_json'); }
  }
  if (typeof b === 'object') return b;
  throw new HttpError(400, '요청 형식이 올바르지 않습니다.', 'bad_json');
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* 깨진 쿠키는 무시 */ }
  }
  return out;
}

export function cookie(name, value, { maxAge, secure }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (secure) parts.push('Secure');
  parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  return parts.join('; ');
}

function hostOf(req) {
  const h = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(h)) throw new HttpError(400, '요청 주소를 알 수 없습니다.', 'bad_host');
  return h;
}

function isLocal(host) {
  const name = host.split(':')[0];
  return name === 'localhost' || name === '127.0.0.1';
}

/**
 * 패스키가 묶이는 도메인(rpID)과 허용할 출처(origin).
 * T08_RP_ID / T08_ORIGINS 환경변수가 있으면 그것만 쓰고,
 * 없으면 지금 요청의 주소로 정한다(브라우저도 같은 주소를 검사하므로 다른 사이트가 흉내 낼 수 없다).
 */
export function relyingParty(req) {
  const envRp = (process.env.T08_RP_ID || '').trim();
  const envOrigins = (process.env.T08_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (envRp && envOrigins.length) return { rpID: envRp, origins: envOrigins, secure: !envOrigins.every((o) => o.startsWith('http://')) };
  const host = hostOf(req);
  const local = isLocal(host);
  const origin = `${local ? 'http' : 'https'}://${host}`;
  return { rpID: host.split(':')[0], origins: [origin], secure: !local };
}

/** 상태를 바꾸는 요청은 우리 페이지에서 온 것만 받는다(CSRF 방어). */
export function assertSameOrigin(req, rp) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.origin;
  if (!origin || !rp.origins.includes(origin)) {
    throw new HttpError(403, '허용되지 않은 출처에서 온 요청입니다.', 'bad_origin');
  }
}
