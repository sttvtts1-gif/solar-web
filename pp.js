/*
 * 한전 파워플래너(pp.kepco.co.kr) 전기사용량 가져오기 + 자가소비 계산 (2026-10-21).
 *
 * 흐름: 자가소비 탭 「📥 파워플래너 가져오기」 → 아이디·비밀번호 입력 → 중계(server/auth_pp.gs, path=pp op=usage) 가
 *   ① RSA 로그인 ② 전기사용량>요일별(rs0105.do) 12개월 ③ 선택요금 시뮬레이션(pf0101_1.do)의 「적용 요금제·계약전력」 한 줄
 *   을 받아 온다. 비밀번호·세션은 어디에도 저장하지 않는다(중계도 저장 안 함).
 * 파싱: 한전 응답 형식은 로그인해야 보이므로 미리 확정할 수 없다 → parseMonth() 가 JSON·HTML 표를 휴리스틱으로 24시간×7요일 표로
 *   바꾼다. 못 바꾸면 raw 를 진단 상자에 보여 준다(그걸 보내 주면 파서를 맞춘다).
 * 계산: 사내 엑셀 「손익계산서_자가사용_한전파워플래너」 와 같은 방식 —
 *   월별로 요일별 시간대 사용량 × 그 달의 요일 수, 발전량 = 설비용량 × 월별 시간별 발전량(kWh/kW, 엑셀 '자가소비 연간분석표' J3 표),
 *   자가소비 = Σ min(사용, 발전), 잉여 = 발전 − 자가소비,
 *   절감액 = 자가소비 × (전력량요금 + 기후환경 9 + 연료비조정 5) + 잉여 × (상계거래면 전력량요금, 단순병렬이면 0).
 * 기존 python exe(한전_통합_자동화_시스템)는 셀레니움으로 같은 페이지를 사람이 로그인한 뒤 긁어 엑셀에 넣던 것이고, 이 모듈은 그 자동화를 앱 안으로 옮긴 것.
 */
const PP = (() => {
  /** 월별(1~12) × 시간(1~24h) 1kW 당 발전량(kWh). 엑셀 '자가소비 연간분석표' K5:V28 (발전시간 3.6h/일 기준 분포) */
  const PROFILE = [
    [0,0,0,0,0,0,0,0.0551,0.1484,0.2840,0.3645,0.4366,0.4451,0.3942,0.2416,0.0933,0.0085,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0.0094,0.0845,0.1971,0.3332,0.4364,0.4693,0.4317,0.3848,0.2816,0.1314,0.0282,0,0,0,0,0,0,0],
    [0,0,0,0,0,0.0042,0.0381,0.1399,0.2882,0.4535,0.5553,0.5807,0.6104,0.5468,0.4196,0.2586,0.0805,0.0042,0,0,0,0,0,0],
    [0,0,0,0,0,0.0307,0.0876,0.1883,0.3329,0.4511,0.5563,0.5825,0.5825,0.5300,0.4117,0.2628,0.1051,0.0131,0,0,0,0,0,0],
    [0,0,0,0,0,0.0551,0.1314,0.3009,0.4281,0.5553,0.6528,0.6951,0.6740,0.6189,0.5214,0.3645,0.1780,0.0509,0,0,0,0,0,0],
    [0,0,0,0,0,0.0219,0.0745,0.1533,0.2672,0.3854,0.5037,0.5650,0.5825,0.5738,0.5037,0.4249,0.2628,0.1664,0,0,0,0,0,0],
    [0,0,0,0,0,0.0254,0.0551,0.1272,0.2035,0.3306,0.4154,0.4705,0.4959,0.5086,0.4620,0.3645,0.2670,0.1695,0,0,0,0,0,0],
    [0,0,0,0,0,0,0.0381,0.0975,0.1865,0.3009,0.4112,0.4451,0.4493,0.4323,0.3900,0.3009,0.1823,0.1102,0,0,0,0,0,0],
    [0,0,0,0,0,0,0.0307,0.1007,0.2278,0.3723,0.4774,0.5344,0.5563,0.5256,0.4687,0.3241,0.1840,0.0394,0,0,0,0,0,0],
    [0,0,0,0,0,0,0.0170,0.0805,0.2204,0.3857,0.5086,0.5892,0.5765,0.5341,0.4366,0.2882,0.0890,0.0042,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0.0569,0.1664,0.3066,0.4205,0.4730,0.4949,0.4424,0.3066,0.1402,0.0175,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0.0127,0.0933,0.2119,0.3306,0.4408,0.4663,0.4281,0.2882,0.1356,0.0212,0,0,0,0,0,0,0],
  ];
  const WD = ['일', '월', '화', '수', '목', '금', '토'];

  /** 그 달의 요일별 날 수 [일..토] */
  function weekdayCounts(y, m) {
    const n = [0, 0, 0, 0, 0, 0, 0], days = new Date(y, m, 0).getDate();
    for (let d = 1; d <= days; d++) n[new Date(y, m - 1, d).getDay()]++;
    return n;
  }
  const num = v => { if (v == null) return NaN; const s = String(v).replace(/,/g, '').trim(); return s === '' || s === '-' ? NaN : Number(s); };

  /**
   * 한 달 응답(raw 문자열) → { hourly: [7][24] kWh, note } . 휴리스틱:
   *  A) JSON: 길이 24(±)인 객체 배열에서 각 객체의 숫자 필드 7개 → 요일 열 / 길이 7인 배열에서 숫자 24개 → 요일 행
   *  B) HTML 표: 25줄 이상이고 각 줄에 숫자 7개 이상
   */
  function parseMonth(raw) {
    if (!raw) return null;
    const txt = String(raw).trim();
    const tryJson = s => { try { return JSON.parse(s); } catch (e) { return null; } };
    let j = tryJson(txt);
    if (!j) { const m = /[\[{][\s\S]*[\]}]/.exec(txt); if (m) j = tryJson(m[0]); }
    const fromRows = (rows, keyOrder) => {   // rows: 24 × (≥7 숫자) 또는 7 × 24
      if (rows.length >= 24 && rows.slice(0, 24).every(r => r.length >= 7)) return { hourly: WD.map((_, w) => rows.slice(0, 24).map(r => r[w])), note: '24시간×7요일 (' + keyOrder + ')' };
      if (rows.length >= 7 && rows.slice(0, 7).every(r => r.length >= 24)) return { hourly: rows.slice(0, 7).map(r => r.slice(0, 24)), note: '7요일×24시간 (' + keyOrder + ')' };
      return null;
    };
    if (j) {
      // C) 숫자 배열 묶음: {SUN:[24개],MON:[...]} 또는 [[24개]×7] 또는 [[7개]×24] 또는 {rows:[{..},..]}
      const rowSetsOf = x => {
        const sets = [];
        (function walk(v, depth) {
          if (depth > 6 || !v || typeof v !== 'object') return;
          const vals = Array.isArray(v) ? v : Object.values(v);
          const numArr = a => Array.isArray(a) && a.length >= 7 && a.every(e => !isNaN(num(e)));
          const arrs = vals.filter(numArr);
          if (arrs.length >= 7) sets.push(arrs.map(a => a.map(num)));
          vals.forEach(e => walk(e, depth + 1));
        })(x, 0);
        return sets;
      };
      for (const rows of rowSetsOf(j)) { const r = fromRows(rows, 'arrays'); if (r) return r; }
      const arrays = []; (function walk(x, depth) { if (depth > 6 || !x) return; if (Array.isArray(x)) { if (x.length >= 7 && typeof x[0] === 'object') arrays.push(x); x.forEach(e => walk(e, depth + 1)); } else if (typeof x === 'object') Object.keys(x).forEach(k => walk(x[k], depth + 1)); })(j, 0);
      for (const arr of arrays) {
        const keys = Object.keys(arr[0] || {});
        const numKeys = keys.filter(k => arr.every(o => o && !isNaN(num(o[k]))));
        // 시간 인덱스처럼 보이는 키(값이 1..24 또는 '01'..'24' 로 증가)는 뺀다
        const idxKey = numKeys.find(k => arr.slice(0, 24).every((o, i) => Math.round(num(o[k])) === i + 1 || Math.round(num(o[k])) === i));
        const valKeys = numKeys.filter(k => k !== idxKey);
        const rows = arr.map(o => valKeys.map(k => num(o[k])));
        const r = fromRows(rows, valKeys.join(','));
        if (r) return r;
      }
    }
    // HTML 표
    if (/<t[rd]/i.test(txt)) {
      const rows = []; const rre = /<tr[\s\S]*?<\/tr>/gi; let m;
      while ((m = rre.exec(txt))) { const cells = []; const cre = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi; let c; while ((c = cre.exec(m[0]))) cells.push(c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()); const nums = cells.map(num).filter(v => !isNaN(v)); if (nums.length >= 7) rows.push(nums.length >= 8 ? nums.slice(1) : nums); }
      const r = fromRows(rows, 'html');
      if (r) return r;
    }
    return null;
  }

  /** 중계 호출: 로그인 + 12개월 + 요금제 한 줄. months: [{y,m}] (최근 완결 12개월) */
  function months12(asOf) {
    const d = asOf ? new Date(asOf) : new Date(); const out = [];
    let y = d.getFullYear(), m = d.getMonth();   // 지난달부터 12개
    for (let i = 0; i < 12; i++) { if (m < 1) { m = 12; y--; } out.unshift({ y, m }); m--; }
    return out;
  }
  /** 중계 호출에 경과시간 표시·시간 제한을 붙인다 */
  function callTimed(params, label, onStep, limitMs) {
    const t0 = Date.now(); let tick = null;
    const p = Auth.call(params, limitMs);
    if (onStep) { onStep(label + ' 0초'); tick = setInterval(() => onStep(label + ' ' + Math.round((Date.now() - t0) / 1000) + '초'), 1000); }
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error(label + ' — ' + Math.round(limitMs / 1000) + '초 안에 응답이 없습니다. 중계(Apps Script) 실행 기록을 확인하거나 잠시 뒤 다시 해 보세요.')), limitMs));
    return Promise.race([p, timeout]).finally(() => { if (tick) clearInterval(tick); });
  }
  async function fetchUsage(id, pw, type, onStep) {
    const ms = months12();
    // 1단계: 로그인 + 요일별 페이지 + 자료 호출 찾기(빠름). 2단계: 12개월.
    const pr = await callTimed({ path: 'pp', op: 'usage', probe: 1, id, pw, type: type || 'I', months: ms[0].y + '-' + ms[0].m }, '한전 로그인·자료 호출 찾는 중', onStep, 120000);
    if (!pr || !pr.ok) { const lg = (pr && pr.login) || {}; throw new Error(((pr && (pr.errMsg || pr.failed)) || '파워플래너 응답 없음') + (lg.chk || lg.failed ? ' [통합아이디 확인: ' + (lg.chk || '-') + ' · SSO ' + (lg.ssoYn || '-') + ' · APT ' + (lg.aptYn || '-') + ' · ' + (lg.failed || '') + ' · ' + (lg.title || '') + ']' : '')); }
    const d = pr.discovery || {};
    onStep && onStep('로그인 성공 (' + Math.round((pr.ms && pr.ms.login || 0) / 1000) + '초) · 자료 호출 ' + (d.url ? '찾음 (selectType=' + (d.chartType || '') + ')' : '못 찾음') + ' · 시험 ' + ((d.tries || []).length) + '회');
    if (!d.url) return { fetched: new Date().toISOString(), id: String(id).replace(/.(?=.{3})/g, '*'), months: [], okN: 0, contract: pr.contract || '', discovery: d, pageNote: pr.pageNote || '' };
    const r = await callTimed({ path: 'pp', op: 'usage', id, pw, type: type || 'I', months: ms.map(x => x.y + '-' + x.m).join(',') }, '12개월 사용량 받는 중', onStep, 240000);
    if (!r || !r.ok) { const lg = (r && r.login) || {}; throw new Error(((r && (r.errMsg || r.failed)) || '파워플래너 응답 없음') + (lg.chk || lg.failed ? ' [통합아이디 확인: ' + (lg.chk || '-') + ' · SSO ' + (lg.ssoYn || '-') + ' · APT ' + (lg.aptYn || '-') + ' · ' + (lg.failed || '') + ' · ' + (lg.title || '') + ']' : '')); }
    onStep && onStep('응답 해석 중…');
    const months = (r.months || []).map(x => { const p = parseMonth(x.raw); return { y: x.y, m: x.m, hourly: p ? p.hourly : null, note: p ? p.note : '', raw: p ? '' : String(x.raw || '').slice(0, 1500), url: x.url, code: x.code }; });
    const okN = months.filter(x => x.hourly).length;
    return { fetched: new Date().toISOString(), id: String(id).replace(/.(?=.{3})/g, '*'), months, okN, contract: r.contract || '', discovery: r.discovery || null, pageNote: r.pageNote || '' };
  }

  /**
   * 자가소비 계산. usage = fetchUsage 결과, capacity kW, rates: 월별 { energyCharge } (RPS.computeSelf 의 monthly), mode: '상계거래'|'단순병렬'
   * @returns { monthly:[{y,m,use,gen,self,surplus,saving,selfRate,surplusRate}], total:{use,gen,self,surplus,saving}, re100, surplusPct }
   */
  function compute(usage, capacity, monthlyRates, mode, ppaRate) {
    const monthly = [];
    usage.months.forEach(x => {
      if (!x.hourly) return;
      const n = weekdayCounts(x.y, x.m), prof = PROFILE[x.m - 1];
      let use = 0, gen = 0, self = 0;
      for (let w = 0; w < 7; w++) for (let h = 0; h < 24; h++) {
        const u = Math.max(0, Number(x.hourly[w][h]) || 0), g = capacity * prof[h];
        use += n[w] * u; gen += n[w] * g; self += n[w] * Math.min(u, g);
      }
      const rate = (monthlyRates && monthlyRates[x.m - 1] && monthlyRates[x.m - 1].energyCharge) || 0;
      const selfRate = rate + 9 + 5, surplusRate = mode === '단순병렬' ? 0 : mode === '자가PPA' ? (Number(ppaRate) || 0) : rate;   // 자가PPA: 잉여 × (SMP+REC), 엑셀 G 열과 같음
      const surplus = gen - self, saving = self * selfRate + surplus * surplusRate;
      monthly.push({ y: x.y, m: x.m, use, gen, self, surplus, saving, selfRate, surplusRate });
    });
    const total = monthly.reduce((a, b) => ({ use: a.use + b.use, gen: a.gen + b.gen, self: a.self + b.self, surplus: a.surplus + b.surplus, saving: a.saving + b.saving }), { use: 0, gen: 0, self: 0, surplus: 0, saving: 0 });
    return { monthly, total, re100: total.use ? total.self / total.use : 0, surplusPct: total.gen ? total.surplus / total.gen : 0 };
  }

  return { PROFILE, WD, parseMonth, fetchUsage, compute, weekdayCounts, months12 };
})();
