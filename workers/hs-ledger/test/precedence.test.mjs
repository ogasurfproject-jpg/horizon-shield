// test/precedence.test.mjs  先後(precedence)レシートの回帰テスト。
// 既存の citationCard を再利用する薄い枠を固定する。実 worker を mock KV で叩く。ネットワーク無し。
import { loadWorker, sha256Hex, mockKV } from "./load.mjs";
const worker = await loadWorker("src/worker.js");

const recPath = JSON.stringify({ schema: "jidec-path-v1", purpose: "walk mcp", walked_at: "2026-09-06T03:06:30Z", verdict: { ok: true, outcome: "PASS", n_pass: 5, n_total: 5 }, base: "https://mcp.horizonshield.dev", witness: { name: "W", vantage: "V" } });
const hPath = await sha256Hex(recPath);
const BT = "2026-09-07 01:08 UTC"; // 台帳の stamping 書式
const recBad = JSON.stringify({ schema: "v0", title: "x" });
const recPend = JSON.stringify({ schema: "v0", title: "pending" });
const hPend = await sha256Hex(recPend);

const kv = mockKV([
  ["seq", "7"],
  ["entry:5", JSON.stringify({ n: 5, work: "path", claim_sha256: hPath, record_canonical: recPath, schema: "jidec-path-v1", created_at: "2026-09-06T00:00:00Z", ots_status: "confirmed", bitcoin_block: 965862, block_time: BT })],
  [`hash:${hPath}`, "5"],
  // 壊れたエントリ: claim_sha256 が bytes と一致しない
  ["entry:6", JSON.stringify({ n: 6, work: "bad", claim_sha256: "0".repeat(64), record_canonical: recBad, schema: "v0", created_at: "2026-09-06T00:00:00Z", ots_status: "confirmed", bitcoin_block: 965900, block_time: BT })],
  // 錨待ち
  ["entry:7", JSON.stringify({ n: 7, work: "pend", claim_sha256: hPend, record_canonical: recPend, schema: "v0", created_at: "2026-09-06T00:00:00Z", ots_status: "pending", bitcoin_block: null, block_time: null })],
  [`hash:${hPend}`, "7"],
]);
const env = { LEDGER: kv.binding };

let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 240))); if (!c) fail++; };
const get = async (path, headers = {}) => {
  const r = await worker.fetch(new Request("https://ledger.horizonshield.dev" + path, { headers: new Headers(headers) }), env, { waitUntil() {} });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = { _md: t }; }
  return { status: r.status, body: b };
};
const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");

// 1. 基本: entry:5 の先後が established
{
  const o = await get("/precedence/jidec:entry:5");
  chk("entry:5 established", o.status === 200 && o.body.precedence && o.body.precedence.established === true, JSON.stringify(o.body).slice(0, 200));
  chk("  existed_at_or_before = block_time", o.body.precedence.existed_at_or_before === BT);
  chk("  bitcoin_block 965862", o.body.precedence.bitcoin_block === 965862);
  chk("  『署名では立証できん』を明記", /signature would not establish/.test(o.body.precedence.what_it_means));
  chk("  recompute と verify_block_url がある", !!o.body.precedence.recompute && /\/ots$/.test(o.body.precedence.verify_block_url || ""));
}
// 2. 64hex でも解決
{
  const o = await get("/precedence/" + hPath);
  chk("64hex citation でも同じ established", o.body.precedence && o.body.precedence.established === true && o.body.resolved_entry === 5);
}
// 3. ?before 後の時刻 -> precedes
{
  const o = await get("/precedence/5?before=2026-10-01T00:00:00Z");
  const c = o.body.precedence.compared_to;
  chk("before 後刻: precedes/provable/margin>0", c && c.result === "precedes" && c.provable === true && c.margin_seconds > 0, JSON.stringify(c));
}
// 4. ?before 前の時刻 -> not_provably_before
{
  const o = await get("/precedence/5?before=2026-01-01T00:00:00Z");
  const c = o.body.precedence.compared_to;
  chk("before 前刻: not_provably_before/provable=false", c && c.result === "not_provably_before" && c.provable === false, JSON.stringify(c));
}
// 5. ?before 壊れた時刻 -> unparseable
{
  const o = await get("/precedence/5?before=nonsense");
  chk("壊れた before: unparseable_time", o.body.precedence.compared_to && o.body.precedence.compared_to.result === "unparseable_time");
}
// 6. markdown
{
  const o = await get("/precedence/5?before=2026-10-01T00:00:00Z", { Accept: "text/markdown" });
  chk("md: 見出しと Established と Against と recompute", /# Precedence receipt/.test(o.body._md) && /## Established/.test(o.body._md) && /Against the claimed time/.test(o.body._md) && /shasum -a 256/.test(o.body._md), (o.body._md || "").slice(0, 120));
}
// 7. 整合性 NG -> established false, 409
{
  const o = await get("/precedence/jidec:entry:6");
  chk("壊れたエントリ: established false / integrity_failure / 409", o.status === 409 && o.body.precedence.established === false && o.body.precedence.status === "integrity_failure", JSON.stringify(o.body).slice(0, 200));
}
// 8. 錨待ち -> established false, anchor_pending
{
  const o = await get("/precedence/jidec:entry:7");
  chk("錨待ち: established false / anchor_pending", o.body.precedence.established === false && o.body.precedence.status === "anchor_pending", JSON.stringify(o.body.precedence).slice(0, 200));
}
// 9. 未解決 citation -> 404
{
  const o = await get("/precedence/jidec:entry:999");
  chk("存在せんエントリ: 404 unresolved", o.status === 404 && o.body.error === "unresolved");
}
// 10. ダッシュ無し
{
  const a = await get("/precedence/5?before=2026-10-01T00:00:00Z");
  const b = await get("/precedence/5?before=2026-10-01T00:00:00Z", { Accept: "text/markdown" });
  chk("JSON と md にダッシュ無し", !DASH.test(JSON.stringify(a.body)) && !DASH.test(b.body._md || ""));
}
console.log(fail ? ("FAIL " + fail) : "ALL PASS");
process.exit(fail ? 1 : 0);
