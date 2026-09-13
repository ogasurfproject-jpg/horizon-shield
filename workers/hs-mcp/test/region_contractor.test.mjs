// 2026-09-13 patch2 の回帰テスト: region 係数、audit_estimate の claim hash、find_verified_contractor。
// 実物を叩く。souba-db はリポジトリの実データ。Yakumo の名簿は固定の作り物(公開項目の削り落としを検証するため、
// 内部項目 plan / rep / hearing / mcp_url を故意に入れとく)。ネットワーク無し。

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import worker from "../src/mcp.js";

const DB = JSON.parse(readFileSync(new URL("../../../data/souba-db.json", import.meta.url), "utf8"));
const MULT = DB._meta.region_multipliers;

const FIX_LIVE = { schema: "yakumo-contractors/v1", source: "hs-hearing KV (live)", contractors: [
  { member_no: "No.001", store_id: "hs-partner-001", name: "テスト塗装株式会社", rep: "内部の人名", area: "愛知県長久手市", areas_served: ["愛知県", "長久手市", "名古屋市"], works: ["外壁塗装", "屋根", "内装"], verification: "pending", status: "hearing_done", fairness_score: null, integrity_tier: null, profile_url: "/yakumo/no001/", mcp_url: "https://internal.example/mcp", plan: { base_fee_ex_tax: 29800 }, hearing: { sent: true } },
  { member_no: "No.002", store_id: "hs-partner-002", name: "テスト住器株式会社", rep: null, area: "平塚市", areas_served: ["平塚市", "茅ヶ崎市", "藤沢市", "鎌倉市"], works: ["窓の交換", "玄関の交換", "ガラス修理", "内窓工事"], verification: "verified", status: "published", fairness_score: 98, integrity_tier: "A", red_flags_detected: 0, verified_at: "2026-08-01", profile_url: "/yakumo/no002/", mcp_url: "https://internal.example/mcp", plan: { base_fee_ex_tax: 29800 }, hearing: { sent: true } },
  { member_no: null, store_id: "hs-partner-003", name: "", area: "平塚市全域", areas_served: ["平塚市全域"], works: ["医療処置"], verification: "pending", status: "hearing_done", fairness_score: null }
] };
const FIX_STATIC = { schema: "yakumo-contractors/v1", contractors: [ FIX_LIVE.contractors[1] ] };

let liveMode = "ok"; // ok | fail
let staticMode = "ok";
globalThis.fetch = async (url) => {
  const u = String(url && url.url ? url.url : url);
  if (u.includes("/data/souba-db.json")) return new Response(JSON.stringify(DB), { headers: { "content-type": "application/json" } });
  if (u.includes("hearing.horizonshield.dev/contractors.json")) {
    if (liveMode === "fail") throw new Error("live down");
    return new Response(JSON.stringify(FIX_LIVE), { headers: { "content-type": "application/json" } });
  }
  if (u.includes("/data/yakumo-contractors.json")) {
    if (staticMode === "fail") return new Response("nope", { status: 503 });
    return new Response(JSON.stringify(FIX_STATIC), { headers: { "content-type": "application/json" } });
  }
  throw new Error("テスト中に想定外の外部アクセス: " + u);
};

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
  // lookup / source_read は tools/call の包みが structuredContent にだけ足す(本文 content には無い)。
  o._lookup = res && res.structuredContent ? res.structuredContent.lookup : undefined;
  return o;
};
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");

// ---- 1. get_price_range: region 無しは従来どおり、region 有りは係数を掛けて基準値も返す ----
{
  const base = await call("get_price_range", { query: "給湯器" });
  chk("region 無し: region キーが無い", base.region === undefined);
  chk("region 無し: prices に base が無い", base.prices.every(p => p.base === undefined));
  const r = await call("get_price_range", { query: "給湯器", region: "平塚市" });
  chk("平塚市 -> kanto", r.region && r.region.key === "kanto", JSON.stringify(r.region));
  chk("  multiplier = _meta の kanto", r.region && r.region.multiplier === MULT.kanto);
  chk("  matched_by = city", r.region && r.region.matched_by === "city");
  chk("  applied = true", r.region && r.region.applied === true);
  chk("  件数は同じ", r.count === base.count);
  const ok = r.prices.every((p, i) => p.base && p.base.avg === base.prices[i].avg && p.avg === Math.round(base.prices[i].avg * MULT.kanto) && p.max === Math.round(base.prices[i].max * MULT.kanto));
  chk("  各行 avg/max = 基準 x 1.1、base に基準値", ok, JSON.stringify(r.prices[0]));
  const k = await call("get_price_range", { query: "給湯器", region: "神奈川県" });
  chk("神奈川県 -> kanto (prefecture)", k.region && k.region.key === "kanto" && k.region.matched_by === "prefecture");
  const kk = await call("get_price_range", { query: "給湯器", region: "kinki" });
  chk("鍵 kinki を直接", kk.region && kk.region.key === "kinki" && kk.region.multiplier === MULT.kinki && kk.region.matched_by === "key");
  const un = await call("get_price_range", { query: "給湯器", region: "火星" });
  chk("写せん地名: key null、note 有り、applied false", un.region && un.region.key === null && typeof un.region.note === "string" && un.region.applied === false, JSON.stringify(un.region));
  chk("  写せん地名: 値は基準のまま", un.prices.every((p, i) => p.avg === base.prices[i].avg && p.base === undefined));
  const ch = await call("get_price_range", { query: "給湯器", region: "chubu" });
  chk("chubu(係数 1.0): applied false、値は基準", ch.region && ch.region.applied === false && ch.prices.every((p, i) => p.avg === base.prices[i].avg));
  const gk = await call("get_price_range", { query: "外構フルセット", region: "東京都" });
  const rowKanto = gk.prices.find(p => /関東/.test(p.work));
  chk("工事名に地域が入っとる行には掛けん(外構フルセット 関東)", rowKanto && rowKanto.base === undefined, JSON.stringify(rowKanto));
}

// ---- 2. audit_estimate: region が判定に効く、claim と hash ----
{
  const b = await call("audit_estimate", { work: "屋根塗装", quoted_price: 1200000 });
  chk("region 無し: region キー無し", b.region === undefined);
  chk("claim が付く", b.claim && b.claim.tool === "audit_estimate" && b.claim.quoted_price === 1200000 && b.claim.level === b.level);
  chk("verification.claim_sha256 は 64 hex", b.verification && /^[0-9a-f]{64}$/.test(b.verification.claim_sha256));
  chk("  hash は JSON.stringify(claim) の SHA-256 と一致(再計算)", b.verification && sha256(JSON.stringify(b.claim)) === b.verification.claim_sha256);
  chk("  claim.observed_at は ISO", b.claim && /^\d{4}-\d{2}-\d{2}T/.test(b.claim.observed_at));
  chk("  claim.region は null", b.claim && b.claim.region === null);
  chk("  既存の固定は崩れてへん(屋根塗装120万は ok やない)", b.level !== "ok");
  const r = await call("audit_estimate", { work: "屋根塗装", quoted_price: 1200000, region: "神奈川県" });
  chk("kanto: fair_range.max = 600000 x 1.1", r.fair_range && r.fair_range.max === Math.round(600000 * MULT.kanto), JSON.stringify(r.fair_range));
  chk("  region.fair_range_base.max = 600000", r.region && r.region.fair_range_base && r.region.fair_range_base.max === 600000, JSON.stringify(r.region));
  chk("  region.applied true", r.region && r.region.applied === true);
  chk("  claim.region に key/multiplier", r.claim && r.claim.region && r.claim.region.key === "kanto" && r.claim.region.multiplier === MULT.kanto);
  chk("  hash 再計算一致", sha256(JSON.stringify(r.claim)) === r.verification.claim_sha256);
  chk("  120万は kanto でも ok やない", r.level !== "ok");
  // 係数で判定が動く例: 基準 max のすぐ上の金額は kanto なら ok に入る
  const edge = await call("audit_estimate", { work: "屋根塗装", quoted_price: 630000 });
  const edgeK = await call("audit_estimate", { work: "屋根塗装", quoted_price: 630000, region: "kanto" });
  chk("63万: 基準では上限超(watch)、kanto では ok", edge.level === "watch" && edgeK.level === "ok", edge.level + "/" + edgeK.level);
  const amb = await call("audit_estimate", { work: "リフォーム", quoted_price: 1200000, region: "kanto" });
  chk("判定保留の経路は region 有りでも保留のまま", amb.ambiguous === true && amb.verdict === undefined);
  chk("claim + verification + region にダッシュ無し", !DASH.test(JSON.stringify({ c: r.claim, v: r.verification, g: r.region })));
}

// ---- 3. find_verified_contractor ----
{
  const t = await rpcRaw("tools/list", {});
  const def = t.tools.find(x => x.name === "find_verified_contractor");
  chk("tools/list に find_verified_contractor", !!def);
  chk("  readOnlyHint true、outputSchema 有り", def && def.annotations.readOnlyHint === true && def.outputSchema && def.outputSchema.properties.stores);
  chk("  description にダッシュ無し", def && !DASH.test(def.description));

  const a = await call("find_verified_contractor", { area: "平塚市" });
  chk("平塚市: verified 1 件", a.verified_count === 1 && a.stores.length === 1 && a.count === 1, JSON.stringify(a).slice(0, 300));
  chk("  structuredContent.lookup = ok", a._lookup === "ok", a._lookup);
  const s = a.stores[0];
  chk("  公開項目だけ(plan/rep/hearing/mcp_url/store_id が無い)", s.plan === undefined && s.rep === undefined && s.hearing === undefined && s.mcp_url === undefined && s.store_id === undefined, JSON.stringify(Object.keys(s)));
  chk("  score/tier/profile_url が出る", s.fairness_score === 98 && s.integrity_tier === "A" && s.profile_url === "https://shield.the-horizons-innovation.com/yakumo/no002/");
  chk("  名前無しの行は pending にも出さん", a.pending_stores.every(p => p.name && p.name.length > 0) && a.pending_count === 0, JSON.stringify(a.pending_stores));
  chk("  directory_size: 掲載 2(名前無しは除外)、検証済み 1", a.directory_size && a.directory_size.total_listed === 2 && a.directory_size.verified_total === 1, JSON.stringify(a.directory_size));
  chk("  source は live", /live/.test(a.source));
  chk("  neutrality と mall と next_actions", /紹介料/.test(a.neutrality) && /\/yakumo\/$/.test(a.mall) && a.next_actions && a.next_actions.actions.length === 6);

  const b = await call("find_verified_contractor", { area: "愛知県" });
  chk("愛知県: verified 0、pending 1(スコア無し)", b.verified_count === 0 && b.pending_count === 1 && b.pending_stores[0].fairness_score === undefined && b._lookup === "absent", JSON.stringify(b).slice(0, 300));
  chk("  0 件の guidance は get_price_range と EHN を指す", /get_price_range/.test(b.guidance) && /EHN/.test(b.guidance));

  const w = await call("find_verified_contractor", { work: "窓" });
  chk("work=窓: verified 1", w.verified_count === 1 && w.stores[0].name === "テスト住器株式会社");
  const wz = await call("find_verified_contractor", { work: "窓", area: "名古屋市" });
  chk("窓 x 名古屋: 0 件(条件は AND)", wz.verified_count === 0 && wz.pending_count === 0);
  const all = await call("find_verified_contractor", {});
  chk("引数無し: 名前有りの全件(verified 1 + pending 1)", all.verified_count === 1 && all.pending_count === 1);
  const pref = await call("find_verified_contractor", { area: "神奈川県" });
  chk("神奈川県で平塚の店は当たらん(名簿に県名が無い、正直に 0)", pref.verified_count === 0);

  liveMode = "fail";
  const f = await call("find_verified_contractor", { area: "平塚" });
  chk("live が落ちたら静的に落ちる(source が static)", /static/.test(f.source) && f.verified_count === 1, JSON.stringify(f).slice(0, 200));
  staticMode = "fail";
  const g = await call("find_verified_contractor", { area: "平塚" });
  chk("両方落ちたら isError(0 件とは言わん)", g._isError === true && g.count === undefined, JSON.stringify(g).slice(0, 200));
  liveMode = "ok"; staticMode = "ok";

  // patch3: Service Binding が一番目。有れば公開 fetch は呼ばん。壊れとれば公開 fetch に落ちる。
  let publicCalls = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { if (String(url && url.url ? url.url : url).includes("hearing.horizonshield.dev")) publicCalls++; return origFetch(url); };
  const svcOk = { HEARING_SVC: { fetch: async (req) => new Response(JSON.stringify(FIX_LIVE), { headers: { "content-type": "application/json" } }) } };
  const sv = await call("find_verified_contractor", { area: "平塚" }, svcOk);
  chk("HEARING_SVC 有り: source に service binding、verified 1", /service binding/.test(sv.source) && sv.verified_count === 1, sv.source);
  chk("  公開 fetch は呼ばれてへん", publicCalls === 0, publicCalls);
  const svcBroken = { HEARING_SVC: { fetch: async () => { throw new Error("binding down"); } } };
  const sb = await call("find_verified_contractor", { area: "平塚" }, svcBroken);
  chk("HEARING_SVC が壊れとる: 公開 fetch(live)に落ちる", /live KV\)$/.test(sb.source) && sb.verified_count === 1, sb.source);
  chk("  公開 fetch が 1 回呼ばれた", publicCalls === 1, publicCalls);
  globalThis.fetch = origFetch;

  chk("next_actions.actions の find_verified_contractor に tool 名", a.next_actions.actions.find(x => x.id === "find_verified_contractor").tool === "find_verified_contractor");
  chk("返答にダッシュ無し", !DASH.test(JSON.stringify(a)));
}

// ---- 4. instructions に新 tool と region ----
{
  const r = await rpcRaw("initialize", { protocolVersion: "2025-06-18" });
  chk("instructions に find_verified_contractor", r.instructions.includes("find_verified_contractor"));
  chk("instructions に region の案内", /Pass region/.test(r.instructions) && /region\(都道府県か市名\)/.test(r.instructions));
  chk("instructions にダッシュ無し", !DASH.test(r.instructions));
}

console.log(fail ? ("FAIL " + fail) : "ALL PASS");
process.exit(fail ? 1 : 0);
