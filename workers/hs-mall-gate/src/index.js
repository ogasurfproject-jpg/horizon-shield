// hs-mall-gate : 八雲モール 認証ゲート（新規Worker）
//
// 役割: 加盟店の pk_ キーを認証し、八雲が出した寸法データを
//       本体(oga-surf-project)の価格エンジンへ橋渡しするだけ。
//
// 絶対の境界:
//   このWorkerは価格ロジック(souba / WPC / zaisai)を一切持たない。
//   価格は本体(PRICE_ENGINE_URL)が決める。ここは「認証 + 受け渡し」だけ。
//   よってこのコードが流出しても価格は漏れない。八雲だけでは金額は出ない。
//
// secret(TOshi手動投入): ADMIN_TOKEN / PRICE_ENGINE_URL / PRICE_ENGINE_KEY
// KV: HS_PARTNER_KV (key=sha256hex(pk), value=JSON{tier,shop_name,issued_at,status})

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      if (request.method === "GET" && p === "/health") {
        return json({ ok: true, service: "hs-mall-gate" });
      }
      if (request.method === "POST" && p === "/api/quote") {
        return await handleQuote(request, env);
      }
      if (request.method === "POST" && p === "/admin/issue-key") {
        return await handleIssueKey(request, env);
      }
      return json({ error: "not_found" }, 404);
    } catch (e) {
      return json({ error: "internal", detail: String((e && e.message) || e) }, 500);
    }
  }
};

// 認証: Authorization: Bearer pk_xxxx を sha256 して KV 照合
async function authenticate(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(pk_[A-Za-z0-9]+)$/);
  if (!m) return { ok: false, status: 401, error: "missing_or_bad_key" };
  const hash = await sha256hex(m[1]);
  const raw = await env.HS_PARTNER_KV.get(hash);
  if (!raw) return { ok: false, status: 403, error: "key_not_found" };
  const rec = JSON.parse(raw);
  if (rec.status !== "active") return { ok: false, status: 403, error: "key_revoked" };
  return { ok: true, partner: rec };
}

async function handleQuote(request, env) {
  const a = await authenticate(request, env);
  if (!a.ok) return json({ error: a.error }, a.status);

  const body = await request.json().catch(() => null);
  if (!body || !body.dimensions) return json({ error: "missing_dimensions" }, 400);

  // 境界: 寸法 + tier だけ本体へ渡す。価格計算はここでは絶対にしない。
  const res = await fetch(env.PRICE_ENGINE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + env.PRICE_ENGINE_KEY
    },
    body: JSON.stringify({
      tier: a.partner.tier,          // "honbu" | "external"
      dimensions: body.dimensions,   // 八雲が出した寸法
      work: body.work || null        // 任意: 工事種別
    })
  });
  if (!res.ok) return json({ error: "price_engine_error", upstream: res.status }, 502);

  // 本体が返すのは「最終金額 + KIRA検証バッジ」だけ。エンジン本体は越境しない。
  const quote = await res.json();
  return json({
    shop: a.partner.shop_name || null,
    tier: a.partner.tier,
    quote // { amount, range, kira_badge, ... } 本体仕様に依存
  });
}

// pk 発行: ADMIN_TOKEN 必須。生 pk は発行時に一度だけ返す。KV にはハッシュのみ保存。
// 本番では既存 /admin/hc-dashboard に「追加差分」で組み込む想定。これは雛形。
async function handleIssueKey(request, env) {
  const token = request.headers.get("X-Admin-Token") || "";
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }
  const body = await request.json().catch(() => ({}));
  const tier =
    body.tier === "honbu" ? "honbu" :
    body.tier === "external" ? "external" : null;
  if (!tier) return json({ error: "tier_required", allowed: ["honbu", "external"] }, 400);

  const pk = "pk_" + randomToken(32);
  const hash = await sha256hex(pk);
  const rec = {
    tier,
    shop_name: body.shop_name || null,
    issued_at: new Date().toISOString(),
    status: "active"
  };
  await env.HS_PARTNER_KV.put(hash, JSON.stringify(rec));

  // 生 pk はこの応答でしか返らない。以後ハッシュからは復元不可。
  return json({ pk, tier, shop_name: rec.shop_name, note: "save_this_now_pk_is_shown_once" });
}

// helpers
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(len) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  return out;
}
