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
      g.font = 'bold 26px ' + FONT; const tw = Math.max(g.measureText(label).width, 200);
      const lx = Math.min(W - tw / 2 - 20, Math.max(tw / 2 + 20, X(c.x))), ly = Math.min(H - 110, Math.max(40, Y(c.y)));
      g.fillStyle = 'rgba(255,255,255,.92)'; g.fillRect(lx - tw / 2 - 8, ly - 20, tw + 16, 60);
      g.strokeStyle = '#111'; g.lineWidth = 1; g.strokeRect(lx - tw / 2 - 8, ly - 20, tw + 16, 60);
      g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, lx, ly);
      g.font = '16px ' + FONT; g.fillText(r.typeLabel + ' · ' + r.count + 'EA', lx, ly + 28);
    });
    // 북쪽 화살표 · 축척
    g.strokeStyle = '#111'; g.fillStyle = '#111'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(W - 60, 120); g.lineTo(W - 60, 40); g.stroke();
    g.beginPath(); g.moveTo(W - 60, 30); g.lineTo(W - 72, 56); g.lineTo(W - 48, 56); g.closePath(); g.fill();
    g.font = 'bold 22px ' + FONT; g.textAlign = 'center'; g.fillText('N', W - 60, 142);
    const barM = sc * 10 > 60 ? 10 : sc * 50 > 60 ? 50 : 100;
    g.lineWidth = 4; g.beginPath(); g.moveTo(pad, H - 30); g.lineTo(pad + barM * sc, H - 30); g.stroke();
    g.font = '18px ' + FONT; g.textAlign = 'left'; g.fillText(barM + ' m', pad + barM * sc + 10, H - 30);
    g.textAlign = 'right'; g.fillText('모듈 ' + data.module.w + 'W · ' + data.module.L + '×' + data.module.S + 'mm  |  ■ 모듈  ─ 건물 외곽  ┄ 용마루', W - pad, H - 30);
    return cv.toDataURL('image/png');
  }

  // ------------------------------------------------------------ 그림: 측면도
  /** 지붕 하나의 단면(남→북 또는 서→동). 치수는 mm. */
  function drawSection(r) { return drawSectionCanvas(r).toDataURL('image/png'); }
  function drawSectionCanvas(r) {
    const W = 1000, H = 420;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const depth = Math.max(8, r.depthM), eave = r.eaveH, ridge = r.ridgeH, top = r.topH;
    const sc = Math.min((W - 220) / depth, (H - 120) / Math.max(4, top));
    const X = m => 110 + m * sc, Y = m => H - 70 - m * sc;
    const mm = v => Math.round(v * 1000).toLocaleString('ko-KR');
    g.strokeStyle = '#111'; g.lineWidth = 2; g.fillStyle = '#111'; g.font = '15px ' + FONT;
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
        const lift = r.frontLift != null ? r.frontLift : 0.5;   // 앞다리: 지붕면에서 띄우는 높이(사용자 지정 0.5m)
        for (let k = 0; k <= 2; k++) { const u = 0.5 + (D / 2 - 0.8) * k / 2; post(y0 + u, eave + (D / 2 - Math.abs(u - D / 2)) * t, eave + u * t + lift); }
        mod(y0 + 0.5, eave + 0.5 * t + lift, yc - 0.3, eave + (D / 2 - 0.3) * t + lift);
        mod(yc + 0.3, eave + (D / 2 + 0.3) * t + lift, y1 - 0.5, eave + (D - 0.5) * t + lift);
        for (let k = 1; k <= 3; k++) { const u = D / 2 + 0.3 + (D / 2 - 0.8) * k / 3; post(y0 + u, eave + (D / 2 - Math.abs(u - D / 2)) * t, eave + u * t + lift); }
      }
      dim(X(0) - 40, 0, eave, '처마 ' + mm(eave), -1);
      dim(X(0) - 12, eave, eave + 0.5 * t + (r.frontLift != null ? r.frontLift : 0.5), '앞다리 ' + mm(0.5 * t + (r.frontLift != null ? r.frontLift : 0.5)), 1);
      dim(X(depth / n / 2) + 0, eave, ridge, '지붕 ' + mm(ridge - eave), 1);
      dim(X(depth) + 40, 0, top, '북측 끝 ' + mm(top), 1);
      g.fillText('남', X(0) - 30, Y(0) + 24); g.fillText('북', X(depth) + 14, Y(0) + 24);

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

    }
    return cv;
  }

  // ------------------------------------------------------------ 상담일지 선로 메모 (중계 consult)
  function consult(addr) {
    const cfg = (typeof window !== 'undefined' && window.SOLAR_CONFIG) || {};
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
    const invest = kw * (d.costPerKw || COST_PER_KW);
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
      { text: '· 투자비 ' + won(invest) + ' 원 (' + won(d.costPerKw || COST_PER_KW) + ' 원/kW × ' + kw.toFixed(1) + 'kW, 설정값)\n' },
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

  // ============================================================ 원본 제안서 채우기 (템플릿 방식)
  // 원본 1.제안서_그랜드썬기술단_2026-10-06.pptx 구조(2026-10-07 확인, 63쪽, 16:9 12192000×6858000 EMU):
  //   slide37 배치도 = 그림 image141.png (10.57×7.47in)   slide38 측면도 = image142.png
  //   slide47 「표 5」 32×6 (년차·효율·3.6h·3.8h·4.0h·연간비용) + 「표 3」 21×2 라벨표 + 하단 '# 변전소 …' 텍스트박스
  //   slide48 「표 1」 33×7 (0년차 포함, 장기계약 누적매출·투자비 회수·현물 누적매출·투자비 회수·연간비용) + 「표 4」 19×2
  //   slide49 「표 1」 22×9 (1·2·무등급 연간매출·누적수익·연간비용) + 「표 3」 5×4 월수익 + 「표 4」 5×4 단가 + 「표 7」 5×2
  // 표는 XML 의 <a:tc> 칸 글만 바꾸고 서식(색·글꼴·테두리)은 그대로 둔다. 그림은 같은 이름의 media 파일을 덮어쓴다.

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  /** 칸 하나의 글을 바꾼다. 첫 문단의 pPr 과 첫 run 의 rPr(없으면 endParaRPr)을 살려 새로 조립. */
  function setCell(tc, text) {
    const body = tc.match(/<a:txBody>[\s\S]*?<\/a:txBody>/);
    if (!body) return tc;
    const b = body[0];
    const pPr = (b.match(/<a:pPr[^>]*\/>|<a:pPr[^>]*>[\s\S]*?<\/a:pPr>/) || [''])[0];
    let rPr = (b.match(/<a:rPr[^>]*\/>|<a:rPr[^>]*>[\s\S]*?<\/a:rPr>/) || [''])[0];
    if (!rPr) { const e = b.match(/<a:endParaRPr[^>]*\/>|<a:endParaRPr[^>]*>[\s\S]*?<\/a:endParaRPr>/); if (e) rPr = e[0].replace(/endParaRPr/g, 'rPr'); }
    // 문단 끝 서식(endParaRPr)이 없으면 파워포인트가 기본 18pt 로 줄 높이를 잡아 표가 커진다 → run 과 같은 크기로 붙인다
    const szm = rPr.match(/ sz="(\d+)"/), end = '<a:endParaRPr lang="ko-KR" altLang="en-US"' + (szm ? ' sz="' + szm[1] + '"' : '') + '/>';
    const nb = '<a:txBody><a:bodyPr/><a:lstStyle/><a:p>' + pPr + (text === '' ? '' : '<a:r>' + rPr + '<a:t>' + esc(text) + '</a:t></a:r>') + end + '</a:p></a:txBody>';
    return tc.replace(b, nb);
  }
  const cellText = tc => [...tc.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join('').replace(/\s+/g, '');
  function frameOf(xml, name) {
    const fr = xml.match(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g) || [];
    return fr.find(f => f.indexOf('name="' + name + '"') >= 0) || null;
  }
  /** rows[i][j] 가 null/undefined 면 그대로, 아니면 그 글로. */
  function setTable(xml, name, rows) {
    const f = frameOf(xml, name); if (!f) return xml;
    let i = 0;
    const nf = f.replace(/<a:tr [\s\S]*?<\/a:tr>/g, tr => {
      const r = rows[i++]; if (!r) return tr;
      let j = 0;
      return tr.replace(/<a:tc[\s\S]*?<\/a:tc>/g, tc => { const v = r[j++]; return v == null ? tc : setCell(tc, v); });
    });
    return xml.replace(f, nf);
  }
  /** 2열 라벨표: 왼쪽 라벨(공백 제거)이 map 의 키와 같으면 오른쪽 칸을 바꾼다. */
  function setByLabel(xml, name, map) {
    const f = frameOf(xml, name); if (!f) return xml;
    const nf = f.replace(/<a:tr [\s\S]*?<\/a:tr>/g, tr => {
      const tcs = tr.match(/<a:tc[\s\S]*?<\/a:tc>/g) || [];
      if (tcs.length < 2) return tr;
      const key = cellText(tcs[0]);
      const hit = Object.keys(map).find(k => key === k.replace(/\s+/g, ''));
      if (hit === undefined) return tr;
      return tr.replace(tcs[1], setCell(tcs[1], map[hit]));
    });
    return xml.replace(f, nf);
  }
  /** 하단 '# 변전소 …' 상자의 첫 문단을 바꾼다(빨간 run 서식 유지). 줄이 여러 개면 문단을 더 넣는다. */
  function setNote(xml, lines) {
    const sps = xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || [];
    const sp = sps.find(s => s.indexOf('변전소') >= 0); if (!sp) return xml;
    const ps = sp.match(/<a:p>[\s\S]*?<\/a:p>/g) || []; if (!ps.length) return xml;
    const p0 = ps[0];
    const rprs = p0.match(/<a:rPr[^>]*>[\s\S]*?<\/a:rPr>/g) || [];
    const rPr = rprs[1] || rprs[0] || '<a:rPr lang="ko-KR" sz="1050"/>';
    // 문단을 늘리면 상자가 아래로 자라 맨 아랫줄이 잘린다 → 한 문단에 ' | ' 로 이어 붙인다
    const np = '<a:p><a:r>' + rPr + '<a:t>' + esc(lines.join('  |  ')) + '</a:t></a:r><a:endParaRPr lang="ko-KR" sz="1050"/></a:p>';
    return xml.replace(sp, sp.replace(p0, np));
  }
  function dataUrlBytes(u) {
    const b64 = u.slice(u.indexOf(',') + 1);
    if (typeof atob === 'function') { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
    return Buffer.from(b64, 'base64');
  }

  /**
   * 한전연계비 — 손익계산서 탭의 수식 그대로 (기본시설부담금, VAT 불포함, 기본거리 공중 200m·지중 50m 안, 첨가거리 0):
   *   저압(단상·삼상) 공중 = 306,000 + (kW − 5) × 121,000   지중 = 588,000 + (kW − 5) × 141,000
   *   고압·특고압        공중 = kW × 24,000                   지중 = kW × 50,000
   * 100kW 초과는 고압 연계로 본다. 지중은 현장 협의 사항이라 공중으로 계산한다.
   */
  function kepcoFeeOf(kw, highV, underground) {
    if (highV) return kw * (underground ? 50000 : 24000);
    return underground ? 588000 + (kw - 5) * 141000 : 306000 + (kw - 5) * 121000;
  }
  /** 한전 단말통신공사 — 탭 구간표(20kW 이상 대상, 외주·최창민 탭 금액): ≤20 없음, ≤90 500만, ≤200 600만, ≤400 700만, ≤600 800만, ≤800 900만, 그 위 1,000만 */
  const TERMINAL = [[20, 0], [90, 5000000], [200, 6000000], [400, 7000000], [600, 8000000], [800, 9000000], [1e9, 10000000]];
  const terminalOf = kw => kw < 20 ? 0 : step(TERMINAL, kw);
  const COST_PER_KW = 1200000;                                 // kW당 공사비 기본(사용자 지정 2026-10-07: 120만원)

  /** 손익 수치 일괄 계산 (원본 표 채우기·별도 5쪽 공용) */
  function computeTables(kw, costPerKw, opt) {
    opt = opt || {};
    const invest = kw * (costPerKw || COST_PER_KW);
    const ins = step(INSURANCE, kw), safe = step(SAFETY_MONTHLY, kw) * 12;
    const lowV = kw < 500;                                    // 사용자 기준(2026-10-07): 500kW 미만 저압, 500kW 이상 고압
    const under = !!opt.underground;                          // 지중 지역이면 true (앱에서 물어본다), 아니면 공중(가공)
    const grid = (lowV ? '저압삼상' : '고압') + ' ' + (under ? '지중' : '공중');
    const kepcoFee = Math.max(0, kepcoFeeOf(kw, !lowV, under));
    const terminal = terminalOf(kw);
    const t47 = [], t48 = [], t49 = [];
    const S = { a: 0, b: 0, c: 0, k30: 0, k20: 0, r2: 0, sp: 0, a1: 0, a2: 0, aN: 0 };
    let cum2 = 0, cumSp = 0, c1 = 0, c2 = 0, cN = 0;
    for (let y = 1; y <= 30; y++) {
      const k = yearCost(kw, y), g = genKwh(kw, 3.6, y);
      const a = g * PRICE.g1, b = genKwh(kw, 3.8, y) * PRICE.g1, c = genKwh(kw, 4.0, y) * PRICE.g1;
      S.a += a; S.b += b; S.c += c; S.k30 += k;
      t47.push([String(y), pct(eff(y)), won(a), won(b), won(c), won(k)]);
      const r2 = g * PRICE.g2, sp = g * PRICE.spot;
      cum2 += r2 - k; cumSp += sp - k; S.r2 += r2; S.sp += sp;
      t48.push([String(y), pct(eff(y)), won(cum2), won(cum2 - invest), won(cumSp), won(cumSp - invest), won(k)]);
      if (y <= 20) {
        const a2 = r2, aN = g * PRICE.gN;
        c1 += a - k; c2 += a2 - k; cN += aN - k; S.a1 += a; S.a2 += a2; S.aN += aN; S.k20 += k;
        t49.push([String(y), pct(eff(y)), won(a), won(c1), won(a2), won(c2), won(aN), cN < 0 ? '(' + won(-cN) + ')' : won(cN), won(k)]);
      }
    }
    const g1 = genKwh(kw, 3.6, 1), m1 = g1 * PRICE.g1 / 12, m2 = g1 * PRICE.g2 / 12, mN = g1 * PRICE.gN / 12, mSp = g1 * PRICE.spot / 12, mk = yearCost(kw, 1) / 12;
    return { invest, ins, safe, grid, kepcoFee, terminal, t47, t48, t49, S, cum2, cumSp, c1, c2, cN, m1, m2, mN, mSp, mk, monthlyGen: g1 / 12,
      m36: m1, m38: genKwh(kw, 3.8, 1) * PRICE.g1 / 12, m40: genKwh(kw, 4.0, 1) * PRICE.g1 / 12 };
  }

  /** 한전 계통 한 줄 (원본 각주 '# 변전소 MW, MTR- MW, DL- MW (출력제어조건 MW)' 꼴) */
  function kepcoLine(lines) {
    const r = lines && lines.rows && lines.rows[0];
    if (!r) return '# 변전소 - MW, MTR- - MW, DL- - MW (출력제어조건 -) — 한전 자료 없음, 한전ON 확인';
    const mw = v => v == null ? '-' : (v / 1000).toFixed(1);
    return '# 변전소 ' + (r.subst || '-') + ' 여유 ' + mw(r.substFree) + 'MW, MTR-' + (r.mtr || '-') + ' 여유 ' + mw(r.mtrFree) + 'MW, DL-' + (r.dl || '-') + ' 여유 ' + mw(r.dlFree) + 'MW'
      + ' (출력제어조건 한전ON 확인)' + (lines.level === '인근' ? ' ※ 인근 번지 ' + (lines.basis || []).slice(0, 2).join(',') + ' 자료' : '');
  }

  /**
   * 원본 제안서를 채운다.
   * @param zipBuf ArrayBuffer|Buffer  @param d build() 과 같은 데이터  @param imgs { plan:dataURL, section:dataURL } (없으면 그림은 그대로)
   * @returns Promise<Blob|Buffer>
   */
  async function fillTemplate(zipBuf, d, imgs) {
    const JZ = (typeof window !== 'undefined' && (window.JSZipLib || window.JSZip)) || (typeof JSZip !== 'undefined' ? JSZip : require('jszip'));
    const zip = await JZ.loadAsync(zipBuf, { createFolders: false });
    // 37쪽: 위성사진 배치도(앱 화면 꼴). 그 뒤에 CAD 도면 배치도를 한 장 더 넣는다(37-2). 38쪽: 측면도.
    if (imgs && imgs.planMap) zip.file('ppt/media/image141.png', dataUrlBytes(imgs.planMap));
    if (imgs && imgs.plan) {
      if (imgs.planMap) await addSlideCopy(zip, 37, 'image141.png', dataUrlBytes(imgs.plan), '배치도', '배치도(도면)');
      else zip.file('ppt/media/image141.png', dataUrlBytes(imgs.plan));
    }
    if (imgs && imgs.section) zip.file('ppt/media/image142.png', dataUrlBytes(imgs.section));
    const kw = d.kw, T = computeTables(kw, d.costPerKw, { underground: !!d.underground });
    const note = [kepcoLine(d.lines)].concat((d.memo || []).slice(0, 1).map(m => '상담일지: ' + m.slice(0, 70)));
    const get = async n => zip.file('ppt/slides/slide' + n + '.xml').async('string');
    // 47
    let x = await get(47);
    x = setTable(x, '표 5', [null].concat(T.t47, [['합계', '', won(T.S.a), won(T.S.b), won(T.S.c), won(T.S.k30)]]));
    x = setByLabel(x, '표 3', { '설비용량(STC)(kW)': kw.toFixed(3), '발전시간(시간)': '3.6', '1등급 공사비': won(T.invest) + ' 원', '1등급 최종 공사비': '',
      '1등급 장기계약(월) 3.6h': won(T.m36) + ' 원', '1등급 장기계약(월) 3.8h': won(T.m38) + ' 원', '1등급 장기계약(월) 4h': won(T.m40) + ' 원',
      '전기안전관리비(년)': won(T.safe) + ' 원', '보험료(년)': won(T.ins) + ' 원', '계통 구분': T.grid, '한전연계비 vat별도': won(T.kepcoFee) + ' 원',
      '한전 단말통신공사(20kW 이상)': T.terminal ? won(T.terminal) + ' 원' : '',
      '장기계약 (1등급)': PRICE.g1.toFixed(3), '장기계약 (2등급)': PRICE.g2.toFixed(4), '장기계약 (무등급)': PRICE.gN.toFixed(4) });
    x = setNote(x, note);
    zip.file('ppt/slides/slide47.xml', x);
    // 48
    x = await get(48);
    x = setTable(x, '표 1', [null, ['0', '100.00%', '', won(-T.invest), '', won(-T.invest), '0']].concat(T.t48, [['합계', '', won(T.cum2), won(T.cum2 - T.invest), won(T.cumSp), won(T.cumSp - T.invest), won(T.S.k30)]]));
    x = setByLabel(x, '표 4', { '설비용량(STC)(kW)': kw.toFixed(3), '발전시간(시간)': '3.6', '2등급 공사비': won(T.invest) + ' 원', '무등급 공사비': won(T.invest) + ' 원',
      '월수익 장기계약': won(T.m2 - T.mk) + ' 원', '월수익 현물': won(T.mSp - T.mk) + ' 원', '장기계약': PRICE.g2.toFixed(3), '현물': PRICE.spot.toFixed(3),
      '전기안전관리비(년)': won(T.safe) + ' 원', '보험료(년)': won(T.ins) + ' 원', '계통 구분': T.grid, '한전연계비 vat별도': won(T.kepcoFee) + ' 원',
      '한전 단말통신공사(50kW 이상)': T.terminal ? won(T.terminal) + ' 원' : '' });
    x = setNote(x, note);
    zip.file('ppt/slides/slide48.xml', x);
    // 49
    x = await get(49);
    x = setTable(x, '표 1', [null].concat(T.t49, [['합계', '', won(T.S.a1), won(T.c1), won(T.S.a2), won(T.c2), won(T.S.aN), T.cN < 0 ? '(' + won(-T.cN) + ')' : won(T.cN), won(T.S.k20)]]));
    x = setTable(x, '표 3', [null, null, [kw.toFixed(3), null, won(T.m1), won(T.m1 - T.mk)], [null, null, won(T.m2), won(T.m2 - T.mk)], [won(T.monthlyGen), null, won(T.mN), won(T.mN - T.mk)]]);
    x = setTable(x, '표 4', [null, null, [null, PRICE.g1.toFixed(3), PRICE.smp.toFixed(3), PRICE.rec1.toFixed(3)], [null, PRICE.g2.toFixed(3), PRICE.smp.toFixed(3), PRICE.rec2.toFixed(3)], [null, PRICE.gN.toFixed(3), PRICE.smp.toFixed(3), PRICE.recN.toFixed(3)]]);
    x = setByLabel(x, '표 7', { '전기안전관리비': won(T.safe), '보험료': won(T.ins), '계통 구분': T.grid, '한전연계비 vat별도': won(T.kepcoFee), '설계조정부담금(50kW이상)': '' });   // 설계조정부담금은 견적에서 산출(단말통신은 47·48쪽 라벨표에)
    x = setNote(x, note);
    zip.file('ppt/slides/slide49.xml', x);
    // JSZip 이 만든 폴더 항목(ppt/, ppt/media/ …)이 있으면 파워포인트가 "복구" 를 띄운다 → 전부 뺀다
    // (zip.remove 는 폴더 아래 파일까지 지워 버린다 → 항목만 빼낸다)
    Object.keys(zip.files).filter(k => zip.files[k].dir).forEach(k => { delete zip.files[k]; });
    return zip.generateAsync({ type: typeof window !== 'undefined' ? 'blob' : 'nodebuffer', compression: 'STORE' });   // 노드(24+)에도 Blob 이 있어 window 로 가른다
  }

  /**
   * 슬라이드 srcNo 를 복제해 바로 뒤에 넣는다(그림 하나짜리 쪽 전용). 새 미디어 파일, 슬라이드 XML·rels, [Content_Types], presentation.xml(.rels) 갱신.
   * 노트 슬라이드 관계는 복제하지 않는다(두 슬라이드가 한 노트를 가리키면 파워포인트가 복구를 띄운다).
   */
  async function addSlideCopy(zip, srcNo, imgName, imgBytes, titleFrom, titleTo) {
    const files = Object.keys(zip.files);
    const newNo = Math.max(...files.map(f => (f.match(/^ppt\/slides\/slide(\d+)\.xml$/) || [0, 0])[1] | 0)) + 1;
    const mNo = Math.max(...files.map(f => (f.match(/^ppt\/media\/image(\d+)\./) || [0, 0])[1] | 0)) + 1;
    let xml = await zip.file('ppt/slides/slide' + srcNo + '.xml').async('string');
    let rels = await zip.file('ppt/slides/_rels/slide' + srcNo + '.xml.rels').async('string');
    rels = rels.replace(imgName, 'image' + mNo + '.png').replace(/<Relationship [^>]*notesSlide[^>]*\/>/g, '');
    if (titleFrom) xml = xml.replace('<a:t>' + titleFrom + '</a:t>', '<a:t>' + esc(titleTo) + '</a:t>');
    zip.file('ppt/media/image' + mNo + '.png', imgBytes);
    zip.file('ppt/slides/slide' + newNo + '.xml', xml);
    zip.file('ppt/slides/_rels/slide' + newNo + '.xml.rels', rels);
    let ct = await zip.file('[Content_Types].xml').async('string');
    if (ct.indexOf('/ppt/slides/slide' + newNo + '.xml') < 0) ct = ct.replace('</Types>', '<Override PartName="/ppt/slides/slide' + newNo + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>');
    zip.file('[Content_Types].xml', ct);
    let prels = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
    const relEls = prels.match(/<Relationship [^>]*\/>/g) || [];
    const srcRel = relEls.find(r => r.indexOf('Target="slides/slide' + srcNo + '.xml"') >= 0);
    const srcRid = srcRel && (srcRel.match(/Id="(rId\d+)"/) || [])[1];
    const rid = 'rId' + (Math.max(...relEls.map(r => +((r.match(/Id="rId(\d+)"/) || [0, 0])[1]))) + 1);
    prels = prels.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + newNo + '.xml"/></Relationships>');
    zip.file('ppt/_rels/presentation.xml.rels', prels);
    let pres = await zip.file('ppt/presentation.xml').async('string');
    const ids = pres.match(/<p:sldId [^>]*\/>/g) || [];
    const maxId = Math.max(...ids.map(s => +((s.match(/ id="(\d+)"/) || [0, 0])[1])));
    const src = ids.find(s => s.indexOf('r:id="' + srcRid + '"') >= 0);
    if (src) pres = pres.replace(src, src + '<p:sldId id="' + (maxId + 1) + '" r:id="' + rid + '"/>');
    zip.file('ppt/presentation.xml', pres);
    return newNo;
  }

  // ------------------------------------------------------------ 위성 배치도 (앱 지도 화면 꼴)
  const FONT = '"페이퍼로지 5 Medium", "Paperlogy 5 Medium", Paperlogy, "맑은 고딕", "Malgun Gothic", sans-serif';   // 원본 제안서 서체 우선(설치된 PC 에서만)
  /** 지붕들만 감싸는 lat/lng 상자 (주변 건물은 범위에 안 넣는다 → 현장만 확대) */
  function siteBox(d, padRatio) {
    const pts = [].concat(...d.roofs.map(r => [].concat(...r.rings)));
    let minLat = Math.min(...pts.map(p => p.lat)), maxLat = Math.max(...pts.map(p => p.lat)), minLng = Math.min(...pts.map(p => p.lng)), maxLng = Math.max(...pts.map(p => p.lng));
    const pl = (maxLat - minLat) * padRatio, pg = (maxLng - minLng) * padRatio;
    return { minLat: minLat - pl, maxLat: maxLat + pl, minLng: minLng - pg, maxLng: maxLng + pg };
  }
  const mercX = (lng, z) => (lng + 180) / 360 * 256 * Math.pow(2, z);
  const mercY = (lat, z) => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 256 * Math.pow(2, z);
  function loadTile(url) {
    return new Promise(res => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = url; setTimeout(() => res(null), 12000); });
  }
  /**
   * 위성사진 위에 모듈·라벨을 얹은 배치도 (앱 화면과 같은 꼴). 1600×1131. 타일은 V-World WMTS Satellite(crossOrigin 허용 확인 2026-10-07).
   * 타일을 못 받으면(오프라인·키 거부) 회색 바탕으로 그린다.
   */
  async function drawPlanMap(d) {
    const W = 1600, H = 1131;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#9aa39a'; g.fillRect(0, 0, W, H);
    const box = siteBox(d, 0.18);
    // 줌: 현장 상자가 캔버스 폭·높이의 80% 안에 들어오는 가장 큰 줌(최대 19)
    let z = 19;
    for (; z > 14; z--) { const w = mercX(box.maxLng, z) - mercX(box.minLng, z), h = mercY(box.minLat, z) - mercY(box.maxLat, z); if (w <= W * 0.8 && h <= H * 0.8) break; }
    const cx = (mercX(box.minLng, z) + mercX(box.maxLng, z)) / 2, cy = (mercY(box.minLat, z) + mercY(box.maxLat, z)) / 2;
    const s = Math.min(W * 0.8 / Math.max(1, mercX(box.maxLng, z) - mercX(box.minLng, z)), H * 0.8 / Math.max(1, mercY(box.minLat, z) - mercY(box.maxLat, z)), 2.5);
    const X = lng => W / 2 + (mercX(lng, z) - cx) * s, Y = lat => H / 2 + (mercY(lat, z) - cy) * s;
    const key = (typeof window !== 'undefined' && window.SOLAR_CONFIG && window.SOLAR_CONFIG.VWORLD_KEY) || '';
    if (key) {
      const tx0 = Math.floor((cx - W / 2 / s) / 256), tx1 = Math.floor((cx + W / 2 / s) / 256), ty0 = Math.floor((cy - H / 2 / s) / 256), ty1 = Math.floor((cy + H / 2 / s) / 256);
      const jobs = [];
      for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) jobs.push(loadTile('https://api.vworld.kr/req/wmts/1.0.0/' + key + '/Satellite/' + z + '/' + ty + '/' + tx + '.jpeg').then(im => ({ im, tx, ty })));
      (await Promise.all(jobs)).forEach(({ im, tx, ty }) => { if (im) g.drawImage(im, W / 2 + (tx * 256 - cx) * s, H / 2 + (ty * 256 - cy) * s, 256 * s + 0.5, 256 * s + 0.5); });
    }
    const path = ring => { g.beginPath(); ring.forEach((p, i) => i ? g.lineTo(X(p.lng), Y(p.lat)) : g.moveTo(X(p.lng), Y(p.lat))); g.closePath(); };
    // 앱 화면과 같은 색: 건물 외곽 빨강, 모듈 자홍(반투명)
    d.roofs.forEach(r => {
      r.rings.forEach(rg => { path(rg); g.fillStyle = 'rgba(0,0,0,.05)'; g.fill(); g.strokeStyle = '#ff3b3b'; g.lineWidth = 2.5; g.stroke(); });
      g.fillStyle = 'rgba(255,102,255,.6)'; g.strokeStyle = '#ff00ff'; g.lineWidth = 1;
      r.modules.forEach(m => { path(m); g.fill(); g.stroke(); });
    });
    d.roofs.forEach(r => {
      const cx2 = X(r.centroid.lng), cy2 = Y(r.centroid.lat);
      const t1 = r.kw.toFixed(2) + 'kW', t2 = d.module.w + 'W × ' + r.count + 'EA';
      g.font = 'bold 30px ' + FONT; const w1 = g.measureText(t1).width; g.font = '18px ' + FONT; const w2 = g.measureText(t2).width;
      const bw = Math.max(w1, w2) + 28, bh = 72, bx = cx2 - bw / 2, by = cy2 - bh / 2;
      g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath(); g.roundRect ? g.roundRect(bx, by, bw, bh, 10) : g.rect(bx, by, bw, bh); g.fill();
      g.strokeStyle = '#ddd'; g.lineWidth = 1; g.stroke();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#d4145a'; g.font = 'bold 30px ' + FONT; g.fillText(t1, cx2, cy2 - 12);
      g.fillStyle = '#333'; g.font = '18px ' + FONT; g.fillText(t2, cx2, cy2 + 20);
    });
    // 축척·방위·출처
    const mPerPx = 156543.03 * Math.cos(((box.minLat + box.maxLat) / 2) * Math.PI / 180) / Math.pow(2, z) / s;
    const barM = [10, 20, 50, 100, 200].find(m => m / mPerPx >= 90) || 200;
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(24, H - 60, barM / mPerPx + 90, 36);
    g.strokeStyle = '#000'; g.lineWidth = 4; g.beginPath(); g.moveTo(36, H - 40); g.lineTo(36 + barM / mPerPx, H - 40); g.stroke();
    g.fillStyle = '#000'; g.font = '16px ' + FONT; g.textAlign = 'left'; g.fillText(barM + ' m', 46 + barM / mPerPx, H - 40);
    g.font = 'bold 22px ' + FONT; g.textAlign = 'center'; g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(W - 50, 70); g.lineTo(W - 50, 24); g.stroke(); g.beginPath(); g.moveTo(W - 50, 16); g.lineTo(W - 60, 36); g.lineTo(W - 40, 36); g.closePath(); g.fillStyle = '#000'; g.fill();
    g.fillStyle = '#fff'; g.fillText('N', W - 50, 92); g.strokeText && 0;
    g.font = '13px ' + FONT; g.textAlign = 'right'; g.fillStyle = '#fff'; g.fillText('위성 © V-World · 배치 ' + d.site.name + ' · ' + d.kw.toFixed(2) + 'kW', W - 20, H - 16);
    return cv.toDataURL('image/png');
  }

  // ------------------------------------------------------------ CAD 도면 틀 (원본 37·38쪽과 같은 꼴)
  function sheetFrame(g, W, H, d, titleName) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeRect(12, 12, W - 24, H - 24);
    // 표제란
    const y0 = H - 88, h = 76; g.lineWidth = 1.5; g.strokeRect(12, y0, W - 24, h);
    const cols = [12, 300, 480, 760, 870, 1010, 1180, 1500, W - 12];
    cols.slice(1, -1).forEach(x => { g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + h); g.stroke(); });
    g.fillStyle = '#000'; g.textBaseline = 'middle';
    const small = (t, x, y, a) => { g.font = '13px ' + FONT; g.textAlign = a || 'left'; g.fillText(t, x, y); };
    small('공 사 명', 20, y0 + 20); small('PROJECT', 20, y0 + 38);
    g.font = '15px ' + FONT; g.fillText((d.site.addr || d.site.name || ''), 100, y0 + 30); g.fillText(d.site.name && d.site.name !== d.site.addr ? d.site.name : '', 100, y0 + 54);
    small('시 행 청', 308, y0 + 20);
    g.font = '13px ' + FONT; g.textAlign = 'center'; g.fillText('그랜드썬기술단', 620, y0 + 18); g.fillText('GRANDSUN ENGINEERING CO., LTD.', 620, y0 + 38); g.fillText('TEL : 051-941-7783   FAX : 051-941-7785', 620, y0 + 58);
    g.fillText('1 : none', 815, y0 + 38);
    g.textAlign = 'left'; ['책임기술자', '설 계 자', '제 도 자'].forEach((t, i) => { g.fillText(t, 878, y0 + 14 + i * 24); g.beginPath(); g.moveTo(870, y0 + 25 + i * 24); g.lineTo(1180, y0 + 25 + i * 24); g.stroke(); });
    g.beginPath(); g.moveTo(960, y0); g.lineTo(960, y0 + h); g.stroke();
    small('도 면 명', 1188, y0 + 20); small('T I T L E', 1188, y0 + 38);
    g.font = '16px ' + FONT; g.textAlign = 'center'; g.fillText(titleName, 1340, y0 + 40);
    small('도면번호', 1508, y0 + 20);
  }
  function compass(g, x, y) {
    g.save(); g.translate(x, y); g.strokeStyle = '#000'; g.fillStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, 34, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(0, 0, 24, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(0, -46); g.lineTo(8, 0); g.lineTo(0, 46); g.lineTo(-8, 0); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -46); g.lineTo(8, 0); g.lineTo(-8, 0); g.closePath(); g.fill();
    g.strokeStyle = '#000'; g.beginPath(); g.moveTo(0, -46); g.lineTo(8, 0); g.lineTo(0, 46); g.lineTo(-8, 0); g.closePath(); g.stroke();
    g.fillStyle = '#000'; g.font = 'bold 16px ' + FONT; g.textAlign = 'center'; g.fillText('N', 0, -54); g.restore();
  }
  const PALETTE = ['#e0251f', '#19b219', '#1a2fd6', '#e01fd6', '#e08a1f', '#16a3a3'];

  /** 웹 메르카토르 타일 번호 → 타일 NW 모서리 lat/lng */
  const tileNW = (tx, ty, z) => { const n = Math.pow(2, z); const lng = tx / n * 360 - 180; const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n))) * 180 / Math.PI; return { lat, lng }; };

  /**
   * 원본 37쪽 꼴의 배치도 도면 (1600×1131). 건물 외곽 빨강, 동별 모듈 색, 라벨 상자(주소·동·kW·(W×EA)), 모듈 표, 표제란.
   * opt.satellite 면 도면 영역에 V-World 위성 타일을 같은 좌표계로 깔고 모듈은 자홍색(앱 화면 꼴).
   */
  async function drawPlanSheet(d, opt) {
    opt = opt || {};
    const W = 1600, H = 1131;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    sheetFrame(g, W, H, d, '모듈배치평면도');
    const area = { x: 120, y: 60, w: W - 150, h: H - 60 - 88 - 160 };
    g.strokeStyle = '#d33'; g.lineWidth = 1; g.strokeRect(area.x, area.y, area.w, area.h);
    const o = d.origin, all = [];
    d.roofs.forEach(r => r.rings.forEach(rg => all.push(...toXY(rg, o))));   // 주변 건물은 범위에 넣지 않는다(현장만 확대)
    const minX = Math.min(...all.map(p => p.x)), maxX = Math.max(...all.map(p => p.x)), minY = Math.min(...all.map(p => p.y)), maxY = Math.max(...all.map(p => p.y));
    const pad = 110, sc = Math.min((area.w - pad * 2) / Math.max(1, maxX - minX), (area.h - pad * 2) / Math.max(1, maxY - minY));
    const ox = area.x + (area.w - (maxX - minX) * sc) / 2, oy = area.y + (area.h - (maxY - minY) * sc) / 2;
    const X = x => ox + (x - minX) * sc, Y = y => oy + (maxY - y) * sc;
    const path = ring => { g.beginPath(); ring.forEach((p, i) => i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))); g.closePath(); };
    g.save(); g.beginPath(); g.rect(area.x, area.y, area.w, area.h); g.clip();
    g.fillStyle = opt.satellite ? '#8f968f' : '#eef0ec'; g.fillRect(area.x, area.y, area.w, area.h);
    const key = (typeof window !== 'undefined' && window.SOLAR_CONFIG && window.SOLAR_CONFIG.VWORLD_KEY) || '';
    if (opt.satellite && key) {
      // 도면 영역이 덮는 lat/lng 범위 → 그 범위의 타일을 받아 같은 좌표계(X/Y)로 깐다. 줌은 타일 1px 이 도면 1px 안팎이 되게.
      const invX = px => minX + (px - ox) / sc, invY = py => maxY - (py - oy) / sc;
      const k = 111320 * Math.cos(o.lat * Math.PI / 180);
      const toLL = (x, y) => ({ lat: o.lat + y / 110574, lng: o.lng + x / k });
      const nw = toLL(invX(area.x), invY(area.y)), se = toLL(invX(area.x + area.w), invY(area.y + area.h));
      const mPerPxWanted = 1 / sc;
      let z = 19; for (; z > 12; z--) { const mpp = 156543.03 * Math.cos(o.lat * Math.PI / 180) / Math.pow(2, z); if (mpp >= mPerPxWanted * 0.9) break; }
      const n = Math.pow(2, z);
      const txOf = lng => Math.floor((lng + 180) / 360 * n), tyOf = lat => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
      const jobs = [];
      for (let tx = txOf(nw.lng); tx <= txOf(se.lng); tx++) for (let ty = tyOf(nw.lat); ty <= tyOf(se.lat); ty++)
        jobs.push(loadTile('https://api.vworld.kr/req/wmts/1.0.0/' + key + '/Satellite/' + z + '/' + ty + '/' + tx + '.jpeg').then(im => ({ im, tx, ty })));
      (await Promise.all(jobs)).forEach(({ im, tx, ty }) => {
        if (!im) return;
        const a = toXY([tileNW(tx, ty, z)], o)[0], b = toXY([tileNW(tx + 1, ty + 1, z)], o)[0];
        g.drawImage(im, X(a.x), Y(a.y), X(b.x) - X(a.x) + 0.5, Y(b.y) - Y(a.y) + 0.5);
      });
    }
    if (!opt.satellite) (d.buildings || []).forEach(b => { path(toXY(b.ring, o)); g.fillStyle = '#d9dbd6'; g.fill(); g.strokeStyle = '#9a9c98'; g.lineWidth = 1; g.stroke(); });
    d.roofs.forEach((r, i) => {
      const col = opt.satellite ? 'rgba(255,102,255,.65)' : PALETTE[i % PALETTE.length];
      r.rings.forEach(rg => { path(toXY(rg, o)); g.fillStyle = opt.satellite ? 'rgba(0,0,0,.04)' : '#f7f7f4'; g.fill(); g.strokeStyle = opt.satellite ? '#ff3b3b' : '#e0251f'; g.lineWidth = 2.5; g.stroke(); });
      g.fillStyle = col; g.strokeStyle = opt.satellite ? '#ff00ff' : '#fff'; g.lineWidth = 0.5;
      r.modules.forEach(m => { path(toXY(m, o)); g.fill(); g.stroke(); });
      if (r.ridges) { g.setLineDash([6, 4]); g.strokeStyle = '#555'; g.lineWidth = 1; r.ridges.forEach(seg => { const s = toXY(seg, o); g.beginPath(); g.moveTo(X(s[0].x), Y(s[0].y)); g.lineTo(X(s[1].x), Y(s[1].y)); g.stroke(); }); g.setLineDash([]); }
    });
    g.restore();
    // 라벨 상자: 동 이름 / kW(빨강) / (W × EA). 그림 바깥쪽으로 번갈아 띄우고 지시선.
    d.roofs.forEach((r, i) => {
      const c = toXY([r.centroid], o)[0], cx = X(c.x), cy = Y(c.y);
      const bw = 190, bh = 74, right = cx < area.x + area.w / 2;
      const bx = Math.max(area.x + 8, Math.min(area.x + area.w - bw - 8, cx + (right ? -bw - 70 : 70))), by = Math.max(area.y + 8, Math.min(area.y + area.h - bh - 8, cy - bh / 2 + (i % 2 ? 60 : -60)));
      g.strokeStyle = '#1a2fd6'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx, cy); g.lineTo(right ? bx + bw : bx, by + bh / 2); g.stroke();
      g.fillStyle = '#fff'; g.fillRect(bx, by, bw, bh); g.strokeRect(bx, by, bw, bh);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#000';
      g.font = '13px ' + FONT; g.fillText((d.site.short || '') + ' ' + String.fromCharCode(65 + i) + '동 · ' + r.typeLabel.split(' ')[0], bx + bw / 2, by + 15);
      g.font = 'bold 24px ' + FONT; g.fillStyle = '#e0251f'; g.fillText(r.kw.toFixed(2) + 'KW', bx + bw / 2, by + 40);
      g.font = '13px ' + FONT; g.fillStyle = '#000'; g.fillText('(' + d.module.w + 'W × ' + r.count + 'EA)', bx + bw / 2, by + 61);
    });
    compass(g, area.x + 60, area.y + 70);
    // 하단: 모듈배치도 표시 + 모듈 표
    const ty = area.y + area.h + 20;
    g.strokeStyle = '#e08a1f'; g.lineWidth = 2; g.beginPath(); g.arc(area.x + 50, ty + 55, 22, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(area.x + 20, ty + 55); g.lineTo(area.x + 300, ty + 55); g.stroke();
    g.fillStyle = '#1a2fd6'; g.font = 'bold 20px ' + FONT; g.textAlign = 'left'; g.fillText('모 듈 배 치 도', area.x + 90, ty + 40); g.font = '12px ' + FONT; g.fillText('SCALE: N/S', area.x + 180, ty + 72);
    const tx = W - 30 - 760, tw = [280, 130, 170, 180], th = 56;
    const total = d.roofs.reduce((a, r) => a + r.count, 0);
    const tilts = [...new Set(d.roofs.map(r => r.tilt))].sort((a, b) => a - b);
    const cells = [['모     듈', '', '', '설치각도'], [d.module.maker + ' ' + d.module.w + 'Wp(양면)|' + d.module.L.toLocaleString() + ' x ' + d.module.S.toLocaleString(), total.toLocaleString() + '장', d.kw.toFixed(3) + 'kW', (tilts.length > 1 ? tilts[0] + '~' + tilts[tilts.length - 1] : tilts[0]) + '도']];
    g.strokeStyle = '#000'; g.lineWidth = 1.5; g.fillStyle = '#000'; g.textAlign = 'center';
    let x = tx; tw.forEach((w, j) => { g.strokeRect(x, ty, w, th); g.strokeRect(x, ty + th, w, th + 18); x += w; });
    g.strokeRect(tx, ty, tw[0] + tw[1] + tw[2], th);
    g.font = 'bold 26px ' + FONT; g.fillText('모     듈', tx + (tw[0] + tw[1] + tw[2]) / 2, ty + th / 2); g.fillText('설치각도', tx + tw[0] + tw[1] + tw[2] + tw[3] / 2, ty + th / 2);
    g.font = '22px ' + FONT; x = tx;
    cells[1].forEach((t, j) => { const ls = t.split('|'); ls.forEach((l, k) => g.fillText(l, x + tw[j] / 2, ty + th + (th + 18) / 2 + (k - (ls.length - 1) / 2) * 26)); x += tw[j]; });
    if (opt.satellite) { g.font = '12px ' + FONT; g.textAlign = 'right'; g.fillStyle = '#444'; g.fillText('위성 © V-World', area.x + area.w - 6, area.y + area.h + 14); }
    return cv.toDataURL('image/png');
  }

  /** 원본 38쪽 꼴의 측면도 도면. 큰 동 2개를 "A"-"A", "B"-"B" 로. */
  function drawSectionSheet(d) {
    const W = 1600, H = 1131;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    sheetFrame(g, W, H, d, '모듈배치측면도');
    // 안쪽 영역(테두리~표제란)에 단면 2개를 나란히: 각 700×294(1000×420 비율), 아래에 이름표
    const picks = d.roofs.slice().sort((a, b) => b.kw - a.kw).slice(0, 2);
    // 안쪽 영역(위 테두리 12 ~ 표제란 위 H-88) 가운데에 단면을 나란히. 그림 아래에는 "A"-"A" 측면도 VIEW SCALE 1:1 만.
    const innerW = W - 24, innerTop = 12, innerBot = H - 88, cols = picks.length || 1, cw = innerW / cols;
    picks.forEach((r, i) => {
      const w = Math.min(760, cw - 40), h = w * 0.42, x = 12 + i * cw + (cw - w) / 2;
      const block = h + 90, y = innerTop + (innerBot - innerTop - block) / 2;
      g.drawImage(drawSectionCanvas(r), x, y, w, h);
      g.fillStyle = '#1a2fd6'; g.font = 'bold 30px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('“' + String.fromCharCode(65 + i) + '“-“' + String.fromCharCode(65 + i) + '“ 측면도  VIEW  SCALE  1:1', x + w / 2, y + h + 60);
    });
    return cv.toDataURL('image/png');
  }

  return { build, save, consult, drawPlan, drawSection, drawPlanSheet, drawSectionSheet, fillTemplate, computeTables, kepcoLine, kepcoFeeOf, terminalOf, PRICE, genKwh, yearCost, COST_PER_KW };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Proposal;
