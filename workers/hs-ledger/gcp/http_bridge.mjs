// http_bridge.mjs  Node の http(req,res) と Cloudflare Worker の fetch(request,env,ctx) を橋渡す。
// firestore にも worker にも依存しない(注入)。だから偽 KV で単体試験できる。
// Node 22 の global(Request/Response/Headers/URL/fetch/Buffer)前提。
//
// やること 3 つだけ:
//  1. Node req -> Web Request(client IP を cf-connecting-ip に補正。worker はこのヘッダを読む)
//  2. worker.fetch / worker.scheduled を呼ぶ(ctx.waitUntil は集めて後始末)
//  3. Web Response -> Node res

export async function toWebRequest(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers["host"] || "localhost";
  const url = proto + "://" + host + req.url;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    try {
      if (Array.isArray(v)) for (const x of v) headers.append(k, String(x));
      else headers.set(k, String(v));
    } catch { /* host / connection 等の forbidden header は URL 側で拾うので無視 */ }
  }
  // Cloud Run は client IP を x-forwarded-for に入れる。worker は cf-connecting-ip を読むので補正。
  if (!headers.get("cf-connecting-ip")) {
    const xff = headers.get("x-forwarded-for");
    if (xff) headers.set("cf-connecting-ip", xff.split(",")[0].trim());
  }
  const method = String(req.method || "GET").toUpperCase();
  let body;
  if (method !== "GET" && method !== "HEAD") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (chunks.length) body = Buffer.concat(chunks);
  }
  return new Request(url, { method, headers, body });
}

export async function sendWebResponse(res, webRes) {
  const headers = {};
  webRes.headers.forEach((v, k) => { headers[k] = v; });
  const status = webRes.status;
  if (status === 204 || status === 304 || webRes.body === null) {
    res.writeHead(status, headers);
    return res.end();
  }
  const buf = Buffer.from(await webRes.arrayBuffer());
  headers["content-length"] = String(buf.length);
  res.writeHead(status, headers);
  res.end(buf);
}

// worker と env を束ねて Node の (req,res) ハンドラを返す。
// cronToken を付けると POST /__scheduled で worker.scheduled を叩ける(Cloud Scheduler 用)。
export function makeNodeHandler({ worker, env, cronToken }) {
  return async function handler(req, res) {
    const promises = [];
    const ctx = {
      waitUntil: (p) => { promises.push(Promise.resolve(p).catch((e) => console.error("waitUntil error:", e))); },
      passThroughOnException() {},
    };
    try {
      const u = new URL(req.url, "http://localhost");
      if (u.pathname === "/__scheduled") {
        const tok = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
        if (!cronToken || tok !== cronToken) {
          res.writeHead(403, { "content-type": "application/json" });
          return res.end('{"error":"forbidden"}');
        }
        await worker.scheduled({ scheduledTime: Date.now(), cron: u.searchParams.get("cron") || "" }, env, ctx);
        await Promise.allSettled(promises);
        res.writeHead(200, { "content-type": "application/json" });
        return res.end('{"ok":true}');
      }
      const request = await toWebRequest(req);
      const webRes = await worker.fetch(request, env, ctx);
      await sendWebResponse(res, webRes);
    } catch (e) {
      console.error("gate handler error:", e);
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal", message: String((e && e.message) || e) }));
    } finally {
      // waitUntil の後始末。Cloud Run は "CPU always allocated" で走らせること(README 参照)。
      Promise.allSettled(promises);
    }
  };
}
