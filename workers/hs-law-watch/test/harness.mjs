// hs-law-watch の検査。本物の網には出ない。URL ごとに用意した返事を返す偽の fetch と、node:sqlite の D1 もどきで回す。
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import worker, { runAll, parseLinks, parseRss, parseEgovLaw, parseEgovRevs, resolveUrl, titleOk } from "../src/worker.js";
import { SOURCES } from "../src/sources.js";
import { dueNotices } from "../src/schedule.js";
import { impactOf } from "../src/impact.js";

const here = path.dirname(new URL(import.meta.url).pathname);
function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(path.join(here, "../schema/0001_init.sql"), "utf8"));
  return { prepare(sql) { let a = []; const st = { bind: (...x) => { a = x; return st; },
    first: async () => db.prepare(sql).get(...a) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...a) }),
    run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: r.changes } }; } }; return st; } };
}
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };

// ---- 偽の網 ----
const WORLD = {};
const SENT = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith("https://api.line.me/") || u.startsWith("https://api.github.com/")) { SENT.push({ u, body: JSON.parse(init.body) }); return new Response("{}", { status: 200 }); }
  const w = WORLD[u];
  if (!w) return new Response("not found", { status: 404 });
  if (w.status && w.status >= 500) return new Response("err", { status: w.status });
  return new Response(init.method === "HEAD" ? null : w.body, { status: w.status || 200 });
};
const S = Object.fromEntries(SOURCES.map((s) => [s.id, s]));
const tsuchiUrl = S["mhlw-shinryo-r8-tsuchi"].url;
const listHtml = (extra = "") => `<html><body><a href="/content/12400000/001712853.pdf">疑義解釈資料の送付について（その8）</a>
 <a href="/content/12400000/001752608.pdf">疑義解釈資料の送付について（その13）</a><a href="/stf/other.html">関係ない頁</a>${extra}</body></html>`;
const egov = (rev) => JSON.stringify({ laws: [{ law_info: { law_id: "412M50000100080" }, current_revision_info: { law_title: "指定訪問看護の事業の人員及び運営に関する基準", law_revision_id: rev, amendment_law_num: "令和八年厚生労働省令第二十一号", amendment_enforcement_date: "2026-06-01", current_revision_status: "CurrentEnforced" } }] });
const tdoc = (title, body) => `<html><head><title>・${title}(◆平成20年03月05日厚生労働省告示第67号)</title></head><body>${title} 本文 ${body}</body></html>`;

function setDay1(now) {
  for (const k of Object.keys(WORLD)) delete WORLD[k];
  WORLD[tsuchiUrl] = { body: listHtml() };
  WORLD[S["mhlw-news-rss"].url] = { body: `<rdf:RDF><item rdf:about="https://www.mhlw.go.jp/a.html"><title>第650回 中央社会保険医療協議会 総会</title><link>https://www.mhlw.go.jp/a.html</link></item><item><title>雇用の話</title><link>https://www.mhlw.go.jp/b.html</link></item></rdf:RDF>` };
  WORLD[S["egov-houkan-unei-kijun"].url] = { body: egov("412M50000100080_20260601_508M60000100021") };
  WORLD[S["egov-houkan-unei-kijun-revs"].url] = { body: JSON.stringify({ revisions: [{ law_revision_id: "412M50000100080_20260601_508M60000100021", current_revision_status: "CurrentEnforced" }] }) };
  WORLD[resolveUrl(S["kanpo-today"], now)] = { body: `<a href="./0001.html">訪問看護療養費に係る指定訪問看護の費用の額の算定方法の一部を改正する件（厚生労働一〇〇）</a><a href="./0002.html">道路の区域を変更する件</a>` };
  WORLD[S["tdoc-kokuji67-genko"].url] = { body: tdoc("訪問看護療養費に係る指定訪問看護の費用の額の算定方法", "01 5,550円") };
}

// ---- 1. 小道具 ----
ok(parseLinks('<a href="/x.pdf">A &amp; B</a><a href="#top">上</a>', "https://m.go.jp/p/q.html", "\\.pdf$").length === 1, "parseLinks filter + entity");
ok(parseRss("<item><title><![CDATA[T]]></title><link>L</link></item>")[0].title === "T", "parseRss CDATA");
ok(parseEgovLaw(egov("R1")).law_revision_id === "R1", "parseEgovLaw");
ok(parseEgovRevs('{"x":[{"law_revision_id":"B"},{"law_revision_id":"A"}]}').ids.join() === "A,B", "parseEgovRevs");
ok(resolveUrl(S["kanpo-today"], new Date("2026-09-25T23:30:00Z")).includes("20260926"), "kanpo URL uses JST date");
ok(resolveUrl(S["kkr-zairyo-next"], new Date("2026-09-26T00:00:00Z")).endsWith("2026_10tanka.pdf"), "probe next month");
ok(resolveUrl(S["kkr-zairyo-next"], new Date("2026-12-10T00:00:00Z")).endsWith("2027_01tanka.pdf"), "probe crosses year");
ok(impactOf("疑義解釈資料の送付について（その14）訪問看護ベースアップ評価料").items.includes("iryo-baseup"), "impact baseup");
ok(impactOf("疑義解釈資料の送付について（その14）").triage === "human_triage", "no keyword => human triage, not all items");
ok(impactOf("道路の区域").triage === "not_nursing_or_unknown", "non nursing");

// ---- 2. 1日目: 基準線 ----
const env = { DB: makeDb() };
const d1 = new Date("2026-09-26T00:07:00Z");
setDay1(d1);
const r1 = await runAll(env, d1);
ok(r1.sources["mhlw-shinryo-r8-tsuchi"].baseline === true, "day1 baseline list");
const ev1 = (await env.DB.prepare("SELECT * FROM events").all()).results;
ok(ev1.length === 1 && ev1[0].kind === "gazette" && JSON.parse(ev1[0].impact_json).nursing_marks.includes("訪問看護"), "day1 only the gazette hit " + JSON.stringify(ev1.map((e) => e.kind)));
ok(r1.sources["kkr-zairyo-next"].status === 404 && r1.sources["kkr-zairyo-next"].events === 0, "probe 404 no event");
ok(r1.sources["mhlw-kaigo-saishin"].failed === true, "unreachable source is recorded as failed, not empty");
ok(r1.notify.line === "skipped", "no LINE secret => skipped");

// ---- 3. 2日目: 増えたもの・変わったもの ----
const d2 = new Date("2026-09-27T00:07:00Z");
setDay1(d2);
WORLD[tsuchiUrl] = { body: listHtml('<a href="/content/12400000/001760000.pdf">疑義解釈資料の送付について（その14）訪問看護ベースアップ評価料</a>') };
WORLD[S["egov-houkan-unei-kijun"].url] = { body: egov("412M50000100080_20270401_509M60000100005") };
WORLD[S["tdoc-kokuji67-genko"].url] = { body: tdoc("厚生労働大臣が定める基準", "別の告示") };
WORLD[resolveUrl(S["kkr-zairyo-next"], d2)] = { status: 200, body: "" };
delete WORLD[resolveUrl(S["kanpo-today"], d2)];
WORLD[resolveUrl(S["kanpo-today"], d2)] = { body: `<a href="./0001.html">道路の区域を変更する件</a>` };
env.LINE_TOKEN = "t"; env.LINE_TO = "U1"; env.GITHUB_TOKEN = "g"; env.GITHUB_REPO = "ogasurfproject-jpg/jhnrd";
const r2 = await runAll(env, d2);
const ev2 = (await env.DB.prepare("SELECT * FROM events ORDER BY detected_at, kind").all()).results.filter((e) => e.detected_at.startsWith("2026-09-27"));
const kinds = ev2.map((e) => e.kind).sort();
ok(kinds.includes("new_link") && kinds.includes("revision") && kinds.includes("instrument") && kinds.includes("new_document"), "day2 kinds " + kinds);
const nl = ev2.find((e) => e.kind === "new_link");
ok(nl.title.includes("その14") && JSON.parse(nl.impact_json).items.includes("iryo-baseup"), "new link mapped to iryo-baseup");
ok(ev2.filter((e) => e.kind === "new_link").length === 1, "only the added link is an event (old links are not)");
ok(ev2.find((e) => e.kind === "instrument").title.includes("改正ではない"), "t_doc returning another law is not a change");
const snap = await env.DB.prepare("SELECT hash FROM snapshots WHERE source_id='tdoc-kokuji67-genko'").first();
ok(snap && snap.hash, "mismatch did not wipe the good snapshot");
ok(r2.notify.line === "sent" && SENT.some((s) => s.u.includes("api.line.me")), "LINE sent when secrets exist");
ok(SENT.filter((s) => s.u.includes("api.github.com")).every((s) => s.body.labels.includes("law-change") && s.body.body.includes("規則は書き換えていない")), "GitHub issue body honest");
ok(!SENT.filter((s) => s.u.includes("api.github.com")).some((s) => s.body.title.includes("改正ではない")), "instrument events do not open issues");

// 同じ日にもう一度回しても、同じ出来事は増えない
const before = (await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE kind != 'instrument'").first()).n;
await runAll(env, d2);
const added = (await env.DB.prepare("SELECT kind, source_id, title FROM events WHERE kind != 'instrument'").all()).results;
ok(added.length === before, "rerun same day adds no change events (idempotent) " + JSON.stringify(added.slice(before)));
// 届かない先は『回』で数える(1日2回の cron なので 3 回 = 1日半)。3回目に1回だけ知らせる
const failAlerts = (await env.DB.prepare("SELECT source_id FROM events WHERE kind='instrument' AND title LIKE '%続けて届いていない%'").all()).results;
ok(failAlerts.length > 0 && new Set(failAlerts.map((x) => x.source_id)).size === failAlerts.length, "unreachable sources alert once each");

// 題名は <title> で確かめる。別の告示が返り、本文にだけ同じ句があるときも「改正ではない」(2026-09-26 V3)。
ok(titleOk('<title>・厚生労働大臣が定める基準(◆平成27年03月23日厚生労働省告示第95号)</title>', ["厚生労働大臣が定める基準(", "告示第95号"]) === true, "titleOk: right notice");
ok(titleOk('<title>・指定居宅サービスに要する費用の額の算定に関する基準(◆平成12年02月10日厚生省告示第19号)</title><body>厚生労働大臣が定める基準に適合する</body>', ["厚生労働大臣が定める基準(", "告示第95号"]) === false, "titleOk: phrase only in the body of another notice => mismatch");
ok(titleOk('<title>・厚生労働大臣が定める基準に適合する利用者等(◆平成27年03月23日厚生労働省告示第94号)</title>', ["厚生労働大臣が定める基準(", "告示第95号"]) === false, "titleOk: notice 94 is not notice 95");

// ---- 4. 本文が変わった / 3回続けて届かない ----
const d3 = new Date("2026-09-28T00:07:00Z");
setDay1(d3);
WORLD[S["egov-houkan-unei-kijun"].url] = { body: egov("412M50000100080_20270401_509M60000100005") };
WORLD[S["tdoc-kokuji67-genko"].url] = { body: tdoc("訪問看護療養費に係る指定訪問看護の費用の額の算定方法", "01 5,660円") };
WORLD[tsuchiUrl] = { status: 500 };
await runAll(env, d3);
const ev3 = (await env.DB.prepare("SELECT * FROM events").all()).results.filter((e) => e.detected_at.startsWith("2026-09-28"));
ok(ev3.some((e) => e.kind === "text_changed"), "statute text change detected");
ok(!ev3.some((e) => e.kind === "instrument" && e.source_id === "mhlw-shinryo-r8-tsuchi"), "1st failure: no alert yet");
for (const day of ["2026-09-29", "2026-09-30"]) { const d = new Date(day + "T00:07:00Z"); setDay1(d); WORLD[tsuchiUrl] = { status: 500 }; await runAll(env, d); }
const alerts = (await env.DB.prepare("SELECT * FROM events WHERE kind='instrument' AND source_id='mhlw-shinryo-r8-tsuchi'").all()).results;
ok(alerts.length === 1 && alerts[0].title.includes("3 回続けて届いていない"), "3rd consecutive failure raises one alert");

// 官報の無い日(土日祝)は失敗に数えない
{
  const envK = { DB: makeDb() };
  const dk = new Date("2026-10-03T00:07:00Z"); // 土曜
  setDay1(dk); delete WORLD[resolveUrl(S["kanpo-today"], dk)];
  const rk = await runAll(envK, dk, ["kanpo-today"]);
  ok(rk.sources["kanpo-today"].status === 404 && !rk.sources["kanpo-today"].failed, "no gazette on Saturday is not a failure");
}
// ---- 5. 日付が先に分かっている変更 ----
ok(dueNotices("2026-09-26").length === 0, "nothing due in Sept 2026");
const due = dueNotices("2027-04-05").filter((n) => n.id.startsWith("r9-06"));
ok(due.length === 2 && due.every((n) => n.lead === 60), "60-day tier for 2027-06-01 items");
ok(dueNotices("2027-05-28").filter((n) => n.id.startsWith("r9-06")).every((n) => n.lead === 7), "7-day tier");
ok(dueNotices("2027-06-01").filter((n) => n.id.startsWith("r9-06")).every((n) => n.lead === 0), "day-0 tier");
const envS = { DB: makeDb() };
const dS = new Date("2027-04-05T00:07:00Z"); setDay1(dS);
await runAll(envS, dS); await runAll(envS, dS);
const sch = (await envS.DB.prepare("SELECT * FROM events WHERE kind='scheduled'").all()).results;
ok(sch.length >= 2 && sch.every((e) => e.title.includes("2027-06-01") || e.title.includes("2027")), "scheduled events once " + sch.length);

// ---- 6. HTTP ----
const call = (p, init) => worker.fetch(new Request("https://w" + p, init), env);
ok((await call("/admin/run", { method: "POST" })).status === 403, "admin without key 403");
env.ADMIN_KEY = "k".repeat(32);
ok((await call("/admin/run", { method: "POST", headers: { "x-admin-key": "x".repeat(32) } })).status === 403, "wrong key 403");
const ev = (await (await call("/events?status=open&domain=nursing")).json()).events;
ok(ev.length > 0 && ev.every((e) => Array.isArray(e.next_steps) && e.next_steps.length >= 2), "events carry next steps");
const up = await (await call("/admin/event", { method: "POST", headers: { "x-admin-key": env.ADMIN_KEY }, body: JSON.stringify({ event_id: ev[0].event_id, status: "triaged", note: "番人が読んだ" }) })).json();
ok(up.ok && up.changed === 1, "admin can triage");
const h = await (await call("/health")).json();
ok(h.ok && h.sources === SOURCES.length, "health");

// ---- 7. 米国の出典の見張り(2026-09-26 夕): 台帳の URL に link_filter が当たる / 見張らないものが載っていない ----
const ledgerUrls = {
  "bls-oews-tables": "https://www.bls.gov/oes/special-requests/oesm25ma.zip",
  "bls-qcew-files": "https://data.bls.gov/cew/data/files/2025/csv/2025_annual_by_industry.zip",
  "usace-cwccis": "https://publibrary.sec.usace.army.mil/api/download?id=9fcedc82-37ec-4b3c-e8de-1b9dfc89ebec&filename=CWCCIS_Mar_2026-Combined%20Tables.pdf&token=&preview=true",
  "hud-tdc": "https://www.hud.gov/sites/dfiles/PIH/documents/2024_Units_TDC_Limits.pdf",
  "fta-capital-cost": "https://www.transit.dot.gov/sites/fta.dot.gov/files/docs/FTA-Cost-Database-September-2024.csv",
  "cbr-tokuchou-shizai": "https://www.cbr.mlit.go.jp/architecture/kensetsugijutsu/unit_price/zip/r08/list_r8.08_shizai_aichi.zip",
};
for (const [id, u] of Object.entries(ledgerUrls)) ok(S[id] && new RegExp(S[id].link_filter).test(u), "ledger url matches filter: " + id);
ok(!new RegExp(S["bls-oews-tables"].link_filter).test("https://www.bls.gov/oes/special-requests/oesm25in4.zip"), "oews filter skips industry zip");
ok(SOURCES.filter((s) => s.domain === "construction" && s.kind === "list").every((s) => s.obs2_family || s.id === "kkr-zairyo-next"), "construction lists carry obs2_family");
ok(!SOURCES.some((s) => /sam\.gov|wbdg\.org/.test(s.url)), "SAM.gov and WBDG are not watched");
const cewHtml = `<a href="/cew/data/files/2025/csv/2025_annual_by_industry.zip">2025 annual by industry</a><a href="/cew/data/files/2025/csv/2025_qtrly_by_industry.zip">q</a>`;
ok(parseLinks(cewHtml, "https://data.bls.gov/cew/", S["bls-qcew-files"].link_filter).length === 1, "relative link resolved and filtered");

console.log(`hs-law-watch harness: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
