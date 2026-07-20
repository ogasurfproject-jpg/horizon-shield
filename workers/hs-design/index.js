// hs-design : HS_DESIGN_KV ブリッジ。
// H9 修正: 全ルートを DESIGN_TOKEN で定数時間ゲート。未設定/不一致は fail-closed で 401。
// 呼び出しは Authorization: Bearer <token> 推奨（?token= はログに残るため非推奨）。
async function ctEq(a, b) {
  a = String(a == null ? "" : a); b = String(b == null ? "" : b);
  const enc = new TextEncoder();
  const ha = await crypto.subtle.digest("SHA-256", enc.encode(a));
  const hb = await crypto.subtle.digest("SHA-256", enc.encode(b));
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let out = 0;
  for (let i = 0; i < x.length; i++) out |= x[i] ^ y[i];
  return out === 0;
}
function j(o, status) {
  return new Response(JSON.stringify(o), { status: status || 200, headers: { "content-type": "application/json" } });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // H9: fail-closed トークンゲート（全ルート）。以前は secret:* が無認証で読み書きできた。
    const auth = request.headers.get("authorization") || "";
    const provided = url.searchParams.get("token") || (auth.startsWith("Bearer ") ? auth.slice(7) : "");
    if (!env.DESIGN_TOKEN || !(await ctEq(provided, env.DESIGN_TOKEN))) return j({ error: "unauthorized" }, 401);

    if (url.pathname === "/put" && request.method === "PUT") {
      const key = url.searchParams.get("key");
      if (!key) return j({ error: "key required" }, 400);
      const body = await request.text();
      await env.HS_DESIGN_KV.put(key, body);
      return j({ ok: true, key, bytes: body.length });
    }
    if (url.pathname === "/get") {
      const key = url.searchParams.get("key");
      if (!key) return j({ error: "key required" }, 400);
      const value = await env.HS_DESIGN_KV.get(key);
      return j({ key, value });
    }
    if (url.pathname === "/list") {
      const list = await env.HS_DESIGN_KV.list();
      return j({ keys: list.keys });
    }
    return j({ error: "not found" }, 404);
  }
};
