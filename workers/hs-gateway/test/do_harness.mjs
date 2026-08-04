// do_harness.mjs — TicketLedgerDO の4つの穴塞ぎを実際に走らせて検証する。
// Cloudflare の state.storage.sql をインメモリで模す最小スタブ。
// 対象テーブルは bal(store,tickets) と seen(kind,ref,store,delta,at) の2つだけなので、
// この2表に必要な SQL 形だけ解釈する専用スタブで足りる(汎用SQLエンジンは要らない)。

import assert from "node:assert";
import { TicketLedgerDO } from "../src/ticket_do.js";

// --- 最小 SQLite スタブ ---
function makeSqlStub() {
  var bal = new Map();          // store -> tickets
  var seen = new Map();         // kind|ref -> { kind, ref, store, delta, at }
  return {
    exec(q, ...args) {
      var s = q.replace(/\s+/g, " ").trim();

      if (s.startsWith("CREATE TABLE")) return { toArray() { return []; } };

      // balance 読み取り
      if (s.startsWith("SELECT tickets FROM bal WHERE store = ?")) {
        var st = args[0];
        return { toArray() { return bal.has(st) ? [{ tickets: bal.get(st) }] : []; } };
      }
      // balance upsert
      if (s.startsWith("INSERT INTO bal")) {
        var store = args[0], n = args[1];
        bal.set(store, n);
        return { toArray() { return []; } };
      }
      // seen 読み取り
      if (s.startsWith("SELECT store, delta, at FROM seen WHERE kind = ? AND ref = ?")) {
        var kind = args[0], ref = args[1];
        var key = kind + "|" + ref;
        return { toArray() { return seen.has(key) ? [seen.get(key)] : []; } };
      }
      // seen 追記(INSERT OR IGNORE)
      if (s.startsWith("INSERT OR IGNORE INTO seen")) {
        var k = args[0], r = args[1], st2 = args[2], delta = args[3], at = args[4];
        var kk = k + "|" + r;
        if (!seen.has(kk)) seen.set(kk, { kind: k, ref: r, store: st2, delta: delta, at: at });
        return { toArray() { return []; } };
      }
      // 総額
      if (s.indexOf("SUM(tickets)") > -1) {
        var sum = 0;
        for (var v of bal.values()) sum += Number(v);
        return { toArray() { return [{ s: sum }]; } };
      }
      throw new Error("stub: unhandled SQL: " + s);
    }
  };
}

function makeDO() {
  var state = { storage: { sql: makeSqlStub() } };
  return new TicketLedgerDO(state, {});
}

// DO を叩くヘルパ(Request を正しく生成。実DOでは request.url は常に入る)
async function call(doInst, path, body) {
  var req = new Request("https://ticket.do" + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {})
  });
  var res = await doInst.fetch(req);
  return res.json();
}

var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log("  ok  " + name); } else { fail++; console.log("  FAIL " + name); } }

console.log("[DO: grant/balance]");
var d = makeDO();
ok("初期残高0", (await call(d, "/balance", { store: "s1" })).balance === 0);
var g = await call(d, "/grant", { store: "s1", tickets: 5, evt_id: "e1" });
ok("5枚チャージで balance=5", g.ok && g.balance_after === 5);
var gDup = await call(d, "/grant", { store: "s1", tickets: 5, evt_id: "e1" });
ok("同じ evt_id は冪等(二重加算しない)", gDup.dedup === true && (await call(d, "/balance", { store: "s1" })).balance === 5);

console.log("[DO: spend 冪等・アトミック]");
var sp = await call(d, "/spend", { store: "s1", price: 1, req_id: "r1" });
ok("1枚消費で 5->4", sp.ok && sp.balance_before === 5 && sp.balance_after === 4);
var spDup = await call(d, "/spend", { store: "s1", price: 1, req_id: "r1" });
ok("同じ req_id は二重に引かない(冪等)", spDup.dedup === true && (await call(d, "/balance", { store: "s1" })).balance === 4);
// 穴(1)(2)の核心: 同じ reqId を10連打しても1枚しか減らない
for (var i = 0; i < 10; i++) await call(d, "/spend", { store: "s1", price: 1, req_id: "r1" });
ok("同じ req_id を10連打しても残高は4のまま(二重使用なし)", (await call(d, "/balance", { store: "s1" })).balance === 4);

console.log("[DO: 残高不足はアトミックに拒否]");
var d2 = makeDO();
await call(d2, "/grant", { store: "x", tickets: 1, evt_id: "g" });
var s1 = await call(d2, "/spend", { store: "x", price: 1, req_id: "a" }); // 1->0
var s2 = await call(d2, "/spend", { store: "x", price: 1, req_id: "b" }); // 0 で不足
ok("残高0での減算は insufficient_balance", s1.ok === true && s2.ok === false && s2.reason === "insufficient_balance");

console.log("[DO: refund ロールバック]");
var d3 = makeDO();
await call(d3, "/grant", { store: "y", tickets: 3, evt_id: "gy" });
await call(d3, "/spend", { store: "y", price: 2, req_id: "rr" }); // 3->1
var rf = await call(d3, "/refund", { store: "y", req_id: "rr" });   // 戻して 1->3
ok("返金で 2枚戻る(1->3)", rf.ok && rf.balance_after === 3);
var rfDup = await call(d3, "/refund", { store: "y", req_id: "rr" });
ok("同じ req_id の二重返金は冪等", rfDup.dedup === true && (await call(d3, "/balance", { store: "y" })).balance === 3);
var rfNone = await call(d3, "/refund", { store: "y", req_id: "never" });
ok("引いてない req_id は返金できない", rfNone.ok === false && rfNone.reason === "no_such_spend");

console.log("[DO: 前払式総額モニタリング]");
var d4 = makeDO();
await call(d4, "/grant", { store: "a", tickets: 50000, evt_id: "ga" }); // 50000枚 * 100円 = 500万
await call(d4, "/grant", { store: "b", tickets: 40000, evt_id: "gb" }); // 40000枚 * 100円 = 400万
var pRes = await d4.fetch(new Request("https://ticket.do/prepaid?yen=100&threshold=10000000"));
var p = await pRes.json();
ok("総額 = 900万円(全店SUM)", p.total_unused_balance_yen === 9000000);
ok("900万は approaching(閾値の80%=800万超)", p.level === "approaching");
await call(d4, "/grant", { store: "c", tickets: 20000, evt_id: "gc" }); // +200万 = 1100万
var p2 = await (await d4.fetch(new Request("https://ticket.do/prepaid?yen=100&threshold=10000000"))).json();
ok("1100万で over_threshold", p2.total_unused_balance_yen === 11000000 && p2.level === "over_threshold");

console.log("\n==== " + pass + " passed, " + fail + " failed ====");
process.exit(fail === 0 ? 0 : 1);
