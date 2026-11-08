// 2026-11-08: PDF にする HTML へ客の値を入れる所の逃がしの試験(report、audit、compare、kanryo、plan)。
// 実行: node workers/hs-pdf-gen/test/html_escape_test.mjs  (ブラウザは使わない。HTML を作る関数を直に呼ぶ。網には出ない: fetch は偽物)
import { readFileSync } from 'node:fs';
import w from '../src/worker.js';

let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? 'ok   ' : 'NG   ') + name + (ok || detail === undefined ? '' : '  <<< ' + detail)); };

// worker.js は default しか出さないので、試験の中だけで名前付きの export を足した写しを読む(本体は変えない)。
const SRC = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const NAMES = ['escapeHtml', 'hsMeisaiAudit', 'hsGenerateEstimateAuditHTML', 'hsCompareAudits', 'hsGenerateCompareHTML', 'generateMitsumoriHTML', 'generateKanryoHTML', 'generatePlanHTML', 'parsePlanText', 'HS_MEISAI_BENCH'];
const M = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(SRC + '\nexport { ' + NAMES.join(', ') + ' };\n'));

const fetchCalls = [];
globalThis.fetch = async (u) => { fetchCalls.push(String(u)); throw new Error('network is off in this test'); };
const origError = console.error;
console.error = () => {};

const PAYLOADS = ['<', '"', '&', '</script>', '<img src=x onerror=alert(1)>'];
const ESC = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// 値の前後に印を付け、印に挟まれた生の形が無く、逃がした形が在る事を見る(「<」だけでは HTML のどこにでも在るので)。
const mk = (tag, p) => 'Q' + tag + 'L' + p + 'Q' + tag + 'R';
// mode 'esc': 逃がした形が出て、生の形は出ない。mode 'absent': 生の形が出ない(数として計算に使われ、文字として出ない欄)。
const check = (label, html, tag, p, mode) => {
  const raw = mk(tag, p);
  const esc = mk(tag, ESC(p));
  const hasRaw = html.includes(raw);
  const ok = mode === 'esc' ? (!hasRaw && html.includes(esc)) : !hasRaw;
  t(label + ' [' + JSON.stringify(p) + ']', ok, (hasRaw ? 'raw found' : 'raw absent') + ' / ' + (html.includes(esc) ? 'escaped found' : 'escaped absent'));
};

// ---- audit: extracted の rows(no、qty、unit、description)と doc の欄 ----
const baseEx = (p) => ({
  doc: {
    title: mk('dt', p), estimate_no: mk('de', p), issuer: mk('di', p),
    subtotal_ex_tax: 100000, tax_rate_pct: 10, tax: 10000, total_inc_tax: 110000,
    payment_terms: [{ timing: '契約時', pct: mk('pp', p), amount: 55000 }, { timing: '完工時', pct: 50, amount: 55000 }],
    doc_notes: [mk('dn', p)]
  },
  rows: [
    { type: 'section', no: mk('sn', p), description: '仮設工事' },
    { type: 'item', no: mk('no', p), description: '仮設足場 ' + mk('ds', p), qty: mk('qt', p), unit: mk('un', p), unit_price: 1000, amount: 100000 }
  ]
});
const AUDIT_FIELDS = [['dt', 'esc'], ['de', 'esc'], ['di', 'esc'], ['pp', 'esc'], ['no', 'esc'], ['ds', 'esc'], ['qt', 'esc'], ['un', 'esc'], ['sn', 'absent'], ['dn', 'absent']];
for (const p of PAYLOADS) {
  const ex = baseEx(p);
  const audit = M.hsMeisaiAudit(ex, M.HS_MEISAI_BENCH, { region: 'all', category: 'gaiheki_tosou' });
  const html = M.hsGenerateEstimateAuditHTML(ex, audit, { date: '2026-11-08', benchVersion: 'test', auditHash: 'X', ots: 'Y' });
  for (const [tag, mode] of AUDIT_FIELDS) check('audit ' + tag, html, tag, p, mode);
}
// 同じ物を本番の入口(/generate-estimate-audit の format html)からも通す。
{
  const p = '<img src=x onerror=alert(1)>';
  const r = await w.fetch(new Request('https://hs-pdf-gen.example/generate-estimate-audit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PDF-Token': 'tk' }, body: JSON.stringify({ extracted: baseEx(p), opts: { category: 'gaiheki_tosou' }, format: 'html' }) }), { PDFGEN_TOKEN: 'tk', ENVIRONMENT: 'production', PDFS_BUCKET: { put: async () => {} } }, { waitUntil() {} });
  const html = await r.text();
  t('audit route: format html は 200', r.status === 200, r.status + ' ' + html.slice(0, 80));
  for (const [tag, mode] of AUDIT_FIELDS) check('audit route ' + tag, html, tag, p, mode);
}
// 数の欄に数を入れた時は今までと同じ形で出る(計算は今のまま)。
{
  const ex = baseEx('x');
  ex.rows[1].no = 3; ex.rows[1].qty = 100; ex.rows[1].unit = '㎡';
  ex.doc.payment_terms[0].pct = 50;
  const audit = M.hsMeisaiAudit(ex, M.HS_MEISAI_BENCH, { region: 'all', category: 'gaiheki_tosou' });
  const html = M.hsGenerateEstimateAuditHTML(ex, audit, {});
  t('audit: 数の no と qty はそのまま出る', html.includes("<td class='c'>3</td>") && html.includes("<td class='n'>100 ㎡</td>"));
  t('audit: 着工前受領の数はそのまま出る', html.includes('着工前受領 50%'));
  t('audit: 計算は今のまま(G1 PASS、過大候補額)', audit.gates.pass === true && audit.summary.front_load_pct === 50, JSON.stringify(audit.gates.errors));
}

// ---- compare: title と各見積の欄 ----
const quote = (p, v) => ({ vendor: mk('v' + v, p), extracted: baseEx(p) });
const CMP_FIELDS = [['ct', 'esc'], ['v1', 'esc'], ['v2', 'esc'], ['ds', 'esc'], ['dt', 'absent'], ['no', 'absent'], ['qt', 'absent'], ['un', 'absent']];
for (const p of PAYLOADS) {
  const cmp = M.hsCompareAudits([quote(p, 1), quote(p, 2)], M.HS_MEISAI_BENCH, { category: 'gaiheki_tosou' });
  const html = M.hsGenerateCompareHTML(cmp, { date: '2026-11-08', benchVersion: 'test', title: mk('ct', p), region: mk('cr', p) });
  for (const [tag, mode] of CMP_FIELDS) check('compare ' + tag, html, tag, p, mode);
  check('compare region', html, 'cr', p, 'esc');
}
{
  const p = '</script>';
  const r = await w.fetch(new Request('https://hs-pdf-gen.example/generate-compare', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PDF-Token': 'tk' }, body: JSON.stringify({ quotes: [quote(p, 1), quote(p, 2)], title: mk('ct', p), opts: { category: 'gaiheki_tosou' }, format: 'html' }) }), { PDFGEN_TOKEN: 'tk', ENVIRONMENT: 'production' }, { waitUntil() {} });
  const html = await r.text();
  t('compare route: format html は 200', r.status === 200, r.status + ' ' + html.slice(0, 80));
  for (const [tag, mode] of CMP_FIELDS) check('compare route ' + tag, html, tag, p, mode);
}

// ---- report(加盟店本見積認証): customer_name と partner_name ----
const d2 = { koji_name: '外壁塗装', regionLabel: '全国', teiji_kingaku: 1000000, adjMin: 800000, adjAvg: 900000, adjMax: 1100000, statusColor: '#4ade80', statusLabel: '適正価格', gapPct: 11 };
for (const p of PAYLOADS) {
  const html = M.generateMitsumoriHTML(d2, { customer_name: mk('cn', p) }, { partner_name: mk('pn', p), certNo: mk('cno', p) });
  check('report customer_name', html, 'cn', p, 'esc');
  check('report partner_name', html, 'pn', p, 'esc');
}

// ---- kanryo と plan: 客の値の欄 ----
for (const p of PAYLOADS) {
  const k = { partner_name: mk('kp', p), koji_name: mk('kk', p), start_date: mk('ks', p), end_date: mk('ke', p), mid_note: mk('km', p), result: mk('kr', p), contract_amount: mk('ka', p) };
  const html = M.generateKanryoHTML(k, { customer_name: mk('kc', p) }, { certNo: 'C' });
  for (const tag of ['kp', 'kk', 'ks', 'ke', 'km', 'kr', 'kc']) check('kanryo ' + tag, html, tag, p, 'esc');
  check('kanryo ka', html, 'ka', p, 'absent');
  const plan = M.parsePlanText('===PLAN===\n工事内容：' + mk('pk', p) + '\n【工事内訳】\n・' + mk('pb', p) + '：' + mk('pv', p) + '\n小計：' + mk('ps', p) + '\n松：' + mk('pm', p) + '\nアドバイス：' + mk('pa', p) + '\n===END===');
  const ph = M.generatePlanHTML(plan, { customer_name: mk('pc', p) });
  for (const tag of ['pk', 'pb', 'pv', 'ps', 'pm', 'pa', 'pc']) check('plan ' + tag, ph, tag, p, 'esc');
}

// ---- 逃がしの関数は 1 つ(5 文字) ----
t('escapeHtml は & < > " \' の 5 つを逃がす', M.escapeHtml('&<>"\'') === '&amp;&lt;&gt;&quot;&#39;');
t('escapeHtml は null と undefined を空にする', M.escapeHtml(null) === '' && M.escapeHtml(undefined) === '');
t('worker.js に 3 文字だけ逃がす関数が残っていない', !/replace\(\/>\/g, "&gt;"\);\s*\}/.test(SRC) && !/=> String\(s\)\.replace\(\/&\/g/.test(SRC));
t('網には出ていない(OTS への fetch は偽物が受けた)', fetchCalls.every((u) => u.startsWith('https://a.pool.opentimestamps.org/')), fetchCalls.join());

console.error = origError;
console.log('');
console.log((fail === 0 ? 'PASS ' : 'FAIL ') + pass + '/' + (pass + fail) + ' (html_escape: report、audit、compare、kanryo、plan の客の値は逃がして HTML に入る)');
process.exit(fail === 0 ? 0 : 1);
