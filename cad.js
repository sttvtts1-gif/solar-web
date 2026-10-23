/*
 * CAD(DXF) 출력 — 배치 평면도 · 측면도 · 배면도를 한 DXF(AutoCAD 2000 ASCII) 파일로.
 *
 * 단위 m($INSUNITS=6). 좌표는 현장 중심 원점의 미터 평면(x 동, y 북). 평면도는 원점에, 측면도는 그 오른쪽, 배면도(북쪽에서 본 입면)는 그 아래.
 * 레이어: BLDG(건물 외곽, 흰색 7) · MODULE(모듈, 자홍 6) · RIDGE(용마루, 노랑 2) · DIM(치수·지시, 빨강 1) · TEXT(글, 녹색 3) · FRAME(틀, 회색 8)
 * 글자는 TEXT(높이 m). 한글은 UTF-8 로 쓰며($DWGCODEPAGE 없이) 최신 AutoCAD·DWG TrueView·QCAD 가 읽는다.
 * 입력은 proposal 의 roofs 데이터(이름·형태·링·모듈·높이)와 같다.
 */
const Cad = (() => {
  const M_LAT = 110574, M_LNG = lat => 111320 * Math.cos(lat * Math.PI / 180);
  function toXY(ring, o) { const k = M_LNG(o.lat); return ring.map(p => ({ x: (p.lng - o.lng) * k, y: (p.lat - o.lat) * M_LAT })); }
  const f = n => (Math.round(n * 1000) / 1000).toString();

  function writer() {
    const e = [];
    // R12 꼴 POLYLINE/VERTEX/SEQEND (LWPOLYLINE + AC1015 머리는 이 PC AutoCAD 2021 이 거부 — 2026-10-08 확인)
    /** 모듈: 두께 0.12m 닫힌 사각형(MODULE) + 칸 구분선 + 아래 레일(FRAME) · 기둥: 폭 0.08m 사각형(FRAME) + 받침판 · 벤츄레이터: 용마루 위 박스(BLDG) (2026-10-23) */
    const modRect = (a, b, nSeg) => { const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L * 0.12, ny = dx / L * 0.12; poly('MODULE', [a, b, { x: b.x + nx, y: b.y + ny }, { x: a.x + nx, y: a.y + ny }], true); const n = nSeg || Math.max(1, Math.round(L / 2.465)); for (let k = 1; k < n; k++) { const u = k / n, p = { x: a.x + dx * u, y: a.y + dy * u }; line('MODULE', p, { x: p.x + nx, y: p.y + ny }); } line('FRAME', { x: a.x, y: a.y - 0.06 }, { x: b.x, y: b.y - 0.06 }); };
    const postRect = (a, b) => { const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y); if (hi - lo < 0.02) return; const x = a.x; poly('FRAME', [{ x: x - 0.04, y: lo }, { x: x + 0.04, y: lo }, { x: x + 0.04, y: hi }, { x: x - 0.04, y: hi }], true); line('FRAME', { x: x - 0.16, y: lo }, { x: x + 0.16, y: lo }); };
    const ventBox = p => { poly('BLDG', [{ x: p.x - 0.35, y: p.y + 0.12 }, { x: p.x + 0.35, y: p.y + 0.12 }, { x: p.x + 0.35, y: p.y + 0.6 }, { x: p.x - 0.35, y: p.y + 0.6 }], true); line('BLDG', { x: p.x - 0.5, y: p.y + 0.6 }, { x: p.x + 0.5, y: p.y + 0.6 }); line('BLDG', { x: p.x - 0.14, y: p.y }, { x: p.x - 0.14, y: p.y + 0.12 }); line('BLDG', { x: p.x + 0.14, y: p.y }, { x: p.x + 0.14, y: p.y + 0.12 }); };
    // 구조도 요소(2026-10-23): 가세·X보강(FRAME 선), 기초 브라켓(FRAME 작은 사각), 거치대 단면(rackAt), 원단 레일(railAt), 줄 정면(rowAt)
    const braceL = (a, b) => line('FRAME', a, b);
    const bracketAt = p => poly('FRAME', [{ x: p.x - 0.12, y: p.y }, { x: p.x + 0.12, y: p.y }, { x: p.x + 0.12, y: p.y + 0.06 }, { x: p.x - 0.12, y: p.y + 0.06 }], true);
    const rackAt = (M, x, aw, fb, ft, bb, bt, nSeg) => { postRect(M(x, fb), M(x, ft)); postRect(M(x + aw, bb), M(x + aw, bt)); braceL(M(x, fb + 0.1), M(x + aw, bt - 0.08)); braceL(M(x + aw, bb + 0.1), M(x, ft - 0.08)); bracketAt(M(x, fb)); bracketAt(M(x + aw, bb)); modRect(M(x, ft), M(x + aw, bt), nSeg); };
    const railAt = (M, from, to, topZ, botZ, nSeg) => { modRect(M(from, topZ(from)), M(to, topZ(to)), nSeg); line('FRAME', M(from, botZ(from) + 0.08), M(to, botZ(to) + 0.08)); const n = Math.max(1, Math.round((to - from) / 1.5)), xs = []; for (let k = 0; k <= n; k++) xs.push(from + (to - from) * k / n); xs.forEach((x, k) => { postRect(M(x, botZ(x) + 0.08), M(x, topZ(x) - 0.06)); bracketAt(M(x, botZ(x))); if (k < n) { const x2 = xs[k + 1]; if (k % 2 === 0) braceL(M(x, botZ(x) + 0.12), M(x2, topZ(x2) - 0.1)); else braceL(M(x, topZ(x) - 0.1), M(x2, botZ(x2) + 0.12)); } }); };
    const rowAt = (M, x0, x1, zBot, zTop, nSeg) => { modRect(M(x0, zTop), M(x1, zTop), nSeg); const n = Math.max(1, Math.round((x1 - x0) / 2.4)), xs = []; for (let k = 0; k <= n; k++) xs.push(x0 + (x1 - x0) * k / n); xs.forEach((x, k) => { postRect(M(x, zBot), M(x, zTop - 0.06)); bracketAt(M(x, zBot)); if (k < n) { const x2 = xs[k + 1]; braceL(M(x, zBot + 0.1), M(x2, zTop - 0.12)); braceL(M(x, zTop - 0.12), M(x2, zBot + 0.1)); } }); };
    const poly = (layer, pts, closed) => { e.push('0', 'POLYLINE', '8', layer, '66', '1', '70', closed ? '1' : '0'); pts.forEach(p => e.push('0', 'VERTEX', '8', layer, '10', f(p.x), '20', f(p.y), '30', '0')); e.push('0', 'SEQEND', '8', layer); };
    // 한글은 그대로 두고, 파일로 낼 때 CP949 바이트로 바꾼다(cp949.js). R12 DXF 는 ANSI 코드페이지로 읽혀 UTF-8·\U+ 둘 다 안 된다(2026-10-08 확인).
    const uesc = s => String(s).replace(/[\r\n]/g, ' ');
    const line = (layer, a, b) => e.push('0', 'LINE', '8', layer, '10', f(a.x), '20', f(a.y), '30', '0', '11', f(b.x), '21', f(b.y), '31', '0');
    const text = (layer, p, h, s, rot, align) => { e.push('0', 'TEXT', '8', layer, '10', f(p.x), '20', f(p.y), '30', '0', '40', f(h), '1', uesc(s), '50', String(rot || 0)); if (align) { e.push('72', '1', '11', f(p.x), '21', f(p.y), '31', '0'); } };
    const circle = (layer, c, r) => e.push('0', 'CIRCLE', '8', layer, '10', f(c.x), '20', f(c.y), '30', '0', '40', f(r));
    /** 세로 치수: 치수선 + 양끝 눈금 + 눕힌 글 */
    const vdim = (x, y1, y2, label, h) => { line('DIM', { x, y: y1 }, { x, y: y2 }); [y1, y2].forEach(y => line('DIM', { x: x - 0.4, y }, { x: x + 0.4, y })); text('DIM', { x: x - 0.3, y: (y1 + y2) / 2 }, h || 0.6, label, 90, true); };
    const hdim = (y, x1, x2, label, h) => { line('DIM', { x: x1, y }, { x: x2, y }); [x1, x2].forEach(x => line('DIM', { x, y: y - 0.4 }, { x, y: y + 0.4 })); text('DIM', { x: (x1 + x2) / 2, y: y + 0.3 }, h || 0.6, label, 0, true); };
    function dump() {
      const layers = [['BLDG', 7], ['MODULE', 6], ['RIDGE', 2], ['DIM', 1], ['TEXT', 3], ['FRAME', 8]];
      // HEADER 없음 = AutoCAD 가 R12 로 읽는다(버전 선언 + LWPOLYLINE 은 핸들 없음 등으로 거부). 단위(m)는 그림 글에 적는다.
      const out = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(layers.length)];
      layers.forEach(([n, c]) => out.push('0', 'LAYER', '2', n, '70', '0', '62', String(c), '6', 'CONTINUOUS'));
      out.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
      for (const x of e) out.push(x);   // 전개(...)는 수만 개면 스택이 넘친다
      out.push('0', 'ENDSEC', '0', 'EOF');
      return out.join('\r\n') + '\r\n';
    }
    return { poly, line, text, circle, vdim, hdim, dump, mod: (a, b, nSeg) => modRect(a, b, nSeg), post: (a, b) => postRect(a, b), vent: p => ventBox(p), rack: rackAt, rail: railAt, row: rowAt };
  }

  /**
   * @param d proposal 데이터 { site, kw, module, roofs:[{ name, type, typeLabel, rings, modules, kw, count, kind, spans, roofSlope, eaveH, ridgeH, topH, arrayH, arrayDepth, depthM, widthM, pitch, ridges, buildingAngle }], origin }
   * @returns string (DXF)
   */
  function dxf(d) {
    const w = writer(), o = d.origin;
    const mm = v => Math.round(v * 1000).toLocaleString('ko-KR');
    // ---- 평면도
    const all = [].concat(...d.roofs.map(r => [].concat(...r.rings.map(rg => toXY(rg, o)))));
    const minX = Math.min(...all.map(p => p.x)), maxX = Math.max(...all.map(p => p.x)), minY = Math.min(...all.map(p => p.y)), maxY = Math.max(...all.map(p => p.y));
    w.text('TEXT', { x: minX, y: maxY + 6 }, 1.5, '모듈 배치 평면도 - ' + (d.site.name || '') + ' · ' + d.kw.toFixed(2) + 'kW · ' + d.module.w + 'W ' + d.module.L + '×' + d.module.S);
    w.line('DIM', { x: minX, y: maxY + 3 }, { x: minX, y: maxY + 5.5 }); w.text('DIM', { x: minX + 0.4, y: maxY + 4 }, 0.8, 'N');
    d.roofs.forEach((r, i) => {
      r.rings.forEach(rg => w.poly('BLDG', toXY(rg, o), true));
      r.modules.forEach(m => w.poly('MODULE', toXY(m, o), true));
      (r.ridges || []).forEach(seg => { const s = toXY(seg, o); w.line('RIDGE', s[0], s[1]); });
      const c = toXY([r.centroid], o)[0];
      w.text('TEXT', { x: c.x, y: c.y + 0.8 }, 1.2, String.fromCharCode(65 + i) + '동 ' + r.kw.toFixed(2) + 'kW', 0, true);
      w.text('TEXT', { x: c.x, y: c.y - 0.8 }, 0.7, '(' + d.module.w + 'W × ' + r.count + 'EA) ' + r.typeLabel, 0, true);
      // 처마·옆·용마루 이격 치수(DIM 층, mm)
      (r.dims || []).forEach(dm => { const a = toXY([dm.a], o)[0], b = toXY([dm.b], o)[0]; w.line('DIM', a, b); const vert = Math.abs(b.x - a.x) < Math.abs(b.y - a.y); w.text('DIM', vert ? { x: Math.max(a.x, b.x) + 0.3, y: (a.y + b.y) / 2 } : { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + 0.3 }, 0.35, dm.text, 0, !vert); });
    });
    // 전기실·사다리 (FRAME 층)
    (d.fixtures || []).forEach(f => { if (f.lines) f.lines.forEach(seg => w.poly('FRAME', toXY(seg, o), false)); else w.poly('FRAME', toXY(f.ring, o), true); const c = toXY([f.c], o)[0]; w.text('TEXT', { x: c.x, y: c.y + (f.kind === 'elec' ? 0 : 1.2) }, 0.5, f.label, 0, true); });
    // ---- 측면도 (오른쪽), 배면도 (그 아래)
    let ox = maxX + 25;
    const ox0 = ox, topMax = Math.max(...d.roofs.map(r => r.topH || 0), 4);   // 배면도는 줄마다 따로(폭이 건물 길이라 옆으로 두면 겹친다, 2026-10-23)
    const picks = d.roofs.slice().sort((a, b) => b.kw - a.kw).slice(0, 2);
    picks.forEach((r, i) => {
      const depth = Math.max(8, r.depthM), eave = r.eaveH, ridge = r.ridgeH, top = r.topH, lift = r.frontLift != null ? r.frontLift : 0.5;
      const oy = maxY - 0;    // 측면도 지면선 y
      const P = (x, z) => ({ x: ox + x, y: oy + z });
      w.text('TEXT', { x: ox, y: oy + top + 4 }, 1.2, '"' + String.fromCharCode(65 + i) + '"-"' + String.fromCharCode(65 + i) + '" 측면도  (' + r.name + ' · ' + r.typeLabel + ')');
      w.line('BLDG', P(-2, 0), P(depth + 2, 0));
      w.line('BLDG', P(0, 0), P(0, eave)); w.line('BLDG', P(depth, 0), P(depth, eave));
      if (r.kind === 'gable-ew') {
        const n = r.spans, D = depth / n, t = Math.tan(r.roofSlope * Math.PI / 180);
        const rp = Array.isArray(r.ridgePos) && r.ridgePos.length === n ? r.ridgePos : null;
        const rc = k => Math.min(D - 0.5, Math.max(0.5, rp ? rp[k] - k * D : D / 2));
        const roofZ = y => { const k = Math.min(n - 1, Math.max(0, Math.floor(y / D))), u = y - k * D, c = rc(k); return eave + (u <= c ? u * t : c * t * Math.max(0, D - u) / Math.max(0.5, D - c)); };
        for (let k = 0; k < n; k++) {
          const y0 = k * D, yc = y0 + rc(k), y1 = y0 + D, hr = eave + rc(k) * t;
          w.line('BLDG', P(y0, eave), P(yc, hr)); w.line('BLDG', P(yc, hr), P(y1, eave)); w.vent(P(yc, hr));
        }
        const racks = (rz, from, to, legH) => { const aw = r.arrayDepth, ah = r.arrayH; for (let x = from; x + aw <= to + 1e-9; x += r.pitch) { const zf = rz(x) + legH; w.rack(P, x, aw, rz(x), zf, rz(x + aw), zf + ah, r.tiers || 2); } };
        if (r.type === 'ginseng') {
          racks(roofZ, 0.5, depth - 0.5, r.attach ? 0.12 : lift);                 // 인삼밭 부착: 지붕면 따라 거치대 (2026-10-23)
        } else if (r.blocks && r.blocks.length) {
          r.blocks.forEach(bk => { const planeZ = y => eave + bk.zf + (bk.zb - bk.zf) * (y - bk.from) / Math.max(0.01, bk.to - bk.from); w.rail(P, bk.from, bk.to, planeZ, roofZ, bk.rows); });
        } else {
          for (let k = 0; k < n; k++) {
            const y0 = k * D, yc = y0 + D / 2, y1 = y0 + D;
            w.mod(P(y0 + 0.5, eave + 0.5 * t + lift), P(yc - 0.3, eave + (D / 2 - 0.3) * t + lift));
            w.mod(P(yc + 0.3, eave + (D / 2 + 0.3) * t + lift), P(y1 - 0.5, eave + (D - 0.5) * t + lift));
            for (let s = 1; s <= 3; s++) { const u = D / 2 + 0.3 + (D / 2 - 0.8) * s / 3; w.post(P(y0 + u, eave + (D - u) * t), P(y0 + u, eave + u * t + lift)); }
          }
        }
        w.vdim(ox - 4, oy, oy + eave, mm(eave)); w.vdim(ox - 2.5, oy, oy + ridge, mm(ridge)); w.vdim(ox + depth + 2.5, oy, oy + top, mm(top)); w.vdim(ox + depth + 1.2, oy + eave, oy + top, mm(top - eave), 0.5);
        w.vdim(ox - 1.2, oy + eave, oy + eave + 0.5 * t + lift, mm(0.5 * t + lift), 0.45);
      } else if (r.kind === 'gable-ns') {
        const n = r.spans, Wd = depth / n, t = Math.tan(r.roofSlope * Math.PI / 180), base = ridge + 0.3;
        const rpn = Array.isArray(r.ridgePos) && r.ridgePos.length === n ? r.ridgePos : null;
        for (let k = 0; k < n; k++) { const x0 = k * Wd, c = Math.min(Wd - 0.5, Math.max(0.5, rpn ? rpn[k] - k * Wd : Wd / 2)), xc = x0 + c, hr = eave + c * t; w.line('BLDG', P(x0, eave), P(xc, hr)); w.line('BLDG', P(xc, hr), P(x0 + Wd, eave)); w.vent(P(xc, hr)); }
        const rz = x => { const i = Math.min(n - 1, Math.max(0, Math.floor(x / Wd))), u = x - i * Wd, c = Math.min(Wd - 0.5, Math.max(0.5, rpn ? rpn[i] - i * Wd : Wd / 2)); return eave + (u <= c ? u * t : c * t * Math.max(0, Wd - u) / Math.max(0.5, Wd - c)); };
        // 플랫 인삼밭(비부착): 지붕을 따라가는 거치대, 앞다리 lift(0.6m) (2026-10-23)
        { const aw = r.arrayDepth, ah = r.arrayH; let topZ = ridge; for (let x = 0.5; x + aw <= depth - 0.5 + 1e-9; x += r.pitch) { const zf = rz(x) + lift, zb = rz(x + aw) + lift + ah; w.rack(P, x, aw, rz(x), zf, rz(x + aw), zb, r.tiers || 2); topZ = Math.max(topZ, zf, zb); }
          w.vdim(ox - 1.2, oy + rz(0.5), oy + rz(0.5) + lift, mm(lift), 0.45); w.vdim(ox + depth + 1.2, oy + ridge, oy + topZ, mm(topZ - ridge), 0.45); }
        w.vdim(ox - 4, oy, oy + eave, mm(eave)); w.vdim(ox - 2.5, oy, oy + ridge, mm(ridge)); w.vdim(ox + depth + 2.5, oy, oy + top, mm(top));
      } else {
        const base = r.type === 'parking' ? 2.5 : r.type === 'ground' ? 0.5 : eave;
        const dep = Math.min(depth, 3 * r.pitch + r.arrayDepth + 4);
        if (base > 0 && r.type !== 'ground') w.line('BLDG', P(0, base), P(dep, base));
        for (let x = (r.type === 'ground' ? r.margin : 0.5); x + r.arrayDepth <= dep - 0.5; x += r.pitch) w.rack(P, x, r.arrayDepth, base, base + 0.3, base, base + 0.3 + r.arrayH, r.tiers || 1);
        if (base > 0) w.vdim(ox - 2.5, oy, oy + base, mm(base)); w.vdim(ox + dep + 2.5, oy, oy + base + 0.3 + r.arrayH, mm(base + 0.3 + r.arrayH));
      }
      w.text('DIM', { x: ox, y: oy - 1.2 }, 0.6, '남'); w.text('DIM', { x: ox + depth - 0.5, y: oy - 1.2 }, 0.6, '북');
      // 배면도: 북쪽에서 본 입면(줄 방향 폭 × 높이). 벽 → 처마, 지붕선, 모듈 상단선(북측 끝 높이), 다리.
      const by = oy - (topMax + 12) - i * (topMax + 16);   // i번째 배면도는 i번째 줄, x 는 측면도 첫 열부터
      const B = (x, z) => ({ x: ox0 + x, y: by + z });
      const wd = Math.max(8, r.widthM || depth);
      w.text('TEXT', { x: ox0, y: by + top + 3 }, 1.0, '"' + String.fromCharCode(65 + i) + '" 배면도 (북측 입면)');
      w.line('BLDG', B(-2, 0), B(wd + 2, 0));
      w.poly('BLDG', [B(0, 0), B(wd, 0), B(wd, eave), B(0, eave)], true);
      if (r.kind === 'gable-ns') {
        // 플랫 인삼밭을 길이 방향(C 방향)에서 본 입면 (2026-10-23 사용자 지시): 용마루는 길이 방향이라 처마선·용마루선이 수평, 그 위 프레임(용마루+0.3)에 거치대가 줄 간격(pitch)으로 톱니처럼
        w.line('BLDG', B(0, eave), B(wd, eave)); w.line('BLDG', B(0, ridge), B(wd, ridge)); w.line('BLDG', B(0, eave), B(0, ridge)); w.line('BLDG', B(wd, eave), B(wd, ridge));
        for (let x = 4; x < wd - 2; x += 8) w.vent(B(x, ridge));
        // 배면도(길이 방향): 가장 앞(처마) 줄의 거치대가 보인다 — 처마 + 앞다리 lift 에서 시작하는 톱니
        { const aw = r.arrayDepth, ah = r.arrayH; for (let x = 0.5; x + aw <= wd - 0.5 + 1e-9; x += r.pitch) w.rack(B, x, aw, eave, eave + lift, eave, eave + lift + ah, r.tiers || 2); }
      } else {
        if (r.kind === 'gable-ew') { w.line('BLDG', B(0, eave), B(wd, eave)); }
        w.row(B, 0.3, wd - 0.3, r.kind === 'gable-ew' ? eave + 0.08 : eave, top);   // 줄 정면: 기둥 사이 X보강 (구조도 VIEW A-A 꼴)
      }
      w.vdim(ox0 - 2.5, by, by + eave, mm(eave)); w.vdim(ox0 + wd + 2.5, by, by + top, mm(top));
      w.hdim(by - 1.5, ox0, ox0 + wd, mm(wd));
      ox += depth + 30;
    });
    return w.dump();
  }

  return { dxf };
})();
