// hs-jidec-mcp — Model Context Protocol server for JIDEC verification paths.
//
// Phase 4 of jidec-path-v1. Lets any MCP-capable agent cite and re-check a
// Bitcoin-anchored verification path by URI, without trusting HORIZON SHIELD.
//
// Tools:
//   jidec_cite(citation)       resolve + independently verify a path citation
//   jidec_replay(citation)     re-observe the anchored path live, report drift
//   jidec_list_paths()         list anchored verification paths
//
// This worker is NEW and ISOLATED — it touches no existing service. It reaches
// the ledger through a service binding (LEDGER_SVC), not the public hostname,
// so same-account workers.dev subrequests cannot loop back. Reads only; no
// secrets; open so that "any AI can cite" holds literally.

const LEDGER_ORIGIN = "https://hs-ledger.oga-surf-project.workers.dev";
const HEX64 = /^[0-9a-f]{64}$/i;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

async function ledgerGet(env, path) {
  const r = await env.LEDGER_SVC.fetch(new Request(LEDGER_ORIGIN + path));
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

function parseCitation(c) {
  c = String(c || "").trim();
  if (/^https?:\/\//.test(c)) {
    const mh = c.match(/\/paths\/([0-9a-f]{64})/i);
    if (mh) return { kind: "hash", val: mh[1].toLowerCase() };
    const me = c.match(/\/ledger\/(\d+)/);
    if (me) return { kind: "entry", val: Number(me[1]) };
    throw new Error("unrecognized ledger URL: " + c);
  }
  if (c.startsWith("jidec:entry:")) return { kind: "entry", val: Number(c.split(":").pop()) };
  if (c.startsWith("jidec:path:")) return { kind: "hash", val: String(c.split(":").pop()).toLowerCase() };
  if (c.startsWith("jidec:")) {
    const t = c.slice("jidec:".length);
    if (HEX64.test(t)) return { kind: "hash", val: t.toLowerCase() };
  }
  if (HEX64.test(c)) return { kind: "hash", val: c.toLowerCase() };
  if (/^\d+$/.test(c)) return { kind: "entry", val: Number(c) };
  throw new Error("unrecognized citation: " + c);
}

async function toSha(env, citation) {
  const p = parseCitation(citation);
  if (p.kind === "hash") return p.val;
  const e = await ledgerGet(env, `/ledger/${p.val}?format=json`);
  if (e.status !== 200 || !e.body || !e.body.claim_sha256)
    throw new Error("could not resolve entry " + p.val);
  return String(e.body.claim_sha256).toLowerCase();
}

const TOOLS = [
  {
    name: "jidec_cite",
    description:
      "Resolve and INDEPENDENTLY verify a JIDEC verification-path citation. Accepts 'jidec:path:<sha>', 'jidec:entry:<n>', a bare 64-hex path id, or a ledger URL. Returns the path's integrity check (do the anchored bytes hash to the cited id), its Bitcoin anchoring status, and its verdict + assertions. No trust in HORIZON SHIELD is required to accept the result.",
    inputSchema: {
      type: "object",
      properties: { citation: { type: "string", description: "jidec:path:<sha> | jidec:entry:<n> | ledger URL" } },
      required: ["citation"],
    },
  },
  {
    name: "jidec_replay",
    description:
      "Re-observe an anchored JIDEC path against the live system right now and report drift. Returns MATCH (the live system still matches what was anchored) or DRIFT (it changed), node by node.",
    inputSchema: {
      type: "object",
      properties: { citation: { type: "string", description: "jidec:path:<sha> | jidec:entry:<n> | ledger URL" } },
      required: ["citation"],
    },
  },
  {
    name: "jidec_list_paths",
    description: "List the anchored JIDEC verification paths (most recent first).",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(name, args, env) {
  if (name === "jidec_cite") {
    const sha = await toSha(env, args.citation);
    const r = await ledgerGet(env, `/paths/${sha}`);
    if (r.status === 404) throw new Error("no anchored verification path with id " + sha);
    if (r.status !== 200) throw new Error("ledger error " + r.status);
    return r.body;
  }
  if (name === "jidec_replay") {
    const sha = await toSha(env, args.citation);
    const r = await ledgerGet(env, `/paths/${sha}/replay`);
    if (r.status !== 200) throw new Error("replay error " + r.status);
    return r.body;
  }
  if (name === "jidec_list_paths") {
    const r = await ledgerGet(env, `/paths`);
    return r.body;
  }
  throw new Error("unknown tool: " + name);
}

const SERVER_INFO = {
  protocolVersion: "2024-11-05",
  capabilities: { tools: {} },
  serverInfo: { name: "hs-jidec-mcp", version: "1.0.0" },
};

function wantsSSE(req) {
  return (req.headers.get("Accept") || "").includes("text/event-stream");
}
function rpcSend(req, id, payload) {
  const msg = { jsonrpc: "2.0", id, ...payload };
  if (wantsSSE(req)) {
    return new Response(`event: message\ndata: ${JSON.stringify(msg)}\n\n`, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...CORS },
    });
  }
  return new Response(JSON.stringify(msg), { headers: { "Content-Type": "application/json", ...CORS } });
}
const rpcResult = (req, id, result) => rpcSend(req, id, { result });
const rpcError = (req, id, code, message) => rpcSend(req, id, { error: { code, message } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "hs-jidec-mcp", tools: TOOLS.map((t) => t.name), mcp: "/mcp", ledger: LEDGER_ORIGIN }), { headers: { "Content-Type": "application/json", ...CORS } });
    }

    if (url.pathname === "/mcp" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return rpcError(req, null, -32700, "parse error"); }
      const { id, method, params } = body || {};
      if (method === "initialize") return rpcResult(req, id, SERVER_INFO);
      if (method === "notifications/initialized" || method === "notifications/cancelled") return new Response(null, { status: 202, headers: CORS });
      if (method === "tools/list") return rpcResult(req, id, { tools: TOOLS });
      if (method === "tools/call") {
        try {
          const out = await callTool(params?.name, params?.arguments || {}, env);
          return rpcResult(req, id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
        } catch (e) {
          return rpcError(req, id, -32000, String((e && e.message) || e));
        }
      }
      return rpcError(req, id, -32601, `method not found: ${method}`);
    }

    return new Response(JSON.stringify({ ok: false, error: "not_found", try: "/mcp (POST) or /health" }), { status: 404, headers: { "Content-Type": "application/json", ...CORS } });
  },
};
