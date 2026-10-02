/*
 * 한전 분산전원연계정보 — 전력데이터개방포털 Open API (bigdata.kepco.co.kr/openapi/v1/dispersedGeneration.do).
 * 지번이 속한 읍면동의 변전소·주변압기·배전선로 용량/여유를 보여준다 (입지 1차 검토용).
 *
 * 확인된 사실 (2026-10-02 실호출)
 *   - 코드는 행정구역코드가 아니라 **법정동코드** 다: metroCd = 법정동코드 앞 2자리, cityCd = 3~5자리 (김해 안동 → 48 / 250).
 *   - 번지(addrJibun) 자료는 이미 발전소가 연결된 번지에만 있다(안동 161-15 없음, 161-1·161-10·161-11 있음, 이웃끼리 DL 이 다르기도 함).
 *     읍면동(addrLidong)까지만 주면 그 동을 지나는 선로 전부(안동 18개)가 온다.
 *   - CORS 헤더도 JSONP 도 없다 → 브라우저에서 직접 못 부른다. APK 는 Native.fetch, 웹은 Apps Script 중계(JSONP).
 *   - 응답 필드(개방포털 레퍼런스): vol1/vol2/vol3 = 변전소/변압기/DL **여유용량**, substPwr/mtrPwr/dlPwr = **누적 연계용량**,
 *     jsSubstPwr/jsMtrPwr/jsDlPwr = 설비용량. 단위는 문서에 없다(kW 로 보이나 미확인).
 */
const Kepco = (() => {
  const API = 'https://bigdata.kepco.co.kr/openapi/v1/dispersedGeneration.do';
  const cfg = () => window.SOLAR_CONFIG || {};
  const hasNative = () => !!(window.Native && typeof window.Native.fetch === 'function');
  // APK: 키로 직접.  웹: Apps Script 중계(KEPCO_PROXY, server/kepco_proxy.gs) — 키는 중계 쪽에만 있다.
  const available = () => (hasNative() && !!cfg().KEPCO_KEY) || !!cfg().KEPCO_PROXY;

  function proxyGet(params) {
    return new Promise((resolve, reject) => {
      const cb = '__kp' + (++seq) + '_' + Date.now();
      const sc = document.createElement('script');
      const done = () => { delete window[cb]; sc.remove(); clearTimeout(t); };
      window[cb] = d => { done(); resolve(d); };
      sc.onerror = () => { done(); reject(new Error('한전 중계 서버에 닿지 못했습니다')); };
      const t = setTimeout(() => { done(); reject(new Error('한전 중계 응답 시간 초과')); }, 20000);
      const q = Object.assign({ path: 'dispersedGeneration', callback: cb }, params);
      sc.src = cfg().KEPCO_PROXY + '?' + Object.keys(q).map(k => k + '=' + encodeURIComponent(q[k])).join('&');
      document.head.appendChild(sc);
    });
  }

  let seq = 0;
  const nativeGet = url => window.NativeHttp.get(url, '');


  /**
   * @param bcode  법정동코드 10자리 (카카오 coord2RegionCode region_type 'B' 의 code)
   * @param dong   읍면동 이름 (region_3depth_name)
   * @param jibun  '161-15' 같은 번지. 먼저 번지로 시도하고 404 면 동 단위로 다시.
   */
  /**
   * 선로 찾기 3단계 (2026-10-02 실측으로 정함)
   *   1) 그 번지 — 자료가 있으면 보통 1건(변전소·MTR·DL 하나). 단, 발전소가 이미 연결된 번지에만 자료가 있다.
   *   2) 같은 본번의 가까운 부번(±1, ±2 …) — 가장 가까운 번지부터. 이웃끼리도 DL 이 다를 수 있어 "인근 기준" 으로 표시.
   *   3) 읍면동 전체 — 최후 수단.
   * @returns { level: '번지'|'인근'|'읍면동', basis: ['161-11', …], rows: [...] }
   */
  async function lines(bcode, dong, jibun, onProgress, nearLots) {
    if (!available()) throw new Error(hasNative() ? '한전 API 키가 없습니다.' : '웹에서는 한전 중계 설치가 필요합니다 (server/한전프록시_설치안내.md).');
    const base = { metroCd: bcode.slice(0, 2), cityCd: bcode.slice(2, 5), addrLidong: dong };
    const call = hasNative() && cfg().KEPCO_KEY
      ? p => nativeGet(API + '?' + Object.keys(p).map(k => k + '=' + encodeURIComponent(p[k])).join('&') + '&apiKey=' + cfg().KEPCO_KEY + '&returnType=json')
      : p => proxyGet(p);
    const rowsOf = res => (res && res.data && res.data.length) ? res.data.map(toRow) : [];
    const atLot = lot => call(Object.assign({ addrJibun: lot }, base)).then(rowsOf).catch(() => []);

    if (jibun) {
      // 1) 그 번지
      const exact = await atLot(jibun);
      if (exact.length) return { level: '번지', basis: [jibun], rows: exact };

      // 2) 가까운 부번. 본번만 있는 번지(161)면 161-1, 161-2 … 를 본다.
      //    지도에서 실제로 둘러싼 필지(nearLots, 가까운 순)를 먼저 보고, 그다음 번호가 가까운 부번.
      const [bun, ji] = String(jibun).split('-').map(Number);
      const cand = [];
      (nearLots || []).slice(0, 24).forEach(l => { if (l !== jibun && cand.indexOf(l) < 0) cand.push(l); });
      if (ji) cand.push(String(bun));
      for (let d = 1; d <= 12; d++) {
        const lo = (ji || 0) - d, hi = (ji || 0) + d;
        if (lo > 0 && cand.indexOf(bun + '-' + lo) < 0) cand.push(bun + '-' + lo);
        if (cand.indexOf(bun + '-' + hi) < 0) cand.push(bun + '-' + hi);
      }
      const hits = [];
      for (let i = 0; i < cand.length && !hits.length; i += 6) {      // 6개씩 동시에, 가까운 순. 처음 찾은 묶음에서 멈춘다
        if (onProgress) onProgress('인근 번지 확인 중… (' + cand[i] + '~)');
        const part = cand.slice(i, i + 6);
        const got = await Promise.all(part.map(atLot));
        part.forEach((lot, k) => { if (got[k].length) hits.push({ lot, rows: got[k] }); });
      }
      if (hits.length) {
        // 가장 가까운 번지의 선로를 위에, 다른 인근 번지에서만 나온 선로는 아래에 (중복 제거)
        const seen = {}, rows = [];
        hits.forEach(h => h.rows.forEach(r => {
          const k = r.substCd + '/' + r.mtr + '/' + r.dlCd;
          if (seen[k]) { seen[k].lots.push(h.lot); return; }
          r.lots = [h.lot]; seen[k] = r; rows.push(r);
        }));
        return { level: '인근', basis: hits.map(h => h.lot), rows };
      }
    }

    // 3) 읍면동 전체
    let res = await call(base);
    if (!rowsOf(res).length) { await new Promise(r => setTimeout(r, 800)); res = await call(base); }   // 중계가 처음 깨어날 때 빈 응답이 한 번 온 적이 있다
    if (res && res.errCd && res.errCd !== '404') throw new Error('한전 API 오류 ' + res.errCd + ' ' + (res.errMsg || ''));
    // 같은 변전소·MTR·DL 이 두 번 오는 경우가 있어 하나로 합친다
    const seen = {};
    const rows = rowsOf(res).filter(r => { const k = r.substCd + '/' + r.mtr + '/' + r.dlCd; if (seen[k]) return false; seen[k] = 1; return true; });
    return { level: '읍면동', basis: [], rows };
  }

  function toRow(r) {
    return {
      subst: r.substNm, substCd: r.substCd, mtr: r.mtrNo, dl: r.dlNm, dlCd: r.dlCd,
      // 여유용량 / 누적 연계용량 / 설비용량
      substFree: num(r.vol1), mtrFree: num(r.vol2), dlFree: num(r.vol3),
      substUsed: num(r.substPwr), mtrUsed: num(r.mtrPwr), dlUsed: num(r.dlPwr),
      substCap: num(r.jsSubstPwr), mtrCap: num(r.jsMtrPwr), dlCap: num(r.jsDlPwr),
    };
  }
  const num = v => (v === null || v === undefined || v === '') ? null : Number(v);

  return { lines, available };
})();
