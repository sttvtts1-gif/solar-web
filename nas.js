/*
 * NAS 폴더 저장 (PC 크롬·엣지 전용, 2026-10-16).
 *
 * 브라우저의 폴더 접근 기능(File System Access API)으로 사용자가 한 번 고른 폴더
 *   N:\02. 제안서작성\01. 제안서작성(2026년)
 * 아래에 "01.검토(N월)\{상담번호} {주소} {이름}" 폴더를 찾아(없으면 만들어) 파일을 쓴다.
 * 폴더 핸들은 IndexedDB 에 남겨 두어 다음에 다시 고르지 않아도 된다(권한 확인만).
 *
 * 상담번호(예 09-0101)는 상담일지 시트 A열. 앞 두 자리가 월 → "01.검토(9월)".
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
  const monthOf = no => parseInt(String(no).slice(0, 2), 10) || (new Date().getMonth() + 1);
  const clean = s => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();

  /**
   * 현장 폴더를 찾는다. 상담번호로 시작하는 폴더가 어느 월 폴더에든 있으면 그것. 없으면 상담번호 월의 "01.검토(N월)" 안에 만든다.
   * @returns { dir, path, created }
   */
  async function siteDir(no, addr, name) {
    const r = await ensureRoot();
    const key = clean(no);
    if (!key) throw new Error('상담번호가 없습니다.');
    const months = [];
    for await (const [n, h] of r.entries()) if (h.kind === 'directory') months.push([n, h]);
    for (const [mn, mh] of months) {
      for await (const [n, h] of mh.entries()) if (h.kind === 'directory' && n.startsWith(key)) return { dir: h, path: r.name + '/' + mn + '/' + n, created: false };
    }
    const want = '01.검토(' + monthOf(key) + '월)';
    let mh = (months.find(([n]) => n === want) || [])[1];
    if (!mh) mh = await r.getDirectoryHandle(want, { create: true });
    const folder = clean(key + ' ' + clean(addr) + (name ? ' ' + clean(name) : ''));
    const dir = await mh.getDirectoryHandle(folder, { create: true });
    return { dir, path: r.name + '/' + want + '/' + folder, created: true };
  }
  async function write(dir, fileName, blobOrText) {
    const fh = await dir.getFileHandle(clean(fileName), { create: true });
    const w = await fh.createWritable();
    await w.write(blobOrText);
    await w.close();
  }
  const dataUrlBlob = u => { const [h, b] = u.split(','); const bin = atob(b); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: (h.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream' }); };

  return { available, ensureRoot, siteDir, write, dataUrlBlob, loadRoot };
})();
