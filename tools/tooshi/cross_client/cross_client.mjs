// cross_client.mjs: TOOSHI check 10 (cross_client), the measuring half. The official MCP TypeScript SDK client
// (@modelcontextprotocol/sdk, the version pinned in package.json and package-lock.json) sends initialize and tools/list
// to the gate's own endpoint and to three endpoints of the gate's public register drawn for the UTC day, and the gate
// is asked for its own mcp_endpoint verdict on the same endpoints at the same time (POST /check). It writes both
// answers to one file (tooshi-cross-client-v0); tools/tooshi/tooshi_daily.py --cross <file> compares them.
//
//   cd tools/tooshi/cross_client && npm ci --ignore-scripts && node cross_client.mjs --out ../../../tooshi_cross.json [--day 2026-11-07]
//
// Nothing is called before the gate's GET /health says 0.4.24 or later: up to 0.4.22 the gate's MCP calls sent no
// Accept header, read no text/event-stream answer, sent no capabilities or clientInfo and kept no session, so the two
// sides would disagree by construction. Then the file says skipped, and check 10 stays not_yet.
// No tool on any server is called (tools/list only), no secret is held, and the draw is reproducible: the register's
// endpoints that are not the gate operator's own (tier other than self, host outside its zones), sorted, and for i = 0,
// 1, 2 the one at index int(sha256("tooshi-cross-client-v0|<day>|<i>"), 16) mod (the count left) is taken out.
// The SDK's answer is "pass" when initialize and tools/list both return results and tools/list has at least one tool
// with a non-empty string name and an inputSchema object and no name twice (the gate's rule, 0.2.2). An endpoint the
// SDK cannot reach at all (no connection, no TLS, no answer within the time) is "not reached", never pass or fail.
import { createHash } from "node:crypto";
import { writeFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export const SCHEMA = "tooshi-cross-client-v0";
export const SDK = { name: "@modelcontextprotocol/sdk", version: "1.32.1" };
export const GATE = "https://gate.horizonshield.dev";
export const OWN = "https://mcp.horizonshield.dev/mcp";
export const MIN_GATE = [0, 4, 24];
export const SEED = "tooshi-cross-client-v0";
export const PICK = 3;
export const OWN_ZONES = ["horizonshield.dev", "the-horizons-innovation.com", "oga-surf-project.workers.dev"];
const UA = "tooshi-cross-client/0.1";
const SDK_WAIT_MS = 20000, GATE_WAIT_MS = 90000, PAGES = 5;

export function versionAtLeast(v, min) {
  if (typeof v !== "string" || !/^\d+\.\d+\.\d+$/.test(v)) return null;
  const a = v.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== min[i]) return a[i] > min[i];
  return true;
}

export function ownZone(endpoint) {
  let h;
  try { h = new URL(endpoint).hostname.toLowerCase(); } catch { return true; }
  return OWN_ZONES.some((z) => h === z || h.endsWith("." + z));
}

export function candidates(register) {
  const rows = register && Array.isArray(register.rows) ? register.rows : [];
  const out = new Set();
  for (const r of rows) if (r && typeof r.endpoint === "string" && /^https:\/\//.test(r.endpoint) && r.tier !== "self" && !ownZone(r.endpoint)) out.add(r.endpoint);
  return [...out].sort();
}

export function draw(day, list, k = PICK) {
  const left = [...list].sort(), out = [];
  for (let i = 0; i < k && left.length; i++) {
    const h = createHash("sha256").update(SEED + "|" + day + "|" + i, "utf8").digest("hex");
    out.push(left.splice(Number(BigInt("0x" + h) % BigInt(left.length)), 1)[0]);
  }
  return out;
}

function timed(doFetch, ms) {
  return (url, init = {}) => {
    const t = AbortSignal.timeout(ms);
    return doFetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, t]) : t });
  };
}

function short(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").slice(0, 160);
}

// what the SDK saw: {reached: false, error} when nothing answered; else {reached: true, pass, reason, tools}
export function classify(e) {
  if (e instanceof StreamableHTTPError) {
    if (e.code > 0) return { reached: true, pass: false, reason: "http " + e.code };
    return { reached: true, pass: false, reason: short(e.message) };
  }
  if (e instanceof McpError) {
    if (e.code === ErrorCode.RequestTimeout) return { reached: false, error: "no answer within " + SDK_WAIT_MS / 1000 + " s" };
    return { reached: true, pass: false, reason: "json-rpc error " + e.code + ": " + short(e.message) };
  }
  const name = e && e.name, msg = short(e && e.message);
  if (name === "AbortError" || name === "TimeoutError") return { reached: false, error: "no answer within " + SDK_WAIT_MS / 1000 + " s" };
  if (name === "TypeError" && /fetch failed/i.test(msg)) {
    const c = e.cause && (e.cause.code || e.cause.name);
    return { reached: false, error: "not reached: " + short(c || msg) };
  }
  if (name === "ZodError" || /invalid_type|Invalid input|expected/i.test(msg)) return { reached: true, pass: false, reason: "an answer did not have the MCP shape: " + msg };
  return { reached: true, pass: false, reason: msg || String(name || "error") };
}

export async function probe(endpoint, doFetch = fetch) {
  const client = new Client({ name: "tooshi-cross-client", version: "0.1" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), { fetch: timed(doFetch, SDK_WAIT_MS), reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 } });
  transport.onerror = () => {};
  let out;
  try {
    await client.connect(transport, { timeout: SDK_WAIT_MS });
    const tools = [];
    let cursor;
    for (let p = 0; p < PAGES; p++) {
      const r = await client.listTools(cursor ? { cursor } : undefined, { timeout: SDK_WAIT_MS });
      tools.push(...(Array.isArray(r.tools) ? r.tools : []));
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    const good = tools.filter((t) => t && typeof t.name === "string" && t.name.length > 0 && t.inputSchema && typeof t.inputSchema === "object" && !Array.isArray(t.inputSchema));
    const names = good.map((t) => t.name);
    if (new Set(names).size !== names.length) out = { reached: true, pass: false, reason: "tools/list names a tool twice", tools: good.length };
    else if (!good.length) out = { reached: true, pass: false, reason: "tools/list has no well-formed tool", tools: 0 };
    else out = { reached: true, pass: true, reason: "initialize and tools/list answered; " + good.length + " well-formed tool(s)", tools: good.length };
  } catch (e) {
    out = classify(e);
  }
  try { await transport.terminateSession(); } catch { /* closing is not part of the answer */ }
  try { await client.close(); } catch { /* idem */ }
  return out;
}

async function getJson(doFetch, url, ms) {
  const r = await timed(doFetch, ms)(url, { headers: { accept: "application/json", "user-agent": UA, "x-hs-requester": "operator" } });
  if (r.status !== 200) throw new Error(url + " answered http " + r.status);
  return r.json();
}

export async function gateVerdict(endpoint, gate, doFetch = fetch) {
  try {
    const r = await timed(doFetch, GATE_WAIT_MS)(gate + "/check", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "user-agent": UA, "x-hs-requester": "operator" }, body: JSON.stringify({ endpoint }) });
    const j = await r.json().catch(() => null);
    const m = j && j.checks && j.checks.mcp_endpoint;
    if (r.status !== 200 || !m || typeof m.pass !== "boolean") return { answered: false, error: "POST /check answered http " + r.status + (j && j.error ? " " + short(j.error) : "") };
    return { answered: true, pass: m.pass, reason: short(m.reason), record_sha256: typeof j.record_sha256 === "string" ? j.record_sha256 : null };
  } catch (e) {
    return { answered: false, error: "POST /check: " + short((e && e.name) + " " + (e && e.message)) };
  }
}

export async function run({ day, gate = GATE, doFetch = fetch, now = () => new Date() }) {
  const out = { schema: SCHEMA, day, sdk: SDK, gate: { origin: gate, version: null, commit: null }, skipped: null, own: OWN, candidates: [], picked: [], targets: [], started_at: now().toISOString() };
  let h;
  try { h = await getJson(doFetch, gate + "/health", 30000); } catch (e) { out.skipped = "gate_unreadable"; out.why = short(e && e.message); return out; }
  out.gate.version = typeof h.gate_version === "string" ? h.gate_version : null;
  out.gate.commit = typeof h.gate_commit === "string" ? h.gate_commit : null;
  const ge = versionAtLeast(out.gate.version, MIN_GATE);
  if (ge !== true) { out.skipped = "gate_before_0_4_24"; out.why = "the gate's /health says " + out.gate.version + "; nothing is called before 0.4.24"; return out; }
  let reg;
  try { reg = await getJson(doFetch, gate + "/register", 60000); } catch (e) { out.skipped = "register_unreadable"; out.why = short(e && e.message); return out; }
  out.candidates = candidates(reg);
  out.picked = draw(day, out.candidates);
  for (const [kind, ep] of [["own", OWN], ...out.picked.map((x) => ["drawn", x])]) {
    const [g, s] = await Promise.all([gateVerdict(ep, gate, doFetch), probe(ep, doFetch)]);
    out.targets.push({ endpoint: ep, kind, gate: g, sdk: s });
  }
  out.ended_at = now().toISOString();
  return out;
}

async function main(argv) {
  const a = { day: new Date().toISOString().slice(0, 10), out: null, gate: GATE };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--day" && /^\d{4}-\d{2}-\d{2}$/.test(v || "")) a.day = v;
    else if (k === "--out" && v) a.out = v;
    else if (k === "--gate" && /^https:\/\//.test(v || "")) a.gate = v.replace(/\/+$/, "");
    else { console.log("usage: node cross_client.mjs --out FILE [--day YYYY-MM-DD] [--gate https://...]"); return 2; }
  }
  if (!a.out) { console.log("usage: node cross_client.mjs --out FILE [--day YYYY-MM-DD]"); return 2; }
  const r = await run({ day: a.day, gate: a.gate });
  writeFileSync(a.out, JSON.stringify(r) + "\n");
  if (r.skipped) console.log("CROSS_CLIENT " + a.day + " skipped " + r.skipped + ": " + (r.why || ""));
  for (const t of r.targets) console.log("CROSS_CLIENT " + t.kind + " " + t.endpoint + " gate " + (t.gate.answered ? (t.gate.pass ? "pass" : "fail") : "no answer") + " sdk " + (t.sdk.reached ? (t.sdk.pass ? "pass" : "fail") : "not reached"));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.log("cross_client failed: " + (e && e.stack || e)); process.exit(2); });
}
