// [마지막 과제 B · 개발] 화면 동작. 계산은 stats.js, 자료는 data.js(10번 논문 원자료)를 쓴다.
(function () {
  'use strict';
  const S = window.RecruitStats;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (x) => (isFinite(x) ? (x * 100).toFixed(2) + '%' : '—');
  const num = (x) => x.toLocaleString('ko-KR');

  let rows = [];
  try {
    rows = S.parseRows(window.TRIAL_ROWS);
  } catch (e) {
    rows = [];
  }
  if (!rows.length) {
    ['r1', 'r2', 'r3'].forEach((id) => { $(id).innerHTML = '<p class="err">자료를 불러오지 못했습니다. 새로고침해 주세요.</p>'; });
    return;
  }
  const overall = S.summarize(rows);
  $('meta').textContent = (window.TRIAL_META && window.TRIAL_META.source ? window.TRIAL_META.source + ' · ' : '') + '분석 대상 ' + num(rows.length) + '건';

  const ALLOWED = { site: ['any', 'S', 'M'], sponsor: ['any', 'I', 'O'], period: ['any', 'early', 'late'] };
  function readFilters() {
    const f = {};
    for (const k of Object.keys(ALLOWED)) {
      const v = $(k).value;
      f[k] = ALLOWED[k].includes(v) ? v : 'any';
    }
    f.excludeCovid = !!$('covid').checked;
    return f;
  }
  const SITE = { any: '기관 수 상관없음', S: '단일 기관', M: '다기관' };
  const SPON = { any: '후원 상관없음', O: '산업체 외 후원', I: '산업체 후원' };
  const PER = { any: '2005~2022 시작', early: '2005~2013 시작', late: '2014~2022 시작' };

  function bar(prop, ci, max) {
    const w = (v) => Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1) + '%';
    return '<div class="bar" role="img" aria-label="비율 ' + pct(prop) + ', 95% 신뢰구간 ' + pct(ci[0]) + '~' + pct(ci[1]) + '">' +
      '<div class="fill" style="width:' + w(prop) + '"></div>' +
      '<div class="ci" style="left:' + w(ci[0]) + ';width:calc(' + w(ci[1]) + ' - ' + w(ci[0]) + ')"></div></div>' +
      '<div class="scale"><span>0%</span><span>' + (max * 100).toFixed(0) + '%</span></div>';
  }

  function renderTask1(f) {
    const sub = S.summarize(S.filterRows(rows, f));
    const label = [SITE[f.site], SPON[f.sponsor], PER[f.period]].concat(f.excludeCovid ? ['COVID 사유 제외'] : []).join(' · ');
    if (sub.n === 0) {
      $('r1').innerHTML = '<p class="err">이 조건에 맞는 시험이 없습니다.</p><p class="muted">조건을 하나씩 "상관없음"으로 바꿔 보세요.</p>';
      return;
    }
    const max = Math.max(0.12, sub.ci[1] * 1.2);
    let note = '';
    if (sub.n < 100) note = '<p class="muted">비슷한 시험이 ' + sub.n + '건뿐이라 신뢰구간이 넓습니다. 숫자 하나보다 범위를 보세요.</p>';
    $('r1').innerHTML =
      '<p class="muted">' + esc(label) + '</p>' +
      '<div class="big">' + pct(sub.prop) + '</div>' +
      '<p>비슷한 등록 시험 <strong>' + num(sub.n) + '건</strong> 가운데 <strong>' + num(sub.low) + '건</strong>이 모집 부진으로 중단됐습니다. ' +
      '95% 신뢰구간은 <strong>' + pct(sub.ci[0]) + ' ~ ' + pct(sub.ci[1]) + '</strong>입니다.</p>' +
      bar(sub.prop, sub.ci, max) +
      '<p class="muted">비교 기준: 전체 ' + num(overall.n) + '건의 모집 부진 중단 비율 ' + pct(overall.prop) + '. 이 조건의 시험 가운데 사유와 상관없이 중단된 시험은 ' + num(sub.term) + '건입니다.</p>' + note;
  }

  const VERDICT = {
    'no-difference': ['차이를 말할 수 없습니다', '위험비의 95% 신뢰구간이 1을 포함합니다. 이 조건에서는 기관 수만으로 모집 부진 중단 위험이 달라진다고 판단할 수 없습니다.'],
    'multi-higher': ['다기관 쪽이 더 높게 나왔습니다', '단일 기관이 더 위험하다는 흔한 생각과 반대입니다. 여러 기관을 함께 운영하는 부담(예: COVID-19 시기의 동시 중단)을 함께 점검하세요.'],
    'multi-higher-borderline': ['다기관 쪽이 조금 높지만 경계 수준입니다', '신뢰구간의 끝이 1에 거의 닿아 있어(논문 주 분석과 같은 상황), 방향을 단정하지 않습니다. 후원 유형을 고려하거나 COVID-19 사유를 빼면 차이가 뚜렷하지 않았습니다.'],
    'single-higher': ['단일 기관 쪽이 더 높게 나왔습니다', '이 조건에서는 단일 기관 시험의 모집 부진 중단이 더 많았습니다. 기관을 늘리는 것과 함께 아래 점검 목록을 확인하세요.'],
    'single-higher-borderline': ['단일 기관 쪽이 조금 높지만 경계 수준입니다', '신뢰구간의 끝이 1에 거의 닿아 있어 방향을 단정하지 않습니다.'],
    'small': ['판단을 보류합니다', '한쪽 집단의 시험이 너무 적거나 모집 부진 중단이 0건이라 비교할 수 없습니다. 조건을 넓혀 보세요.'],
  };

  function renderTask2(f) {
    const c = S.compareSites(rows, f);
    const row = (name, s) => '<tr><td>' + name + '</td><td>' + num(s.low) + ' / ' + num(s.n) + '</td><td>' + pct(s.prop) + '</td><td>' + pct(s.ci[0]) + ' ~ ' + pct(s.ci[1]) + '</td></tr>';
    const rr = c.rr ? c.rr.rr.toFixed(2) + ' (' + c.rr.lo.toFixed(2) + ' ~ ' + c.rr.hi.toFixed(2) + ')' : '계산할 수 없음';
    const v = VERDICT[c.verdict] || VERDICT.small;
    const label = [SPON[f.sponsor], PER[f.period]].concat(f.excludeCovid ? ['COVID 사유 제외'] : []).join(' · ');
    $('r2').innerHTML =
      '<p class="muted">' + esc(label) + (f.site !== 'any' ? ' (①의 기관 수 선택은 여기서 쓰지 않습니다)' : '') + '</p>' +
      '<div class="tbl"><table><thead><tr><th>구분</th><th>모집 부진 중단 / 전체</th><th>비율</th><th>95% 신뢰구간</th></tr></thead><tbody>' +
      row('단일 기관 (1곳)', c.single) + row('다기관 (2곳 이상)', c.multi) + '</tbody></table></div>' +
      '<p>위험비(단일 ÷ 다기관): <strong>' + rr + '</strong></p>' +
      '<div class="verdict"><strong>' + v[0] + '</strong><br>' + v[1] + '</div>';
  }

  function update() {
    const f = readFilters();
    renderTask1(f);
    renderTask2(f);
  }
  ['site', 'sponsor', 'period', 'covid'].forEach((id) => $(id).addEventListener('change', update));
  update();

  const byNct = new Map(rows.map((r) => [r.nct, r]));
  $('f3').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const raw = $('nctIn').value;
    const id = S.normalizeNct(raw);
    if (!raw.trim()) { $('r3').innerHTML = '<p class="err">번호를 입력해 주세요.</p>'; return; }
    if (!id) { $('r3').innerHTML = '<p class="err">"' + esc(raw.slice(0, 40)) + '"는 NCT 번호 형식이 아닙니다.</p><p class="muted">NCT 뒤에 숫자 8자리입니다. 예: NCT02818608</p>'; return; }
    const r = byNct.get(id);
    if (!r) {
      $('r3').innerHTML = '<p class="err">' + esc(id) + '는 이 자료에 없습니다.</p><p class="muted">분석 대상은 2005~2022년에 시작해 완료·중단된 재활·작업치료 중재 시험 가운데 연구 기관이 등록된 시험입니다. ' +
        '<a href="https://clinicaltrials.gov/study/' + encodeURIComponent(id) + '" rel="noopener">ClinicalTrials.gov에서 직접 보기</a></p>';
      return;
    }
    const reason = (window.TRIAL_REASONS || {})[r.nct];
    const status = r.status === 'T' ? '중단(TERMINATED)' : '완료(COMPLETED)';
    const cls = r.low ? '<strong>모집 부진 중단</strong>으로 분류' : (r.status === 'T' ? '다른 사유의 중단으로 분류' : '완료');
    $('r3').innerHTML =
      '<p><strong>' + esc(r.nct) + '</strong> · ' + status + ' · ' + (r.year || '연도 미상') + '년 시작</p>' +
      '<p>연구 기관 ' + num(r.nSites) + '곳(' + (r.site === 'S' ? '단일 기관' : '다기관') + ') · ' + (r.sponsor === 'I' ? '산업체 후원' : '산업체 외 후원') + '</p>' +
      '<p>이 앱의 분류: ' + cls + (r.covid ? ' · 중단 사유에 COVID-19 언급' : '') + '</p>' +
      (reason ? '<p class="muted">등록된 중단 사유(원문): "' + esc(reason) + '"</p>' : (r.status === 'T' ? '<p class="muted">등록된 중단 사유가 없습니다.</p>' : '')) +
      '<p class="muted"><a href="https://clinicaltrials.gov/study/' + encodeURIComponent(r.nct) + '" rel="noopener">ClinicalTrials.gov 원문 보기</a></p>';
  });
})();
