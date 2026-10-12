/*
 * 태양광 모듈 배치 계산.
 *
 * 지도 좌표(lat/lng) 다각형을 받아 미터 평면으로 옮기고, 거기서 격자를 깐 뒤
 * 다시 lat/lng 로 돌려준다. 지도와는 무관한 순수 계산이라 따로 떼어 뒀다.
 *
 * 좌표계 약속 (미터 평면)
 *   x = 동쪽(+), y = 북쪽(+). 각도는 동쪽 기준 반시계(수학 좌표계) 도(°).
 *   "줄(row)" 은 모듈이 옆으로 늘어선 방향이다. 정남향 배치면 줄은 동서(0°)로 놓이고
 *   모듈 앞면은 -y(남쪽)를 본다.
 */
const Layout = (() => {
  const M_PER_LAT = 110574;      // 위도 1° ≈ 110.574 km
  const M_PER_LNG = 111320;      // 경도 1° ≈ 111.320 km × cos(위도)
  const D2R = Math.PI / 180;

  // 지붕 형태별 기본값. 사용자가 설정에서 바꾸면 덮어쓴다.
  // 경사거치(tilt>0)는 어레이 이격을 "후면입사각" 으로 자동 계산한다. 전면(경사)각은 현장 관행 10~15°, 후면입사각 22°(사용자 지정):
  //   어레이 높이 H = 경사길이 × sin(tilt), 이격 = H / tan(shadeAngle). 평면 깊이 = 경사길이 × cos(tilt).
  //   A동 도면(14×30m, 인삼밭 2단): tilt 15°, 22° → 피치 8.08m, 4어레이 × 12장 = 96장으로 도면과 같다.
  const PRESETS = {
    // 동서지붕(남북이 긴 건물): 정남으로 세워 인삼밭처럼 2단 거치 + 음영 이격
    ginseng: { label: '동서지붕 · 인삼밭 2단', orient: 'portrait', tiers: 2, tierGap: 0.10, tilt: 15, shadeAngle: 22, autoGap: true, arrayGap: 3.0, colBlock: 20, blockGap: 0.6 },
    // 남북지붕(동서로 긴 건물) 또는 경사 지붕 면 전체를 덮는 원단(밀착) 배치. 지붕면에 붙으니 이격 없음.
    // 남북지붕 원단: 용마루에서 끊어 면마다 남향 블록 하나, 블록 사이는 후면입사각 22° (사용자 도면 2026-10-02).
    //   처마·골 이격 500, 용마루 이격 300, 경사 10°. 북측 블록은 남쪽 면과 같은 면으로 들어 올려 이어 붙인다(lift 는 안 씀).
    //   건물 지붕은 좌우 20열마다 60cm 통로(colBlock/blockGap).
    flush:   { label: '남북지붕 · 원단',       orient: 'portrait', tiers: 1, tierGap: 0.05, tilt: 10, shadeAngle: 22, autoGap: true, arrayGap: 0.05,
               ridge: true, spans: 1, eaveSetback: 0.5, ridgeSetback: 0.3, lift: 0, colBlock: 20, blockGap: 0.6, frontLift: 0.5, maxLiftH: 4 },   // frontLift = 앞다리(지붕면에서 띄움), maxLiftH = 북면 블록 지붕 위 최대 높이(m)
    // 평슬라브: 정남 경사거치, 줄마다 후면입사각 이격
    slab:    { label: '평슬라브 · 경사거치',   orient: 'portrait', tiers: 1, tierGap: 0.05, tilt: 15, shadeAngle: 22, autoGap: true, arrayGap: 2.5, colBlock: 20, blockGap: 0.6 },
    // 토지(노지): 필지 외곽선 안에 정남 2단 거치. 앞뒤는 후면입사각 22° 이격, 좌우는 30열마다 2m 통로(점검·장비 진입). 경계 이격 3m(펜스).
    //   필지는 건물처럼 축이 뚜렷하지 않아 줄 방향은 기본 정남. 경사각은 2단 기준 15°(설정에서 바꿀 수 있음).
    ground:  { label: '토지 · 노지 2단',       orient: 'portrait', tiers: 2, tierGap: 0.10, tilt: 15, shadeAngle: 22, autoGap: true, arrayGap: 3.0,
               colBlock: 30, blockGap: 2.0, margin: 3.0, align: 'south' },   // 지적경계 3m 이격 = 펜스 돌릴 공간(사용자 지정)
    // 주차장 캐노피: 주차장 면적 위에 1~4단(지붕 목록에서 고름) 경사 10°. 방위각으로 돌린다.
    //   줄은 기본으로 주차장(건물) 축에 맞추고(align auto), 목록에서 방위각을 주면 그때 정남 기준 방위각으로 돈다.
    parking: { label: '주차장 · 캐노피',       orient: 'portrait', tiers: 2, tierGap: 0.05, tilt: 10, shadeAngle: 22, autoGap: true, arrayGap: 2.0,
               margin: 0.5, align: 'auto' },
  };

  const DEFAULTS = {
    ridge: false, spans: 1, eaveSetback: 0.5, ridgeSetback: 0.3, lift: 0,   // 원단(용마루 분할) 전용, 다른 형태는 안 씀
    maxLiftH: 4,          // 원단 북면 블록이 지붕면 위로 올라갈 수 있는 최대 높이(m). 넘으면 끊고 22° 이격 뒤 새 블록
    ventN: 2,             // 벤츄레이터 개수(동마다). 용마루 위에 고르게
    ventLen: 2,           // 벤츄레이터 한 개의 용마루 방향 길이(m). 폭(용마루 직각)은 1m
    ventPos: null,        // 사용자가 옮긴 벤츄레이터 중심 [{lat,lng}|null, ...] (전체 순번). null 이면 자동 자리
    ridgeOff: null,       // 동마다 용마루를 가운데에서 옮긴 거리(m). 원단: +북쪽, 인삼밭: +동쪽 (건물 축 기준). 지도에서 꾹 눌러 끈다
    ridgeExt: null,       // 동마다 용마루 선 양 끝을 줄인 길이 [시작쪽 m, 끝쪽 m] (지도에서 끝을 끌어 조절)
    ridgeOn: false,       // 인삼밭(동서지붕): 용마루를 켜면 용마루 띠(폭 0.6m) 자리의 모듈을 뺀다. 끄면 지금처럼 전부 배치
    attach: false,        // 부착 배치: 원단 북면도 지붕면에 붙여 깐다(북향). 인삼밭은 동서 양면에 붙여 깐다(줄은 용마루와 나란히)
    ventExtra: null,      // 용마루와 상관없이 손으로 놓은 벤츄레이터 중심 [{lat,lng}]
    type: 'slab',
    moduleWp: 645,        // W
    modL: 2.465,          // m, 긴 변
    modS: 1.134,          // m, 짧은 변
    colGap: 0.02,         // 줄 안에서 모듈 사이 틈
    margin: 0,            // 지붕 가장자리 이격. 도면 실측(A동 14m 폭에 12장)과 맞추려면 0 이어야 한다.
    align: 'auto',        // auto: 건물이 60° 안에서 돌아가 있으면 건물에 맞춤 / south: 정남 고정
    alignLimit: 60,       // °
    flipAxis: false,      // 줄 방향 뒤집기(남서향↔남동향). 건물맞춤이면 다른 축, 정남+방위각이면 방위각 부호 반전
    azimuth: 0,           // 방위각(°). 정남 0, 서쪽으로 돌리면 +, 동쪽으로 −. align:'south' 일 때만 쓴다 (토지·주차장)
    colBlock: 0,          // 줄 안에서 이 열수마다 통로를 둔다 (0 = 통로 없음). 토지 배치용
    blockGap: 0,          // 통로 폭 (m)
  };

  // ------------------------------------------------------------ 좌표 변환
  function toLocal(geo, o) {
    const k = Math.cos(o.lat * D2R);
    return geo.map(p => ({ x: (p.lng - o.lng) * M_PER_LNG * k, y: (p.lat - o.lat) * M_PER_LAT }));
  }
  function toGeo(pts, o) {
    const k = Math.cos(o.lat * D2R);
    return pts.map(p => ({ lat: o.lat + p.y / M_PER_LAT, lng: o.lng + p.x / (M_PER_LNG * k) }));
  }
  function rotate(p, deg) {
    const c = Math.cos(deg * D2R), s = Math.sin(deg * D2R);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
  }
  function centroid(geo) {
    let lat = 0, lng = 0;
    geo.forEach(p => { lat += p.lat; lng += p.lng; });
    return { lat: lat / geo.length, lng: lng / geo.length };
  }

  // ------------------------------------------------------------ 기하
  function area(poly) {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
    }
    return Math.abs(a) / 2;
  }
  function pointIn(poly, p) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  /** 선분 목록까지 최단거리. 합산 토지의 바깥 변(공유 경계 제외)에 이격을 재는 데 쓴다. */
  function distToSegs(segs, p) {
    let best = Infinity;
    segs.forEach(([a, b]) => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const L2 = dx * dx + dy * dy || 1e-12;
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
    });
    return best;
  }
  /**
   * 여러 필지를 합산할 때 "바깥" 변만 고른다. 변의 가운데가 다른 필지 안에 있거나 그 경계에 붙어 있으면(0.3m 안)
   * 두 필지가 맞댄 경계라서 뺀다 → 그 선은 이격도 안 재고 그리지도 않는다.
   */
  function exteriorEdges(polys) {
    const segs = [];
    polys.forEach((pg, k) => {
      for (let i = 0, j = pg.length - 1; i < pg.length; j = i++) {
        const a = pg[j], b = pg[i], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const shared = polys.some((o, k2) => k2 !== k && (pointIn(o, mid) || distToEdges(o, mid) < 0.3));
        if (!shared) segs.push([a, b]);
      }
    });
    return segs;
  }
  function distToEdges(poly, p) {
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const L2 = dx * dx + dy * dy || 1e-12;
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
      t = Math.max(0, Math.min(1, t));
      const ex = a.x + t * dx - p.x, ey = a.y + t * dy - p.y;
      best = Math.min(best, Math.hypot(ex, ey));
    }
    return best;
  }
  function bbox(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }
  // (-90, 90] 로 접는다. 줄 방향은 180° 대칭이라 이 범위면 충분하다.
  function fold(deg) {
    deg = ((deg % 180) + 180) % 180;
    return deg > 90 ? deg - 180 : deg;
  }

  /** 최소 면적 외접 사각형. 다각형 변 하나하나를 축으로 삼아 보고 제일 작은 걸 고른다. */
  function minRect(poly) {
    let best = null;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ang = Math.atan2(poly[i].y - poly[j].y, poly[i].x - poly[j].x) / D2R;
      const b = bbox(poly.map(p => rotate(p, -ang)));
      if (!best || b.w * b.h < best.area) best = { angle: fold(ang), w: b.w, h: b.h, area: b.w * b.h };
    }
    return best;
  }

  /**
   * 줄을 어느 방향으로 놓을지 정한다.
   * 건물 외접사각형의 두 축 중 동서에 더 가까운 축을 고르고, 그게 ±alignLimit 안이면
   * 건물에 맞춘다(남동/남서향). 넘어가면 정남(0°) 고정.
   */
  function pickRowAngle(rect, opt) {
    // 정남 고정 + 방위각: 앞면을 남쪽에서 시계방향(서쪽)으로 az 만큼 돌리면 줄은 수학각으로 −az 돈다
    // flipAxis: 사용자가 방향을 뒤집은 경우(형태 버튼 재탭). 정남+방위각이면 방위각 부호를, 건물맞춤이면 외접사각형의 다른 축을 쓴다(남서향↔남동향).
    if (opt.align === 'south') { const az = (opt.flipAxis ? -1 : 1) * (Number(opt.azimuth) || 0); return { angle: fold(-az), aligned: false, buildingAngle: fold(rect.angle), azimuth: az }; }
    const a1 = fold(rect.angle), a2 = fold(rect.angle + 90);
    const near = Math.abs(a1) <= Math.abs(a2) ? a1 : a2;
    const a = opt.flipAxis ? (near === a1 ? a2 : a1) : near;
    if (opt.flipAxis || Math.abs(a) <= opt.alignLimit) return { angle: a, aligned: true, buildingAngle: a };
    return { angle: 0, aligned: false, buildingAngle: a };
  }

  // ------------------------------------------------------------ 음영
  /**
   * 동지(적위 -23.44°) 기준 시각별 태양 고도·방위. 방위는 북에서 시계방향(°).
   * 태양시 기준이라 실제 시계와 30분 안팎 차이는 있지만 음영 검토 용도로는 충분하다.
   */
  function sunPositions(latDeg, hours) {
    const phi = latDeg * D2R, dec = -23.44 * D2R;
    return hours.map(h => {
      const H = (h - 12) * 15 * D2R;
      const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
      const alt = Math.asin(sinAlt);
      let cosAz = (Math.sin(dec) - sinAlt * Math.sin(phi)) / (Math.cos(alt) * Math.cos(phi));
      cosAz = Math.max(-1, Math.min(1, cosAz));
      let az = Math.acos(cosAz);
      if (H > 0) az = 2 * Math.PI - az;   // 오후는 서쪽
      return { hour: h, alt, az };
    });
  }

  /**
   * 장애물(더 높은 건물) 하나가 지붕면에 드리우는 그림자 조각들.
   * 외곽선을 그림자 방향으로 L = Δh / tan(고도) 만큼 민 다각형 + 변마다 쓸고 간 사각형.
   * 조각의 합집합이 그림자다. 오목한 외곽선도 이 방식이면 빠지는 데가 없다.
   */
  function shadowPieces(ring, dh, sun) {
    if (sun.alt <= 0.02) return [];           // 해가 떠 있지 않으면 없음
    const L = dh / Math.tan(sun.alt);
    if (L > 400) return [];                    // 지나치게 긴 그림자(새벽/저녁)는 무시
    const vx = -L * Math.sin(sun.az), vy = -L * Math.cos(sun.az);
    const moved = ring.map(p => ({ x: p.x + vx, y: p.y + vy }));
    const pieces = [ring, moved];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      pieces.push([ring[j], ring[i], moved[i], moved[j]]);
    }
    return pieces;
  }

  // ------------------------------------------------------------ 배치
  /**
   * @param geoPoly [{lat,lng}, ...]  지붕 외곽선 (3점 이상)
   * @param userOpt DEFAULTS + PRESETS[type] 를 덮어쓰는 값
   * @param shade   { on, floorH, hours:[9..15], obstacles:[{ ring:[{lat,lng}], dh:m }] } 음영 고려. 없으면 최대 배치.
   * @returns { modules, count, kw, areaM2, rowAngle, aligned, rows, pitch, shaded(음영으로 뺀 장수) }
   */
  function compute(geoPoly, userOpt, shade) {
    const type = (userOpt && userOpt.type) || DEFAULTS.type;
    const opt = Object.assign({}, DEFAULTS, PRESETS[type] || PRESETS.slab, userOpt || {}, { type });
    if (!geoPoly || geoPoly.length < 3) return empty(opt);

    const o = centroid(geoPoly);
    const local = toLocal(geoPoly, o);
    // 합산 배치: 붙어 있는 다른 필지(opt.extraRings)도 같은 격자로 깐다. 모듈은 어느 한 필지 안에 온전히 들어가야 한다.
    const extras = ((userOpt && userOpt.extraRings) || []).filter(r => r && r.length >= 3).map(r => toLocal(r, o));
    const rings = [local].concat(extras);
    const areaM2 = rings.reduce((a, r) => a + area(r), 0);

    // 음영 조각은 지붕과 같은 원점의 미터 평면에서 만든다(회전 전 좌표).
    //   shade.obstacles : 주변 더 높은 건물 { ring, dh } — 그림자만
    //   shade.blockers  : 이 지붕 위 물체(타워·기설치 태양광·지장물) { ring, dh } — 그 자리는 항상 빼고, 음영 고려면 그림자도
    const shadeOn = !!(shade && shade.on);
    const suns = sunPositions(o.lat, (shade && shade.hours) || [9, 10, 11, 12, 13, 14, 15]);
    let shadow = [];
    const blockRings = [];
    const addShadow = (ring, dh) => { if (shadeOn && dh > 0) suns.forEach(sp => { shadow = shadow.concat(shadowPieces(ring, dh, sp)); }); };
    ((shade && shade.obstacles) || []).forEach(ob => {
      if (!(ob.dh > 0) || !ob.ring || ob.ring.length < 3) return;
      addShadow(toLocal(ob.ring, o), ob.dh);
    });
    ((shade && shade.blockers) || []).forEach(ob => {
      if (!ob.ring || ob.ring.length < 3) return;
      const ring = toLocal(ob.ring, o);
      blockRings.push(ring);
      addShadow(ring, ob.dh || 0);
    });

    const rect = minRect([].concat(...rings));
    // 원단, 그리고 인삼밭 부착(동서 양면에 붙여 깔기 = 줄이 용마루와 나란히 → 다른 축을 쓴다)은 용마루 분할(ridgeMode)로 계산한다
    const ridgeMode = !!opt.ridge || (opt.type === 'ginseng' && !!opt.attach);
    const row = pickRowAngle(rect, (opt.type === 'ginseng' && opt.attach) ? Object.assign({}, opt, { flipAxis: !opt.flipAxis }) : opt);

    // 줄이 x축과 나란해지도록 돌린다. 계산이 끝나면 다시 되돌린다.
    const polys = rings.map(r => r.map(p => rotate(p, -row.angle)));
    const poly = polys[0];
    const b = bbox([].concat(...polys));
    const ext = polys.length > 1 ? exteriorEdges(polys) : null;   // 합산: 공유 경계를 뺀 바깥 변
    const inSite = p => polys.some(pg => pointIn(pg, p));

    // 용마루 자리: 동(spans)마다 가운데 + 사용자가 옮긴 거리(ridgeOff). 원단은 남북(y), 인삼밭은 동서(x). 지도에 선으로 그리고 꾹 눌러 옮긴다.
    const nSp = Math.max(1, Math.round(Number(opt.spans) || 1));
    const rOff = Array.isArray(opt.ridgeOff) ? opt.ridgeOff : [];
    const ridgePos = [], ridgeLines = [], ridgeExts = [];
    const rExt = Array.isArray(opt.ridgeExt) ? opt.ridgeExt : [];
    const extOf = (i, len) => { const e = rExt[i] || [0, 0]; let a = Math.max(0, Number(e[0]) || 0), c = Math.max(0, Number(e[1]) || 0); if (a + c > len - 1) { const s = (len - 1) / (a + c); a *= s; c *= s; } return [Math.round(a * 10) / 10, Math.round(c * 10) / 10]; };
    if (ridgeMode) {
      const D = (b.maxY - b.minY) / nSp;
      for (let i = 0; i < nSp; i++) { const y0 = b.minY + i * D, y = Math.min(y0 + D - 1, Math.max(y0 + 1, y0 + D / 2 + (Number(rOff[i]) || 0))); const [ea, eb] = extOf(i, b.maxX - b.minX); ridgePos.push(y - b.minY); ridgeLines.push([{ x: b.minX + ea, y }, { x: b.maxX - eb, y }]); ridgeExts.push([ea, eb]); }
    } else if (opt.type === 'ginseng' && opt.ridgeOn) {
      // 인삼밭(동서지붕)에서 용마루를 켠 경우: 용마루 띠(폭 0.6m) 자리의 모듈을 뺀다(선 길이만큼만)
      const W = (b.maxX - b.minX) / nSp;
      for (let i = 0; i < nSp; i++) { const x0 = b.minX + i * W, x = Math.min(x0 + W - 1, Math.max(x0 + 1, x0 + W / 2 + (Number(rOff[i]) || 0))); const [ea, eb] = extOf(i, b.maxY - b.minY); ridgePos.push(x - b.minX); ridgeLines.push([{ x, y: b.minY + ea }, { x, y: b.maxY - eb }]); ridgeExts.push([ea, eb]);
        const hw = Math.max(0.1, Number(opt.ridgeSetback) || 0.3), ring = [{ x: x - hw, y: b.minY + ea }, { x: x + hw, y: b.minY + ea }, { x: x + hw, y: b.maxY - eb }, { x: x - hw, y: b.maxY - eb }];
        blockRings.push(ring.map(p => rotate(p, row.angle))); }
    }
    const ridgeDir = ridgeMode ? rotate({ x: 0, y: 1 }, row.angle) : rotate({ x: 1, y: 0 }, row.angle);   // 용마루를 옮기는 방향(동·북 m 단위 벡터)
    const farEnough = p => ext ? distToSegs(ext, p) >= m - 1e-9 : distToEdges(poly, p) >= m - 1e-9;

    // 용마루 벤츄레이터/모니터 (있을 때만): 폭 1m 띠, 높이 opt.ventH(기본 1m). 자리 차단 + 그림자.
    //   원단(남북지붕): 경간마다 남북 깊이 가운데를 동서로 지나는 띠.  인삼밭(동서지붕): 동서 폭 가운데를 남북으로 지나는 띠.
    // 벤츄레이터는 낱개: 동마다 ventN 개를 용마루 위에 고르게(ventLen × 1m). 사용자가 옮긴 것(ventPos, 지리좌표)은 그 자리에.
    const vents = [], ventRefs = [];   // ventRefs: 벤츄레이터마다 {auto: 자동 순번} 또는 {extra: 손으로 놓은 순번}
    if (opt.vent) {
      const half = 0.5, vh = Number(opt.ventH) || 1, hl = Math.max(0.5, Number(opt.ventLen) || 2) / 2;
      const nv = Math.max(0, Math.min(50, Math.round(Number(opt.ventN) || 0)));   // 0 = 자동 벤츄레이터 없음(손으로 놓은 것만)
      const pos = Array.isArray(opt.ventPos) ? opt.ventPos : [];
      const centerOf = (idx, auto) => { const p = pos[idx]; return (p && isFinite(p.lat)) ? rotate(toLocal([p], o)[0], -row.angle) : auto; };
      // 벤츄레이터 사각형: 용마루 방향으로 ventLen, 직각으로 1m. ridgeMode 면 용마루가 x 방향, 인삼밭은 y 방향
      const vrect = c => ridgeMode ? [{ x: c.x - hl, y: c.y - half }, { x: c.x + hl, y: c.y - half }, { x: c.x + hl, y: c.y + half }, { x: c.x - hl, y: c.y + half }]
                                   : [{ x: c.x - half, y: c.y - hl }, { x: c.x + half, y: c.y - hl }, { x: c.x + half, y: c.y + hl }, { x: c.x - half, y: c.y + hl }];
      if (ridgeMode) {
        const n = nSp, W = b.maxX - b.minX;
        for (let i = 0; i < n; i++) for (let k = 0; k < nv; k++) {
          if (pos[i * nv + k] === 'off') continue;                     // Del 로 지운 자동 벤츄레이터
          const c = centerOf(i * nv + k, { x: b.minX + (k + 0.5) * W / nv, y: b.minY + ridgePos[i] });
          vents.push(vrect(c)); ventRefs.push({ auto: i * nv + k });
        }
      } else if (opt.type === 'ginseng') {
        // 동서지붕: 용마루가 남북으로 지난다. 여러 동이 동서로 붙어 있으면 동마다 가운데(용마루를 켰으면 그 자리).
        const n = nSp, W = (b.maxX - b.minX) / n, Dp = b.maxY - b.minY;
        for (let i = 0; i < n; i++) for (let k = 0; k < nv; k++) {
          if (pos[i * nv + k] === 'off') continue;
          const c = centerOf(i * nv + k, { x: b.minX + (ridgePos.length ? ridgePos[i] : i * W + W / 2), y: b.minY + (k + 0.5) * Dp / nv });
          vents.push(vrect(c)); ventRefs.push({ auto: i * nv + k });
        }
      }
      // 용마루와 상관없이 손으로 놓은 벤츄레이터
      (Array.isArray(opt.ventExtra) ? opt.ventExtra : []).forEach((p, j) => {
        if (!p || !isFinite(p.lat)) return;
        vents.push(vrect(rotate(toLocal([p], o)[0], -row.angle))); ventRefs.push({ extra: j });
      });
      vents.forEach(v => {
        const ring = v.map(p => rotate(p, row.angle));    // 회전 전 좌표 (그림자·차단과 같은 틀)
        blockRings.push(ring);
        addShadow(ring, vh);
      });
    }

    const w = opt.orient === 'portrait' ? opt.modS : opt.modL;   // 줄 방향 폭
    const dSlope = opt.orient === 'portrait' ? opt.modL : opt.modS;   // 모듈 경사길이
    const m = Math.max(0, opt.margin);
    const tiers = Math.max(1, opt.tiers | 0);
    const tilt = Math.max(0, Number(opt.tilt) || 0) * D2R;
    const cosT = Math.cos(tilt);
    const d = dSlope * cosT;                      // 평면에서 차지하는 깊이
    const tierGap = opt.tierGap * cosT;
    // 어레이(단 묶음) 전체 경사길이 → 뒤쪽 높이 → 후면입사각으로 이격
    const arraySlope = tiers * dSlope + (tiers - 1) * opt.tierGap;
    const arrayH = arraySlope * Math.sin(tilt);
    const shadeA = Math.max(1, Number(opt.shadeAngle) || 22) * D2R;
    let arrayGap = (opt.autoGap && tilt > 0) ? arrayH / Math.tan(shadeA) : opt.arrayGap;
    const flatGap = arrayGap;                     // 평지였을 때 이격 (경사 보정 전후를 보여주려고)
    // 지면 경사(토지): 앞면이 보는 쪽의 반대(뒤)로 땅이 오르면(남사면) 그림자가 짧아지고, 내리면(북사면) 길어진다.
    //   그림자 길이 ℓ = H / (tan α + tan β), β = 뒤쪽으로의 지면 기울기(오르면 +). 분모가 0.05 아래로 가면 20H 로 막는다.
    let backRise = 0;
    const gN = Number(opt.groundGradN) || 0, gE = Number(opt.groundGradE) || 0;
    if ((gN || gE) && opt.autoGap && tilt > 0) {
      const th = row.angle * D2R, fx = Math.sin(th), fy = -Math.cos(th);   // 앞면이 보는 방향
      backRise = -(gE * fx + gN * fy);
      const den = Math.tan(shadeA) + backRise;
      arrayGap = arrayH / Math.max(0.05, den);
    }

    // 1) 줄의 y 위치를 먼저 다 구한다. 그래야 남는 높이를 위아래로 반씩 나눠 가운데 맞출 수 있다.
    const ys = [], zAt = [];   // zAt: 줄마다 모듈면 높이 {zf 앞, zb 뒤}(처마 기준 m) — 원단만
    let yOff = 0, spans = 0, blocks = [];
    if (ridgeMode) {
      // 용마루 분할: 남→북으로 경간 N 개, 경간마다 [남측 면 | 용마루 | 북측 면].
      // 면 안은 모듈을 붙여 깔고(한 블록), 다음 블록은 앞 블록 꼭대기에서 그은 22° 선 밖에서 시작한다.
      spans = Math.max(1, Math.round(Number(opt.spans) || 1));
      const D = (b.maxY - b.minY) / spans;
      const eave = Math.max(0, Number(opt.eaveSetback) || 0);
      // 벤츄레이터 띠(폭 1m)가 있으면 용마루 이격을 띠 바깥 + 10cm 로 넓힌다 — 20cm 걸친다고 한 줄을 통째로 버리지 않게
      const rs = Math.max(0, Number(opt.ridgeSetback) || 0);   // 벤츄레이터는 낱개라 자리 겹치는 모듈만 빠진다(띠 전체 이격 안 함)
      const lift = Math.max(0, Number(opt.lift) || 0);
      const faces = [];
      for (let i = 0; i < spans; i++) {
        const y0 = b.minY + i * D, yr = b.minY + ridgePos[i];
        faces.push([y0 + eave, yr - rs], [yr + rs, y0 + D - eave]);
      }
      // 경간(동)마다: 남쪽 면은 처마 이격부터 용마루까지 꽉 채운다. 북쪽 면은 용마루 바로 뒤부터 끝까지, 남향을 유지한 채 남쪽 면과
      // 같은 면으로 이어 붙인다(= 뒤가 들린다, 사용자 단면도 2026-10-07). 북쪽 블록 꼭대기(처마 기준 높이 (yEnd−y0)·tanθ)가 다음 동 남쪽 면에
      // 드리우는 후면입사각 그림자만큼 다음 동 앞줄을 뒤로 민다: hTop − (y−yEnd)·tanα = (y−y0n)·tanθ 를 y 에 대해 푼다.
      // 높이(z)는 처마 기준 m. 남면 모듈면 = 지붕면 + 앞다리. 북면은 블록마다 지붕면 + 앞다리에서 시작해 남향(지붕 경사각)으로 올라가며,
      // 지붕 위 높이가 maxLiftH 에 닿으면 끊고, 앞 블록 꼭대기의 후면입사각 그림자를 벗어난 곳에서 다음 블록을 시작한다(2026-10-12 사용자 지시: 뒷단 4m 제한).
      const tS = Math.tan(tilt), tA = Math.tan(shadeA);
      const fl = opt.attach ? 0.12 : (Number(opt.frontLift) || 0), maxH = Math.max(fl + d * tS * 2 + 0.01, Number(opt.maxLiftH) || 4);
      const r2 = v => Math.round(v * 100) / 100, rel = y => r2(y - b.minY);
      let nextStart = -Infinity;
      for (let i = 0; i < spans; i++) {
        const y0 = b.minY + i * D, ridge = b.minY + ridgePos[i], y0n = y0 + D;
        // 용마루를 옮기면 남면은 경사각 그대로, 북면은 같은 처마 높이로 내려오는 다른 경사(tN)
        const ridgeH = (ridge - y0) * tS, tN = ridgeH / Math.max(0.5, y0n - ridge);
        const roofZ = y => y <= ridge ? (y - y0) * tS : (y0n - y) * tN;
        let y = Math.max(y0 + eave, nextStart), n = 0;
        const first = y;
        while (y + d <= ridge - rs + 1e-9) { ys.push(y); zAt.push({ zf: roofZ(y) + fl, zb: roofZ(y + d) + fl }); y += d + tierGap; n++; }
        if (n) blocks.push({ rows: n, from: rel(first), to: rel(ys[ys.length - 1] + d), gap: r2(Math.max(0, first - (y0 + eave))), zf: r2(roofZ(first) + fl), zb: r2(roofZ(ys[ys.length - 1] + d) + fl) });
        // 북면 블록들 (부착이면 지붕면에 붙여 한 블록 — 북향, 들어올리지 않음, 다음 동 그림자 없음)
        // 북면은 **북쪽 처마선(뒷선)에 맞춰 뒤에서부터 채운다**: 먼저 용마루 바로 뒤에서 시작해 들어가는 줄을 세고, 남는 길이만큼 전부 북쪽으로 민다.
        // 그러면 빈자리가 용마루 쪽에 생겨 벤츄레이터와 겹치지 않는다(2026-10-12 사용자 지시). 블록 높이는 시작점 기준 상대값이라 밀어도 같다.
        const northRows = yStart => {
          const rows = [], bks = []; let yS = yStart, top = null, yy, nn;
          if (opt.attach) {
            yy = yS; nn = 0; const f2 = yy;
            while (yy + d <= y0n - eave + 1e-9) { rows.push({ y: yy, zf: roofZ(yy) + fl, zb: roofZ(yy + d) + fl }); yy += d + tierGap; nn++; }
            if (nn) bks.push({ rows: nn, from: rel(f2), to: rel(rows[rows.length - 1].y + d), gap: 0, zf: r2(roofZ(f2) + fl), zb: r2(roofZ(rows[rows.length - 1].y + d) + fl), attached: true });
            return { rows, bks, top: null, end: nn ? rows[rows.length - 1].y + d : yStart };
          }
          while (yS + d <= y0n - eave + 1e-9) {
            const base = roofZ(yS) + fl;                                   // 블록 앞줄 모듈면 높이
            yy = yS; nn = 0;
            while (yy + d <= y0n - eave + 1e-9 && base + (yy + d - yS) * tS - roofZ(yy + d) <= maxH + 1e-9) { rows.push({ y: yy, zf: base + (yy - yS) * tS, zb: base + (yy + d - yS) * tS }); yy += d + tierGap; nn++; }
            if (!nn) break;
            const yEnd = rows[rows.length - 1].y + d, zTop = base + (yEnd - yS) * tS;
            bks.push({ rows: nn, from: rel(yS), to: rel(yEnd), gap: r2(Math.max(0, yS - (ridge + rs))), zf: r2(base), zb: r2(zTop), lifted: r2(zTop - roofZ(yEnd)) });
            top = { y: yEnd, z: zTop };
            if (tA - tN <= 1e-6) break;
            // 다음 블록 앞줄(지붕면 + 앞다리)이 앞 블록 꼭대기의 그림자선 zTop − (y − yEnd)·tanα 밖에 오도록
            yS = (zTop + yEnd * tA - y0n * tN - fl) / (tA - tN);
          }
          return { rows, bks, top, end: top ? top.y : yStart };
        };
        const trial = northRows(ridge + rs);
        const slack = Math.max(0, (y0n - eave) - trial.end);           // 뒷선까지 남는 길이 → 전부 북쪽으로
        const north = slack > 1e-6 ? northRows(ridge + rs + slack) : trial;
        north.rows.forEach(q => { ys.push(q.y); zAt.push({ zf: q.zf, zb: q.zb }); });
        north.bks.forEach(bk => blocks.push(bk));
        const lastTop = north.top;
        // 다음 동 앞줄: 이 동 마지막 블록 꼭대기(없으면 용마루) 그림자가 다음 동 남면(지붕면 + 앞다리)에 닿지 않는 곳부터
        const hTop = lastTop ? lastTop.z : roofZ(ridge), yE = lastTop ? lastTop.y : ridge;
        nextStart = tA + tS > 1e-6 ? (hTop - fl + yE * tA + y0n * tS) / (tA + tS) : y0n;
      }
    } else {
      for (let y = b.minY + m, i = 0; y + d <= b.maxY - m + 1e-9; i++) {
        ys.push(y);
        y += d + ((i + 1) % tiers === 0 ? arrayGap : tierGap);
      }
      const stackH = ys.length ? ys[ys.length - 1] + d - ys[0] : 0;
      yOff = ((b.maxY - m) - (b.minY + m) - stackH) / 2;
    }

    // 2) 줄 안에서도 남는 폭을 좌우 반씩 나눈다. 사각형 지붕이면 딱 가운데 정렬이 된다.
    const usableW = (b.maxX - m) - (b.minX + m);
    const colBlock = Math.max(0, opt.colBlock | 0), blockGap = Math.max(0, Number(opt.blockGap) || 0);
    // 통로(colBlock 열마다 blockGap)를 넣어 가며 들어가는 열의 x 오프셋을 전부 구한다
    const xs = [];
    let xCur = 0, aisles = 0;
    while (xCur + w <= usableW + 1e-9) {
      xs.push(xCur);
      xCur += w + opt.colGap;
      if (colBlock > 0 && blockGap > 0 && xs.length % colBlock === 0 && xCur + blockGap + w <= usableW + 1e-9) { xCur += blockGap - opt.colGap; aisles++; }
    }
    const nFit = xs.length;
    const laidW = nFit ? xs[nFit - 1] + w : 0;
    const xOff = (usableW - laidW) / 2;

    const modules = [];
    let rows = 0, shaded = 0;
    // 모듈 모서리·중심 중 하나라도 그림자 조각 안에 들면 음영. 조각은 회전 전 좌표라 되돌려서 본다.
    // 지붕 위 물체 자리에 걸치는 모듈은 음영 고려와 상관없이 뺀다.
    let blocked = 0;
    const onBlocker = c => {
      if (!blockRings.length) return false;
      const pts = c.concat([{ x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 }]).map(p => rotate(p, row.angle));
      return pts.some(p => blockRings.some(r => pointIn(r, p)));
    };
    const inShadow = c => {
      if (!shadow.length) return false;
      const pts = c.concat([{ x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 }]).map(p => rotate(p, row.angle));
      return pts.some(p => shadow.some(piece => pointIn(piece, p)));
    };
    const moduleZ = [];
    ys.forEach((y0, ri) => {
      const y = y0 + yOff;
      let placedInRow = 0;
      for (let k = 0; k < nFit; k++) {
        const x = b.minX + m + xOff + xs[k];
        const c = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }];
        const mid = { x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 };
        if (c.concat([mid]).every(p => inSite(p) && (m === 0 || farEnough(p)))) {
          if (onBlocker(c)) { blocked++; continue; }
          if (inShadow(c)) { shaded++; continue; }
          modules.push(c); moduleZ.push(zAt[ri] || null);
          placedInRow++;
        }
      }
      if (placedInRow) rows++;
    });

    const geoModules = modules.map(c => toGeo(c.map(p => rotate(p, row.angle)), o));
    const count = modules.length;
    return {
      modules: geoModules,
      count,
      shaded,
      blocked,
      vents: vents.map(v => toGeo(v.map(p => rotate(p, row.angle)), o)),
      kw: Math.round(count * opt.moduleWp) / 1000,
      areaM2: Math.round(areaM2 * 10) / 10,
      rowAngle: Math.round(row.angle * 10) / 10,
      buildingAngle: Math.round(row.buildingAngle * 10) / 10,
      aligned: row.aligned,
      azimuth: row.azimuth || 0,
      rows,
      pitch: Math.round((d * tiers + tierGap * (tiers - 1) + arrayGap) * 100) / 100,
      arrayGap: Math.round(arrayGap * 100) / 100,
      arrayH: Math.round(arrayH * 100) / 100,
      backRiseDeg: Math.round(Math.atan(backRise) * 180 / Math.PI * 10) / 10,   // 뒤쪽으로 지면이 오르는 각(+ 남사면 쪽)
      flatGap: Math.round(flatGap * 100) / 100,
      spans, blocks,
      moduleZ: ridgeMode ? moduleZ : null,   // 모듈마다 {zf, zb} 모듈면 높이(처마 기준) — 3D·측면도용
      ridgeMode, attach: !!opt.attach, ridgeExt: ridgeExts, ventRefs,
      ridgePos: ridgePos.map(v => Math.round(v * 100) / 100),   // 동마다 용마루 자리(원단: 남쪽 끝 0 기준 m, 인삼밭: 서쪽 끝 0 기준)
      ridges: ridgeLines.map(seg => toGeo(seg.map(p => rotate(p, row.angle)), o)),   // 지도에 그릴 용마루 선
      ridgeDir,                                                   // 용마루를 옮기는 방향(동 x, 북 y 단위벡터)
      aisles, colBlock, blockGap,
      // 합산 토지의 바깥 경계(공유 경계 제외) — 지도에 이것만 그려 한 덩어리로 보이게
      outline: ext ? ext.map(([a, b]) => toGeo([a, b].map(p => rotate(p, row.angle)), o)) : null,
      depthM: Math.round(b.h * 10) / 10,
      widthM: Math.round(b.w * 10) / 10,
      opt,
    };
  }

  function empty(opt) {
    return { modules: [], count: 0, shaded: 0, blocked: 0, vents: [], kw: 0, areaM2: 0, rowAngle: 0, buildingAngle: 0, aligned: false, rows: 0, pitch: 0, aisles: 0, opt };
  }

  /**
   * 건물 외곽선만 보고 지붕 형태를 추정한다.
   * 장축이 남북에 가까우면(동서에서 45° 넘게 돌아감) 동서지붕 → 인삼밭 2단, 아니면 남북지붕 → 원단.
   * 평슬라브는 외곽선으로 알 수 없어 사용자가 바꾼다.
   */
  function guessType(geoPoly) {
    if (!geoPoly || geoPoly.length < 3) return 'flush';
    const local = toLocal(geoPoly, centroid(geoPoly));
    const r = minRect(local);
    const longAxis = r.w >= r.h ? r.angle : fold(r.angle + 90);
    return Math.abs(longAxis) > 45 ? 'ginseng' : 'flush';
  }

  /** 점이 다각형 안에 있는지 (lat/lng). 필지 안 건물 고르기용. */
  function containsGeo(geoPoly, p) {
    const o = centroid(geoPoly);
    return pointIn(toLocal(geoPoly, o), toLocal([p], o)[0]);
  }

  /** 남북지붕 용마루(경간) 수 추정 — 줄 방향과 직각인 깊이 20m 당 하나. 위성사진으로는 알 수 없어 "추정" 으로만 쓴다. */
  function guessSpans(geoPoly, opt) {
    // 남북지붕: 남북 깊이 / 20m,  동서지붕: 동서 폭 / 20m  (동 하나 폭을 20m 안팎으로 본다)
    const type = (opt && opt.type) || 'flush';
    const r = compute(geoPoly, Object.assign({}, opt || {}, { type, spans: 1, vent: false }));
    return Math.max(1, Math.round((((type === 'ginseng' && !(opt && opt.attach)) ? r.widthM : r.depthM) || 0) / 20));
  }

  return { compute, guessType, guessSpans, containsGeo, sunPositions, PRESETS, DEFAULTS, centroid, toLocal, toGeo, area, minRect, rotate };
})();
