/*
 * 토지(노지) 입지 검토.
 *
 * V-World 국가중점(NED) 속성 API 두 개로 필지 하나를 들여다본다. 둘 다 2D 데이터 API 와 같은 키·같은 전송 경로(VWorld.ned).
 *   getLandUseAttr         : 토지이용계획 — 이 필지에 걸린 지역·지구 목록 (포함/저촉)
 *   getLandCharacteristics : 토지특성 — 용도지역, 지목, 면적, 지형고저(평지/완경사/급경사…), 도로접면(맹지…), 토지이용상황
 * 여기에 주변 필지(연속지적도)로 도로·구거가 붙어 있는지 보고, 아래 기준으로 설치불가 / 확인 필요 / 참고 로 나눈다.
 *
 * 기준 (근거는 README「토지 입지 검토」. 조례로 달라지는 값은 '조례 확인' 을 붙인다)
 *   설치불가 : 보전산지(임업용·공익용) — 산지관리법상 태양광 불가 / 농업진흥구역 — 농지법상 태양광 목적 전용 금지
 *             급경사(15° 초과) — 산지 태양광 평균경사도 15° 이하 (산지관리법 시행령, 2018.12)
 *             개발제한구역 — 지상 발전소 허가 사실상 불가 (사용자 기준)
 *   확인 필요 : 보전녹지·농업보호구역 등 행위 제한 지역지구 / 완경사 / 맹지 / 면적 기준 초과
 *   면적 기준 : 개발행위허가 규모(국토계획법 시행령 55조), 소규모환경영향평가(환경영향평가법 시행령 별표4),
 *             소규모재해영향평가 5천~5만㎡·재해영향평가 5만㎡ 이상(자연재해대책법)
 *
 * 지형고저는 개별공시지가 토지특성조사 분류(완경사 ≤15°, 급경사 >15°)라 실측 평균경사도와 다를 수 있다 — 안내용.
 */
const Site = (() => {
  // 용도지역별 개발행위허가 규모 (토지형질변경 면적, ㎡ 미만). 관리·농림은 조례로 달리 정할 수 있다.
  const DEV_LIMIT = [
    ['보전녹지', 5000, false], ['자연녹지', 10000, false], ['생산녹지', 10000, false],
    ['주거', 10000, false], ['상업', 10000, false], ['공업', 30000, false],
    ['관리', 30000, true], ['농림', 30000, true], ['자연환경보전', 5000, false],
  ];
  // 소규모환경영향평가 대상 면적 (㎡ 이상). 확인된 지역만. 나머지(도시지역 등)는 별표4 확인 안내.
  const EIA_LIMIT = [['보전관리', 5000], ['생산관리', 7500], ['계획관리', 10000], ['농림', 7500], ['자연환경보전', 5000]];
  // 개발제한구역은 법으로 절대 금지는 아니지만(허가 대상) 지상 발전소는 사실상 허가가 안 난다 — 사용자 지시로 설치불가 처리(2026-10-07)
  const BAN_ZONES = ['보전산지', '임업용산지', '공익용산지', '농업진흥구역', '개발제한구역'];
  const WARN_ZONES = ['보전녹지', '농업보호구역', '보전관리', '자연환경보전', '자연공원', '상수원보호', '수변구역',
    '문화재', '문화유산', '군사', '하천구역', '소하천', '생태', '백두대간', '야생생물', '습지', '특별대책', '수질보전', '재해위험',
    '산사태', '급경사지', '토사', '경관지구', '보호지구', '비행안전', '송전'];

  const cache = {};

  // ------------------------------------------------------------ 조회
  function rows(res, key) {
    const r = res && res[key];
    if (!r) return [];
    const f = r.field;
    return Array.isArray(f) ? f : (f ? [f] : []);
  }
  function landUse(pnu) {
    return VWorld.ned('getLandUseAttr', { pnu, numOfRows: '100', pageNo: '1' })
      .then(res => rows(res, 'landUses').map(x => ({ name: x.prposAreaDstrcCodeNm || '', code: x.prposAreaDstrcCode || '', how: x.cnflcAtNm || '' })));
  }
  function landChar(pnu) {
    return VWorld.ned('getLandCharacteristics', { pnu, numOfRows: '10', pageNo: '1' })
      .then(res => {
        const list = rows(res, 'landCharacteristicss');
        if (!list.length) return null;
        list.sort((a, b) => String(b.stdrYear || '').localeCompare(String(a.stdrYear || '')));   // 최신 연도
        const x = list[0];
        return {
          year: x.stdrYear, zone: x.prposArea1Nm || '', zone2: x.prposArea2Nm || '', jimok: x.lndcgrCodeNm || '',
          area: parseFloat(x.lndpclAr) || 0, slope: x.tpgrphHgCodeNm || '', shape: x.tpgrphFrmCodeNm || '',
          road: x.roadSideCodeNm || '', use: x.ladUseSittnNm || '', addr: (x.ldCodeNm || '') + ' ' + (x.mnnmSlno || ''),
        };
      });
  }
  /** 토지임야정보 — 소유구분(개인·법인·국유·공유 등)과 공유인 수. 소유자 이름은 공개 API 에 없다(등기부·토지대장 발급으로만). */
  function ladfrl(pnu) {
    return VWorld.ned('ladfrlList', { pnu, numOfRows: '5', pageNo: '1' }).then(res => {
      const v = res && res.ladfrlVOList && res.ladfrlVOList.ladfrlVOList;
      const x = Array.isArray(v) ? v[0] : v;
      if (!x) return null;
      return { owner: x.posesnSeCodeNm || '', coOwners: parseInt(x.cnrsPsnCo, 10) || 0, area: parseFloat(x.lndpclAr) || 0 };
    });
  }
  /** 필지 하나의 자료 (캐시). 실패해도 가진 것만으로 검토한다. */
  function lookup(pnu) {
    if (!pnu) return Promise.resolve({ use: [], ch: null, own: null });
    if (cache[pnu]) return cache[pnu];
    cache[pnu] = Promise.all([landUse(pnu).catch(() => null), landChar(pnu).catch(() => null), ladfrl(pnu).catch(() => null)])
      .then(([use, ch, own]) => ({ use: use || [], ch, own, failed: !use && !ch }));
    return cache[pnu];
  }

  // ------------------------------------------------------------ 주변 필지 (도로·구거)
  const M_LAT = 110574, M_LNG = lat => 111320 * Math.cos(lat * Math.PI / 180);
  function toXY(ring, o) { const k = M_LNG(o.lat); return ring.map(p => ({ x: (p.lng - o.lng) * k, y: (p.lat - o.lat) * M_LAT })); }
  function segDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  function ringDist(A, B) {
    let best = Infinity;
    const one = (P, Q) => { P.forEach(p => { for (let i = 0, j = Q.length - 1; i < Q.length; j = i++) best = Math.min(best, segDist(p, Q[j], Q[i])); }); };
    one(A, B); one(B, A);
    return best;
  }
  /** 두 필지(lat/lng 링)의 최단 거리(m). 경계를 맞대면 0 에 가깝다. */
  function distanceM(ringA, ringB) {
    const o = ringA[0];
    return ringDist(toXY(ringA, o), toXY(ringB, o));
  }
  /** 필지에 붙은(1.5m 안) 도로·구거·하천 필지. 지목은 지번 끝 글자(도·구·천·제·유). */
  function neighbors(ring) {
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    ring.forEach(p => { minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat); minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng); });
    const dLat = 30 / M_LAT, dLng = 30 / M_LNG(minLat);
    return VWorld.parcelsInBox({ lat: minLat - dLat, lng: minLng - dLng }, { lat: maxLat + dLat, lng: maxLng + dLng }).then(list => {
      const out = { road: [], ditch: [], river: [] };
      list.forEach(p => {
        const jb = (p.props || {}).jibun || '';
        const m = jb.match(/([가-힣])$/);
        if (!m) return;
        const kind = { '도': 'road', '구': 'ditch', '천': 'river', '제': 'river', '유': 'river' }[m[1]];
        if (!kind) return;
        if (distanceM(ring, p.ring) > 1.5) return;
        out[kind].push(jb);
      });
      return out;
    }).catch(() => null);
  }

  // ------------------------------------------------------------ 판정
  const fmt = n => Math.round(n).toLocaleString('ko-KR');
  function pick(table, zone) { for (const row of table) if (zone.indexOf(row[0]) >= 0) return row; return null; }

  /**
   * parcels : [{ pnu, jibun, ring }]   areaM2 : 배치 면적(합산)
   * → { verdict:'ban'|'warn'|'ok', items:[{ level, text }], head:{zone,jimok,slope,road,...} }
   */
  function review(parcels, areaM2, terrain) {
    const items = [];
    const push = (level, text) => items.push({ level, text });
    return Promise.all(parcels.map(p => lookup(p.pnu))).then(infos => {
      const chars = infos.map(i => i.ch).filter(Boolean);
      const uses = [].concat(...infos.map(i => i.use));
      const failed = infos.length && infos.every(i => i.failed);
      if (failed) push('warn', '토지이용계획·토지특성 자료를 받지 못했습니다(V-World). 토지이음(eum.go.kr)에서 직접 확인하세요.');

      // 머리말: 용도지역 · 지목 · 지형 · 도로
      const zone = [...new Set(chars.map(c => c.zone).filter(Boolean))].join(' / ');
      const jimok = [...new Set(chars.map(c => c.jimok).filter(Boolean))].join(' / ');
      const slope = [...new Set(chars.map(c => c.slope).filter(Boolean))].join(' / ');
      const road = [...new Set(chars.map(c => c.road).filter(Boolean))].join(' / ');
      const use = [...new Set(chars.map(c => c.use).filter(Boolean))].join(' / ');
      const owners = [...new Set(infos.map(i => i.own && (i.own.owner + (i.own.coOwners > 1 ? ' 공유 ' + i.own.coOwners + '인' : ''))).filter(Boolean))].join(' / ');
      const head = { zone, jimok, slope, road, use, owner: owners, year: chars[0] && chars[0].year, ledgerArea: chars.reduce((a, c) => a + c.area, 0), terrain: terrain || null };
      if (owners) push('info', '소유구분: ' + owners + ' — 소유자 이름은 공개 API 에 없음(등기부등본·토지대장으로 확인)');

      // 1) 지역지구 — 설치불가 / 행위제한
      const seen = {};
      uses.forEach(u => {
        if (!u.name || seen[u.name]) return;
        seen[u.name] = 1;
        const tag = u.how ? '(' + u.how + ')' : '';
        if (BAN_ZONES.some(k => u.name.indexOf(k) >= 0)) push('ban', u.name + tag + ' — 태양광 설치불가 (' + (u.name.indexOf('농업진흥') >= 0 ? '농지법: 태양광 목적 농지전용 금지'
          : u.name.indexOf('개발제한') >= 0 ? '개발제한구역: 지상 발전소 허가 사실상 불가' : '산지관리법: 보전산지에는 태양광 불가') + ')');
        else if (WARN_ZONES.some(k => u.name.indexOf(k) >= 0)) push('warn', u.name + tag + ' — 행위 제한, 허가 가능 여부 확인 필요');
        else push('info', u.name + tag);
      });
      if (zone.indexOf('보전녹지') >= 0 && !seen['보전녹지지역']) push('warn', '보전녹지지역 — 발전시설 허용 여부는 도시계획조례에 따름, 확인 필요');

      // 2) 경사 — 표고(DEM) 평면 맞춤 평균 경사가 있으면 그걸 우선, 토지특성 지형고저는 보조
      if (terrain && isFinite(terrain.slopeDeg)) {
        const t = '표고 기준 평균 경사 ' + terrain.slopeDeg + '° · ' + terrain.name + ' (고저차 ' + Math.round(terrain.zMax - terrain.zMin) + 'm, 90m DEM 이라 작은 필지는 주변 경사)';
        if (terrain.slopeDeg >= 15) push('ban', t + ' — 15° 이상 배치불가 안내 (산지관리법 시행령: 평균경사도 15° 이하)');
        else if (terrain.slopeDeg >= 10) push('warn', t + ' — 15° 에 가까워 실측 필요. 이격은 사면 방향으로 보정됨');
        else push('info', t + (terrain.slopeDeg >= 1 ? ' — 어레이 이격을 사면 방향으로 보정함' : ''));
      }
      if (slope.indexOf('급경사') >= 0) push(terrain && terrain.slopeDeg < 15 ? 'warn' : 'ban', '토지특성 지형고저 급경사(15° 초과)' + (terrain ? ' — 표고 계산과 다르면 실측 필요' : ' — 배치불가 안내 (산지관리법 시행령)'));
      else if (slope.indexOf('완경사') >= 0) push('warn', '토지특성 지형고저 완경사(15° 이하) — 경계선상일 수 있어 평균경사도 실측 필요');
      else if (slope) push('info', '토지특성 지형: ' + slope);

      // 3) 지목
      if (/전|답|과수원/.test(jimok)) push('info', '지목 ' + jimok + ' — 농지전용허가(농지법) 대상. 농업진흥지역 여부는 위 지역지구 참고');
      if (/임야/.test(jimok)) push('info', '지목 임야 — 산지일시사용허가(산지관리법) 대상, 평균경사도 15° 이하·보전산지 제외');

      // 4) 면적 기준 — 배치 면적(합산) 기준
      const A = areaM2 || head.ledgerArea;
      const dev = pick(DEV_LIMIT, zone);
      if (dev) {
        if (A >= dev[1]) push('warn', '개발행위허가 규모 초과 — ' + fmt(A) + '㎡ ≥ ' + dev[0] + '지역 기준 ' + fmt(dev[1]) + '㎡' + (dev[2] ? ' (조례로 더 낮을 수 있음)' : '') + '. 분할 또는 도시계획위원회 심의 검토');
        else push('info', '개발행위허가 규모 안 — ' + fmt(A) + '㎡ < ' + dev[0] + '지역 ' + fmt(dev[1]) + '㎡' + (dev[2] ? ' (조례 확인)' : ''));
      } else if (zone) push('info', '개발행위허가 규모: ' + zone + ' 기준은 시행령 55조·조례 확인');
      const eia = pick(EIA_LIMIT, zone);
      if (eia) {
        if (A >= eia[1]) push('warn', '소규모환경영향평가 대상 — ' + fmt(A) + '㎡ ≥ ' + eia[0] + ' ' + fmt(eia[1]) + '㎡ (환경영향평가법 시행령 별표4)');
        else push('info', '소규모환경영향평가 대상 아님 — ' + eia[0] + ' ' + fmt(eia[1]) + '㎡ 미만');
      } else if (zone) push('info', '소규모환경영향평가: ' + zone + ' 은 별표4(도시지역·개발제한구역 기준) 확인');
      if (A >= 50000) push('warn', '재해영향평가 대상 — 5만㎡ 이상 (자연재해대책법)');
      else if (A >= 5000) push('warn', '소규모재해영향평가 대상 — 5천㎡ 이상 5만㎡ 미만 (자연재해대책법)');

      // 5) 도로접면 · 구거 (주변 필지는 첫 필지 기준)
      if (road.indexOf('맹지') >= 0) push('warn', '맹지 — 진입도로 없음. 도로 확보(사용승낙·구거 점용 등) 필요');
      else if (road) push('info', '도로접면: ' + road);
      const ring = parcels[0] && parcels[0].ring;
      return (ring ? neighbors(ring) : Promise.resolve(null)).then(nb => {
        if (nb) {
          if (nb.road.length) push('info', '도로 접함: ' + nb.road.join(', '));
          else if (road.indexOf('맹지') < 0 && road) push('info', '지적상 바로 붙은 도로 필지 없음 — 진입로 확인');
          if (nb.ditch.length) push('warn', '구거 접함: ' + nb.ditch.join(', ') + ' — 진입·배수에 쓰려면 구거 점용(목적 외 사용) 허가 필요');
          if (nb.river.length) push('info', '하천·제방·유지 접함: ' + nb.river.join(', '));
        }
        const verdict = items.some(i => i.level === 'ban') ? 'ban' : items.some(i => i.level === 'warn') ? 'warn' : 'ok';
        const order = { ban: 0, warn: 1, info: 2 };
        items.sort((a, b) => order[a.level] - order[b.level]);
        return { verdict, items, head };
      });
    });
  }

  return { review, lookup, distanceM };
})();
