/*
 * 제도변경 문서 저장소 — 검색어플 '제도변경' 탭 이식.
 *
 * 파일을 이 기기의 IndexedDB 에 넣고(PDF 는 pdf.js 로 페이지별 본문을 뽑아 둔다), 띄어쓰기 무관으로 검색해
 * 단어가 나온 페이지 번호를 보여주고, 누르면 그 페이지를 그림으로 그려 검색어에 형광펜을 칠해 보여준다.
 * 서버 없음. 폰마다 따로 저장된다.
 */
const Policy = (() => {
  const $ = id => document.getElementById(id);
  const DB_NAME = 'solar.policy.v1';
  let db = null, docs = [], keyword = '', sortKey = 'timestamp';

  // ------------------------------------------------------------ 띄어쓰기 무관 검색
  const stripSpace = s => String(s || '').replace(/\s+/g, '');
  const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function indexMap(text) { const m = []; for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) m.push(i); return m; }
  function fuzzyIncludes(text, kw) { const k = stripSpace(kw).toLowerCase(); return !!k && stripSpace(text).toLowerCase().includes(k); }
  // 원문 기준 매칭 구간들
  function matchRanges(text, kw, limit) {
    const str = String(text || ''), k = stripSpace(kw).toLowerCase();
    if (!k) return [];
    const stripped = stripSpace(str).toLowerCase(), map = indexMap(str), out = [];
    let from = 0;
    while (out.length < (limit || 200)) {
      const i = stripped.indexOf(k, from);
      if (i < 0) break;
      const s = map[i], e = map[i + k.length - 1];
      if (s === undefined || e === undefined) break;
      out.push({ start: s, end: e + 1 });
      from = i + k.length;
    }
    return out;
  }
  function highlight(text, kw) {
    const str = String(text || ''), rs = matchRanges(str, kw, 50);
    if (!rs.length) return esc(str);
    let h = '', last = 0;
    rs.forEach(r => { h += esc(str.slice(last, r.start)) + '<mark>' + esc(str.slice(r.start, r.end)) + '</mark>'; last = r.end; });
    return h + esc(str.slice(last));
  }

  // ------------------------------------------------------------ 저장소
  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => { const d = e.target.result; if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' }); };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }
  const tx = (mode, fn) => new Promise((resolve, reject) => { const t = db.transaction('files', mode); const r = fn(t.objectStore('files')); t.oncomplete = () => resolve(r && r.result); t.onerror = e => reject(e.target.error); });

  async function init() {
    try {
      db = await open();
      const all = await new Promise((res, rej) => { const r = db.transaction('files', 'readonly').objectStore('files').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
      docs = all;
    } catch (e) { status('저장소를 열 수 없습니다: ' + e.message); }
    $('p_file').addEventListener('change', e => addFiles(Array.from(e.target.files || [])));
    $('p_q').addEventListener('input', () => { keyword = $('p_q').value; render(); });
    $('p_sort').addEventListener('change', () => { sortKey = $('p_sort').value; render(); });
    $('pm_close').onclick = () => $('pageModal').classList.remove('on');
    if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    render();
  }
  function status(m) { $('p_status').textContent = m || ''; }

  async function addFiles(files) {
    if (!files.length || !db) return;
    for (const f of files) {
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      status(f.name + ' 읽는 중…');
      const rec = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()), name: f.name, type: f.type || (isPdf ? 'application/pdf' : ''), date: new Date().toLocaleDateString(), timestamp: Date.now(), isPdf, content: '', pages: [] };
      try {
        const buf = await f.arrayBuffer();
        rec.data = buf;                         // 원본 바이트. 페이지 그릴 때 다시 쓴다.
        if (isPdf && window.pdfjsLib) {
          const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
          let full = '';
          for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const tc = await page.getTextContent();
            const t = tc.items.map(it => it.str).join(' ');
            rec.pages.push({ page: p, text: t });
            full += ' [Page ' + p + '] ' + t;
          }
          rec.content = full.slice(0, 500000);
        } else rec.content = '(문서 파일)';
        docs = docs.filter(d => d.name !== f.name);
        docs.push(rec);
        await tx('readwrite', s => s.put(rec));
        status(f.name + ' 저장 완료' + (rec.pages.length ? ' (' + rec.pages.length + '쪽)' : ''));
      } catch (e) { status(f.name + ' 저장 실패: ' + e.message); }
    }
    $('p_file').value = '';
    render();
    setTimeout(() => status(''), 2500);
  }
  async function remove(id) {
    if (!confirm('이 문서를 지울까요?')) return;
    docs = docs.filter(d => d.id !== id);
    await tx('readwrite', s => s.delete(id));
    render();
  }

  // ------------------------------------------------------------ 목록
  function render() {
    const kw = keyword.trim();
    let list = kw ? docs.filter(d => fuzzyIncludes(d.name, kw) || fuzzyIncludes(d.content, kw)) : docs.slice();
    list.sort((a, b) => sortKey === 'name' ? String(a.name).localeCompare(String(b.name)) : (b.timestamp || 0) - (a.timestamp || 0));
    const box = $('p_list');
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<p style="font-size:13px;color:var(--muted)">' + (docs.length ? '검색 결과가 없습니다.' : '저장된 문서가 없습니다.') + '</p>'; return; }
    list.forEach(d => {
      let snippetSrc = d.content || '', pages = [];
      if (kw && d.isPdf && d.pages.length) { pages = d.pages.filter(p => fuzzyIncludes(p.text, kw)); if (pages.length) snippetSrc = pages[0].text; }
      const r = kw ? matchRanges(snippetSrc, kw, 1)[0] : null;
      const snippet = r ? '…' + snippetSrc.slice(Math.max(0, r.start - 50), r.start + 80) + '…' : snippetSrc.slice(0, 100) + (snippetSrc.length > 100 ? '…' : '');
      const el = document.createElement('div');
      el.className = 'doc';
      el.innerHTML = '<div class="t"><b>' + highlight(d.name, kw) + '</b><small style="color:var(--muted)">' + d.date + '</small></div>'
        + '<div class="snip">' + highlight(snippet, kw) + '</div>'
        + (pages.length ? '<div class="pages">' + pages.map(p => '<button class="btn ghost" data-p="' + p.page + '">P.' + p.page + '</button>').join('') + '</div>' : '')
        + '<div class="row" style="margin:6px 0 0"><button class="btn sm ghost" data-act="open">열기</button><button class="btn sm danger" data-act="del">삭제</button></div>';
      el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => showPage(d, +b.dataset.p, kw));
      el.querySelector('[data-act=open]').onclick = () => openFile(d);
      el.querySelector('[data-act=del]').onclick = () => remove(d.id);
      box.appendChild(el);
    });
  }

  function openFile(d) {
    if (!d.data) return;
    if (d.isPdf) { showPage(d, 1, keyword); return; }
    const url = URL.createObjectURL(new Blob([d.data], { type: d.type || 'application/octet-stream' }));
    $('pm_title').textContent = d.name;
    $('pm_body').innerHTML = '<img src="' + url + '">';
    $('pageModal').classList.add('on');
  }

  // 페이지를 그림으로 그리고 검색어 자리에 형광펜. 조각으로 쪼개진 글자도 이어붙인 본문 기준으로 찾는다.
  async function showPage(d, pageNum, kw) {
    $('pm_title').textContent = d.name + ' — P.' + pageNum;
    $('pm_body').innerHTML = '페이지 그리는 중…';
    $('pageModal').classList.add('on');
    try {
      const pdf = await pdfjsLib.getDocument({ data: d.data.slice(0) }).promise;
      const page = await pdf.getPage(pageNum);
      const vp = page.getViewport({ scale: 1.6 });
      const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      const c = cv.getContext('2d');
      await page.render({ canvasContext: c, viewport: vp }).promise;
      if (kw && kw.trim()) {
        const tc = await page.getTextContent();
        let joined = ''; const ranges = [];
        tc.items.forEach((it, idx) => { const s = joined.length; joined += it.str || ''; ranges.push({ s, e: joined.length, idx }); joined += ' '; });
        const ms = matchRanges(joined, kw, 200);
        if (ms.length) {
          c.save(); c.globalCompositeOperation = 'multiply'; c.fillStyle = '#fde68a';
          ranges.forEach(({ s, e, idx }) => {
            if (!ms.some(m => s < m.end && e > m.start)) return;
            const it = tc.items[idx];
            const t = pdfjsLib.Util.transform(vp.transform, it.transform);
            const fh = Math.hypot(t[2], t[3]) || 10, sx = Math.hypot(t[0], t[1]) || 1;
            c.fillRect(t[4] - 2, t[5] - fh - 2, Math.max(it.width * sx, fh * 0.6) + 4, fh + 4);
          });
          c.restore();
        }
      }
      const nav = '<div class="row" style="margin-bottom:6px"><button class="btn sm ghost" id="pm_prev">◀ 이전</button><span style="font-size:12px;color:var(--muted)">' + pageNum + ' / ' + pdf.numPages + '</span><button class="btn sm ghost" id="pm_next">다음 ▶</button></div>';
      $('pm_body').innerHTML = nav;
      $('pm_body').appendChild(cv); cv.style.width = '100%'; cv.style.borderRadius = '8px'; cv.style.background = '#fff';
      $('pm_prev').onclick = () => pageNum > 1 && showPage(d, pageNum - 1, kw);
      $('pm_next').onclick = () => pageNum < pdf.numPages && showPage(d, pageNum + 1, kw);
    } catch (e) { $('pm_body').textContent = '페이지를 그릴 수 없습니다: ' + e.message; }
  }

  return { init, isOpen: () => $('pageModal').classList.contains('on'), close: () => $('pageModal').classList.remove('on') };
})();
