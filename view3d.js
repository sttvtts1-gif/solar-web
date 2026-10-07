/*
 * 3D 조감도 — 배치 결과를 three.js(r128, vendor/three.min.js, 오프라인)로 띄운다.
 *
 * 좌표: 지도 lat/lng → 미터 평면(x 동, y 북) → three 월드(x 동, y 위, z 남=-북).
 *   건물 지붕은 외곽선을 높이만큼 세우고 그 위에 모듈, 토지는 낮은 구조물(0.5m) 위에, 주차장은 캐노피(2.5m) 위에.
 *   모듈은 앞(남)쪽 변이 낮고 뒤쪽 변이 경사길이×sin(경사각)만큼 올라간 판. 수천 장이라 한 덩어리 geometry 로 합친다.
 *   주변 건물(음영용으로 받아 둔 것)은 회색 상자로. 태양은 남동쪽 위에서 비추고 그림자를 떨어뜨린다.
 * 조작: 끌기 = 회전, 휠·두 손가락 = 확대/축소, 자동회전 버튼, 📷 저장(PNG).
 *
 * View3D.open(data)  data = { origin:{lat,lng}, roofs:[{ name, type, rings:[[{lat,lng}]], baseH, modules:[[{lat,lng}×4]], rowAngle, tilt, dSlope, banned }],
 *                              buildings:[{ ring, h }] }
 */
const View3D = (() => {
  let renderer = null, scene, camera, raf = 0, auto = false;
  const view = { az: -35, el: 35, dist: 100, target: null };

  const M_LAT = 110574, M_LNG = lat => 111320 * Math.cos(lat * Math.PI / 180);

  /** 건축물대장 지붕재·구조 글자로 색을 고른다. 모르면 무난한 회색. */
  function colorsOf(mat) {
    const r = (mat && mat.roof) || '', s = (mat && mat.structure) || '';
    let roof = 0xaeb6c2, roof2 = 0x98a1ad, wall = 0xd9d4c7;
    if (/기와/.test(r)) { roof = 0x8a4a3a; roof2 = 0x74392c; }
    else if (/징크|아연/.test(r)) { roof = 0x7a7f85; roof2 = 0x676c72; }
    else if (/슁글|아스팔트/.test(r)) { roof = 0x4f4f52; roof2 = 0x3f3f42; }
    else if (/판넬|패널|샌드위치|금속|철판|강판|칼라/.test(r)) { roof = 0x6f8fb5; roof2 = 0x5c7a9e; }
    else if (/슬래브|슬라브|콘크리트|평지붕/.test(r)) { roof = 0xb9b9b4; roof2 = 0xa6a6a1; }
    if (/벽돌|조적/.test(s)) wall = 0xb36b4f;
    else if (/콘크리트|철근/.test(s)) wall = 0xcfcac0;
    else if (/철골|판넬|패널|경량/.test(s)) wall = 0xdfe3e8;
    else if (/목구조|목조/.test(s)) wall = 0xc9a977;
    return { roof, roof2, wall };
  }

  // 모듈 셀 무늬(6×12 셀, 은색 선) — 캔버스로 만들어 텍스처로 쓴다(외부 그림 없이 오프라인)
  let moduleTex = null;
  function moduleTexture() {
    if (moduleTex) return moduleTex;
    const c = document.createElement('canvas'); c.width = 128; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#0f1f5a'; g.fillRect(0, 0, 128, 256);
    g.strokeStyle = '#8fa0c8'; g.lineWidth = 2;
    for (let i = 0; i <= 6; i++) { g.beginPath(); g.moveTo(i * 128 / 6, 0); g.lineTo(i * 128 / 6, 256); g.stroke(); }
    for (let j = 0; j <= 12; j++) { g.beginPath(); g.moveTo(0, j * 256 / 12); g.lineTo(128, j * 256 / 12); g.stroke(); }
    g.strokeStyle = '#d0d6e0'; g.lineWidth = 4; g.strokeRect(1, 1, 126, 254);
    moduleTex = new THREE.CanvasTexture(c);
    return moduleTex;
  }
  // 바닥: 흙·풀 얼룩
  function groundTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#8b9a74'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1400; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(90,110,70,.35)' : 'rgba(170,160,120,.3)'; g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 4, 2 + Math.random() * 4); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(200, 200);
    return t;
  }
  function local(ring, o) { const k = M_LNG(o.lat); return ring.map(p => ({ x: (p.lng - o.lng) * k, y: (p.lat - o.lat) * M_LAT })); }

  function extrude(ringXY, h, color, opacity) {
    const shape = new THREE.Shape(ringXY.map(p => new THREE.Vector2(p.x, p.y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.05, h), bevelEnabled: false });
    const mat = new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;      // 모양의 y(북) → 월드 -z, 돌출(z) → 위(y)
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  const rot = (p, deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }; };

  /**
   * 지붕면 높이 함수. 건물 축(buildingAngle)으로 돌린 틀에서
   *   gable-ew: 남북 깊이를 spans 개 경간으로 나누고 경간 가운데가 용마루(동서) — 원단 남북지붕
   *   gable-ns: 동서 폭을 spans 개 동으로 나누고 동 가운데가 용마루(남북) — 인삼밭 동서지붕
   *   flat    : 처마 높이 그대로
   * 처마(벽) 높이 = baseH, 용마루 = baseH + 반폭 × tan(지붕 경사).
   */
  function roofSurface(roof, o) {
    const xy = local(roof.rings[0], o);
    const r = xy.map(p => rot(p, -roof.buildingAngle));
    const minX = Math.min(...r.map(p => p.x)), maxX = Math.max(...r.map(p => p.x)), minY = Math.min(...r.map(p => p.y)), maxY = Math.max(...r.map(p => p.y));
    const n = Math.max(1, roof.spans | 0), t = Math.tan((roof.roofSlope || 0) * Math.PI / 180);
    const cx = xy.reduce((a, p) => a + p.x, 0) / xy.length, cy = xy.reduce((a, p) => a + p.y, 0) / xy.length;
    const z = p => {
      if (roof.grad) return roof.baseH + roof.grad.gE * (p.x - cx) + roof.grad.gN * (p.y - cy);   // 토지: 기울어진 지면
      if (roof.kind === 'flat' || !t) return roof.baseH;
      const q = rot(p, -roof.buildingAngle);
      if (roof.kind === 'gable-ew') { const D = (maxY - minY) / n, u = ((q.y - minY) % D + D) % D; return roof.baseH + (D / 2 - Math.abs(u - D / 2)) * t; }
      const W = (maxX - minX) / n, u = ((q.x - minX) % W + W) % W; return roof.baseH + (W / 2 - Math.abs(u - W / 2)) * t;
    };
    // 모듈이 놓이는 면. 지붕면(z)과 다르다:
    //   gable-ew(원단): 경간마다 남쪽 처마에서 북쪽 끝까지 지붕 경사 그대로 한 면으로 이어진다 → 남쪽 면은 지붕에 밀착, 북쪽 면 블록은
    //                  남향을 유지한 채 뒤가 들린다(단면도: 북측 끝 들어올림).
    //   gable-ns(동서지붕 인삼밭): 용마루 높이의 수평 프레임 위에 2단 거치.
    //   그 외: 지붕면 그대로.
    const modZ = p => {
      if (roof.kind === 'gable-ew' && t) { const q = rot(p, -roof.buildingAngle); const D = (maxY - minY) / n, u = ((q.y - minY) % D + D) % D; return roof.baseH + u * t; }
      if (roof.kind === 'gable-ns' && t) { const W = (maxX - minX) / n; return roof.baseH + W / 2 * t; }
      return z(p);
    };
    return { z, modZ, minX, maxX, minY, maxY, n, t };
  }

  /** 토지 필지를 지면 기울기대로 깐 판(두께 없음). 삼각분할 후 꼭짓점마다 높이. */
  function slopedPlate(xy, zf, color) {
    const tri = THREE.ShapeUtils.triangulateShape(xy.map(p => new THREE.Vector2(p.x, p.y)), []);
    const pos = [], idx = [];
    xy.forEach(p => pos.push(p.x, zf(p) - 0.35, -p.y));
    tri.forEach(t => idx.push(t[0], t[1], t[2]));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    return m;
  }

  /** 박공지붕 면 + 박공벽(삼각). 건물 외접상자 기준이라 네모 건물에 잘 맞는다. */
  function gableMesh(roof, o, surf) {
    const pos = [], idx = [], col = [];
    const push = (pts, color) => { const b = pos.length / 3; pts.forEach(p => { const w = rot({ x: p.x, y: p.y }, roof.buildingAngle); pos.push(w.x, p.z, -w.y); col.push(color.r, color.g, color.b); }); for (let i = 1; i + 1 < pts.length; i++) idx.push(b, b + i, b + i + 1); };
    const cs = colorsOf(roof.mat);
    const face = new THREE.Color(cs.roof), face2 = new THREE.Color(cs.roof2), wall = new THREE.Color(cs.wall);
    const { minX, maxX, minY, maxY, n, t } = surf, h0 = roof.baseH;
    if (roof.kind === 'gable-ew') {
      const D = (maxY - minY) / n, hr = h0 + D / 2 * t;
      for (let i = 0; i < n; i++) {
        const y0 = minY + i * D, yc = y0 + D / 2, y1 = y0 + D;
        push([{ x: minX, y: y0, z: h0 }, { x: maxX, y: y0, z: h0 }, { x: maxX, y: yc, z: hr }, { x: minX, y: yc, z: hr }], face);      // 남쪽 면
        push([{ x: minX, y: yc, z: hr }, { x: maxX, y: yc, z: hr }, { x: maxX, y: y1, z: h0 }, { x: minX, y: y1, z: h0 }], face2);     // 북쪽 면
        push([{ x: minX, y: y0, z: h0 }, { x: minX, y: yc, z: hr }, { x: minX, y: y1, z: h0 }], wall);                                  // 박공벽 서
        push([{ x: maxX, y: y1, z: h0 }, { x: maxX, y: yc, z: hr }, { x: maxX, y: y0, z: h0 }], wall);                                  // 박공벽 동
      }
    } else {
      const W = (maxX - minX) / n, hr = h0 + W / 2 * t;
      for (let i = 0; i < n; i++) {
        const x0 = minX + i * W, xc = x0 + W / 2, x1 = x0 + W;
        push([{ x: x0, y: minY, z: h0 }, { x: xc, y: minY, z: hr }, { x: xc, y: maxY, z: hr }, { x: x0, y: maxY, z: h0 }], face);      // 서쪽 면
        push([{ x: xc, y: minY, z: hr }, { x: x1, y: minY, z: h0 }, { x: x1, y: maxY, z: h0 }, { x: xc, y: maxY, z: hr }], face2);     // 동쪽 면
        push([{ x: x0, y: minY, z: h0 }, { x: x1, y: minY, z: h0 }, { x: xc, y: minY, z: hr }], wall);                                  // 박공벽 남
        push([{ x: x1, y: maxY, z: h0 }, { x: x0, y: maxY, z: h0 }, { x: xc, y: maxY, z: hr }], wall);                                  // 박공벽 북
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  /** 모듈 판 전부를 하나의 geometry 로. 각 판: 지붕면 높이 + 0.3, 뒤 두 꼭짓점은 경사각만큼 더 올린다. */
  function modulesMesh(roof, o, surf) {
    const th = roof.rowAngle * Math.PI / 180, fx = Math.sin(th), fy = -Math.cos(th);   // 앞면이 보는 방향
    const rise = roof.dSlope * Math.sin(roof.tilt * Math.PI / 180);
    const pos = [], idx = [], uv = [];
    roof.modules.forEach(m => {
      const c = local(m, o);
      const s = c.map(p => p.x * fx + p.y * fy);
      const order = [0, 1, 2, 3].sort((a, b) => s[b] - s[a]);
      const front = new Set(order.slice(0, 2));
      const base = pos.length / 3;
      // 원단(tilt 0)은 지붕면에 밀착(0.12m), 거치는 구조물 위(0.3m) + 뒤쪽을 경사각만큼
      const lift = roof.tilt ? 0.3 : 0.5;    // 원단(tilt 0)은 앞다리 0.5m 로 띄움(사용자 지정)
      c.forEach((p, i) => { pos.push(p.x, surf.modZ(p) + lift + (front.has(i) ? 0 : rise), -p.y); uv.push(i === 0 || i === 3 ? 0 : 1, front.has(i) ? 0 : 1); });
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ map: moduleTexture(), color: roof.banned ? 0xff8080 : 0xffffff, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  function build(data) {
    const o = data.origin;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbfdcf3);
    scene.fog = new THREE.Fog(0xbfdcf3, 500, 1800);
    scene.add(new THREE.HemisphereLight(0xdfefff, 0x6b7a55, 0.75));   // 하늘빛 + 땅 반사
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.9);
    sun.position.set(120, 220, 160);                 // 남동쪽 위 (z+ 가 남)
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -400; sc.right = 400; sc.top = 400; sc.bottom = -400; sc.near = 1; sc.far = 1000;
    scene.add(sun);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ map: groundTexture() }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(2000, 200, 0x7a8a6a, 0x7a8a6a);
    grid.material.opacity = 0.25; grid.material.transparent = true; grid.position.y = 0.02;
    scene.add(grid);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxH = 5;
    const ext = pts => pts.forEach(p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });

    (data.buildings || []).forEach(b => {
      const xy = local(b.ring, o);          // 주변 건물은 카메라 범위에 넣지 않는다(배치 지붕이 작게 보이지 않게)
      scene.add(extrude(xy, b.h, 0xbfc3c9, 1));
      maxH = Math.max(maxH, b.h);
    });
    data.roofs.forEach(r => {
      const surf = roofSurface(r, o);
      r.rings.forEach(rg => {
        const xy = local(rg, o); ext(xy);
        if (r.type === 'ground') scene.add(r.grad ? slopedPlate(xy, surf.z, r.banned ? 0xc96a6a : 0xb9a77a) : extrude(xy, 0.15, r.banned ? 0xc96a6a : 0xb9a77a, 0.95));
        else if (r.type === 'parking') { scene.add(extrude(xy, 0.1, 0x9a9a9a, 1)); const top = extrude(xy, 0.15, 0x6d7f99, 0.85); top.position.y = r.baseH; scene.add(top); }
        else {
          const cs = colorsOf(r.mat);
          scene.add(extrude(xy, r.baseH, cs.wall, 1));                                // 벽(처마 높이까지)
          if (r.kind === 'flat') { const top = extrude(xy, 0.12, cs.roof, 1); top.position.y = r.baseH; scene.add(top); }   // 평지붕 면
        }
      });
      if (r.kind !== 'flat' && surf.t) scene.add(gableMesh(r, o, surf));           // 박공지붕
      if (r.modules && r.modules.length) scene.add(modulesMesh(r, o, surf));
      maxH = Math.max(maxH, r.baseH + (surf.t ? Math.max(surf.maxX - surf.minX, surf.maxY - surf.minY) / surf.n / 2 * surf.t : 0));
    });
    if (!isFinite(minX)) { minX = -50; maxX = 50; minY = -50; maxY = 50; }
    view.target = new THREE.Vector3((minX + maxX) / 2, maxH / 2, -(minY + maxY) / 2);
    view.dist = Math.max(60, Math.hypot(maxX - minX, maxY - minY) * 1.1);
  }

  function place() {
    const a = view.az * Math.PI / 180, e = view.el * Math.PI / 180;
    // az 0 = 남쪽에서 본다(+z), 양수면 동쪽으로 돈다
    camera.position.set(view.target.x + view.dist * Math.cos(e) * Math.sin(a), view.target.y + view.dist * Math.sin(e), view.target.z + view.dist * Math.cos(e) * Math.cos(a));
    camera.lookAt(view.target);
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (auto) view.az += 0.15;
    place();
    renderer.render(scene, camera);
  }

  function bindControls(el) {
    const ptrs = new Map();
    let last = null, pinch = 0;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', e => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); auto = false; });
    el.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) {
        const [p, q] = [...ptrs.values()];
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (pinch) view.dist = Math.max(20, Math.min(3000, view.dist * pinch / d));
        pinch = d; return;
      }
      if (!last) return;
      view.az += (e.clientX - last.x) * 0.4;
      view.el = Math.max(5, Math.min(89, view.el + (e.clientY - last.y) * 0.3));
      last = { x: e.clientX, y: e.clientY };
    });
    const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = 0; if (!ptrs.size) last = null; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => { e.preventDefault(); view.dist = Math.max(20, Math.min(3000, view.dist * (e.deltaY > 0 ? 1.12 : 0.9))); }, { passive: false });
  }

  function open(data) {
    const modal = document.getElementById('view3dModal'), host = document.getElementById('v3d_host');
    modal.classList.add('on');
    close(true);
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.shadowMap.enabled = true;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.innerHTML = '';
    host.appendChild(renderer.domElement);
    const fit = () => { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; camera.aspect = w / h; camera.updateProjectionMatrix(); };
    camera = new THREE.PerspectiveCamera(50, 1, 0.5, 5000);
    build(data);
    view.az = -35; view.el = 35; auto = false;
    fit();
    window.addEventListener('resize', fit);
    renderer.domElement.__fit = fit;
    bindControls(renderer.domElement);
    loop();
  }

  function close(keepModal) {
    if (raf) cancelAnimationFrame(raf); raf = 0;
    if (renderer) { window.removeEventListener('resize', renderer.domElement.__fit); renderer.dispose(); renderer.domElement.remove(); renderer = null; }
    if (!keepModal) document.getElementById('view3dModal').classList.remove('on');
  }

  function snapshot() {
    if (!renderer) return null;
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  }

  return { open, close, snapshot, toggleAuto: () => { auto = !auto; return auto; } };
})();
