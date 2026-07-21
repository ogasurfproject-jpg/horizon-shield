var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/gateway.js
var RAW_REPO = "https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main";
var FIXED_KEYS = {
  "/reference/souba-db.json": { r2key: "souba-db.json", raw: `${RAW_REPO}/data/souba-db.json` },
  "/reference/bom-summary-v3.json": { r2key: "bom-summary-v3.json", raw: `${RAW_REPO}/data/bom-summary-v3.json` },
  "/reference/hs_real_cases_stats.json": { r2key: "hs_real_cases_stats.json", raw: `${RAW_REPO}/data/hs_real_cases_stats.json` }
};
var SOUBA_V2_PREFIX = "/reference/souba-v2/";
function err503(scope, key) {
  return new Response(JSON.stringify({ error: "reference_unavailable", scope, key }), {
    status: 503,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
__name(err503, "err503");
function unauthorized() {
  return new Response("", { status: 401, headers: { "Cache-Control": "no-store" } });
}
__name(unauthorized, "unauthorized");
function notFound() {
  return new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
__name(notFound, "notFound");
async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
async function buildJsonResponse(buf, scope, key) {
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(buf));
  } catch (e) {
    return err503(scope, key);
  }
  const version = parsed?._meta?.version;
  if (!version) {
    return err503(scope, key);
  }
  const sha = await sha256Hex(buf);
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Reference-Version": version,
      "X-Reference-Sha256": sha
    }
  });
}
__name(buildJsonResponse, "buildJsonResponse");
async function serveFromR2(env, r2key, scope, key) {
  let obj;
  try {
    obj = await env.REFERENCE_BUCKET.get(r2key);
  } catch (e) {
    return err503(scope, key);
  }
  if (!obj) return err503(scope, key);
  const buf = await obj.arrayBuffer();
  return buildJsonResponse(buf, scope, key);
}
__name(serveFromR2, "serveFromR2");
async function serveFromRaw(rawUrl, scope, key) {
  let res;
  try {
    res = await fetch(rawUrl);
  } catch (e) {
    return err503(scope, key);
  }
  if (!res.ok) return err503(scope, key);
  const buf = await res.arrayBuffer();
  return buildJsonResponse(buf, scope, key);
}
__name(serveFromRaw, "serveFromRaw");
function resolveSoubaV2Key(pathname) {
  const sub = pathname.slice(SOUBA_V2_PREFIX.length);
  if (!sub || sub.includes("..") || sub.startsWith("/")) return null;
  if (!/^[A-Za-z0-9_\-/.]+$/.test(sub)) return null;
  return sub;
}
__name(resolveSoubaV2Key, "resolveSoubaV2Key");
var gateway_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (path === "/healthz" && method === "GET") {
      try {
        const list = await env.REFERENCE_BUCKET.list({ limit: 1 });
        if (list && list.objects && list.objects.length > 0) {
          return new Response(JSON.stringify({ status: "ok" }), {
            status: 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
          });
        }
        return err503("health", "empty_bucket");
      } catch (e) {
        return err503("health", "list_failed");
      }
    }
    const token = request.headers.get("X-Gateway-Token");
    if (!token || token !== env.GATEWAY_TOKEN) {
      return unauthorized();
    }
    if (method !== "GET") return notFound();
    const mode = env.MODE || "r2";
    if (path === "/version") {
      const out = {};
      for (const [p, def] of Object.entries(FIXED_KEYS)) {
        const r = mode === "passthrough" ? await serveFromRaw(def.raw, "version", def.r2key) : await serveFromR2(env, def.r2key, "version", def.r2key);
        if (r.status !== 200) return err503("version", def.r2key);
        out[def.r2key] = r.headers.get("X-Reference-Version");
      }
      try {
        const lst = await env.REFERENCE_BUCKET.list({ prefix: "souba-v2/" });
        out["souba-v2_count"] = lst && lst.objects ? lst.objects.length : 0;
      } catch (e) {
        return err503("version", "souba-v2_list");
      }
      return new Response(JSON.stringify(out), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }
    if (FIXED_KEYS[path]) {
      const def = FIXED_KEYS[path];
      const scope = "diagnostic";
      return mode === "passthrough" ? await serveFromRaw(def.raw, scope, def.r2key) : await serveFromR2(env, def.r2key, scope, def.r2key);
    }
    if (path.startsWith(SOUBA_V2_PREFIX)) {
      const sub = resolveSoubaV2Key(path);
      if (!sub) return notFound();
      const r2key = `souba-v2/${sub}`;
      const rawUrl = `${RAW_REPO}/souba-v2/${sub}`;
      const scope = "estimate";
      return mode === "passthrough" ? await serveFromRaw(rawUrl, scope, sub) : await serveFromR2(env, r2key, scope, sub);
    }
    return notFound();
  }
};
export {
  gateway_default as default
};
//# sourceMappingURL=gateway.js.map