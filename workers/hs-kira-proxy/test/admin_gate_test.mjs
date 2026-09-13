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
console.log(results.join('\n'));
console.log('TOTAL FAIL:', results.filter(r=>r.startsWith('FAIL')).length);
