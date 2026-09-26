// hs-mcp x hs-jccdb-obs v0.3 の結合試験(patcher v2。2026-09-26 M2 が v0.3 に合わせて直した: D1 は日本と米国の2つ、道具は11本)。
//
// 1. 作業用ディレクトリ(/tmp ではない。既定 ./itest_work、ITEST_WORK で変えられる)に写しを作る:
//      fresh    = 手つかずの hs-mcp(MCP2 = /home/claude/work/mcp2)
//      v1       = fresh に v1 の patcher を当てたもの(MCPCOPY = /home/claude/work/mcpcopy と1バイトも違わないことも確かめる)
//      v1copy   = v1 が当たった写し(MCPCOPY)そのもの
// 2. fresh と v1copy に v2 の patcher を当てる(--dry は何も変えない / 本番は .bak を残す / 2回目は何もしない)。
//    どちらの道でも出来上がる mcp.js と wrangler.jsonc が同じであること。
// 3. 当てた hs-mcp の tools/list に新ツールが出ること、tools/call が JCCDB_SVC(hs-jccdb-obs v0.3 の worker を
//    node:sqlite で動かしたもの。DB = 日本、DB_US = 米国)を通って値を返すこと、binding が無い / 壊れた / 変な返事 のときに
//    fetch_failed:true を返すこと、米国の DB だけ読めないときは partial(isError ではない)で日本の結果を返すこと。
// 4. 本番の組み立て(hs-jccdb-obs の sql_jp/ と sql_us/)があれば、作業用ディレクトリのファイルの DB に流して実データでも値が通ること。
//
// 使い方: node itest_v2.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// hs-mcp は tool を呼ぶたびに {"evt":"tool_call",...} を console.log に出す。試験の出力を読みやすくするため、その行だけ落とす。
const _log = console.log;
console.log = (...a) => { if (typeof a[0] === "string" && a[0].startsWith('{"evt":"tool_call"')) return; _log(...a); };

const here = path.dirname(new URL(import.meta.url).pathname);
const MCP2 = process.env.MCP2 || "/home/claude/work/mcp2";
const MCPCOPY = process.env.MCPCOPY || "/home/claude/work/mcpcopy";
const OBSW = process.env.JCCDB_OBS || "/home/claude/work/hs-jccdb-obs-v03";
const OBS2 = process.env.OBS2 || "/home/claude/work/obs2";
const WORK = process.env.ITEST_WORK || path.join(here, "itest_work");
const P1 = path.join(here, "patch_hs_mcp_jccdb_obs.py");
const P2 = path.join(here, "patch_hs_mcp_jccdb_obs_v2.py");
const NEW8 = ["search_jccdb_items", "get_jccdb_observations", "get_jccdb_labor_rate", "compare_jccdb_regions", "get_jccdb_work_unit_price", "get_jccdb_index_series", "get_us_construction_prices", "get_jccdb_coverage",
  "get_us_prevailing_wage", "get_us_permits", "get_us_area_factor"]; // 名前は v0.2 のまま(中身は11本)

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const py = (...a) => spawnSync("python3", a, { encoding: "utf8" });
const ls = (d) => fs.readdirSync(d).sort();

// ------------------------------------------------------------ 写し
fs.rmSync(WORK, { recursive: true, force: true });
const mk = (name, fromDir) => {
  const d = path.join(WORK, name);
  fs.mkdirSync(path.join(d, "src"), { recursive: true });
  fs.copyFileSync(path.join(fromDir, "src/mcp.js"), path.join(d, "src/mcp.js"));
  fs.copyFileSync(path.join(fromDir, "wrangler.jsonc"), path.join(d, "wrangler.jsonc"));
  fs.chmodSync(path.join(d, "src/mcp.js"), 0o644); fs.chmodSync(path.join(d, "wrangler.jsonc"), 0o644);
  return d;
};
const dFresh = mk("fresh", MCP2), dV1 = mk("v1", MCP2), dV1copy = mk("v1copy", MCPCOPY), dBroken = mk("broken", MCP2), dTamper = mk("tamper", MCPCOPY);
const origFresh = fs.readFileSync(path.join(dFresh, "src/mcp.js"), "utf8");
const origV1 = fs.readFileSync(path.join(dV1copy, "src/mcp.js"), "utf8");

{
  // v2 の patcher に埋めた v1 の錨が、v1 の patcher の文と1バイトも違わないこと
  const code = "import ast,sys\n" +
    "def consts(p):\n t=ast.parse(open(p,encoding='utf-8').read())\n" +
    " return {n.targets[0].id: ast.literal_eval(n.value) for n in t.body if isinstance(n, ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0], ast.Name) and n.targets[0].id in ('TOOLS_END','NEW_TOOLS','CALL_ANCHOR','CALL_NEW','MSG_OLD','MSG_NEW','WR_OLD','WR_NEW')}\n" +
    "a,b=consts(sys.argv[1]),consts(sys.argv[2]); print('same' if a==b and len(a)==8 else 'diff')\n";
  const r = spawnSync("python3", ["-c", code, P1, P2], { encoding: "utf8" });
  ok(r.stdout.trim() === "same", "v2 patcher embeds the v1 anchors byte for byte: " + r.stdout + r.stderr);
}
const r1 = py(P1, dV1);
ok(r1.status === 0 && sha(path.join(dV1, "src/mcp.js")) === sha(path.join(MCPCOPY, "src/mcp.js")) && sha(path.join(dV1, "wrangler.jsonc")) === sha(path.join(MCPCOPY, "wrangler.jsonc")), "v1 patcher on fresh = mcpcopy byte for byte");

// ------------------------------------------------------------ patcher v2 の掟
for (const [label, d] of [["fresh", dFresh], ["v1copy", dV1copy]]) {
  const m = path.join(d, "src/mcp.js"), w = path.join(d, "wrangler.jsonc");
  const s0 = [sha(m), sha(w)], f0 = [ls(d), ls(path.join(d, "src"))];
  const dry = py(P2, d, "--dry");
  ok(dry.status === 0 && /^dry: 状態 (fresh|v1)/.test(dry.stdout) && sha(m) === s0[0] && sha(w) === s0[1] && JSON.stringify([ls(d), ls(path.join(d, "src"))]) === JSON.stringify(f0), label + ": --dry writes nothing: " + dry.stdout + dry.stderr);
  ok(dry.stdout.includes(label === "fresh" ? "状態 fresh -> 全部" : "状態 v1 -> 差分"), label + ": state detected " + dry.stdout.slice(0, 60));
  const run = py(P2, d);
  const baks = ls(path.join(d, "src")).filter((f) => /^mcp\.js\.bak\.\d{8}-\d{6}-jccdbobs2$/.test(f)).length + ls(d).filter((f) => /^wrangler\.jsonc\.bak\.\d{8}-\d{6}-jccdbobs2$/.test(f)).length;
  ok(run.status === 0 && sha(m) !== s0[0] && baks === 2, label + ": applied with 2 timestamped .bak: " + run.stdout + run.stderr);
  const stray = [...ls(d).filter((f) => !/^(src|wrangler\.jsonc(\.bak\..*)?)$/.test(f)), ...ls(path.join(d, "src")).filter((f) => !/^mcp\.js(\.bak\..*)?$/.test(f))];
  ok(!stray.length, label + ": no check files left in the repo copy " + stray);
  const s1 = sha(m);
  const again = py(P2, d);
  ok(again.status === 0 && /既に v2/.test(again.stdout) && sha(m) === s1 && ls(path.join(d, "src")).length === 2, label + ": second run is a no-op");
  const chk = spawnSync("node", ["--check", m], { encoding: "utf8" });
  ok(chk.status === 0, label + ": node --check on the patched file");
}
ok(sha(path.join(dFresh, "src/mcp.js")) === sha(path.join(dV1copy, "src/mcp.js")) && sha(path.join(dFresh, "wrangler.jsonc")) === sha(path.join(dV1copy, "wrangler.jsonc")), "fresh+v2 and v1+v2 give the same mcp.js and wrangler.jsonc");
{
  // 錨が崩れていたら何も書かない
  const m = path.join(dBroken, "src/mcp.js");
  fs.writeFileSync(m, fs.readFileSync(m, "utf8").replace('  if (name === "jccdb_dataset_info") return txt({ ...JCCDB, next_actions: NEXT_ACTIONS });\n', ""));
  const before = [sha(m), ls(path.join(dBroken, "src")).length];
  const r = py(P2, dBroken);
  ok(r.status !== 0 && /錨 callTool が 0 回/.test(r.stderr) && sha(m) === before[0] && ls(path.join(dBroken, "src")).length === before[1], "missing anchor: stops and writes nothing");
  // v2 の目印があるのに形が崩れている(手で消した)ときも何もしない
  const t = path.join(dTamper, "src/mcp.js");
  const r2 = py(P2, dTamper);
  fs.writeFileSync(t, fs.readFileSync(t, "utf8").replace('name: "get_jccdb_coverage"', 'name: "get_jccdb_coverage_x"'));
  const tb = sha(t);
  const r3 = py(P2, dTamper);
  ok(r2.status === 0 && r3.status !== 0 && /形が揃っていない/.test(r3.stderr) && sha(t) === tb, "tampered v2 state: refuses");
}
{
  const src = fs.readFileSync(P2, "utf8");
  ok(![0x2013, 0x2014, 0x2015].some((c) => src.includes(String.fromCharCode(c))) && ![0x2013, 0x2014, 0x2015].some((c) => fs.readFileSync(path.join(dFresh, "src/mcp.js"), "utf8").includes(String.fromCharCode(c))), "no em/en dash or horizontal bar in patcher and patched file");
}

// ------------------------------------------------------------ hs-jccdb-obs v0.3(node:sqlite、DB = 日本、DB_US = 米国)
const mf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "MANIFEST.json"), "utf8"));
const applyDir = (db, dir) => { for (const rel of mf(dir).apply_order.slice(1)) db.exec(fs.readFileSync(path.join(dir, path.basename(rel)), "utf8")); };
const mkD1 = (db) => ({ prepare(sql) { let a = []; const st = { bind: (...x) => { a = x; return st; }, first: async () => db.prepare(sql).get(...a) ?? null, all: async () => ({ results: db.prepare(sql).all(...a) }) }; return st; } });
const fxJP = path.join(WORK, "sql_fixture_jp"), fxUS = path.join(WORK, "sql_fixture_us");
const B3 = path.join(OBSW, "tools/make_d1_sql_v3.py"), VAL = path.join(OBS2, "tools/validate_obs.py");
const b = py(B3, path.join(OBSW, "test/fixtures/obs2"), "--country", "JP", "--out", fxJP, "--validator", VAL);
const bu = py(B3, path.join(OBSW, "test/fixtures/obs2"), "--country", "US", "--out", fxUS, "--validator", VAL);
ok(b.status === 0 && bu.status === 0, "fixture sql built (JP and US): " + b.stderr + bu.stderr);
const SCHEMA3 = fs.readFileSync(path.join(OBSW, "schema/0003_obs3.sql"), "utf8");
const mkJP = (dir, file) => {
  const db = new DatabaseSync(file || ":memory:");
  if (file) db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;");
  db.exec(fs.readFileSync(path.join(OBSW, "schema/0001_init.sql"), "utf8"));
  for (const f of fs.readdirSync(path.join(OBSW, "sql")).filter((x) => x.endsWith(".sql")).sort()) db.exec(fs.readFileSync(path.join(OBSW, "sql", f), "utf8"));
  db.exec(SCHEMA3);
  if (dir) applyDir(db, dir);
  return db;
};
const mkUS = (dir, file) => {
  const db = new DatabaseSync(file || ":memory:");
  if (file) db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;");
  db.exec(SCHEMA3);
  if (dir) applyDir(db, dir);
  return db;
};
const obsWorker = (await import(pathToFileURL(path.join(OBSW, "src/worker.js")).href)).default;
const dbFx = mkJP(fxJP), dbFxUS = mkUS(fxUS);
// 本番に流す組み立て結果(無ければその試験は省く)。大きいので作業用ディレクトリのファイルの DB に流す(メモリに載せない)。
const PROD_JP = process.env.SQL_JP || path.join(OBSW, "sql_jp"), PROD_US = process.env.SQL_US || path.join(OBSW, "sql_us");
const hasProd = process.env.PROD_SQL !== "0" && fs.existsSync(path.join(PROD_JP, "MANIFEST.json")) && fs.existsSync(path.join(PROD_US, "MANIFEST.json"));
const dbProd = hasProd ? mkJP(PROD_JP, path.join(WORK, "prod_jp.sqlite")) : null;
const dbProdUS = hasProd ? mkUS(PROD_US, path.join(WORK, "prod_us.sqlite")) : null;
const svc = (db, dbu) => ({ fetch: (u, i) => obsWorker.fetch(new Request(u, i), dbu ? { DB: mkD1(db), DB_US: mkD1(dbu) } : { DB: mkD1(db) }) });

// ------------------------------------------------------------ 当てた hs-mcp を叩く
const kv = new Map();
const KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => kv.delete(k), list: async () => ({ keys: [] }) };
const ctx = { waitUntil() {}, passThroughOnException() {} };
let ipn = 0; // 呼ぶたびに別の IP にして、hs-mcp の毎分 60 回の制限に当たらないようにする
async function rpc(mcp, env, body) {
  const r = await mcp.fetch(new Request("https://mcp.horizonshield.dev/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", "CF-Connecting-IP": "10.0." + (ipn >> 8 & 255) + "." + (ipn++ & 255) }, body: JSON.stringify(body) }), env, ctx);
  const t = await r.text();
  return JSON.parse(t.match(/\{[\s\S]*\}/)[0]);
}
const call = async (mcp, env, name, args) => {
  const r = (await rpc(mcp, env, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } })).result;
  return { isError: r.isError === true, sc: r.structuredContent || JSON.parse(r.content[0].text) };
};
const valueRowsOk = (rows) => rows.length > 0 && rows.filter((r) => r.price != null || r.wage != null).every((r) => r.license && r.evidence_url && (r.license === "restricted" || r.license === "US-PD-17USC105" || r.attribution));

async function scenario(label, dir, orig) {
  const mcp = (await import(pathToFileURL(path.join(dir, "src/mcp.js")).href + "?" + label)).default;
  const origMod = (await import(pathToFileURL(path.join(WORK, label + "_orig.mjs")).href)).default;
  const envFx = { RL_KV: KV, JCCDB_SVC: svc(dbFx, dbFxUS) }, envNo = { RL_KV: KV };
  const L = (m) => label + ": " + m;

  const tl = (await rpc(mcp, envFx, { jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools;
  const tl0 = (await rpc(origMod, envFx, { jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools;
  ok(NEW8.every((n) => tl.some((t) => t.name === n)), L("tools/list has the 11 JCCDB tools (" + tl.length + ")"));
  const keep = (ts) => JSON.stringify(ts.filter((t) => !NEW8.includes(t.name)));
  ok(keep(tl) === keep(tl0), L("existing tool definitions unchanged"));
  ok(tl.filter((t) => NEW8.includes(t.name)).every((t) => /[぀-ヿ一-鿿]/.test(t.description) && /[A-Za-z]{4,} [A-Za-z]{2,}/.test(t.description) && t.annotations.readOnlyHint), L("descriptions in Japanese and English, read-only"));

  // 値が binding を通って返る(fixtures の DB)
  const s = await call(mcp, envFx, "search_jccdb_items", { query: "生コンクリート" });
  ok(!s.isError && s.sc.items.length > 0 && s.sc.fetch_failed === false && s.sc.lookup === "ok" && s.sc.source_read === true, L("search_jccdb_items via binding"));
  const o = await call(mcp, envFx, "get_jccdb_observations", { query: "生コンクリート", pref: "奈良県", limit: 5 });
  ok(!o.isError && o.sc.by_status.published_pdl === 72 && valueRowsOk(o.sc.rows) && Array.isArray(o.sc.next_actions && o.sc.next_actions.actions), L("get_jccdb_observations via binding (72 priced, license/attribution/evidence)"));
  const oc = await call(mcp, envFx, "get_jccdb_observations", { geo: "CA" });
  ok(!oc.isError && oc.sc.matched === 3 && oc.sc.country === "US", L("get_jccdb_observations geo=CA (new args pass through)"));
  const lr = await call(mcp, envFx, "get_jccdb_labor_rate", { pref: "奈良", job: "左官" });
  const lh = await call(mcp, envFx, "get_jccdb_labor_rate", { pref: "奈良", job: "左官", history: true });
  ok(!lr.isError && lr.sc.rows.length === 1 && lr.sc.rows[0].wage_yen_per_8h > 20000 && lh.sc.series[0].points.length === 2, L("get_jccdb_labor_rate latest and history"));
  const c = await call(mcp, envFx, "compare_jccdb_regions", { query: "生コンクリート", spec: "21-8-25(20)", country: "JP" });
  ok(!c.isError && c.sc.groups[0].stats.median.computed === true && c.sc.groups[0].stats.min.computed === false && c.sc.groups[0].stats.min.license === "PDL1.0", L("compare_jccdb_regions (median computed:true)"));
  const w = await call(mcp, envFx, "get_jccdb_work_unit_price", { query: "掘削" });
  ok(!w.isError && w.sc.packages_total === 2 && w.sc.packages.every((p) => p.composition.length === 4) && w.sc.packages.some((p) => p.composition_linked_by.includes("obs_id")) && w.sc.composition_rows_attached === 8, L("get_jccdb_work_unit_price with composition attached"));
  const x = await call(mcp, envFx, "get_jccdb_index_series", { query: "NHCCI", from: "2025Q1" });
  ok(!x.isError && x.sc.series[0].points.every((p) => p.yoy && p.yoy.computed === true) && x.sc.series[0].license === "US-PD-17USC105", L("get_jccdb_index_series yoy computed:true"));
  const u = await call(mcp, envFx, "get_us_construction_prices", { state: "California", limit: 100 });
  // v0.2 は 8。v0.3 の米国の道具は全 layer を引くので、全国の index(NHCCI 93 行)も入って 101。
  ok(!u.isError && u.sc.matched === 101 && u.sc.rows.some((r) => r.per_m2 && r.per_m2.computed === true) && /not residential remodeling/.test(u.sc.basis), L("get_us_construction_prices state=California"));
  const ul = await call(mcp, envFx, "get_us_construction_prices", { layer: "labor", geo: "OR" });
  ok(!ul.isError && ul.sc.matched === 10 && ul.sc.rows.every((r) => r.license === "US-PD-17USC105" && r.attribution && r.evidence_url), L("get_us_construction_prices layer=labor geo=OR (new layer and geo pass through)"));
  // v0.3 の米国の3本
  const pw = await call(mcp, envFx, "get_us_prevailing_wage", { state: "OR", trade: "carpenter" });
  ok(!pw.isError && pw.sc.count === 2 && pw.sc.rates.every((r) => r.base && r.fringe && r.license && r.attribution && r.evidence_url) && pw.sc.rates.some((r) => r.total_hourly && r.total_hourly.computed === true) && /連邦の資金/.test(pw.sc.basis), L("get_us_prevailing_wage (base + fringe, total computed:true)"));
  const pp = await call(mcp, envFx, "get_us_permits", { geo: "Portland, OR", year: "2024" });
  ok(!pp.isError && pp.sc.bps.count === 2 && pp.sc.city_permits.records.some((r) => r.valuation_median && r.valuation_median.computed === true) && /申請者/.test(pp.sc.basis), L("get_us_permits (BPS place + city quartiles)"));
  const pa = await call(mcp, envFx, "get_us_area_factor", { geo: "OR" });
  ok(!pa.isError && pa.sc.sites_total === 2 && pa.sc.acf_stats.median.computed === true && pa.sc.state_adjustment_factor.current.value === 1.08, L("get_us_area_factor (DoD ACF + USACE state factor)"));
  const pbad = await call(mcp, envFx, "get_us_prevailing_wage", {});
  ok(pbad.isError && pbad.sc.invalid_argument === true && pbad.sc.fetch_failed === false, L("get_us_prevailing_wage without state: argument error"));
  // 米国の DB だけ読めない: isError にせず partial で日本の結果を返す。米国だけを聞けば fetch_failed。
  const envJPonly = { RL_KV: KV, JCCDB_SVC: svc(dbFx) };
  const ps = await call(mcp, envJPonly, "search_jccdb_items", { query: "生コンクリート" });
  const pus = await call(mcp, envJPonly, "get_us_permits", { geo: "OR" });
  ok(!ps.isError && ps.sc.partial === true && ps.sc.parts.US.fetch_failed === true && ps.sc.items.length > 0 && pus.isError && pus.sc.fetch_failed === true && pus.sc.error === "db_us_not_bound", L("DB_US unbound behind the binding: partial for mixed calls, fetch_failed for U.S. calls"));
  const cv = await call(mcp, envFx, "get_jccdb_coverage", {});
  ok(!cv.isError && cv.sc.total_rows === dbFx.prepare("SELECT COUNT(*) AS n FROM obs2").get().n + dbFxUS.prepare("SELECT COUNT(*) AS n FROM obs2").get().n && cv.sc.absent.length === 9 && cv.sc.matrix.some((m) => m.computed > 0), L("get_jccdb_coverage totals (JP + US), absent, computed rows"));

  // 0 件と、引数の誤りと、呼べなかったを分ける
  const z = await call(mcp, envFx, "get_jccdb_observations", { query: "存在しない品目ぴよ" });
  ok(!z.isError && z.sc.count === 0 && z.sc.lookup === "absent" && z.sc.source_read === true && z.sc.fetch_failed === false, L("0 rows: not an error, lookup absent"));
  const ia = await call(mcp, envFx, "get_jccdb_observations", { pref: "ナラ" });
  ok(ia.isError && ia.sc.invalid_argument === true && ia.sc.fetch_failed === false && /分からない/.test(ia.sc.message), L("argument error: isError + invalid_argument, not fetch_failed"));
  let allUnbound = true;
  for (const n of NEW8) { const r = await call(mcp, envNo, n, { query: "生コンクリート" }); allUnbound = allUnbound && r.isError && r.sc.fetch_failed === true && r.sc.error === "jccdb_obs_not_bound"; }
  ok(allUnbound, L("no binding: all 11 tools return isError + fetch_failed:true"));
  const thr = await call(mcp, { RL_KV: KV, JCCDB_SVC: { fetch: async () => { throw new Error("boom"); } } }, "get_jccdb_coverage", {});
  ok(thr.isError && thr.sc.fetch_failed === true && thr.sc.error === "jccdb_obs_fetch_failed", L("binding throws: fetch_failed"));
  const junk = await call(mcp, { RL_KV: KV, JCCDB_SVC: { fetch: async () => new Response("<html>502</html>", { status: 502 }) } }, "get_jccdb_coverage", {});
  const nosc = await call(mcp, { RL_KV: KV, JCCDB_SVC: { fetch: async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })) } }, "get_jccdb_coverage", {});
  ok(junk.isError && junk.sc.fetch_failed === true && nosc.isError && nosc.sc.error === "jccdb_obs_bad_response", L("unreadable responses: fetch_failed"));
  const down = await call(mcp, { RL_KV: KV, JCCDB_SVC: { fetch: (u2, i) => obsWorker.fetch(new Request(u2, i), { DB: { prepare() { throw new Error("D1_ERROR"); } } }) } }, "get_jccdb_observations", { query: "x" });
  ok(down.isError && down.sc.fetch_failed === true && down.sc.error === "db_unavailable", L("D1 down behind the binding: fetch_failed, not 0"));
  const loadingDb = new DatabaseSync(":memory:");
  loadingDb.exec(fs.readFileSync(path.join(OBSW, "schema/0001_init.sql"), "utf8"));
  loadingDb.exec(SCHEMA3);
  const ld = await call(mcp, { RL_KV: KV, JCCDB_SVC: svc(loadingDb) }, "get_jccdb_observations", { query: "生コンクリート" });
  ok(ld.isError && ld.sc.fetch_failed === true && ld.sc.error === "obs2_loading" && ld.sc.count === undefined, L("obs2 reload in progress: fetch_failed, not 0"));

  // 既存ツールと v1 の結合試験の6本(同じ条件)
  const pr = await call(mcp, envFx, "get_price_range", { query: "外壁塗装" });
  const pr0 = await call(origMod, envFx, "get_price_range", { query: "外壁塗装" });
  ok(JSON.stringify(Object.keys(pr.sc).sort()) === JSON.stringify(Object.keys(pr0.sc).sort()) && pr.isError === pr0.isError, L("existing tool get_price_range answers in the same shape as before"));
  const nf = await call(mcp, envFx, "search_cost_category", { query: "生コンクリート" });
  ok(JSON.stringify(nf.sc).includes("search_jccdb_items"), L("search_cost_category not-found points to search_jccdb_items (v1 text)"));
  const v1b = await call(mcp, envNo, "search_jccdb_items", { query: "生コンクリート" });
  ok(v1b.sc.fetch_failed === true && v1b.sc.error === "jccdb_obs_not_bound", L("v1 itest: unbound is a failure not empty"));

  // 本番の sql_jp / sql_us(実データ)でも値が通る
  if (dbProd) {
    const envP = { RL_KV: KV, JCCDB_SVC: svc(dbProd, dbProdUS) };
    const po = await call(mcp, envP, "get_jccdb_observations", { query: "生コンクリート 21-8-25(20)", pref: "nara", status: "published_pdl" });
    const pl = await call(mcp, envP, "get_jccdb_labor_rate", { pref: "奈良県", job: "大工" });
    const pc = await call(mcp, envP, "get_jccdb_coverage", {});
    ok(!po.isError && po.sc.rows.some((r) => r.area_code === "68" && r.price_yen === 36900) && pl.sc.rows[0].wage_yen_per_8h === 29600 &&
      pc.sc.total_rows === dbProd.prepare("SELECT COUNT(*) AS n FROM obs2").get().n + dbProdUS.prepare("SELECT COUNT(*) AS n FROM obs2").get().n, L("real sql_jp / sql_us via binding (竹筒 36,900 / 奈良 大工 29,600 / coverage JP + US)"));
    const rw = await call(mcp, envP, "get_us_prevailing_wage", { state: "CA", county: "Los Angeles", trade: "carpenter" });
    const rp = await call(mcp, envP, "get_us_permits", { geo: "Austin, TX", year: "2024" });
    const ra = await call(mcp, envP, "get_us_area_factor", { geo: "NC", limit: 3 });
    ok(!rw.isError && rw.sc.count > 0 && !rp.isError && rp.sc.bps.count > 0 && rp.sc.city_permits.count > 0 && !ra.isError && ra.sc.sites_total > 0, L("real data: prevailing wage LA carpenter / permits Austin 2024 / area factor NC"));
  }
}

fs.writeFileSync(path.join(WORK, "fresh_orig.mjs"), origFresh);
fs.writeFileSync(path.join(WORK, "v1copy_orig.mjs"), origV1);
await scenario("fresh", dFresh, origFresh);
await scenario("v1copy", dV1copy, origV1);

// 緑なら作業用ディレクトリを消す(KEEP_ITEST_WORK=1 で残す)。赤なら調べられるように残す。
if (!fail && !process.env.KEEP_ITEST_WORK) fs.rmSync(WORK, { recursive: true, force: true });
console.log(`hs-mcp v2 integration: ${pass} pass / ${fail} fail  (${dbProd ? "実データ " + PROD_JP + " + " + PROD_US : "実データの組み立て無し(4本省略)"}; work dir ${WORK}${!fail && !process.env.KEEP_ITEST_WORK ? " は消した" : " を残した"})`);
process.exit(fail ? 1 : 0);
