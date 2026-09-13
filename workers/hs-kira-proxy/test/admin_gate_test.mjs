// 2026-09-13: 管理 API の門(header か cookie)・/hacker/report の閾値・管理画面の HTML エスケープの回帰試験。
// 実行: cd workers/hs-kira-proxy && node test/admin_gate_test.mjs  (Node 22 以上。KV と外向き fetch は偽物、本番には触らん)
import w from '../src/kira-proxy-v2.js';
const mem = new Map();
const kv = (name) => ({
  get: async (k, o) => { const v = mem.get(name+':'+k); if (v==null) return null; return (o && o.type==='json') ? JSON.parse(v) : v; },
  put: async (k, v) => { mem.set(name+':'+k, v); },
  delete: async (k) => { mem.delete(name+':'+k); },
  list: async () => ({ keys: [...mem.keys()].filter(x=>x.startsWith(name+':')).map(x=>({name:x.slice(name.length+1)})) }),
});
const env = { ADMIN_PASSWORD: 'pw-test-123', KIRA_STATS: kv('KS'), ORDERS: kv('OR'), SUBSCRIBERS: kv('SB'), LINE_CHANNEL_TOKEN:'x', LINE_USER_ID:'y' };
globalThis.fetch = async (u, o) => ({ ok: true, status: 200, json: async () => ({ coefficient: 1.0 }), text: async () => '' }); // outbound stub (LINE/price-sync)
const base = 'https://hs-kira-proxy.oga-surf-project.workers.dev';
const call = async (path, { method='POST', body, headers={}, origin } = {}) => {
  const h = new Headers({ 'Content-Type':'application/json', ...headers }); if (origin) h.set('Origin', origin);
  const req = new Request(base+path, { method, headers: h, body: body===undefined?undefined:JSON.stringify(body) });
  const r = await w.fetch(req, env, { waitUntil(){} });
  let t=''; try { t = await r.text(); } catch {}
  return { status: r.status, body: t.slice(0,120) };
};
const cookieVal = async () => { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hs-admin-cookie-v1:'+env.ADMIN_PASSWORD)); return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join(''); };
const ck = { Cookie: 'hs_admin=' + await cookieVal() };
const bearer = { Authorization: 'Bearer pw-test-123' };
const results = [];
const T = async (name, expect, p) => { const r = await p; results.push(`${r.status===expect?'PASS':'FAIL'} ${name}: ${r.status} (want ${expect}) ${r.body}`); };

// 1-3: admin endpoints without auth -> 401; with cookie -> pass the gate (400 empty body proves gate passed)
await T('admin-verify noauth', 401, call('/admin-verify', { body: {} }));
await T('admin-verify cookie', 400, call('/admin-verify', { body: {}, headers: ck }));
await T('admin-verify bearer', 400, call('/admin-verify', { body: {}, headers: bearer }));
await T('admin-verify wrong bearer', 401, call('/admin-verify', { body: {}, headers: { Authorization: 'Bearer nope' } }));
await T('special-audit noauth', 401, call('/admin-special-audit', { body: {} }));
await T('special-audit cookie', 400, call('/admin-special-audit', { body: {}, headers: ck }));
await T('log-inquiry-price noauth', 401, call('/log-inquiry-price', { body: {} }));
await T('log-inquiry-price cookie bad key prefix', 400, call('/log-inquiry-price', { body: { key: 'history:u1', actual_fair_price: 1 }, headers: ck }));
await env.KIRA_STATS.put('inquiry:t1', JSON.stringify({ name: 'a' }));
await T('log-inquiry-price cookie inquiry key', 200, call('/log-inquiry-price', { body: { key: 'inquiry:t1', actual_fair_price: 1234 }, headers: ck }));
await T('funnel-stats noauth', 401, call('/admin/funnel-stats', { method: 'GET' }));
// 5: regression fix, admin page buttons via cookie
await T('confirm-payment cookie (gate passes -> 4xx/5xx not 401)', 404, call('/confirm-payment', { body: { key: 'bank:none' }, headers: ck }));
await T('delete noauth', 401, call('/delete', { body: { key: 'x' } }));
await T('delete cookie', 200, call('/delete', { body: { key: 'inquiry:t1' }, headers: ck }));
// 4: hacker/report
await env.ORDERS.put('card:c1', JSON.stringify({ title: 't', genre: 'g' }));
await env.ORDERS.put('card_index', JSON.stringify(['c1', 'c2']));
const O = 'https://shield.the-horizons-innovation.com';
await T('report bad origin', 403, call('/hacker/report', { body: { card_id: 'c1' }, origin: 'https://evil.example' }));
const rep = async (ip) => call('/hacker/report', { body: { card_id: 'c1', reason: 'r' }, origin: O, headers: { 'CF-Connecting-IP': ip } });
await T('report #1 (ip A)', 200, rep('1.1.1.1'));
await T('report #1 again same ip', 200, rep('1.1.1.1'));
let idx = JSON.parse(await env.ORDERS.get('card_index')); let card = JSON.parse(await env.ORDERS.get('card:c1'));
results.push(`${idx.includes('c1') && card.report_count===1 ? 'PASS' : 'FAIL'} still listed after 2 reports from one ip (count=${card.report_count}, listed=${idx.includes('c1')})`);
await T('report #2 (ip B)', 200, rep('2.2.2.2'));
await T('report #3 (ip C)', 200, rep('3.3.3.3'));
idx = JSON.parse(await env.ORDERS.get('card_index')); card = JSON.parse(await env.ORDERS.get('card:c1'));
results.push(`${!idx.includes('c1') && card.report_count===3 && card.hidden_by_reports ? 'PASS' : 'FAIL'} hidden after 3 distinct ips (count=${card.report_count}, listed=${idx.includes('c1')})`);
results.push(`${JSON.stringify(card).includes('1.1.1.1') ? 'FAIL' : 'PASS'} raw ip not stored`);
for (let i=0;i<6;i++) await rep('9.9.9.9');
await T('report rate limit 6th from same ip', 429, rep('9.9.9.9'));
// 6: XSS escape in /admin page with cookie
await env.KIRA_STATS.put('inquiry:x1', JSON.stringify({ name: '<img src=x onerror=alert(1)>', email: 'a"b@x', result: 'ok' }));
const page = await call('/admin', { method: 'GET', headers: ck });
const html = (await w.fetch(new Request(base+'/admin', { headers: new Headers(ck) }), env, {})).text ? await (await w.fetch(new Request(base+'/admin', { headers: new Headers(ck) }), env, {})).text() : '';
results.push(`${html.includes('&lt;img src=x onerror=alert(1)&gt;') && !html.includes('<img src=x onerror=alert(1)>') ? 'PASS' : 'FAIL'} admin page escapes stored name (status ${page.status})`);
// 7: 2026-09-14 スマホからの導線。funnel-stats を cookie 無しのブラウザで開くと login へ 302、API は 401。next は /admin 配下だけ。cookie は 30 日。
{
  const raw = async (path, headers) => w.fetch(new Request(base+path, { method: 'GET', headers: new Headers(headers||{}) }), env, { waitUntil(){} });
  const r1 = await raw('/admin/funnel-stats', { Accept: 'text/html,application/xhtml+xml' });
  results.push(`${r1.status===302 && r1.headers.get('Location')==='/admin?next=%2Fadmin%2Ffunnel-stats' ? 'PASS' : 'FAIL'} funnel-stats browser no cookie -> 302 to /admin?next (${r1.status} ${r1.headers.get('Location')})`);
  const r2 = await raw('/admin/funnel-stats', { Accept: 'application/json' });
  results.push(`${r2.status===401 ? 'PASS' : 'FAIL'} funnel-stats api no cookie -> 401 (${r2.status})`);
  const r3 = await raw('/admin/funnel-stats', { Accept: 'text/html', ...ck });
  results.push(`${r3.status===200 ? 'PASS' : 'FAIL'} funnel-stats browser with cookie -> 200 (${r3.status})`);
  const r4 = await raw('/admin?key=pw-test-123&next=%2Fadmin%2Ffunnel-stats');
  const sc = r4.headers.get('Set-Cookie') || '';
  results.push(`${r4.status===302 && r4.headers.get('Location')==='/admin/funnel-stats' ? 'PASS' : 'FAIL'} login with next -> 302 back to funnel-stats (${r4.status} ${r4.headers.get('Location')})`);
  results.push(`${/Max-Age=2592000/.test(sc) && /HttpOnly/.test(sc) && /SameSite=Strict/.test(sc) ? 'PASS' : 'FAIL'} cookie Max-Age 30d, HttpOnly, Strict (${sc.slice(0,40)}...)`);
  const r5 = await raw('/admin?key=pw-test-123&next=https%3A%2F%2Fevil.example%2F');
  results.push(`${r5.status===302 && r5.headers.get('Location')==='/admin' ? 'PASS' : 'FAIL'} login with external next -> ignored, back to /admin (${r5.headers.get('Location')})`);
  const r6 = await raw('/admin?key=pw-test-123&next=%2F%2Fevil.example');
  results.push(`${r6.status===302 && r6.headers.get('Location')==='/admin' ? 'PASS' : 'FAIL'} login with //evil next -> ignored (${r6.headers.get('Location')})`);
  const r7 = await raw('/admin?next=%2Fadmin%2Ffunnel-stats', ck);
  results.push(`${r7.status===302 && r7.headers.get('Location')==='/admin/funnel-stats' ? 'PASS' : 'FAIL'} already has cookie + next -> 302 to next (${r7.status} ${r7.headers.get('Location')})`);
  const r8 = await raw('/admin?next=%2Fadmin%2Ffunnel-stats');
  const t8 = await r8.text();
  results.push(`${r8.status===200 && t8.includes("&next=%2Fadmin%2Ffunnel-stats") ? 'PASS' : 'FAIL'} login form carries next into go() (${r8.status})`);
  const r9 = await raw('/admin?key=wrong&next=%2Fadmin%2Ffunnel-stats');
  results.push(`${r9.status===401 ? 'PASS' : 'FAIL'} wrong password with next -> 401 login form, no cookie (${r9.status} setcookie=${!!r9.headers.get('Set-Cookie')})`);
}
console.log(results.join('\n'));
console.log('TOTAL FAIL:', results.filter(r=>r.startsWith('FAIL')).length);
