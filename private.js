// [개발 · 인증] 비공개 영역 화면: 패스키 가입·로그인·로그아웃, 패스키 추가·삭제, 비공개 메모
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const WA = window.SimpleWebAuthnBrowser;

  function show(text, kind = 'error') {
    const el = $('#msg');
    el.textContent = text;
    el.className = `msg ${kind}`;
    el.hidden = !text;
  }
  const clear = () => show('');

  function fmt(ts) {
    if (!ts) return '';
    return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts));
  }

  async function api(path, { method = 'GET', body } = {}) {
    let r;
    try {
      r = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.');
    }
    let data = {};
    try { data = await r.json(); } catch { /* 본문 없음 */ }
    if (!r.ok) {
      const e = new Error(data.message || `요청이 실패했습니다. (${r.status})`);
      e.status = r.status;
      e.code = data.code;
      throw e;
    }
    return data;
  }

  function explainWebAuthn(e) {
    const name = e && (e.name || '');
    if (name === 'NotAllowedError') return '패스키 확인이 취소됐거나 시간이 지났습니다. 다시 시도하세요.';
    if (name === 'InvalidStateError') return '이 기기에는 이미 이 계정의 패스키가 있습니다.';
    if (name === 'SecurityError') return '이 주소에서는 패스키를 쓸 수 없습니다. https 주소로 열었는지 확인하세요.';
    if (name === 'AbortError') return '패스키 확인이 중단됐습니다.';
    return e && e.message ? e.message : '알 수 없는 오류가 났습니다.';
  }

  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { await fn(); } catch (e) { console.error(e); show(explainWebAuthn(e)); } finally { if (btn) btn.disabled = false; }
  }

  // ───────── 화면 ─────────
  function renderSignedOut() {
    $('#signed-in').hidden = true;
    $('#signed-out').hidden = false;
    $('#notes').innerHTML = '';
    $('#passkeys').innerHTML = '';
  }

  function li(html) { const el = document.createElement('li'); el.innerHTML = html; return el; }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function renderSignedIn(me) {
    $('#signed-out').hidden = true;
    $('#signed-in').hidden = false;
    $('#hello').textContent = `${me.user.display_name}님의 공간`;

    const keys = $('#passkeys');
    keys.innerHTML = '';
    for (const p of me.passkeys) {
      const synced = p.backed_up ? '<span class="badge">동기화됨</span>' : '';
      keys.append(li(`
        <div><div>${esc(p.nickname)}${synced}</div>
        <div class="meta">등록 ${esc(fmt(p.created_at))}${p.last_used_at ? ` · 마지막 사용 ${esc(fmt(p.last_used_at))}` : ''}</div></div>
        <button type="button" class="link" data-del-key="${esc(p.id)}" ${me.passkeys.length <= 1 ? 'disabled title="마지막 패스키는 지울 수 없습니다"' : ''}>삭제</button>`));
    }

    const data = await api('/api/private');
    const notes = $('#notes');
    notes.innerHTML = '';
    if (!data.notes.length) notes.append(li('<span class="empty">아직 메모가 없습니다.</span>'));
    for (const n of data.notes) {
      notes.append(li(`
        <div><div class="body">${esc(n.body)}</div><div class="meta">${esc(fmt(n.created_at))}</div></div>
        <button type="button" class="link" data-del-note="${esc(n.id)}">삭제</button>`));
    }
  }

  async function refresh() {
    try {
      const me = await api('/api/passkey?action=me');
      await renderSignedIn(me);
    } catch (e) {
      if (e.status === 401) return renderSignedOut();
      renderSignedOut();
      show(e.message);
    }
  }

  // ───────── 동작 ─────────
  async function login() {
    clear();
    const { options } = await api('/api/passkey?action=login-options', { method: 'POST', body: {} });
    const response = await WA.startAuthentication({ optionsJSON: options });
    await api('/api/passkey?action=login-verify', { method: 'POST', body: { response } });
    await refresh();
    show('들어왔습니다.', 'ok');
  }

  async function signUp(form) {
    clear();
    const handle = form.handle.value.trim().toLowerCase();
    if (!/^[a-z0-9_-]{3,30}$/.test(handle)) { show('아이디는 영어 소문자·숫자·-·_ 로 3~30자입니다.'); form.handle.focus(); return; }
    const { options } = await api('/api/passkey?action=register-options', {
      method: 'POST', body: { handle, displayName: form.displayName.value, nickname: form.nickname.value },
    });
    const response = await WA.startRegistration({ optionsJSON: options });
    await api('/api/passkey?action=register-verify', { method: 'POST', body: { response } });
    form.reset();
    await refresh();
    show('패스키를 만들고 들어왔습니다. 다른 기기에도 패스키를 하나 더 추가해 두세요.', 'ok');
  }

  async function addPasskey(form) {
    clear();
    const { options } = await api('/api/passkey?action=register-options', { method: 'POST', body: { nickname: form.nickname.value } });
    const response = await WA.startRegistration({ optionsJSON: options });
    await api('/api/passkey?action=register-verify', { method: 'POST', body: { response } });
    form.reset();
    await refresh();
    show('패스키를 추가했습니다.', 'ok');
  }

  async function deletePasskey(id) {
    if (!confirm('이 패스키를 지울까요? 지운 패스키로는 더 이상 들어올 수 없습니다.')) return;
    clear();
    await api('/api/passkey?action=delete', { method: 'POST', body: { id } });
    await refresh();
    show('패스키를 지웠습니다.', 'ok');
  }

  async function addNote(form) {
    clear();
    const body = form.body.value.trim();
    if (!body) { show('메모 내용을 적어 주세요.'); return; }
    await api('/api/private', { method: 'POST', body: { body } });
    form.reset();
    await refresh();
  }

  async function deleteNote(id) {
    if (!confirm('이 메모를 지울까요? 되돌릴 수 없습니다.')) return;
    clear();
    await api(`/api/private?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refresh();
  }

  async function logout() {
    clear();
    await api('/api/passkey?action=logout', { method: 'POST', body: {} });
    renderSignedOut();
    show('로그아웃했습니다.', 'ok');
  }

  // ───────── 연결 ─────────
  function init() {
    const supported = window.PublicKeyCredential && WA && WA.browserSupportsWebAuthn && WA.browserSupportsWebAuthn();
    if (!supported) { $('#unsupported').hidden = false; return; }

    $('#login-btn').addEventListener('click', (e) => busy(e.currentTarget, login));
    $('#signup-form').addEventListener('submit', (e) => { e.preventDefault(); busy(e.submitter, () => signUp(e.target)); });
    $('#add-form').addEventListener('submit', (e) => { e.preventDefault(); busy(e.submitter, () => addPasskey(e.target)); });
    $('#note-form').addEventListener('submit', (e) => { e.preventDefault(); busy(e.submitter, () => addNote(e.target)); });
    $('#logout-btn').addEventListener('click', (e) => busy(e.currentTarget, logout));
    $('#passkeys').addEventListener('click', (e) => { const b = e.target.closest('[data-del-key]'); if (b) busy(b, () => deletePasskey(b.dataset.delKey)); });
    $('#notes').addEventListener('click', (e) => { const b = e.target.closest('[data-del-note]'); if (b) busy(b, () => deleteNote(b.dataset.delNote)); });

    refresh();
  }

  init();
})();
