/*
 * NAS 폴더 저장 (PC 크롬·엣지 전용, 2026-10-16 / 10-20 주소로 스스로 찾기).
 *
 * 브라우저의 폴더 접근 기능(File System Access API)으로 사용자가 한 번 고른 폴더
 *   N:\02. 제안서작성            ← 여기를 고른다 (연도 폴더 "01. 제안서작성(2026년)" 를 골라도 된다)
 * 아래 연도 폴더 → 월 폴더("01.검토(10월)") → 현장 폴더("10-0102 경남 김해시 주촌면 골든루트로130번길 8 덕우") 를
 * **주소로 스스로 찾아** 파일을 쓴다. 없으면 올해 연도·이달 월 폴더에 "{상담번호} {주소} {업체명}" 폴더를 만든다.
 * 폴더 핸들은 IndexedDB 에 남겨 두어 다음에 다시 고르지 않아도 된다(권한 확인만).
 * 안드로이드 웹뷰·사파리에는 이 API 가 없어 안내만 한다.
 */
const Nas = (() => {
  const DB = 'solar.nas', STORE = 'handles';
  let root = null;

  const available = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  function idb() {
    return new Promise((res, rej) => {
      const q = indexedDB.open(DB, 1);
      q.onupgradeneeded = () => q.result.createObjectStore(STORE);
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
  }
  async function loadRoot() {
    if (root) return root;
    try {
      const db = await idb();
      root = await new Promise((res, rej) => { const t = db.transaction(STORE, 'readonly').objectStore(STORE).get('root'); t.onsuccess = () => res(t.result || null); t.onerror = () => rej(t.error); });
    } catch (e) { root = null; }
    return root;
  }
  async function saveRoot(h) {
    root = h;
    try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite').objectStore(STORE).put(h, 'root'); t.onsuccess = res; t.onerror = () => rej(t.error); }); } catch (e) {}
  }
  /** 폴더를 고른다(처음) 또는 저장된 폴더의 권한을 확인한다. 돌려주는 값: 폴더 핸들 */
  async function ensureRoot(forcePick) {
    if (!available()) throw new Error('이 브라우저는 폴더 저장을 지원하지 않습니다. PC 크롬·엣지에서 쓰세요.');
    let h = forcePick ? null : await loadRoot();
    if (h) {
      let p = await h.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted') p = await h.requestPermission({ mode: 'readwrite' });
      if (p === 'granted') return h;
    }
    h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'solar-nas' });
    await saveRoot(h);
    return h;
  }
  const clean = s => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();

  /**
   * 주소에서 폴더 이름과 맞춰 볼 조각: 끝의 번지(숫자-숫자)와 그 앞 리·동·로·길 이름. "경남 김해시 주촌면 골든루트로130번길 8" → ['8','골든루트로130번길']
   * 괄호·쉼표 뒤(건물명 등)는 뺀다. 번지가 없으면 마지막 두 어절.
   */
  function addrKeys(addr) {
    const a = String(addr || '').replace(/\(.*?\)/g, ' ').split(/[,\n]/)[0].trim().split(/\s+/).filter(Boolean);
    if (!a.length) return [];
    let i = a.length - 1;
    while (i > 0 && !/\d/.test(a[i])) i--;                       // 번지(숫자 있는 어절)를 뒤에서 찾는다
    const keys = /\d/.test(a[i]) ? [a[i], a[i - 1]].filter(Boolean) : a.slice(-2);
    return keys.map(norm);
  }
  async function dirs(h) { const out = []; for await (const [n, e] of h.entries()) if (e.kind === 'directory') out.push([n, e]); return out; }
  const yearOf = n => { const m = /제안서작성\((\d{4})년\)/.exec(n); return m ? +m[1] : 0; };

  /**
   * 현장 폴더를 주소로 찾는다. 연도(최근부터) → 월 → 현장 폴더 이름에 주소 조각이 다 들어 있으면 그것.
   * 없으면 올해 "01. 제안서작성(YYYY년)\01.검토(M월)" 안에 "{상담번호} {주소} {업체명}" 을 만든다.
   * @param {{addr, altAddr?, no?, name?}} o
   * @returns { dir, path, created, matched }
   */
  async function siteDir(o) {
    const r = o.__root || await ensureRoot();   // __root: 검사용
    // 고른 폴더가 현장 폴더 자체(예 "12-2932 경남 양산시 … 그린피엔텍")면 그대로 거기에 쓴다
    if (/^\d{2}-\d{4}\s/.test(r.name)) return { dir: r, path: r.name, created: false, matched: '지정 폴더' };
    const keySets = [o.addr, o.altAddr].filter(Boolean).map(addrKeys).filter(k => k.length);
    const noKey = o.no ? norm(o.no) : '';
    // 연도 폴더 목록: 고른 폴더가 연도 폴더 자체면 그것만
    let years = yearOf(r.name) ? [[r.name, r]] : (await dirs(r)).filter(([n]) => yearOf(n));
    years.sort((a, b) => yearOf(b[0]) - yearOf(a[0]));
    const searchYears = years.slice(0, 2);                       // 최근 2개 연도만 훑는다(NAS 가 느려서)
    if (!years.length) { const e = new Error('고른 폴더(' + r.name + ') 안에 "01. 제안서작성(YYYY년)" 폴더가 없습니다. 아래 「폴더 다시 고르기」로 N:\\02. 제안서작성 을 고르세요.'); e.repick = true; throw e; }
    for (const [yn, yh] of searchYears) {
      const months = (await dirs(yh)).filter(([n]) => /검토|\d+월/.test(n)).sort((a, b) => (parseInt((b[0].match(/\((\d+)월\)/) || [])[1] || 0, 10)) - (parseInt((a[0].match(/\((\d+)월\)/) || [])[1] || 0, 10)));
      for (const [mn, mh] of months) {
        for (const [sn, sh] of await dirs(mh)) {
          const ns = norm(sn);
          if (noKey && ns.startsWith(noKey)) return { dir: sh, path: yn + '/' + mn + '/' + sn, created: false, matched: '상담번호' };
          if (keySets.some(keys => keys.every(k => ns.includes(k)))) return { dir: sh, path: yn + '/' + mn + '/' + sn, created: false, matched: '주소' };
        }
      }
    }
    if (o.noCreate) return null;
    // 못 찾음 → 올해·이달에 새로
    const now = new Date(), Y = now.getFullYear(), M = now.getMonth() + 1;
    let yh = (years.find(([n]) => yearOf(n) === Y) || [])[1], yn = '01. 제안서작성(' + Y + '년)';
    if (!yh) yh = yearOf(r.name) ? r : await r.getDirectoryHandle(yn, { create: true }); else yn = years.find(([n]) => yearOf(n) === Y)[0];
    const months = await dirs(yh);
    let mm = months.find(([n]) => new RegExp('\\(' + M + '월\\)').test(n));
    const mn = mm ? mm[0] : '01.검토(' + M + '월)';
    const mh = mm ? mm[1] : await yh.getDirectoryHandle(mn, { create: true });
    const folder = clean([o.no || '', clean(String(o.addr || '').split(/[\n,]/)[0]), o.name || ''].filter(Boolean).join(' '));
    const dir = await mh.getDirectoryHandle(folder, { create: true });
    return { dir, path: yn + '/' + mn + '/' + folder, created: true, matched: '' };
  }
  async function write(dir, fileName, blobOrText) {
    const fh = await dir.getFileHandle(clean(fileName), { create: true });
    const w = await fh.createWritable();
    await w.write(blobOrText);
    await w.close();
  }
  const dataUrlBlob = u => { const [h, b] = u.split(','); const bin = atob(b); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: (h.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream' }); };

  return { available, ensureRoot, siteDir, write, dataUrlBlob, loadRoot, addrKeys };
})();
