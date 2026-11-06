// cross_client_test.mjs: check 10's measuring half against stand-in servers, offline. Each server is a fetch function
// (no socket is opened), and the real SDK client (the pinned @modelcontextprotocol/sdk) talks to it.
//   cd tools/tooshi/cross_client && npm ci --ignore-scripts && node cross_client_test.mjs
// Last line: "PASS n/n (cross_client: the pinned MCP SDK client against stand-in servers, offline)".
import { probe, draw, candidates, versionAtLeast, run, OWN, GATE, SDK } from "./cross_client.mjs";
import { readFileSync } from "node:fs";

let n = 0, bad = 0;
const ok = (got, want, label) => { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) console.log("ok   " + label); else { bad++; console.log("NG   " + label + " (got " + g + ", want " + w + ")"); } };
const TOOLS = [{ name: "a", inputSchema: { type: "object" } }, { name: "b", description: "x", inputSchema: { type: "object", properties: {} } }];

// a stand-in Streamable HTTP server: opts say what it requires and how it answers
function server(opts = {}) {
  const seen = { posts: 0, sessionOnLater: true, accept: [] };
  const fetchFn = async (url, init = {}) => {
    const hd = new Headers(init.headers || {});
    if (init.method === "GET") return new Response(null, { status: 405 });
    if (init.method === "DELETE") return new Response(null, { status: 200 });
    if (opts.down) { const e = new TypeError("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e; }
    if (opts.status) return new Response("no", { status: opts.status });
    seen.posts++;
    seen.accept.push(hd.get("accept"));
    const acc = hd.get("accept") || "";
    if (opts.needAccept && !(acc.includes("application/json") && acc.includes("text/event-stream"))) return new Response("not acceptable", { status: 406 });
    const m = JSON.parse(init.body);
    if (m.method === "initialize") {
      if (opts.needInitParams && !(m.params && m.params.capabilities && m.params.clientInfo)) return Response.json({ jsonrpc: "2.0", id: m.id, error: { code: -32602, message: "Invalid request parameters" } });
      const h = opts.session ? { "mcp-session-id": "s-1" } : {};
      return answerWith(m.id, { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "stand-in", version: "1" } }, h);
    }
    if (opts.session && hd.get("mcp-session-id") !== "s-1") { seen.sessionOnLater = false; return new Response("no session", { status: 400 }); }
    if (!("id" in m)) return new Response(null, { status: 202 });
    if (m.method === "tools/list") {
      if (opts.listError) return Response.json({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } });
      const tools = opts.tools || TOOLS;
      if (opts.paged && !(m.params && m.params.cursor)) return answerWith(m.id, { tools: tools.slice(0, 1), nextCursor: "p2" });
      if (opts.paged) return answerWith(m.id, { tools: tools.slice(1) });
      return answerWith(m.id, { tools });
    }
    return Response.json({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "no" } });
  };
  function answerWith(id, result, h = {}) {
    const body = { jsonrpc: "2.0", id, result };
    if (opts.sse) return new Response("event: message\ndata: " + JSON.stringify(body) + "\n\n", { status: 200, headers: { "content-type": "text/event-stream", ...h } });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...h } });
  }
  return { fetchFn, seen };
}

const E = "https://example.test/mcp";
let s = server(); let r = await probe(E, s.fetchFn);
ok([r.reached, r.pass, r.tools], [true, true, 2], "a JSON server: initialize and tools/list answered, 2 tools: pass");
ok(s.seen.accept[0], "application/json, text/event-stream", "the SDK sends Accept with application/json and text/event-stream");
s = server({ sse: true }); r = await probe(E, s.fetchFn);
ok([r.reached, r.pass], [true, true], "a server that answers only in text/event-stream: pass");
s = server({ needAccept: true }); r = await probe(E, s.fetchFn);
ok([r.reached, r.pass], [true, true], "a server that answers 406 without both Accept types: pass (the SDK sends both)");
s = server({ needInitParams: true }); r = await probe(E, s.fetchFn);
ok([r.reached, r.pass], [true, true], "a server that refuses initialize without capabilities and clientInfo: pass (the SDK sends them)");
s = server({ session: true }); r = await probe(E, s.fetchFn);
ok([r.reached, r.pass, s.seen.sessionOnLater], [true, true, true], "a server that answers 400 without its Mcp-Session-Id: pass (the SDK carries it)");
s = server({ paged: true }); r = await probe(E, s.fetchFn);
ok([r.pass, r.tools], [true, 2], "tools/list in two pages (nextCursor): both read");
s = server({ status: 406 }); r = await probe(E, s.fetchFn);
ok([r.reached, r.pass, r.reason], [true, false, "http 406"], "a server that always answers 406: reached, fail, http 406");
s = server({ status: 401 }); r = await probe(E, s.fetchFn);
ok([r.reached, r.pass, r.reason], [true, false, "http 401"], "a server that asks for a key (401): reached, fail");
s = server({ tools: [] }); r = await probe(E, s.fetchFn);
ok([r.reached, r.pass], [true, false], "tools/list with no tool: fail");
s = server({ tools: [{ name: "a", inputSchema: { type: "object" } }, { name: "a", inputSchema: { type: "object" } }] }); r = await probe(E, s.fetchFn);
ok([r.reached, r.pass, r.reason], [true, false, "tools/list names a tool twice"], "a tool name twice: fail");
s = server({ listError: true }); r = await probe(E, s.fetchFn);
ok([r.reached, r.pass, /json-rpc error -32601/.test(r.reason)], [true, false, true], "tools/list answered with a JSON-RPC error: fail");
s = server({ down: true }); r = await probe(E, s.fetchFn);
ok([r.reached, /ECONNREFUSED/.test(r.error)], [false, true], "no connection: not reached (never pass or fail)");

// the draw: the same list and day give the same three, in Python too (tooshi_daily.py cross_draw, the vector below)
const L = ["https://a.example/mcp", "https://b.example/mcp", "https://c.example/mcp", "https://d.example/mcp", "https://e.example/mcp"];
ok(draw("2026-11-07", L), ["https://c.example/mcp", "https://d.example/mcp", "https://e.example/mcp"], "the draw of 2026-11-07 from five endpoints (the vector tooshi_daily.py checks)");
ok(draw("2026-11-07", [...L].reverse()), draw("2026-11-07", L), "the draw does not depend on the order of the register");
ok(draw("2026-11-07", L.slice(0, 2)).length, 2, "fewer than three candidates: all of them");
ok(candidates({ rows: [{ endpoint: "https://x.example/mcp", tier: "free" }, { endpoint: "https://mcp.horizonshield.dev/mcp", tier: "self" }, { endpoint: "https://p9.horizonshield.dev/mcp", tier: "free" }, { endpoint: "https://y.example/mcp", tier: "paid" }, { endpoint: "https://x.example/mcp", tier: "free" }] }),
  ["https://x.example/mcp", "https://y.example/mcp"], "candidates: the register's endpoints outside the operator's zones and not self, once each, sorted");
ok([versionAtLeast("0.4.22", [0, 4, 24]), versionAtLeast("0.4.24", [0, 4, 24]), versionAtLeast("0.5.0", [0, 4, 24]), versionAtLeast("x", [0, 4, 24])], [false, true, true, null], "the gate version gate: 0.4.22 no, 0.4.24 yes, 0.5.0 yes, unreadable null");

// a whole run against a stand-in gate
function gateWorld(version, verdicts) {
  const reg = { rows: [{ endpoint: OWN, tier: "self" }, ...L.map((e) => ({ endpoint: e, tier: "free" }))] };
  const calls = [];
  const srv = server();
  const fetchFn = async (url, init = {}) => {
    const u = String(url);
    calls.push((init.method || "GET") + " " + u);
    if (u === GATE + "/health") return Response.json({ ok: true, gate_version: version, gate_commit: "abc" });
    if (u === GATE + "/register") return Response.json(reg);
    if (u === GATE + "/check") { const ep = JSON.parse(init.body).endpoint; const v = verdicts[ep] ?? true; return Response.json({ record_sha256: "f".repeat(64), checks: { mcp_endpoint: { pass: v, reason: v ? "MCP endpoint responds to initialize and tools/list" : "initialize failed: http 406" } } }); }
    return srv.fetchFn(url, init);
  };
  return { fetchFn, calls };
}
let g = gateWorld("0.4.22", {});
r = await run({ day: "2026-11-07", doFetch: g.fetchFn });
ok([r.skipped, r.targets.length, g.calls.length], ["gate_before_0_4_24", 0, 1], "the gate says 0.4.22: skipped, only /health is read, nothing else is called");
g = gateWorld("0.4.24", { "https://d.example/mcp": false });
r = await run({ day: "2026-11-07", doFetch: g.fetchFn });
ok([r.skipped, r.sdk, r.targets.map((t) => [t.kind, t.endpoint, t.gate.pass, t.sdk.pass])],
  [null, SDK, [["own", OWN, true, true], ["drawn", "https://c.example/mcp", true, true], ["drawn", "https://d.example/mcp", false, true], ["drawn", "https://e.example/mcp", true, true]]],
  "the gate says 0.4.24: the own endpoint and the three drawn, each with the gate's verdict and the SDK's");
ok(g.calls.some((c) => /tools\/call/.test(c)), false, "no tools/call is ever sent");
const src = readFileSync(new URL("./cross_client.mjs", import.meta.url), "utf8");
ok(/"tools\/call"|'tools\/call'|callTool\(/.test(src), false, "the source has no tools/call");
const lock = JSON.parse(readFileSync(new URL("./package-lock.json", import.meta.url), "utf8"));
ok([lock.packages["node_modules/@modelcontextprotocol/sdk"].version, SDK.version], ["1.32.1", "1.32.1"], "the lockfile pins @modelcontextprotocol/sdk 1.32.1, the version the file names");

console.log(bad ? "FAIL " + bad + " of " + n : "PASS " + n + "/" + n + " (cross_client: the pinned MCP SDK client against stand-in servers, offline)");
process.exit(bad ? 1 : 0);
