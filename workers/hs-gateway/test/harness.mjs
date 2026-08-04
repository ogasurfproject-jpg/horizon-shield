// harness.mjs — 純粋ロジックの検証(registry / router / canonical / receipt / ledger append)。
// チケット残高・冪等・返金・前払式総額は台帳(DO)の責務なので test/do_harness.mjs で検証する。
// ここは KV/DO に依存しない決定的ロジックだけを見る。

import assert from "node:assert";
import { routeVertical } from "../src/router.js";
import { canonicalize, sha256hex, buildReceipt, appendToLedger } from "../src/adapter.js";
import { publicDirectoryList, liveDirectories } from "../src/registry.js";

var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log("  ok  " + name); } else { fail++; console.log("  FAIL " + name); } }

// --- (1) registry ---
console.log("[registry]");
ok("live directory has construction", liveDirectories().some(d => d.id === "construction"));
ok("public list hides internal fields", JSON.stringify(publicDirectoryList()).indexOf("binding_name") === -1);
ok("public list hides base_url too", JSON.stringify(publicDirectoryList()).indexOf("base_url") === -1);

// --- (2) router: 決定的 ---
console.log("[router]");
ok("外壁塗装 -> construction", routeVertical("外壁塗装80万は高いですか").vertical === "construction");
ok("同じ入力は同じ結果(決定性)",
   routeVertical("屋根の見積もり").vertical === routeVertical("屋根の見積もり").vertical);
ok("業種外は no_match", routeVertical("今日の天気は").vertical === null);
ok("空入力は弾く", routeVertical("").vertical === null);

// --- canonical: 決定的ハッシュ ---
console.log("[canonical]");
var a = canonicalize({ b: 1, a: 2, c: [3, { z: 1, y: 2 }] });
var b = canonicalize({ c: [3, { y: 2, z: 1 }], a: 2, b: 1 });
ok("キー順に依存しない canonical", a === b);
ok("同じ内容 -> 同じ SHA-256", (await sha256hex(a)) === (await sha256hex(b)));
ok("SHA-256 は64hex", /^[0-9a-f]{64}$/.test(await sha256hex(a)));

// --- receipt: 決定的で必須項目を持つ ---
console.log("[receipt]");
var fields = {
  request_id: "gw_test", vertical: "construction", verifiable: true, op: "call:construction",
  input: { ask: "外壁塗装", amount: 800000 }, output: { verdict: "ok" },
  tickets_spent: 1, balance_before: 10, balance_after: 9,
  timestamp: "2026-08-04T12:00:00.000Z"
};
var r1 = await buildReceipt(fields);
var r2 = await buildReceipt(fields);
ok("同じ入力 -> 同じ receipt_sha256(決定的)", r1.receipt_sha256 === r2.receipt_sha256);
ok("timestamp が違えば receipt_sha256 も違う",
   (await buildReceipt(Object.assign({}, fields, { timestamp: "2026-08-04T12:00:01.000Z" }))).receipt_sha256 !== r1.receipt_sha256);
ok("receipt に input_sha256", /^[0-9a-f]{64}$/.test(r1.core.input_sha256));
ok("receipt に output_sha256", /^[0-9a-f]{64}$/.test(r1.core.output_sha256));
ok("verifiable=true の limits は結果妥当性に言及", r1.core.limits.indexOf("結果の妥当性") > -1);
var rp = await buildReceipt(Object.assign({}, fields, { verifiable: false, vertical: "realestate" }));
ok("verifiable=false の limits は保証しない旨", rp.core.limits.indexOf("保証しない") > -1);

// --- appendToLedger: トークン未設定なら追記スキップ(番人モード) ---
console.log("[ledger append (no token)]");
var anchorNoTok = await appendToLedger(r1, {});
ok("トークン無しで anchored:false", anchorNoTok.anchored === false);
ok("reason に unset(意図的スキップと判別できる)", String(anchorNoTok.reason).indexOf("unset") > -1);
ok("それでも claim_sha256 は返る", /^[0-9a-f]{64}$/.test(anchorNoTok.claim_sha256));

console.log("\n==== " + pass + " passed, " + fail + " failed ====");
process.exit(fail === 0 ? 0 : 1);
