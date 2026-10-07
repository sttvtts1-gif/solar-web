/*
 * 지형 경사 — 표고 점을 받아 평면을 맞추고 평균 경사각·사면 방향을 낸다.
 *
 * 표고는 Open-Meteo Elevation API(https://open-meteo.com, 무료·키 없음·CORS 허용, Copernicus DEM 90m).
 *   한 번에 좌표 100개까지. 필지 외접상자에 6×6 격자를 깔아 필지 안 점(최소 4개)만 쓴다.
 *   해상도가 90m 라 작은 필지(50m 미만)는 주변 지형의 평균 경사로 봐야 한다 — 안내에 적어 둔다.
 *
 * 결과 { slopeDeg, aspect(내리막 방향, 북 0° 시계방향), name('남사면' 등), gradE, gradN(동·북으로 1m 갈 때 오르는 높이), zMin, zMax, n }
 *   gradN > 0 = 북쪽이 높다 = 남사면. 배치(layout.js)는 이 기울기로 어레이 앞뒤 이격을 보정한다.
 */
const Terrain = (() => {
  const API = 'https://api.open-meteo.com/v1/elevation';
  const M_LAT = 110574, M_LNG = lat => 111320 * Math.cos(lat * Math.PI / 180);
  const cache = {};

  function get(url) {
    if (window.Native && typeof window.Native.fetch === 'function' && window.NativeHttp) return window.NativeHttp.get(url, '');
    return fetch(url).then(r => { if (!r.ok) throw new Error('표고 API ' + r.status); return r.json(); });
  }

  /** 필지(여러 링) 안 표본점. 격자 6×6 + 각 링의 중심. */
  function samples(rings) {
    const all = [].concat(...rings);
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    all.forEach(p => { minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat); minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng); });
    const N = 6, pts = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const p = { lat: minLat + (maxLat - minLat) * (i + 0.5) / N, lng: minLng + (maxLng - minLng) * (j + 0.5) / N };
      if (rings.some(r => Layout.containsGeo(r, p))) pts.push(p);
    }
    rings.forEach(r => pts.push(Layout.centroid(r)));
    if (pts.length < 4) {   // 아주 작은 필지: 상자 모서리까지 써서 주변 경사로 본다
      pts.push({ lat: minLat, lng: minLng }, { lat: minLat, lng: maxLng }, { lat: maxLat, lng: minLng }, { lat: maxLat, lng: maxLng });
    }
    return pts.slice(0, 100);
  }

  function nameOf(aspect, slope) {
    if (slope < 1) return '평지';
    const names = ['북사면', '북동사면', '동사면', '남동사면', '남사면', '남서사면', '서사면', '북서사면'];
    return names[Math.round(((aspect % 360) + 360) % 360 / 45) % 8];
  }

  /** 최소제곱 평면 z = a·x + b·y + c (x 동쪽 m, y 북쪽 m). */
  function fit(pts, z, o) {
    const k = M_LNG(o.lat);
    let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, n = pts.length;
    pts.forEach((p, i) => {
      const x = (p.lng - o.lng) * k, y = (p.lat - o.lat) * M_LAT, w = z[i];
      sx += x; sy += y; sz += w; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * w; syz += y * w;
    });
    // 정규방정식 3×3 (크래머)
    const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], B = [sxz, syz, sz];
    const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(A);
    if (Math.abs(D) < 1e-9) return { a: 0, b: 0 };
    const col = (m, c, v) => m.map((row, i) => row.map((x, j) => (j === c ? v[i] : x)));
    return { a: det(col(A, 0, B)) / D, b: det(col(A, 1, B)) / D };
  }

  /**
   * @param rings [[{lat,lng}], ...]  (합산 토지는 여러 링)
   * @returns Promise<{ slopeDeg, aspect, name, gradE, gradN, zMin, zMax, n }>
   */
  function plane(rings) {
    rings = (rings || []).filter(r => r && r.length >= 3);
    if (!rings.length) return Promise.reject(new Error('링 없음'));
    const key = rings.map(r => r.map(p => p.lat.toFixed(5) + ',' + p.lng.toFixed(5)).join(';')).join('|');
    if (cache[key]) return cache[key];
    const pts = samples(rings);
    const url = API + '?latitude=' + pts.map(p => p.lat.toFixed(6)).join(',') + '&longitude=' + pts.map(p => p.lng.toFixed(6)).join(',');
    cache[key] = get(url).then(res => {
      const z = res && res.elevation;
      if (!z || z.length !== pts.length) throw new Error('표고 응답 형식');
      const o = Layout.centroid(rings[0]);
      const { a, b } = fit(pts, z, o);
      const slopeDeg = Math.atan(Math.hypot(a, b)) * 180 / Math.PI;
      const aspect = (Math.atan2(-a, -b) * 180 / Math.PI + 360) % 360;   // 내리막 방향
      return { slopeDeg: Math.round(slopeDeg * 10) / 10, aspect: Math.round(aspect), name: nameOf(aspect, slopeDeg), gradE: a, gradN: b,
        zMin: Math.min.apply(null, z), zMax: Math.max.apply(null, z), n: pts.length };
    }).catch(e => { delete cache[key]; throw e; });
    return cache[key];
  }

  return { plane };
})();
