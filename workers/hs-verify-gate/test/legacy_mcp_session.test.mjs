// legacy_mcp_session: keep the old session-based Streamable HTTP leg working
// while preserving the stateless path used by newer clients.
//
// This suite was added after AgentStatus classified the production gate as
// "modern only, legacy fails". It exercises the exact compatibility seam:
// initialize must mint Mcp-Session-Id, the client must be able to echo it
// through notifications/initialized, tools/list and tools/call, and a stateless
// tools/list must still work without any session header.

import worker from "../src/worker.js";

const O = "https://gate.horizonshield.dev";
const ENV = {};
const CTX = { waitUntil() {} };

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log((ok ? "ok   " : "NG   ") + name + (ok || detail === undefined ? "" : "  <<< " + detail));
};

async function post(body, headers = {}) {
  return worker.fetch(new Request(O + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }), ENV, CTX);
}

const init = await post({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "legacy-session-test", version: "1.0.0" },
  },
});

const initBody = await init.json();
const sid = init.headers.get("mcp-session-id");
t("legacy initialize returns 200", init.status === 200, init.status);
t("legacy initialize returns a non-empty Mcp-Session-Id", typeof sid === "string" && sid.length > 0, sid);
t("initialize echoes negotiated MCP protocol version in response headers",
  init.headers.get("mcp-protocol-version") === "2025-06-18",
  init.headers.get("mcp-protocol-version"));
t("initialize JSON-RPC result is still valid",
  initBody && initBody.result && initBody.result.protocolVersion === "2025-06-18",
  JSON.stringify(initBody));

const sessionHeaders = {
  "mcp-session-id": sid,
  "mcp-protocol-version": "2025-06-18",
};

const ready = await post({
  jsonrpc: "2.0",
  method: "notifications/initialized",
  params: {},
}, sessionHeaders);
t("notifications/initialized on the legacy session is accepted", ready.status === 202, ready.status);
t("202 response keeps the same session id", ready.headers.get("mcp-session-id") === sid, ready.headers.get("mcp-session-id"));

const list = await post({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: {},
}, sessionHeaders);
const listBody = await list.json();
t("tools/list works on the same legacy session", list.status === 200 && Array.isArray(listBody?.result?.tools), JSON.stringify(listBody));
t("tools/list response keeps the same session id", list.headers.get("mcp-session-id") === sid, list.headers.get("mcp-session-id"));

const call = await post({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "get_conditions", arguments: {} },
}, sessionHeaders);
const callBody = await call.json();
t("tools/call works on the same legacy session",
  call.status === 200 && callBody?.result && callBody.result.isError !== true,
  JSON.stringify(callBody));
t("tools/call response keeps the same session id", call.headers.get("mcp-session-id") === sid, call.headers.get("mcp-session-id"));

// Newer/stateless callers are still accepted without any sticky session header.
const stateless = await post({
  jsonrpc: "2.0",
  id: 4,
  method: "tools/list",
  params: {},
});
const statelessBody = await stateless.json();
t("stateless tools/list still works", stateless.status === 200 && Array.isArray(statelessBody?.result?.tools), JSON.stringify(statelessBody));
t("stateless tools/list does not invent a session id", stateless.headers.get("mcp-session-id") === null, stateless.headers.get("mcp-session-id"));

const closed = await worker.fetch(new Request(O + "/mcp", {
  method: "DELETE",
  headers: { "mcp-session-id": sid },
}), ENV, CTX);
t("legacy compatibility session can be closed with DELETE", closed.status === 204, closed.status);
t("DELETE echoes the closed session id", closed.headers.get("mcp-session-id") === sid, closed.headers.get("mcp-session-id"));

console.log("");
console.log("=== " + pass + " / " + (pass + fail) + (fail ? " 不合格あり" : " 合格") + " (legacy MCP session compatibility) ===");
process.exit(fail ? 1 : 0);
