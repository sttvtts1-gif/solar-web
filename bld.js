/*
 * 건축물대장 표제부 — 국토교통부 건축HUB 건축물대장정보 서비스 (공공데이터포털, 자동승인, 일 10,000회).
 *   https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo
 *
 * 웹에서도 바로 불린다(Access-Control-Allow-Origin 을 요청 출처 그대로 돌려준다, 2026-10-02 확인).
 * APK 에서는 Native.fetch 로 부른다(웹뷰 출처가 appassets 라 CORS 결과를 장담 못 해서).
 *
 * 요청 파라미터: sigunguCd(법정동코드 앞 5) · bjdongCd(뒤 5) · platGbCd(0 대지 / 1 산) · bun·ji(4자리 0채움)
 * 키는 공공데이터포털 "일반 인증키(Decoding)" 를 config.js BLD_KEY 에 넣는다.
 * 위반건축물 여부는 이 API 에 없다(표제부 항목에 해당 필드 없음).
 */
const Bld = (() => {
  const API = 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo';
  const cfg = () => window.SOLAR_CONFIG || {};
  const pad4 = v => String(parseInt(v, 10) || 0).padStart(4, '0');

  let seq = 0;
  function get(url) {
    if (window.Native && typeof window.Native.fetch === 'function') return window.NativeHttp.get(url, '');
    return fetch(url).then(r => r.text()).then(t => { try { return JSON.parse(t); } catch (e) { throw new Error('응답이 JSON 이 아닙니다: ' + t.slice(0, 80)); } });
  }

  /**
   * @param bcode 법정동코드 10자리, mountain 산 여부, bun/ji 본번·부번
   * @returns [{ name, dong, purpose, structure, roof, floors, basement, height, archArea, totArea, platArea, approved, kind }]
   */
  async function title(bcode, mountain, bun, ji) {
    if (!cfg().BLD_KEY) throw new Error('건축물대장 키가 없습니다 (공공데이터포털 건축HUB 활용신청 → config.js BLD_KEY).');
    const q = {
      serviceKey: cfg().BLD_KEY, sigunguCd: bcode.slice(0, 5), bjdongCd: bcode.slice(5, 10),
      platGbCd: mountain ? '1' : '0', bun: pad4(bun), ji: pad4(ji), _type: 'json', numOfRows: '50', pageNo: '1',
    };
    const res = await get(API + '?' + Object.keys(q).map(k => k + '=' + encodeURIComponent(q[k])).join('&'));
    const head = res.OpenAPI_ServiceResponse && res.OpenAPI_ServiceResponse.cmmMsgHeader;
    if (head) throw new Error('건축물대장 오류: ' + (head.returnAuthMsg || head.errMsg));
    const body = res.response && res.response.body;
    const hdr = res.response && res.response.header;
    if (hdr && hdr.resultCode && hdr.resultCode !== '00') throw new Error('건축물대장 오류: ' + hdr.resultMsg);
    let items = body && body.items && body.items.item;
    if (!items) return [];
    if (!Array.isArray(items)) items = [items];
    const n = v => (v === '' || v === null || v === undefined) ? null : Number(v);
    return items.map(it => ({
      name: it.bldNm || '', dong: it.dongNm || '',
      purpose: it.mainPurpsCdNm || it.etcPurps || '', structure: it.strctCdNm || it.etcStrct || '',
      roof: it.roofCdNm || '', roofEtc: it.etcRoof || '',
      floors: n(it.grndFlrCnt), basement: n(it.ugrndFlrCnt), height: n(it.heit),
      archArea: n(it.archArea), totArea: n(it.totArea), platArea: n(it.platArea),
      approved: it.useAprDay || '', kind: it.mainAtchGbCdNm || '', addr: it.newPlatPlc || it.platPlc || '',
      quake: it.rserthqkDsgnApplyYn === '1' ? '적용' : it.rserthqkDsgnApplyYn === '0' ? '미적용' : '',
    }));
  }

  /** 지붕 재료로 배치 형태를 제안. 콘크리트·슬래브면 평슬라브, 그 외(판넬·금속·기와 등)는 경사지붕으로 본다. */
  function suggestType(b) {
    const s = (b.roof + ' ' + b.roofEtc + ' ' + b.structure);
    if (/콘크리트|슬래브|슬라브|평지붕/.test(b.roof + ' ' + b.roofEtc)) return 'slab';
    if (/판넬|패널|금속|철판|칼라|징크|기와|슁글|강판/.test(s)) return null;   // 경사지붕: 동서/남북은 건물 방향으로 이미 추정
    return null;
  }

  /**
   * V-World 건물(건물관리번호 bd_mgt_sn)의 높이(m). 같은 필지에 건물이 여럿이면 지상층수가 같은 건물의 높이,
   * 없으면 그 필지에서 가장 높은 건물. 대장에 높이가 비어 있으면 null.
   * 건물관리번호 앞 19자리 = 법정동코드10 + 대지구분1(1 대지 / 2 산) + 본번4 + 부번4.
   */
  const lotCache = {};
  async function heightOf(bdMgtSn, floors) {
    if (!bdMgtSn || bdMgtSn.length < 19) return null;
    const key = bdMgtSn.slice(0, 19);
    if (!(key in lotCache)) {
      lotCache[key] = title(key.slice(0, 10), key[10] === '2', key.slice(11, 15), key.slice(15, 19)).catch(() => []);
    }
    const list = await lotCache[key];
    const hs = list.filter(x => x.height > 0);
    if (!hs.length) return null;
    const same = hs.find(x => floors && x.floors === floors);
    return (same || hs.reduce((a, b) => (b.height > a.height ? b : a))).height;
  }

  return { title, suggestType, heightOf, available: () => !!cfg().BLD_KEY };
})();
