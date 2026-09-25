// 2026-09-13 tool-selection 層の回帰テスト。
// フロント LLM がこのサーバーを「いつ・どの順で」呼ぶかの案内(initialize.instructions)、
// 価格返答の出典(provenance)と次の一手(next_actions.actions、Yakumo 込み)が落ちんことを固定する。
// 既存の返答キー(source / verdict / level / fair_range / ehn_submit)は残る = additive。
// 実物を叩く。souba-db はリポジトリの実データを差し込む。ネットワーク無し。

import { readFileSync } from "node:fs";
import worker from "../src/mcp.js";

const DB = JSON.parse(readFileSync(new URL("../../../data/souba-db.json", import.meta.url), "utf8"));
globalThis.fetch = async (url) => {
  const u = String(url && url.url ? url.url : url);
  if (u.includes("/data/souba-db.json")) return new Response(JSON.stringify(DB), { headers: { "content-type": "application/json" } });
  throw new Error("テスト中に想定外の外部アクセス: " + u);
};

let fail = 0;
const chk = (n, c, x = "") => {
  console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 240)));
  if (!c) fail++;
};
const rpc = async (method, params) => {
  const r = await worker.fetch(new Request("https://hs-mcp.test/", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), {}, { waitUntil() {} });
  return (await r.json()).result;
};
const call = async (name, args) => {
  const res = await rpc("tools/call", { name, arguments: args });
  const t = res && res.content && res.content[0] && res.content[0].text;
  try { return JSON.parse(t); } catch (e) { return { _raw: String(t) }; }
};
const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");

// ---- 1. initialize.instructions: 1 行の看板やなく routing 指示 ----
{
  const r = await rpc("initialize", { protocolVersion: "2025-06-18" });
  const ins = String(r.instructions || "");
  chk("instructions が 300 字以上", ins.length >= 300, ins.length);
  for (const w of ["get_price_range", "audit_estimate", "check_red_flags", "verify_fair_price", "get_fair_price_sources", "Yakumo", "JPY", "相場", "referral", "ambiguous"]) {
    chk("instructions に " + w, ins.includes(w));
  }
  chk("instructions にダッシュ無し", !DASH.test(ins));
  chk("serverInfo.version は 1.0.10", r.serverInfo && r.serverInfo.version === "1.0.10", JSON.stringify(r.serverInfo));
}

// ---- 2. tools/list: 主要 2 ツールに利用者の言い回し(trigger) ----
{
  const r = await rpc("tools/list", {});
  const by = Object.fromEntries(r.tools.map(t => [t.name, t]));
  chk("tools は 15 本(14 + find_verified_contractor)", r.tools.length === 15, r.tools.length);
  chk("get_price_range description に 相場", /相場/.test(by.get_price_range.description));
  chk("get_price_range description に 'is this price normal'", /is this price normal/.test(by.get_price_range.description));
  chk("audit_estimate description に ぼったくり", /ぼったくり/.test(by.audit_estimate.description));
  chk("audit_estimate description に 'overcharged'", /overcharged/.test(by.audit_estimate.description));
  chk("get_price_range description にダッシュ無し", !DASH.test(by.get_price_range.description));
  chk("audit_estimate description にダッシュ無し", !DASH.test(by.audit_estimate.description));
}

// ---- 3. get_price_range: provenance + next_actions(今まで行き止まりやった) ----
{
  const o = await call("get_price_range", { query: "外壁塗装" });
  chk("prices が返る", Array.isArray(o.prices) && o.prices.length > 0, JSON.stringify(o).slice(0, 200));
  chk("source(旧キー)が残る", typeof o.source === "string");
  chk("detail(旧キー)が残る", typeof o.detail === "string");
  chk("provenance.dataset", o.provenance && o.provenance.dataset === "HORIZON SHIELD souba-db");
  chk("provenance.data_version = souba-db _meta.version", o.provenance && o.provenance.data_version === DB._meta.version, JSON.stringify(o.provenance && o.provenance.data_version));
  chk("provenance.updated_at = _meta.updated_at", o.provenance && o.provenance.updated_at === DB._meta.updated_at);
  chk("provenance.sources は _meta.sources と同数", o.provenance && Array.isArray(o.provenance.sources) && o.provenance.sources.length === DB._meta.sources.length);
  chk("provenance.related_open_dataset は『価格は含まない』と明記", /価格は含まない/.test((o.provenance && o.provenance.related_open_dataset && o.provenance.related_open_dataset.note) || ""));
  chk("provenance.papers に engrXiv 7814", /10\.31224\/7814/.test((o.provenance && o.provenance.papers && o.provenance.papers.engrxiv_benchmark) || ""));
  chk("next_actions.ehn_submit(旧キー)が残る", o.next_actions && typeof o.next_actions.ehn_submit === "string");
  chk("next_actions.yakumo", o.next_actions && /\/yakumo\/$/.test(o.next_actions.yakumo || ""));
  const acts = (o.next_actions && o.next_actions.actions) || [];
  const yak = acts.find(a => a.id === "find_verified_contractor");
  chk("next_actions.actions に find_verified_contractor", !!yak);
  chk("  url が /yakumo/", !!yak && /\/yakumo\/$/.test(yak.url), yak && yak.url);
  chk("  紹介料なしを両言語で明記", !!yak && /紹介料なし/.test(yak.label_ja) && /no referral/.test(yak.label_en));
  chk("actions は 6 本、全部 id/when/label_ja/label_en/url を持つ", acts.length === 6 && acts.every(a => a.id && a.when && a.label_ja && a.label_en && /^https:\/\//.test(a.url)), acts.length);
  chk("actions の id は重複無し", new Set(acts.map(a => a.id)).size === acts.length);
  chk("neutrality に『推奨ではなく』", /推奨ではなく/.test((o.next_actions && o.next_actions.neutrality) || ""));
  chk("provenance + next_actions にダッシュ無し", !DASH.test(JSON.stringify({ p: o.provenance, n: o.next_actions })));
}

// ---- 4. audit_estimate: provenance は additive、既存の判定キーは不変 ----
{
  const o = await call("audit_estimate", { work: "屋根塗装", quoted_price: 1200000 });
  chk("verdict/level/fair_range が残る", typeof o.verdict === "string" && typeof o.level === "string" && o.fair_range && typeof o.fair_range.avg === "number", JSON.stringify(o).slice(0, 200));
  chk("work_match の固定(屋根塗装120万を『適正』と言わん)は崩れてへん", o.level !== "ok", "level=" + o.level);
  chk("source(旧キー)が残る", typeof o.source === "string");
  chk("full_diagnosis(旧キー)が残る", typeof o.full_diagnosis === "string");
  chk("provenance が付く", o.provenance && o.provenance.dataset === "HORIZON SHIELD souba-db");
  chk("provenance.data_version = _meta.version", o.provenance && o.provenance.data_version === DB._meta.version);
  chk("next_actions.actions が付く", o.next_actions && Array.isArray(o.next_actions.actions) && o.next_actions.actions.length === 6);
  chk("provenance + next_actions にダッシュ無し", !DASH.test(JSON.stringify({ p: o.provenance, n: o.next_actions })));
}

// ---- 5. 判定保留の経路は変えてへん(provenance を足しても ambiguous は ambiguous) ----
{
  const o = await call("audit_estimate", { work: "リフォーム", quoted_price: 1200000 });
  chk("『リフォーム』120万は判定保留のまま", o.ambiguous === true, JSON.stringify(o).slice(0, 200));
  chk("  判定語を含まん", o.verdict === undefined && o.level === undefined);
}

console.log(fail ? ("FAIL " + fail) : "ALL PASS");
process.exit(fail ? 1 : 0);
