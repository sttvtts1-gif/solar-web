/*
 * V-World 2D 데이터 API 2.0 로 건물 외곽선(LT_C_SPBD, 도로명주소 건물)을 가져온다.
 *
 * 왜 두 경로인가
 *   V-World 는 CORS 헤더를 안 주고, 인증키 발급 때 등록한 도메인(Referer)만 통과시킨다.
 *   - APK 안에서는 Native.fetch(Java HttpURLConnection) 로 요청하고 Referer 를 등록 도메인으로 박는다.
 *   - PC 브라우저 미리보기에서는 JSONP(callback 파라미터) 로 우회한다. 이때는 localhost 가 등록돼 있어야 한다.
 *
 * 공개 함수
 *   VWorld.buildingsInBox(sw, ne)  → Promise<[{ id, name, ring:[{lat,lng}], areaHint }]>
 *   VWorld.buildingAt(lat, lng)    → Promise<건물 1개 또는 null>
 */
const VWorld = (() => {
  const API = 'https://api.vworld.kr/req/data';
  const cfg = () => window.SOLAR_CONFIG || {};

  // ------------------------------------------------------------ 전송
  function qs(params) {
    return Object.keys(params).filter(k => params[k] !== '').map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  }

  function baseParams(geomFilter, data) {
    return {
      service: 'data', version: '2.0', request: 'GetFeature',
      data: data || 'LT_C_SPBD',
      key: cfg().VWORLD_KEY || '',
      // domain 은 APK(네이티브)에서만 등록 도메인으로 보낸다. 웹(JSONP)에서 domain 을 붙이면 — localhost 든 등록 도메인이든 —
      // V-World 가 INCORRECT_KEY 로 거절한다(2026-10-07 확인). 빼면 Referer 만 보고 통과시킨다.
      domain: (window.Native && window.Native.fetch) ? (cfg().VWORLD_DOMAIN || '') : '',
      geomFilter,
      geometry: 'true', crs: 'EPSG:4326', format: 'json', size: '1000', page: '1',
    };
  }

  // 네이티브 → JSONP 순서. 네이티브가 있으면 CORS/Referer 문제를 전부 피한다.
  function request(params) {
    if (!params.key) return Promise.reject(new Error('V-World 인증키가 없습니다. config.js 의 VWORLD_KEY 를 채우세요.'));
    if (window.Native && typeof window.Native.fetch === 'function') return nativeFetch(API + '?' + qs(params));
    return jsonp(params);
  }

  let seq = 0;
  const pending = {};
  window.onNativeFetch = (reqId, ok, body) => {
    const p = pending[reqId];
    if (!p) return;
    delete pending[reqId];
    if (!ok) return p.reject(new Error(body || '네트워크 오류'));
    try { p.resolve(JSON.parse(body)); } catch (e) { p.reject(new Error('응답이 JSON 이 아닙니다: ' + String(body).slice(0, 120))); }
  };
  function nativeFetch(url) { return nativeFetchRef(url, cfg().VWORLD_REFERER || ''); }
  function nativeFetchRef(url, referer) {
    return new Promise((resolve, reject) => {
      const id = 'vw' + (++seq);
      pending[id] = { resolve, reject };
      window.Native.fetch(url, referer || '', id);
      setTimeout(() => { if (pending[id]) { delete pending[id]; reject(new Error('응답 시간 초과')); } }, 15000);
    });
  }

  // Native.fetch 응답 창구(onNativeFetch)는 하나뿐이라 여기 한 곳에서 reqId 로 나눠 준다.
  // kepco.js · bld.js 도 이걸 쓴다 — 각자 onNativeFetch 를 갈아끼우면 먼저 끝난 쪽이 다른 쪽 콜백을 떼어 버린다.
  window.NativeHttp = { get: (url, referer) => nativeFetchRef(url, referer) };

  function jsonp(params) {
    return new Promise((resolve, reject) => {
      const cb = '__vw_cb' + (++seq);
      const s = document.createElement('script');
      const done = () => { delete window[cb]; s.remove(); clearTimeout(t); };
      window[cb] = data => { done(); resolve(data); };
      s.onerror = () => { done(); reject(new Error('V-World 호출 실패 (키·도메인 등록 확인)')); };
      const t = setTimeout(() => { done(); reject(new Error('V-World 응답 시간 초과')); }, 15000);
      s.src = API + '?' + qs(Object.assign({}, params, { callback: cb }));
      document.head.appendChild(s);
    });
  }

  // ------------------------------------------------------------ 응답 해석
  /**
   * 응답의 GeoJSON 을 { ring:[{lat,lng}] } 목록으로 바꾼다.
   * MultiPolygon 이면 제일 큰 조각만, 구멍(안쪽 링)은 버린다 — 지붕 외곽선만 필요하다.
   */
  function parse(res) {
    const r = res && res.response;
    if (!r) throw new Error('응답 형식을 알 수 없습니다.');
    if (r.status === 'NOT_FOUND') return [];
    if (r.status !== 'OK') {
      const e = r.error || {};
      throw new Error('V-World 오류: ' + (e.text || e.code || r.status));
    }
    const feats = (((r.result || {}).featureCollection || {}).features) || [];
    const out = [];
    feats.forEach((f, i) => {
      const g = f.geometry || {};
      let rings = [];
      if (g.type === 'Polygon') rings = [g.coordinates[0]];
      else if (g.type === 'MultiPolygon') rings = g.coordinates.map(p => p[0]);
      if (!rings.length) return;
      // 가장 큰 조각
      let best = null, bestA = -1;
      rings.forEach(rg => { const a = ringArea(rg); if (a > bestA) { bestA = a; best = rg; } });
      const ring = best.map(c => ({ lat: c[1], lng: c[0] }));
      // GeoJSON 은 첫점=끝점이라 닫는 점을 뺀다.
      if (ring.length > 1 && ring[0].lat === ring[ring.length - 1].lat && ring[0].lng === ring[ring.length - 1].lng) ring.pop();
      if (ring.length < 3) return;
      const p = f.properties || {};
      out.push({
        id: f.id || p.bd_mgt_sn || p.pnu || ('b' + i),
        name: p.buld_nm || p.buld_nm_dc || p.addr || p.jibun || '',
        ring,
        props: p,
      });
    });
    return out;
  }
  function ringArea(rg) {
    let a = 0;
    for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) a += (rg[j][0] + rg[i][0]) * (rg[j][1] - rg[i][1]);
    return Math.abs(a) / 2;
  }

  // ------------------------------------------------------------ 공개
  function buildingsInBox(sw, ne) {
    const f = 'BOX(' + [sw.lng, sw.lat, ne.lng, ne.lat].map(v => v.toFixed(6)).join(',') + ')';
    return request(baseParams(f)).then(parse);
  }
  function buildingAt(lat, lng) {
    const f = 'POINT(' + lng.toFixed(7) + ' ' + lat.toFixed(7) + ')';
    return request(baseParams(f)).then(parse).then(list => list[0] || null);
  }
  /**
   * 그 지점이 속한 필지(연속지적도 LP_PA_CBND_BUBUN). 지번 검색 → 필지 → 필지 안 건물 자동 셋팅에 쓴다.
   * 이 레이어가 발급 키에서 허용되는지는 실제 호출로 확인해야 한다 — 실패하면 null 을 돌려주고 건물 1개로 대체한다.
   */
  function parcelAt(lat, lng) {
    const f = 'POINT(' + lng.toFixed(7) + ' ' + lat.toFixed(7) + ')';
    return request(baseParams(f, 'LP_PA_CBND_BUBUN')).then(parse).then(list => list[0] || null).catch(() => null);
  }

  /** 상자 안 필지들 (한전 인근 번지 찾기용). pnu = 법정동10 + 산1 + 본번4 + 부번4 */
  function parcelsInBox(sw, ne) {
    const f = 'BOX(' + [sw.lng, sw.lat, ne.lng, ne.lat].map(v => v.toFixed(6)).join(',') + ')';
    return request(Object.assign(baseParams(f, 'LP_PA_CBND_BUBUN'), { size: '1000' })).then(parse).catch(() => []);
  }

  return { buildingsInBox, buildingAt, parcelAt, parcelsInBox };
})();
