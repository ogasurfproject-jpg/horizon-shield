// index.js  (hs-gateway)
// 検証可能ゲートウェイの本体。設計図 v0.3 の"真の新規3点"をここで束ねる:
//   (1) 業種を差し込める一般化   -> registry.js (業種はデータ。足すのは1エントリ)
//   (2) 業種横断の上位ルーティング -> router.js  (決定的に業種を選ぶ)
//   (3) チケット従量の器          -> tickets.js (残高・減算・前払式モニタリング。実決済は未接続)
// 検証の核 -> adapter.js (binding/http どちらで呼んでも hs-ledger に v0 レシートを刻む)
//
// === 独立性の厳守(設計図第6章) ===
//  - hs-mcp(Anthropic審査中・凍結)を import も binding も依存もしない。ここには一切出てこない。
//  - 建設(hs-webmcp)は registry の binding 越しにのみ呼ぶ。hs-webmcp の内部実装には触れない。
//  - 本 worker は新規・独立。既存本番の挙動を1ミリも変えない。deploy は TOshi の手。
//
// === 認証ゲート ===
//  hs-webmcp の verifyStore の考え方を踏襲しつつ Gateway 用に簡素化:
//   1. store 未指定 -> 公開の read(業種一覧・エージェントカード)は許可。tools/call は拒否。
//   2. tools/call は「チケット残高で足りるか」をゲートにする(従量)。
//      将来サブスク在否を併用するなら hs-billing /entitlement を足す(今は繋がない)。

import { publicDirectoryList, getDirectory } from "./registry.js";
import { routeVertical } from "./router.js";
import { callDirectory, buildReceipt, appendToLedger } from "./adapter.js";
import { canAfford, spend, refund, grantTickets, prepaidStatus, getBalance, PRICES, PACKS, packPrice, YEN_PER_TICKET } from "./tickets.js";
import { TicketLedgerDO } from "./ticket_do.js";

var SERVER = { name: "hs-gateway", title: "HORIZON SHIELD Verifiable Gateway", version: "0.1.0-draft" };
var SITE = "https://shield.the-horizons-innovation.com";
var SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
var DEFAULT_VERSION = "2025-06-18";
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version"
};

var TOOLS = [
  {
    name: "gateway_ask",
    title: "業種を判定して、正しい専門ディレクトリへ検証つきで取り次ぐ",
    description: "一文を渡すと、まず業種(建設ほか)を決定的に判定し、その業種の専門ディレクトリへ取り次ぐ。通った取引は入力・結果・消費を hs-ledger(Bitcoinアンカー台帳)に刻み、後から第三者が再計算で検証できる。速さや安さではなく『検証可能であること』が唯一の差別化。",
    inputSchema: {
      type: "object",
      properties: {
        ask: { type: "string", description: "やりたいことを一文で。例:「外壁塗装80万は高いですか」" },
        work: { type: "string", description: "(任意)工事名など。業種内の判定精度が上がる。" },
        amount: { type: "number", description: "(任意)金額(円)", minimum: 0 }
      },
      required: ["ask"]
    },
    annotations: { title: "業種判定して検証つきで取り次ぐ", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }
];

function rpc(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id, result: result }), { headers: { "Content-Type": "application/json", ...CORS } });
}
function rpcErr(id, code, message) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id, error: { code: code, message: message } }), { headers: { "Content-Type": "application/json", ...CORS } });
}

function requestId() {
  return "gw_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

// --- Stripe 署名検証(hs-billing と同一方式: HMAC-SHA256 over t + "." + rawBody) ---
// チャージ入口のゲート。署名・時刻許容・v1一致を満たさなければ加算させない。
async function hmacHex(secret, payload) {
  var key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  var sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  var out = 0;
  for (var i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
async function verifyStripeSig(rawBody, sigHeader, secret, toleranceSec) {
  if (!sigHeader || !secret) return false;
  var t = null; var v1s = [];
  var parts = String(sigHeader).split(",");
  for (var i = 0; i < parts.length; i++) {
    var idx = parts[i].indexOf("=");
    if (idx < 0) continue;
    var k = parts[i].slice(0, idx).trim(), v = parts[i].slice(idx + 1).trim();
    if (k === "t") t = v; else if (k === "v1") v1s.push(v);
  }
  if (!t || !v1s.length) return false;
  if (toleranceSec) {
    var now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(Number(t)) || Math.abs(now - Number(t)) > toleranceSec) return false;
  }
  var expected = await hmacHex(secret, t + "." + rawBody);
  return v1s.some(function (v) { return timingSafeEqualHex(v, expected); });
}

// gateway_ask の実処理。(2)ルーティング -> (3)課金ゲート -> adapter呼び出し -> (検証)レシート。
async function storeToken(env, storeId) {
  return await hmacHex(env.GATEWAY_STORE_SALT, "hs-gateway-store:" + storeId);
}
async function verifyStoreToken(env, storeId, provided) {
  if (!env || !env.GATEWAY_STORE_SALT) return true;
  if (!storeId || !provided) return false;
  return timingSafeEqualHex(String(provided), await storeToken(env, storeId));
}

var PAYPAL_API_DEFAULT = "https://api-m.sandbox.paypal.com";
function paypalBase(env) {
  return env && env.PAYPAL_API_BASE ? env.PAYPAL_API_BASE : PAYPAL_API_DEFAULT;
}
async function paypalAccessToken(env) {
  var creds = btoa(env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_CLIENT_SECRET);
  var res = await fetch(paypalBase(env) + "/v1/oauth2/token", {
    method: "POST",
    headers: { "Authorization": "Basic " + creds, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  if (!res.ok) return null;
  var j = await res.json().catch(function () { return null; });
  return j && j.access_token ? j.access_token : null;
}
async function paypalVerifyWebhook(env, hdrs, eventObj) {
  var token = await paypalAccessToken(env);
  if (!token) return { ok: false, reason: "oauth_failed" };
  var body = {
    auth_algo: hdrs.get("paypal-auth-algo"),
    cert_url: hdrs.get("paypal-cert-url"),
    transmission_id: hdrs.get("paypal-transmission-id"),
    transmission_sig: hdrs.get("paypal-transmission-sig"),
    transmission_time: hdrs.get("paypal-transmission-time"),
    webhook_id: env.PAYPAL_WEBHOOK_ID,
    webhook_event: eventObj
  };
  var res = await fetch(paypalBase(env) + "/v1/notifications/verify-webhook-signature", {
    method: "POST",
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) return { ok: false, reason: "verify_http_" + res.status };
  var j = await res.json().catch(function () { return null; });
  return { ok: j && j.verification_status === "SUCCESS", status: j && j.verification_status };
}

async function handleGatewayAsk(args, storeId, env) {
  var ask = String(args && args.ask || "").trim();
  if (!ask) return { ok: false, message: "ask に一文を入れてください。" };

  // (2) 業種を決定的に判定
  var route = routeVertical(ask);
  if (route.vertical == null) {
    if (route.reason === "ambiguous") {
      return { ok: false, reason: "ambiguous_vertical", candidates: route.candidates,
        message: "複数の業種にまたがっています。どの業種か一言足して呼び直してください。当てずっぽうで業種は決めません。" };
    }
    return { ok: false, reason: "no_vertical", available: publicDirectoryList(),
      message: "対応業種を判定できませんでした。現在の対応業種は available の通りです。" };
  }
  var dir = getDirectory(route.vertical);
  if (!dir) return { ok: false, message: "業種定義が見つかりません: " + route.vertical };

  var rid = requestId();
  var op = "call:" + dir.id;

  // (3) 課金ゲート(従量)。store 指定があり、かつチケット制を有効にしている場合のみ課金。
  //     store 未指定でも公開ディレクトリの read は将来的に許容しうるが、tools/call は課金前提で組む。
  var billingEnabled = !!(env && env.TICKETS_KV);
  var charge = null;
  if (billingEnabled && storeId) {
    var afford = await canAfford(storeId, op, env);
    if (!afford.ok) {
      return { ok: false, reason: "insufficient_tickets", need: afford.need, balance: afford.balance,
        message: "チケット残高が不足しています。チャージ後に再度お試しください。" };
    }
  }

  // 業種ディレクトリを呼ぶ(binding/http はアダプタが吸収)。
  var mcpBody = {
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: dir.default_tool, arguments: { ask: ask, work: args && args.work, amount: args && args.amount } }
  };
  var upstream = await callDirectory(dir, mcpBody, env);

  // 呼び出し失敗なら課金しない(fail-closed)。提携先落下でユーザーのチケットを溶かさない。
  if (!upstream.ok) {
    return { ok: false, reason: "directory_unavailable", vertical: dir.id, detail: upstream.error || upstream.status,
      message: "専門ディレクトリが一時的に応答しません。チケットは消費していません。" };
  }

  // 上流の結果を取り出す(MCP形式: result.structuredContent か content[0].text)。
  var result = null;
  var uj = upstream.json;
  if (uj && uj.result && uj.result.structuredContent) result = uj.result.structuredContent;
  else if (uj && uj.result && uj.result.content && uj.result.content[0] && uj.result.content[0].text) {
    try { result = JSON.parse(uj.result.content[0].text); } catch (e) { result = { raw: uj.result.content[0].text }; }
  } else result = uj || { note: "upstream returned no structured result" };

  // (3) 減算。成功見込みが立ってから引く。reqId で冪等(同じ取引の二重課金を DO が防ぐ)。
  var balBefore = storeId ? await getBalance(storeId, env) : 0;
  if (billingEnabled && storeId) {
    var sp = await spend(storeId, op, env, rid);
    if (!sp.ok) {
      // ここに来るのは競合等のレア。結果は返すが課金失敗を明示。
      charge = { charged: false, reason: sp.reason };
    } else {
      charge = { charged: true, spent: sp.spent, balance_before: sp.balance_before, balance_after: sp.balance_after, dedup: sp.dedup };
    }
  }

  var balAfter = storeId ? await getBalance(storeId, env) : 0;

  // (検証) レシートを組み、hs-ledger に v0 で刻む。誰が処理したかに関わらず刻む。
  var receipt = await buildReceipt({
    request_id: rid,
    vertical: dir.id,
    verifiable: dir.verifiable,
    op: op,
    timestamp: new Date().toISOString(), // ここで1回だけ生成。以後この録の一部として固定される。
    input: { ask: ask, work: args && args.work || null, amount: (args && args.amount) || null },
    output: result,
    tickets_spent: charge && charge.charged ? charge.spent : 0,
    balance_before: balBefore,
    balance_after: balAfter
  });
  var anchor = await appendToLedger(receipt, env);

  // (4) ロールバック: 課金したのに台帳追記が失敗したら、金だけ引かれた状態を解消する。
  //     トークン未投入(anchored:false, reason に "unset")は"意図的スキップ"なので返金しない。
  //     追記を試みて失敗した場合(ledger_append_failed / ledger_unreachable)のみ返金する。
  if (billingEnabled && storeId && charge && charge.charged && anchor.anchored === false) {
    var reason = String(anchor.reason || "");
    var intentionalSkip = reason.indexOf("unset") > -1;
    if (!intentionalSkip) {
      var rb = await refund(storeId, env, rid);
      charge.charged = false;
      charge.refunded = rb && rb.ok === true;
      charge.reason = "ledger_append_failed_refunded";
      balAfter = storeId ? await getBalance(storeId, env) : balAfter;
    }
  }

  return {
    ok: true,
    vertical: dir.id,
    verifiable: dir.verifiable,
    routed_by: "deterministic keyword table (no LLM)",
    matched: route.matched || [],
    result: result,
    charge: charge,
    receipt: {
      request_id: rid,
      receipt_sha256: receipt.receipt_sha256,
      claim_sha256: anchor.claim_sha256,
      anchored: anchor.anchored,
      entry: anchor.entry || null,
      ledger_url: anchor.url || null,
      note: anchor.anchored
        ? "この取引の入力・結果・消費は台帳に刻まれた。第三者が再計算で検証できる。"
        : "レシートは生成済み。台帳追記は未実行(" + (anchor.reason || "") + ")。"
    },
    limits: receipt.core.limits
  };
}

async function runTool(name, args, storeId, env) {
  if (name === "gateway_ask") return handleGatewayAsk(args || {}, storeId, env);
  return null;
}

export default {
  async fetch(request, env, ctx) {
    var url = new URL(request.url);
    var path = url.pathname;
    var method = request.method;
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (method === "GET") {
      // 公開 read: サービス記述子。業種一覧と前払式残高の健全性(値は総額のみ、店別は出さない)。
      if (path === "/pricing") {
        var plist = {};
        for (var k in PRICES) { plist[k] = { tickets: PRICES[k], yen: PRICES[k] * YEN_PER_TICKET }; }
        var packlist = PACKS.map(function (pk) { var per = pk.yen / pk.tickets; return { tickets: pk.tickets, yen: pk.yen, per_ticket_yen: per, discount_pct: Math.round((1 - per / YEN_PER_TICKET) * 100), label: pk.label }; });
        return new Response(JSON.stringify({ ok: true, yen_per_ticket: YEN_PER_TICKET, packs: packlist, services: plist, note: "servicesは1処理あたりの消費枚数。packsは購入単位(まとめ買いほど割安)。" }, null, 2), { headers: { "Content-Type": "application/json", ...CORS } });
      }
      if (path === "/" || path === "/health") {
        var prepaid = await prepaidStatus(env);
        return new Response(JSON.stringify({
          name: SERVER.name, title: SERVER.title, version: SERVER.version,
          role: "検証可能な業種横断ゲートウェイ(設計ドラフト)。通る取引はすべて hs-ledger で再計算可能。",
          verticals: publicDirectoryList(),
          mcp_endpoint: url.origin + "/mcp",
          transport: "streamable-http (POST /mcp)",
          prepaid_monitor: { level: prepaid.level, note: prepaid.note }, // 総額の水準だけ。金額詳細は /admin。
          independence: "hs-mcp(審査中)に非依存。建設は hs-webmcp を binding 越しに呼ぶ。",
          site: SITE
        }, null, 2), { headers: { "Content-Type": "application/json", ...CORS } });
      }
      // 運営用の前払式残高詳細(要 ADMIN_KEY)。基準日前の手当て判断に使う。
      if (path === "/admin/prepaid") {
        var key = url.searchParams.get("key") || "";
        if (!env || !env.ADMIN_KEY || key !== env.ADMIN_KEY) {
          return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json", ...CORS } });
        }
        return new Response(JSON.stringify(await prepaidStatus(env), null, 2), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
      }
      if (path === "/admin/token") {
        var _tk = url.searchParams.get("key") || "";
        if (!env || !env.ADMIN_KEY || _tk !== env.ADMIN_KEY) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json", ...CORS } });
        var _ts = url.searchParams.get("store") || "";
        if (!_ts) return new Response(JSON.stringify({ error: "need store" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
        if (!env.GATEWAY_STORE_SALT) return new Response(JSON.stringify({ error: "GATEWAY_STORE_SALT unset" }), { status: 501, headers: { "Content-Type": "application/json", ...CORS } });
        var _tok = await storeToken(env, _ts);
        return new Response(JSON.stringify({ store: _ts, token: _tok, usage: "?store=" + _ts + "&t=" + _tok }, null, 2), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
      }
      if (path === "/admin/grant") {
        var gkey = url.searchParams.get("key") || "";
        if (!env || !env.ADMIN_KEY || gkey !== env.ADMIN_KEY) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json", ...CORS } });
        var gStore = url.searchParams.get("store") || "";
        var gTickets = Math.floor(Number(url.searchParams.get("tickets")) || 0);
        if (!gStore || gTickets <= 0) return new Response(JSON.stringify({ error: "need store and tickets>0" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
        var gEvt = "admin:" + Date.now().toString(36) + ":" + Math.random().toString(36).slice(2, 8);
        var gRes = await grantTickets(gStore, gTickets, gEvt, env);
        return new Response(JSON.stringify(gRes, null, 2), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
      }
      if (path === "/mcp") return new Response("Method Not Allowed. Use POST for JSON-RPC.", { status: 405, headers: { Allow: "POST, OPTIONS", ...CORS } });
      return new Response("not found", { status: 404, headers: CORS });
    }

    if (method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });

    // --- チャージ入口(器): Stripe 署名検証を通った時だけチケットを加算する ---
    // 実 Stripe はまだ繋がない。だが「署名・時刻・冪等の3検証を通らないと grant しない」形を
    // コードで確定させておく。これが穴(3)の塞ぎ。secret 未投入なら 501 で無効(誤発火しない)。
    // hs-billing と同じ HMAC-SHA256(t + "." + rawBody) 方式で揃える。
    if (path === "/billing/create" && env && env.PAYPAL_CLIENT_ID) {
      var cbody = await request.json().catch(function () { return null; });
      var cstore = String(cbody && cbody.store || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40);
      var ctickets = Math.floor(Number(cbody && cbody.tickets) || 0);
      var cyen = packPrice(ctickets);
      if (!cstore || cyen == null) {
        return new Response(JSON.stringify({ ok: false, error: "not_a_valid_pack", valid_packs: PACKS }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
      }
      var ctok = await paypalAccessToken(env);
      if (!ctok) return new Response(JSON.stringify({ ok: false, error: "oauth_failed" }), { status: 502, headers: { "Content-Type": "application/json", ...CORS } });
      var cres = await fetch(paypalBase(env) + "/v2/checkout/orders", {
        method: "POST",
        headers: { "Authorization": "Bearer " + ctok, "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ custom_id: cstore + ":" + ctickets, amount: { currency_code: "JPY", value: String(cyen) } }], payment_source: { paypal: { experience_context: { return_url: "https://example.com/ok", cancel_url: "https://example.com/cancel" } } } })
      });
      var cj = await cres.json().catch(function () { return null; });
      if (!cres.ok || !cj || !cj.id) return new Response(JSON.stringify({ ok: false, error: "order_create_failed" }), { status: 502, headers: { "Content-Type": "application/json", ...CORS } });
      var capprove = "";
      for (var i = 0; cj.links && i < cj.links.length; i++) { if (cj.links[i].rel === "payer-action" || cj.links[i].rel === "approve") { capprove = cj.links[i].href; break; } }
      return new Response(JSON.stringify({ ok: true, order_id: cj.id, approve_url: capprove, store: cstore, tickets: ctickets, yen: cyen }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
    }
    if (path === "/billing/capture" && env && env.PAYPAL_CLIENT_ID) {
      var pbody = await request.json().catch(function () { return null; });
      var poid = String(pbody && pbody.order_id || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
      if (!poid) return new Response(JSON.stringify({ ok: false, error: "need_order_id" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
      var ptok = await paypalAccessToken(env);
      if (!ptok) return new Response(JSON.stringify({ ok: false, error: "oauth_failed" }), { status: 502, headers: { "Content-Type": "application/json", ...CORS } });
      var pcres = await fetch(paypalBase(env) + "/v2/checkout/orders/" + poid + "/capture", {
        method: "POST",
        headers: { "Authorization": "Bearer " + ptok, "Content-Type": "application/json" },
        body: "{}"
      });
      var pcj = await pcres.json().catch(function () { return null; });
      var pstatus = pcj && pcj.status || null;
      return new Response(JSON.stringify({ ok: pstatus === "COMPLETED", status: pstatus }), { status: pcres.ok ? 200 : 502, headers: { "Content-Type": "application/json", ...CORS } });
    }
    if (path === "/billing/webhook" && env && env.PAYPAL_WEBHOOK_ID) {
      if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
        return new Response(JSON.stringify({ error: "paypal_not_configured" }), { status: 501, headers: { "Content-Type": "application/json", ...CORS } });
      }
      var praw = await request.text();
      var pevt;
      try { pevt = JSON.parse(praw); } catch (e) { return new Response("invalid json", { status: 400, headers: CORS }); }
      var pver = await paypalVerifyWebhook(env, request.headers, pevt);
      if (!pver.ok) return new Response(JSON.stringify({ error: "invalid_signature", detail: pver.reason || pver.status || null }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
      if (pevt && pevt.event_type === "PAYMENT.CAPTURE.COMPLETED") {
        var pres = pevt.resource || {};
        var pparts = String(pres.custom_id || "").split(":");
        var pstore = String(pparts[0] || "").slice(0, 40);
        var ptickets = Math.floor(Number(pparts[1]) || 0);
        var pevtId = String(pevt.id || "").slice(0, 80);
        if (pstore && ptickets > 0) ctx.waitUntil(grantTickets(pstore, ptickets, pevtId, env));
      }
      return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json", ...CORS } });
    }
    if (path === "/billing/webhook") {
      if (!env || !env.STRIPE_WEBHOOK_SECRET) {
        return new Response(JSON.stringify({ error: "billing_not_configured" }), { status: 501, headers: { "Content-Type": "application/json", ...CORS } });
      }
      var raw = await request.text();
      var sigHeader = request.headers.get("Stripe-Signature");
      var okSig = await verifyStripeSig(raw, sigHeader, env.STRIPE_WEBHOOK_SECRET, 300);
      if (!okSig) return new Response("invalid signature", { status: 400, headers: CORS });
      var evt;
      try { evt = JSON.parse(raw); } catch (e) { return new Response("invalid json", { status: 400, headers: CORS }); }
      // livemode のみ。テストイベントで本番残高を動かさない。
      if (evt && evt.livemode !== true) return new Response(JSON.stringify({ received: true, ignored: "not_livemode" }), { headers: { "Content-Type": "application/json", ...CORS } });
      var type = evt && evt.type;
      var obj = (evt && evt.data && evt.data.object) || {};
      // 支払い完了イベントでのみチケット加算。store と枚数はメタデータから取る。
      if (type === "checkout.session.completed" && obj.payment_status === "paid") {
        var store = String(obj.client_reference_id || (obj.metadata && obj.metadata.store_id) || "").slice(0, 40);
        var tickets = Math.floor(Number(obj.metadata && obj.metadata.tickets) || 0);
        var evtId = String(evt.id || "").slice(0, 80);
        if (store && tickets > 0) {
          ctx.waitUntil(grantTickets(store, tickets, evtId, env)); // evtId で冪等
        }
      }
      return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json", ...CORS } });
    }

    var pv = request.headers.get("MCP-Protocol-Version");
    if (pv && !SUPPORTED_VERSIONS.includes(pv)) return new Response("Unsupported MCP-Protocol-Version: " + pv, { status: 400, headers: CORS });

    var msg;
    try { msg = await request.json(); } catch (e) { return rpcErr(null, -32700, "Parse error"); }

    var hasId = msg && Object.prototype.hasOwnProperty.call(msg, "id") && msg.id != null;
    var isResponse = msg && (("result" in msg) || ("error" in msg)) && !msg.method;
    var isNotification = msg && msg.method && !hasId;
    if (isResponse || isNotification) return new Response(null, { status: 202, headers: CORS });

    var id = msg && msg.id;
    var rpcMethod = msg && msg.method;
    var params = msg && msg.params;

    if (rpcMethod === "initialize") {
      var req = params && params.protocolVersion;
      var negotiated = SUPPORTED_VERSIONS.includes(req) ? req : DEFAULT_VERSION;
      return rpc(id, {
        protocolVersion: negotiated,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: "業種を判定して専門ディレクトリへ検証つきで取り次ぐゲートウェイ。通る取引は台帳に刻まれ再計算で検証できる。"
      });
    }
    if (rpcMethod === "ping") return rpc(id, {});
    if (rpcMethod === "tools/list") return rpc(id, { tools: TOOLS });
    if (rpcMethod === "tools/call") {
      var storeId = url.searchParams.get("store");
      if (storeId && env && env.TICKETS_KV) {
        var _stok = url.searchParams.get("t") || request.headers.get("x-store-token") || "";
        if (!(await verifyStoreToken(env, storeId, _stok))) {
          var _deny = { ok: false, reason: "invalid_store_token", message: "店のトークンが不正です。" };
          return rpc(id, { content: [{ type: "text", text: JSON.stringify(_deny) }], structuredContent: _deny });
        }
      }
      var name = params && params.name;
      var out = await runTool(name, params && params.arguments || {}, storeId, env);
      if (out === null) return rpcErr(id, -32602, "Unknown tool: " + name);
      return rpc(id, { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out });
    }
    return rpcErr(id, -32601, "Method not found: " + rpcMethod);
  }
};

export { TicketLedgerDO };
