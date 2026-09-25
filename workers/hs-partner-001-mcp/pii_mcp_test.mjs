/* 加盟店MCP(001・002)が AI に返すプロフィールから、施主の名前・金額・生の返事が消えているかを実物の fetch で確かめる。
   KV は模擬。ネットワークには出ない。
   なぜ要るか (2026-09-25): 加盟店MCPは profile.extra を全キーそのまま返していた。継続エンリッチで自由記述が増えると、
   「益田様の新店舗で…」がそのまま AI に渡る。当て先の決まらない生の返事(_unsorted)も出ていた。
   限界: 敬称の無い固有名詞(寺社名など)は自由記述からは拾えない。見積の件名は hs-hearing 側で語ごと落としている。 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pmcp-"));
let fails = 0, ran = 0;
function ok(name, cond, detail) { ran++; if (cond) return; fails++; console.log("  NG   " + name + (detail !== undefined ? "  <- " + detail : "")); }

async function loadWorker(rel) {
  const srcDir = path.join(REPO, path.dirname(rel));
  const dir = fs.mkdtempSync(path.join(TMP, "w-"));
  for (const f of fs.readdirSync(srcDir)) {
    if (!f.endsWith(".js")) continue;
    const body = fs.readFileSync(path.join(srcDir, f), "utf8").replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
    fs.writeFileSync(path.join(dir, f.replace(/\.js$/, ".mjs")), body);
  }
  return (await import(path.join(dir, path.basename(rel).replace(/\.js$/, ".mjs")) + "?v=" + Math.random())).default;
}
function kv(obj) { const m = new Map(Object.entries(obj).map(([k, v]) => [k, JSON.stringify(v)]));
  return { get: async (k, t) => { if (!m.has(k)) return null; const v = m.get(k); return t === "json" ? JSON.parse(v) : v; } }; }

console.log("0. 写し(src/pii.js)が正本と一字違わず同じ");
const canon = fs.readFileSync(path.join(REPO, "workers/hs-hearing/src/pii.js"), "utf8");
for (const w of ["hs-partner-001-mcp", "hs-partner-002-mcp"]) {
  const c = fs.readFileSync(path.join(REPO, "workers", w, "src/pii.js"), "utf8");
  ok(w + " の pii.js は正本と同じ(直すなら正本を直して写し直す)", c === canon);
}

const CASES = [
  ["workers/hs-partner-001-mcp/src/worker.js", "hs-partner-001", {
    company: "リフォーム職人株式会社",
    extra: {
      q_en_recent: { text: "先日は益田様の新店舗で内装を一新しました。費用は100万円でした。", at: "2026-09-25T05:00:00Z", attributed: "form" },
      q_cases: "田中様邸 外壁塗装、職人さん3名で施工",
      q_spec: "標準仕様は同様です。お客様に説明します。",
      _unsorted: { text: "森下です。以前記入しました。", at: "2026-09-25T05:03:22Z" },
      contact_tel: "090-0000-0000",
    } }],
  ["workers/hs-partner-002-mcp/src/worker.js", "hs-partner-002", {
    company: "ミネオトーヨー住器株式会社",
    strengths: "古木様邸の窓交換が得意。標準仕様で施工。",
    trust: "1956年創業。職人さんが多数在籍。",
    faqs: [{ q: "鴨宮瀬戸様から聞かれた質問は？", a: "内窓は約20万円からです。" }],
    extra: { q_en_season: { text: "梅雨前は土屋さんの家のように網戸の点検を。", at: "2026-09-25T00:00:00Z" },
             _unsorted: { text: "生の返事です" } } }],
];
for (const [rel, sid, prof] of CASES) {
  console.log("1. " + sid + " の get_partner_profile(実物の /mcp)");
  const worker = await loadWorker(rel);
  const env = { STORE_ID: sid, PARTNER_NAME: "テスト店",
    HS_HEARING_KV: kv({ ["store:" + sid]: { store_id: sid, member_no: sid === "hs-partner-001" ? "No.001" : "No.002", company: prof.company, status: "published", tier: "honbu", works: ["内装"], areas: ["愛知県"] },
                        ["hearing:" + sid]: { profile: prof } }) };
  const res = await worker.fetch(new Request("https://p.example/mcp", { method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_partner_profile", arguments: {} } }) }), env);
  const txt = await res.text();
  ok(sid + ": 答えが返る", res.status === 200 && /found/.test(txt), res.status + " " + txt.slice(0, 200));
  ok(sid + ": 施主の名前が無い", !/益田|田中|古木|鴨宮瀬戸|土屋/.test(txt), txt.slice(0, 500));
  ok(sid + ": 伏せた形(〇〇様/〇〇さん)で残る", /〇〇様|〇〇さん/.test(txt));
  ok(sid + ": 金額が無い", !/100万円|20万円/.test(txt), txt.slice(0, 500));
  ok(sid + ": 生の返事(_unsorted)は出ない", !/_unsorted|以前記入しました|生の返事です/.test(txt));
  ok(sid + ": 人名でない語(仕様・職人さん・お客様)は壊れない", /仕様/.test(txt) && (/職人さん/.test(txt) || /お客様/.test(txt)));
}
console.log(fails ? ("=== NG " + fails + " / " + ran + " ===") : ("加盟店MCPの掃除 全" + ran + "件 通過"));
process.exit(fails ? 1 : 0);
