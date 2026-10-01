/*
 * 리포트 이미지 + 명함 첨부 메일. 검색어플의 "리포트 메일 발송"(html2canvas 캡처 + 명함) 을 옮긴 것.
 *
 * - APK: Native.mail() 이 캐시에 파일을 쓰고 메일 앱을 첨부와 함께 연다.
 * - 웹(PC/깃허브 페이지): mailto 는 첨부가 안 되므로 리포트·명함 두 장을 다운로드시키고 메일 작성창을 연다.
 *   (검색어플도 같은 방식이었다.)
 * 리포트는 html2canvas 없이 캔버스에 직접 그린다: 제목 · 대상지 · 핵심 수치 표 · 차트.
 */
const Report = (() => {
  const W = 1080, PAD = 48;
  let cardCache = null;

  function card() {
    if (cardCache) return Promise.resolve(cardCache);
    return fetch('businesscard.png').then(r => r.blob()).then(b => new Promise(res => {
      const rd = new FileReader(); rd.onload = () => { cardCache = rd.result; res(cardCache); }; rd.readAsDataURL(b);
    })).catch(() => null);
  }

  /**
   * @param spec { title, site, company, rows:[[label,value]...], table:{head:[], body:[[..]]}, chart:HTMLCanvasElement, notes:[] }
   */
  function draw(spec) {
    const lines = [];                      // 높이 계산을 위해 먼저 레이아웃을 잡는다
    let h = PAD;
    h += 56;                                // 제목
    h += 30;                                // 부제(대상지·날짜)
    h += 24;
    const rowH = 34;
    h += spec.rows.length * rowH + 20;
    const chartH = spec.chart ? Math.round((W - PAD * 2) * (spec.chart.height / spec.chart.width)) : 0;
    h += chartH ? chartH + 24 : 0;
    const tableRowH = 30;
    h += spec.table ? (spec.table.body.length + 1) * tableRowH + 20 : 0;
    const noteLines = (spec.notes || []).flatMap(n => wrap(n, 46));
    h += noteLines.length * 26 + (noteLines.length ? 20 : 0);
    h += 40;                                // 꼬리말
    h += PAD;

    const cv = document.createElement('canvas'); cv.width = W; cv.height = h;
    const c = cv.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, h);
    c.fillStyle = '#0b3d2e'; c.fillRect(0, 0, W, 12);
    let y = PAD + 8;
    c.fillStyle = '#0f172a'; c.font = 'bold 34px system-ui, "Malgun Gothic"'; c.textAlign = 'left';
    c.fillText(spec.title, PAD, y + 30); y += 56;
    c.fillStyle = '#64748b'; c.font = '18px system-ui, "Malgun Gothic"';
    c.fillText([spec.company, spec.site, new Date().toLocaleDateString()].filter(Boolean).join('  ·  '), PAD, y + 16); y += 30;
    c.strokeStyle = '#e2e8f0'; c.beginPath(); c.moveTo(PAD, y + 12); c.lineTo(W - PAD, y + 12); c.stroke(); y += 24;

    // 핵심 수치
    spec.rows.forEach(([l, v], i) => {
      c.fillStyle = i % 2 ? '#f8fafc' : '#ffffff'; c.fillRect(PAD, y, W - PAD * 2, rowH);
      c.fillStyle = '#475569'; c.font = '19px system-ui, "Malgun Gothic"'; c.textAlign = 'left'; c.fillText(l, PAD + 12, y + 23);
      c.fillStyle = '#0f172a'; c.font = 'bold 20px system-ui, "Malgun Gothic"'; c.textAlign = 'right'; c.fillText(v, W - PAD - 12, y + 23);
      y += rowH;
    });
    y += 20;

    if (spec.chart) {
      c.fillStyle = '#0b3d2e'; c.fillRect(PAD, y, W - PAD * 2, chartH);
      c.drawImage(spec.chart, PAD, y, W - PAD * 2, chartH);
      y += chartH + 24;
    }

    if (spec.table) {
      const cols = spec.table.head.length, cw = (W - PAD * 2) / cols;
      c.fillStyle = '#0b3d2e'; c.fillRect(PAD, y, W - PAD * 2, tableRowH);
      c.fillStyle = '#fff'; c.font = 'bold 16px system-ui, "Malgun Gothic"'; c.textAlign = 'center';
      spec.table.head.forEach((t, i) => c.fillText(t, PAD + cw * i + cw / 2, y + 20)); y += tableRowH;
      spec.table.body.forEach((r, ri) => {
        c.fillStyle = ri % 2 ? '#f8fafc' : '#fff'; c.fillRect(PAD, y, W - PAD * 2, tableRowH);
        c.fillStyle = '#0f172a'; c.font = '16px system-ui, "Malgun Gothic"';
        r.forEach((t, i) => { c.textAlign = i === 0 ? 'left' : 'right'; c.fillText(String(t), i === 0 ? PAD + 10 : PAD + cw * (i + 1) - 10, y + 20); });
        y += tableRowH;
      });
      y += 20;
    }

    if (noteLines.length) {
      c.fillStyle = '#334155'; c.font = '17px system-ui, "Malgun Gothic"'; c.textAlign = 'left';
      noteLines.forEach(l => { c.fillText(l, PAD, y + 18); y += 26; });
      y += 20;
    }
    c.fillStyle = '#94a3b8'; c.font = '15px system-ui, "Malgun Gothic"'; c.textAlign = 'left';
    c.fillText('그랜드썬기술단 · 태양광 배치분석 앱에서 생성. 수치는 입력 조건에 따른 추정치입니다.', PAD, y + 18);
    return cv.toDataURL('image/png');
  }
  function wrap(s, n) { const out = []; let t = String(s); while (t.length > n) { out.push('· ' + t.slice(0, n)); t = '  ' + t.slice(n); } out.push((out.length ? '' : '· ') + t); return out; }

  async function mail({ to, subject, body, spec }) {
    const report = draw(spec);
    const bc = await card();
    const files = [{ name: 'report.png', dataUrl: report }];
    if (bc) files.push({ name: 'businesscard.png', dataUrl: bc });
    if (window.Native && window.Native.mail) { window.Native.mail(to || '', subject, body, JSON.stringify(files)); return 'native'; }
    // 웹: 두 장 내려받고 메일창. 첨부는 사용자가 직접.
    files.forEach((f, i) => setTimeout(() => { const a = document.createElement('a'); a.href = f.dataUrl; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); }, i * 400));
    setTimeout(() => { location.href = 'mailto:' + encodeURIComponent(to || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body + '\n\n(리포트·명함 이미지는 다운로드 폴더에서 첨부해 주세요)'); }, 900);
    return 'web';
  }

  return { draw, mail };
})();
