// hs-jccdb-obs v0.3 の検査。D1 の代わりに node:sqlite に同じ SQL を流し、worker の関数をそのまま叩く。
//
// DB の中身(D1 を2つに分けたので、試験の DB も2つ):
//   DB(日本)   : schema/0001_init.sql + sql/*.sql(v0.1: items 95,403 行、obs 4,780 行)+ schema/0003_obs3.sql + fixtures の日本の SQL
//   DB_US(米国): schema/0003_obs3.sql + fixtures の米国の SQL(FTS5 つき)
//   fixtures は test/fixtures/obs2(観測層 v2 の実ファイル3本の写しと、「試験用」の架空の行。test/fixtures/make_fixtures.py)。
//   tools/make_d1_sql_v3.py で一時ディレクトリに作り、最後に消す。
// 本番の組み立て(sql_jp/ と sql_us/、か環境変数 SQL_JP / SQL_US の場所)があれば、一時ディレクトリの「ファイルの DB」に流し
// (メモリに載せない)、全行の形と道具の答えを確かめる。PROD_SQL=0 で省く。
//
// 使い方: node test/harness.mjs      (観測層 v2 の検査器の場所は環境変数 OBS2 で渡す。既定は下の候補の順)
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import worker, { normPref, norm, TOOLS, normGeo, normPeriod, periodStart, BASIS_NOTE, US_BASIS, STATUS_LEGEND, LAYERS, US_PRICE_LAYERS, namaconKey,
  countyBase, ftsTokens, ftsQuery, dbraCounties } from "../src/worker.js";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, "..");
const OBS2 = [process.env.OBS2, path.join(root, "../../data/jccdb-obs-v2"), "/home/claude/work/obs2"]
  .filter(Boolean).find((p) => fs.existsSync(path.join(p, "tools/validate_obs.py")));
if (!OBS2) { console.log("観測層 v2 の検査器(tools/validate_obs.py)が見つからない。OBS2=<観測層 v2 のルート> で渡すこと。"); process.exit(2); }
const VALIDATOR = path.join(OBS2, "tools/validate_obs.py");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hs-jccdb-obs-v03-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const T0 = Date.now();

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };

const BUILDER = path.join(root, "tools/make_d1_sql_v3.py");
const build = (src, country, out, extra) => spawnSync("python3", [BUILDER, src, "--country", country, "--out", out, "--validator", VALIDATOR, ...(extra || [])], { encoding: "utf8" });
const manifestOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "MANIFEST.json"), "utf8"));
const applyDir = (db, dir) => { for (const rel of manifestOf(dir).apply_order.slice(1)) db.exec(fs.readFileSync(path.join(dir, path.basename(rel)), "utf8")); };
const execV01 = (db) => {
  db.exec(fs.readFileSync(path.join(root, "schema/0001_init.sql"), "utf8"));
  for (const f of fs.readdirSync(path.join(root, "sql")).filter((x) => x.endsWith(".sql")).sort()) db.exec(fs.readFileSync(path.join(root, "sql", f), "utf8"));
};
const SCHEMA3 = fs.readFileSync(path.join(root, "schema/0003_obs3.sql"), "utf8");
const mkD1 = (db, opts) => ({
  prepare(sql) {
    let args = [];
    const st = { bind: (...a) => { args = a; return st; },
      first: async () => { if (opts && opts.fail) throw new Error("D1_ERROR: simulated outage"); if (opts && opts.hide && opts.hide.test(sql)) return null; return db.prepare(sql).get(...args) ?? null; },
      all: async () => { if (opts && opts.fail) throw new Error("D1_ERROR: simulated outage"); return { results: db.prepare(sql).all(...args) }; } };
    return st;
  },
});

// ---- 組み立て(fixtures、国ごと)
const fxJP = path.join(tmp, "fx_jp"), fxUS = path.join(tmp, "fx_us");
const bj = build(path.join(here, "fixtures/obs2"), "JP", fxJP), bu = build(path.join(here, "fixtures/obs2"), "US", fxUS);
ok(bj.status === 0 && bu.status === 0, "fixture build exit 0 (JP and US): " + bj.stderr + bj.stdout.slice(-300) + bu.stderr + bu.stdout.slice(-300));
const manJP = manifestOf(fxJP), manUS = manifestOf(fxUS);

const db = new DatabaseSync(":memory:");
execV01(db);
db.exec(SCHEMA3);
applyDir(db, fxJP);
const dbu = new DatabaseSync(":memory:");
dbu.exec(SCHEMA3);
applyDir(dbu, fxUS);
const env = { DB: mkD1(db), DB_US: mkD1(dbu) };
const JP_ROWS = db.prepare("SELECT COUNT(*) AS n FROM obs2").get().n, US_ROWS = dbu.prepare("SELECT COUNT(*) AS n FROM obs2").get().n;
const FX_ROWS = JP_ROWS + US_ROWS;

const get = async (p, e) => (await worker.fetch(new Request("https://x" + p), e || env)).json();
const getRes = async (p, e) => worker.fetch(new Request("https://x" + p), e || env);
const rpc = async (b, e) => (await worker.fetch(new Request("https://x/mcp", { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } }), e || env)).json();
const call = async (name, args, e) => (await rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } }, e)).result;
const q = encodeURIComponent;

// ======================================================================
// v0.1 の 25 本(文言も条件も v0.1 のまま。変えたのは tools/list の数の1本だけで、理由は下に書いた)
// ======================================================================
const P0 = pass, F0 = fail;
ok(normPref("奈良") === "奈良県" && normPref("nara") === "奈良県" && normPref("Nara Prefecture") === "奈良県" && normPref("東京") === "東京都", "normPref");
ok(normPref("ナラ") === undefined, "unknown pref is undefined, not null");
ok(norm("２１－８－２５（２０）") === "21-8-25(20)", "norm zenkaku");

const h = await get("/health");
ok(h.ok && h.items === 95403 && h.obs === 4780, "health counts " + JSON.stringify(h).slice(0, 300));

const s = await get("/search?q=" + q("生コンクリート"));
ok(s.matched >= 1300 && s.observations_available > 0, "search namacon " + s.matched + " obs " + s.observations_available);
const s2 = await get("/search?q=" + q("生コンクリート ２１－８－２５"));
ok(s2.matched > 0 && s2.items.every((i) => norm(i.item_name).includes("21-8-25")), "search multi-term zenkaku");

const o = await get("/obs?q=" + q("生コンクリート") + "&pref=" + q("奈良"));
ok(o.pref === "奈良県", "obs pref normalized");
ok(o.by_status.published_pdl === 72, "nara kkr priced 72: " + JSON.stringify(o.by_status));
// 2026-09-26 番人の判断: 表が複製・転用を禁じている出典(奈良県の表など)は、行は載せず件数だけ(not_listed)。
// 実在の出典の行の一覧はリポに入れない約束なので、試験は架空の出典 test-fixture-jp-restricted-listing(奈良県、12 セル)で見る。
ok(!o.by_status.publication_based_not_public && !o.by_status.published_restricted_not_copied, "restricted-listing rows are not listed: " + JSON.stringify(o.by_status));
const nlN = (o.not_listed || []).find((x) => x.source_id === "test-fixture-jp-restricted-listing");
ok(nlN && nlN.by_status.publication_based_not_public === 5 && nlN.by_status.published_restricted_not_copied === 4 && nlN.by_status.not_set === 3 && nlN.cells_in_source === 12 && nlN.rows_in_db === 0 && /複製/.test(nlN.why_not_listed) && /^https:/.test(nlN.url), "not_listed: counts, reason and URL only");
ok(o.rows.every((r) => r.source_id !== "test-fixture-jp-restricted-listing"), "no restricted-listing row leaks into rows");
ok(o.rows[0].price_yen > 0, "priced rows first");
ok(o.rows.filter((r) => r.price_status !== "published_pdl").every((r) => r.price_yen == null), "no value leaks for restricted/publication rows");
ok(typeof o.not_listed_reading === "string" && o.not_listed_reading.includes("行を載せていない"), "not_listed reading present");
const takezutsu = await get("/obs?q=" + q("生コンクリート 21-8-25(20)") + "&pref=nara&status=published_pdl");
ok(takezutsu.rows.some((r) => r.area_code === "68" && r.price_yen === 36900), "竹筒(68) 21-8-25(20) = 36,900");
ok(!takezutsu.rows.some((r) => r.area_code === "66"), "十津川村(66) has no kkr value for 21-8-25(20)");

const l = await get("/labor?pref=" + q("奈良県") + "&job=" + q("大工"));
ok(l.rows.length === 1 && Number.isInteger(l.rows[0].wage_yen_per_8h), "nara daiku " + JSON.stringify(l.rows));
const ls = await get("/labor?pref=nara&job=" + q("石工"));
ok(ls.rows.length === 1 && ls.rows[0].price_status === "not_set" && ls.rows[0].wage_yen_per_8h == null, "nara ishiku not set");
const all = await get("/labor?pref=" + q("北海道") + "&limit=200");
ok(all.rows.length === 50, "50 trades per pref " + all.rows.length);
const bad = await get("/obs?pref=" + q("ナラ"));
ok(bad.error && bad.error.includes("分からない"), "unknown pref rejected");
const empty = await get("/obs");
ok(empty.error, "obs requires query or pref");

const tl = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
// v0.1 は tools.length === 4、v0.2 は 9 だった。v0.3 は米国の3本(prevailing_wage / permits / area_factor)を足すので 12(要求どおり)。
// 代わりに「v0.1 の4本が同じ名前で残っている」ことを確かめる形は v0.2 のまま。25 本のうち変えたのはこの1本だけ。
const V01 = ["jccdb_search_items", "jccdb_observations", "jccdb_labor_rate", "jccdb_sources"];
ok(tl.result.tools.length === 12 && V01.every((n) => tl.result.tools.some((t) => t.name === n)) && TOOLS.every((t) => t.annotations.readOnlyHint), "tools/list");
const tc = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "jccdb_observations", arguments: { query: "生コンクリート", pref: "奈良県", limit: 5 } } });
ok(tc.result && tc.result.structuredContent.matched > 0 && !tc.result.isError, "tools/call observations");
const src = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "jccdb_sources", arguments: {} } });
ok(Object.keys(src.result.structuredContent.sources).length === 3, "sources 3");
const unk = await rpc({ jsonrpc: "2.0", id: 4, method: "nope" });
ok(unk.error && unk.error.code === -32601, "unknown method");
await get("/search?q=" + q("'; DROP TABLE items; --"));
const h2 = await get("/health");
ok(h2.items === 95403, "injection harmless");
const V01_PASS = pass - P0, V01_FAIL = fail - F0;

// ======================================================================
// v0.3: 組み立て(国ごと、検査器の関所、ファイルの大きさ、文の大きさ、辞書の表、台帳と同じ値を持たない、JS/Python の一致)
// ======================================================================
{
  const nl = manJP.built.not_listed_rows_by_source["test-fixture-jp-restricted-listing"];
  ok(manJP.built.obs2 === JP_ROWS && manUS.built.obs2 === US_ROWS && manJP.built.validator.errors === 0 && manUS.built.validator.errors === 0,
    "manifest counts = DB rows per country (JP " + JP_ROWS + ", US " + US_ROWS + ")");
  // v0.2 の「検査器の行数 = DB の行数」は1つの DB だった。v0.3 は国で分けたので、検査器の observations の行数 = JP + US。
  ok(manJP.built.validator.rows_by_dir.observations === FX_ROWS && manJP.built.validator.rows === FX_ROWS + nl && nl === 12, "validator rows (observations/) = JP + US rows; restricted 12 cells checked but not loaded");
  // v0.2 の「1 ファイル 2000 文まで」は、v0.3 では「1 ファイルは --max-mb 以下、1 文は D1 の上限 100,000 bytes 以下」に替えた(多行の INSERT にしたため)。
  const stmtOk = (dir) => Object.keys(manifestOf(dir).sql_files).every((f) => fs.readFileSync(path.join(dir, f), "utf8").split("\n").every((line) => Buffer.byteLength(line) < 100000));
  ok(stmtOk(fxJP) && stmtOk(fxUS), "every statement < 100,000 bytes (D1 limit)");
  ok(manUS.fts_files.length === 1 && !manJP.fts_files.length && manUS.apply_order[0] === "schema/0003_obs3.sql" && manUS.apply_order[manUS.apply_order.length - 1].includes("fts_"), "US has FTS files last in apply_order; JP has none");
  const shaOk = (dir) => Object.entries(manifestOf(dir).sql_files).every(([f, sha]) => crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex") === sha);
  ok(shaOk(fxJP) && shaOk(fxUS), "MANIFEST sha256 matches every file");
  // 小さい --max-mb で、ファイルが分かれ、どれも上限以下(1 つの文の組が上限を超えるときだけ越えてよい)
  const small = path.join(tmp, "small_jp");
  const bs = build(path.join(here, "fixtures/obs2"), "JP", small, ["--max-mb", "0.25"]);
  const ms = manifestOf(small);
  const files = Object.keys(ms.sql_files);
  ok(bs.status === 0 && files.length >= 5 && files.every((f) => fs.statSync(path.join(small, f)).size <= 250000) && ms.built.obs2 === JP_ROWS, "--max-mb 0.25 splits into " + files.length + " files, each <= 250,000 bytes");
  const dsmall = new DatabaseSync(":memory:");
  dsmall.exec(SCHEMA3);
  applyDir(dsmall, small);
  const cols = "obs_id, price, note_id, members_id";
  ok(JSON.stringify(dsmall.prepare(`SELECT ${cols} FROM obs2 ORDER BY rid`).all()) === JSON.stringify(db.prepare(`SELECT ${cols} FROM obs2 ORDER BY rid`).all()), "split build loads the same rows in the same order");
  // 検査器が誤りを返したら、何も書かずに止まる
  const brokenRoot = path.join(tmp, "broken");
  fs.cpSync(path.join(here, "fixtures/obs2"), brokenRoot, { recursive: true });
  const fn = path.join(brokenRoot, "observations/us/cost_sqft_test_fixture_restricted.csv");
  const lines = fs.readFileSync(fn, "utf8").split("\n");
  const cc = lines[1].split(",");
  cc[13] = "999"; // 値を写してはいけない行(restricted)に値を入れる
  lines[1] = cc.join(",");
  fs.writeFileSync(fn, lines.join("\n"));
  const outB = path.join(tmp, "broken_out");
  fs.mkdirSync(outB);
  fs.writeFileSync(path.join(outB, "001.sql"), "-- old");
  const b2 = build(brokenRoot, "US", outB);
  ok(b2.status !== 0 && /検査器が誤り/.test(b2.stderr + b2.stdout), "validator gate stops the build: " + b2.status);
  ok(fs.readFileSync(path.join(outB, "001.sql"), "utf8") === "-- old", "gate writes nothing (old files untouched)");
  const b3 = spawnSync("python3", [BUILDER, path.join(here, "fixtures/obs2"), "--country", "JP", "--out", path.join(root, "sql"), "--validator", VALIDATOR], { encoding: "utf8" });
  ok(b3.status !== 0 && fs.existsSync(path.join(root, "sql/051.sql")), "refuses to write into v0.1 sql/");
  const b4 = spawnSync("python3", [BUILDER, path.join(here, "fixtures/obs2"), "--country", "JP", "--out", path.join(tmp, "sql_us"), "--validator", VALIDATOR], { encoding: "utf8" });
  const b5 = spawnSync("python3", [BUILDER, path.join(here, "fixtures/obs2"), "--country", "FR", "--validator", VALIDATOR], { encoding: "utf8" });
  ok(b4.status !== 0 && /取り違え/.test(b4.stderr) && b5.status !== 0, "refuses JP into sql_us/ and an unknown country");
  // 日本の置き場所に米国の行があれば止まる(検査器は国の置き場所を見ないので、組み立てが見る)
  const mixRoot = path.join(tmp, "mix");
  fs.cpSync(path.join(here, "fixtures/obs2"), mixRoot, { recursive: true });
  fs.renameSync(path.join(mixRoot, "observations/us/wage_test_fixture.csv"), path.join(mixRoot, "observations/jp/wage_test_fixture.csv"));
  const b6 = build(mixRoot, "JP", path.join(tmp, "mix_out"));
  ok(b6.status !== 0 && /置き場所/.test(b6.stderr), "a US row under observations/jp stops the JP build");
  const b7 = build(path.join(here, "fixtures/obs2"), "US", path.join(tmp, "nofts"), ["--no-fts"]);
  ok(b7.status === 0 && !manifestOf(path.join(tmp, "nofts")).fts_files.length && manifestOf(path.join(tmp, "nofts")).built.fts === false, "--no-fts builds US without the FTS files");
}
{
  // 辞書の表と、台帳と同じ値を持たないこと(v0.3 の縮め方)。返す JSON の形は v0.2 と同じ(下の「行の形」)。
  for (const [label, d, man] of [["JP", db, manJP], ["US", dbu, manUS]]) {
    const r = d.prepare("SELECT SUM(note_id IS NOT NULL AND note_id NOT IN (SELECT note_id FROM notes)) AS bad_note, SUM(members_id IS NOT NULL AND members_id NOT IN (SELECT members_id FROM members)) AS bad_mem, " +
      "SUM(license IS NOT NULL) AS lic, SUM(evidence_url IS NOT NULL) AS ev, COUNT(*) AS n, MAX(rid) AS mx FROM obs2").get();
    const dup = d.prepare("SELECT (SELECT COUNT(*) FROM notes) - (SELECT COUNT(DISTINCT text) FROM notes) AS dn, (SELECT COUNT(*) FROM members) - (SELECT COUNT(DISTINCT text) FROM members) AS dm").get();
    ok(r.bad_note === 0 && r.bad_mem === 0 && dup.dn === 0 && dup.dm === 0, label + ": every note_id / members_id resolves; each text is stored once");
    ok(r.lic === man.built.license_kept && r.ev === man.built.evidence_url_kept && r.n === r.mx, label + ": license / evidence_url kept only when they differ from the ledger (" + r.lic + ", " + r.ev + "); rid has no gaps");
  }
  const meta = JSON.parse(db.prepare("SELECT v FROM meta WHERE k='built_v3'").get().v);
  const cov = db.prepare("SELECT SUM(n) AS n, SUM(n_priced) AS p FROM coverage WHERE listed = 1").get();
  const covNL = db.prepare("SELECT SUM(n) AS n, SUM(n_priced) AS p FROM coverage WHERE listed = 0").get();
  const priced = db.prepare("SELECT COUNT(*) AS n FROM obs2 WHERE price IS NOT NULL").get().n;
  ok(meta.obs2 === JP_ROWS && cov.n === JP_ROWS && cov.p === priced, "coverage (listed) sums = obs2 rows and priced rows");
  ok(covNL.n === 12 && covNL.p === 0 && db.prepare("SELECT COUNT(*) AS n FROM obs2 WHERE source_id = 'test-fixture-jp-restricted-listing'").get().n === 0, "coverage (not listed) = 12 cells, 0 priced, 0 rows in obs2");
  const rows = db.prepare("SELECT item_name, spec, norm, period, country, period_key FROM obs2").all();
  ok(rows.every((r) => norm(r.item_name + " " + r.spec) === r.norm), "norm: Python build = JS search for every JP row");
  const urows = dbu.prepare("SELECT norm, period, country, period_key FROM obs2").all();
  ok(rows.concat(urows).every((r) => periodStart(r.period, r.country) === r.period_key) && urows.every((r) => r.norm === null), "period_key: Python build = JS periodStart for every row; US rows have no norm (FTS5 instead)");
  const v01obs = db.prepare("SELECT COUNT(*) AS n FROM obs").get().n, v01items = db.prepare("SELECT COUNT(*) AS n FROM items").get().n;
  ok(v01obs === 4780 && v01items === 95403, "v0.1 tables kept (items / obs)");
  const gn = dbu.prepare("SELECT geo_level, geo_code, name, base_key FROM geo_names ORDER BY geo_level, geo_code").all();
  ok(gn.some((r) => r.geo_level === "county" && r.geo_code === "41051" && r.base_key === "multnomah") && gn.some((r) => r.geo_level === "usace_ep_region" && r.name === "Idaho; Oregon; Washington") && gn.every((r) => r.base_key === countyBase(r.name)), "geo_names: county / place / EP region names, base_key = JS countyBase");
  const fts = dbu.prepare("SELECT COUNT(*) AS n FROM obs2_fts WHERE obs2_fts MATCH ?").get(ftsQuery(["carpenters"])).n;
  ok(fts === 4 && !db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name = 'obs2_fts'").get().n, "FTS5 on the US DB only (carpenters* = 4 rows)");
}
{
  const FORBID = /[\u2013\u2014\u2015]/;
  const files = ["src/worker.js", "tools/make_d1_sql_v3.py", "schema/0003_obs3.sql", "test/harness.mjs", "test/fixtures/make_fixtures.py", "DEPLOY_TOshi.md", "wrangler.jsonc"]
    .concat(["REPORT_M1.md", "REPORT_M2.md"].filter((f) => fs.existsSync(path.join(root, f))));
  const hits = files.filter((f) => FORBID.test(fs.readFileSync(path.join(root, f), "utf8")));
  ok(!hits.length, "no em/en dash or horizontal bar in " + files.length + " files " + hits);
}

// ---- 地域・時点の正規化
{
  const g = (x, c) => normGeo(x, c);
  ok(g("奈良").code === "29" && g("nara").code === "29" && g("Nara Prefecture").code === "29" && g("JP-29").code === "29" && g("29", "JP").code === "29", "geo: 奈良 / nara / JP-29 / 29+JP");
  ok(g("29").code === "ambiguous_region" && g("29").candidates.length === 2, "geo: bare 29 is ambiguous (奈良県 / Missouri)");
  ok(g("CA").code === "06" && g("California").code === "06" && g("US-CA").code === "06" && g("06", "US").code === "06" && g("カリフォルニア州").code === "06", "geo: CA / California / US-CA / 06+US / カリフォルニア州");
  ok(g("48").country === "US" && g("48").name === "Texas", "geo: 48 is only Texas (JIS stops at 47)");
  ok(g("06037", "US").level === "county" && g("06037", "US").code === "06037", "geo: county FIPS");
  ok(g("kyoto").name === "京都府" && g("gifu").name === "岐阜県", "geo: kyoto / gifu (v0.1 normPref dropped these)");
  ok(g("ナラ").code === "unknown_region" && g("奈良", "US").code === "unknown_region", "geo: unknown / wrong country");
  ok(g("US").level === "national" && g("日本").level === "national", "geo: national");
  ok(normPeriod("2025 q1") === "2025Q1" && normPeriod("fy2025") === "FY2025" && normPeriod("2025/03") === "2025-03" && normPeriod("R7") === undefined, "period normalization");
  ok(periodStart("FY2025", "JP") === "2025-04-01" && periodStart("FY2025", "US") === "2024-10-01" && periodStart("2025Q3") === "2025-07-01", "period start (FY JP/US, quarter)");
  // v0.3: 前置きで種類を決める(5桁は郡 FIPS とも CBSA とも読めるため)
  ok(g("county:06037").level === "county" && g("cbsa:31080").level === "metro" && g("metro:31080").code === "31080" && g("state:OR").code === "41" && g("county:06037", "JP").code === "unknown_region", "geo: county: / cbsa: / metro: / state: prefixes");
  ok(countyBase("St. Clair County") === "stclair" && countyBase("King County, Washington") === "king" && countyBase("Multnomah") === "multnomah" && countyBase("Doña Ana County") === "doñaana", "countyBase");
  ok(JSON.stringify(ftsTokens("Carpenters(test)")) === JSON.stringify(["carpenters", "test"]) && ftsQuery(["carpent", "a", 'x"y']) === '"carpent"* AND "a" AND "x""y"*', "ftsTokens / ftsQuery (unicode61 word split, prefix for 2+ chars, quotes doubled)");
  ok(JSON.stringify(dbraCounties("Illinois Counties of Madison and St Clair")) === JSON.stringify(["Madison", "St Clair"]) && dbraCounties("Oregon Counties of Benton, Clackamas, Lane and Multnomah").length === 4, "dbraCounties: 'A, B and C' lists");
}

// ======================================================================
// jccdb_observations(v0.2 の引数と、v0.3 の2つの DB の束ね方)
// ======================================================================
{
  const us = await get("/obs?country=US&layer=index");
  // v0.2 は 93(NHCCI だけ)。v0.3 は米国の index に DoD ACF(3 施設 x 2)と USACE の州係数(3)の試験用の行を足したので 102。
  ok(us.matched === 102 && us.rows.every((r) => r.license === "US-PD-17USC105" && r.attribution && r.evidence_url && r.price != null && r.price_yen == null && r.currency === null), "obs: US index 102 rows with license/attribution/evidence_url");
  const ca = await get("/obs?geo=CA");
  ok(ca.matched === 3 && ca.country === "US" && ca.by_status.published_restricted_not_copied === 1, "obs: geo=CA resolves to US and finds 3 rows " + JSON.stringify(ca.by_status));
  ok(ca.rows.filter((r) => r.price_status === "published_restricted_not_copied").every((r) => r.price == null && r.has_value === false && r.license === "restricted"), "obs: restricted US row carries no value");
  const amb = await get("/obs?geo=13");
  ok(amb.invalid_argument && amb.code === "ambiguous_region" && amb.candidates.length === 2, "obs: geo=13 without country is ambiguous");
  const tokyo = await get("/obs?geo=13&country=JP&layer=labor&period=2026");
  ok(tokyo.matched === 50 && tokyo.rows.every((r) => r.pref === "東京都" && r.period === "2026-03"), "obs: geo=13+JP, period=2026 -> 50 labor rows");
  const p1 = await get("/obs?q=" + q("生コンクリート") + "&pref=nara&limit=10");
  const p2 = await get("/obs?q=" + q("生コンクリート") + "&pref=nara&limit=10&offset=10");
  ok(p1.next_offset === 10 && p2.offset === 10 && p2.next_offset === 20 && !p1.rows.some((r) => p2.rows.some((x) => x.obs_id === r.obs_id)), "obs: offset pages do not overlap");
  const old = await get("/obs?layer=labor&pref=" + q("奈良") + "&period=2025");
  ok(old.matched === 2 && old.rows.every((r) => r.period === "2025-03"), "obs: period=2025 finds only the 2025-03 rows");
  const bySrc = await get("/obs?source_id=fhwa-nhcci");
  ok(bySrc.matched === 93, "obs: source_id filter");
  const e1 = await get("/obs?layer=concrete"), e2 = await get("/obs?q=x&status=cheap"), e3 = await get("/obs?q=x&period=R8"), e4 = await get("/obs?q=x&country=FR");
  ok([e1, e2, e3, e4].every((e) => e.invalid_argument === true && e.fetch_failed === false && typeof e.error === "string"), "obs: invalid layer / status / period / country are argument errors");
  const zero = await get("/obs?q=" + q("存在しない品目ぴよ"));
  ok(zero.matched === 0 && zero.count === 0 && zero.lookup === "absent" && zero.source_read === true && !zero.error && /まだ取り込んでいない/.test(zero.honest_reading), "obs: 0 rows is absent, not an error");
  const pricedAll = await get("/obs?country=JP&status=published_pdl&limit=100");
  ok(pricedAll.rows.every((r) => r.license === "PDL1.0" && r.attribution && /^https?:/.test(r.evidence_url) && r.computed === false), "obs: priced rows carry license + attribution + evidence_url, computed:false");
  ok(typeof o.basis === "string" && o.basis === BASIS_NOTE.JP && us.basis === BASIS_NOTE.US && o.status_legend && Object.keys(o.status_legend).length === 7, "obs: BASIS_NOTE per country, STATUS_LEGEND of 7");
  // v0.3: country の無い呼び出しは両方の DB を引き、件数を足し、行は v0.2 と同じ順([日本 値あり][米国 値あり][日本 値なし][米国 値なし])で束ねる
  const both = await get("/obs?layer=index&limit=100");
  const jpN = db.prepare("SELECT COUNT(*) AS n FROM obs2 WHERE layer = 'index'").get().n, usN = dbu.prepare("SELECT COUNT(*) AS n FROM obs2 WHERE layer = 'index'").get().n;
  ok(both.matched === jpN + usN && both.by_country.JP === jpN && both.by_country.US === usN && !both.partial, "merge: counts are summed over both DBs (" + jpN + " + " + usN + ")");
  const pages = async (size) => { const out = []; for (let off = 0; off < both.matched; off += size) out.push(...(await get("/obs?layer=index&limit=" + size + "&offset=" + off)).rows.map((r) => r.obs_id)); return out; };
  const a7 = await pages(7), a13 = await pages(13);
  ok(a7.length === both.matched && new Set(a7).size === a7.length && a7.join() === a13.join(), "merge: pages of 7 and of 13 give the same total order without gaps or repeats");
  const kinds = (await Promise.all([0, 100].map((off) => get("/obs?layer=index&limit=100&offset=" + off)))).flatMap((x) => x.rows).map((r) => r.country + (r.price == null ? "-" : "+"));
  const firstIdx = (k) => kinds.indexOf(k), lastIdx = (k) => kinds.lastIndexOf(k);
  ok(lastIdx("JP+") < firstIdx("US+") && (firstIdx("JP-") < 0 || lastIdx("US+") < firstIdx("JP-")), "merge: JP priced, then US priced, then unpriced (v0.2 order by (price IS NULL), country)");
}

// ---- 呼べなかった と 0 件 を分ける(国ごと)
{
  const envDown = { DB: mkD1(db, { fail: true }), DB_US: mkD1(dbu, { fail: true }) };
  const r = await getRes("/obs?q=" + q("生コンクリート"), envDown);
  const j = await r.json();
  ok(r.status === 503 && j.fetch_failed === true && j.source_read === false && j.code === "db_unavailable" && j.matched === undefined, "db outage: REST 503 + fetch_failed, no count claim");
  const rc = await call("jccdb_coverage", {}, envDown);
  ok(rc.isError === true && rc.structuredContent.fetch_failed === true, "db outage: MCP isError + fetch_failed");
  const onlyV01 = new DatabaseSync(":memory:");
  onlyV01.exec(fs.readFileSync(path.join(root, "schema/0001_init.sql"), "utf8"));
  const envNo2 = { DB: mkD1(onlyV01) };
  const r2 = await get("/obs?q=x", envNo2);
  ok(r2.fetch_failed === true && r2.code === "obs2_not_loaded", "0003 not applied: obs2_not_loaded, not 0 rows");
  const noV01 = new DatabaseSync(":memory:");
  noV01.exec(SCHEMA3);
  applyDir(noV01, fxJP);
  const sv = await get("/search?q=x", { DB: mkD1(noV01), DB_US: mkD1(dbu) });
  ok(sv.fetch_failed === true && sv.code === "v01_not_loaded" && /items/.test(sv.error), "v0.1 tables missing: says which table, not 0 rows");
  const h3 = await get("/health", envNo2);
  // v0.2 は /0002/ を見ていた。v0.3 の表は schema/0003_obs3.sql が作るので /0003/ に変えた。
  ok(h3.ok === false && h3.obs2 === null && /0003/.test(h3.obs2_error), "health says 0003 is not applied");
  // 0003 は当たったが sql_jp を流している途中(built_v3 がまだ無い)
  const loading = new DatabaseSync(":memory:");
  execV01(loading);
  loading.exec(SCHEMA3);
  loading.exec(fs.readFileSync(path.join(fxJP, Object.keys(manJP.sql_files).sort()[0]), "utf8").split("\n").filter((x) => !x.includes("'built_v3'")).join("\n"));
  const lo = await call("jccdb_coverage", {}, { DB: mkD1(loading) });
  const lo2 = await get("/obs?q=" + q("存在しない品目ぴよ"), { DB: mkD1(loading) });
  ok(lo.isError && lo.structuredContent.code === "obs2_loading" && lo.structuredContent.fetch_failed === true && lo2.code === "obs2_loading" && lo2.matched === undefined, "reload in progress: obs2_loading + fetch_failed, never 0 rows");
  const hNoBind = await call("jccdb_observations", { query: "x" }, {});
  ok(hNoBind.isError && hNoBind.structuredContent.fetch_failed === true, "no D1 binding: fetch_failed");
  ok(h.ok === true && h.obs2 === FX_ROWS && h.obs2_complete === true && h.obs2_by_country.JP === JP_ROWS && h.obs2_by_country.US === US_ROWS, "health: obs2 rows per country and completeness");
}
// ---- v0.3: 片方の国だけ読めないとき(米国の部分だけ fetch_failed、日本の結果は返す)
{
  const envJP = { DB: mkD1(db) };
  const sj = await get("/search?q=" + q("生コンクリート"), envJP);
  ok(!sj.error && sj.partial === true && sj.parts.US.code === "db_us_not_bound" && sj.parts.US.fetch_failed === true && sj.parts.JP.source_read === true && Object.keys(sj.observations_by_layer).every((k) => k.startsWith("JP:")) && sj.lookup === "ok", "DB_US unbound: search answers from JP, US part fetch_failed");
  const z = await get("/obs?q=" + q("存在しない品目ぴよ"), envJP);
  ok(z.count === 0 && z.lookup === "unknown" && z.partial === true && /0 件という意味ではない/.test(z.partial_reading), "DB_US unbound: 0 rows is 'unknown', not 'absent'");
  const ru = await getRes("/obs?country=US&layer=index", envJP);
  const ju = await ru.json();
  ok(ru.status === 503 && ju.fetch_failed === true && ju.code === "db_us_not_bound" && ju.count === undefined, "DB_US unbound: a US-only call is fetch_failed (503)");
  const envUSonly = { DB: mkD1(db, { fail: true }), DB_US: mkD1(dbu) };
  const oc = await get("/obs?q=Carpenters", envUSonly);
  ok(oc.matched === 4 && oc.rows.every((r) => r.country === "US") && oc.partial === true && oc.parts.JP.code === "db_unavailable", "DB down: US rows returned, JP part fetch_failed");
  const cv = await get("/coverage", envJP);
  ok(cv.partial === true && cv.matrix.every((m) => m.country === "JP") && cv.absent.every((a) => a.country === "JP") && cv.parts.US.fetch_failed === true, "DB_US unbound: coverage says nothing is absent in the US (it is unread)");
  const usLoading = new DatabaseSync(":memory:");
  usLoading.exec(SCHEMA3);
  const ul = await getRes("/us?state=OR", { DB: mkD1(db), DB_US: mkD1(usLoading) });
  const ulj = await ul.json();
  ok(ul.status === 503 && ulj.code === "obs2_loading" && ulj.country === "US", "DB_US reloading: obs2_loading for the US");
  const srcs = await get("/sources?limit=5");
  const nJP = db.prepare("SELECT COUNT(*) AS n FROM sources2").get().n, nUS = dbu.prepare("SELECT COUNT(*) AS n FROM sources2").get().n;
  ok(srcs.count === nJP + nUS && srcs.returned === 5 && Object.keys(srcs.ledger).length === 5 && srcs.next_offset === 5 && srcs.built_v2.JP && srcs.built_v2.US, "sources: both ledgers counted, paged");
  const su = await get("/sources?country=US&q=dbra");
  ok(su.count === 2 && Object.keys(su.ledger).every((k) => k.includes("dbra")), "sources: country and query filters");
}

// ======================================================================
// jccdb_labor_rate(v0.2 のまま)
// ======================================================================
{
  ok(l.rows[0].period === "2026-03" && l.periods.length === 1, "labor: default returns the latest period (2026-03 over 2025-03)");
  const hi = await get("/labor?pref=" + q("奈良") + "&job=" + q("大工") + "&history=1");
  const s0 = hi.series && hi.series[0];
  ok(hi.history === true && hi.series.length === 1 && s0.periods.join() === "2025-03,2026-03" && s0.points[0].wage === 25000, "labor history: yearly series oldest first " + JSON.stringify(s0 && s0.periods));
  ok(s0.points.every((p) => p.license === "PDL1.0" && p.attribution && p.evidence_url && p.computed === false), "labor history: license/attribution/evidence on every point");
  const gone = await get("/labor?pref=" + q("北海道") + "&job=" + q("試験用職種"));
  ok(gone.rows.length === 1 && gone.rows[0].period === "2025-03", "labor: a trade only in an older year returns that year");
  const ge = await get("/labor?geo=" + q("カリフォルニア"));
  ok(ge.invalid_argument && ge.code === "unknown_region", "labor: US region under default JP is an argument error");
  const na = await call("jccdb_labor_rate", {});
  ok(na.isError && na.structuredContent.invalid_argument, "labor: no arguments is an argument error");
  const byJis = await get("/labor?geo=29&job=" + q("大工"));
  ok(byJis.rows.length === 1 && byJis.rows[0].pref === "奈良県", "labor: geo=29 means 奈良県 under JP");
  // v0.3: country=US は Davis-Bacon の行
  const lu = await get("/labor?country=US&geo=OR&job=carpenter&history=1");
  ok(!lu.error && lu.rows.length >= 4 && lu.rows.every((r) => r.license === "US-PD-17USC105" && r.attribution) && /Davis-Bacon/.test(lu.basis), "labor: country=US returns Davis-Bacon rows with the U.S. basis");
}

// ======================================================================
// jccdb_compare_regions(v0.2 のまま)
// ======================================================================
{
  const c = await get("/compare?q=" + q("生コンクリート") + "&spec=" + q("21-8-25(20)") + "&country=JP&limit=20");
  const plain = c.groups.find((g) => g.spec === "２１－８－２５（２０） [単位水量175以下W/C60以下]" && g.layer === "material");
  ok(plain && plain.stats.n_priced > 0 && plain.stats.min.value <= plain.stats.median.value && plain.stats.median.value <= plain.stats.max.value, "compare: min <= median <= max");
  ok(plain.stats.median.computed === true && plain.stats.min.computed === false && plain.stats.max.computed === false, "compare: median computed:true, min/max computed:false");
  ok(plain.stats.min.license === "PDL1.0" && plain.stats.min.attribution && plain.stats.min.evidence_url, "compare: min/max carry license/attribution/evidence_url");
  ok(plain.regions.some((r) => r.area_code === "68" && r.price === 36900), "compare: 竹筒 36,900 is in the plain 21-8-25(20) group");
  ok(c.groups.every((g) => g.regions.every((r) => norm(r.spec) === norm(g.spec) && norm(r.unit) === norm(g.unit) && r.price_basis === g.price_basis)), "compare: groups never mix spec/unit/basis (compared after norm)");
  ok(c.groups.every((g) => Object.values(g.by_status).reduce((a, b) => a + b, 0) === g.regions_total), "compare: by_status sums to regions");
  ok(c.groups.every((g) => !g.sources.includes("test-fixture-jp-restricted-listing") && !g.sources.includes("nara-shizai-r8-09")), "compare: rows of a not-listed source never appear");
  const cx = await get("/compare?q=" + q("生コンクリート") + "&spec=" + q("30-18-20(25)") + "&country=JP&limit=20");
  const cn = await get("/compare?q=" + q("生コンクリート") + "&spec=" + q("30-18-20(25)") + "&country=JP&limit=20&normalize=namacon");
  ok(cn.normalize === "namacon" && cn.groups_total <= cx.groups_total && cn.matched_rows === cx.matched_rows, "compare namacon: never more groups than exact, same rows " + cx.groups_total + " -> " + cn.groups_total);
  ok(cn.groups.filter((g) => g.layer === "material").every((g) => g.normalized && g.normalized.computed === true && g.regions.every((r) => { const k = namaconKey(r.item_name, r.spec); return k && k.cement === g.normalized.cement && k.designation === g.normalized.designation && k.wc_max === g.normalized.wc_max && k.c_min === g.normalized.c_min; })), "compare namacon: every region in a group has the same key");
  ok(cn.groups.some((g) => g.normalized.cement === "高炉") && cn.groups.some((g) => g.normalized.cement === "普通"), "compare namacon: 高炉 and 普通 stay apart");
  ok(typeof cn.normalize_note === "string" && cn.normalize_note.includes("単位水量"), "compare namacon: says which conditions are not in the key");
  const cbad = await get("/compare?q=" + q("生コンクリート") + "&normalize=zzz");
  ok(cbad.invalid_argument === true && cbad.fetch_failed === false, "compare: bad normalize is invalid_argument");
  ok(namaconKey("異形棒鋼", "SD345 D13") === null && namaconKey("生コンクリート", "２１－８－２５（２０） [Ｗ／Ｃ＝５５％以下]").designation === "21-8-25(20)", "namaconKey: only ready-mix, zenkaku ok");
  const lab = await get("/compare?q=" + q("大工") + "&layer=labor&country=JP");
  ok(lab.groups.length === 1 && lab.groups[0].regions_total === 47 && lab.groups[0].periods.join() === "2026-03" && lab.groups[0].periods_mixed === false, "compare: 大工 x 47 prefs, latest only");
  const z = await get("/compare?q=" + q("存在しない品目ぴよ"));
  ok(z.count === 0 && z.lookup === "absent" && !z.error && z.groups.length === 0, "compare: 0 rows");
  const e = await call("jccdb_compare_regions", { spec: "21-8-25" });
  const e2 = await get("/compare?q=x&geo_level=planet");
  ok(e.isError && e.structuredContent.invalid_argument && e2.invalid_argument, "compare: missing query / bad geo_level are argument errors");
  const cu = await get("/compare?q=" + q("Carpenters") + "&country=US");
  ok(cu.groups[0].regions_total === 4 && cu.groups[0].stats.max.value === 42 && cu.basis === BASIS_NOTE.US && cu.search.US === "fts5", "compare: US wage groups with US basis (FTS5)");
}

// ======================================================================
// jccdb_work_unit_price(v0.2 のまま。country が無いと両方の DB を引く)
// ======================================================================
{
  const w = await get("/work?q=" + q("掘削"));
  const tky = w.packages.find((p) => p.geo_code === "13"), osk = w.packages.find((p) => p.geo_code === "27");
  ok(w.packages_total === 2 && w.packages.every((p) => p.composition.length === 4 && p.price_basis !== "ratio"), "work: 2 packages, 4 ratio rows each (ratio rows are not packages)");
  ok(tky.composition_linked_by.join() === "obs_id" && osk.composition_linked_by.join() === "same_key_and_name" && tky.composition.some((c) => c.part === "構成比 機械 K1" && c.ratio === 45), "work: linked by note obs_id, else by same key and name; nested K1 kept");
  ok(w.packages.every((p) => p.license === "PDL1.0" && p.attribution && p.evidence_url && p.computed === false && p.composition.every((c) => c.computed === false)) && !("composition_sum" in tky), "work: package rows carry license/attribution/evidence_url; no summed ratios (they nest)");
  ok(w.composition_rows_attached === 8 && w.basis === BASIS_NOTE.JP, "work: all 8 ratio rows attached, JP basis");
  const wp = await get("/work?q=" + q("掘削") + "&limit=1&offset=1");
  ok(wp.returned === 1 && wp.packages[0].composition.length === 4 && wp.next_offset === null, "work: paging keeps compositions with their package");
  const wo = await get("/work?pref=osaka");
  ok(wo.packages_total === 2 && wo.packages.every((p) => p.geo_code === "27"), "work: pref=osaka normalized to 27");
  const w0 = await get("/work?q=" + q("存在しない工種ぴよ"));
  ok(w0.count === 0 && w0.lookup === "absent" && /行ある/.test(w0.honest_reading), "work: 0 matches while the layer has rows");
  const wus = await get("/work?q=x&country=US");
  ok(wus.count === 0 && /まだ1行も無い/.test(wus.honest_reading), "work: US work layer is empty and says so");
  const we = await call("jccdb_work_unit_price", {});
  ok(we.isError && we.structuredContent.invalid_argument, "work: no arguments is an argument error");
}

// ======================================================================
// jccdb_index_series
// ======================================================================
{
  const x = await get("/index?q=NHCCI");
  const s0 = x.series[0];
  const p2004 = s0.points.find((p) => p.period === "2004Q1"), p2003 = s0.points.find((p) => p.period === "2003Q1");
  const base = dbu.prepare("SELECT price FROM obs2 WHERE source_id='fhwa-nhcci' AND period='2003Q1'").get().price;
  const cur = dbu.prepare("SELECT price FROM obs2 WHERE source_id='fhwa-nhcci' AND period='2004Q1'").get().price;
  ok(x.series_total === 1 && s0.points_total === 93 && s0.license === "US-PD-17USC105" && s0.attribution, "index: NHCCI one series of 93 with license/attribution");
  ok(p2004.yoy && p2004.yoy.computed === true && p2004.yoy.base_period === "2003Q1" && Math.abs(p2004.yoy.pct - (cur / base - 1) * 100) < 0.001, "index: 2004Q1 yoy computed against 2003Q1");
  ok(p2003.yoy === null && /前年同期/.test(p2003.yoy_missing_reason) && p2003.computed === false, "index: first year has no yoy and says why");
  const w = await get("/index?q=NHCCI&from=2020Q1&to=2020Q4");
  ok(w.series[0].points.length === 4 && w.series[0].points.every((p) => p.yoy && p.yoy.computed), "index: window 2020Q1..2020Q4 = 4 points, yoy uses 2019 outside the window");
  const jp = await get("/index?q=" + q("デフレーター") + "&country=JP");
  const fy = jp.series.find((s) => s.spec === "総合 年度"), mo = jp.series.find((s) => s.spec === "総合");
  ok(fy.points.find((p) => p.period === "FY2025").yoy.pct === 10 && mo.points.find((p) => p.period === "2025-01").yoy.pct === 10, "index: FY and monthly yoy (10.0%)");
  const cat = await get("/index");
  // v0.2 は 3 系列(JP 2 + NHCCI)。v0.3 は米国の DoD ACF(3 施設 x ACF・Sustainment ACF = 6)と USACE の州係数(Table 3 と Table 4 = 2)の試験用の系列を足したので 11。
  ok(cat.mode === "catalog" && cat.count === 11 && cat.series.every((r) => r.license), "index: catalog mode lists series (both DBs)");
  const e1 = await get("/index?q=NHCCI&from=R2"), e2 = await get("/index?q=NHCCI&from=2021&to=2020");
  ok(e1.invalid_argument && e2.invalid_argument, "index: bad from / reversed window are argument errors");
  const z = await get("/index?q=" + q("存在しない指数ぴよ"));
  ok(z.count === 0 && z.lookup === "absent" && !z.error, "index: 0 series");
}

// ======================================================================
// jccdb_us_prices(v0.2 の引数 + v0.3 の全 layer と geo)
// ======================================================================
{
  const ca = await get("/us?state=CA");
  // v0.2 は 8(CA 3 行 + 全国 5 行)。v0.3 の jccdb_us_prices は米国の全 layer を引く(要求どおり)ので、全国の index(NHCCI 93 行)も入って 101。
  ok(ca.matched === 101 && ca.by_layer.wage === 2 && ca.by_layer.equipment === 1 && ca.by_layer.spending === 2 && ca.by_layer.index === 93, "us: CA = 3 CA rows + 5 national rows + 93 national index rows " + JSON.stringify(ca.by_layer));
  ok(ca.rows.every((r) => (r.geo_level === "national" ? r.geo_match === "national" : r.geo_match === "exact")) && !ca.rows.some((r) => r.geo_level === "metro"), "us: geo_match marks, metro not matched by state");
  const caOnly = await get("/us?state=California&include_national=false");
  ok(caOnly.matched === 3, "us: include_national=false");
  const txr = await Promise.all(["TX", "Texas", "48", "US-TX", q("テキサス")].map((st) => get("/us?layer=bid_item&include_national=false&state=" + st)));
  ok(txr.every((r) => r.matched === 2 && r.rows.every((x) => x.geo_level === "district" && x.license === "OPEN-TERMS" && x.attribution)), "us: TX / Texas / 48 / US-TX / テキサス agree (2 district bids)");
  const cost = await get("/us?layer=cost_sqft");
  const nat = cost.rows.find((r) => r.geo_level === "national");
  ok(nat.per_m2 && nat.per_m2.computed === true && nat.per_m2.value === Math.round((150 / 0.09290304) * 100) / 100 && nat.price === 150 && nat.computed === false, "us: per_m2 is computed:true, price stays the source value");
  const rs = cost.rows.find((r) => r.price_status === "published_restricted_not_copied");
  ok(rs && rs.price === null && !rs.per_m2 && rs.license === "restricted", "us: restricted row has no value and no per_m2");
  ok(cost.basis === BASIS_NOTE.US && /not residential remodeling/.test(cost.basis), "us: US basis note");
  // v0.2 は layer=material を引数の誤りにしていた(米国の layer でなかった)。v0.3 は米国の全 layer を受けるので、誤りの例を gold に替えた。
  const e1 = await get("/us?layer=gold"), e2 = await get("/us?state=" + q("ナラ")), e3 = await get("/us?state=" + q("奈良"));
  ok(e1.invalid_argument && e2.invalid_argument && e3.invalid_argument, "us: bad layer / unknown / Japanese pref are argument errors");
  const z = await get("/us?q=" + q("nothing-like-this"));
  ok(z.count === 0 && z.lookup === "absent" && !z.error, "us: 0 rows");
  // v0.3: 全 layer と geo(郡 FIPS・CBSA・市・郡の名前)
  const um = await get("/us?layer=material");
  ok(!um.error && um.count === 0 && um.lookup === "absent" && US_PRICE_LAYERS.length === 11, "us: material is a U.S. layer (0 rows here, absent)");
  const lab = await get("/us?layer=labor&state=OR&include_national=false");
  ok(lab.matched === 10 && lab.rows.every((r) => r.layer === "labor" && r.license === "US-PD-17USC105" && r.attribution && r.evidence_url), "us: layer=labor (Davis-Bacon) with license/attribution/evidence_url");
  const eq = await get("/us?layer=equipment&state=OR");
  ok(eq.matched === 2 && eq.rows.some((r) => r.geo_match === "region" && r.geo_code === "EP-R8") && eq.rows.some((r) => r.geo_match === "national"), "us: a state adds its USACE equipment region (geo_match region) and national rows");
  const co = await get("/us?geo=county:41051");
  const co2 = await get("/us?geo=" + q("Multnomah County, OR"));
  ok(co.matched === 16 && co.geo.level === "county" && co2.matched === 16 && co2.geo.code === "41051" && !co.rows.some((r) => r.geo_match === "national"), "us: county by FIPS and by name (no national rows by default below state level)");
  const pl = await get("/us?geo=" + q("Portland, OR"));
  ok(pl.geo.level === "place" && pl.matched === 28 && pl.by_layer.spending === 26 && pl.by_layer.cost_limit === 1 && pl.by_layer.cost_sqft === 1, "us: place 'Portland, OR' = BPS place 16 + city permits 11 + HUD 1 rows");
  const cb = await get("/us?geo=cbsa:38900&period=2024");
  ok(cb.matched === 8 && cb.rows.every((r) => r.geo_level === "metro" && r.period === "2024"), "us: cbsa:38900 + period");
  const ab = await get("/us?geo=53033"), abc = await get("/us?geo=county:53033");
  ok(ab.invalid_argument && ab.code === "ambiguous_region" && ab.candidates.length === 2 && abc.matched === 1 && abc.rows[0].layer === "wage", "us: 53033 is county or CBSA -> ambiguous; county:53033 resolves");
  const ep = await get("/us?state=OR&geo=WA");
  ok(ep.invalid_argument, "us: state and geo that disagree are an argument error");
}

// ======================================================================
// jccdb_coverage
// ======================================================================
{
  const c = await get("/coverage");
  const has = (cc, ll) => c.matrix.some((m) => m.country === cc && m.layer === ll);
  const pricedN = db.prepare("SELECT COUNT(*) AS n FROM obs2 WHERE price IS NOT NULL").get().n + dbu.prepare("SELECT COUNT(*) AS n FROM obs2 WHERE price IS NOT NULL").get().n;
  ok(c.total_rows === FX_ROWS && c.priced_rows === pricedN, "coverage: totals match the DBs");
  ok(["material", "labor", "work", "index"].every((x) => has("JP", x)) && ["index", "wage", "bid_item", "equipment", "spending", "cost_sqft", "labor", "cost_limit"].every((x) => has("US", x)), "coverage: JP and US layers present");
  // v0.3 は layer が 11(cost_limit を足した)。JP で無いのは equipment / wage / bid_item / spending / house_price / cost_limit の 6、
  // US で無いのは material / work / house_price の 3(米国に labor と cost_limit の試験用の行を足した)。合計は v0.2 と同じ 9。
  ok(c.absent.length === 9 && c.absent.some((a) => a.country === "US" && a.layer === "material" && /無い/.test(a.statement)), "coverage: 9 absent combinations (JP 6 + US 3) stated as absent");
  const jcs = c.matrix.find((m) => m.country === "JP" && m.layer === "cost_sqft");
  // v0.2 は built_v2.computed_rows。v0.3 は国ごとの組み立てなので built_v2.JP.computed_rows。
  ok(jcs.computed === 2 && jcs.priced === 6 && c.built_v2.JP.computed_rows === 2, "coverage: computed rows counted (JP cost_sqft 2 of 6)");
  const kkr = c.matrix.find((m) => m.country === "JP" && m.layer === "material").sources.find((x) => x.source_id === "kkr-zairyo-r8-09");
  ok(kkr.period_min === "2026-09" && kkr.period_max === "2026-09" && kkr.retrieved_at === "2026-09-26" && kkr.license === "PDL1.0" && kkr.priced === 846 && kkr.values_copied === true, "coverage: source period, retrieval date, licence");
  const um = await get("/coverage?country=US&layer=material");
  ok(um.count === 0 && um.lookup === "absent" && um.matrix.length === 0 && um.absent.length === 1, "coverage: US material is 0 and absent");
  const n = await get("/coverage?geo=" + q("奈良"));
  ok(n.matrix.some((m) => m.layer === "material") && n.matrix.some((m) => m.layer === "labor") && n.absent.some((a) => a.layer === "index"), "coverage: geo=奈良 shows material/labor, index absent there");
  const nm = n.matrix.find((m) => m.country === "JP" && m.layer === "material");
  const ns = nm && nm.sources.find((x) => x.source_id === "test-fixture-jp-restricted-listing");
  ok(nm && nm.not_listed_cells === 12 && ns && ns.row_listing === "not_in_public_build" && ns.rows_in_db === 0 && ns.rows === 12 && /複製/.test(ns.why_not_listed), "coverage: a restricted-listing table is counted (12) but not listed, with the reason");
  ok(nm.rows === nm.sources.filter((x) => x.row_listing === "listed").reduce((a, x) => a + x.rows, 0), "coverage: layer rows count only listed sources");
  const e = await get("/coverage?layer=gold");
  ok(e.invalid_argument, "coverage: bad layer is an argument error");
  const ul = c.matrix.find((m) => m.country === "US" && m.layer === "labor");
  ok(ul.sources_total === 2 && ul.source_families.length === 1 && ul.source_families[0].family === "test-fixture" && ul.source_families[0].rows === 10, "coverage: source_families sum sources by family");
}

// ======================================================================
// 組み立てで計算した値(原本に無い値)は computed:true
// ======================================================================
{
  const cs = await get("/obs?country=JP&layer=cost_sqft&limit=50");
  const per = cs.rows.filter((r) => r.price_basis === "cost_per_m2"), raw = cs.rows.filter((r) => r.price_basis !== "cost_per_m2");
  ok(per.length === 2 && per.every((r) => r.computed === true && /原本に無い値/.test(r.note)) && raw.every((r) => r.computed === false), "computed: 1m2 rows built by the pipeline are computed:true, source rows false");
  const cc = await get("/compare?q=" + q("総計(試験用)") + "&layer=cost_sqft&limit=5");
  const g = cc.groups.find((x) => x.price_basis === "cost_per_m2");
  ok(g && g.stats.min.computed === true && g.stats.max.computed === true && g.stats.min.value === 300000 && g.stats.max.value === 450000, "computed: compare keeps computed:true on min/max taken from computed rows");
  const lv = await get("/obs?q=" + q("生コンクリート") + "&pref=nara&status=published_pdl&limit=5");
  ok(lv.rows.every((r) => r.computed === false), "computed: published source values stay computed:false");
}

// ======================================================================
// MCP の面
// ======================================================================
{
  const names = tl.result.tools.map((t) => t.name);
  ok(["jccdb_compare_regions", "jccdb_work_unit_price", "jccdb_index_series", "jccdb_us_prices", "jccdb_coverage"].every((n) => names.includes(n)), "tools/list has the 5 v0.2 tools");
  ok(["jccdb_us_prevailing_wage", "jccdb_us_permits", "jccdb_us_area_factor"].every((n) => names.includes(n)), "tools/list has the 3 v0.3 U.S. tools");
  ok(TOOLS.every((t) => /[぀-ヿ一-鿿]/.test(t.description) && /[A-Za-z]{4,} [A-Za-z]{2,}/.test(t.description) && t.inputSchema.additionalProperties === false), "every tool: Japanese + English description, closed schema");
  // v0.2 は layer=material を引数の誤りの例にしていた。v0.3 は material を受けるので gold に替えた。
  const inv = await call("jccdb_us_prices", { layer: "gold" });
  const zero = await call("jccdb_us_prices", { query: "nothing-like-this" });
  ok(inv.isError === true && zero.isError === false && zero.structuredContent.lookup === "absent", "MCP: argument error isError, 0 rows not isError");
  const hist = await call("jccdb_labor_rate", { pref: "奈良", job: "左官", history: true });
  ok(!hist.isError && hist.structuredContent.series[0].points.length === 2, "MCP: history:true via tools/call");
  // v0.2 は 10(SCHEMA.md 9 + house_price)。v0.3 は米国の HUD の上限額の layer cost_limit を足して 11。
  ok(LAYERS.length === 11 && LAYERS.includes("house_price") && LAYERS.includes("cost_limit") && Object.keys(STATUS_LEGEND).length === 7, "layers (SCHEMA.md 9 + extra_enums house_price, cost_limit) and 7 statuses");
  const hp = await get("/obs?layer=house_price"), bogus = await get("/obs?layer=made_up_layer");
  ok(hp.count === 0 && !hp.error && /まだ1行も無い/.test(hp.honest_reading) && bogus.invalid_argument, "layer: known-but-empty layer says so; unknown layer is an argument error");
  const proto = await call("constructor", {});
  const st = await get("/obs?q=x&status=toString"), gg = await get("/obs?geo=constructor");
  ok(proto.isError && proto.structuredContent.code === "unknown_tool" && st.invalid_argument && gg.invalid_argument, "prototype names are not tools, statuses or regions");
}

// ======================================================================
// v0.3: jccdb_us_prevailing_wage(Davis-Bacon)
// ======================================================================
{
  const w = await get("/us/wage?state=OR");
  const carp = w.rates.find((r) => r.decision === "OR20260001" && r.trade === "CARPENTER");
  ok(w.count === 5 && w.rates.length === 5 && carp.base.value === 40 && carp.fringe.value === 20.5 && carp.revision === "3" && carp.published === "2026-08-14" && carp.construction_types === "Building" && /Multnomah/.test(carp.counties), "wage: base and fringe paired with decision, revision, published date, counties");
  ok(carp.total_hourly.value === 60.5 && carp.total_hourly.computed === true && carp.base.computed === false && carp.fringe.computed === false, "wage: base + fringe is computed:true, the parts are source values");
  ok(w.rates.every((r) => r.license === "US-PD-17USC105" && r.attribution && /^https?:/.test(r.evidence_url) && r.source_id.startsWith("test-fixture-us-dbra-")), "wage: every rate carries license, attribution and evidence_url");
  const diver = w.rates.find((r) => /DIVER/.test(r.trade)), lab = w.rates.find((r) => /LABORER/.test(r.trade));
  ok(diver.total_hourly === null && /日額/.test(diver.total_missing_reason) && diver.base.unit === "USD/day" && lab.fringe.value === 0 && lab.total_hourly.value === 30, "wage: a daily base is not added to an hourly fringe; a 0.00 fringe is a value");
  ok(/連邦の資金/.test(w.basis) && /not residential remodeling/.test(w.basis), "wage: BASIS_NOTE says these are federal minimums, not market rates");
  const t = await get("/us/wage?state=Oregon&trade=carpenter");
  ok(t.count === 2 && t.rates.every((r) => r.trade === "CARPENTER") && t.search.US === "fts5", "wage: trade via FTS5 (carpenter* = 2 decisions)");
  const c1 = await get("/us/wage?state=OR&county=41051"), c2 = await get("/us/wage?state=OR&county=" + q("Multnomah County"));
  ok(c1.count === 4 && c1.rates.every((r) => r.decision === "OR20260001") && c1.county.name === "Multnomah County" && c1.county.match.computed === true && c2.count === 4, "wage: county by FIPS or name matched against the decision's county list");
  const d = await get("/us/wage?decision=OR20260002"), ct = await get("/us/wage?state=OR&construction_type=Heavy");
  ok(d.count === 1 && d.rates[0].trade === "CARPENTER" && d.rates[0].base.value === 35 && ct.count === 1, "wage: decision number and construction type filters");
  const pg = await get("/us/wage?state=OR&limit=2&offset=2");
  ok(pg.returned === 2 && pg.offset === 2 && pg.next_offset === 4, "wage: paging over pairs");
  const none = await get("/us/wage?state=CA");
  ok(none.count === 0 && none.lookup === "absent" && /まだ取り込んでいない/.test(none.honest_reading) && /OR/.test(none.coverage_note), "wage: a state not ingested says so and lists the ingested states");
  const e1 = await get("/us/wage"), e2 = await get("/us/wage?state=OR&county=06037"), e3 = await get("/us/wage?decision=XX1"), e4 = await get("/us/wage?state=CA&decision=OR20260001");
  ok([e1, e2, e3, e4].every((e) => e.invalid_argument === true), "wage: missing state, county of another state, bad decision, state/decision mismatch are argument errors");
  const nob = await get("/us/wage?state=OR", { DB: mkD1(db) });
  ok(nob.fetch_failed === true && nob.code === "db_us_not_bound", "wage: without DB_US it is fetch_failed, not 0");
}

// ======================================================================
// v0.3: jccdb_us_permits(Census BPS と市の許可)
// ======================================================================
{
  const st = await get("/us/permits?geo=OR&year=2024");
  const one = st.bps.records.find((r) => r.structure === "1-unit");
  ok(st.bps.count === 2 && one.buildings.value === 8000 && one.units.value === 8000 && one.valuation.value === 3200000 && one.valuation.unit === "USD thousand" && one.valuation.value_usd.value === 3200000000 && one.valuation.value_usd.computed === true, "permits: state record (thousand USD with a computed USD conversion)");
  ok(one.valuation_per_unit.value === 400000 && one.valuation_per_unit.computed === true && one.buildings.computed === false && one.buildings.ref.note === "Reported Only", "permits: per-unit value is computed:true; counts are source values with the Reported Only ref");
  ok(st.city_permits.count === 2 && st.city_permits.records.every((r) => r.city === "Portland"), "permits: a state lists its cities' permit distributions");
  const pl = await get("/us/permits?geo=" + q("Portland, OR") + "&year=2024");
  const all = pl.city_permits.records.find((r) => /\(all /.test(r.item));
  ok(pl.bps.count === 2 && pl.bps.records.every((r) => r.area_label === "Portland") && all.permits.value === 100 && all.valuation_median.value === 30000 && all.valuation_p25.value === 10000 && all.valuation_p75.value === 80000 && all.valuation_total.value === 5000000, "permits: place = BPS place records + city quartiles");
  ok(all.valuation_median.computed === true && all.valuation_per_sqft_median.value === 150 && all.valuation_per_sqft_median.per_m2.computed === true && all.valuation_median.license === "OPEN-TERMS" && all.valuation_median.attribution, "permits: city distribution values are computed (from declared valuations), with license and attribution");
  const co = await get("/us/permits?geo=" + q("Multnomah County, OR"));
  ok(co.bps.count === 4 && co.bps.records[0].period === "2025" && co.bps.records.every((r) => r.valuation.unit === "USD" && !r.valuation.value_usd) && co.city_permits.count === 0, "permits: county records newest first, dollars (no conversion)");
  const mt = await get("/us/permits?geo=cbsa:38900&structure=" + q("5+ units"));
  ok(mt.bps.count === 1 && mt.bps.records[0].structure === "5+ units" && mt.bps.records[0].valuation_per_unit.value === 250000, "permits: metro + structure");
  const nat = await get("/us/permits");
  ok(nat.geo.level === "national" && nat.bps.count === 0 && nat.city_permits.count === 2 && nat.city_permits.cities_ingested.join() === "Portland", "permits: national default lists all ingested cities");
  ok(/申請者/.test(nat.basis) && /not residential remodeling/.test(nat.basis), "permits: BASIS_NOTE says valuations are declared, not quotes");
  const amb = await get("/us/permits?geo=53033"), bad = await get("/us/permits?structure=house"), bad2 = await get("/us/permits?geo=" + q("Nowhere, OR"));
  ok(amb.code === "ambiguous_region" && bad.invalid_argument && bad2.invalid_argument, "permits: ambiguous 5-digit, bad structure, unknown place are argument errors");
  const nobps = await get("/us/permits?geo=county:53033");
  ok(nobps.count === 0 && nobps.lookup === "absent" && /無い/.test(nobps.honest_reading), "permits: 0 rows is absent with a reason");
}

// ======================================================================
// v0.3: jccdb_us_area_factor(DoD ACF と USACE の州係数)
// ======================================================================
{
  const a = await get("/us/area-factor?geo=OR");
  const ft = a.sites.find((x) => x.installation === "FORT TESTING OR");
  ok(a.sites_total === 2 && ft.area_cost_factor.value === 1.1 && ft.sustainment_area_cost_factor.value === 1.05 && /Multnomah/.test(ft.location) && ft.license === "US-PD-17USC105" && ft.attribution && ft.evidence_url, "area: sites with ACF and Sustainment ACF paired, with location and license");
  ok(a.acf_stats.n_sites === 2 && a.acf_stats.min === 1.02 && a.acf_stats.max === 1.1 && a.acf_stats.median.value === 1.06 && a.acf_stats.median.computed === true, "area: ACF median over the sites is computed:true");
  ok(a.state_adjustment_factor.current.value === 1.08 && a.state_adjustment_factor.history.length === 2 && a.state_adjustment_factor.current.computed === false, "area: USACE state adjustment factor (current and history)");
  const c = await get("/us/area-factor?geo=" + q("Multnomah County, OR")), z = await get("/us/area-factor?geo=zip:97401"), p = await get("/us/area-factor?geo=" + q("Portland, OR"));
  ok(c.sites_total === 1 && c.sites[0].installation === "FORT TESTING OR" && z.sites_total === 1 && z.sites[0].installation === "CAMP EXAMPLE OR" && z.state_adjustment_factor.state.code === "41" && p.sites_total === 1, "area: county, ZIP and city matched against the site's County / Zip / City");
  const jp = await get("/us/area-factor?geo=Japan"), jp2 = await get("/us/area-factor?geo=country:JP");
  ok(jp.sites_total === 1 && jp.sites[0].area_cost_factor.value === 1.93 && jp.geo.level === "country" && jp2.sites_total === 1 && jp.state_adjustment_factor === null, "area: an overseas country (OCONUS)");
  const ins = await get("/us/area-factor?installation=" + q("fort testing"));
  ok(ins.sites_total === 1 && ins.search.US === "fts5", "area: installation name via FTS5");
  const e = await get("/us/area-factor"), e2 = await get("/us/area-factor?geo=cbsa:38900");
  ok(e.invalid_argument && e2.invalid_argument, "area: no geo/installation, or a metro, is an argument error");
  ok(/96 基準都市/.test(a.basis) && /not residential remodeling/.test(a.basis), "area: BASIS_NOTE says these are budgeting factors, not a fairness test");
}

// ======================================================================
// v0.3: 米国の検索は FTS5。FTS5 の無い D1 では LIKE に落ちる(同じ行が出る)
// ======================================================================
{
  const noFts = new DatabaseSync(":memory:");
  noFts.exec(SCHEMA3);
  applyDir(noFts, path.join(tmp, "nofts"));
  const envNo = { DB: mkD1(db), DB_US: mkD1(noFts) };
  const envHalf = { DB: mkD1(db), DB_US: mkD1(dbu, { hide: /built_v3_fts/ }) }; // FTS の組み立てがまだ終わっていない(built_v3_fts が無い)
  let same = true;
  // 「(test)」のように記号を含む語は、FTS5 では記号が区切りになり LIKE では文字として当たるので、同じにならない(並べない)。
  for (const qq of ["Carpenters", "excavation", "fort testing", "carpenter", "Oregon"]) {
    const a = await get("/obs?country=US&limit=100&q=" + q(qq)), b = await get("/obs?country=US&limit=100&q=" + q(qq), envNo), c = await get("/obs?country=US&limit=100&q=" + q(qq), envHalf);
    same = same && a.count === b.count && a.count === c.count && a.rows.map((r) => r.obs_id).join() === b.rows.map((r) => r.obs_id).join() && a.search.US === "fts5" && b.search.US === "like" && c.search.US === "like_fallback";
  }
  ok(same, "FTS5 and the LIKE fallback return the same rows on the fixtures (search mode reported)");
  const pre = await get("/obs?country=US&q=carpent");
  ok(pre.count === 8 && pre.rows.some((r) => r.item_name === "CARPENTER") && pre.rows.some((r) => /Carpenters/.test(r.item_name)), "FTS5 matches word prefixes (carpent* = 4 Carpenters + 4 CARPENTER rows)");
}

// ======================================================================
// v0.3: 行の形は v0.2 と同じ(note / area_members / evidence_url / license / attribution を埋め戻す)
// ======================================================================
{
  const V02_ROW_KEYS = "obs_id,country,layer,category,item_name,spec,unit,geo_level,geo_code,geo_name,pref,area_label,area_code,area_members,price,currency,price_basis,price_status,has_value,price_yen,ref_value,ref_value_yen,ref_note,period,effective_from,source_id,source_page,evidence_url,license,attribution,jccdb_v4_item_id,note,computed";
  const r1 = (await get("/obs?q=" + q("生コンクリート") + "&pref=nara&limit=1")).rows[0], r2 = (await get("/us?layer=labor&state=OR&limit=1")).rows[0];
  ok(Object.keys(r1).join() === V02_ROW_KEYS && Object.keys(r2).filter((k) => k !== "geo_match").join() === V02_ROW_KEYS, "row keys are the v0.2 keys");
  const csvNote = db.prepare("SELECT n.text FROM obs2 o JOIN notes n USING (note_id) WHERE o.obs_id = ?").get(r1.obs_id);
  ok(r1.area_members.length > 10 && r1.note === (csvNote ? csvNote.text : "") && r1.evidence_url.startsWith("https://") && r1.license === "PDL1.0" && r2.area_members.startsWith("Oregon Counties of"), "note / area_members / evidence_url / license are filled back from the dictionaries and the ledger");
}

// ======================================================================
// 本番に流す sql_jp/ と sql_us/(あれば): ファイルの DB(一時ディレクトリ)に流し、全行の形と道具の答えを確かめる
// ======================================================================
let prodNote = "sql_jp/ と sql_us/ なし(本番の組み立ての検査は省略)";
const timings = [];
const prodJP = process.env.SQL_JP || path.join(root, "sql_jp"), prodUS = process.env.SQL_US || path.join(root, "sql_us");
if (process.env.PROD_SQL !== "0" && fs.existsSync(path.join(prodJP, "MANIFEST.json")) && fs.existsSync(path.join(prodUS, "MANIFEST.json"))) {
  const pmJ = manifestOf(prodJP), pmU = manifestOf(prodUS);
  const shaOk = (dir) => Object.entries(manifestOf(dir).sql_files).every(([f, sha]) => crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex") === sha);
  ok(shaOk(prodJP) && shaOk(prodUS), "prod: sql_jp / sql_us files match MANIFEST sha256");
  ok(pmJ.country === "JP" && pmU.country === "US" && pmJ.built.obs2_fingerprint_sha256 && pmJ.built.validator.errors === 0 && pmU.built.validator.errors === 0, "prod: manifests are per country and passed the validator");
  const tl0 = Date.now();
  const fj = path.join(tmp, "prod_jp.sqlite"), fu = path.join(tmp, "prod_us.sqlite");
  const pj = new DatabaseSync(fj), pu = new DatabaseSync(fu);
  for (const d of [pj, pu]) d.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;");
  execV01(pj); pj.exec(SCHEMA3); applyDir(pj, prodJP);
  pu.exec(SCHEMA3); applyDir(pu, prodUS);
  const size = (d) => d.prepare("PRAGMA page_count").get().page_count * d.prepare("PRAGMA page_size").get().page_size;
  const loadS = Math.round((Date.now() - tl0) / 1000);
  const nJ = pj.prepare("SELECT COUNT(*) AS n FROM obs2").get().n, nU = pu.prepare("SELECT COUNT(*) AS n FROM obs2").get().n;
  ok(nJ === pmJ.built.obs2 && nU === pmU.built.obs2 && nJ > 0 && nU > 0, "prod: obs2 rows = manifests (JP " + nJ + ", US " + nU + ")");
  ok(pmJ.built.validator.rows_by_dir.observations === nJ + nU, "prod: JP + US rows = validator rows in observations/ (" + (nJ + nU) + ")");
  // 全行の形(1 行ずつ読む。メモリに載せない)
  const OPEN = new Set(["published_pdl", "published_cc_by", "public_domain", "published_open_terms"]);
  const STATUS_LIC = { published_pdl: ["PDL1.0"], published_cc_by: ["CC-BY-4.0", "GOV-STD-2.0"], public_domain: ["US-PD-17USC105", "PD"], published_open_terms: ["OPEN-TERMS"] };
  const NEEDS_ATTR = new Set(["PDL1.0", "CC-BY-4.0", "GOV-STD-2.0", "OPEN-TERMS"]);
  const MARKS = ["原本に無い値", "not in the original", "not in the source"];
  for (const [label, d, man] of [["JP", pj, pmJ], ["US", pu, pmU]]) {
    const bad = {};
    const B = (k) => { bad[k] = (bad[k] || 0) + 1; };
    let n = 0;
    const it = d.prepare("SELECT o.*, n.text AS note_text, m.text AS members_text, s.url AS s_url, s.license AS s_license, s.attribution AS s_attr, s.source_id AS s_id FROM obs2 o " +
      "LEFT JOIN notes n ON n.note_id = o.note_id LEFT JOIN members m ON m.members_id = o.members_id LEFT JOIN sources2 s ON s.source_id = o.source_id").iterate();
    for (const r of it) {
      n++;
      if (!/^[0-9a-f]{16}$/.test(r.obs_id)) B("obs_id");
      if (r.country !== label) B("country");
      if (!r.s_id) B("ledger missing");
      if (r.source_id.startsWith("test-fixture")) B("test fixture row");
      const lic = r.license ?? r.s_license, ev = r.evidence_url ?? r.s_url;
      if (r.license !== null) B("license stored though same as ledger");
      if (r.evidence_url !== null && r.evidence_url === r.s_url) B("evidence_url stored though same as ledger");
      if (!/^https?:\/\//.test(ev || "")) B("evidence_url");
      if (OPEN.has(r.price_status) !== (r.price !== null)) B("value only in open statuses");
      if (OPEN.has(r.price_status) && !STATUS_LIC[r.price_status].includes(lic)) B("status/licence");
      if (r.price !== null && NEEDS_ATTR.has(lic) && !r.s_attr) B("attribution");
      if (r.note_id !== null && r.note_text == null) B("note_id dangling");
      if (r.members_id !== null && r.members_text == null) B("members_id dangling");
      const noteT = r.note_text || "";
      if ((r.computed === 1) !== MARKS.some((mk) => noteT.toLowerCase().includes(mk.toLowerCase()))) B("computed flag");
      if (periodStart(r.period, r.country) !== r.period_key) B("period_key");
      if (label === "JP" ? r.norm !== norm(r.item_name + " " + r.spec) : r.norm !== null) B("norm");
      if (r.layer !== "index" && !["count", "ratio"].includes(r.price_basis) && r.currency !== (label === "JP" ? "JPY" : "USD")) B("currency");
    }
    ok(n === man.built.obs2 && !Object.keys(bad).length, `prod ${label}: every row (${n}) has the v0.3 shape: ${JSON.stringify(bad)}`);
    const files = d.prepare("SELECT path, rows, rid_min, rid_max FROM src_files ORDER BY file_no").all();
    ok(files.every((f) => man.built.files[f.path] === f.rows && f.rid_max - f.rid_min + 1 === f.rows) && d.prepare("SELECT MAX(rid) AS m FROM obs2").get().m === n, `prod ${label}: rows per CSV = manifest, rid contiguous`);
    const cov = d.prepare("SELECT SUM(n) AS n, SUM(n_priced) AS p FROM coverage WHERE listed = 1").get();
    ok(cov.n === n && cov.p === d.prepare("SELECT COUNT(*) AS n FROM obs2 WHERE price IS NOT NULL").get().n, `prod ${label}: coverage sums = rows and priced rows`);
  }
  const tf = Date.now();
  let integ = "ok";
  try { pu.exec("INSERT INTO obs2_fts(obs2_fts) VALUES('integrity-check')"); } catch (e) { integ = e.message; }
  ok(integ === "ok", "prod US: FTS5 integrity-check against obs2 (" + ((Date.now() - tf) / 1000).toFixed(1) + "s): " + integ);
  const penv = { DB: mkD1(pj), DB_US: mkD1(pu) };
  const timed = async (p, e) => { const t = Date.now(); const r = await get(p, e || penv); timings.push([p, Date.now() - t, r.count ?? r.matched ?? r.total_rows ?? null]); return r; };
  const pc = await timed("/coverage");
  ok(pc.total_rows === nJ + nU && !pc.error && !pc.partial, "prod: coverage answers " + pc.matrix.map((m) => m.country + ":" + m.layer + "=" + m.rows).join(" "));
  const hz = await get("/health", penv);
  ok(hz.ok === true && hz.obs2_by_country.JP === nJ && hz.obs2_by_country.US === nU && hz.parts.US.fts === true, "prod: health ok for both DBs, FTS5 ready");
  const tk = await timed("/obs?q=" + q("生コンクリート 21-8-25(20)") + "&pref=nara&status=published_pdl");
  ok(tk.rows.some((r) => r.area_code === "68" && r.price_yen === 36900), "prod: 竹筒(68) 21-8-25(20) = 36,900");
  const nl = await timed("/labor?pref=" + q("奈良県") + "&job=" + q("大工"));
  ok(nl.rows[0].wage_yen_per_8h === 29600, "prod: 奈良 大工 29,600(令和8年3月)");
  const px = await timed("/compare?q=" + q("生コンクリート") + "&spec=" + q("24-8-25(20)") + "&country=JP&layer=material&limit=5");
  const pn = await timed("/compare?q=" + q("生コンクリート") + "&spec=" + q("24-8-25(20)") + "&country=JP&layer=material&limit=5&normalize=namacon");
  const top = pn.groups[0];
  ok(pn.groups_total < px.groups_total && pn.matched_rows === px.matched_rows && top && top.sources.length >= 3 && top.normalized.designation === "24-8-25(20)", "prod: namacon 24-8-25(20) groups " + px.groups_total + " -> " + pn.groups_total);
  const pw = await timed("/us/wage?state=CA&county=" + q("Los Angeles") + "&trade=carpenter");
  ok(pw.count > 0 && pw.rates.every((r) => r.base && r.fringe && r.license === "US-PD-17USC105" && /^https:\/\/sam\.gov\//.test(r.evidence_url)) && pw.rates.some((r) => r.total_hourly && r.total_hourly.computed) && pw.county.fips !== null, "prod: Davis-Bacon Los Angeles carpenter (" + pw.count + " rates)");
  const pp = await timed("/us/permits?geo=" + q("Austin, TX") + "&year=2024");
  ok(pp.bps.count > 0 && pp.city_permits.count > 0 && pp.city_permits.records.some((r) => r.valuation_median && r.valuation_median.computed === true), "prod: permits Austin 2024 (BPS place + city quartiles)");
  const pa = await timed("/us/area-factor?geo=NC");
  ok(pa.sites_total > 0 && pa.acf_stats.median.computed === true && pa.state_adjustment_factor.current && pa.state_adjustment_factor.current.value > 0 && pa.state_adjustment_factor.history.length >= 10, "prod: area factor NC (" + pa.sites_total + " sites)");
  const pco = await timed("/us?geo=county:06037&layer=spending&period=2024");
  ok(pco.count === 16 && pco.rows.every((r) => r.geo_code === "06037"), "prod: us county 06037 spending 2024 = 16 BPS rows");
  const pf = await timed("/obs?country=US&q=carpenters&limit=5");
  const pl = await timed("/obs?country=US&q=carpenters&limit=5", { DB: mkD1(pj), DB_US: mkD1(pu, { hide: /built_v3_fts/ }) });
  ok(pf.search.US === "fts5" && pl.search.US === "like_fallback" && pf.count > 0 && pf.count <= pl.count, "prod: FTS5 word-prefix hits (" + pf.count + ") are within the LIKE substring hits (" + pl.count + ")");
  for (const p of ["/us?limit=5", "/us?state=CA&layer=wage&q=carpenters", "/obs?q=carpenter&limit=3", "/us/wage?state=MI&trade=electrician", "/us/permits?geo=cbsa:31080&year=2025", "/us/area-factor?installation=" + q("cherry point"), "/index?country=US", "/search?q=" + q("生コンクリート")]) {
    const r = await timed(p);
    ok(!r.error && r.source_read === true, "prod: " + p + " answers");
  }
  prodNote = `sql_jp ${nJ} 行 ${Object.keys(pmJ.sql_files).length} ファイル / sql_us ${nU} 行 ${Object.keys(pmU.sql_files).length} ファイル、ファイルの DB: JP ${(size(pj) / 1e6).toFixed(0)} MB(v0.1 の表を含む)/ US ${(size(pu) / 1e6).toFixed(0)} MB、流し込み ${loadS}s`;
  pj.close(); pu.close();
}

console.log(`hs-jccdb-obs harness: ${pass} pass / ${fail} fail  (v0.1 の 25 本: ${V01_PASS} pass / ${V01_FAIL} fail、fixtures JP ${JP_ROWS} + US ${US_ROWS} 行、${prodNote}、${Math.round((Date.now() - T0) / 1000)}s)`);
if (timings.length) console.log("prod timings: " + timings.map(([p, ms, n]) => `${p} ${ms}ms(${n})`).join(" | "));
process.exit(fail ? 1 : 0);
