// ask ルーターの回帰テスト。上流はモックで差し替える。
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const d = mkdtempSync(join(tmpdir(), "webmcp-"));
const f = join(d, "m.mjs");
writeFileSync(f, src);
const mod = await import("file://" + f);
const worker = mod.default;

let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 300))); if (!c) fail++; };

// --- モック上流 ---
const svc = (handler) => ({ fetch: async (req) => handler(req) });
const HS_MCP_SVC = svc(async (req) => {
  const b = await req.json();
  const t = b.params.name, a = b.params.arguments;
  const payload = t === "audit_estimate"
    ? { verdict: "watch", work: a.work, quoted: a.quoted_price, fair_avg: 900000 }
    : { work: a.work, min: 700000, avg: 900000, max: 1150000 };
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(payload) }] } }), { headers: { "content-type": "application/json" } });
});
const LEDGER_SVC = svc(async (req) => {
  const u = new URL(req.url);
  if (u.pathname.startsWith("/cite/")) {
    return new Response(JSON.stringify({ entry: 9, claim_sha256: "2fc5db67", integrity: { match: true } }), { headers: { "content-type": "application/json" } });
  }
  if (u.pathname === "/ledger") return new Response(JSON.stringify({ count: 9, entries: [] }), { headers: { "content-type": "application/json" } });
  return new Response("{}", { headers: { "content-type": "application/json" } });
});
const env = { HS_MCP_SVC, LEDGER_SVC };

const call = async (args) => {
  const r = await worker.fetch(new Request("https://x.dev/mcp", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ask", arguments: args } }),
  }), env, { waitUntil() {} });
  const j = await r.json();
  return j.result && j.result.structuredContent;
};

// --- ツール一覧 ---
let r = await worker.fetch(new Request("https://x.dev/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), env, { waitUntil() {} });
const tl = (await r.json()).result.tools;
chk("ツールが5本 (既存4 + ask)", tl.length === 5, tl.length);
chk("ask が先頭に居る", tl[0].name === "ask", tl[0].name);
chk("既存4ツールが全部残っている", ["orchestrate","intake_estimate","scan_tactics","draft_broadcast"].every(n => tl.some(t => t.name === n)), tl.map(t=>t.name).join(","));
chk("ask に outputSchema がある", !!tl[0].outputSchema);
chk("ask が readOnly", tl[0].annotations.readOnlyHint === true);

// --- 振り分け ---
let o = await call({ ref: "jidec:entry:9" });
chk("ref=jidec:entry:9 -> 台帳", /hs-ledger/.test(o.answered_by), o.answered_by);
chk("  verify が /verify/9", /\/verify\/9$/.test(o.verify), o.verify);
chk("  limits に『だけ』の限定がある", /だけ/.test(o.limits), o.limits);

o = await call({ ref: "9" });
chk("ref=9 (裸の番号) -> 台帳", /hs-ledger/.test(o.answered_by), o.answered_by);

o = await call({ ask: "この受領書は本物ですか" });
chk("『本物』 -> 台帳", /hs-ledger/.test(o.answered_by), o.answered_by);

o = await call({ ask: "外壁塗装80万円は高いですか" });
chk("金額+工種 -> hs-mcp 診断", /hs-mcp/.test(o.answered_by), o.answered_by);
chk("  金額を文中から拾えた", o.result && o.result.quoted === 800000, JSON.stringify(o.result));
chk("  工種を文中から拾えた", o.result && o.result.work === "外壁塗装", JSON.stringify(o.result));
chk("  limits に内訳確認の注意がある", /内訳/.test(o.limits), o.limits);

o = await call({ ask: "屋根の相場を知りたい" });
chk("金額なし -> レンジのみ", /hs-mcp/.test(o.answered_by) && /判定ではない/.test(o.limits), o.limits);

o = await call({ ask: "いくらぐらいが相場ですか" });
chk("工種不明 -> 推測せず聞き返す", o.ok === false && /推測で診断は走らせない/.test(JSON.stringify(o.result)), JSON.stringify(o.result).slice(0,200));

o = await call({ ask: "訪問販売の断り方を教えて" });
chk("手口 -> scan_tactics", /scan_tactics/.test(o.answered_by), o.answered_by);

o = await call({ ask: "この地域の業者はどこに頼めばいい" });
chk("業者探し -> Yakumo 案内", /yakumo/i.test(JSON.stringify(o.result)), JSON.stringify(o.result).slice(0,150));
chk("  紹介料を取らないと明記", /紹介料/.test(JSON.stringify(o.result)));

o = await call({ ask: "こんにちは" });
chk("無関係 -> 404にせず案内", o.ok === true && !!o.result.entries, JSON.stringify(o.result).slice(0,150));

o = await call({});
chk("空入力 -> 使い方を返す", o.ok === false && /ask に一文/.test(JSON.stringify(o.result)));

// --- 不変条件 ---
const all = [];
for (const a of [{ref:"jidec:entry:9"},{ask:"外壁塗装80万は高い"},{ask:"訪問販売"},{ask:"業者"},{ask:"こんにちは"},{}]) all.push(await call(a));
chk("全応答に verify がある", all.every(x => typeof x.verify === "string" && x.verify.length > 0));
chk("全応答に limits がある", all.every(x => typeof x.limits === "string" && x.limits.length > 0));
chk("全応答に answered_by がある", all.every(x => typeof x.answered_by === "string"));

// --- 台帳バインディングが無い環境で壊れないか ---
const noLedger = { HS_MCP_SVC };
r = await worker.fetch(new Request("https://x.dev/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ask", arguments: { ref: "jidec:entry:9" } } }) }), noLedger, { waitUntil() {} });
const nl = (await r.json()).result.structuredContent;
chk("台帳バインディング欠落でも落ちない", !!nl && nl.ok === false, JSON.stringify(nl).slice(0,150));
chk("  『記録が無い証拠ではない』と書く（第二の掟）", /記録が無い.*証拠ではない/.test(nl.limits), nl.limits);

console.log(fail ? `\nask: ${fail} FAILURES` : "\nask: ALL PASS");
process.exit(fail ? 1 : 0);
