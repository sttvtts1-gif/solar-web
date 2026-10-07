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

  /** 모듈 판 전부를 하나의 geometry 로. 각 판: 앞 두 꼭짓점 base, 뒤 두 꼭짓점 base+rise. */
  function modulesMesh(roof, o) {
    const th = roof.rowAngle * Math.PI / 180, fx = Math.sin(th), fy = -Math.cos(th);   // 앞면이 보는 방향
    const rise = roof.dSlope * Math.sin(roof.tilt * Math.PI / 180);
    const pos = [], idx = [];
    roof.modules.forEach(m => {
      const c = local(m, o);
      const s = c.map(p => p.x * fx + p.y * fy);
      const order = [0, 1, 2, 3].sort((a, b) => s[b] - s[a]);
      const front = new Set(order.slice(0, 2));
      const base = pos.length / 3;
      c.forEach((p, i) => pos.push(p.x, roof.baseH + 0.3 + (front.has(i) ? 0 : rise), -p.y));
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: roof.banned ? 0x7a2a2a : 0x1b2f7a, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  function build(data) {
    const o = data.origin;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcfe3f5);
    scene.fog = new THREE.Fog(0xcfe3f5, 600, 2000);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.9);
    sun.position.set(120, 220, 160);                 // 남동쪽 위 (z+ 가 남)
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -400; sc.right = 400; sc.top = 400; sc.bottom = -400; sc.near = 1; sc.far = 1000;
    scene.add(sun);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: 0x8e9b7a }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(2000, 200, 0x7a8a6a, 0x7a8a6a);
    grid.material.opacity = 0.25; grid.material.transparent = true; grid.position.y = 0.02;
    scene.add(grid);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxH = 5;
    const ext = pts => pts.forEach(p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });

    (data.buildings || []).forEach(b => {
      const xy = local(b.ring, o); ext(xy);
      scene.add(extrude(xy, b.h, 0xbfc3c9, 1));
      maxH = Math.max(maxH, b.h);
    });
    data.roofs.forEach(r => {
      r.rings.forEach(rg => {
        const xy = local(rg, o); ext(xy);
        if (r.type === 'ground') scene.add(extrude(xy, 0.15, r.banned ? 0xc96a6a : 0xb9a77a, 0.95));
        else if (r.type === 'parking') { scene.add(extrude(xy, 0.1, 0x9a9a9a, 1)); const top = extrude(xy, 0.15, 0x6d7f99, 0.85); top.position.y = r.baseH; scene.add(top); }
        else scene.add(extrude(xy, r.baseH, 0xd9d4c7, 1));
      });
      if (r.modules && r.modules.length) scene.add(modulesMesh(r, o));
      maxH = Math.max(maxH, r.baseH);
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
    const fit = () => { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
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
