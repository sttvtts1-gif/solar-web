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
    // 남북지붕 원단: 용마루에서 끊어 면마다 남향 블록 하나, 블록 사이는 후면입사각 22° (사용자 도면 2026-10-02).
    //   처마·골 이격 500, 용마루 이격 300, 경사 10°. 북측 블록을 들어올리면(lift) 그만큼 이격이 준다.
    flush:   { label: '남북지붕 · 원단',       orient: 'portrait', tiers: 1, tierGap: 0.05, tilt: 10, shadeAngle: 22, autoGap: true, arrayGap: 0.05,
               ridge: true, spans: 1, eaveSetback: 0.5, ridgeSetback: 0.3, lift: 0 },
    // 평슬라브: 정남 경사거치, 줄마다 후면입사각 이격
    slab:    { label: '평슬라브 · 경사거치',   orient: 'portrait', tiers: 1, tierGap: 0.05, tilt: 15, shadeAngle: 22, autoGap: true, arrayGap: 2.5 },
    // 토지(노지): 필지 외곽선 안에 정남 2단 거치. 앞뒤는 후면입사각 22° 이격, 좌우는 30열마다 2m 통로(점검·장비 진입). 경계 이격 3m(펜스).
    //   필지는 건물처럼 축이 뚜렷하지 않아 줄 방향은 기본 정남. 경사각은 2단 기준 15°(설정에서 바꿀 수 있음).
    ground:  { label: '토지 · 노지 2단',       orient: 'portrait', tiers: 2, tierGap: 0.10, tilt: 15, shadeAngle: 22, autoGap: true, arrayGap: 3.0,
               colBlock: 30, blockGap: 2.0, margin: 3.0, align: 'south' },   // 지적경계 3m 이격 = 펜스 돌릴 공간(사용자 지정)
  };

  const DEFAULTS = {
    ridge: false, spans: 1, eaveSetback: 0.5, ridgeSetback: 0.3, lift: 0,   // 원단(용마루 분할) 전용, 다른 형태는 안 씀
    type: 'slab',
    moduleWp: 645,        // W
    modL: 2.465,          // m, 긴 변
    modS: 1.134,          // m, 짧은 변
    colGap: 0.02,         // 줄 안에서 모듈 사이 틈
    margin: 0,            // 지붕 가장자리 이격. 도면 실측(A동 14m 폭에 12장)과 맞추려면 0 이어야 한다.
    align: 'auto',        // auto: 건물이 60° 안에서 돌아가 있으면 건물에 맞춤 / south: 정남 고정
    alignLimit: 60,       // °
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
    const row = pickRowAngle(rect, opt);

    // 줄이 x축과 나란해지도록 돌린다. 계산이 끝나면 다시 되돌린다.
    const polys = rings.map(r => r.map(p => rotate(p, -row.angle)));
    const poly = polys[0];
    const b = bbox([].concat(...polys));
    const ext = polys.length > 1 ? exteriorEdges(polys) : null;   // 합산: 공유 경계를 뺀 바깥 변
    const inSite = p => polys.some(pg => pointIn(pg, p));
    const farEnough = p => ext ? distToSegs(ext, p) >= m - 1e-9 : distToEdges(poly, p) >= m - 1e-9;

    // 용마루 벤츄레이터/모니터 (있을 때만): 폭 1m 띠, 높이 opt.ventH(기본 1m). 자리 차단 + 그림자.
    //   원단(남북지붕): 경간마다 남북 깊이 가운데를 동서로 지나는 띠.  인삼밭(동서지붕): 동서 폭 가운데를 남북으로 지나는 띠.
    const vents = [];
    if (opt.vent) {
      const half = 0.5, vh = Number(opt.ventH) || 1;
      if (opt.ridge) {
        const n = Math.max(1, Math.round(Number(opt.spans) || 1)), D = (b.maxY - b.minY) / n;
        for (let i = 0; i < n; i++) {
          const y = b.minY + i * D + D / 2;
          vents.push([{ x: b.minX, y: y - half }, { x: b.maxX, y: y - half }, { x: b.maxX, y: y + half }, { x: b.minX, y: y + half }]);
        }
      } else if (opt.type === 'ginseng') {
        // 동서지붕: 용마루가 남북으로 지난다. 여러 동이 동서로 붙어 있으면 동마다 가운데에 하나씩.
        const n = Math.max(1, Math.round(Number(opt.spans) || 1)), W = (b.maxX - b.minX) / n;
        for (let i = 0; i < n; i++) {
          const x = b.minX + i * W + W / 2;
          vents.push([{ x: x - half, y: b.minY }, { x: x + half, y: b.minY }, { x: x + half, y: b.maxY }, { x: x - half, y: b.maxY }]);
        }
      }
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
    const arrayGap = (opt.autoGap && tilt > 0) ? arrayH / Math.tan(shadeA) : opt.arrayGap;

    // 1) 줄의 y 위치를 먼저 다 구한다. 그래야 남는 높이를 위아래로 반씩 나눠 가운데 맞출 수 있다.
    const ys = [];
    let yOff = 0, spans = 0, blocks = [];
    if (opt.ridge) {
      // 용마루 분할: 남→북으로 경간 N 개, 경간마다 [남측 면 | 용마루 | 북측 면].
      // 면 안은 모듈을 붙여 깔고(한 블록), 다음 블록은 앞 블록 꼭대기에서 그은 22° 선 밖에서 시작한다.
      spans = Math.max(1, Math.round(Number(opt.spans) || 1));
      const D = (b.maxY - b.minY) / spans;
      const eave = Math.max(0, Number(opt.eaveSetback) || 0);
      // 벤츄레이터 띠(폭 1m)가 있으면 용마루 이격을 띠 바깥 + 10cm 로 넓힌다 — 20cm 걸친다고 한 줄을 통째로 버리지 않게
      const rs = Math.max(0, Number(opt.ridgeSetback) || 0, opt.vent ? 0.6 : 0);
      const lift = Math.max(0, Number(opt.lift) || 0);
      const faces = [];
      for (let i = 0; i < spans; i++) {
        const y0 = b.minY + i * D;
        faces.push([y0 + eave, y0 + D / 2 - rs], [y0 + D / 2 + rs, y0 + D - eave]);
      }
      let cursor = -Infinity, prevH = 0;
      faces.forEach(([fs, fe]) => {
        const gap = prevH > 0 ? Math.max(0, prevH - lift) / Math.tan(shadeA) : 0;
        let y = Math.max(fs, cursor + gap), n = 0;
        const first = y;
        while (y + d <= fe + 1e-9) { ys.push(y); y += d + tierGap; n++; }
        if (n) {
          const slope = n * dSlope + (n - 1) * opt.tierGap;
          prevH = slope * Math.sin(tilt);
          cursor = ys[ys.length - 1] + d;
          blocks.push({ rows: n, from: first, to: cursor, gap: Math.round(gap * 100) / 100 });
        }
      });
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
    ys.forEach(y0 => {
      const y = y0 + yOff;
      let placedInRow = 0;
      for (let k = 0; k < nFit; k++) {
        const x = b.minX + m + xOff + xs[k];
        const c = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }];
        const mid = { x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 };
        if (c.concat([mid]).every(p => inSite(p) && (m === 0 || farEnough(p)))) {
          if (onBlocker(c)) { blocked++; continue; }
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
      blocked,
      vents: vents.map(v => toGeo(v.map(p => rotate(p, row.angle)), o)),
      kw: Math.round(count * opt.moduleWp) / 1000,
      areaM2: Math.round(areaM2 * 10) / 10,
      rowAngle: Math.round(row.angle * 10) / 10,
      buildingAngle: Math.round(row.buildingAngle * 10) / 10,
      aligned: row.aligned,
      rows,
      pitch: Math.round((d * tiers + tierGap * (tiers - 1) + arrayGap) * 100) / 100,
      arrayGap: Math.round(arrayGap * 100) / 100,
      arrayH: Math.round(arrayH * 100) / 100,
      spans, blocks,
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
    return Math.max(1, Math.round(((type === 'ginseng' ? r.widthM : r.depthM) || 0) / 20));
  }

  return { compute, guessType, guessSpans, containsGeo, sunPositions, PRESETS, DEFAULTS, centroid, toLocal, area };
})();
