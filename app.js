/*
 * 화면 로직. 지도(카카오) + 주소검색 + 지붕 외곽선(V-World/수동) + Layout.compute 결과 표시 + 수익분석 탭 연결.
 *
 * 상태
 *   roofs[]  { id, name, type, points:[{lat,lng}], src, result, gfx:{outline, mods[], label} }
 *   settings 형태별 사용자 덮어쓰기 값 { ginseng:{...}, flush:{...}, slab:{...} }
 *
 * 검색 흐름 (사용자 요구)
 *   입력 → 카카오 주소검색(유사 매칭) + 키워드검색을 같이 돌려 목록으로 보여줌 → 하나 고르면
 *   지도 이동 → V-World 로 그 지점의 필지 → 필지 안 건물을 전부 자동으로 지붕 등록(형태는 외곽선으로 추정)
 *   → 필지가 안 잡히면 그 지점 건물 1개만 → 그것도 없으면 화면 안 건물 목록만 띄움.
 */
(() => {
  const $ = id => document.getElementById(id);
  const KEY = (window.SOLAR_CONFIG || {}).KAKAO_JS_KEY || '';
  const STORE = 'solar.state.v1';

  let map, geocoder, places;
  let roofs = [];
  let selectedId = null;
  let curType = 'slab';
  let settings = { ginseng: {}, flush: {}, slab: {} };
  let siteName = '';

  // V-World 에서 받아온 건물 외곽선. 누르면 지붕으로 들어가고, 음영 계산의 장애물로도 쓴다.
  let buildings = [];      // { id, name, ring, floors, gfx }
  // 음영 고려. 켜면 주변의 더 높은 건물(층수 × 층고) 그림자에 걸리는 모듈을 뺀다.
  let shade = { on: false, floorH: 3.5 };
  let parcelGfx = null;    // 검색한 지번의 필지 외곽선

  // 그리기 모드 상태
  let drawing = false;
  let pts = [];
  let dots = [];
  let preview = null;

  // 형태별 상세 설정 키. 모듈 규격은 형태와 무관하게 공통(moduleCfg)이라 여기 없다.
  const OPT_KEYS = ['orient', 'tiers', 'tilt', 'shadeAngle', 'autoGap', 'arrayGap', 'tierGap', 'colGap', 'margin', 'align', 'alignLimit'];
  const NUM_KEYS = ['tiers', 'tilt', 'shadeAngle', 'arrayGap', 'tierGap', 'colGap', 'margin', 'alignLimit'];
  // 설정(⚙) 의 공통값. 모듈 치수는 mm 로 받아 m 로 넘긴다.
  const MODULE_DEFAULT = { moduleWp: 645, modLmm: 2465, modSmm: 1134 };
  let moduleCfg = Object.assign({}, MODULE_DEFAULT);
  let currentTab = 'layout';
  const hasVWorld = () => !!(window.SOLAR_CONFIG || {}).VWORLD_KEY;

  // ------------------------------------------------------------ 부팅
  if (!KEY) {
    $('nokey').style.display = 'block';
    return;
  }
  const s = document.createElement('script');
  s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + encodeURIComponent(KEY) + '&libraries=services&autoload=false';
  s.onload = () => kakao.maps.load(init);
  s.onerror = () => { hint('카카오 지도 SDK 를 못 불러왔습니다. 키·도메인 등록·인터넷을 확인하세요.'); };
  document.head.appendChild(s);

  function init() {
    load();
    map = new kakao.maps.Map($('map'), {
      center: new kakao.maps.LatLng(35.2285, 128.8894), // 김해 근처. 저장된 상태가 있으면 아래서 덮는다.
      level: 2,
    });
    map.setMapTypeId(kakao.maps.MapTypeId.HYBRID);
    geocoder = new kakao.maps.services.Geocoder();
    places = new kakao.maps.services.Places();

    kakao.maps.event.addListener(map, 'click', e => {
      closeResults();
      if (!drawing) return;
      addPoint({ lat: e.latLng.getLat(), lng: e.latLng.getLng() });
    });

    bindUi();
    renderTypes();
    fillSettings();
    RpsUI.init();
    RpsUI.setSite(siteName);
    Policy.init();
    roofs.forEach(r => { recompute(r); });
    if (roofs.length) fitAll();
    renderList();
  }

  // ------------------------------------------------------------ UI 바인딩
  function bindUi() {
    $('btnSearch').onclick = search;
    $('q').addEventListener('keydown', e => { if (e.key === 'Enter') search(); });

    document.querySelectorAll('#tabs [data-tab]').forEach(b => { b.onclick = () => showTab(b.dataset.tab); });
    // 패널 접기: 지붕이 많아지면 목록이 지도를 다 가리므로 탭 줄 + 합계 한 줄만 남긴다.
    $('btnCollapse').onclick = () => {
      const col = $('panel').classList.toggle('collapsed');
      $('btnCollapse').textContent = col ? '▲' : '▼';
    };

    // 설정 모달 (모듈 규격 · 층고)
    $('btnSettings').onclick = () => {
      $('g_moduleWp').value = moduleCfg.moduleWp; $('g_modL').value = moduleCfg.modLmm; $('g_modS').value = moduleCfg.modSmm; $('g_floorH').value = shade.floorH;
      $('settingsModal').classList.add('on');
    };
    $('btnSettingsClose').onclick = () => $('settingsModal').classList.remove('on');
    $('btnSettingsDefault').onclick = () => { $('g_moduleWp').value = MODULE_DEFAULT.moduleWp; $('g_modL').value = MODULE_DEFAULT.modLmm; $('g_modS').value = MODULE_DEFAULT.modSmm; $('g_floorH').value = 3.5; };
    $('btnSettingsApply').onclick = () => {
      const wp = parseFloat($('g_moduleWp').value), L = parseFloat($('g_modL').value), S = parseFloat($('g_modS').value), fh = parseFloat($('g_floorH').value);
      if (!(wp > 0 && L > 0 && S > 0)) { alert('모듈 출력·치수는 0보다 커야 합니다.'); return; }
      moduleCfg = { moduleWp: wp, modLmm: Math.max(L, S), modSmm: Math.min(L, S) };
      if (fh > 0) shade.floorH = fh;
      $('settingsModal').classList.remove('on');
      roofs.forEach(recompute); renderList(); save();
      hint('모듈 ' + moduleCfg.modLmm + '×' + moduleCfg.modSmm + 'mm · ' + moduleCfg.moduleWp + 'W 로 다시 배치했습니다.');
    };

    $('btnDraw').onclick = startDraw;
    $('btnBuildings').onclick = () => loadBuildings();

    $('shadeOn').checked = shade.on;
    $('shadeOn').onchange = () => {
      shade.on = $('shadeOn').checked;
      if (shade.on && !buildings.length) hint('주변 건물 정보가 없어 음영을 계산할 수 없습니다. 「건물 가져오기」를 먼저 누르세요.');
      roofs.forEach(recompute); renderList(); save();
    };
    $('btnAddCenter').onclick = () => { const c = map.getCenter(); addPoint({ lat: c.getLat(), lng: c.getLng() }); };
    $('btnUndo').onclick = undoPoint;
    $('btnDone').onclick = finishDraw;
    $('btnCancel').onclick = cancelDraw;
    $('btnClear').onclick = () => { if (roofs.length && confirm('지붕 ' + roofs.length + '개를 모두 지울까요?')) { roofs.forEach(clearGfx); roofs = []; selectedId = null; renderList(); save(); } };
    $('btnShare').onclick = share;
    $('btnReset').onclick = () => { settings[curType] = {}; fillSettings(); applySettingsToSelected(); save(); };

    OPT_KEYS.forEach(k => {
      $('o_' + k).addEventListener('change', () => {
        const el = $('o_' + k);
        let v = NUM_KEYS.includes(k) ? parseFloat(el.value) : el.value;
        if (NUM_KEYS.includes(k) && !isFinite(v)) return;
        if (k === 'autoGap') v = v === 'true';
        settings[curType][k] = v;
        applySettingsToSelected();
        save();
      });
    });

    // 뒤로가기: 모달 → 검색목록 → 그리기 → 다른 탭 순으로 닫고, 다 아니면 앱 종료에 맡긴다.
    window.onNativeBack = () => {
      if ($('settingsModal').classList.contains('on')) { $('settingsModal').classList.remove('on'); return true; }
      if (Policy.isOpen()) { Policy.close(); return true; }
      if ($('results').classList.contains('on')) { closeResults(); return true; }
      if (drawing) { cancelDraw(); return true; }
      if (currentTab !== 'layout') { showTab('layout'); return true; }
      return false;
    };
  }

  function showTab(t) {
    currentTab = t;
    document.querySelectorAll('#tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $('modeRps').style.display = t === 'rps' ? 'block' : 'none';
    $('modeSelf').style.display = t === 'self' ? 'block' : 'none';
    $('modePolicy').style.display = t === 'policy' ? 'block' : 'none';
    $('modeView').style.display = t === 'layout' && !drawing ? 'block' : 'none';
    $('modeDraw').style.display = t === 'layout' && drawing ? 'block' : 'none';
    $('panel').classList.remove('collapsed'); $('btnCollapse').textContent = '▼';
    if (t === 'rps') RpsUI.render();
    if (t === 'self') RpsUI.renderSelf();
  }

  function renderTypes() {
    const box = $('types');
    box.innerHTML = '';
    Object.keys(Layout.PRESETS).forEach(t => {
      const p = Layout.PRESETS[t];
      const d = document.createElement('div');
      d.className = 'type' + (t === curType ? ' on' : '');
      d.innerHTML = typeIcon(t) + '<b>' + p.label.split(' · ')[0] + '</b>' + p.label.split(' · ')[1];
      d.onclick = () => {
        curType = t;
        renderTypes();
        fillSettings();
        // 선택된 지붕이 있으면 그 지붕의 형태를 바꾼다.
        const r = roofs.find(x => x.id === selectedId);
        if (r) { r.type = t; recompute(r); renderList(); }
        save();
      };
      box.appendChild(d);
    });
  }

  // 형태를 한눈에 구분하는 작은 그림
  function typeIcon(t) {
    const bar = (y, h) => '<rect x="4" y="' + y + '" width="40" height="' + h + '" fill="#f06" opacity=".85"/>';
    let inner = '';
    if (t === 'ginseng') inner = bar(2, 7) + bar(10, 7) + bar(21, 7) + bar(29, 7);
    else if (t === 'flush') inner = bar(2, 8) + bar(11, 8) + bar(20, 8) + bar(29, 8);
    else inner = bar(2, 6) + bar(14, 6) + bar(26, 6);
    return '<svg class="pic" viewBox="0 0 48 38"><rect x="1" y="1" width="46" height="36" fill="none" stroke="#9fc4b3"/>' + inner + '</svg>';
  }

  function effectiveOpt(type) {
    return Object.assign({}, Layout.DEFAULTS, Layout.PRESETS[type], settings[type] || {},
      { type, moduleWp: moduleCfg.moduleWp, modL: moduleCfg.modLmm / 1000, modS: moduleCfg.modSmm / 1000 });
  }

  function fillSettings() {
    const o = effectiveOpt(curType);
    OPT_KEYS.forEach(k => { $('o_' + k).value = k === 'autoGap' ? String(!!o[k]) : o[k]; });
  }

  function applySettingsToSelected() {
    // 설정은 형태 단위라서 같은 형태의 지붕 전부 다시 계산한다.
    roofs.filter(r => r.type === curType).forEach(recompute);
    renderList();
  }

  function hint(msg) { $('hint').textContent = msg || ''; }

  // ------------------------------------------------------------ 검색
  // "안동 161-15" 처럼 시·구 없이 쳐도 나오도록 유사 매칭(similar) 주소검색과 키워드검색을 같이 돌리고,
  // 결과가 여럿이면(다른 도시의 같은 동 이름 등) 목록에서 고르게 한다.
  function search() {
    const q = $('q').value.trim();
    if (!q) return;
    hint('검색 중…');
    const out = [];
    let pending = 2;
    const done = () => {
      if (--pending) return;
      if (!out.length) { hint('검색 결과가 없습니다: ' + q); closeResults(); return; }
      // 같은 좌표(주소검색과 키워드검색이 같은 곳을 가리킬 때)는 하나로
      const seen = {}, list = [];
      out.forEach(r => { const k = r.lat.toFixed(5) + ',' + r.lng.toFixed(5); if (!seen[k]) { seen[k] = 1; list.push(r); } });
      if (list.length === 1) { pick(list[0]); return; }
      showResults(list);
    };
    geocoder.addressSearch(q, (res, status) => {
      if (status === kakao.maps.services.Status.OK) {
        res.forEach(r => out.push({
          kind: 'addr', lat: +r.y, lng: +r.x,
          title: r.address_name,
          sub: r.road_address ? r.road_address.address_name : (r.address && r.address.address_name !== r.address_name ? r.address.address_name : ''),
        }));
      }
      done();
    }, { analyze_type: 'similar', size: 15 });
    places.keywordSearch(q, (res, status) => {
      if (status === kakao.maps.services.Status.OK) {
        res.slice(0, 10).forEach(r => out.push({ kind: 'place', lat: +r.y, lng: +r.x, title: r.place_name, sub: r.address_name + (r.road_address_name ? ' · ' + r.road_address_name : '') }));
      }
      done();
    }, { size: 10 });
  }
  function showResults(list) {
    const box = $('results');
    box.innerHTML = '';
    list.forEach(r => {
      const d = document.createElement('div');
      d.className = 'res';
      d.innerHTML = '<span class="tag' + (r.kind === 'place' ? ' place' : '') + '">' + (r.kind === 'place' ? '장소' : '주소') + '</span><div class="main">' + r.title + (r.sub ? '<small>' + r.sub + '</small>' : '') + '</div>';
      d.onclick = () => pick(r);
      box.appendChild(d);
    });
    box.classList.add('on');
    hint(list.length + '건 — 맞는 곳을 고르세요.');
  }
  function closeResults() { $('results').classList.remove('on'); }
  function pick(r) {
    closeResults();
    $('q').value = r.title;
    $('q').blur();
    siteName = r.title;
    RpsUI.setSite(siteName);
    save();
    goTo(r.lat, r.lng, r.title);
  }

  // ------------------------------------------------------------ 한전 선로
  /** 좌표 → 법정동코드·읍면동 (카카오) → 한전 분산전원연계정보. 실패해도 배치 흐름은 막지 않는다. */
  function loadKepco(lat, lng, addrText) {
    const box = $('kepcoBox');
    if (!(window.SOLAR_CONFIG || {}).KEPCO_KEY) { box.style.display = 'none'; return; }
    box.style.display = 'block'; box.open = false;
    $('kepcoHead').textContent = '조회 중…'; $('kepcoBody').innerHTML = '';
    geocoder.coord2RegionCode(lng, lat, (res, status) => {
      const b = status === kakao.maps.services.Status.OK ? res.find(x => x.region_type === 'B') : null;
      if (!b) { $('kepcoHead').textContent = '법정동을 못 찾음'; return; }
      const dong = b.region_3depth_name;
      const jm = (addrText || '').match(/(\d+(?:-\d+)?)\s*$/);
      Kepco.lines(b.code, dong, jm ? jm[1] : '')
        .then(({ level, rows }) => {
          if (!rows.length) { $('kepcoHead').textContent = dong + ' — 자료 없음'; return; }
          $('kepcoHead').textContent = dong + ' (' + level + ' 기준) · 선로 ' + rows.length + '개';
          const f = v => v === null ? '-' : v.toLocaleString('ko-KR');
          const cls = v => v === null ? '' : v > 0 ? 'pos' : 'neg';
          $('kepcoBody').innerHTML = '<div class="scrollx"><table class="cmp"><tr><th>변전소</th><th>변압기</th><th>배전선로(DL)</th><th>DL 여유</th><th>변압기 여유</th><th>변전소 여유</th><th>DL 누적연계</th></tr>'
            + rows.map(r => '<tr><td>' + r.subst + '</td><td style="text-align:center">#' + r.mtr + '</td><td style="text-align:left">' + r.dl + '</td><td class="' + cls(r.dlFree) + '">' + f(r.dlFree) + '</td><td class="' + cls(r.mtrFree) + '">' + f(r.mtrFree) + '</td><td class="' + cls(r.substFree) + '">' + f(r.substFree) + '</td><td>' + f(r.dlUsed) + '</td></tr>').join('')
            + '</table></div>';
        })
        .catch(e => { $('kepcoHead').textContent = dong + ' — ' + e.message; });
    });
  }

  function goTo(lat, lng, name) {
    map.setCenter(new kakao.maps.LatLng(lat, lng));
    map.setLevel(1);
    loadKepco(lat, lng, name);
    if (!hasVWorld()) { hint(name + ' — 건물 지붕 모서리를 따라 점을 찍어 주세요.'); return; }
    autoSetup(lat, lng, name);
  }

  // ------------------------------------------------------------ V-World 건물 · 필지
  /**
   * 검색 지점의 필지를 찾고, 그 안에 중심이 들어오는 건물을 전부 지붕으로 등록한다.
   * 형태는 외곽선으로 추정(남북으로 긴 건물 → 인삼밭 2단, 아니면 원단). 평슬라브는 사용자가 바꾼다.
   */
  function autoSetup(lat, lng, name) {
    hint(name + ' — 필지·건물 불러오는 중…');
    clearParcel();
    VWorld.parcelAt(lat, lng).then(parcel => {
      if (parcel) {
        parcelGfx = new kakao.maps.Polygon({
          path: parcel.ring.map(p => new kakao.maps.LatLng(p.lat, p.lng)),
          strokeWeight: 3, strokeColor: '#ffd54a', strokeStyle: 'dash', fillColor: '#ffd54a', fillOpacity: 0.06, zIndex: 0,
        });
        parcelGfx.setMap(map);
        const b = new kakao.maps.LatLngBounds();
        parcel.ring.forEach(p => b.extend(new kakao.maps.LatLng(p.lat, p.lng)));
        map.setBounds(b, 40);
      }
      return loadBuildings(true).then(list => {
        const inside = parcel
          ? list.filter(bd => Layout.containsGeo(parcel.ring, Layout.centroid(bd.ring)))
          : list.filter(bd => Layout.containsGeo(bd.ring, { lat, lng }));
        if (!inside.length) {
          hint(name + ' — ' + (parcel ? '필지 안에 건물 정보가 없습니다.' : '필지 정보를 못 받았습니다.') + ' 하늘색 건물을 누르거나 직접 그려 주세요.');
          return;
        }
        inside.forEach(bd => adoptBuilding(bd, Layout.guessType(bd.ring), true));
        renderList();
        save();
        hint(name + ' — 건물 ' + inside.length + '개 자동 배치. 형태가 다르면 지붕을 선택하고 위에서 바꾸세요.');
      });
    }).catch(e => hint(e.message));
  }
  function clearParcel() { if (parcelGfx) { parcelGfx.setMap(null); parcelGfx = null; } }

  function loadBuildings(quiet) {
    if (!hasVWorld()) { hint('V-World 인증키가 없습니다. config.js 의 VWORLD_KEY 를 채워야 건물을 가져옵니다.'); return Promise.resolve([]); }
    if (map.getLevel() > 4) { hint('너무 멀리서 보고 있습니다. 지도를 더 확대한 뒤 눌러 주세요.'); return Promise.resolve([]); }
    const b = map.getBounds(), sw = b.getSouthWest(), ne = b.getNorthEast();
    if (!quiet) hint('건물 외곽선 불러오는 중…');
    $('btnBuildings').disabled = true;
    return VWorld.buildingsInBox({ lat: sw.getLat(), lng: sw.getLng() }, { lat: ne.getLat(), lng: ne.getLng() })
      .then(list => {
        clearBuildings();
        list.forEach(bd => {
          const pg = new kakao.maps.Polygon({
            path: bd.ring.map(p => new kakao.maps.LatLng(p.lat, p.lng)),
            strokeWeight: 2, strokeColor: '#00e5ff', strokeStyle: 'shortdash', fillColor: '#00e5ff', fillOpacity: 0.12, zIndex: 0,
          });
          pg.setMap(map);
          kakao.maps.event.addListener(pg, 'click', () => { if (!drawing) { adoptBuilding(bd, curType); renderList(); save(); } });
          bd.gfx = pg;
          bd.floors = parseInt((bd.props || {}).gro_flo_co, 10) || 0;   // 0 = 층수 모름 → 음영 계산에서 제외
          buildings.push(bd);
        });
        if (shade.on) { roofs.forEach(recompute); renderList(); }
        save();
        if (!quiet) hint(list.length ? '건물 ' + list.length + '개. 하늘색 건물을 누르면 지붕으로 들어갑니다 (현재 형태: ' + Layout.PRESETS[curType].label + ')' : '이 화면 안에 건물 정보가 없습니다. 직접 그려 주세요.');
        return list;
      })
      .catch(e => { hint(e.message); return []; })
      .finally(() => { $('btnBuildings').disabled = false; });
  }
  function clearBuildings() {
    buildings.forEach(b => b.gfx && b.gfx.setMap(null));
    buildings = [];
  }
  function adoptBuilding(bd, type, batch) {
    const dup = roofs.find(r => r.src === bd.id);
    if (dup) { if (!batch) select(dup.id); return; }
    const roof = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: bd.name || ('지붕 ' + (roofs.length + 1)), type: type || curType, points: bd.ring.slice(), src: bd.id, floors: bd.floors || parseInt((bd.props || {}).gro_flo_co, 10) || 1, gfx: null };
    roofs.push(roof);
    selectedId = roof.id;
    recompute(roof);
    if (!batch) { curType = roof.type; renderTypes(); fillSettings(); }
  }

  // ------------------------------------------------------------ 그리기
  function startDraw() {
    drawing = true;
    pts = [];
    document.body.classList.add('drawing');
    showTab('layout');
    hint('지붕 모서리를 순서대로 찍고 완료를 누르세요. (지도를 눌러도 되고 십자선 버튼으로 찍어도 됩니다)');
    updatePreview();
  }
  function addPoint(p) {
    pts.push(p);
    const el = document.createElement('div');
    el.className = 'dot' + (pts.length === 1 ? ' first' : '');
    const ov = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(p.lat, p.lng), content: el, zIndex: 10 });
    ov.setMap(map);
    dots.push(ov);
    updatePreview();
  }
  function undoPoint() {
    pts.pop();
    const ov = dots.pop();
    if (ov) ov.setMap(null);
    updatePreview();
  }
  function updatePreview() {
    $('ptCount').textContent = pts.length + '점';
    if (preview) { preview.setMap(null); preview = null; }
    if (pts.length >= 2) {
      preview = new kakao.maps.Polyline({
        path: pts.concat(pts.length >= 3 ? [pts[0]] : []).map(p => new kakao.maps.LatLng(p.lat, p.lng)),
        strokeWeight: 2, strokeColor: '#ffd54a', strokeStyle: 'shortdash',
      });
      preview.setMap(map);
    }
  }
  function endDrawUi() {
    drawing = false;
    document.body.classList.remove('drawing');
    dots.forEach(d => d.setMap(null)); dots = [];
    if (preview) { preview.setMap(null); preview = null; }
    pts = [];
    showTab('layout');
  }
  function cancelDraw() { endDrawUi(); hint(''); }
  function finishDraw() {
    if (pts.length < 3) { hint('점을 3개 이상 찍어야 면이 됩니다.'); return; }
    const roof = { id: Date.now().toString(36), name: '지붕 ' + (roofs.length + 1), type: curType, points: pts.slice(), floors: 1, gfx: null };
    endDrawUi();
    hint('');
    roofs.push(roof);
    selectedId = roof.id;
    recompute(roof);
    renderList();
    save();
  }

  // ------------------------------------------------------------ 계산 · 그리기
  /**
   * 이 지붕보다 높은 주변 건물 → 음영 장애물. 높이차 = (층수차) × 층고.
   * 층수를 모르는 건물(0)은 뺀다. 지붕 중심에서 120m 안만 본다(동지 정오 고도 ~31° 면 10층 차이도 60m 안쪽).
   */
  function obstaclesFor(r) {
    if (!shade.on) return [];
    const c = Layout.centroid(r.points);
    const mine = r.floors || 1;
    const out = [];
    buildings.forEach(bd => {
      if (bd.id === r.src || !(bd.floors > mine)) return;
      const bc = Layout.centroid(bd.ring);
      const dist = Math.hypot((bc.lng - c.lng) * 111320 * Math.cos(c.lat * Math.PI / 180), (bc.lat - c.lat) * 110574);
      if (dist > 120) return;
      out.push({ ring: bd.ring, dh: (bd.floors - mine) * shade.floorH });
    });
    return out;
  }

  function recompute(r) {
    clearGfx(r);
    r.result = Layout.compute(r.points, effectiveOpt(r.type), { on: shade.on, obstacles: obstaclesFor(r) });
    const res = r.result;
    const sel = r.id === selectedId;

    const outline = new kakao.maps.Polygon({
      path: r.points.map(p => new kakao.maps.LatLng(p.lat, p.lng)),
      strokeWeight: sel ? 3 : 2, strokeColor: sel ? '#ffd54a' : '#ff3b3b', fillColor: '#000', fillOpacity: 0.05, zIndex: 1,
    });
    outline.setMap(map);
    kakao.maps.event.addListener(outline, 'click', () => { if (drawing) return; select(r.id); });

    // 모듈 하나당 폴리곤 하나. 수백 장은 문제없고 수천 장이면 느려질 수 있다.
    const mods = res.modules.map(c => {
      const pg = new kakao.maps.Polygon({
        path: c.map(p => new kakao.maps.LatLng(p.lat, p.lng)),
        strokeWeight: 1, strokeColor: '#ff00ff', fillColor: '#ff66ff', fillOpacity: 0.55, zIndex: 2,
      });
      pg.setMap(map);
      return pg;
    });

    const c = Layout.centroid(r.points);
    const el = document.createElement('div');
    el.className = 'lbl';
    el.innerHTML = '<b>' + res.kw.toFixed(2) + 'kW</b><span>' + res.opt.moduleWp + 'W × ' + res.count + 'EA</span>';
    const label = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(c.lat, c.lng), content: el, zIndex: 20 });
    label.setMap(map);

    r.gfx = { outline, mods, label };
  }
  function clearGfx(r) {
    if (!r.gfx) return;
    r.gfx.outline.setMap(null);
    r.gfx.mods.forEach(m => m.setMap(null));
    r.gfx.label.setMap(null);
    r.gfx = null;
  }
  function select(id) {
    selectedId = id;
    const r = roofs.find(x => x.id === id);
    if (r) { curType = r.type; renderTypes(); fillSettings(); }
    roofs.forEach(recompute);
    renderList();
  }
  function remove(id) {
    const i = roofs.findIndex(x => x.id === id);
    if (i < 0) return;
    clearGfx(roofs[i]);
    roofs.splice(i, 1);
    if (selectedId === id) selectedId = null;
    renderList();
    save();
  }
  function fitAll() {
    const b = new kakao.maps.LatLngBounds();
    roofs.forEach(r => r.points.forEach(p => b.extend(new kakao.maps.LatLng(p.lat, p.lng))));
    map.setBounds(b);
  }

  // ------------------------------------------------------------ 목록 · 요약
  function renderList() {
    const total = roofs.reduce((a, r) => a + (r.result ? r.result.kw : 0), 0);
    const cnt = roofs.reduce((a, r) => a + (r.result ? r.result.count : 0), 0);
    $('summary').innerHTML = roofs.length
      ? '합계 <b>' + total.toFixed(2) + ' kW</b> · ' + cnt + ' EA · 지붕 ' + roofs.length + '개 → <span style="color:var(--accent)">수익분석 탭</span>에서 이 용량으로 계산'
      : '지번을 검색하면 그 필지의 건물이 자동 배치됩니다. 없으면 「건물 가져오기」나 「직접 그리기」.';

    // 수익분석 탭에 용량 전달 (사용자가 직접 고치기 전까지 따라간다)
    window.__layoutTotalKw = total;
    RpsUI.setCapacity(total);
    $('miniSummary').innerHTML = roofs.length
      ? '<b>' + total.toFixed(2) + ' kW</b> · ' + cnt + ' EA · 지붕 ' + roofs.length + '개' + (siteName ? ' · ' + siteName : '')
      : (siteName || '지번을 검색하세요');

    const box = $('roofs');
    box.innerHTML = '';
    roofs.forEach(r => {
      const res = r.result || {};
      const d = document.createElement('div');
      d.className = 'roof' + (r.id === selectedId ? ' sel' : '');
      const dir = res.aligned ? ('건물맞춤 ' + res.rowAngle + '°') : '정남';
      const shadeTxt = shade.on ? ' · <span style="color:' + (res.shaded ? 'var(--danger)' : 'var(--ok)') + '">음영 제외 ' + (res.shaded || 0) + '장</span>' : '';
      d.innerHTML = '<span class="nm">' + r.name + ' · ' + Layout.PRESETS[r.type].label.split(' · ')[1] + ' · ' + dir
        + '<br><small style="color:var(--muted)">' + res.areaM2 + '㎡ · ' + res.rows + '줄 · 피치 ' + res.pitch + 'm' + (res.opt.tilt > 0 ? ' (경사 ' + res.opt.tilt + '° · 이격 ' + res.arrayGap + 'm)' : '') + ' · ' + (r.floors || 1) + '층' + shadeTxt + '</small></span>'
        + '<span class="kw">' + (res.kw || 0).toFixed(2) + 'kW</span>';
      const fl = document.createElement('button');
      fl.className = 'btn ghost'; fl.textContent = '층수';
      fl.onclick = e => {
        e.stopPropagation();
        const v = parseInt(prompt(r.name + ' 지상 층수 (음영 계산용)', r.floors || 1), 10);
        if (v > 0) { r.floors = v; roofs.forEach(recompute); renderList(); save(); }
      };
      d.appendChild(fl);
      const del = document.createElement('button');
      del.className = 'btn danger'; del.textContent = '삭제';
      del.onclick = e => { e.stopPropagation(); remove(r.id); };
      d.appendChild(del);
      d.onclick = () => { select(r.id); fitRoof(r); };
      box.appendChild(d);
    });
  }
  function fitRoof(r) {
    const b = new kakao.maps.LatLngBounds();
    r.points.forEach(p => b.extend(new kakao.maps.LatLng(p.lat, p.lng)));
    map.setBounds(b);
  }

  function share() {
    if (!roofs.length) { hint('공유할 결과가 없습니다.'); return; }
    const lines = roofs.map(r => {
      const s = r.result;
      return r.name + ' [' + Layout.PRESETS[r.type].label + '] ' + s.kw.toFixed(2) + 'kW (' + s.opt.moduleWp + 'W × ' + s.count + 'EA), ' + s.areaM2 + '㎡, ' + (s.aligned ? '건물맞춤 ' + s.rowAngle + '°' : '정남');
    });
    const total = roofs.reduce((a, r) => a + r.result.kw, 0);
    const text = '태양광 배치분석' + (siteName ? ' — ' + siteName : '') + '\n' + lines.join('\n') + '\n합계 ' + total.toFixed(2) + 'kW';
    if (window.Native && Native.share) Native.share('태양광 배치분석', text);
    else if (navigator.share) navigator.share({ title: '태양광 배치분석', text });
    else { navigator.clipboard && navigator.clipboard.writeText(text); hint('클립보드에 복사했습니다.'); }
  }

  // ------------------------------------------------------------ 저장
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        curType, settings, siteName, shade, moduleCfg,
        roofs: roofs.map(r => ({ id: r.id, name: r.name, type: r.type, points: r.points, src: r.src, floors: r.floors })),
        // 음영 장애물로 다시 쓰려고 주변 건물도 남긴다 (그림은 다시 그리지 않는다)
        buildings: buildings.map(b => ({ id: b.id, name: b.name, ring: b.ring, floors: b.floors })),
      }));
    } catch (e) { /* 저장 실패는 치명적이지 않다 */ }
  }
  function load() {
    try {
      const st = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (!st) return;
      curType = Layout.PRESETS[st.curType] ? st.curType : 'slab';
      settings = Object.assign({ ginseng: {}, flush: {}, slab: {} }, st.settings || {});
      siteName = st.siteName || '';
      shade = Object.assign({ on: false, floorH: 3.5 }, st.shade || {});
      moduleCfg = Object.assign({}, MODULE_DEFAULT, st.moduleCfg || {});
      // 예전 저장본엔 형태별 설정에 모듈 치수가 들어 있다. 이제 공통값이라 걷어낸다.
      Object.values(settings).forEach(s => { delete s.moduleWp; delete s.modL; delete s.modS; });
      buildings = (st.buildings || []).map(b => ({ ...b, gfx: null }));
      roofs = (st.roofs || []).filter(r => r.points && r.points.length >= 3).map(r => ({ ...r, gfx: null }));
      if (roofs.length) selectedId = roofs[roofs.length - 1].id;   // 형태 버튼이 바로 먹도록 마지막 지붕을 선택해 둔다
    } catch (e) { roofs = []; }
  }
})();
