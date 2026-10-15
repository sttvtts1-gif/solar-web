/*
 * 회원 로그인 게이트 (2026-10-16). 중계(KEPCO_PROXY, server/auth_pp.gs) 에 가입·로그인·확인을 묻는다.
 * 토큰은 localStorage 'solar.auth' 에 30일. 다른 중계 호출(상담일지·한전·파워플래너)에 token 을 같이 보낸다.
 *
 * 솔직한 한계: GitHub Pages 는 공개라 화면·코드는 누구나 볼 수 있다. 막히는 것은 "기능"(중계를 거치는 조회)이다.
 * 중계가 아직 auth 를 모르면(재배포 전) 막지 않고 경고만 한다.
 */
const Auth = (() => {
  const KEY = 'solar.auth';
  let me = null;
  const cfg = () => (window.SOLAR_CONFIG || {});
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const token = () => { const a = load(); return a && a.token && a.exp > Date.now() ? a.token : ''; };

  /** 중계에 묻기: POST(JSON, text/plain → 사전요청 없음) 먼저, 안 되면 JSONP GET */
  function call(params, timeoutMs) {
    const url = cfg().KEPCO_PROXY;
    if (!url) return Promise.reject(new Error('중계 주소(KEPCO_PROXY)가 없습니다'));
    const p = Object.assign({ token: token() }, params);
    const jsonp = () => new Promise((res, rej) => {
      const cb = '__au' + Date.now() + Math.floor(Math.random() * 1e4);
      const s = document.createElement('script');
      const done = () => { delete window[cb]; s.remove(); clearTimeout(t); };
      window[cb] = d => { done(); res(d); };
      s.onerror = () => { done(); rej(new Error('중계 서버에 닿지 못했습니다')); };
      const t = setTimeout(() => { done(); rej(new Error('중계 응답 시간 초과')); }, timeoutMs || 25000);
      s.src = url + '?' + Object.keys(p).map(k => k + '=' + encodeURIComponent(p[k])).join('&') + '&callback=' + cb;
      document.head.appendChild(s);
    });
    if (window.Native && window.NativeHttp) return window.NativeHttp.get(url + '?' + Object.keys(p).map(k => k + '=' + encodeURIComponent(p[k])).join('&'), '').catch(jsonp);
    return fetch(url, { method: 'POST', body: JSON.stringify(p), headers: { 'Content-Type': 'text/plain;charset=utf-8' } })
      .then(r => r.json()).catch(jsonp);
  }

  function show(msg, pending) {
    const m = document.getElementById('authModal'); if (!m) return;
    m.classList.add('on');
    const e = document.getElementById('au_msg'); if (e) { e.textContent = msg || ''; e.style.color = pending ? '#ffd54a' : '#ff8a80'; }
  }
  function hide() { const m = document.getElementById('authModal'); if (m) m.classList.remove('on'); }

  async function check() {
    const t = token();
    if (!t) { show(''); return false; }
    try {
      const d = await call({ path: 'auth', op: 'check' });
      if (d && d.ok) { me = d; hide(); return true; }
      if (d && /path/i.test(d.errMsg || '')) { me = { email: '(중계 미배포)' }; hide(); return true; }   // 아직 auth 를 모르는 옛 중계
      localStorage.removeItem(KEY); show(d && d.errMsg || '다시 로그인하세요'); return false;
    } catch (e) { show('중계 서버에 닿지 못했습니다: ' + e.message + ' — 다시 시도'); return false; }
  }
  async function login(email, pw) {
    const d = await call({ path: 'auth', op: 'login', email, pw });
    if (d && d.ok) { localStorage.setItem(KEY, JSON.stringify({ token: d.token, exp: d.exp, email: d.email, name: d.name })); me = d; hide(); return d; }
    if (d && /path/i.test(d.errMsg || '')) { show('중계가 아직 회원 기능을 모릅니다(Apps Script 재배포 필요). 지금은 그냥 들어갑니다.', true); setTimeout(hide, 2500); return { ok: true, legacy: true }; }
    show(d && d.errMsg || '로그인 실패', d && d.pending); return null;
  }
  async function signup(email, pw, name, company) {
    const d = await call({ path: 'auth', op: 'signup', email, pw, name, company });
    show(d && (d.msg || d.errMsg) || '가입 실패', !!(d && d.ok)); return d;
  }
  function logout() { const t = token(); localStorage.removeItem(KEY); me = null; if (t) call({ path: 'auth', op: 'logout', token: t }).catch(() => {}); show('로그아웃했습니다'); }

  function init() {
    const m = document.getElementById('authModal'); if (!m) return;
    const v = id => (document.getElementById(id) || {}).value || '';
    document.getElementById('au_login').onclick = async () => { show('확인 중…', true); try { await login(v('au_email').trim(), v('au_pw')); } catch (e) { show(e.message); } };
    document.getElementById('au_signup').onclick = async () => {
      if (!v('au_name').trim()) { show('이름을 넣으세요'); return; }
      show('신청 중…', true); try { await signup(v('au_email').trim(), v('au_pw'), v('au_name').trim(), v('au_company').trim()); } catch (e) { show(e.message); }
    };
    document.getElementById('au_pw').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('au_login').click(); });
    check();
  }
  return { init, check, login, signup, logout, token, call, get me() { return me; } };
})();
