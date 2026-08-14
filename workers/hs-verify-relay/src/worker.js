// hs-verify-relay — 扉の同一ゾーン522を迂回するための、公開エッジ経由の中継 (2026-08-15)
//
// なぜ存在するか:
//   HTTP で呼ばれた扉(hs-verify-gate, zone horizonshield.dev)は、自ゾーンの
//   カスタムドメイン(mcp./hearing./gate.horizonshield.dev …)への subrequest が
//   522 になる。cron 起動だと通る。2026-08-14〜15 に実測で確定した
//   (最初に見つけたのは Federico Blanco Sanchez-Llanos の外部ネットワークからの1発)。
//
//   この中継は別ゾーン(the-horizons-innovation.com)に住む。扉→中継はゾーンを
//   またぐので届き(405実測で確認済み)、中継→horizonshield.dev もまたぐので届く。
//   経路は全て公開エッジ。service binding のような「公開経路を通らない私道」は
//   使わない — 到達性を売る道具が私道で測ったら、それは扉の pass:true と同じ嘘になる。
//
// これは開放プロキシではない:
//   1. x-relay-token の一致(定数時間比較)が無ければ 403
//   2. 取得先は horizonshield.dev ゾーンの https のみ。他は一切取得しない
//   3. メソッドは GET / POST のみ、応答本文は 256KB で打ち切り

const ALLOWED_ZONE = "horizonshield.dev";
const TIMEOUT_MS = 10000;
const MAX_BODY = 262144;

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), { status: status || 200, headers: JSON_HEADERS });
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
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))
  ]);
}

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return json({
        service: "hs-verify-relay",
        purpose:
          "Cross-zone probe relay for the HORIZON SHIELD verification gate. The gate, when invoked " +
          "over HTTP, cannot make subrequests to servers on its own Cloudflare zone (they fail with " +
          "522, measured 2026-08-14). This relay lives on a different zone and performs those probes " +
          "over the public edge, so the gate measures the same path any outside client uses. It is " +
          "not an open proxy: it authenticates its caller and fetches nothing outside the " +
          ALLOWED_ZONE + " zone. Verdicts produced through it carry a probed_via field saying so.",
      });
    }
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    if (!env || !env.RELAY_TOKEN) {
      return json({ error: "relay_not_configured", note: "RELAY_TOKEN secret is not set on this deployment." }, 503);
    }
    const token = request.headers.get("x-relay-token") || "";
    if (!(await ctEqual(token, env.RELAY_TOKEN))) {
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
        note: "This relay exists solely so the gate can measure its own zone over the public edge. It fetches nothing else."
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
      // 中継から相手に届かなかった。これは相手側の(公開エッジ経由の)到達性の事実であり、
      // 中継自体の故障とは区別できる形で返す。
      return json({ relayed: false, error: "target_fetch_failed", message: String((e && e.message) || e) }, 502);
    }

    let text = "";
    try { text = await res.text(); } catch (_e) { text = ""; }
    if (text.length > MAX_BODY) text = text.slice(0, MAX_BODY);

    return json({
      relayed: true,
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "" },
      body: text
    });
  }
};
