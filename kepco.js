/*
 * 한전 분산전원연계정보 — 전력데이터개방포털 Open API (bigdata.kepco.co.kr/openapi/v1/dispersedGeneration.do).
 * 지번이 속한 읍면동의 변전소·주변압기·배전선로 용량/여유를 보여준다 (입지 1차 검토용).
 *
 * 확인된 사실 (2026-10-02 실호출)
 *   - 코드는 행정구역코드가 아니라 **법정동코드** 다: metroCd = 법정동코드 앞 2자리, cityCd = 3~5자리 (김해 안동 → 48 / 250).
 *   - 번지(addrJibun)까지 주면 대부분 404(NotFound). 읍면동(addrLidong)까지만 주면 그 동을 지나는 선로 목록이 온다.
 *   - CORS 헤더도 JSONP 도 없다 → 브라우저에서 직접 못 부른다. APK 에서는 Native.fetch 로, 웹에서는 안내만.
 *   - 응답 필드(개방포털 레퍼런스): vol1/vol2/vol3 = 변전소/변압기/DL **여유용량**, substPwr/mtrPwr/dlPwr = **누적 연계용량**,
 *     jsSubstPwr/jsMtrPwr/jsDlPwr = 설비용량. 단위는 문서에 없다(kW 로 보이나 미확인).
 */
const Kepco = (() => {
  const API = 'https://bigdata.kepco.co.kr/openapi/v1/dispersedGeneration.do';
  const cfg = () => window.SOLAR_CONFIG || {};
  const available = () => !!cfg().KEPCO_KEY && !!(window.Native && typeof window.Native.fetch === 'function');

  let seq = 0;
  function nativeGet(url) {
    return new Promise((resolve, reject) => {
      const id = 'kp' + (++seq);
      const prev = window.onNativeFetch;
      // vworld.js 가 같은 창구를 쓰므로 내 reqId 만 가로채고 나머지는 넘긴다
      window.onNativeFetch = (reqId, ok, body) => {
        if (reqId !== id) { if (prev) prev(reqId, ok, body); return; }
        window.onNativeFetch = prev;
        if (!ok) return reject(new Error(body || '네트워크 오류'));
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('응답이 JSON 이 아닙니다')); }
      };
      window.Native.fetch(url, '', id);
      setTimeout(() => { if (window.onNativeFetch !== prev) { window.onNativeFetch = prev; reject(new Error('응답 시간 초과')); } }, 15000);
    });
  }

  /**
   * @param bcode  법정동코드 10자리 (카카오 coord2RegionCode region_type 'B' 의 code)
   * @param dong   읍면동 이름 (region_3depth_name)
   * @param jibun  '161-15' 같은 번지. 먼저 번지로 시도하고 404 면 동 단위로 다시.
   */
  async function lines(bcode, dong, jibun) {
    if (!cfg().KEPCO_KEY) throw new Error('한전 API 키가 없습니다.');
    if (!available()) throw new Error('한전 선로 조회는 앱(APK)에서만 됩니다. 한전 API 가 브라우저 직접 호출을 막아 둬서 웹에서는 안 됩니다.');
    const base = { metroCd: bcode.slice(0, 2), cityCd: bcode.slice(2, 5), addrLidong: dong, apiKey: cfg().KEPCO_KEY, returnType: 'json' };
    const call = p => nativeGet(API + '?' + Object.keys(p).map(k => k + '=' + encodeURIComponent(p[k])).join('&'));
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
