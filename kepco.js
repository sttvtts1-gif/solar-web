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

  function proxyGet(params, timeoutMs) {
    return new Promise((resolve, reject) => {
      const cb = '__kp' + (++seq) + '_' + Date.now();
      const sc = document.createElement('script');
      const done = () => { delete window[cb]; sc.remove(); clearTimeout(t); };
      window[cb] = d => { done(); resolve(d); };
      sc.onerror = () => { done(); reject(new Error('한전 중계 서버에 닿지 못했습니다')); };
      const t = setTimeout(() => { done(); reject(new Error('한전 중계 응답 시간 초과')); }, timeoutMs || 20000);
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
    // 한전 API 는 요청이 겹치면 빈 응답(HTTP 200, 내용 없음)을 준다(2026-10-02 실측: 2개만 겹쳐도 섞임).
    // 그래서 하나씩 보내고, 빈 응답·해석 실패면 잠깐 쉬었다가 두 번까지 다시 묻는다. 404 는 "자료 없음" 으로 확정.
    // 번지 결과는 기기에 30일 기억해 같은 동네를 다시 볼 때는 묻지 않는다.
    const cacheKey = lot => bcode + '|' + lot;
    const cache = (() => { try { return JSON.parse(localStorage.getItem('solar.kepcoLot') || '{}'); } catch (e) { return {}; } })();
    const saveCache = () => { try { localStorage.setItem('solar.kepcoLot', JSON.stringify(cache)); } catch (e) {} };
    const MONTH = 30 * 864e5;
    const atLot = async lot => {
      const c = cache[cacheKey(lot)];
      if (c && Date.now() - c.t < MONTH) return c.rows ? c.rows.map(toRow) : [];
      for (let tryNo = 0; tryNo < 3; tryNo++) {
        try {
          const res = await call(Object.assign({ addrJibun: lot }, base));
          if (res && (res.data || res.errCd === '404')) {
            cache[cacheKey(lot)] = { t: Date.now(), rows: res.data && res.data.length ? res.data : null };
            return rowsOf(res);
          }
        } catch (e) { /* 빈 응답 → 다시 */ }
        await new Promise(r => setTimeout(r, 400 + tryNo * 600));
      }
      return [];                                          // 세 번 다 실패: 이번엔 모름(기억하지 않음)
    };

    if (jibun) {
      // 1) 그 번지
      const exact = await atLot(jibun);
      if (exact.length) return { level: '번지', basis: [jibun], rows: exact };

      // 2) 자료 있는 번지 중 지도상 가장 가까운 곳 (한전ON 의 "가장 근접한 지번 선택" 과 같은 원리)
      //    nearLots = [{ lot, d(m) }] 가까운 순, 약 1km 안 같은 법정동 필지. 자료가 있는 번지는 드물어서
      //    (생곡동 1585-1 → 가장 가까운 자료 번지 135-166 이 692m) 수백 개를 물어야 할 수 있다.
      //    가까운 자료 번지 3곳을 모아 같은 선로가 많은 쪽(동률이면 더 가까운 쪽)을 하나 고른다.
      let cand = (nearLots || []).filter(x => x.lot !== jibun);
      if (!cand.length) {                                  // 주변 필지를 못 받았으면 번호가 가까운 부번이라도
        const [bun, ji] = String(jibun).split('-').map(Number);
        for (let d = 1; d <= 12; d++) {
          if ((ji || 0) - d > 0) cand.push({ lot: bun + '-' + ((ji || 0) - d), d: null });
          cand.push({ lot: bun + '-' + ((ji || 0) + d), d: null });
        }
      }
      cand = cand.slice(0, 900);
      const hits = [];
      const useBatch = !(hasNative() && cfg().KEPCO_KEY);
      let batchOk = useBatch;
      const step = useBatch ? 25 : 1;                      // 앱: 하나씩 직접 / 웹: 중계가 하나씩 25개 묶어서
      let firstHitAt = -1;
      for (let i = 0; i < cand.length; ) {
        // 기억해 둔 번지는 묶음에 넣지 않고 바로 쓴다
        const cachedHere = cand[i] && cache[cacheKey(cand[i].lot)];
        // 묶음은 i 부터 기억 안 된 번지가 이어지는 데까지만(최대 step). 기억된 번지는 아래 하나씩 경로에서 캐시로 바로 나온다.
        const part = [];
        if (batchOk && !cachedHere) { for (let k = i; k < cand.length && part.length < step && !cache[cacheKey(cand[k].lot)]; k++) part.push(cand[k]); }
        else part.push(cand[i]);
        if (!part.length) { i++; continue; }
        if (onProgress) onProgress('자료 있는 번지 찾는 중… ' + (part[0].d != null ? '반경 ' + part[0].d + 'm' : part[0].lot) + ' (' + Math.min(cand.length, i + 1) + '/' + cand.length + ')');
        let got;
        if (batchOk && !cachedHere) {
          const res = await proxyGet(Object.assign({ path: 'batch', lots: part.map(x => x.lot).join(',') }, base), 60000).catch(() => null);
          if (!res || !res.results) { batchOk = false; cand = cand.slice(0, i + 60); continue; }   // 예전 중계(묶음 없음) → 하나씩, 60개까지만
          got = res.results.map((r, k) => {
            if (r.known) cache[cacheKey(part[k].lot)] = { t: Date.now(), rows: r.data || null };
            return r.data ? r.data.map(toRow) : [];
          });
          part.forEach((x, n) => { if (got[n].length) hits.push({ lot: x.lot, d: x.d, rows: got[n] }); });
          i += part.length;
        } else {
          got = [await atLot(part[0].lot)];
          if (got[0].length) hits.push({ lot: part[0].lot, d: part[0].d, rows: got[0] });
          i += 1;
        }
        saveCache();
        if (hits.length && firstHitAt < 0) firstHitAt = i;
        const part0 = cand[Math.min(i, cand.length) - 1] || {};
        // 3곳 모이면 멈춘다. 아니면 첫 자료 번지에서 300m 더 넓힌 데까지만 본다(거리를 모르면 한 묶음 더).
        const lastD = part0.d, firstD = hits.length ? hits[0].d : null;
        if (hits.length >= 3) break;
        if (firstHitAt >= 0 && (firstD != null && lastD != null ? lastD > firstD + 300 : i >= firstHitAt + step)) break;
      }
      if (hits.length) {
        const top = hits.slice(0, 3);
        const votes = {};
        top.forEach((h, rank) => {
          const seenHere = {};
          h.rows.forEach(r => {
            const k = r.substCd + '/' + r.mtr + '/' + r.dlCd;
            if (seenHere[k]) return; seenHere[k] = 1;
            if (!votes[k]) votes[k] = { row: r, n: 0, best: rank, lots: [] };
            votes[k].n++; votes[k].lots.push(h.lot + (h.d != null ? '(' + h.d + 'm)' : ''));
          });
        });
        const ranked = Object.values(votes).sort((a, b) => b.n - a.n || a.best - b.best);
        const rows = ranked.map(v => Object.assign(v.row, { lots: v.lots, votes: v.n }));
        return { level: '인근', basis: top.map(h => h.lot + (h.d != null ? '(' + h.d + 'm)' : '')), rows, of: top.length };
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
