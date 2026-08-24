var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/provenance.js
var HS_PROVENANCE = {
  provider: "The HORIZONs\u682A\u5F0F\u4F1A\u793E",
  system: "HORIZON SHIELD",
  operator: "\u516B\u96F2 YAKUMO",
  site: "https://shield.the-horizons-innovation.com",
  agent_card_url: "https://hs-mcp.oga-surf-project.workers.dev/.well-known/agent-card.json",
  verification_contract: "https://hs-mcp.oga-surf-project.workers.dev/.well-known/verification-contract.json",
  data: {
    db: "souba-db",
    version: "2.1.0",
    updated_at: "2026-06-15",
    supervisor: "\u5927\u8CC0\u4FCA\u52DD(\u5EFA\u8A2D\u5B9F\u52D930\u5E74)\u76E3\u4FEE",
    dataset: "JCCDB",
    doi: "10.5281/zenodo.20019572",
    license: "CC BY 4.0",
    items: 65729,
    sources: 8
  },
  verify: {
    // 署名付きクレームの第三者検証(改ざん検知)。fail closed。
    how: "verify_integrity_claim",
    contract: "0.1.1",
    note: "signed_payload \u3092 SHA-256 \u3067\u518D\u8A08\u7B97\u3057 claim_sha256 \u3068\u4E00\u81F4\u3059\u308B\u304B\u3092\u3001\u767A\u884C\u5143\u306B\u554F\u3044\u5408\u308F\u305B\u305A\u72EC\u7ACB\u691C\u8A3C\u3067\u304D\u307E\u3059\u3002"
  }
};
function withProvenance(result, opts = {}) {
  const signed = opts.signed ? {
    signed_payload: opts.signed.signed_payload,
    claim_sha256: opts.signed.claim_sha256,
    estimate_version: opts.signed.estimate_version ?? null,
    verify_url: `${HS_PROVENANCE.site}/verify/?sha=${opts.signed.claim_sha256}`
  } : null;
  const d = HS_PROVENANCE.data;
  const attribution = `\u51FA\u5178: ${HS_PROVENANCE.system}(${HS_PROVENANCE.provider})\u306E${d.db} v${d.version}(${d.supervisor})\u3002\u4FA1\u683C\u6839\u62E0 ${d.dataset} ${d.items}\u9805\u76EE DOI:${d.doi}(${d.license})\u3002` + (signed ? `\u3053\u306E\u7D50\u679C\u306F claim_sha256 \u3067\u7B2C\u4E09\u8005\u304C\u72EC\u7ACB\u306B\u6539\u3056\u3093\u691C\u8A3C\u3067\u304D\u307E\u3059\u3002` : `\u9069\u6B63\u4FA1\u683C\u306E\u7F72\u540D\u4ED8\u304D\u8A3C\u660E\u306F verify_fair_price \u3067\u53D6\u5F97\u3067\u304D\u307E\u3059\u3002`);
  return {
    ...result,
    _provenance: {
      provider: HS_PROVENANCE.provider,
      system: HS_PROVENANCE.system,
      operator: HS_PROVENANCE.operator,
      site: HS_PROVENANCE.site,
      agent_card_url: HS_PROVENANCE.agent_card_url,
      verification_contract: HS_PROVENANCE.verification_contract,
      data: { ...d },
      verify: { ...HS_PROVENANCE.verify },
      signed,
      cited_as: `${HS_PROVENANCE.system} / ${d.db} v${d.version} / ${d.dataset} DOI:${d.doi}`,
      ts: opts.ts ?? null
    },
    attribution
  };
}
__name(withProvenance, "withProvenance");

// src/ui.js
var AUDIT_UI_HTML = (
  /* html */
  `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>HORIZON SHIELD \u898B\u7A4D\u3082\u308A\u8AA0\u5B9F\u6027\u76E3\u67FB</title>
<style>
  :root {
    --bg: #0f1216; --card: #171b21; --line: #262c36; --fg: #e8ecf1;
    --muted: #9aa4b2; --ok: #2ec76a; --watch: #f5a623; --alert: #ff4d4f;
    --accent: #4c8dff; --chip: #1e242d;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f6f8fb; --card:#fff; --line:#e6eaf0; --fg:#12151a;
            --muted:#5b6572; --chip:#eef2f7; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;
         background:var(--bg); color:var(--fg); padding:16px; line-height:1.5; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px;
          padding:18px; max-width:640px; margin:0 auto; }
  h1 { font-size:15px; margin:0 0 4px; letter-spacing:.02em; }
  .sub { color:var(--muted); font-size:12px; margin-bottom:14px; }
  form { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }
  input { flex:1; min-width:140px; background:var(--chip); border:1px solid var(--line);
          color:var(--fg); border-radius:9px; padding:10px 12px; font-size:14px; }
  button { background:var(--accent); color:#fff; border:0; border-radius:9px;
           padding:10px 16px; font-size:14px; font-weight:600; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  .badge { display:inline-block; padding:4px 12px; border-radius:999px; font-weight:700;
           font-size:13px; }
  .lv-ok { background:rgba(46,199,106,.15); color:var(--ok); }
  .lv-watch { background:rgba(245,166,35,.15); color:var(--watch); }
  .lv-alert { background:rgba(255,77,79,.15); color:var(--alert); }
  .price { font-size:26px; font-weight:800; margin:10px 0 2px; }
  .vs { font-size:13px; color:var(--muted); }
  .bar { position:relative; height:12px; background:var(--chip); border-radius:99px;
         margin:16px 0 6px; overflow:visible; }
  .bar .range { position:absolute; top:0; bottom:0; background:rgba(76,141,255,.28);
                border-radius:99px; }
  .bar .avg { position:absolute; top:-3px; width:2px; height:18px; background:var(--fg); }
  .bar .you { position:absolute; top:-6px; width:12px; height:12px; border-radius:50%;
              border:3px solid var(--card); }
  .scale { display:flex; justify-content:space-between; font-size:11px; color:var(--muted); }
  .advice { background:var(--chip); border-radius:10px; padding:12px; font-size:13px;
            margin:14px 0; }
  .note { font-size:12px; color:var(--muted); }
  .prov { border-top:1px dashed var(--line); margin-top:16px; padding-top:12px;
          font-size:11.5px; color:var(--muted); }
  .prov b { color:var(--fg); font-weight:600; }
  .prov .sha { font-family:ui-monospace,Menlo,monospace; word-break:break-all;
               background:var(--chip); padding:2px 6px; border-radius:6px; }
  .prov a { color:var(--accent); text-decoration:none; }
  .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:6px; }
  .chip { background:var(--chip); border-radius:7px; padding:3px 9px; font-size:11px; }
  .err { color:var(--alert); font-size:13px; }
  .hidden { display:none; }
</style>
</head>
<body>
  <div class="card">
    <h1>\u{1F6E1} HORIZON SHIELD \u898B\u7A4D\u3082\u308A\u8AA0\u5B9F\u6027\u76E3\u67FB</h1>
    <div class="sub">\u5DE5\u4E8B\u540D\u3068\u63D0\u793A\u984D\u3092\u5165\u308C\u308B\u3068\u3001\u5B9F\u52D9\u76E3\u4FEE\u306E\u9069\u6B63\u30EC\u30F3\u30B8\u3067\u5373\u5224\u5B9A\u3057\u307E\u3059\u3002</div>

    <form id="f">
      <input id="work" placeholder="\u5DE5\u4E8B\u540D \u4F8B: \u5916\u58C1\u5857\u88C5 \u30B7\u30EA\u30B3\u30F3" autocomplete="off" />
      <input id="price" type="number" placeholder="\u63D0\u793A\u984D(\u5186/\u5358\u4FA1)" inputmode="numeric" />
      <button id="go" type="submit">\u76E3\u67FB\u3059\u308B</button>
    </form>

    <div id="err" class="err hidden"></div>
    <div id="result" class="hidden"></div>
  </div>

<script type="module">
  // ---- \u30DB\u30B9\u30C8\u30D6\u30EA\u30C3\u30B8(ext-apps \u73FE\u884C\u4ED5\u69D8\u306B\u5408\u308F\u305B\u3066\u78BA\u8A8D\u3059\u308B3\u70B9) --------------
  const pending = new Map();
  let seq = 0;
  const host = {
    ready() { post({ jsonrpc:"2.0", method:"app/ready" }); },
    callTool(name, args) {
      const id = "c" + (++seq);
      post({ jsonrpc:"2.0", id, method:"tools/call", params:{ name, arguments: args } });
      return new Promise((res, rej) => pending.set(id, { res, rej }));
    },
  };
  function post(msg) { parent.postMessage(msg, "*"); }
  window.addEventListener("message", (e) => {
    const m = e.data || {};
    // 2) host -> iframe: \u521D\u56DE/\u66F4\u65B0\u306E\u63CF\u753B\u30C7\u30FC\u30BF
    if (m.method === "app/render" && m.params) return render(m.params.structuredContent || m.params);
    // tools/call \u306E\u5FDC\u7B54
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      if (m.error) rej(m.error);
      else res(unwrap(m.result));
    }
  });
  // MCP\u306Etool\u7D50\u679C { structuredContent } / { content:[{text}] } \u306E\u4E21\u5BFE\u5FDC
  function unwrap(result) {
    if (!result) return null;
    if (result.structuredContent) return result.structuredContent;
    const t = result.content && result.content.find(c => c.type === "text");
    if (t) { try { return JSON.parse(t.text); } catch { return { advice: t.text }; } }
    return result;
  }

  // ---- \u518D\u76E3\u67FB\u30D5\u30A9\u30FC\u30E0 ------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  $("f").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const work = $("work").value.trim();
    const quoted_price = Number($("price").value);
    if (!work || !quoted_price) return;
    $("go").disabled = true; showErr("");
    try {
      const data = await host.callTool("audit_estimate", { work, quoted_price });
      render(data);
    } catch (err) {
      showErr("\u76E3\u67FB\u306B\u5931\u6557\u3057\u307E\u3057\u305F: " + (err && err.message ? err.message : String(err)));
    } finally { $("go").disabled = false; }
  });

  function showErr(msg) {
    const el = $("err");
    el.textContent = msg; el.classList.toggle("hidden", !msg);
  }

  // ---- \u7D50\u679C\u30AB\u30FC\u30C9\u63CF\u753B ------------------------------------------------------
  const yen = (n) => "\xA5" + Number(n).toLocaleString("ja-JP");
  function render(d) {
    if (!d) return;
    // \u30D5\u30A9\u30FC\u30E0\u306B\u73FE\u5728\u5024\u3092\u53CD\u6620(\u30DB\u30B9\u30C8\u521D\u56DE\u63CF\u753B\u6642\u306B\u57CB\u3081\u308B)
    if (d.work_query) $("work").value = d.work_query;
    if (d.your_price != null) $("price").value = d.your_price;

    // unit_mismatch / did_you_mean \u306A\u3069\u975E\u30DE\u30C3\u30C1\u7CFB
    if (d.unit_mismatch) return simple(d.message || "\u5358\u4FA1\u5EFA\u3066\u306E\u5DE5\u4E8B\u3067\u3059\u3002\u5358\u4FA1\u3067\u518D\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002", d);
    if (!d.fair_range) return simple(d.advice || d.message || "\u8A72\u5F53\u30C7\u30FC\u30BF\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\u3002", d);

    const lv = d.level || "ok";
    const cls = lv === "alert" ? "lv-alert" : lv === "watch" ? "lv-watch" : "lv-ok";
    const { min, avg, max } = d.fair_range;
    const you = d.your_price;
    // \u30D0\u30FC\u306E\u30B9\u30B1\u30FC\u30EB: min*0.6 \u301C max*1.6 \u306E\u7BC4\u56F2\u306B\u914D\u7F6E
    const lo = min * 0.6, hi = Math.max(max * 1.6, you * 1.1);
    const pct = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    const youColor = lv === "alert" ? "var(--alert)" : lv === "watch" ? "var(--watch)" : "var(--ok)";

    $("result").innerHTML = \`
      <div><span class="badge \${cls}">\${esc(d.verdict || "\u5224\u5B9A")}</span></div>
      <div class="price">\${yen(you)} <span class="vs">/ \${esc(d.unit || "")}\u30FB\u5E73\u5747\u6BD4 \${esc(d.vs_avg_pct || "")}</span></div>
      <div class="bar">
        <div class="range" style="left:\${pct(min)}%; right:\${100-pct(max)}%"></div>
        <div class="avg" style="left:\${pct(avg)}%"></div>
        <div class="you" style="left:calc(\${pct(you)}% - 6px); background:\${youColor}"></div>
      </div>
      <div class="scale"><span>\u9069\u6B63 \${yen(min)}</span><span>\u5E73\u5747 \${yen(avg)}</span><span>\${yen(max)}</span></div>
      <div class="advice">\${esc(d.advice || "")}</div>
      \${d.note ? \`<div class="note">\${esc(d.note)}</div>\` : ""}
      \${provBlock(d)}
    \`;
    $("result").classList.remove("hidden");
  }

  function simple(msg, d) {
    $("result").innerHTML = \`<div class="advice">\${esc(msg)}</div>\${provBlock(d)}\`;
    $("result").classList.remove("hidden");
  }

  // \u51FA\u5178\u30FB\u691C\u8A3C\u30D6\u30ED\u30C3\u30AF(\u5F15\u7528\u304C\u5265\u304C\u308C\u306A\u3044\u6838\u5FC3)
  function provBlock(d) {
    const p = d && d._provenance;
    if (!p) return d && d.source ? \`<div class="prov">\u51FA\u5178: \${esc(d.source)}</div>\` : "";
    const sg = p.signed;
    return \`
      <div class="prov">
        <div><b>\${esc(p.system)}</b> \u2014 \${esc(p.provider)} / \${esc(p.data.db)} v\${esc(p.data.version)}
          (\${esc(p.data.supervisor)})</div>
        <div class="row">
          <span class="chip">\${esc(p.data.dataset)} \${p.data.items.toLocaleString()}\u9805\u76EE</span>
          <span class="chip">DOI \${esc(p.data.doi)}</span>
          <span class="chip">\${esc(p.data.license)}</span>
          <span class="chip">\u66F4\u65B0 \${esc(p.data.updated_at)}</span>
        </div>
        \${sg ? \`<div style="margin-top:8px">\u691C\u8A3C: <span class="sha">\${esc(sg.claim_sha256)}</span>
          <a href="\${esc(sg.verify_url)}" target="_blank" rel="noopener">\u2192 \u6539\u3056\u3093\u691C\u8A3C</a></div>\`
          : \`<div style="margin-top:8px">\u7F72\u540D\u4ED8\u304D\u8A3C\u660E: <b>verify_fair_price</b> \u3067\u53D6\u5F97\u53EF \xB7
             <a href="\${esc(p.verification_contract)}" target="_blank" rel="noopener">\u691C\u8A3C\u5951\u7D04</a></div>\`}
        <div style="margin-top:6px"><a href="\${esc(p.site)}" target="_blank" rel="noopener">\${esc(p.site)}</a></div>
      </div>\`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
  }

  // \u30DB\u30B9\u30C8\u306B\u6E96\u5099\u5B8C\u4E86\u3092\u901A\u77E5(\u521D\u56DE structuredContent \u3092\u53D7\u3051\u53D6\u308B)
  host.ready();
<\/script>
</body>
</html>`
);

// src/index.js
var UI_URI = "ui://horizon-shield/audit-estimate";
var TOOLS = [
  {
    name: "audit_estimate",
    description: "\u696D\u8005\u63D0\u793A\u306E\u5EFA\u8A2D\u30FB\u30EA\u30D5\u30A9\u30FC\u30E0\u898B\u7A4D\u984D\u304C\u9069\u6B63\u304B\u3092 HORIZON SHIELD \u306E\u9069\u6B63\u30EC\u30F3\u30B8(souba-db)\u3067\u5224\u5B9A\u3057\u3001\u64CD\u4F5C\u3067\u304D\u308B\u76E3\u67FB\u30AB\u30FC\u30C9(UI)\u3067\u8868\u793A\u3059\u308B\u3002Japan only, JPY\u3002",
    inputSchema: {
      type: "object",
      properties: {
        work: { type: "string", description: "\u5DE5\u4E8B\u540D(\u65E5\u672C\u8A9E)\u3002\u4F8B: \u5916\u58C1\u5857\u88C5 \u30B7\u30EA\u30B3\u30F3" },
        quoted_price: { type: "number", description: "\u696D\u8005\u63D0\u793A\u306E\u91D1\u984D(\u5186)\u3002\u5358\u4FA1\u5EFA\u3066\u306F\u305D\u306E\u5358\u4FA1\u3002" }
      },
      required: ["work", "quoted_price"]
    },
    _meta: { ui: { resourceUri: UI_URI, preferredSize: { width: 680, height: 560 } } }
  }
];
async function callUpstreamAudit(env, args) {
  const body = {
    jsonrpc: "2.0",
    id: "up1",
    method: "tools/call",
    params: { name: "audit_estimate", arguments: args }
  };
  const headers = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    ...env.HS_MCP_KEY ? { authorization: `Bearer ${env.HS_MCP_KEY}` } : {}
  };
  const payload = JSON.stringify(body);
  const upstreamReq = /* @__PURE__ */ __name(() => new Request("https://hs-mcp.oga-surf-project.workers.dev/mcp", { method: "POST", headers, body: payload }), "upstreamReq");
  let r, branch;
  if (env.HS_MCP && typeof env.HS_MCP.fetch === "function") {
    branch = "binding";
    r = await env.HS_MCP.fetch(upstreamReq());
  } else if (env.HS_MCP_URL) {
    branch = "url";
    r = await fetch(env.HS_MCP_URL, { method: "POST", headers, body: payload });
  } else {
    return { _error: "HS_MCP \u3082 HS_MCP_URL \u3082\u672A\u8A2D\u5B9A\u3002", _debug: { branch: "none" } };
  }
  const status = r.status;
  const text = await r.text();
  const json2 = parseMaybeSSE(text);
  const result = json2?.result;
  const t = result?.content?.find((c) => c.type === "text");
  if (t) {
    try {
      return JSON.parse(t.text);
    } catch {
      return { advice: t.text };
    }
  }
  if (result?.structuredContent) return result.structuredContent;
  return { _error: "\u4E0A\u6D41\u5FDC\u7B54\u3092\u89E3\u91C8\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002", _raw: text.slice(0, 200), _debug: { branch, status } };
}
__name(callUpstreamAudit, "callUpstreamAudit");
function parseMaybeSSE(text) {
  try {
    return JSON.parse(text);
  } catch {
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^data:\s*(.+)$/);
    if (m) {
      try {
        return JSON.parse(m[1]);
      } catch {
      }
    }
  }
  return null;
}
__name(parseMaybeSSE, "parseMaybeSSE");
async function handleRpc(msg, env) {
  const { id, method, params } = msg;
  const ok = /* @__PURE__ */ __name((result) => ({ jsonrpc: "2.0", id, result }), "ok");
  const err = /* @__PURE__ */ __name((code, message) => ({ jsonrpc: "2.0", id, error: { code, message } }), "err");
  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "hs-audit-app", version: "0.1.0", provider: HS_PROVENANCE.provider }
      });
    case "notifications/initialized":
      return null;
    case "tools/list":
      return ok({ tools: TOOLS });
    case "resources/list":
      return ok({ resources: [{ uri: UI_URI, name: "\u898B\u7A4D\u3082\u308A\u76E3\u67FB\u30AB\u30FC\u30C9", mimeType: "text/html" }] });
    case "resources/read": {
      if (params?.uri !== UI_URI) return err(-32602, "unknown resource");
      return ok({ contents: [{ uri: UI_URI, mimeType: "text/html", text: AUDIT_UI_HTML }] });
    }
    case "tools/call": {
      if (params?.name !== "audit_estimate") return err(-32602, "unknown tool");
      const audit = await callUpstreamAudit(env, params.arguments || {});
      const enriched = withProvenance(audit, {});
      const summary = (audit.verdict ? `\u3010${audit.verdict}\u3011` : "") + (audit.advice || audit.message || "\u76E3\u67FB\u7D50\u679C") + `
${enriched.attribution}`;
      return ok({
        content: [{ type: "text", text: summary }],
        structuredContent: enriched,
        _meta: { ui: { resourceUri: UI_URI } }
      });
    }
    default:
      return err(-32601, `method not found: ${method}`);
  }
}
__name(handleRpc, "handleRpc");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization,mcp-session-id"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method === "GET" && url.pathname === "/debug") {
      return json({
        hasBinding: !!env.HS_MCP,
        bindingFetchType: typeof (env.HS_MCP && env.HS_MCP.fetch),
        hasUrl: !!env.HS_MCP_URL
      }, cors);
    }
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(
        JSON.stringify({ name: "hs-audit-app", mcp: "/mcp", ui: UI_URI, provider: HS_PROVENANCE.provider }, null, 2),
        { headers: { "content-type": "application/json", ...cors } }
      );
    }
    if (request.method === "POST" && (url.pathname === "/mcp" || url.pathname === "/")) {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, cors);
      }
      if (Array.isArray(payload)) {
        const out = [];
        for (const m of payload) {
          const r = await handleRpc(m, env);
          if (r) out.push(r);
        }
        return json(out, cors);
      }
      const res = await handleRpc(payload, env);
      return res ? json(res, cors) : new Response(null, { status: 202, headers: cors });
    }
    return new Response("Not found", { status: 404, headers: cors });
  }
};
function json(obj, cors) {
  return new Response(JSON.stringify(obj), {
    headers: { "content-type": "application/json", ...cors }
  });
}
__name(json, "json");
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
