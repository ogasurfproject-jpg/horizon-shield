export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/put" && request.method === "PUT") {
      const key = url.searchParams.get("key");
      if (!key) {
        return new Response(JSON.stringify({ error: "key required" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }
      const body = await request.text();
      await env.HS_DESIGN_KV.put(key, body);
      return new Response(JSON.stringify({ ok: true, key, bytes: body.length }), {
        headers: { "content-type": "application/json" }
      });
    }
    if (url.pathname === "/get") {
      const key = url.searchParams.get("key");
      if (!key) {
        return new Response(JSON.stringify({ error: "key required" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }
      const value = await env.HS_DESIGN_KV.get(key);
      return new Response(JSON.stringify({ key, value }), {
        headers: { "content-type": "application/json" }
      });
    }
    if (url.pathname === "/list") {
      const list = await env.HS_DESIGN_KV.list();
      return new Response(JSON.stringify({ keys: list.keys }), {
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" }
    });
  }
};
