// tickets.js
// チケット従量の窓口。残高の真実源は TicketLedgerDO(強整合)。ここはその薄いクライアント。
// KV直書き(結果整合・レース)はやめた。金勘定は DO で直列化する。
//
// index.js からは従来と同じ関数名で呼べる(getBalance/canAfford/spend/grantTickets/prepaidStatus)が、
// 中身はすべて DO 経由になり、二重使用・二重課金・ロールバック不能の穴が塞がれている。
//
// env に必要なもの:
//   env.TICKETS_DO = TicketLedgerDO の binding(wrangler.jsonc で宣言)
// 単一インスタンス idFromName("v1") に全店台帳を集約する(hs-webmcp の StatsDO と同じ流儀)。

var YEN_PER_TICKET = 100;          // 1枚=100円(仮値。確定額は事業判断)
var PREPAID_THRESHOLD_YEN = 10000000; // 前払式支払手段の届出義務ライン(1,000万円)

function stub(env) {
  if (!env || !env.TICKETS_DO) return null;
  return env.TICKETS_DO.get(env.TICKETS_DO.idFromName("v1"));
}

async function doCall(env, path, body) {
  var s = stub(env);
  if (!s) return { ok: false, reason: "ticket_do_unavailable" };
  var res = await s.fetch("https://ticket.do" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  try { return await res.json(); } catch (e) { return { ok: false, reason: "do_bad_response" }; }
}

function safeStore(x) {
  return String(x == null ? "" : x).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40);
}

// 価格表(処理種別ごとの消費枚数)。将来 KV や設定に出せるが、まずは既定1枚。
var PRICES = {
  "diagnose": 1,
  "intake": 2,
  "pdf": 5,
  "measure": 5,
  "review": 10,
  "report": 20,
  "audit": 30,
  "lead": 200
};
function serviceOf(op) {
  var o = String(op || "");
  if (o.indexOf(":") >= 0) {
    var svc = o.split(":")[0];
    if (svc === "call") return "diagnose";
    if (PRICES[svc] != null) return svc;
  }
  if (PRICES[o] != null) return o;
  return "diagnose";
}
async function priceOf(op) {
  return PRICES[serviceOf(op)] || 1;
}

var PACKS = [
  { tickets: 30,  yen: 3000,  label: "お試し" },
  { tickets: 100, yen: 9500,  label: "標準" },
  { tickets: 300, yen: 27000, label: "お得" },
  { tickets: 500, yen: 42500, label: "大口" }
];
function packPrice(tickets) {
  var t = Math.floor(Number(tickets) || 0);
  for (var i = 0; i < PACKS.length; i++) { if (PACKS[i].tickets === t) return PACKS[i].yen; }
  return null;
}

async function getBalance(store, env) {
  var r = await doCall(env, "/balance", { store: safeStore(store) });
  return r && r.ok ? Number(r.balance || 0) : 0;
}

// 減算はしない、足りるかだけ見る(ゲート前の事前チェック)。
async function canAfford(store, op, env) {
  var need = await priceOf(op);
  var bal = await getBalance(store, env);
  return { ok: bal >= need, need: need, balance: bal };
}

// 冪等減算。reqId を必ず渡す(同じ取引の二重課金を DO 側で防ぐ)。
async function spend(store, op, env, reqId) {
  var need = await priceOf(op);
  var r = await doCall(env, "/spend", { store: safeStore(store), price: need, req_id: reqId });
  if (!r || r.ok !== true) {
    return { ok: false, reason: (r && r.reason) || "spend_failed", need: r && r.need, balance: r && r.balance };
  }
  return { ok: true, spent: r.spent, balance_before: r.balance_before, balance_after: r.balance_after, dedup: !!r.dedup };
}

// 減算のロールバック(台帳追記失敗時などに金を戻す)。reqId 単位で冪等。
async function refund(store, env, reqId) {
  var r = await doCall(env, "/refund", { store: safeStore(store), req_id: reqId });
  return r || { ok: false, reason: "refund_failed" };
}

// チャージ。**実決済は Stripe 署名検証を通った入口からのみ呼ぶこと。** evtId で冪等。
async function grantTickets(store, tickets, evtId, env) {
  var r = await doCall(env, "/grant", { store: safeStore(store), tickets: tickets, evt_id: evtId });
  return r || { ok: false, reason: "grant_failed" };
}

// 前払式残高モニタリング。総額の真実源は DO(全店 SUM)。
async function prepaidStatus(env) {
  var s = stub(env);
  if (!s) {
    return { total_unused_balance_yen: 0, threshold_yen: PREPAID_THRESHOLD_YEN, ratio: 0, level: "ok",
      base_dates: ["03-31", "09-30"], note: "台帳(DO)未接続。" };
  }
  var res = await s.fetch("https://ticket.do/prepaid?yen=" + YEN_PER_TICKET + "&threshold=" + PREPAID_THRESHOLD_YEN);
  var r = null;
  try { r = await res.json(); } catch (e) { r = null; }
  if (!r || r.ok !== true) {
    return { total_unused_balance_yen: 0, threshold_yen: PREPAID_THRESHOLD_YEN, ratio: 0, level: "ok",
      base_dates: ["03-31", "09-30"], note: "総額の取得に失敗。" };
  }
  var note;
  if (r.level === "over_threshold") note = "基準日に1,000万円超なら資金決済法の届出+供託(残高の半額)義務。専門家に至急確認。";
  else if (r.level === "approaching") note = "閾値の80%に接近。次の基準日(3/31・9/30)を超える前に届出等の手当てを準備すること。";
  else note = "現時点で届出義務ラインには余裕あり。基準日前に再確認する運用を継続。";
  return {
    total_unused_balance_yen: r.total_unused_balance_yen,
    threshold_yen: r.threshold_yen,
    ratio: r.ratio,
    level: r.level,
    base_dates: ["03-31", "09-30"],
    note: note
  };
}

export { getBalance, priceOf, canAfford, spend, refund, grantTickets, prepaidStatus, PRICES, PACKS, packPrice, YEN_PER_TICKET, PREPAID_THRESHOLD_YEN };
