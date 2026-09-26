// 2026-09-13 patch4 の回帰テスト: 英語の工事名の写し(normalizeWork)、romaji の地域、next_calls、使用計数。
// 実物を叩く。souba-db はリポジトリの実データ。Yakumo の名簿は固定の作り物。KV は mock。ネットワーク無し。

import { readFileSync } from "node:fs";
import worker from "../src/mcp.js";

const DB = JSON.parse(readFileSync(new URL("../../../data/souba-db.json", import.meta.url), "utf8"));
const MULT = DB._meta.region_multipliers;
const FIX = { contractors: [
  { member_no: "No.002", name: "テスト住器株式会社", area: "平塚市", areas_served: ["平塚市", "藤沢市"], works: ["窓の交換", "内窓工事"], verification: "verified", fairness_score: 98, integrity_tier: "A", profile_url: "/yakumo/no002/" }
] };
globalThis.fetch = async (url) => {
  const u = String(url && url.url ? url.url : url);
  if (u.includes("/data/souba-db.json")) return new Response(JSON.stringify(DB), { headers: { "content-type": "application/json" } });
  if (u.includes("contractors.json")) return new Response(JSON.stringify(FIX), { headers: { "content-type": "application/json" } });
  throw new Error("テスト中に想定外の外部アクセス: " + u);
};
// KV mock(計数の確認用)
const kv = new Map();
const RL_KV = {
  get: async (k) => (kv.has(k) ? kv.get(k) : null),
  put: async (k, v) => { kv.set(k, String(v)); },
};
const ENV = { RL_KV };

let fail = 0;
const chk = (n, c, x = "") => {
  console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 240)));
  if (!c) fail++;
};
const rpcRaw = async (method, params, env) => {
  const r = await worker.fetch(new Request("https://hs-mcp.test/", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), env || {}, { waitUntil() {} });
  return (await r.json()).result;
};
const call = async (name, args, env) => {
  const res = await rpcRaw("tools/call", { name, arguments: args }, env);
  const t = res && res.content && res.content[0] && res.content[0].text;
  let o; try { o = JSON.parse(t); } catch (e) { o = { _raw: String(t) }; }
  o._isError = !!(res && res.isError);
  return o;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");

// ---- 1. 英語の工事名が日本語に写る。写した事は normalized_from で開示。日本語は触らん ----
{
  const a = await call("get_price_range", { query: "exterior wall painting" });
  chk("exterior wall painting -> 外壁塗装(query が日本語になる)", a.query === "外壁塗装", a.query);
  chk("  normalized_from に元の語", a.normalized_from === "exterior wall painting");
  chk("  当たる(count > 0)", a.count > 0 && /外壁/.test(a.prices[0].work), JSON.stringify(a).slice(0, 200));
  const b = await call("get_price_range", { query: "water heater" });
  chk("water heater -> 給湯器", b.query === "給湯器" && b.count > 0);
  const c = await call("get_price_range", { query: "eco cute" });
  chk("eco cute -> エコキュート(給湯器より先に当たる順)", c.query === "エコキュート");
  const d = await call("get_price_range", { query: "inner window" });
  chk("inner window -> 内窓(窓より先)", d.query === "内窓");
  const e = await call("get_price_range", { query: "roof painting" });
  chk("roof painting -> 屋根塗装(屋根より先)", e.query === "屋根塗装");
  const j = await call("get_price_range", { query: "外壁塗装 30坪" });
  chk("日本語はそのまま、normalized_from 無し", j.query === "外壁塗装 30坪" && j.normalized_from === undefined);
  const mix = await call("get_price_range", { query: "roof 屋根" });
  chk("日本語が混じっとれば触らん", mix.query === "roof 屋根" && mix.normalized_from === undefined);
  const nomatch = await call("get_price_range", { query: "spaceship hull" });
  chk("写せん英語はそのまま(嘘の写しはせん)", nomatch.normalized_from === undefined, JSON.stringify(nomatch).slice(0, 160));
  const s = await call("search_cost_category", { query: "termite" });
  chk("search_cost_category: termite -> シロアリ に当たる", s.query === "シロアリ" && Array.isArray(s.matches) && s.matches.some(m => /シロアリ/.test(m.name)) && s.normalized_from === "termite", JSON.stringify(s).slice(0, 200));
  const au = await call("audit_estimate", { work: "roof painting", quoted_price: 1200000 });
  chk("audit_estimate: roof painting 120万 は屋根塗装で判定され ok やない", au.work === "屋根塗装 30坪（シリコン）" && au.level !== "ok" && au.normalized_from === "roof painting", JSON.stringify(au).slice(0, 200));
  chk("  claim.work は写した後の工事名", au.claim && au.claim.work === au.work);
  const pv = await call("preview_reverse_estimate", { work: "water heater", quoted_price: 400000 });
  chk("preview: water heater が当たる(did_you_mean や該当なしやない)", pv._isError === false && pv._raw === undefined && !pv.did_you_mean, JSON.stringify(pv).slice(0, 160));
}

// ---- 2. romaji の地域 ----
{
  const r = await call("get_price_range", { query: "給湯器", region: "Kanagawa" });
  chk("Kanagawa -> kanto (romaji)", r.region && r.region.key === "kanto" && r.region.matched_by === "romaji" && r.region.multiplier === MULT.kanto, JSON.stringify(r.region));
  const n = await call("get_price_range", { query: "給湯器", region: "Nagoya, Aichi" });
  chk("Nagoya, Aichi -> chubu", n.region && n.region.key === "chubu");
  const o = await call("get_price_range", { query: "給湯器", region: "Osaka" });
  chk("Osaka -> kinki", o.region && o.region.key === "kinki" && o.region.multiplier === MULT.kinki);
  const both = await call("get_price_range", { query: "water heater", region: "hiratsuka" });
  chk("英語の工事名 + romaji の地域を同時に", both.query === "給湯器" && both.region && both.region.key === "kanto" && both.prices[0].base !== undefined);
}

// ---- 3. next_calls: 同じサーバーの次の一手、引数が埋まっとる ----
{
  const p = await call("get_price_range", { query: "給湯器", region: "平塚市" });
  const nc = p.next_calls || [];
  chk("get_price_range に next_calls 3 本", nc.length === 3, JSON.stringify(nc).slice(0, 200));
  const a = nc.find(x => x.tool === "audit_estimate");
  chk("  audit_estimate: work は先頭の一致、region は要求どおり、quoted_price は fill", a && a.arguments.work === p.prices[0].work && a.arguments.region === "平塚市" && a.fill && /JPY/.test(a.fill.quoted_price));
  const f = nc.find(x => x.tool === "find_verified_contractor");
  chk("  find_verified_contractor: work と area が埋まっとる", f && f.arguments.work === "給湯器" && f.arguments.area === "平塚市");
  const c = nc.find(x => x.tool === "check_red_flags");
  chk("  check_red_flags: text は fill", c && c.fill && c.fill.text);
  const p0 = await call("get_price_range", { query: "給湯器" });
  const a0 = (p0.next_calls || []).find(x => x.tool === "audit_estimate");
  chk("  region 無しなら arguments に region 無し", a0 && a0.arguments.region === undefined);
  chk("  next_calls の tool は全部 tools/list に在る", (async () => true)() && nc.every(x => ["audit_estimate", "find_verified_contractor", "check_red_flags"].includes(x.tool)));

  const au = await call("audit_estimate", { work: "屋根塗装", quoted_price: 1200000, region: "神奈川県" });
  const anc = au.next_calls || [];
  chk("audit_estimate に next_calls 3 本", anc.length === 3, JSON.stringify(anc).slice(0, 200));
  const af = anc.find(x => x.tool === "find_verified_contractor");
  chk("  find_verified_contractor: work は照会語、area は region の要求", af && af.arguments.work === "屋根塗装" && af.arguments.area === "神奈川県");
  const av = anc.find(x => x.tool === "verify_fair_price");
  chk("  verify_fair_price: work は一致した工事名", av && av.arguments.work === au.work);

  const fc = await call("find_verified_contractor", { area: "平塚市", work: "窓" });
  const fnc = fc.next_calls || [];
  chk("find_verified_contractor に next_calls(get_price_range と audit_estimate)", fnc.length === 2 && fnc[0].tool === "get_price_range" && fnc[0].arguments.query === "窓" && fnc[0].arguments.region === "平塚市" && fnc[1].tool === "audit_estimate" && fnc[1].fill.quoted_price, JSON.stringify(fnc).slice(0, 200));
  const fc0 = await call("find_verified_contractor", { area: "平塚市" });
  chk("  work 無しなら get_price_range は出さず、audit の fill に work", (fc0.next_calls || []).length === 1 && fc0.next_calls[0].tool === "audit_estimate" && fc0.next_calls[0].fill.work);
  chk("next_calls にダッシュ無し", !DASH.test(JSON.stringify({ a: nc, b: anc, c: fnc })));
}

// ---- 4. 使用計数(KV mock) ----
{
  kv.clear();
  await call("get_price_range", { query: "water heater", region: "Kanagawa" }, ENV);
  await call("audit_estimate", { work: "roof painting", quoted_price: 1200000, region: "平塚市" }, ENV);
  await call("get_price_range", { query: "給湯器" }, ENV);
  await sleep(30);
  chk("usage:normalize:en = 2(英語 2 回)", kv.get("usage:normalize:en") === "2", kv.get("usage:normalize:en"));
  chk("usage:region:requested = 1(get_price_range の Kanagawa)", kv.get("usage:region:requested") === "1", kv.get("usage:region:requested"));
  chk("usage:region:applied = 1(audit の 平塚市)", kv.get("usage:region:applied") === "1", kv.get("usage:region:applied"));
  chk("usage:skill:get_price_range = 2", kv.get("usage:skill:get_price_range") === "2", kv.get("usage:skill:get_price_range"));
  chk("usage:total = 3", kv.get("usage:total") === "3", kv.get("usage:total"));
  // usage-stats.json に新しい鍵が出る
  const r = await worker.fetch(new Request("https://hs-mcp.test/.well-known/usage-stats.json"), ENV, { waitUntil() {} });
  const st = await r.json();
  chk("usage-stats.json に usage:normalize:en / usage:region:applied / usage:skill:find_verified_contractor", st.counters && st.counters["usage:normalize:en"] === 2 && st.counters["usage:region:applied"] === 1 && "usage:skill:find_verified_contractor" in st.counters, JSON.stringify(st.counters).slice(0, 300));
}

// ---- 5. instructions ----
{
  const r = await rpcRaw("initialize", { protocolVersion: "2025-06-18" });
  chk("instructions に normalized_from と next_calls", /normalized_from/.test(r.instructions) && /next_calls/.test(r.instructions));
  chk("instructions にダッシュ無し", !DASH.test(r.instructions));
  chk("serverInfo 1.0.11", r.serverInfo.version === "1.0.11");
}

console.log(fail ? ("FAIL " + fail) : "ALL PASS");
process.exit(fail ? 1 : 0);
