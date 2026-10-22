/*
 * 수익분석(RPS) · 자가소비 탭 화면. 계산은 전부 rps.js, 여기는 입력 바인딩과 그리기만.
 *
 *   RpsUI.init()           한 번
 *   RpsUI.setCapacity(kw)  배치 탭 합계가 바뀌면 호출. 사용자가 직접 고치기 전까지 따라간다.
 *   RpsUI.setSite(name)    공유 텍스트에 넣을 대상지 이름
 *   RpsUI.render()         RPS 탭 다시 그리기,  RpsUI.renderSelf()  자가소비 탭 다시 그리기
 *
 * 자가소비 탭은 용량·투자비·대출·발전조건을 RPS 탭 입력(st)과 공유하고 요금제 3개만 따로 가진다.
 */
const RpsUI = (() => {
  const $ = id => document.getElementById(id);
  const STORE = 'solar.rps.v1';
  const fmt = RPS.formatWon, sfmt = RPS.signedWon, pay = RPS.payLabel;
  const baek = v => (v / 1e6).toFixed(2) + '백';

  let st = Object.assign({}, RPS.DEFAULTS, RPS.SELF_DEFAULTS, { costPerKw: 1200000, capFollows: true });
  let siteName = '';
  let res = null, selfRes = null;

  const NUM = ['capacity', 'costPerKw', 'constCost', 'kepcoCost', 'customPrice', 'diff12', 'diff1n', 'moduleAngle', 'baseGenTime', 'loanInterest', 'loanPrincipal', 'loanGrace', 'loanPeriod'];
  const BOOL = ['ceilingBasis', 'loanActive'];
  // 원 단위 금액 칸. type=number 는 쉼표를 못 보여줘서 text 로 두고 여기서 찍는다.
  const MONEY = ['costPerKw', 'constCost', 'kepcoCost', 'loanPrincipal'];
  const commas = s => { const d = String(s).replace(/[^0-9]/g, ''); return d ? Number(d).toLocaleString('ko-KR') : ''; };
  const SEL = ['rateCategory', 'voltageType', 'selectionType'];

  function init() {
    load();
    NUM.forEach(k => {
      const el = $('r_' + k);
      // 금액 칸은 치는 동안에도 1,000,000 처럼 쉼표를 찍어 준다(커서는 끝으로).
      if (MONEY.includes(k)) el.addEventListener('input', () => { el.value = commas(el.value); });
      el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
        const v = parseFloat(String(el.value).replace(/,/g, ''));
        if (!isFinite(v)) return;
        onChange(k, v);
      });
    });
    BOOL.forEach(k => $('r_' + k).addEventListener('change', () => onChange(k, $('r_' + k).checked)));
    SEL.forEach(k => $('s_' + k).addEventListener('change', () => { st[k] = $('s_' + k).value; renderSelf(); save(); }));
    $('s_mode').addEventListener('change', () => { st.ppMode = $('s_mode').value; renderSelf(); save(); });
    $('s_ppaRate').addEventListener('change', () => { st.ppRate = parseFloat($('s_ppaRate').value) || 0; st.ppRateInfo = '직접 입력'; renderSelf(); save(); });
    $('s_ppaFetch').addEventListener('click', () => fetchMarket(true));
    $('btnPullCap').onclick = () => { st.capFollows = true; if (window.__layoutTotalKw != null) setCapacity(window.__layoutTotalKw, true); };
    $('btnRpsReset').onclick = () => { const cap = st.capacity; st = Object.assign({}, RPS.DEFAULTS, RPS.SELF_DEFAULTS, { costPerKw: 1200000, capFollows: st.capFollows, capacity: cap }); deriveCost(); render(); save(); };
    $('btnRpsShare').onclick = () => share(false);
    $('btnRpsMail').onclick = () => share(true);
    $('btnSelfShare').onclick = () => shareSelf(false);
    $('btnSelfMail').onclick = () => shareSelf(true);
    render();
  }

  // 입력 하나가 바뀌었을 때 연쇄 규칙 (검색어플 핸들러와 같다)
  function onChange(k, v) {
    st[k] = v;
    if (k === 'capacity') { st.capFollows = false; deriveCost(); }
    if (k === 'costPerKw') deriveCost();
    if (k === 'constCost') { st.costPerKw = st.capacity > 0 ? Math.round(v / st.capacity) : st.costPerKw; autoLoan(); }
    if (k === 'kepcoCost') autoLoan();
    if (k === 'loanActive' && v) autoLoan();
    render(); save();
  }
  // 공사비 = kW당 단가 × 용량. 용량이 배치에서 넘어오면 공사비도 같이 움직인다.
  function deriveCost() { st.constCost = Math.round(st.costPerKw * st.capacity); autoLoan(); }
  // 대출원금 자동 산정 — 1등급 기준 공사비+한전분담금의 80%
  function autoLoan() { st.loanPrincipal = Math.round((st.constCost + st.kepcoCost) * 0.8); }

  function setCapacity(kw, force) {
    if (!force && !st.capFollows) return;
    st.capacity = Math.round(kw * 1000) / 1000;
    deriveCost(); render(); save();
  }
  function setSite(name) { siteName = name || ''; }

  // ------------------------------------------------------------ RPS 그리기
  function render() {
    res = RPS.compute(st);
    NUM.forEach(k => { const el = $('r_' + k); if (document.activeElement !== el) el.value = MONEY.includes(k) ? fmt(st[k]) : st[k]; });
    BOOL.forEach(k => { $('r_' + k).checked = !!st[k]; });
    $('r_angleV').textContent = st.moduleAngle;
    $('r_genV').textContent = Number(st.baseGenTime).toFixed(1);
    $('r_gapNote').textContent = st.ceilingBasis ? '(2등급 −13.50 · 무등급 −24.00원/kWh)' : '(가격점수 환산: 2등급 −29.32 · 무등급 −84.13)';
    $('r_loanFields').style.opacity = st.loanActive ? 1 : .4;
    $('r_basisBadge').textContent = st.ceilingBasis ? '상한가 기준' : '가격점수 고려';

    const G = RPS.GRADES;
    const th = '<tr><th>구분</th>' + G.map(g => '<th style="color:' + g.color + '">' + g.label + '</th>').join('') + '</tr>';

    $('r_costTable').innerHTML = th
      + '<tr><td>공사비</td>' + G.map(g => '<td>' + fmt(res.gradeConstCost[g.key]) + '</td>').join('') + '</tr>'
      + '<tr><td>한전분담금</td><td colspan="3" style="text-align:center">' + fmt(st.kepcoCost) + '</td></tr>'
      + '<tr><td>총 투자비</td>' + G.map(g => '<td><b style="color:' + g.color + '">' + fmt(res.gradeTotalCost[g.key]) + '</b></td>').join('') + '</tr>'
      + '<tr><td>고정가격단가</td>' + G.map(g => '<td>' + res.gradePrice[g.key].toFixed(2) + '</td>').join('') + '</tr>';

    $('r_cards').innerHTML = G.map(g => '<div class="card" style="background:' + g.color + '"><small>' + g.label + ' BEP</small><b>' + pay(res.gradePayback[g.key]) + '</b></div>').join('');
    $('r_legend').innerHTML = G.map(g => '<span><i style="background:' + g.color + '"></i>' + g.label + ' 누적순익</span>').join('');

    const tone = v => v >= 0 ? 'pos' : 'neg';
    const rowsDef = [
      ['고정가격단가 (원/kWh)', r => r.price.toFixed(4)],
      ['연 발전량 (kWh)', r => fmt(r.annualGeneration)],
      ['공사비 (원)', r => fmt(r.constCost)],
      ['총 투자비 (원)', r => fmt(r.totalCost)],
      ['연 수익 (원)', r => fmt(r.annualRevenue)],
      ['30년 누적매출 (원)', r => fmt(r.cumRevenue)],
      ['30년 누적순익 (원)', r => fmt(r.cumProfit)],
      ['공사비 차액 (1등급 대비)', r => r.key === 1 ? '기준' : '<span class="' + tone(-r.costDiff) + '">' + sfmt(r.costDiff) + '</span>'],
      ['30년 매출 차이 (1등급 대비)', r => r.key === 1 ? '기준' : '<span class="' + tone(r.revenueDiff) + '">' + sfmt(r.revenueDiff) + '</span>'],
      ['실 수익편차 (공사비 반영)', r => r.key === 1 ? '기준' : '<span class="' + tone(r.realDiff) + '">' + sfmt(r.realDiff) + '</span>', true],
      ['BEP (자기자본 회수)', r => pay(r.payback)],
    ];
    $('r_cmpTable').innerHTML = th + rowsDef.map(([l, f, hl]) => '<tr' + (hl ? ' class="hl"' : '') + '><td>' + l + '</td>' + res.rows.map(r => '<td>' + f(r) + '</td>').join('') + '</tr>').join('');

    const lm = res.loanMonthly;
    $('r_loanMonthly').style.display = lm ? 'block' : 'none';
    if (lm) {
      $('r_loanMonthly').innerHTML = '<b>매월 원리금상환액 (1등급 기준)</b>'
        + (lm.graceMonths > 0 ? '<div><span>1~' + lm.graceMonths + '회차 (거치)</span><span>이자 ' + fmt(lm.graceInterest) + '원</span></div>' : '')
        + '<div><span>' + lm.repayStart + '~' + lm.repayEnd + '회차 (상환)</span><span>원금 ' + fmt(lm.repayPrincipal) + ' + 이자 ' + fmt(lm.repayInterest) + ' = ' + fmt(lm.installment) + '원</span></div>';
    }

    $('r_bestBadge').textContent = '추천 : ' + res.best.label;
    $('r_bestBadge').style.background = res.best.color;
    $('r_headline').textContent = res.comment.headline;
    $('r_gbox').innerHTML = res.comment.grades.map(g => '<div class="gcard" style="border-top-color:' + g.color + '"><b style="color:' + g.color + '">' + g.label + '</b>' + g.rows.map(([k, v]) => '<div><span>' + k + '</span><span>' + v + '</span></div>').join('') + '</div>').join('');
    $('r_notes').innerHTML = res.comment.notes.map(n => '<li>' + n + '</li>').join('');

    drawGradeChart();
    renderSelf();
  }

  // ------------------------------------------------------------ 자가소비 그리기
  /** 파워플래너 실사용량 기반 자가소비 (pp.js) — st.pp 에 저장, 자가소비 탭 아래 표로 */
  function setPP(res, mode) { st.pp = res; if (mode) st.ppMode = mode; save(); renderSelf(); }
  function renderPP() {
    const box = $('ppResult'); if (!box) return;
    const u = st.pp;
    if (!u || !u.okN) { box.style.display = 'none'; return; }
    if (true) {   // 표는 월별 절감 시뮬레이션에 합쳤다(2026-10-22). 여기는 자료 출처·요일별 평균만.
      const WD = PP.WD; const avg = w => { let s = 0, n = 0; u.months.forEach(m => { if (m.hourly) { s += m.hourly[w].reduce((a, b) => a + (Number(b) || 0), 0); n++; } }); return n ? s / n : 0; };
      box.style.display = '';
      box.innerHTML = '<h4>🔌 파워플래너 자료 <small style="color:var(--muted)">' + u.okN + '개월 · ' + (u.contract || '요금제 미확인') + ' · 받은 날 ' + u.fetched.slice(0, 10) + ' · 아이디 ' + (u.id || '') + '</small></h4>'
        + '<div style="font-size:12px">요일별 하루 평균 사용량(kWh): ' + WD.map((d, w) => d + ' <b>' + Math.round(avg(w)).toLocaleString() + '</b>').join(' · ') + '</div>'
        + (u.months.some(m => !m.hourly) ? '<div style="font-size:12px;color:#fbbf24">해석 못 한 달: ' + u.months.filter(m => !m.hourly).map(m => m.y + '.' + m.m).join(', ') + '</div>' : '');
      return;
    }
    const r = PP.compute(u, st.capacity, selfRes.monthly, st.ppMode || '상계거래', st.ppRate || 0);
    const k = v => Math.round(v).toLocaleString();
    box.style.display = '';
    box.innerHTML = '<h4>🔌 파워플래너 실사용량 기반 자가소비 <span class="badge" style="background:#334155">' + (st.ppMode || '상계거래') + '</span> <small style="color:var(--muted)">' + u.okN + '개월 · ' + (u.contract || '') + ' · ' + u.fetched.slice(0, 10) + '</small></h4>'
      + '<div class="cards four">'
      + [['연 사용량', k(r.total.use) + ' kWh', '#1e293b'], ['연 발전량', k(r.total.gen) + ' kWh', '#4f46e5'], ['자가소비 (RE100 ' + (r.re100 * 100).toFixed(1) + '%)', k(r.total.self) + ' kWh', '#059669'], ['잉여 ' + (r.surplusPct * 100).toFixed(1) + '%', k(r.total.surplus) + ' kWh', '#ea580c'], ['연 절감액', fmt(r.total.saving) + ' 원', '#0f766e']]
        .map(([l, v, c]) => '<div class="card" style="background:' + c + '"><small>' + l + '</small><b>' + v + '</b></div>').join('') + '</div>'
      + '<div class="scrollx"><table class="cmp"><tr><th>월</th><th>사용량</th><th>발전량</th><th>자가소비</th><th>잉여</th><th class="opt">자가단가</th><th class="opt">잉여단가</th><th>절감액</th></tr>'
      + r.monthly.map(m => '<tr><td>' + m.y + '.' + m.m + '</td><td>' + k(m.use) + '</td><td>' + k(m.gen) + '</td><td>' + k(m.self) + '</td><td>' + k(m.surplus) + '</td><td class="opt">' + m.selfRate.toFixed(1) + '</td><td class="opt">' + m.surplusRate.toFixed(1) + '</td><td>' + fmt(m.saving) + '</td></tr>').join('')
      + '<tr class="hl"><td>합계</td><td>' + k(r.total.use) + '</td><td>' + k(r.total.gen) + '</td><td>' + k(r.total.self) + '</td><td>' + k(r.total.surplus) + '</td><td class="opt"></td><td class="opt"></td><td>' + fmt(r.total.saving) + '</td></tr></table></div>'
      + '<div style="font-size:12px;color:var(--muted);margin-top:4px">발전량 = 설비용량 × 월별 시간대 발전량(kWh/kW, 사내 엑셀 「자가소비 연간분석표」 표) · 자가소비 = 시간대별 min(사용, 발전) · 절감 = 자가소비×(전력량+기후환경 9+연료비 5) + 잉여×' + ((st.ppMode || '상계거래') === '단순병렬' ? '0' : (st.ppMode === '자가PPA' ? 'SMP+REC ' + (st.ppRate || 0) + '원' : '전력량요금')) + '</div>'
      + (u.months.some(m => !m.hourly) ? '<div style="font-size:12px;color:#fbbf24">해석 못 한 달: ' + u.months.filter(m => !m.hourly).map(m => m.y + '.' + m.m).join(', ') + '</div>' : '');
  }
  /** 📈 오늘 SMP+1REC: 중계(path=pp op=market) 가 전력거래소 공개 페이지에서 육지 SMP 가중평균과 REC 평균가를 읽는다 */
  let marketBusy = false;
  async function fetchMarket(manual) {
    if (marketBusy) { $('s_ppaInfo').textContent = '이미 시세를 조회하는 중입니다 — 잠시만요 (최대 1분)'; return; }
    if (typeof Auth === 'undefined' || typeof PP === 'undefined') { $('s_ppaInfo').textContent = '시세 모듈이 없습니다 — Ctrl+F5 로 새로 고치세요'; return; }
    marketBusy = true;
    const btn = $('s_ppaFetch'); btn.disabled = true; btn.textContent = '⏳ 조회 중…';
    $('s_ppaInfo').textContent = '시세 조회 중… (SMP → REC 거래속보 순서, 최대 1분)';
    try {
      const r = await PP.market();
      st.ppRate = r.total; st.ppRateInfo = 'SMP ' + r.smp.avg + '원 (육지 가중평균, ' + r.smp.date + ') + REC ' + Math.round(r.rec.avg).toLocaleString() + '원/REC (' + r.rec.date + ' ' + (r.rec.source || '평균가') + ', 종가 ' + Math.round(r.rec.close || 0).toLocaleString() + ') ÷ 1,000 = ' + r.total + '원/kWh · 가중치 1.0 · ' + (r.via || '');
      st.ppRateDate = new Date().toISOString().slice(0, 10);
      save(); renderSelf();
      $('s_ppaInfo').textContent = st.ppRateInfo + ' (조회 ' + st.ppRateDate + ')';   // renderSelf 는 조회 중엔 문구를 안 건드리므로 여기서
    } catch (e) {
      const msg = /아이디|비밀번호/.test(e.message) ? '중계가 아직 시세 기능이 없는 옛 버전입니다 — server/auth_pp.gs 를 다시 붙여넣고 새 버전으로 배포하세요' : e.message;
      $('s_ppaInfo').innerHTML = '시세 조회 실패: ' + msg.replace(/</g, '&lt;') + ' · <a href="' + PP.SMP_URL + '" target="_blank" rel="noopener" style="color:#93c5fd">육지 SMP(가중평균)</a> · <a href="' + PP.REC_NEWS_LIST + '" target="_blank" rel="noopener" style="color:#93c5fd">REC 거래속보(원스톱)</a> → SMP + REC÷1,000 을 위 칸에 입력';
      if (manual && window.__solar && __solar.hint) __solar.hint('SMP·REC 시세 조회 실패 — 링크에서 보고 직접 입력하세요');
    }
    finally { marketBusy = false; btn.disabled = false; btn.textContent = '📈 오늘 시세'; }
  }
  /** 파워플래너 실사용량이 있으면 PP.compute 로 월별 자가소비·잉여를 구해 computeSelf 에 넘긴다 */
  function ppOverride(base) {
    const u = st.pp; if (!u || !u.okN || typeof PP === 'undefined') return null;
    const mode = st.ppMode || '단순병렬';
    const r = PP.compute(u, st.capacity, base.monthly, mode, st.ppRate || 0);
    return { monthly: r.monthly, mode, re100: r.re100, surplusPct: r.surplusPct };
  }
  /** 제안서용: 계약방식 mode 로 계산한 자가소비 결과(화면 상태는 그대로) */
  function selfFor(mode, plain) {
    const saved = st.ppMode; st.ppMode = mode;
    try { const base = RPS.computeSelf(Object.assign({}, st, { selfOverride: null })); const ov = plain ? null : ppOverride(base); const r = ov ? RPS.computeSelf(Object.assign({}, st, { selfOverride: ov })) : base; r.ovInfo = ov; r.mode = mode; r.ppRate = st.ppRate || 0; r.pp = st.pp; return r; }
    finally { st.ppMode = saved; }
  }
  function renderSelf() {
    st.ppMode = st.ppMode || '단순병렬';
    $('s_mode').value = st.ppMode; $('s_ppaRate').value = st.ppRate || 0; $('s_ppaWrap').style.display = st.ppMode === '자가PPA' ? '' : 'none';
    if (!marketBusy) $('s_ppaInfo').textContent = st.ppRateInfo ? st.ppRateInfo + (st.ppRateDate ? ' (조회 ' + st.ppRateDate + ')' : '') : '';   // 조회 중 문구는 덮지 않는다
    // 자가PPA 를 고른 날 시세가 없으면 자동 조회(하루 한 번)
    if (st.ppMode === '자가PPA' && st.ppRateDate !== new Date().toISOString().slice(0, 10) && !marketBusy) setTimeout(() => fetchMarket(false), 0);
    const base = RPS.computeSelf(Object.assign({}, st, { selfOverride: null }));
    const ov = ppOverride(base);
    selfRes = ov ? RPS.computeSelf(Object.assign({}, st, { selfOverride: ov })) : base;
    selfRes.ovInfo = ov;
    const r = selfRes;
    // 계약종류를 바꾸면 종별·선택요금 목록이 달라지므로 유효값으로 되돌린 결과를 다시 반영한다.
    st.rateCategory = r.rateCategory; st.voltageType = r.voltageType; st.selectionType = r.selectionType;
    fillSel('s_rateCategory', RPS.RATE_CATEGORIES.map(c => [c.key, c.label]), st.rateCategory);
    fillSel('s_voltageType', r.voltageKeys.map(k => [k, RPS.RATE_TABLE[r.rateCategory][k].label]), st.voltageType);
    fillSel('s_selectionType', r.selectionKeys.map(k => [k, RPS.SELECT_LABEL[k]]), st.selectionType);
    $('s_rates').innerHTML = '여름 <b>' + r.rates.summer + '</b> · 봄가을 <b>' + r.rates.springFall + '</b> · 겨울 <b>' + r.rates.winter + '</b> → 평균 <b style="color:var(--accent)">' + r.savingRate + '</b>';
    $('s_planBadge').textContent = r.labels.category + ' ' + r.labels.voltage + ' ' + r.labels.selection + ' · ' + (st.ppMode || '단순병렬') + (r.override ? ' · 파워플래너 실사용량' : ' · 전량 자가소비 가정(사용량 자료 없음)');

    $('s_cards').innerHTML = [
      ['월평균 절감액', baek(r.avgMonthly), '#1e293b'],
      ['1년 절감액', baek(r.total1Y), '#4f46e5'],
      ['20년 연평균', baek(r.avg20Y), '#059669'],
      ['온실가스 감축', r.co2t.toFixed(1) + ' tCO₂', '#ea580c'],
    ].map(([l, v, c]) => '<div class="card" style="background:' + c + '"><small>' + l + '</small><b>' + v + '</b></div>').join('')
      + '<div class="card" style="background:#334155;grid-column:1/-1"><small>BEP (자기자본 ' + fmt(r.equity) + '원 회수)</small><b>' + pay(r.payback) + '</b></div>';

    const sum = k => r.monthly.reduce((a, b) => a + b[k], 0);
    $('s_table').innerHTML = '<tr><th>월</th><th class="opt">기후환경</th><th>전력량</th><th class="opt">연료비</th><th>합계</th><th>발전량(kWh)</th><th>1년 절감(원)</th><th>20년 절감(원)</th></tr>'
      + r.monthly.map(m => '<tr><td>' + m.month + '월</td><td class="opt">9.0</td><td>' + m.energyCharge.toFixed(1) + '</td><td class="opt">5.0</td><td>' + m.totalUnitRate.toFixed(1) + '</td><td>' + fmt(m.gen) + '</td><td>' + fmt(m.saving1Y) + '</td><td>' + fmt(m.saving20Y) + '</td></tr>').join('')
      + '<tr class="hl"><td>합계/평균</td><td class="opt">9.0</td><td>' + (sum('energyCharge') / 12).toFixed(1) + '</td><td class="opt">5.0</td><td>' + (sum('totalUnitRate') / 12).toFixed(1) + '</td><td>' + fmt(sum('gen')) + '</td><td>' + fmt(sum('saving1Y')) + '</td><td>' + fmt(sum('saving20Y')) + '</td></tr>';

    if (r.override) {
      const k = v => Math.round(v || 0).toLocaleString();
      const S = key => r.monthly.reduce((a, b) => a + (b[key] || 0), 0);
      $('s_table').innerHTML = '<tr><th>월</th><th class="cu">전기사용량<br>(kWh)</th><th class="cg">발전량<br>(kWh)</th><th class="cs">재생E 사용량<br>(kWh)</th><th class="cx">잉여 발전량<br>(kWh)</th><th class="opt">단가<br>(①+②+③)</th><th class="cw">전기요금<br>절감액(원)</th><th class="cw">잉여 ' + (st.ppMode === '단순병렬' ? '(미정산)' : st.ppMode === '자가PPA' ? '판매수익(원)' : '절감액(원)') + '</th><th class="ct">합계<br>절감액(원)</th></tr>'
        + r.monthly.map(m => '<tr><td>' + (m.y ? m.y + '.' : '') + m.month + '월</td><td class="cu">' + k(m.use) + '</td><td class="cg">' + k(m.gen) + '</td><td class="cs">' + k(m.self) + '</td><td class="cx">' + k(m.surplus) + '</td><td class="opt">' + m.totalUnitRate.toFixed(1) + '</td><td class="cw">' + k(m.elecSaving) + '</td><td class="cw">' + k(m.surplusSaving) + '</td><td class="ct">' + k(m.saving1Y) + '</td></tr>').join('')
        + '<tr class="hl"><td>합계</td><td class="cu">' + k(S('use')) + '</td><td class="cg">' + k(S('gen')) + '</td><td class="cs">' + k(S('self')) + '</td><td class="cx">' + k(S('surplus')) + '</td><td class="opt"></td><td class="cw">' + k(S('elecSaving')) + '</td><td class="cw">' + k(S('surplusSaving')) + '</td><td class="ct">' + k(r.total1Y) + '</td></tr>'
        + '<tr><td colspan="9" style="font-size:11px;color:var(--muted);text-align:left">#최근 1년 전기사용량 대비 잉여량 ' + (r.ovInfo.surplusPct * 100).toFixed(1) + '% · RE100 달성률(재생E 사용량/전기사용량) ' + (r.ovInfo.re100 * 100).toFixed(1) + '% · 예상절감액 = 재생E 사용량 × (전력량요금 + 기후환경 9 + 연료비조정 5)' + (st.ppMode === '상계거래' ? ' + 잉여 × 전력량요금(상계)' : st.ppMode === '자가PPA' ? ' + 잉여 × SMP+REC ' + (st.ppRate || 0) + '원' : ' (단순병렬: 잉여는 수익 없음)') + '</td></tr>';
    }
    drawSelfChart();
    try { renderPP(); } catch (e) { console.warn('renderPP', e); }
  }
  function fillSel(id, opts, val) {
    const el = $(id);
    el.innerHTML = opts.map(([k, l]) => '<option value="' + k + '">' + l + '</option>').join('');
    el.value = val;
  }

  // ------------------------------------------------------------ 차트 (캔버스 직접)
  function chartBase(cv) {
    const W = cv.clientWidth || 320, H = 190, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const c = cv.getContext('2d'); c.scale(dpr, dpr); c.clearRect(0, 0, W, H);
    return { c, W, H, L: 44, R: 8, T: 10, B: 22 };
  }
  function axes(g, min, max) {
    const { c, W, H, L, R, T, B } = g; const pw = W - L - R, ph = H - T - B;
    const x = yr => L + (yr - 1) / 29 * pw, y = v => T + (1 - (v - min) / (max - min || 1)) * ph;
    c.strokeStyle = 'rgba(255,255,255,.12)'; c.fillStyle = '#9fc4b3'; c.font = '10px system-ui'; c.textAlign = 'right';
    const step = niceStep((max - min) / 4);
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) { c.beginPath(); c.moveTo(L, y(v)); c.lineTo(W - R, y(v)); c.stroke(); c.fillText((v / 1e8).toFixed(1) + '억', L - 4, y(v) + 3); }
    c.textAlign = 'center'; [1, 5, 10, 15, 20, 25, 30].forEach(yr => c.fillText(yr + 'y', x(yr), H - 6));
    c.strokeStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.moveTo(L, y(0)); c.lineTo(W - R, y(0)); c.stroke();
    return { x, y, pw, ph };
  }
  function area(c, s, x, y, color, lw) {
    c.beginPath(); c.moveTo(x(1), y(0)); s.forEach((v, i) => c.lineTo(x(i + 1), y(v))); c.lineTo(x(30), y(0)); c.closePath();
    c.fillStyle = color + '22'; c.fill();
    c.beginPath(); s.forEach((v, i) => i ? c.lineTo(x(i + 1), y(v)) : c.moveTo(x(1), y(v))); c.strokeStyle = color; c.lineWidth = lw; c.stroke();
  }
  function drawGradeChart() {
    const g = chartBase($('chart')); const { c, W, T } = g;
    const G = RPS.GRADES, series = k => res.gradeYearly[k].map(d => d.cumProfit * 1000);
    let max = 0, min = 0; G.forEach(x => series(x.key).forEach(v => { max = Math.max(max, v); min = Math.min(min, v); }));
    if (max <= 0) max = 1;
    const { x, y, ph } = axes(g, min, max);
    [0, 2, 1].forEach(k => area(c, series(k), x, y, G.find(z => z.key === k).color, k === 1 ? 3 : 2));
    c.setLineDash([4, 4]); c.lineWidth = 1.5; c.font = 'bold 10px system-ui'; c.textAlign = 'left';
    G.forEach((gr, i) => {
      const p = res.gradePayback[gr.key]; if (p.year === '-') return;
      const yr = Number(p.year) + Number(p.month) / 12; if (yr < 1 || yr > 30) return;
      c.strokeStyle = gr.color; c.beginPath(); c.moveTo(x(yr), T); c.lineTo(x(yr), T + ph); c.stroke();
      c.fillStyle = gr.color; c.fillText(gr.label + ' ' + p.year + '년' + p.month + '개월', Math.min(x(yr) + 4, W - 90), T + 12 + i * 13);
    });
    c.setLineDash([]);
  }
  function drawSelfChart() {
    const g = chartBase($('s_chart')); const { c, W, T } = g;
    const s = selfRes.yearly.map(d => d.cumProfit * 1000);
    let max = Math.max(1, selfRes.equity, ...s), min = Math.min(0, ...s);
    const { x, y, ph } = axes(g, min, max);
    area(c, s, x, y, '#4f46e5', 3);
    c.setLineDash([6, 6]); c.strokeStyle = '#f43f5e'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x(1), y(selfRes.equity)); c.lineTo(x(30), y(selfRes.equity)); c.stroke();
    const p = selfRes.payback;
    if (p.year !== '-') {
      const yr = Number(p.year) + Number(p.month) / 12;
      if (yr >= 1 && yr <= 30) { c.strokeStyle = '#10b981'; c.beginPath(); c.moveTo(x(yr), T); c.lineTo(x(yr), T + ph); c.stroke(); c.fillStyle = '#10b981'; c.font = 'bold 10px system-ui'; c.textAlign = 'left'; c.fillText('BEP ' + p.year + '년 ' + p.month + '개월', Math.min(x(yr) + 4, W - 90), T + 12); }
    }
    c.setLineDash([]);
  }
  function niceStep(raw) {
    if (raw <= 0) return 1e8;
    const p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }

  // ------------------------------------------------------------ 공유 · 메일
  function send(title, text) {
    if (window.Native && window.Native.share) window.Native.share(title, text);
    else if (navigator.share) navigator.share({ title, text });
    else if (navigator.clipboard) { navigator.clipboard.writeText(text); alert('클립보드에 복사했습니다.'); }
  }
  const company = () => ($('m_company').value || '').trim();
  const mailTo = () => ($('m_to').value || '').trim();
  const titleOf = base => '[그랜드썬기술단] ' + (company() ? company() + ' ' : '') + base + (siteName ? ' — ' + siteName : '');

  // 리포트 이미지에 넣을 내용. 차트는 화면의 캔버스를 그대로 가져다 쓴다.
  function rpsSpec() {
    const i = res.input;
    return {
      title: '모듈 등급별 수익비교 검토자료', site: siteName, company: company(),
      rows: [['설비용량', res.capacity.toFixed(3) + ' kW'], ['1등급 공사비 / 한전분담금', fmt(i.constCost) + ' / ' + fmt(i.kepcoCost) + ' 원'],
             ['단가 산정기준', (i.ceilingBasis ? '상한가 기준' : '가격점수 고려') + ' · 1등급 ' + i.customPrice + '원/kWh'], ['발전시간 / 경사각', i.baseGenTime + 'h · ' + i.moduleAngle + '°'],
             ['대출', i.loanActive ? fmt(i.loanPrincipal) + '원 (' + i.loanInterest + '%, 거치 ' + i.loanGrace + '년 · 상환 ' + i.loanPeriod + '년)' : '없음 (전액 자기자본)'],
             ['추천', res.best.label + ' — ' + pay(res.best.payback) + ' 회수']],
      chart: $('chart'),
      table: { head: ['구분', '1등급', '2등급', '무등급'], body: [
        ['고정가격단가', ...res.rows.map(r => r.price.toFixed(2))], ['총 투자비', ...res.rows.map(r => fmt(r.totalCost))], ['연 수익', ...res.rows.map(r => fmt(r.annualRevenue))],
        ['30년 누적순익', ...res.rows.map(r => fmt(r.cumProfit))], ['실 수익편차', ...res.rows.map(r => r.key === 1 ? '기준' : sfmt(r.realDiff))], ['BEP', ...res.rows.map(r => pay(r.payback))] ] },
      notes: [res.comment.headline].concat(res.comment.notes),
    };
  }
  function selfSpec() {
    const r = selfRes, i = r.input;
    return {
      title: '자가소비 절감 분석 리포트', site: siteName, company: company(),
      rows: [['설비용량', r.capacity.toFixed(3) + ' kW'], ['요금제', r.labels.category + ' ' + r.labels.voltage + ' ' + r.labels.selection + ' (평균 ' + r.savingRate + '원/kWh)'],
             ['총 투자비', fmt(r.totalInvestment) + ' 원'], ['연간 절감액', fmt(r.total1Y) + ' 원'], ['20년 누적 절감액', fmt(r.total1Y * 20) + ' 원'],
             ['온실가스 감축', r.co2t.toFixed(1) + ' tCO₂/년'], ['BEP (자기자본 회수)', pay(r.payback)]],
      chart: $('s_chart'),
      table: { head: ['월', '단가합계', '발전량', '1년 절감', '20년 절감'], body: r.monthly.map(m => [m.month + '월', m.totalUnitRate.toFixed(1), fmt(m.gen), fmt(m.saving1Y), fmt(m.saving20Y)]) },
      notes: [],
    };
  }
  const share = asMail => asMail
    ? Report.mail({ to: mailTo(), subject: titleOf('모듈 등급별 수익비교'), body: RPS.summaryText(res, siteName), spec: rpsSpec() })
    : send(titleOf('모듈 등급별 수익비교'), RPS.summaryText(res, siteName));
  const shareSelf = asMail => asMail
    ? Report.mail({ to: mailTo(), subject: titleOf('자가소비 절감 분석'), body: RPS.selfSummaryText(selfRes, siteName), spec: selfSpec() })
    : send(titleOf('자가소비 절감 분석'), RPS.selfSummaryText(selfRes, siteName));

  // ------------------------------------------------------------ 저장
  function save() { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch (e) {} }
  function load() {
    try { const s = JSON.parse(localStorage.getItem(STORE) || 'null'); if (s) st = Object.assign(st, s); } catch (e) {}
  }

  return { init, setCapacity, setSite, render, renderSelf, setPP, selfFor, getState: () => st };
})();
