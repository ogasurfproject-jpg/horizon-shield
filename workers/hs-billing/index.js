// hs-billing / index.js -- Stripe webhook -> live WebMCP entitlement (KV).
// 役割: Stripe の決済イベントを署名検証して受け、店の WebMCP オプションをライブに開閉する。
//   git push 不要でゲートが開く(hs-webmcp の verifyStore が /entitlement を見る)。
//   秘密: STRIPE_WEBHOOK_SECRET(署名検証)。KV: BILLING_KV。金額・カード情報は一切保存しない(store_idと状態のみ)。
//   fail-closed: 署名不正は400、KV不在や不明は active:false。
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Stripe-Signature",
  "Access-Control-Max-Age": "86400",
};
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors, ...extra } });

function safeStore(s) { return String(s == null ? "" : s).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40); }

async function hmacHex(secret, payload) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
// Stripe-Signature: "t=<unix>,v1=<hex>[,v1=<hex>...]"。signedPayload = "t.rawBody"。
async function verifyStripeSig(rawBody, sigHeader, secret, toleranceSec) {
  if (!sigHeader || !secret) return false;
  let t = null; const v1s = [];
  for (const part of String(sigHeader).split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === "t") t = v; else if (k === "v1") v1s.push(v);
  }
  if (!t || !v1s.length) return false;
  if (toleranceSec) {
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(Number(t)) || Math.abs(now - Number(t)) > toleranceSec) return false;
  }
  const expected = await hmacHex(secret, t + "." + rawBody);
  return v1s.some((v) => timingSafeEqualHex(v, expected));
}

async function handleEvent(evt, env) {
  try {
    if (!env.BILLING_KV || !evt) return;
    const type = evt.type;
    const obj = (evt.data && evt.data.object) || {};
    if (type === "checkout.session.completed") {
      // 決済成立: client_reference_id(推奨) か metadata.store_id で店を特定して有効化。
      const store = safeStore(obj.client_reference_id || (obj.metadata && obj.metadata.store_id) || "");
      const sub = String(obj.subscription || "").slice(0, 80);
      if (store) {
        await env.BILLING_KV.put("ent:" + store, "active");
        if (sub) await env.BILLING_KV.put("sub:" + sub, store); // 解約時に sub -> store を引くため
      }
    } else if (type === "customer.subscription.deleted" ||
      (type === "customer.subscription.updated" && ["canceled", "unpaid", "incomplete_expired", "past_due"].includes(obj.status))) {
      // 解約・失効: 対応する店を無効化。
      const sub = String(obj.id || "").slice(0, 80);
      const store = sub ? await env.BILLING_KV.get("sub:" + sub) : null;
      if (store) await env.BILLING_KV.put("ent:" + safeStore(store), "inactive");
    }
  } catch (e) { /* fail-open on processing; signature already verified */ }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (url.pathname === "/health") return json({ ok: true, service: "hs-billing", kv: !!env.BILLING_KV });

    // hs-webmcp のゲートが叩く: 店が課金でライブ有効化されているか(active のみ true、それ以外は false=fail-closed)。
    if (url.pathname === "/entitlement" && request.method === "GET") {
      const store = safeStore(url.searchParams.get("store"));
      if (!store || !env.BILLING_KV) return json({ active: false }, 200, { "Cache-Control": "public, max-age=30" });
      const v = await env.BILLING_KV.get("ent:" + store);
      return json({ store, active: v === "active" }, 200, { "Cache-Control": "public, max-age=30" });
    }

    // Stripe webhook 受け口。署名検証してから非同期で処理し、即 200 を返す。
    if (url.pathname === "/stripe/webhook" && request.method === "POST") {
      const raw = await request.text();
      const sig = request.headers.get("Stripe-Signature");
      const ok = await verifyStripeSig(raw, sig, env.STRIPE_WEBHOOK_SECRET, 300);
      if (!ok) return new Response("invalid signature", { status: 400, headers: cors });
      let evt;
      try { evt = JSON.parse(raw); } catch (e) { return new Response("invalid json", { status: 400, headers: cors }); }
      ctx.waitUntil(handleEvent(evt, env));
      return json({ received: true });
    }

    return new Response("not found", { status: 404, headers: cors });
  },
};
