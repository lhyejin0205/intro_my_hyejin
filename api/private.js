// [개발 · 인증] 비공개 영역의 자료(메모). 로그인한 본인 것만 서버가 돌려준다.
//   GET    /api/private          → 내 메모 목록
//   POST   /api/private          → 메모 추가 { body }
//   DELETE /api/private?id=...   → 내 메모 삭제
import { randomUUID } from 'node:crypto';
import { send, sendError, readBody, relyingParty, assertSameOrigin, HttpError } from '../lib/http.js';
import { store } from '../lib/db.js';
import { requireUser } from '../lib/session.js';

const MAX_NOTES = 100;
const MAX_LEN = 1000;

export default async function handler(req, res) {
  try {
    const rp = relyingParty(req);
    assertSameOrigin(req, rp);
    const db = store();
    const me = await requireUser(req, db);

    if (req.method === 'GET') {
      return send(res, 200, { ok: true, owner: me.display_name, notes: await db.listNotes(me.id) });
    }
    if (req.method === 'POST') {
      const text = String(readBody(req).body ?? '').replace(/\u0000/g, '').trim();
      if (!text) throw new HttpError(400, '메모 내용을 적어 주세요.', 'empty');
      if (text.length > MAX_LEN) throw new HttpError(400, `메모는 ${MAX_LEN}자까지 쓸 수 있습니다.`, 'too_long');
      if ((await db.listNotes(me.id)).length >= MAX_NOTES) throw new HttpError(409, `메모는 ${MAX_NOTES}개까지 저장할 수 있습니다.`, 'too_many');
      const note = await db.addNote({ id: randomUUID(), user_id: me.id, body: text });
      return send(res, 201, { ok: true, note: { id: note.id, body: note.body, created_at: note.created_at } });
    }
    if (req.method === 'DELETE') {
      const id = String((req.query && req.query.id) || new URL(req.url, 'http://x').searchParams.get('id') || '');
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, '지울 메모를 고르세요.', 'bad_id');
      const n = await db.deleteNote(me.id, id);
      if (!n) throw new HttpError(404, '내 메모 중에 그런 메모가 없습니다.', 'not_found');
      return send(res, 200, { ok: true });
    }
    throw new HttpError(405, '허용되지 않은 방식입니다.', 'method_not_allowed');
  } catch (e) {
    sendError(res, e);
  }
}
