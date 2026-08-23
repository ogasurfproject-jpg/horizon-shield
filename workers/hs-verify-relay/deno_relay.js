// hs-verify-relay (Deno Deploy version) / 2026-08-21
//
// なぜ Cloudflare の外に置くか:
//   扉(hs-verify-gate, zone horizonshield.dev)は、HTTP で呼ばれると自ゾーンへの
//   subrequest が 522 になる(2026-08-14/15 実測)。だから自分自身を測れない。
//   中継を Cloudflare 上のどこに置いても、同一ゾーン(522)か同一アカウント workers.dev
//   (ループ)で詰む。relay.the-horizons-innovation.com は GMO(dnsv.jp)にあり Cloudflare の
//   ゾーンではないので custom_domain も作れない。
//   よって中継は Cloudflare の外、公開エッジ上のホスト(Deno Deploy)に置く。扉→中継も
//   中継→horizonshield.dev も、真のクロスプロバイダの公開エッジになる。
//   これは扉の設計思想(私道=service binding を使わず、公開エッジで測る)とも一致する。
//
// これは開放プロキシではない:
//   1. x-relay-token の一致(定数時間比較)が無ければ 403
//   2. 取得先は horizonshield.dev ゾーンの https のみ。他は一切取得しない
//   3. メソッドは GET / POST のみ、応答本文は 256KB で打ち切り
//
// 秘密は RELAY_TOKEN のみ(Deno Deploy の環境変数に設定)。扉側にも同じ値を入れる。
// 状態は持たない(KVもDBも無い)。

const ALLOWED_ZONE = "horizonshield.dev";
const TIMEOUT_MS = 10000;
const MAX_BODY = 262144;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: JSON_HEADERS });
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function ctEqual(a, b) {
  const ha = await sha256hex(String(a == null ? "" : a));
  const hb = await sha256hex(String(b == null ? "" : b));
  let out = 0;
  for (let i = 0; i < ha.length; i++) out |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return out === 0;
}

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

async function handle(request) {
  const RELAY_TOKEN = Deno.env.get("RELAY_TOKEN");

  if (request.method === "GET") {
    return json({
      service: "hs-verify-relay",
      host: "deno-deploy",
      purpose:
        "Cross-provider probe relay for the HORIZON SHIELD verification gate. The gate, a " +
        "Cloudflare Worker, cannot make subrequests to its own zone over HTTP (they fail with 522), " +
        "so it cannot measure itself. This relay runs off Cloudflare, on the public edge, and " +
        "performs those probes over the public internet, so the gate measures the same path any " +
        "outside client uses. It is not an open proxy: it authenticates its caller and fetches " +
        "nothing outside the " + ALLOWED_ZONE + " zone. Verdicts produced through it carry a " +
        "probed_via field saying so.",
    });
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!RELAY_TOKEN) {
    return json({ error: "relay_not_configured", note: "RELAY_TOKEN env var is not set on this deployment." }, 503);
  }

  const token = request.headers.get("x-relay-token") || "";
  if (!(await ctEqual(token, RELAY_TOKEN))) {
    return json({ error: "forbidden" }, 403);
  }

  let body;
  try { body = await request.json(); }
  catch (_e) { return json({ error: "invalid_json" }, 400); }

  let u;
  try { u = new URL(body && body.url); }
  catch (_e) { return json({ error: "invalid_url" }, 400); }
  if (u.protocol !== "https:") return json({ error: "https_only" }, 400);

  const h = u.hostname;
  if (!(h === ALLOWED_ZONE || h.endsWith("." + ALLOWED_ZONE))) {
    return json({
      error: "target_not_allowed",
      note: "This relay exists solely so the gate can measure its own zone over the public edge. It fetches nothing else.",
    }, 403);
  }

  const method = body.method === "POST" ? "POST" : "GET";
  const headers = (body.headers && typeof body.headers === "object") ? body.headers : {};
  const init = { method: method, headers: headers };
  if (method === "POST") {
    init.body = typeof body.body === "string" ? body.body : JSON.stringify(body.body || {});
  }

  let res;
  try {
    res = await withTimeout(fetch(u.toString(), init), TIMEOUT_MS);
  } catch (e) {
    // 中継から相手に届かなかった。相手側の到達性の事実であり、中継自体の故障と区別して返す。
    return json({ relayed: false, error: "target_fetch_failed", message: String((e && e.message) || e) }, 502);
  }

  let text = "";
  try { text = await res.text(); } catch (_e) { text = ""; }
  if (text.length > MAX_BODY) text = text.slice(0, MAX_BODY);

  return json({
    relayed: true,
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "" },
    body: text,
  });
}

Deno.serve(handle);
