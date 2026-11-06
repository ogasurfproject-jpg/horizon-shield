// mcp_client_conformance (0.4.24, 2026-11-06): the gate calls an MCP endpoint the way the Streamable HTTP transport says.
//
// Why. Until 0.4.22 the gate sent Accept: application/json only, read every answer as JSON, sent initialize with
// protocolVersion only, carried no Mcp-Session-Id, and sent neither notifications/initialized nor MCP-Protocol-Version.
// Servers that follow the transport answered 406, answered in text/event-stream, rejected the initialize params, or
// answered 400 for the missing session, and the gate wrote "MCP endpoint did not pass" for them. Found by our own checks.
//
// Section 1 is four hostile servers, each strict on one point of the transport. Against the 0.4.22 caller each of them
// fails condition mcp_endpoint; against 0.4.24 each passes. Section 2 holds the limits: an event stream that never sends
// the answer (time) or sends too much (size) is "could not read to the end", never a pass. Section 3 holds what must not
// move: the verdict line (a server that still answers 406 to the right Accept fails, and the reason says how the gate
// called), the version the server returns is followed, notifications/initialized and the close never touch the verdict,
// the session value is never written into the record, the record still recomputes, and the relay path sends no DELETE.
//
// Offline: globalThis.fetch is replaced; *.redteam.invalid and the relay host are answered here and nothing else is fetched.
// Run: node test/mcp_client_conformance.test.mjs   (in workers/hs-verify-gate)
import worker from "../src/worker.js";

const HOST = (n) => "https://" + n + ".redteam.invalid";
const ENV = { RELAY_URL: "https://relay.redteam.invalid", GATE_COMMIT: "mcp-client-local" };
const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const enc = new TextEncoder();
const jres = (obj, status, headers) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json", ...(headers || {}) } });
const TOOL = (name) => ({ name, description: "tool " + name, inputSchema: { type: "object", properties: {} } });
const CARD = { name: "Client Conformance Agent", description: "a strict mock", url: "",
  compensation: { paid_by: "public", referral_fee: false, listing_fee: false, success_fee_pct: 0, disclosure_url: "https://example.invalid/disclosure" } };
const SESSION = "sess-7f3a9c-do-not-record";

// An event stream that can hold its end open. parts: strings to send in order; open: keep the stream open after them.
function sse(parts, open, headers) {
  let ctl;
  const body = new ReadableStream({
    start(c) { ctl = c; for (const p of parts) c.enqueue(enc.encode(p)); if (!open) c.close(); },
    cancel() { if (sseCancelled) sseCancelled.n += 1; }
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...(headers || {}) } });
}
let sseCancelled = { n: 0 };
const ev = (obj, id) => (id ? "id: " + id + "\n" : "") + "event: message\ndata: " + JSON.stringify(obj) + "\n\n";

// A strict server. cfg: { needAccept, sseOnly, needSession, needParams, version, initializedStatus, deleteThrows, sseOpen,
// sseFlood, sseNever, alwaysStatus }. seen collects what the server was sent.
function strict(cfg) {
  const seen = { calls: [], deletes: 0, initialized: 0, versions: [], sessions: [], accepts: [] };
  const handler = async (url, init) => {
    const u = new URL(url);
    const method = (init && init.method) || "GET";
    const h = new Headers((init && init.headers) || {});
    if (u.pathname === "/.well-known/agent-card.json") return jres(CARD);
    if (u.pathname === "/.well-known/mcp-conduct.json") return jres({ allow_tool_call: true });
    if (u.pathname !== "/mcp") return new Response("not found", { status: 404 });
    seen.accepts.push(h.get("accept"));
    if (method === "DELETE") {
      seen.deletes += 1;
      if (cfg.deleteThrows) throw new Error("fetch failed: connection reset");
      return new Response(null, { status: h.get("mcp-session-id") === SESSION ? 204 : 404 });
    }
    if (method !== "POST") return new Response("", { status: 405 });
    const body = JSON.parse(init.body);
    seen.calls.push(body.method);
    seen.versions.push(h.get("mcp-protocol-version"));
    seen.sessions.push(h.get("mcp-session-id"));
    if (cfg.alwaysStatus) return new Response("<html>no</html>", { status: cfg.alwaysStatus, headers: { "content-type": "text/html" } });
    const acc = String(h.get("accept") || "");
    if (cfg.needAccept && !(acc.includes("application/json") && acc.includes("text/event-stream"))) {
      return jres({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Not Acceptable: Client must accept both application/json and text/event-stream" } }, 406);
    }
    if (cfg.needSession && body.method !== "initialize" && h.get("mcp-session-id") !== SESSION) {
      return jres({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Bad Request: No valid session ID provided" } }, 400);
    }
    if (body.method === "notifications/initialized") {
      seen.initialized += 1;
      return new Response(null, { status: cfg.initializedStatus || 202 });
    }
    const id = body.id;
    let msg;
    if (body.method === "initialize") {
      const p = body.params || {};
      if (cfg.needParams && (!p.capabilities || typeof p.capabilities !== "object" || !p.clientInfo || typeof p.clientInfo.name !== "string" || typeof p.clientInfo.version !== "string")) {
        msg = { jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid request parameters", data: [{ code: "invalid_type", expected: "object", path: ["params", "capabilities"] }] } };
      } else {
        msg = { jsonrpc: "2.0", id, result: { protocolVersion: cfg.version || p.protocolVersion, serverInfo: { name: "strict", version: "1" }, capabilities: { tools: {} } } };
      }
    } else if (body.method === "tools/list") {
      msg = { jsonrpc: "2.0", id, result: { tools: [TOOL("alpha"), TOOL("beta")] } };
    } else if (body.method === "tools/call") {
      msg = { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "constant answer" }] } };
    } else {
      msg = { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } };
    }
    const sh = body.method === "initialize" && cfg.needSession ? { "mcp-session-id": SESSION } : {};
    if (cfg.sseFlood && body.method === "initialize") {
      const pad = "x".repeat(65536);
      const parts = [];
      for (let i = 0; i < 40; i++) parts.push(ev({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: pad } }));
      parts.push(ev(msg));
      return sse(parts, false, sh);
    }
    if (cfg.sseNever && body.method === "initialize") return sse([": ping\n\n", ev({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } })], true, sh);
    if (cfg.sseOnly) {
      // a notification and a comment before the answer, the answer split across two chunks, and the stream left open
      const t = ev(msg, "e1");
      return sse([": keepalive\n\n", ev({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: "starting" } }), t.slice(0, 17), t.slice(17)], !!cfg.sseOpen, sh);
    }
    return jres(msg, 200, sh);
  };
  return { handler, seen };
}

const ROUTES = new Map();
const RELAYED = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  const u = new URL(url);
  if (u.hostname === "relay.redteam.invalid") {
    const b = JSON.parse(init.body);
    RELAYED.push({ method: b.method, url: b.url, headers: b.headers || {} });
    const srv = ROUTES.get(new URL(b.url).hostname);
    if (!srv) return jres({ relayed: false, error: "target_fetch_failed", message: "no route" }, 502);
    const r = await srv.handler(b.url, { method: b.method, headers: b.headers, body: b.body });
    return jres({ relayed: true, status: r.status, headers: { "content-type": r.headers.get("content-type") || "" }, body: await r.text() });
  }
  const srv = ROUTES.get(u.hostname);
  if (!srv) throw new Error("fetch failed: the harness refuses network (" + u.hostname + ")");
  return await srv.handler(url, init || {});
};

// Each check is bounded here, so a caller that waits forever on an open stream (the 0.4.22 caller does) fails the case
// instead of hanging the suite.
async function check(endpoint, env) {
  let timer;
  const run = (async () => {
    const res = await worker.fetch(new Request("https://gate.horizonshield.dev/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint }) }), env || ENV, CTX);
    return await res.json();
  })();
  const out = await Promise.race([run, new Promise((r) => { timer = setTimeout(() => r({ status: "(the check did not finish in 40 s)", checks: { mcp_endpoint: { pass: false, reason: "the check did not finish in 40 s" } } }), 40000); })]);
  clearTimeout(timer);
  return out;
}
async function recompute(r) {
  const o = JSON.parse(JSON.stringify(r)); delete o.record_sha256; delete o.recompute_note;
  const d = await crypto.subtle.digest("SHA-256", enc.encode(JSON.stringify(o)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const R = [];
function t(kind, name, ok, extra) { R.push({ kind, name, ok: !!ok }); console.log((ok ? "  ok   " : "  NG   ") + "[" + kind + "] " + name + (ok ? "" : "   " + (extra || ""))); }
const mcpOf = (r) => (r && r.checks && r.checks.mcp_endpoint) || {};
const reasonOf = (r) => String(mcpOf(r).reason || "");
const cl = (r) => (mcpOf(r).detail && mcpOf(r).detail.client) || {};

// ---- 1. four hostile servers: each strict on one point ----
const HOSTILE = [
  ["accept_406: 406 unless Accept names both application/json and text/event-stream", "h-accept", { needAccept: true }],
  ["sse_only: answers only in text/event-stream (a comment and a notification first, the answer split across chunks, the stream left open)", "h-sse", { sseOnly: true, sseOpen: true }],
  ["session_400: initialize issues Mcp-Session-Id, and every later request without it is 400", "h-session", { needSession: true }],
  ["params_error: initialize without capabilities or clientInfo is a JSON-RPC error", "h-params", { needParams: true }],
];
for (const [label, host, cfg] of HOSTILE) {
  const s = strict(cfg); ROUTES.set(host + ".redteam.invalid", s);
  const r = await check(HOST(host) + "/mcp");
  const m = mcpOf(r);
  t("hostile", label + ": mcp_endpoint passes", m.pass === true, reasonOf(r).slice(0, 220));
  t("hostile", label + ": the verdict is verified (consent by well-known, determinism measured in the same session)", r.status === "verified", r.status + " " + JSON.stringify((r.checks && r.checks.determinism && r.checks.determinism.reason) || "").slice(0, 160));
  if (host === "h-session") {
    t("hostile", "session_400: every request after initialize carried the issued session", s.seen.sessions.slice(1).length > 0 && s.seen.sessions.slice(1).every((x) => x === SESSION), JSON.stringify(s.seen.sessions));
    t("hostile", "session_400: the session was closed with DELETE once, and the record says carried and 204", s.seen.deletes === 1 && m.detail && m.detail.client && m.detail.client.session === "carried" && m.detail.client.session_closed === 204, JSON.stringify(m.detail && m.detail.client));
  }
  if (host === "h-sse") {
    t("hostile", "sse_only: the record names the answer forms as sse", m.detail && m.detail.client && m.detail.client.response_forms.every((x) => /: sse$/.test(x)), JSON.stringify(m.detail && m.detail.client && m.detail.client.response_forms));
  }
}
const sAll = strict({ needAccept: true, needSession: true, needParams: true, sseOnly: true });
ROUTES.set("h-all.redteam.invalid", sAll);
{
  const r = await check(HOST("h-all") + "/mcp");
  t("hostile", "all four at once: verified", r.status === "verified" && mcpOf(r).pass === true, reasonOf(r).slice(0, 220));
  t("hostile", "all four at once: notifications/initialized was sent once, after initialize and before tools/list", sAll.seen.initialized === 1 && sAll.seen.calls[0] === "initialize" && sAll.seen.calls[1] === "notifications/initialized" && sAll.seen.calls[2] === "tools/list", JSON.stringify(sAll.seen.calls));
  t("hostile", "all four at once: every request carried Accept with both types", sAll.seen.accepts.every((a) => a === "application/json, text/event-stream"), JSON.stringify(sAll.seen.accepts));
  t("hostile", "all four at once: MCP-Protocol-Version 2025-11-25 on every request after initialize, none on initialize", sAll.seen.versions[0] === null && sAll.seen.versions.length > 2 && sAll.seen.versions.slice(1).every((v) => v === "2025-11-25"), JSON.stringify(sAll.seen.versions));
}

// ---- 2. limits: never a pass ----
{
  ROUTES.set("l-never.redteam.invalid", strict({ sseNever: true }));
  sseCancelled = { n: 0 };
  const t0 = Date.now();
  const r = await check(HOST("l-never") + "/mcp");
  const secs = (Date.now() - t0) / 1000;
  t("limit", "an event stream that never sends the answer: could not read to the end, not a pass, not held", mcpOf(r).pass === false && /could not read to the end/.test(reasonOf(r)) && /time limit/.test(reasonOf(r)) && r.status === "pending" && r.reachable === true, reasonOf(r).slice(0, 220) + " status " + r.status);
  t("limit", "an event stream that never sends the answer: stopped within the request time limit and the stream was cancelled", secs < 25 && sseCancelled.n >= 1, secs + "s cancelled " + sseCancelled.n);
}
{
  ROUTES.set("l-flood.redteam.invalid", strict({ sseFlood: true }));
  const r = await check(HOST("l-flood") + "/mcp");
  t("limit", "an event stream past 2 MiB before the answer: could not read to the end (size), not a pass", mcpOf(r).pass === false && /could not read to the end/.test(reasonOf(r)) && /size limit/.test(reasonOf(r)) && r.status !== "verified", reasonOf(r).slice(0, 220));
}

// ---- 3. what must not move ----
{
  // the verdict line: right Accept, still 406
  ROUTES.set("v-406.redteam.invalid", strict({ alwaysStatus: 406 }));
  const r = await check(HOST("v-406") + "/mcp");
  t("control", "a server that answers 406 to the right Accept still fails mcp_endpoint (pending, reachable)", mcpOf(r).pass === false && r.status === "pending" && r.reachable === true && /http 406/.test(reasonOf(r)), reasonOf(r));
  t("control", "the reason says how the gate called (Accept, version offered, session)", /the gate called with Accept: application\/json, text\/event-stream; protocolVersion offered 2025-11-25/.test(reasonOf(r)) && /Mcp-Session-Id/.test(reasonOf(r)), reasonOf(r));
}
{
  const s = strict({ version: "2025-06-18" }); ROUTES.set("v-follow.redteam.invalid", s);
  const r = await check(HOST("v-follow") + "/mcp");
  const c = mcpOf(r).detail && mcpOf(r).detail.client;
  t("control", "the version the server returns is followed: MCP-Protocol-Version 2025-06-18 after initialize", r.status === "verified" && s.seen.versions.length > 2 && s.seen.versions.slice(1).every((v) => v === "2025-06-18") && c && c.protocol_version_in_use === "2025-06-18" && c.protocol_version_offered === "2025-11-25", JSON.stringify(s.seen.versions));
}
{
  const s = strict({ version: "1999-01-01" }); ROUTES.set("v-unknown.redteam.invalid", s);
  const r = await check(HOST("v-unknown") + "/mcp");
  const c = mcpOf(r).detail && mcpOf(r).detail.client;
  t("control", "a version the gate does not speak: no MCP-Protocol-Version header, the verdict line unchanged (verified)", r.status === "verified" && s.seen.versions.every((v) => v === null) && c && c.protocol_version_in_use === null && c.protocol_version_returned === "1999-01-01", JSON.stringify(s.seen.versions) + " " + r.status);
}
{
  ROUTES.set("v-init500.redteam.invalid", strict({ initializedStatus: 500 }));
  const r = await check(HOST("v-init500") + "/mcp");
  t("control", "notifications/initialized answered 500: recorded, the verdict unchanged (verified)", r.status === "verified" && cl(r).initialized_notification === 500, JSON.stringify(mcpOf(r).detail && mcpOf(r).detail.client));
}
{
  const s = strict({ needSession: true, deleteThrows: true }); ROUTES.set("v-delfail.redteam.invalid", s);
  const r = await check(HOST("v-delfail") + "/mcp");
  const raw = JSON.stringify(r);
  t("control", "the close fails: recorded as not answered, the verdict unchanged (verified)", r.status === "verified" && s.seen.deletes === 1 && /^not answered/.test(String(cl(r).session_closed)), JSON.stringify(mcpOf(r).detail && mcpOf(r).detail.client));
  t("control", "the session value is never written into the record", raw.indexOf(SESSION) < 0, "found in the record");
  t("control", "the record still recomputes (record_sha256 recipe unchanged)", (await recompute(r)) === r.record_sha256, "recompute differs");
  t("control", "the record carries detail.client with the closed shape", JSON.stringify(Object.keys(cl(r))) === JSON.stringify(["since", "accept", "client_info", "protocol_version_offered", "protocol_version_returned", "protocol_version_in_use", "session", "initialized_notification", "session_closed", "response_forms"]) && cl(r).client_info.name === "hs-verify-gate", JSON.stringify(Object.keys(cl(r))));
}
{
  // the relay path (the gate's own zone over HTTP): the relay carries GET and POST only, so no DELETE is ever sent through it
  const s = strict({ needSession: false, sseOnly: true }); ROUTES.set("own.horizonshield.dev", s);
  RELAYED.length = 0;
  const r = await check("https://own.horizonshield.dev/mcp", { ...ENV, RELAY_TOKEN: "relay-token-local" });
  t("control", "relay path: measured through the relay, the event stream read, verified", r.status === "verified" && /^relay/.test(String(r.probed_via)), r.status + " " + reasonOf(r).slice(0, 160));
  t("control", "relay path: no DELETE and no GET to the MCP endpoint through the relay", RELAYED.filter((x) => /\/mcp$/.test(x.url)).every((x) => x.method === "POST") && s.seen.deletes === 0, JSON.stringify(RELAYED.map((x) => x.method + " " + x.url)));
  t("control", "relay path: the relay was asked with Accept for both types", RELAYED.filter((x) => /\/mcp$/.test(x.url)).every((x) => x.headers.accept === "application/json, text/event-stream"), JSON.stringify(RELAYED.map((x) => x.headers.accept)));
}
{
  const spec = await (await worker.fetch(new Request("https://gate.horizonshield.dev/spec"), ENV, CTX)).json();
  const m = spec.mcp_client || {};
  t("control", "/spec carries mcp_client with the versions, the limits and the correction", m.since && /0\.4\.24/.test(m.since) && Array.isArray(m.protocol_versions) && m.protocol_versions[0] === "2025-11-25" && /could not read to the end/.test(m.event_stream || "") && /found by our own checks/.test(m.correction || ""), JSON.stringify(Object.keys(m)));
}

const passed = R.filter((x) => x.ok).length;
for (const k of ["hostile", "limit", "control"]) { const a = R.filter((x) => x.kind === k); console.log("  " + k.padEnd(8) + a.filter((x) => x.ok).length + " / " + a.length); }
if (passed !== R.length) {
  console.log("FAIL " + (R.length - passed) + " of " + R.length + " (mcp client conformance)");
  process.exit(1);
}
console.log("=== " + passed + " / " + R.length + " 合格 (mcp client conformance、扉 0.4.24) ===");
process.exit(0);
