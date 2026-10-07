/*
 * 제안서 PPT 생성 — 배치 결과로 제안서의 5쪽(p37 배치도·p38 측면도·p47~49 손익)을 만들어 .pptx 로 낸다.
 *
 * 왜 따로 파일로 내는가: 사내 제안서 원본(.pptx)은 문서보안(DocuRay)으로 암호화돼 앱·PC 스크립트가 열 수 없다.
 * 그래서 같은 16:9 크기의 5장을 별도 파일로 만들고, 파워포인트에서 「슬라이드 재사용」으로 원본의 37·38·47·48·49쪽 자리에 넣는다.
 *
 * 손익 계산은 사내 손익계산서(2.손익계산서_발전사업_2026-09-08.xlsx)의 세 탭 로직을 그대로 옮겼다 (수치 출처 README「제안서 PPT」):
 *   p47 「조성현,임준길」 : 1등급 장기계약, 발전시간 3.6 / 3.8 / 4.0h 별 30년 연간매출 + 연간비용
 *   p48 「외주」         : 장기계약(2등급) vs 현물 30년 누적매출(연간비용 차감)과 투자비 회수
 *   p49 「최창민,진으뜸」 : 1·2·무등급 20년 연간매출·누적수익, 월 예상매출·수익, 등급 간 차이
 *   공통: 연발전량(1kW) = 발전시간 × 365 × 시스템효율(1년차 99%, 이후 매년 −0.4%p), 단가 = SMP + REC × 가중치 1.5,
 *         연간비용 = EGI 보험(용량 구간) + 전기안전관리 대행(용량 구간, 월×12), 매년 첫해의 2% 씩 단순 증가.
 * 각 손익 쪽 아래에 한전 선로(변전소·MTR·DL·여유용량)와 상담일지의 선로 메모(중계 consult)를 붙인다.
 *
 * 라이브러리: vendor/pptxgen.bundle.js (PptxGenJS 3.12, 오프라인). 그림은 캔버스로 그려 PNG 로 넣는다.
 */
const Proposal = (() => {
  // ------------------------------------------------------------ 손익 기준값 (손익계산서 INDEX 탭, 2026-09 기준)
  const PRICE = {
    smp: 86.35, rec1: 77.336, rec2: 57.787, recN: 21.2498, recSpot: 116.004, weight: 1.5,
    get g1() { return this.smp + this.rec1 * this.weight; },     // 202.354
    get g2() { return this.smp + this.rec2 * this.weight; },     // 173.03
    get gN() { return this.smp + this.recN * this.weight; },     // 118.22
    get spot() { return this.smp + this.recSpot * this.weight; } // 260.356
  };
  const INSURANCE = [[100, 400000], [200, 700000], [300, 940000], [400, 1240000], [500, 1550000], [600, 2640000], [700, 2760000], [1000, 3120000], [1300, 4090000], [2000, 6230000], [3000, 9340000], [4000, 12450000], [5000, 15560000]];
  const SAFETY_MONTHLY = [[20, 0], [50, 66430], [100, 75950], [200, 86590], [300, 99050], [400, 151270], [500, 181440], [600, 295330], [700, 380030], [800, 459410], [900, 569940], [1000, 661640], [1250, 865480], [1500, 1041320], [2000, 1422680], [2500, 1894130], [3500, 2167830], [4500, 2601410]];
  const step = (table, kw) => { for (const [lim, v] of table) if (kw <= lim) return v; return table[table.length - 1][1]; };
  const eff = y => y <= 0 ? 1 : 0.99 - 0.004 * (y - 1);
  const genKwh = (kw, h, y) => kw * h * 365 * eff(y);
  const yearCost = (kw, y) => { const base = step(INSURANCE, kw) + step(SAFETY_MONTHLY, kw) * 12; return base * (1 + 0.02 * (y - 1)); };
  const won = n => Math.round(n).toLocaleString('ko-KR');
  const pct = n => (n * 100).toFixed(1) + '%';

  // ------------------------------------------------------------ 그림: 배치도
  const M_LAT = 110574, M_LNG = lat => 111320 * Math.cos(lat * Math.PI / 180);
  function toXY(ring, o) { const k = M_LNG(o.lat); return ring.map(p => ({ x: (p.lng - o.lng) * k, y: (p.lat - o.lat) * M_LAT })); }

  /** 설계도면식 배치도 PNG. 건물 외곽(검정), 모듈(남색), 동 번호·용량, 북쪽 화살표, 축척. */
  function drawPlan(data) {
    const W = 1600, H = 1000, pad = 70;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const o = data.origin;
    const all = [];
    data.roofs.forEach(r => r.rings.forEach(rg => all.push(...toXY(rg, o))));
    (data.buildings || []).forEach(b => all.push(...toXY(b.ring, o)));
    if (!all.length) return cv.toDataURL('image/png');
    const minX = Math.min(...all.map(p => p.x)), maxX = Math.max(...all.map(p => p.x)), minY = Math.min(...all.map(p => p.y)), maxY = Math.max(...all.map(p => p.y));
    const sc = Math.min((W - pad * 2) / Math.max(1, maxX - minX), (H - pad * 2 - 60) / Math.max(1, maxY - minY));
    const X = x => pad + (x - minX) * sc, Y = y => H - pad - 60 - (y - minY) * sc;
    const path = (ring, close) => { g.beginPath(); ring.forEach((p, i) => i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))); if (close !== false) g.closePath(); };
    // 주변 건물: 연회색
    (data.buildings || []).forEach(b => { path(toXY(b.ring, o)); g.fillStyle = '#f1f1f1'; g.fill(); g.strokeStyle = '#bbb'; g.lineWidth = 1; g.stroke(); });
    // 지붕·토지 외곽 + 모듈
    data.roofs.forEach((r, i) => {
      r.rings.forEach(rg => { path(toXY(rg, o)); g.fillStyle = r.type === 'ground' ? '#fbf5e4' : '#fafafa'; g.fill(); g.strokeStyle = '#111'; g.lineWidth = 2.5; g.stroke(); });
      g.fillStyle = '#1f3a8a'; g.strokeStyle = '#8fa3d6'; g.lineWidth = 0.6;
      r.modules.forEach(m => { path(toXY(m, o)); g.fill(); g.stroke(); });
      // 용마루(원단): 점선
      if (r.ridges) { g.setLineDash([8, 6]); g.strokeStyle = '#c0392b'; g.lineWidth = 1.5; r.ridges.forEach(seg => { const s = toXY(seg, o); g.beginPath(); g.moveTo(X(s[0].x), Y(s[0].y)); g.lineTo(X(s[1].x), Y(s[1].y)); g.stroke(); }); g.setLineDash([]); }
      // 라벨
      const c = toXY([r.centroid], o)[0];
      const label = (i + 1) + '동 ' + r.kw.toFixed(1) + 'kW';
      g.font = 'bold 26px sans-serif'; const tw = Math.max(g.measureText(label).width, 200);
      const lx = Math.min(W - tw / 2 - 20, Math.max(tw / 2 + 20, X(c.x))), ly = Math.min(H - 110, Math.max(40, Y(c.y)));
      g.fillStyle = 'rgba(255,255,255,.92)'; g.fillRect(lx - tw / 2 - 8, ly - 20, tw + 16, 60);
      g.strokeStyle = '#111'; g.lineWidth = 1; g.strokeRect(lx - tw / 2 - 8, ly - 20, tw + 16, 60);
      g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, lx, ly);
      g.font = '16px sans-serif'; g.fillText(r.typeLabel + ' · ' + r.count + 'EA', lx, ly + 28);
    });
    // 북쪽 화살표 · 축척
    g.strokeStyle = '#111'; g.fillStyle = '#111'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(W - 60, 120); g.lineTo(W - 60, 40); g.stroke();
    g.beginPath(); g.moveTo(W - 60, 30); g.lineTo(W - 72, 56); g.lineTo(W - 48, 56); g.closePath(); g.fill();
    g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.fillText('N', W - 60, 142);
    const barM = sc * 10 > 60 ? 10 : sc * 50 > 60 ? 50 : 100;
    g.lineWidth = 4; g.beginPath(); g.moveTo(pad, H - 30); g.lineTo(pad + barM * sc, H - 30); g.stroke();
    g.font = '18px sans-serif'; g.textAlign = 'left'; g.fillText(barM + ' m', pad + barM * sc + 10, H - 30);
    g.textAlign = 'right'; g.fillText('모듈 ' + data.module.w + 'W · ' + data.module.L + '×' + data.module.S + 'mm  |  ■ 모듈  ─ 건물 외곽  ┄ 용마루', W - pad, H - 30);
    return cv.toDataURL('image/png');
  }

  // ------------------------------------------------------------ 그림: 측면도
  /** 지붕 하나의 단면(남→북 또는 서→동). 치수는 mm. */
  function drawSection(r) {
    const W = 1000, H = 420;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const depth = Math.max(8, r.depthM), eave = r.eaveH, ridge = r.ridgeH, top = r.topH;
    const sc = Math.min((W - 220) / depth, (H - 120) / Math.max(4, top));
    const X = m => 110 + m * sc, Y = m => H - 70 - m * sc;
    const mm = v => Math.round(v * 1000).toLocaleString('ko-KR');
    g.strokeStyle = '#111'; g.lineWidth = 2; g.fillStyle = '#111'; g.font = '15px sans-serif';
    // 지면 · 벽
    g.beginPath(); g.moveTo(X(-1), Y(0)); g.lineTo(X(depth + 1), Y(0)); g.stroke();
    g.strokeRect(X(0), Y(eave), depth * sc, eave * sc);
    const dim = (x, y1, y2, text, side) => {   // 세로 치수선
      g.strokeStyle = '#c0392b'; g.fillStyle = '#c0392b'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, Y(y1)); g.lineTo(x, Y(y2)); g.stroke();
      [y1, y2].forEach(y => { g.beginPath(); g.moveTo(x - 6, Y(y)); g.lineTo(x + 6, Y(y)); g.stroke(); });
      g.save(); g.translate(x + (side < 0 ? -8 : 8), (Y(y1) + Y(y2)) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.textBaseline = side < 0 ? 'bottom' : 'top'; g.fillText(text, 0, 0); g.restore();
      g.strokeStyle = '#111'; g.fillStyle = '#111';
    };
    const mod = (x1, y1, x2, y2) => { g.strokeStyle = '#d02090'; g.lineWidth = 5; g.beginPath(); g.moveTo(X(x1), Y(y1)); g.lineTo(X(x2), Y(y2)); g.stroke(); g.strokeStyle = '#111'; g.lineWidth = 2; };
    const post = (x, y1, y2) => { g.strokeStyle = '#555'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(x), Y(y1)); g.lineTo(X(x), Y(y2)); g.stroke(); g.strokeStyle = '#111'; };
    if (r.kind === 'gable-ew') {
      // 원단: 경간마다 남쪽 면 밀착, 북쪽 블록은 같은 면으로 들어 올림
      const n = r.spans, D = depth / n, t = Math.tan(r.roofSlope * Math.PI / 180);
      for (let i = 0; i < n; i++) {
        const y0 = i * D, yc = y0 + D / 2, y1 = y0 + D;
        g.beginPath(); g.moveTo(X(y0), Y(eave)); g.lineTo(X(yc), Y(ridge)); g.lineTo(X(y1), Y(eave)); g.stroke();
        const lift = 0.15;
        mod(y0 + 0.5, eave + 0.5 * t + lift, yc - 0.3, eave + (D / 2 - 0.3) * t + lift);
        mod(yc + 0.3, eave + (D / 2 + 0.3) * t + lift, y1 - 0.5, eave + (D - 0.5) * t + lift);
        for (let k = 1; k <= 3; k++) { const u = D / 2 + 0.3 + (D / 2 - 0.8) * k / 3; post(y0 + u, eave + (D / 2 - Math.abs(u - D / 2)) * t, eave + u * t + lift); }
      }
      dim(X(0) - 40, 0, eave, '처마 ' + mm(eave), -1);
      dim(X(depth / n / 2) + 0, eave, ridge, '지붕 ' + mm(ridge - eave), 1);
      dim(X(depth) + 40, 0, top, '북측 끝 ' + mm(top), 1);
      g.fillText('남', X(0) - 30, Y(0) + 24); g.fillText('북', X(depth) + 14, Y(0) + 24);
      g.fillText('원단 · 용마루 ' + n + '개 · 지붕경사 ' + r.roofSlope + '° · 남면 밀착, 북면 블록 들어올림(같은 면)', 110, 28);
    } else if (r.kind === 'gable-ns') {
      // 동서지붕: 박공 위 수평 프레임에 2단 거치
      const n = r.spans, Wd = depth / n, t = Math.tan(r.roofSlope * Math.PI / 180);
      for (let i = 0; i < n; i++) { const x0 = i * Wd, xc = x0 + Wd / 2; g.beginPath(); g.moveTo(X(x0), Y(eave)); g.lineTo(X(xc), Y(ridge)); g.lineTo(X(x0 + Wd), Y(eave)); g.stroke(); }
      g.strokeStyle = '#555'; g.beginPath(); g.moveTo(X(0), Y(ridge + 0.3)); g.lineTo(X(depth), Y(ridge + 0.3)); g.stroke(); g.strokeStyle = '#111';
      const aw = r.arrayDepth, ah = r.arrayH;
      for (let x = 1; x + aw <= depth - 1; x += r.pitch) { mod(x, ridge + 0.3, x + aw, ridge + 0.3 + ah); post(x + aw, ridge + 0.3, ridge + 0.3 + ah); }
      dim(X(0) - 40, 0, eave, '처마 ' + mm(eave), -1);
      dim(X(depth) + 40, 0, top, '모듈 상단 ' + mm(top), 1);
      g.fillText('서', X(0) - 30, Y(0) + 24); g.fillText('동', X(depth) + 14, Y(0) + 24);
      g.fillText('동서지붕(인삼밭) · 동 ' + n + '개 · 용마루 위 수평 프레임 · ' + r.tiers + '단 ' + r.tilt + '° 정남 · 피치 ' + r.pitch + 'm · 이격 ' + r.gap + 'm', 110, 28);
    } else {
      // 평슬라브 · 토지 · 주차장: 수평 기준면 위 경사거치
      const base = r.type === 'parking' ? 2.5 : r.type === 'ground' ? 0.5 : eave;
      if (r.type === 'ground') { g.strokeStyle = '#8a6d3b'; g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(depth), Y(0)); g.stroke(); g.strokeStyle = '#111'; }
      if (r.type === 'parking') { for (let x = 2; x < depth; x += 6) post(x, 0, base); g.beginPath(); g.moveTo(X(0), Y(base)); g.lineTo(X(depth), Y(base)); g.stroke(); }
      const aw = r.arrayDepth, ah = r.arrayH;
      for (let x = (r.type === 'ground' ? r.margin : 0.5); x + aw <= depth - 0.5; x += r.pitch) { mod(x, base + 0.3, x + aw, base + 0.3 + ah); post(x + aw, base, base + 0.3 + ah); post(x, base, base + 0.3); }
      if (base > 0) dim(X(0) - 40, 0, base, (r.type === 'parking' ? '캐노피 ' : r.type === 'ground' ? '구조물 ' : '처마 ') + mm(base), -1);
      dim(X(depth) + 40, base, base + 0.3 + ah, '어레이 ' + mm(0.3 + ah), 1);
      g.fillText('남', X(0) - 30, Y(0) + 24); g.fillText('북', X(depth) + 14, Y(0) + 24);
      g.fillText(r.typeLabel + ' · ' + r.tiers + '단 ' + r.tilt + '° · 피치 ' + r.pitch + 'm · 이격 ' + r.gap + 'm' + (r.slopeNote ? ' · ' + r.slopeNote : ''), 110, 28);
    }
    return cv.toDataURL('image/png');
  }

  // ------------------------------------------------------------ 상담일지 선로 메모 (중계 consult)
  function consult(addr) {
    const cfg = window.SOLAR_CONFIG || {};
    if (!cfg.KEPCO_PROXY || !addr) return Promise.resolve(null);
    const url = cfg.KEPCO_PROXY + '?path=consult&addr=' + encodeURIComponent(addr);
    if (window.Native && window.Native.fetch && window.NativeHttp) return window.NativeHttp.get(url, '').catch(() => null);
    return new Promise(res => {
      const cb = '__consult' + Date.now();
      window[cb] = d => { delete window[cb]; s.remove(); res(d); };
      const s = document.createElement('script'); s.src = url + '&callback=' + cb; s.onerror = () => { delete window[cb]; res(null); };
      document.head.appendChild(s);
      setTimeout(() => { if (window[cb]) { delete window[cb]; res(null); } }, 20000);
    });
  }

  // ------------------------------------------------------------ 본문
  const C = { navy: '1F3A8A', red: 'C0392B', grey: '666666', line: 'BBBBBB', head: 'E8EDF7' };
  function title(slide, pptx, no, text, sub) {
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.55, fill: { color: C.navy } });
    slide.addText(text, { x: 0.3, y: 0.05, w: 8, h: 0.45, fontSize: 18, bold: true, color: 'FFFFFF', fontFace: '맑은 고딕' });
    slide.addText(sub || '', { x: 6.5, y: 0.08, w: 3.2, h: 0.4, fontSize: 10, color: 'DDE3F0', align: 'right', fontFace: '맑은 고딕' });
    slide.addText('p.' + no, { x: 9.3, y: 5.3, w: 0.6, h: 0.25, fontSize: 8, color: C.grey, align: 'right' });
  }
  const cell = (t, o) => ({ text: String(t), options: Object.assign({ fontSize: 7.5, fontFace: '맑은 고딕', align: 'center', valign: 'middle' }, o || {}) });
  const hcell = t => cell(t, { bold: true, fill: { color: C.head }, color: C.navy });
  /** 긴 연차 표를 두 쪽으로 나눠 나란히: 머리글은 양쪽에, 합계 행은 오른쪽 끝에 */
  function splitTable(slide, head, body, total, x, y, w, colW, extra) {
    const half = Math.ceil(body.length / 2);
    const left = [head].concat(body.slice(0, half)), right = [head].concat(body.slice(half), total ? [total] : []);
    const gap = 0.15, hw = (w - gap) / 2, k = hw / colW.reduce((a, b) => a + b, 0);
    const cw = colW.map(c => c * k);
    slide.addTable(left, tableOpts(x, y, hw, cw, extra));
    slide.addTable(right, tableOpts(x + hw + gap, y, hw, cw, extra));
    return y + (Math.max(left.length, right.length)) * ((extra && extra.rowH) || 0.14) + 0.1;
  }
  const tableOpts = (x, y, w, colW, extra) => Object.assign({ x, y, w, colW, border: { type: 'solid', pt: 0.5, color: C.line }, rowH: 0.14, autoPage: false, margin: 0.02 }, extra || {});

  /** 한전 선로 + 상담일지 메모를 슬라이드 아래에 */
  function linesBlock(slide, pptx, y, lines, memo) {
    slide.addText('■ 한전 계통 (변전소 · MTR · DL · 여유용량 · 출력제어)', { x: 0.3, y, w: 9.4, h: 0.22, fontSize: 9, bold: true, color: C.navy, fontFace: '맑은 고딕' });
    const rows = [[hcell('변전소'), hcell('MTR'), hcell('DL'), hcell('DL 여유'), hcell('MTR 여유'), hcell('변전소 여유'), hcell('기준')]];
    (lines && lines.rows || []).slice(0, 3).forEach(r => rows.push([cell(r.subst || '-'), cell(r.mtr || '-'), cell(r.dl || '-'), cell(r.dlFree != null ? won(r.dlFree) : '-'), cell(r.mtrFree != null ? won(r.mtrFree) : '-'), cell(r.substFree != null ? won(r.substFree) : '-'), cell(lines.level + (lines.basis && lines.basis.length ? ' ' + lines.basis.slice(0, 2).join(',') : ''))]));
    if (rows.length === 1) rows.push([cell('한전 분산전원 연계정보 없음 — 한전ON 접속가능용량 조회로 확인', { colspan: 7, color: C.grey })]);
    slide.addTable(rows, tableOpts(0.3, y + 0.24, 9.4, [1.4, 0.9, 1.4, 1.1, 1.1, 1.2, 2.3]));
    const m = memo && memo.length ? memo.map(x => '· ' + x).join('\n') : '상담일지 선로 메모 없음 (주소 매칭 결과 없음 또는 중계 미연결)';
    slide.addText('상담일지: ' + m, { x: 0.3, y: y + 0.24 + 0.14 * rows.length + 0.04, w: 9.4, h: 0.5, fontSize: 7.5, color: C.grey, fontFace: '맑은 고딕', valign: 'top' });
  }

  /**
   * @param d { site:{name,addr}, kw, module:{w,L,S}, roofs:[...], buildings, origin, lines, memo, costPerKw, pages:{plan,section,p47,p48,p49} }
   * @returns Promise<{ pptx, fileName }>
   */
  async function build(d) {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';
    pptx.title = '태양광 제안서 — ' + (d.site.name || '');
    const kw = d.kw, pg = d.pages || {};
    const fileName = '제안서_배치손익_' + (d.site.name || '현장').replace(/[\\/:*?"<>|]/g, '') + '_' + new Date().toISOString().slice(0, 10) + '.pptx';

    // ---- p37 배치도
    const s1 = pptx.addSlide();
    title(s1, pptx, pg.plan || 37, '모듈 배치도', d.site.name + ' · ' + (d.site.addr || ''));
    s1.addImage({ data: drawPlan(d), x: 0.3, y: 0.7, w: 5.9, h: 3.69 });
    const rows = [[hcell('동'), hcell('지붕 형태'), hcell('면적(㎡)'), hcell('모듈(EA)'), hcell('용량(kW)'), hcell('경사각'), hcell('방위'), hcell('줄/통로')]];
    d.roofs.forEach((r, i) => rows.push([cell(i + 1), cell(r.typeLabel), cell(won(r.areaM2)), cell(r.count), cell(r.kw.toFixed(2)), cell(r.tilt + '°'), cell(r.dir), cell(r.rows + '줄' + (r.aisles ? '/' + r.aisles : ''))]));
    rows.push([cell('합계', { bold: true }), cell(''), cell(won(d.roofs.reduce((a, r) => a + r.areaM2, 0))), cell(d.roofs.reduce((a, r) => a + r.count, 0), { bold: true }), cell(kw.toFixed(2), { bold: true, color: C.red }), cell(''), cell(''), cell('')]);
    s1.addTable(rows, tableOpts(6.35, 0.7, 3.4, [0.3, 0.75, 0.5, 0.45, 0.5, 0.35, 0.3, 0.25]));
    const spec = [[hcell('모듈 재원'), hcell('값')], [cell('출력'), cell(d.module.w + ' Wp')], [cell('크기'), cell(d.module.L + ' × ' + d.module.S + ' mm')], [cell('총 수량'), cell(d.roofs.reduce((a, r) => a + r.count, 0) + ' EA')],
      [cell('설치용량'), cell(kw.toFixed(2) + ' kW', { bold: true })], [cell('배치 기준'), cell('후면입사각 22°, 건물 20열/0.6m · 토지 30열/2m 통로')]];
    s1.addTable(spec, tableOpts(6.35, 0.75 + 0.14 * rows.length + 0.15, 3.4, [1.0, 2.4]));
    s1.addText('※ 배치는 위성·지적 자료 기준 자동 배치이며 현장 실측·구조 검토 후 변경될 수 있습니다.', { x: 0.3, y: 4.45, w: 9.4, h: 0.3, fontSize: 8, color: C.grey, fontFace: '맑은 고딕' });

    // ---- p38 측면도
    const s2 = pptx.addSlide();
    title(s2, pptx, pg.section || 38, '설치 측면도 · 높이', d.site.name);
    const secs = d.roofs.slice(0, 4);
    secs.forEach((r, i) => {
      const x = 0.3 + (i % 2) * 4.75, y = 0.7 + Math.floor(i / 2) * 2.25;
      s2.addText((i + 1) + '동 ' + r.name + ' — ' + r.typeLabel, { x, y, w: 4.6, h: 0.22, fontSize: 9, bold: true, color: C.navy, fontFace: '맑은 고딕' });
      s2.addImage({ data: drawSection(r), x, y: y + 0.22, w: 4.6, h: 1.93 });
    });
    const hrows = [[hcell('동'), hcell('처마(m)'), hcell('용마루(m)'), hcell('모듈 상단(m)'), hcell('어레이 높이(m)'), hcell('피치(m)'), hcell('이격(m)')]];
    d.roofs.forEach((r, i) => hrows.push([cell(i + 1), cell(r.eaveH.toFixed(2)), cell(r.kind === 'flat' ? '-' : r.ridgeH.toFixed(2)), cell(r.topH.toFixed(2)), cell(r.arrayH.toFixed(2)), cell(r.pitch), cell(r.gap)]));
    s2.addTable(hrows, tableOpts(0.3, 5.2 - 0.14 * hrows.length - 0.05, 9.4, [0.5, 1.4, 1.4, 1.6, 1.6, 1.4, 1.5]));

    // ---- p47 조성현,임준길 : 1등급 3.6/3.8/4.0h 30년
    const s3 = pptx.addSlide();
    title(s3, pptx, pg.p47 || 47, '손익계산 ① 1등급 장기계약 — 발전시간별 30년 연간매출', kw.toFixed(1) + ' kW');
    const h3 = [hcell('년차'), hcell('효율'), hcell('연간매출 3.6h'), hcell('연간매출 3.8h'), hcell('연간매출 4.0h'), hcell('연간비용')];
    const r3 = [];
    const sum3 = [0, 0, 0, 0];
    for (let y = 1; y <= 30; y++) {
      const a = genKwh(kw, 3.6, y) * PRICE.g1, b = genKwh(kw, 3.8, y) * PRICE.g1, c = genKwh(kw, 4.0, y) * PRICE.g1, k = yearCost(kw, y);
      sum3[0] += a; sum3[1] += b; sum3[2] += c; sum3[3] += k;
      r3.push([cell(y), cell(pct(eff(y))), cell(won(a)), cell(won(b)), cell(won(c)), cell(won(k))]);
    }
    const t3 = [cell('합계', { bold: true }), cell(''), cell(won(sum3[0]), { bold: true }), cell(won(sum3[1]), { bold: true }), cell(won(sum3[2]), { bold: true }), cell(won(sum3[3]), { bold: true })];
    const y3 = splitTable(s3, h3, r3, t3, 0.3, 0.65, 9.4, [0.45, 0.6, 1.0, 1.0, 1.0, 0.85], { rowH: 0.125 });
    s3.addText([
      { text: '산정 기준\n', options: { bold: true, color: C.navy } },
      { text: '· 단가(1등급 장기계약) ' + PRICE.g1.toFixed(3) + ' 원/kWh = SMP ' + PRICE.smp + ' + REC ' + PRICE.rec1 + ' × 가중치 ' + PRICE.weight + '\n' },
      { text: '· 연발전량 = ' + kw.toFixed(1) + 'kW × 발전시간 × 365일 × 시스템효율(1년차 99%, 이후 매년 −0.4%p)\n' },
      { text: '· 연간비용 = EGI 보험 ' + won(step(INSURANCE, kw)) + '원 + 전기안전관리 대행 ' + won(step(SAFETY_MONTHLY, kw)) + '원/월 × 12, 매년 2% 증가\n' },
      { text: '· 연간매출만 표시, 연간비용은 별도 차감 (손익계산서 「조성현,임준길」 탭과 같은 방식)\n' },
      { text: '· 월평균 매출(3.6h, 1년차) ' + won(genKwh(kw, 3.6, 1) * PRICE.g1 / 12) + ' 원' },
      { text: '  ※ 2026-09 기준 단가. 등급·계약 조건은 입찰 결과에 따라 달라집니다.', options: { color: C.grey } },
    ], { x: 0.3, y: y3, w: 9.4, h: 0.95, fontSize: 7.5, fontFace: '맑은 고딕', valign: 'top', color: '333333' });
    linesBlock(s3, pptx, y3 + 1.0, d.lines, d.memo);

    // ---- p48 외주 : 장기계약(2등급) vs 현물 30년 누적 · 투자비 회수
    const s4 = pptx.addSlide();
    title(s4, pptx, pg.p48 || 48, '손익계산 ② 장기계약(2등급) vs 현물 — 30년 누적 · 투자비 회수', kw.toFixed(1) + ' kW');
    const invest = kw * (d.costPerKw || 1000000);
    const h4 = [hcell('년차'), hcell('장기계약 연매출'), hcell('누적(비용차감)'), hcell('투자비 회수'), hcell('현물 연매출'), hcell('누적(비용차감)'), hcell('투자비 회수')];
    const r4 = [];
    let cumA = -invest, cumB = -invest, payA = null, payB = null;
    for (let y = 1; y <= 30; y++) {
      const g = genKwh(kw, 3.6, y), k = yearCost(kw, y);
      const a = g * PRICE.g2, b = g * PRICE.spot;
      cumA += a - k; cumB += b - k;
      if (payA == null && cumA >= 0) payA = y; if (payB == null && cumB >= 0) payB = y;
      r4.push([cell(y), cell(won(a)), cell(won(cumA + invest)), cell(won(cumA), { color: cumA < 0 ? C.red : '1a7f37' }), cell(won(b)), cell(won(cumB + invest)), cell(won(cumB), { color: cumB < 0 ? C.red : '1a7f37' })]);
    }
    const y4 = splitTable(s4, h4, r4, null, 0.3, 0.65, 9.4, [0.4, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85], { rowH: 0.125 });
    s4.addText([
      { text: '산정 기준\n', options: { bold: true, color: C.navy } },
      { text: '· 투자비 ' + won(invest) + ' 원 (' + won(d.costPerKw || 1000000) + ' 원/kW × ' + kw.toFixed(1) + 'kW, 설정값)\n' },
      { text: '· 장기계약(2등급) ' + PRICE.g2.toFixed(2) + ' 원/kWh / 현물 ' + PRICE.spot.toFixed(2) + ' 원/kWh (SMP ' + PRICE.smp + ' + REC ' + PRICE.recSpot + ' × 1.5)\n' },
      { text: '· 발전시간 3.6h · 연간비용 차감 후 누적\n' },
      { text: '· 투자비 회수: 장기계약 ' + (payA ? payA + '년차' : '30년 내 미회수') + ' / 현물 ' + (payB ? payB + '년차' : '30년 내 미회수') + '\n' },
      { text: '· 현물 단가는 시장 변동이 커서 참고용 (손익계산서 「외주」 탭 방식)' },
    ], { x: 0.3, y: y4, w: 9.4, h: 0.95, fontSize: 7.5, fontFace: '맑은 고딕', valign: 'top', color: '333333' });
    linesBlock(s4, pptx, y4 + 1.0, d.lines, d.memo);

    // ---- p49 최창민,진으뜸 : 등급별 20년
    const s5 = pptx.addSlide();
    title(s5, pptx, pg.p49 || 49, '손익계산 ③ 등급별 예상수익 (장기계약, 20년)', kw.toFixed(1) + ' kW · 3.6h');
    const r5 = [[hcell('년차'), hcell('효율'), hcell('발전량(kWh)'), hcell('1등급 연매출'), hcell('1등급 누적수익'), hcell('2등급 연매출'), hcell('2등급 누적수익'), hcell('무등급 연매출'), hcell('무등급 누적수익'), hcell('연간비용')]];
    let c1 = 0, c2 = 0, cN = 0, s1y = 0, s2y = 0, sNy = 0, sk = 0;
    for (let y = 1; y <= 20; y++) {
      const g = genKwh(kw, 3.6, y), k = yearCost(kw, y);
      const a = g * PRICE.g1, b = g * PRICE.g2, c = g * PRICE.gN;
      c1 += a - k; c2 += b - k; cN += c - k; s1y += a; s2y += b; sNy += c; sk += k;
      r5.push([cell(y), cell(pct(eff(y))), cell(won(g)), cell(won(a)), cell(won(c1)), cell(won(b)), cell(won(c2)), cell(won(c)), cell(won(cN)), cell(won(k))]);
    }
    r5.push([cell('합계', { bold: true }), cell(''), cell(''), cell(won(s1y), { bold: true }), cell(won(c1), { bold: true }), cell(won(s2y), { bold: true }), cell(won(c2), { bold: true }), cell(won(sNy), { bold: true }), cell(won(cN), { bold: true }), cell(won(sk), { bold: true })]);
    s5.addTable(r5, tableOpts(0.3, 0.65, 9.4, [0.5, 0.6, 1.0, 1.05, 1.1, 1.05, 1.1, 1.05, 1.1, 0.85], { rowH: 0.112, fontSize: 6.8 }));
    const m1 = genKwh(kw, 3.6, 1) * PRICE.g1 / 12, m2 = genKwh(kw, 3.6, 1) * PRICE.g2 / 12, mN = genKwh(kw, 3.6, 1) * PRICE.gN / 12, mk = yearCost(kw, 1) / 12;
    const r5b = [[hcell('등급'), hcell('단가(원/kWh)'), hcell('월 예상매출'), hcell('월 예상수익'), hcell('20년 누적수익')],
      [cell('1등급'), cell(PRICE.g1.toFixed(2)), cell(won(m1)), cell(won(m1 - mk)), cell(won(c1))],
      [cell('2등급'), cell(PRICE.g2.toFixed(2)), cell(won(m2)), cell(won(m2 - mk)), cell(won(c2))],
      [cell('무등급'), cell(PRICE.gN.toFixed(2)), cell(won(mN)), cell(won(mN - mk)), cell(won(cN))],
      [cell('등급 간 차이(20년)', { bold: true }), cell('1−2등급 ' + won(c1 - c2)), cell('1−무등급 ' + won(c1 - cN)), cell('2−무등급 ' + won(c2 - cN)), cell('')]];
    s5.addTable(r5b, tableOpts(0.3, 3.15, 4.6, [1.1, 0.9, 0.85, 0.85, 0.9]));
    linesBlock(s5, pptx, 4.0, d.lines, d.memo);
    s5.addText('※ 월발전량 ' + won(genKwh(kw, 3.6, 1) / 12) + ' kWh · 월평균 비용 ' + won(mk) + ' 원 · 적용가중치 1.5 · 손익계산서 「최창민,진으뜸」 탭 방식', { x: 5.1, y: 3.15, w: 4.6, h: 0.7, fontSize: 7.5, color: C.grey, fontFace: '맑은 고딕', valign: 'top' });

    return { pptx, fileName };
  }

  /** 내려받기(웹) 또는 메일 공유(APK). */
  async function save(pptx, fileName) {
    if (window.Native && window.Native.mail) {
      const b64 = await pptx.write({ outputType: 'base64' });
      window.Native.mail('', '태양광 제안서 — ' + fileName, '배치도·측면도·손익 5쪽 첨부', JSON.stringify([{ name: fileName, dataUrl: 'data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,' + b64 }]));
      return 'mail';
    }
    await pptx.writeFile({ fileName });
    return 'download';
  }

  return { build, save, consult, drawPlan, drawSection, PRICE, genKwh, yearCost };
})();
