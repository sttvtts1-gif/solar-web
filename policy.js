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
    document.querySelectorAll('.pTable th[data-sort]').forEach(th => th.onclick = () => {
      if (sortKey === th.dataset.sort) sortDir = sortDir === 'desc' ? 'asc' : 'desc'; else { sortKey = th.dataset.sort; sortDir = 'desc'; }
      render();
    });
    $('pm_close').onclick = () => Policy.close();
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

  // ------------------------------------------------------------ 목록 (검색어플과 같은 표: 파일명 · 일자 · 검색 문맥/페이지 · 관리)
  let sortDir = "desc";
  function render() {
    const kw = keyword.trim();
    let list = kw ? docs.filter(d => fuzzyIncludes(d.name, kw) || fuzzyIncludes(d.content, kw)) : docs.slice();
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => sortKey === "name" ? dir * String(a.name).localeCompare(String(b.name)) : dir * ((a.timestamp || 0) - (b.timestamp || 0)));
    $("p_count").textContent = list.length + " DOCUMENTS LOADED";
    document.querySelectorAll(".pTable th[data-sort] em").forEach(e => { e.textContent = e.parentNode.dataset.sort === sortKey ? (sortDir === "desc" ? "▼" : "▲") : ""; });
    const box = $("p_list");
    box.innerHTML = "";
    if (!list.length) { box.innerHTML = "<tr><td colspan=\"4\" style=\"text-align:center;color:#94a3b8;padding:24px\">" + (docs.length ? "검색 결과가 없습니다." : "표시할 문서가 없습니다.") + "</td></tr>"; return; }
    list.forEach(d => {
      let snippetSrc = d.content || "", pages = [];
      if (kw && d.isPdf && d.pages.length) { pages = d.pages.filter(p => fuzzyIncludes(p.text, kw)); if (pages.length) snippetSrc = pages[0].text; }
      const r = kw ? matchRanges(snippetSrc, kw, 1)[0] : null;
      const snippet = r ? "…" + snippetSrc.slice(Math.max(0, r.start - 50), r.start + 80) + "…" : snippetSrc.slice(0, 100) + (snippetSrc.length > 100 ? "…" : "");
      const tr = document.createElement("tr");
      tr.innerHTML = "<td class=\"nm\">" + highlight(d.name, kw) + "</td><td class=\"dt\">" + d.date + "</td>"
        + "<td class=\"ctx\">" + (pages.length ? "<div class=\"pages\">" + pages.map(p => "<button data-p=\"" + p.page + "\">P." + p.page + "</button>").join("") + "</div>" : "") + highlight(snippet, kw) + "</td>"
        + "<td class=\"acts\"><button data-act=\"open\" title=\"보기\">👁</button><button data-act=\"del\" class=\"del\" title=\"삭제\">🗑</button></td>";
      tr.querySelectorAll("[data-p]").forEach(btn => btn.onclick = () => showPage(d, +btn.dataset.p, kw));
      tr.querySelector("[data-act=open]").onclick = () => openFile(d);
      tr.querySelector("[data-act=del]").onclick = () => remove(d.id);
      box.appendChild(tr);
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

  // ------------------------------------------------------------ 문서 보기
  // 모든 페이지를 세로로 이어 붙여 손가락으로 쭉 내려 본다(한 장씩 넘기지 않음).
  // 페이지 자리(빈 상자)는 처음에 한꺼번에 깔고, 실제 그림은 화면 근처(위아래 1.5화면)에 들어온 페이지만 그린다
  // → 수십 쪽 문서도 바로 열리고 내리는 동안 차례로 채워진다. 검색어가 있으면 그 자리에 형광펜.
  let viewer = null;          // { pdf, d, kw, observer }
  async function showPage(d, pageNum, kw) {
    const box = $('pageModal').querySelector('.box');
    $('pm_title').textContent = d.name;
    $('pm_body').innerHTML = '문서 여는 중…';
    $('pageModal').classList.add('on');
    if (viewer && viewer.observer) viewer.observer.disconnect();
    try {
      const pdf = await pdfjsLib.getDocument({ data: d.data.slice(0) }).promise;
      const first = await pdf.getPage(1);
      const ratio = first.getViewport({ scale: 1 }).height / first.getViewport({ scale: 1 }).width;   // 자리 높이 잡기용
      const body = $('pm_body');
      body.innerHTML = '';
      const pages = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const wrap = document.createElement('div');
        wrap.className = 'pdfPage';
        wrap.dataset.page = n;
        // 높이는 aspect-ratio(오래된 안드로이드 웹뷰는 모름) 대신 폭 × 비율을 숫자로 넣는다
        wrap.style.cssText = 'position:relative;width:100%;background:#fff;border-radius:6px;margin:0 0 10px;overflow:hidden';
        wrap.innerHTML = '<span style="position:absolute;top:6px;right:8px;font-size:11px;color:#94a3b8;z-index:1">' + n + ' / ' + pdf.numPages + '</span>';
        body.appendChild(wrap);
        pages.push(wrap);
      }
      const sizePages = () => { const w = body.clientWidth || box.clientWidth - 24; pages.forEach(p => { p.style.height = Math.round(w * ratio) + 'px'; }); };
      sizePages();
      window.onresize = () => { if (viewer) { sizePages(); drawNear(); } };
      // 지금 몇 쪽을 보고 있는지 제목줄에
      const updateTitle = () => {
        const top = box.getBoundingClientRect().top + 60;
        let cur = 1;
        for (const w of pages) { if (w.getBoundingClientRect().top <= top) cur = +w.dataset.page; else break; }
        if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4) cur = pdf.numPages;   // 맨 끝에 닿으면 마지막 쪽
        $('pm_title').textContent = d.name + ' — ' + cur + ' / ' + pdf.numPages;
      };
      // 화면(상자) 위아래 1.5배 안에 걸친 페이지만 그린다. 스크롤 때마다 위치를 직접 잰다
      // (IntersectionObserver 는 오래된 웹뷰·가려진 창에서 안 움직여서 쓰지 않음).
      const drawn = new Set();
      const drawNear = () => {
        const r = box.getBoundingClientRect(), pad = r.height * 1.5;
        pages.forEach(w => { const p = w.getBoundingClientRect(); if (p.bottom > r.top - pad && p.top < r.bottom + pad) drawPage(pdf, w, kw, drawn); });
      };
      let ticking = false;
      box.onscroll = () => { updateTitle(); if (!ticking) { ticking = true; setTimeout(() => { ticking = false; drawNear(); }, 80); } };
      viewer = { pdf, d, kw, observer: null };

      // 검색 결과의 P.n 을 눌러 열었으면 그 페이지로 바로
      if (pageNum > 1) { pages[pageNum - 1].scrollIntoView({ block: 'start' }); }
      else box.scrollTop = 0;
      updateTitle();
      drawNear();
    } catch (e) { $('pm_body').textContent = '문서를 열 수 없습니다: ' + e.message + ' (회사 문서보안으로 암호화된 PDF 일 수 있습니다)'; }
  }

  async function drawPage(pdf, wrap, kw, drawn) {
    const n = +wrap.dataset.page;
    if (drawn.has(n)) return;
    drawn.add(n);
    try {
      const page = await pdf.getPage(n);
      const scale = Math.min(2, (wrap.clientWidth * (window.devicePixelRatio || 1)) / page.getViewport({ scale: 1 }).width);
      const vp = page.getViewport({ scale });
      const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      cv.style.cssText = 'width:100%;height:100%;display:block';
      const c = cv.getContext('2d');
      await page.render({ canvasContext: c, viewport: vp }).promise;
      if (kw && kw.trim()) {
        const tc = await page.getTextContent();
        let joined = ''; const ranges = [];
        tc.items.forEach((it, idx) => { const st = joined.length; joined += it.str || ''; ranges.push({ st, en: joined.length, idx }); joined += ' '; });
        const ms = matchRanges(joined, kw, 200);
        if (ms.length) {
          c.save(); c.globalCompositeOperation = 'multiply'; c.fillStyle = '#fde68a';
          ranges.forEach(({ st, en, idx }) => {
            if (!ms.some(m => st < m.end && en > m.start)) return;
            const it = tc.items[idx];
            const t = pdfjsLib.Util.transform(vp.transform, it.transform);
            const fh = Math.hypot(t[2], t[3]) || 10, sx = Math.hypot(t[0], t[1]) || 1;
            c.fillRect(t[4] - 2, t[5] - fh - 2, Math.max(it.width * sx, fh * 0.6) + 4, fh + 4);
          });
          c.restore();
        }
      }
      wrap.appendChild(cv);
    } catch (e) { drawn.delete(n); }
  }

  const closeViewer = () => { $('pageModal').classList.remove('on'); if (viewer && viewer.observer) viewer.observer.disconnect(); viewer = null; $('pm_body').innerHTML = ''; };
  return { init, isOpen: () => $('pageModal').classList.contains('on'), close: closeViewer };
})();
