/*
 * 한전 분산전원연계정보 — 전력데이터개방포털 Open API (bigdata.kepco.co.kr/openapi/v1/dispersedGeneration.do).
 * 지번이 속한 읍면동의 변전소·주변압기·배전선로 용량/여유를 보여준다 (입지 1차 검토용).
 *
 * 확인된 사실 (2026-10-02 실호출)
 *   - 코드는 행정구역코드가 아니라 **법정동코드** 다: metroCd = 법정동코드 앞 2자리, cityCd = 3~5자리 (김해 안동 → 48 / 250).
 *   - 번지(addrJibun)까지 주면 대부분 404(NotFound). 읍면동(addrLidong)까지만 주면 그 동을 지나는 선로 목록이 온다.
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
  async function lines(bcode, dong, jibun) {
    if (!available()) throw new Error(hasNative() ? '한전 API 키가 없습니다.' : '웹에서는 한전 중계 설치가 필요합니다 (server/한전프록시_설치안내.md).');
    const base = { metroCd: bcode.slice(0, 2), cityCd: bcode.slice(2, 5), addrLidong: dong };
    const call = hasNative() && cfg().KEPCO_KEY
      ? p => nativeGet(API + '?' + Object.keys(p).map(k => k + '=' + encodeURIComponent(p[k])).join('&') + '&apiKey=' + cfg().KEPCO_KEY + '&returnType=json')
      : p => proxyGet(p);
    let res = jibun ? await call(Object.assign({ addrJibun: jibun }, base)) : null;
    let level = '번지';
    if (!res || !res.data || !res.data.length) { res = await call(base); level = '읍면동'; }
    if (res && res.errCd) { if (res.errCd === '404') return { level, rows: [] }; throw new Error('한전 API 오류 ' + res.errCd + ' ' + (res.errMsg || '')); }
    const rows = (res.data || []).map(r => ({
      subst: r.substNm, substCd: r.substCd, mtr: r.mtrNo, dl: r.dlNm, dlCd: r.dlCd,
      // 여유용량 / 누적 연계용량 / 설비용량
      substFree: num(r.vol1), mtrFree: num(r.vol2), dlFree: num(r.vol3),
      substUsed: num(r.substPwr), mtrUsed: num(r.mtrPwr), dlUsed: num(r.dlPwr),
      substCap: num(r.jsSubstPwr), mtrCap: num(r.jsMtrPwr), dlCap: num(r.jsDlPwr),
    }));
    return { level, rows };
  }
  const num = v => (v === null || v === undefined || v === '') ? null : Number(v);

  return { lines, available };
})();
