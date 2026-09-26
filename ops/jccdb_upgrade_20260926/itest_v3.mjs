// hs-mcp(patcher v3 を当てたもの)x hs-jccdb-obs v0.4 の結合試験。
//
// 1. hs-mcp の写し(MCP = patcher v2 が当たった hs-mcp。既定 ~/horizon-shield/workers/hs-mcp)を作業用ディレクトリに写し、
//    patcher v3 を --dry(何も変えない)、本番(.bak が 1 つ)、2 回目(何もしない)の順に当てる。
// 2. hs-jccdb-obs v0.4(OBSW)の worker を node:sqlite で動かす: DB = 日本の fixtures、DB_US = 米国の fixtures + 非公開の層(tools/make_d1_sql_kake.py)。
//    hs-mcp の JCCDB_SVC はこの worker を呼ぶ(service binding と同じく、URL は hs-mcp が組む https://jccdb-obs.internal/mcp)。
// 3. 新しい 4 本が値を返すこと、既存の米国の道具も内部として値を返すこと、coverage が要約になること、
//    非公開の層が無い D1 では fetch_failed(kake_not_loaded)を返すこと、binding が無ければ fetch_failed を返すこと。
// 4. 同じ worker を公開の URL で叩くと、米国の値は返らないこと(hs-mcp を通したときだけ値が出る)。
//
// 使い方: node itest_v3.mjs   (環境変数 MCP / OBSW / OBS2 / KAKE_SRC / KAKE_IMPORTS / ITEST_WORK で場所を変えられる)
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const _log = console.log;
console.log = (...a) => { if (typeof a[0] === "string" && a[0].startsWith('{"evt":"tool_call"')) return; _log(...a); };

const here = path.dirname(new URL(import.meta.url).pathname);
const home = os.homedir();
const first = (...xs) => xs.filter(Boolean).find((p) => fs.existsSync(p));
const MCP = first(process.env.MCP, path.join(home, "horizon-shield/workers/hs-mcp"), "/home/claude/work/v04/hs-mcp");
const OBSW = first(process.env.OBSW, path.join(home, "horizon-shield/workers/hs-jccdb-obs"), "/home/claude/work/v04/hs-jccdb-obs");
const OBS2 = first(process.env.OBS2, path.join(home, "horizon-shield/data/jccdb-obs-v2"), "/home/claude/work/obs2");
const KSRC = first(process.env.KAKE_SRC, path.join(home, "hs-core-private/ops-private/jccdb_us_kake_20260926"), "/home/claude/work/kake");
const KIMP = first(process.env.KAKE_IMPORTS, path.join(home, "horizon-shield/data/jccdb-obs-v2/raw/us/kake_20260926/derived"), "/home/claude/work/kake/derived");
const PATCHER = first(process.env.PATCHER, path.join(here, "patch_hs_mcp_kake_v3.py"));
const WORK = process.env.ITEST_WORK || fs.mkdtempSync(path.join(os.tmpdir(), "itest-v3-"));
process.on("exit", () => { if (!process.env.ITEST_WORK) fs.rmSync(WORK, { recursive: true, force: true }); });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; _log("FAIL", m); } };
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const py = (...a) => spawnSync("python3", a, { encoding: "utf8" });
const NEW4 = ["get_us_price_chain", "get_us_import_landed_cost", "get_us_trade_margins", "get_us_contract_discounts"];

// ------------------------------------------------------------ 1. patcher v3
const d = path.join(WORK, "hs-mcp");
fs.mkdirSync(path.join(d, "src"), { recursive: true });
fs.copyFileSync(path.join(MCP, "src/mcp.js"), path.join(d, "src/mcp.js"));
fs.copyFileSync(path.join(MCP, "wrangler.jsonc"), path.join(d, "wrangler.jsonc"));
const m = path.join(d, "src/mcp.js"), w = path.join(d, "wrangler.jsonc");
const s0 = sha(m), w0 = sha(w);
const already = fs.readFileSync(m, "utf8").includes("[PATCH 2026-09-26 kake v3]");
if (!already) {
  const dry = py(PATCHER, d, "--dry");
  ok(dry.status === 0 && /^dry: 状態 v2 -> v3/.test(dry.stdout) && sha(m) === s0 && fs.readdirSync(path.join(d, "src")).length === 1, "patcher --dry writes nothing: " + dry.stdout + dry.stderr);
  const run = py(PATCHER, d);
  const baks = fs.readdirSync(path.join(d, "src")).filter((f) => /^mcp\.js\.bak\.\d{8}-\d{6}-kakev3$/.test(f));
  ok(run.status === 0 && sha(m) !== s0 && baks.length === 1 && sha(w) === w0, "patcher applied, 1 timestamped .bak, wrangler.jsonc untouched: " + run.stdout + run.stderr);
}
const again = py(PATCHER, d);
ok(again.status === 0 && /既に v3/.test(again.stdout), "patcher second run does nothing");
ok(!fs.readdirSync(d).some((f) => !/^(src|wrangler\.jsonc)$/.test(f)), "no check files left next to the hs-mcp copy");

// ------------------------------------------------------------ 2. hs-jccdb-obs v0.4 を node:sqlite で
const worker = (await import(pathToFileURL(path.join(OBSW, "src/worker.js")).href)).default;
const VALIDATOR = path.join(OBS2, "tools/validate_obs.py");
const BUILDER = path.join(OBSW, "tools/make_d1_sql_v3.py");
const build = (country, out) => spawnSync("python3", [BUILDER, path.join(OBSW, "test/fixtures/obs2"), "--country", country, "--out", out, "--validator", VALIDATOR], { encoding: "utf8" });
const manifestOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "MANIFEST.json"), "utf8"));
const applyDir = (db, dir, skip) => { for (const rel of manifestOf(dir).apply_order.slice(skip ?? 1)) db.exec(fs.readFileSync(path.join(dir, path.basename(rel)), "utf8")); };
const fxJ = path.join(WORK, "fx_jp"), fxU = path.join(WORK, "fx_us");
const bj = build("JP", fxJ), bu = build("US", fxU);
ok(bj.status === 0 && bu.status === 0, "fixture build: " + bj.stderr.slice(-300) + bu.stderr.slice(-300));
const SCHEMA3 = fs.readFileSync(path.join(OBSW, "schema/0003_obs3.sql"), "utf8");
const db = new DatabaseSync(":memory:");
db.exec(fs.readFileSync(path.join(OBSW, "schema/0001_init.sql"), "utf8"));
for (const f of fs.readdirSync(path.join(OBSW, "sql")).filter((x) => x.endsWith(".sql")).sort()) db.exec(fs.readFileSync(path.join(OBSW, "sql", f), "utf8"));
db.exec(SCHEMA3); applyDir(db, fxJ);
const mkUS = (withKake) => {
  const u = new DatabaseSync(":memory:");
  u.exec(SCHEMA3); applyDir(u, fxU);
  if (withKake) {
    u.exec(fs.readFileSync(path.join(OBSW, "schema/0004_kake_us.sql"), "utf8"));
    applyDir(u, kout);
  }
  return u;
};
const kout = path.join(WORK, "sql_us_kake");
const kb = py(path.join(OBSW, "tools/make_d1_sql_kake.py"), "--src", KSRC, "--imports", KIMP, "--ym", "202607", "--out", kout);
ok(kb.status === 0, "kake build: " + kb.stderr.slice(-400));
const mkD1 = (sq) => ({ prepare(sql) { let args = []; const st = { bind: (...a) => { args = a; return st; }, first: async () => sq.prepare(sql).get(...args) ?? null, all: async () => ({ results: sq.prepare(sql).all(...args) }) }; return st; } });
const envObs = { DB: mkD1(db), DB_US: mkD1(mkUS(true)) };
const envObsNoKake = { DB: mkD1(db), DB_US: mkD1(mkUS(false)) };
const svcFor = (e) => ({ fetch: (url, init) => worker.fetch(new Request(url, init), e) });

// ------------------------------------------------------------ 3. hs-mcp から
const mcp = (await import(pathToFileURL(m).href + "?v3")).default;
const kv = new Map();
const baseEnv = { RL_KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => kv.delete(k), list: async () => ({ keys: [] }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };
let rid = 0;
async function rpc(env, body) {
  const r = await mcp.fetch(new Request("https://mcp.horizonshield.dev/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) }), env, ctx);
  const t = await r.text(); return JSON.parse(t.match(/\{[\s\S]*\}/)[0]);
}
const call = async (env, name, args) => (await rpc(env, { jsonrpc: "2.0", id: ++rid, method: "tools/call", params: { name, arguments: args } })).result;
const sc = (r) => r.structuredContent || JSON.parse(r.content[0].text);
const E = { ...baseEnv, JCCDB_SVC: svcFor(envObs) };

const tl = (await rpc(E, { jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools;
ok(tl.length === 30 && NEW4.every((n) => tl.some((t) => t.name === n)), "hs-mcp tools/list: 30 tools including the 4 new ones");
const ch = await call(E, "get_us_price_chain", { hs: "2523290000" });
const c0 = sc(ch).rows && sc(ch).rows[0];
ok(!ch.isError && c0 && c0.hs10 === "2523290000" && c0.wholesale.unit_usd > c0.landed.unit_landed_usd && c0.contractor.unit_usd > c0.wholesale.unit_usd && c0.computed === true && sc(ch).private_layer === true && typeof sc(ch).next_actions === "object",
  "get_us_price_chain via hs-mcp returns stage prices (" + (c0 ? [c0.landed.unit_landed_usd, c0.wholesale.unit_usd, c0.contractor.unit_usd].join(" -> ") : "none") + ")");
const im = await call(E, "get_us_import_landed_cost", { hs: "7214200000" });
ok(!im.isError && sc(im).rows[0].by_country.length === 5 && sc(im).rows[0].year_to_date.duty_rate_eff > 0.4, "get_us_import_landed_cost: rebar with countries and the Section 232 duty rate");
const mg = await call(E, "get_us_trade_margins", { naics: "444110" });
ok(!mg.isError && sc(mg).rows.some((r) => r.naics === "444110" && Math.abs(r.gross_margin_pct - 33.3783) < 1e-3), "get_us_trade_margins: home centers 2024 33.38%");
const kk = await call(E, "get_us_contract_discounts", { query: "eaton breakers" });
ok(!kk.isError && sc(kk).count > 0 && sc(kk).rows.every((r) => r.kake_ratio == null || Math.abs(r.kake_ratio - (1 - r.percentage)) < 1e-9), "get_us_contract_discounts: kake = 1 - discount");
const us = await call(E, "get_us_construction_prices", { state: "OR", layer: "labor", limit: 2 });
ok(!us.isError && sc(us).count > 0 && sc(us).rows.length > 0, "existing U.S. tool still returns values through hs-mcp (internal host)");
const cv = await call(E, "get_jccdb_coverage", {});
ok(!cv.isError && sc(cv).summary_only === true && sc(cv).us_private_layer.loaded === true && sc(cv).matrix.every((x) => !x.sources), "get_jccdb_coverage: summary by default with private-layer counts");
const cvd = await call(E, "get_jccdb_coverage", { detail: true });
ok(!cvd.isError && !sc(cvd).summary_only && sc(cvd).matrix.every((x) => Array.isArray(x.sources)), "get_jccdb_coverage detail:true keeps per-source rows");
const bad = await call(E, "get_us_import_landed_cost", { hs: "abc" });
ok(bad.isError === true && sc(bad).invalid_argument === true && sc(bad).fetch_failed === false, "argument errors pass through as invalid_argument");
const nk = await call({ ...baseEnv, JCCDB_SVC: svcFor(envObsNoKake) }, "get_us_price_chain", { hs: "2523" });
ok(nk.isError === true && sc(nk).fetch_failed === true && sc(nk).error === "kake_not_loaded", "private layer not loaded: fetch_failed kake_not_loaded, not 0 rows");
const nb = await call(baseEnv, "get_us_trade_margins", { naics: "4233" });
ok(nb.isError === true && sc(nb).fetch_failed === true && sc(nb).error === "jccdb_obs_not_bound", "no binding: fetch_failed");

// ------------------------------------------------------------ 4. 公開の URL では米国の値は出ない
const pub = await worker.fetch(new Request("https://hs-jccdb-obs.oga-surf-project.workers.dev/us/chain?hs=2523290000"), envObs);
const pj = await pub.json();
ok(pub.status === 403 && pj.code === "us_private" && !pj.rows, "same worker on the public URL: 403 us_private, no values");
const mcpSrc = fs.readFileSync(m, "utf8");
ok(mcpSrc.includes('JCCDB_SVC.fetch("https://jccdb-obs.internal/mcp"'), "hs-mcp calls the internal host that v0.4 accepts");

_log(`itest_v3: ${pass} pass / ${fail} fail  (hs-mcp ${MCP}, hs-jccdb-obs ${OBSW}, kake ${KSRC})`);
process.exit(fail ? 1 : 0);
