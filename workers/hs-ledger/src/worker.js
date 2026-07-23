// hs-ledger — JIDEC Verification Ledger (Bitcoin anchor via OpenTimestamps)
// 番人v3 が 2026-07-23 に live デプロイ (workers_get_worker_code) から救出したバンドル。
// repo に workers/hs-ledger/ が存在しなかったため、ソース消失防止のためのバックアップ。
// 秘密のベタ書きなし（認証は env.LEDGER_ADMIN_TOKEN 参照のみ）を確認済み。
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.js
var enc = new TextEncoder();
var CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,x-ledger-key" };
var json = /* @__PURE__ */ __name((o, status = 200) => new Response(JSON.stringify(o, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS } }), "json");
async function ctEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const ha = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(a)));
  const hb = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(b)));
  let o = 0;
  for (let i = 0; i < ha.length; i++) o |= ha[i] ^ hb[i];
  return o === 0;
}
__name(ctEq, "ctEq");
var auth = /* @__PURE__ */ __name(async (request, env) => !!env.LEDGER_ADMIN_TOKEN && await ctEq(request.headers.get("x-ledger-key") || "", env.LEDGER_ADMIN_TOKEN), "auth");
var isHex64 = /* @__PURE__ */ __name((s) => typeof s === "string" && /^[0-9a-f]{64}$/i.test(s), "isHex64");
async function sha256hex(s) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256hex, "sha256hex");
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
__name(b64ToBytes, "b64ToBytes");
var getEntry = /* @__PURE__ */ __name(async (env, n) => {
  const r = await env.LEDGER.get(`entry:${n}`);
  return r ? JSON.parse(r) : null;
}, "getEntry");
var esc = /* @__PURE__ */ __name((s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]), "esc");
function receiptHtml(e, origin) {
  const s = e.ots_status || "unstamped";
  const label = s === "confirmed" ? `Bitcoin-anchored — block ${e.bitcoin_block}${e.block_time ? " (" + e.block_time + ")" : ""}` : s === "pending" ? "OpenTimestamps submitted — awaiting Bitcoin confirmation" : "recorded — not yet stamped";
  const ots = `${origin}/ledger/${e.n}/ots`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JIDEC Ledger #${e.n} — HORIZON SHIELD</title><style>
body{font-family:-apple-system,system-ui,sans-serif;background:#0a1628;color:#e8eef5;margin:0;padding:2rem 1.2rem;line-height:1.6}
.w{max-width:820px;margin:0 auto}h1{color:#c9a84c;font-size:1.25rem;margin:0 0 .2rem}
.sub{color:#94a3b8;font-size:.85rem;margin-bottom:1.5rem}
.card{background:#112240;border:1px solid #24344d;border-radius:10px;padding:1.1rem 1.2rem;margin-bottom:1rem}
.k{color:#94a3b8;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em}.v{font-size:.95rem;word-break:break-all}
code{background:#0a1628;border:1px solid #24344d;border-radius:6px;padding:.15rem .4rem;font-size:.82rem;color:#e8c87a}
pre{background:#0a1628;border:1px solid #24344d;border-radius:6px;padding:.8rem;overflow:auto;white-space:pre-wrap;font-size:.8rem;color:#e8c87a}
.badge{display:inline-block;padding:.25rem .6rem;border-radius:6px;font-size:.8rem;font-weight:700}
.confirmed{background:#16391f;color:#4ade80;border:1px solid #2f7d43}.pending{background:#3a3416;color:#e8c87a;border:1px solid #7d6a2f}
.unstamped{background:#2a2f3a;color:#94a3b8;border:1px solid #3a4557}a{color:#7ab8e8}</style></head><body><div class="w">
<h1>JIDEC Verification Ledger — Entry #${e.n}</h1>
<div class="sub">HORIZON SHIELD \xB7 Pre-Transaction Knowledge Anchoring (PTKA) \xB7 anchored to Bitcoin via OpenTimestamps</div>
<div class="card"><div class="k">Status</div><div class="v"><span class="badge ${s}">${label}</span></div></div>
<div class="card"><div class="k">Claim SHA-256</div><div class="v"><code>${e.claim_sha256}</code></div>
${e.work ? `<div class="k" style="margin-top:.8rem">Work</div><div class="v">${esc(e.work)}</div>` : ""}
<div class="k" style="margin-top:.8rem">Recorded</div><div class="v">${e.created_at}</div></div>
<div class="card"><div class="k">Signed record — the exact bytes this hash commits to</div><pre>${esc(e.record_canonical || "")}</pre></div>
<div class="card"><div class="k">OpenTimestamps proof</div><div class="v"><a href="${ots}">${ots}</a> ${s === "unstamped" ? "(not yet available)" : ""}</div>
<div class="k" style="margin-top:.8rem">Verify it yourself — independent, no trust in us</div>
<pre>curl -s "${origin}/ledger/${e.n}?format=raw" > claim_${e.n}.txt
curl -s "${ots}" > claim_${e.n}.txt.ots
ots verify claim_${e.n}.txt.ots          # checks the Bitcoin attestation
shasum -a 256 claim_${e.n}.txt           # == ${e.claim_sha256}</pre></div>
<div class="sub">A signature proves the record is untampered, not that the underlying ruleset is still current. This ledger anchors <em>when</em> the claim existed — to Bitcoin, nothing weaker, no separate chain.</div>
</div></body></html>`;
}
__name(receiptHtml, "receiptHtml");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, "") || "/";
    const origin = url.origin;
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (p === "/" || p === "/health")
      return json({ ok: true, service: "hs-ledger", ledger: "JIDEC", anchor: "Bitcoin via OpenTimestamps" });
    if (p === "/ledger" && request.method === "GET") {
      const seq = Number(await env.LEDGER.get("seq") || 0);
      const items = [];
      for (let n = seq; n >= 1 && items.length < 100; n--) {
        const e = await getEntry(env, n);
        if (e) items.push({ n, work: e.work, claim_sha256: e.claim_sha256, ots_status: e.ots_status, bitcoin_block: e.bitcoin_block, url: `${origin}/ledger/${n}` });
      }
      return json({ ledger: "JIDEC", anchor: "Bitcoin via OpenTimestamps", count: seq, entries: items });
    }
    if (p === "/ledger/append" && request.method === "POST") {
      if (!await auth(request, env)) return json({ error: "unauthorized" }, 401);
      const b = await request.json().catch(() => null);
      if (!b || !isHex64(b.claim_sha256) || typeof b.record_canonical !== "string")
        return json({ error: "claim_sha256 (64 hex) and record_canonical (string) required" }, 400);
      const h = (await sha256hex(b.record_canonical)).toLowerCase();
      if (h !== b.claim_sha256.toLowerCase()) return json({ error: "hash_mismatch", recomputed: h }, 422);
      const dup = await env.LEDGER.get(`hash:${h}`);
      if (dup) return json({ n: Number(dup), url: `${origin}/ledger/${dup}`, dedup: true });
      const n = Number(await env.LEDGER.get("seq") || 0) + 1;
      const entry = { n, work: b.work || null, claim_sha256: h, record_canonical: b.record_canonical, created_at: (/* @__PURE__ */ new Date()).toISOString(), ots_status: "unstamped", bitcoin_block: null, block_time: null, stamped_at: null };
      await env.LEDGER.put(`entry:${n}`, JSON.stringify(entry));
      await env.LEDGER.put(`hash:${h}`, String(n));
      await env.LEDGER.put("seq", String(n));
      return json({ n, url: `${origin}/ledger/${n}` }, 201);
    }
    if (p === "/ledger/pending" && request.method === "GET") {
      if (!await auth(request, env)) return json({ error: "unauthorized" }, 401);
      const seq = Number(await env.LEDGER.get("seq") || 0);
      const out = [];
      for (let n = 1; n <= seq; n++) {
        const e = await getEntry(env, n);
        if (e && e.ots_status !== "confirmed") out.push({ n, claim_sha256: e.claim_sha256, record_canonical: e.record_canonical, ots_status: e.ots_status });
      }
      return json({ pending: out });
    }
    const m = p.match(/^\/ledger\/(\d+)(\/ots)?$/);
    if (m) {
      const n = Number(m[1]);
      const e = await getEntry(env, n);
      if (!e) return json({ error: "not found" }, 404);
      if (m[2]) {
        if (request.method === "POST") {
          if (!await auth(request, env)) return json({ error: "unauthorized" }, 401);
          const b = await request.json().catch(() => null);
          if (!b || typeof b.ots_base64 !== "string") return json({ error: "ots_base64 required" }, 400);
          await env.LEDGER.put(`ots:${n}`, b.ots_base64);
          e.ots_status = b.status === "confirmed" ? "confirmed" : "pending";
          if (b.bitcoin_block) e.bitcoin_block = b.bitcoin_block;
          if (b.block_time) e.block_time = b.block_time;
          e.stamped_at = (/* @__PURE__ */ new Date()).toISOString();
          await env.LEDGER.put(`entry:${n}`, JSON.stringify(e));
          return json({ ok: true, n, ots_status: e.ots_status });
        }
        const b64 = await env.LEDGER.get(`ots:${n}`);
        if (!b64) return json({ error: "proof not yet available", ots_status: e.ots_status }, 404);
        return new Response(b64ToBytes(b64), { headers: { "content-type": "application/vnd.opentimestamps.proof", "content-disposition": `attachment; filename="claim_${n}.txt.ots"`, ...CORS } });
      }
      const fmt = url.searchParams.get("format");
      if (fmt === "raw") return new Response(e.record_canonical || "", { headers: { "content-type": "text/plain; charset=utf-8", ...CORS } });
      if (fmt === "json" || (request.headers.get("accept") || "").includes("application/json")) return json(e);
      return new Response(receiptHtml(e, origin), { headers: { "content-type": "text/html; charset=utf-8", ...CORS } });
    }
    return json({ error: "not found", routes: ["/ledger", "/ledger/{n}", "/ledger/{n}/ots"] }, 404);
  }
};
export {
  worker_default as default
};
