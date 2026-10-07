/*
 * 지붕 외곽선 위치 보정 — V-World 건물 외곽선(연속지적·도로명주소 건물)은 위성사진과 몇 m 어긋나는 일이 흔하다.
 *
 * 방법: 제안서 위성 배치도에 쓰는 V-World WMTS Satellite 타일(줌 19, 약 0.25m/px)을 받아 흑백 → 소벨 경계 세기 지도를 만들고,
 * 외곽선을 0.5m 간격으로 찍은 점들을 (dx, dy) 만큼 옮겨 봤을 때 경계 세기 합이 가장 큰 자리를 고른다(±12m, 0.5m 간격).
 * 회전은 안 본다(지적 오차는 거의 평행 이동). 카카오 위성사진과 V-World 사진도 서로 조금 다를 수 있어 앱 지도에서는 완전히
 * 안 맞을 수 있지만, 제안서 도면(V-World 사진)에는 맞는다.
 *
 * Align.snap(rings) → Promise<{ dLat, dLng, dxM, dyM, score, gain }>   (gain = 보정 후/전 경계 세기 비)
 */
const Align = (() => {
  const M_LAT = 110574, M_LNG = lat => 111320 * Math.cos(lat * Math.PI / 180);
  const Z = 19, RANGE = 12, STEP = 0.5;

  function loadTile(url) {
    return new Promise(res => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = url; setTimeout(() => res(null), 12000); });
  }
  const tileNW = (tx, ty, z) => { const n = Math.pow(2, z); return { lng: tx / n * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n))) * 180 / Math.PI }; };
  const txOf = (lng, z) => Math.floor((lng + 180) / 360 * Math.pow(2, z));
  const tyOf = (lat, z) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));

  async function snap(rings) {
    const key = (window.SOLAR_CONFIG || {}).VWORLD_KEY;
    if (!key) throw new Error('V-World 키가 없습니다');
    const pts = [].concat(...rings);
    const o = { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lng: pts.reduce((a, p) => a + p.lng, 0) / pts.length };
    const k = M_LNG(o.lat);
    const toXY = p => ({ x: (p.lng - o.lng) * k, y: (p.lat - o.lat) * M_LAT });
    const local = rings.map(r => r.map(toXY));
    const all = [].concat(...local);
    const pad = RANGE + 6;
    const minX = Math.min(...all.map(p => p.x)) - pad, maxX = Math.max(...all.map(p => p.x)) + pad, minY = Math.min(...all.map(p => p.y)) - pad, maxY = Math.max(...all.map(p => p.y)) + pad;
    const mpp = 156543.03 * Math.cos(o.lat * Math.PI / 180) / Math.pow(2, Z);
    const W = Math.ceil((maxX - minX) / mpp), H = Math.ceil((maxY - minY) / mpp);
    if (W * H > 4e6) throw new Error('범위가 너무 큽니다');
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const X = x => (x - minX) / mpp, Y = y => (maxY - y) / mpp;
    const nw = { lat: o.lat + maxY / M_LAT, lng: o.lng + minX / k }, se = { lat: o.lat + minY / M_LAT, lng: o.lng + maxX / k };
    const jobs = [];
    for (let tx = txOf(nw.lng, Z); tx <= txOf(se.lng, Z); tx++) for (let ty = tyOf(nw.lat, Z); ty <= tyOf(se.lat, Z); ty++)
      jobs.push(loadTile('https://api.vworld.kr/req/wmts/1.0.0/' + key + '/Satellite/' + Z + '/' + ty + '/' + tx + '.jpeg').then(im => ({ im, tx, ty })));
    let got = 0;
    (await Promise.all(jobs)).forEach(({ im, tx, ty }) => {
      if (!im) return; got++;
      const a = toXY(tileNW(tx, ty, Z)), b = toXY(tileNW(tx + 1, ty + 1, Z));
      g.drawImage(im, X(a.x), Y(a.y), X(b.x) - X(a.x) + 0.5, Y(b.y) - Y(a.y) + 0.5);
    });
    if (!got) throw new Error('위성 타일을 받지 못했습니다');
    // 흑백 + 소벨 경계 세기
    const img = g.getImageData(0, 0, W, H).data;
    const gray = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) gray[i] = 0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2];
    const mag = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = -gray[i - W - 1] - 2 * gray[i - 1] - gray[i + W - 1] + gray[i - W + 1] + 2 * gray[i + 1] + gray[i + W + 1];
      const gy = -gray[i - W - 1] - 2 * gray[i - W] - gray[i - W + 1] + gray[i + W - 1] + 2 * gray[i + W] + gray[i + W + 1];
      mag[i] = Math.sqrt(gx * gx + gy * gy);
    }
    // 외곽선 표본점 (0.5m 간격)
    const samples = [];
    local.forEach(r => { for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[j], b = r[i]; const L = Math.hypot(b.x - a.x, b.y - a.y); const n = Math.max(1, Math.round(L / 0.5)); for (let s = 0; s < n; s++) { const t = s / n; samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); } } });
    const score = (dx, dy) => { let s = 0; for (const p of samples) { const px = Math.round(X(p.x + dx)), py = Math.round(Y(p.y + dy)); if (px > 0 && py > 0 && px < W - 1 && py < H - 1) s += mag[py * W + px]; } return s; };
    const base = score(0, 0);
    let best = { dx: 0, dy: 0, s: base };
    for (let dx = -RANGE; dx <= RANGE; dx += STEP) for (let dy = -RANGE; dy <= RANGE; dy += STEP) { const s = score(dx, dy); if (s > best.s) best = { dx, dy, s }; }
    // 주변 미세 탐색 0.25m
    for (let dx = best.dx - 0.5; dx <= best.dx + 0.5; dx += 0.25) for (let dy = best.dy - 0.5; dy <= best.dy + 0.5; dy += 0.25) { const s = score(dx, dy); if (s > best.s) best = { dx, dy, s }; }
    return { dxM: best.dx, dyM: best.dy, dLat: best.dy / M_LAT, dLng: best.dx / k, score: best.s, gain: base > 0 ? best.s / base : 1 };
  }

  return { snap };
})();
