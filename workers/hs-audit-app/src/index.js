import { HS_PROVENANCE, withProvenance } from "./provenance.js";
import { AUDIT_UI_HTML } from "./ui.js";

const UI_URI = "ui://horizon-shield/audit-estimate";
const TOOLS = [
  {
    name: "audit_estimate",
    description: "業者提示の建設・リフォーム見積額が適正かを HORIZON SHIELD の適正レンジ(souba-db)で判定し、操作できる監査カード(UI)で表示する。Japan only, JPY。",
    inputSchema: {
      type: "object",
      properties: {
        work: { type: "string", description: "工事名(日本語)。例: 外壁塗装 シリコン" },
        quoted_price: { type: "number", description: "業者提示の金額(円)。単価建てはその単価。" }
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
  const upstreamReq = () => new Request("https://hs-mcp.oga-surf-project.workers.dev/mcp", { method: "POST", headers, body: payload });
  let r, branch;
  if (env.HS_MCP && typeof env.HS_MCP.fetch === "function") {
    branch = "binding";
    r = await env.HS_MCP.fetch(upstreamReq());
  } else if (env.HS_MCP_URL) {
    branch = "url";
    r = await fetch(env.HS_MCP_URL, { method: "POST", headers, body: payload });
  } else {
    return { _error: "HS_MCP も HS_MCP_URL も未設定。", _debug: { branch: "none" } };
  }
  const status = r.status;
  const text = await r.text();
  const json = parseMaybeSSE(text);
  const result = json?.result;
  const t = result?.content?.find((c) => c.type === "text");
  if (t) {
    try {
      return JSON.parse(t.text);
    } catch {
      return { advice: t.text };
    }
  }
  if (result?.structuredContent) return result.structuredContent;
  return { _error: "上流応答を解釈できませんでした。", _raw: text.slice(0, 200), _debug: { branch, status } };
}
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
async function handleRpc(msg, env) {
  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
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
      return ok({ resources: [{ uri: UI_URI, name: "見積もり監査カード", mimeType: "text/html" }] });
    case "resources/read": {
      if (params?.uri !== UI_URI) return err(-32602, "unknown resource");
      return ok({ contents: [{ uri: UI_URI, mimeType: "text/html", text: AUDIT_UI_HTML }] });
    }
    case "tools/call": {
      if (params?.name !== "audit_estimate") return err(-32602, "unknown tool");
      const audit = await callUpstreamAudit(env, params.arguments || {});
      const enriched = withProvenance(audit, {});
      const summary = (audit.verdict ? `【${audit.verdict}】` : "") + (audit.advice || audit.message || "監査結果") + `
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
export default {
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
