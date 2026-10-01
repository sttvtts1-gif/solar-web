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
    ginseng: { label: '동서지붕 · 인삼밭 2단', orient: 'portrait', tiers: 2, tierGap: 0.10, tilt: 15, shadeAngle: 22, autoGap: true, arrayGap: 3.0 },
    // 남북지붕(동서로 긴 건물) 또는 경사 지붕 면 전체를 덮는 원단(밀착) 배치. 지붕면에 붙으니 이격 없음.
    flush:   { label: '남북지붕 · 원단',       orient: 'portrait', tiers: 1, tierGap: 0.05, tilt: 0,  shadeAngle: 22, autoGap: false, arrayGap: 0.05 },
    // 평슬라브: 정남 경사거치, 줄마다 후면입사각 이격
    slab:    { label: '평슬라브 · 경사거치',   orient: 'portrait', tiers: 1, tierGap: 0.05, tilt: 15, shadeAngle: 22, autoGap: true, arrayGap: 2.5 },
  };

  const DEFAULTS = {
    type: 'slab',
    moduleWp: 645,        // W
    modL: 2.465,          // m, 긴 변
    modS: 1.134,          // m, 짧은 변
    colGap: 0.02,         // 줄 안에서 모듈 사이 틈
    margin: 0,            // 지붕 가장자리 이격. 도면 실측(A동 14m 폭에 12장)과 맞추려면 0 이어야 한다.
    align: 'auto',        // auto: 건물이 60° 안에서 돌아가 있으면 건물에 맞춤 / south: 정남 고정
    alignLimit: 60,       // °
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
    if (opt.align === 'south') return { angle: 0, aligned: false, buildingAngle: fold(rect.angle) };
    const a1 = fold(rect.angle), a2 = fold(rect.angle + 90);
    const a = Math.abs(a1) <= Math.abs(a2) ? a1 : a2;
    if (Math.abs(a) <= opt.alignLimit) return { angle: a, aligned: true, buildingAngle: a };
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
    const areaM2 = area(local);

    // 음영 조각은 지붕과 같은 원점의 미터 평면에서 만든다(회전 전 좌표).
    let shadow = [];
    if (shade && shade.on && shade.obstacles && shade.obstacles.length) {
      const suns = sunPositions(o.lat, shade.hours || [9, 10, 11, 12, 13, 14, 15]);
      shade.obstacles.forEach(ob => {
        if (!(ob.dh > 0) || !ob.ring || ob.ring.length < 3) return;
        const ring = toLocal(ob.ring, o);
        suns.forEach(s => { shadow = shadow.concat(shadowPieces(ring, ob.dh, s)); });
      });
    }

    const rect = minRect(local);
    const row = pickRowAngle(rect, opt);

    // 줄이 x축과 나란해지도록 돌린다. 계산이 끝나면 다시 되돌린다.
    const poly = local.map(p => rotate(p, -row.angle));
    const b = bbox(poly);

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
    const arrayGap = (opt.autoGap && tilt > 0) ? arrayH / Math.tan(shadeA) : opt.arrayGap;

    // 1) 줄의 y 위치를 먼저 다 구한다. 그래야 남는 높이를 위아래로 반씩 나눠 가운데 맞출 수 있다.
    const ys = [];
    for (let y = b.minY + m, i = 0; y + d <= b.maxY - m + 1e-9; i++) {
      ys.push(y);
      y += d + ((i + 1) % tiers === 0 ? arrayGap : tierGap);
    }
    const stackH = ys.length ? ys[ys.length - 1] + d - ys[0] : 0;
    const yOff = ((b.maxY - m) - (b.minY + m) - stackH) / 2;

    // 2) 줄 안에서도 남는 폭을 좌우 반씩 나눈다. 사각형 지붕이면 딱 가운데 정렬이 된다.
    const usableW = (b.maxX - m) - (b.minX + m);
    const nFit = Math.max(0, Math.floor((usableW + opt.colGap) / (w + opt.colGap) + 1e-9));
    const xOff = (usableW - (nFit * w + Math.max(0, nFit - 1) * opt.colGap)) / 2;

    const modules = [];
    let rows = 0, shaded = 0;
    // 모듈 모서리·중심 중 하나라도 그림자 조각 안에 들면 음영. 조각은 회전 전 좌표라 되돌려서 본다.
    const inShadow = c => {
      if (!shadow.length) return false;
      const pts = c.concat([{ x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 }]).map(p => rotate(p, row.angle));
      return pts.some(p => shadow.some(piece => pointIn(piece, p)));
    };
    ys.forEach(y0 => {
      const y = y0 + yOff;
      let placedInRow = 0;
      for (let k = 0; k < nFit; k++) {
        const x = b.minX + m + xOff + k * (w + opt.colGap);
        const c = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }];
        if (c.every(p => pointIn(poly, p) && (m === 0 || distToEdges(poly, p) >= m - 1e-9))) {
          if (inShadow(c)) { shaded++; continue; }
          modules.push(c);
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
      kw: Math.round(count * opt.moduleWp) / 1000,
      areaM2: Math.round(areaM2 * 10) / 10,
      rowAngle: Math.round(row.angle * 10) / 10,
      buildingAngle: Math.round(row.buildingAngle * 10) / 10,
      aligned: row.aligned,
      rows,
      pitch: Math.round((d * tiers + tierGap * (tiers - 1) + arrayGap) * 100) / 100,
      arrayGap: Math.round(arrayGap * 100) / 100,
      arrayH: Math.round(arrayH * 100) / 100,
      opt,
    };
  }

  function empty(opt) {
    return { modules: [], count: 0, shaded: 0, kw: 0, areaM2: 0, rowAngle: 0, buildingAngle: 0, aligned: false, rows: 0, pitch: 0, opt };
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

  return { compute, guessType, containsGeo, sunPositions, PRESETS, DEFAULTS, centroid, toLocal, area };
})();
