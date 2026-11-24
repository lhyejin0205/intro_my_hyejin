// [마지막 과제 B · 개발] 모집 위험 점검표의 계산 모듈 — 10번 논문(scripts/analyze.py)과 같은 계산을 한다.
// 브라우저에서는 window.RecruitStats, Node 시험에서는 require('./stats.js') 로 쓴다.
(function (root) {
  'use strict';

  const Z = 1.959963984540054;

  // 데이터 한 줄: NCT|기관(S/M)|후원(I/O)|시작연도|상태(C/T)|모집부진중단(0/1)|COVID사유(0/1)|기관수
  function parseRows(text) {
    if (typeof text !== 'string' || !text) return [];
    return text.split('\n').map((ln) => {
      const p = ln.split('|');
      return { nct: p[0], site: p[1], sponsor: p[2], year: Number(p[3]) || 0, status: p[4],
        low: p[5] === '1', covid: p[6] === '1', nSites: Number(p[7]) || 0 };
    }).filter((r) => /^NCT\d{8}$/.test(r.nct));
  }

  // Wilson 95% 신뢰구간
  function wilson(k, n) {
    if (!n) return [NaN, NaN];
    const p = k / n, d = 1 + Z * Z / n;
    const c = (p + Z * Z / (2 * n)) / d;
    const h = Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }

  // 위험비(단일/다기관)와 로그 방법 95% 신뢰구간
  function riskRatio(e1, n1, e0, n0) {
    if (!e1 || !e0 || !n1 || !n0) return null;
    const rr = (e1 / n1) / (e0 / n0);
    const se = Math.sqrt(1 / e1 - 1 / n1 + 1 / e0 - 1 / n0);
    return { rr, lo: Math.exp(Math.log(rr) - 1.96 * se), hi: Math.exp(Math.log(rr) + 1.96 * se) };
  }

  // 조건: site 'any'|'S'|'M', sponsor 'any'|'I'|'O', period 'any'|'early'(2005–2013)|'late'(2014–2022), excludeCovid bool
  function filterRows(rows, f) {
    f = f || {};
    return rows.filter((r) => {
      if (f.site && f.site !== 'any' && r.site !== f.site) return false;
      if (f.sponsor && f.sponsor !== 'any' && r.sponsor !== f.sponsor) return false;
      if (f.period === 'early' && !(r.year >= 2005 && r.year <= 2013)) return false;
      if (f.period === 'late' && !(r.year >= 2014 && r.year <= 2022)) return false;
      if (f.excludeCovid && r.covid) return false;
      return true;
    });
  }

  function summarize(rows) {
    const n = rows.length;
    const low = rows.filter((r) => r.low).length;
    const term = rows.filter((r) => r.status === 'T').length;
    return { n, low, term, prop: n ? low / n : NaN, ci: wilson(low, n) };
  }

  // 같은 조건에서 단일 기관 vs 다기관 비교
  function compareSites(rows, f) {
    const base = Object.assign({}, f, { site: 'any' });
    const s = summarize(filterRows(rows, Object.assign({}, base, { site: 'S' })));
    const m = summarize(filterRows(rows, Object.assign({}, base, { site: 'M' })));
    const rr = riskRatio(s.low, s.n, m.low, m.n);
    let verdict;
    if (s.n < 30 || m.n < 30 || !rr) verdict = 'small';
    // 논문 4-1·3-3: 신뢰구간 끝이 1에 바짝 붙은 경우(0.95~1.05)는 방향을 단정하지 않고 '경계'로 둔다
    else if (rr.lo > 1) verdict = rr.lo < 1.05 ? 'single-higher-borderline' : 'single-higher';
    else if (rr.hi < 1) verdict = rr.hi > 0.95 ? 'multi-higher-borderline' : 'multi-higher';
    else verdict = 'no-difference';
    return { single: s, multi: m, rr, verdict };
  }

  // NCT 번호 입력 정리: 공백·소문자·숫자만 입력도 받아 준다
  function normalizeNct(input) {
    if (typeof input !== 'string') return null;
    const t = input.trim().toUpperCase().replace(/\s+/g, '');
    const m = t.match(/^(?:NCT)?(\d{1,8})$/);
    if (!m) return null;
    return 'NCT' + m[1].padStart(8, '0');
  }

  const api = { parseRows, wilson, riskRatio, filterRows, summarize, compareSites, normalizeNct };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RecruitStats = api;
})(typeof window !== 'undefined' ? window : this);
