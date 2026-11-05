// probe_context (0.4.22, 2026-11-05): the context written into probed_via and the sweep's fetch count belong to the call.
//
// Why. Until 0.4.21 the context of a measurement ("http" or "cron") and the sweep's fetch count were module variables
// (GATE_CONTEXT, sweepBudget). Each entry point set GATE_CONTEXT, so an HTTP request served by the same isolate while
// the cron sweep was in the middle of a row turned the rest of that sweep into "(http context)": outside rows were
// written as "direct from the gate worker (http context)" and own-zone rows went through the relay. The fetches of that
// HTTP request were counted in the sweep's budget, and its probe of the gate's own /mcp carried the sweep's mark.
// The other way round, a cron starting while an on-demand /check was running turned the check into "(cron context)".
// 0.4.22 passes the context with each call (pc): the sweep holds its own { via, budget }, and every HTTP entry uses the
// default (http, nothing counted). The rule, the status, the conditions and the record's shape do not change; with
// the default vars the record bytes are those of 0.4.21 apart from the version string.
//
// Offline: *.redteam.invalid never resolves, explorers and the ledger are stubbed to fail (legacy coordinate rule).
// The relay is a stub that forwards a call for the gate's own host back into this worker, as the public edge does.
// Run: node test/probe_context.test.mjs   (in workers/hs-verify-gate)
import worker from "../src/worker.js";

const OP = "op-token-context";
const O = "https://gate.horizonshield.dev";
const GATE_MCP = O + "/mcp";
const MARK = "x-hs-own-sweep";
const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const jres = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
const TOOL = { name: "alpha", description: "redteam tool alpha", inputSchema: { type: "object", properties: {} } };
const CARD = { name: "Redteam Agent", description: "an adversarial mock", url: "",
  compensation: { paid_by: "public", referral_fee: false, listing_fee: false, success_fee_pct: 0, disclosure_url: "https://example.invalid/disclosure" } };
const CRON_TEXT = "direct from the gate worker (cron context)";
const HTTP_TEXT = "direct from the gate worker (http context)";

function kv() {
  const store = new Map();
  return {
    store,
    get: async (key, type) => {
      const v = store.has(key) ? store.get(key) : null;
      return ((type === "json" || (type && type.type === "json")) && v !== null) ? JSON.parse(v) : v;
    },
    put: async (key, v) => { store.set(key, typeof v === "string" ? v : JSON.stringify(v)); },
    delete: async (key) => { store.delete(key); },
    list: async (o) => ({ keys: [...store.keys()].filter((x) => x.startsWith((o && o.prefix) || "")).sort().map((name) => ({ name })), list_complete: true }),
  };
}

// The outside world. A hold on one host's tools/list lets a test run another call in the middle of a measurement.
let hold = null;   // { host, reached, reach(), released, release() }
function makeHold(host) {
  let reach, release;
  const h = { host, reached: new Promise((r) => { reach = r; }), released: new Promise((r) => { release = r; }) };
  h.reach = reach; h.release = release;
  return h;
}
const DIRECT = [];    // hosts fetched directly by the gate
const RELAYED = [];   // what the relay was asked to fetch, with the headers it would forward
let RELAY_ENV = null;
async function relayAnswer(init) {
  const b = JSON.parse(init.body);
  const u = new URL(b.url);
  RELAYED.push({ host: u.hostname, path: u.pathname, headers: Object.assign({}, b.headers || {}) });
  let res;
  if (u.hostname === "gate.horizonshield.dev") {
    // The public edge in front of the gate: the call comes back into the gate as an HTTP request.
    res = await worker.fetch(new Request(b.url, { method: b.method, headers: { ...(b.headers || {}), "cf-connecting-ip": "198.51.100.7" }, body: b.method === "POST" ? b.body : undefined }), RELAY_ENV, CTX);
  } else {
    res = await outside(b.url, { method: b.method, headers: b.headers, body: b.body });
  }
  return jres({ relayed: true, status: res.status, headers: { "content-type": res.headers.get("content-type") || "" }, body: await res.text() });
}
async function outside(url, init) {
  const u = new URL(url);
  if (/\.redteam\.invalid$/.test(u.hostname) || /\.horizonshield\.dev$/.test(u.hostname)) {
    if (u.pathname === "/.well-known/mcp-conduct.json") return jres({ allow_tool_call: true });
    if (u.pathname === "/.well-known/agent-card.json") return jres(CARD);
    if (u.pathname === "/mcp" && (init && init.method) === "POST") {
      const body = JSON.parse(init.body); const id = body.id;
      if (body.method === "initialize") return jres({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "rt", version: "0" }, capabilities: { tools: {} } } });
      if (body.method === "tools/list") {
        if (hold && hold.host === u.hostname) { hold.reach(); await hold.released; }
        return jres({ jsonrpc: "2.0", id, result: { tools: [TOOL] } });
      }
      if (body.method === "tools/call") return jres({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "constant answer" }] } });
      return jres({ jsonrpc: "2.0", id, error: { code: -32601, message: "nope" } });
    }
    return new Response("not found", { status: 404 });
  }
  return new Response("no", { status: 500 });   // explorers, ledger, raw github: fail closed
}
globalThis.fetch = async (url, init) => {
  const u = new URL(typeof url === "string" ? url : url.url);
  if (u.hostname === "relay.redteam.invalid") return relayAnswer(init);
  DIRECT.push(u.hostname);
  return outside(u.href, init);
};

const RELAY_VARS = { RELAY_URL: "https://relay.redteam.invalid/relay", RELAY_TOKEN: "relay-token" };
function freshEnv(extra) {
  const env = Object.assign({ HS_VERIFY_KV: kv(), SWEEP_TOKEN: OP, GATE_COMMIT: "context-local" }, extra || {});
  RELAY_ENV = env;
  const call = (p, init) => worker.fetch(new Request(O + p, init), env, CTX);
  const post = (p, body, headers) => call(p, { method: "POST", headers: { "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) });
  const getj = async (p) => { const r = await call(p); return { status: r.status, j: await r.json() }; };
  const sweep = async (body) => { const r = await post("/sweep", body || {}, { "x-sweep-token": OP }); return { status: r.status, j: await r.json() }; };
  const cron = async () => { const ps = []; await worker.scheduled({ cron: "0 18 * * *" }, env, { waitUntil(p) { ps.push(Promise.resolve(p).catch(() => null)); } }); await Promise.all(ps); };
  const check = async (ep) => (await post("/check", { endpoint: ep })).json();
  const latestRecord = async (ep) => {
    const h = await getj("/history?endpoint=" + encodeURIComponent(ep));
    const e = h.j.entries[h.j.entries.length - 1];
    const r = await call("/record/" + e.record_sha256);
    return { entry: e, rec: JSON.parse(await r.text()) };
  };
  return { env, call, post, getj, sweep, cron, check, latestRecord };
}
const isRelayText = (s) => typeof s === "string" && s.startsWith("relay (");

const R = [];
const t = (kind, name, ok, detail = "") => R.push({ kind, name, ok: !!ok, detail: String(detail).slice(0, 400) });

// ---- 1. an HTTP POST /check in the middle of a cron sweep ---------------------------------------------------
{
  const HELD = "https://held.redteam.invalid/mcp";
  const run = async (concurrent) => {
    const g = freshEnv();
    await g.post("/watch", { endpoint: HELD, tier: "paid" }, { "x-sweep-token": OP });
    hold = makeHold("held.redteam.invalid");
    const cronDone = g.cron();
    await hold.reached;   // the cron sweep is now inside runCheck for HELD, waiting on tools/list
    let check = null;
    if (concurrent) check = await g.check("https://other.redteam.invalid/mcp");
    hold.release();
    await cronDone;
    hold = null;
    const L = await g.latestRecord(HELD);
    const last = await g.getj("/sweep/last");
    return { rec: L.rec, check, used: last.j.subrequests && last.j.subrequests.used };
  };
  const base = await run(false);
  const both = await run(true);
  t("control", "1 baseline: a cron sweep alone writes probed_via (cron context)", base.rec.probed_via === CRON_TEXT, base.rec.probed_via);
  t("attack", "1 an HTTP POST /check served while the cron sweep is in the middle of a row does not change that row's probed_via (still cron context)", both.rec.probed_via === CRON_TEXT, both.rec.probed_via);
  t("control", "1 ... and the on-demand check says http context", both.check && both.check.probed_via === HTTP_TEXT, both.check && both.check.probed_via);
  t("attack", "1 ... and the fetches of the HTTP check are not counted in the sweep's budget (same count as the sweep alone: " + base.used + ")", typeof base.used === "number" && base.used > 0 && both.used === base.used, JSON.stringify([base.used, both.used]));
}

// ---- 2. the other way round: a cron sweep runs while an on-demand /check is in the middle of its measurement ---
{
  const g = freshEnv();
  const ROW = "https://row2.redteam.invalid/mcp";
  await g.post("/watch", { endpoint: ROW, tier: "paid" }, { "x-sweep-token": OP });
  hold = makeHold("held2.redteam.invalid");
  const checkDone = g.check("https://held2.redteam.invalid/mcp");
  await hold.reached;   // the check is inside runCheck, waiting on tools/list
  await g.cron();       // a whole cron sweep runs in the meantime
  hold.release();
  const check = await checkDone;
  hold = null;
  const L = await g.latestRecord(ROW);
  t("attack", "2 a cron sweep that runs while an on-demand /check is measuring does not turn the check into cron context (http context)", check && check.probed_via === HTTP_TEXT, check && check.probed_via);
  t("control", "2 ... and the sweep's own record says cron context", L.rec.probed_via === CRON_TEXT, L.rec.probed_via);
}

// ---- 3. relay configured: the cron sweep measures the gate's own /mcp through the relay, which comes back in over HTTP ----
{
  const g = freshEnv(RELAY_VARS);
  const AFTER = "https://after3.redteam.invalid/mcp";
  await g.post("/watch", { endpoint: AFTER }, {});   // a free row: measured after the self rows
  RELAYED.length = 0; DIRECT.length = 0;
  await g.cron();
  const last = await g.getj("/sweep/last");
  const order = (last.j.results || []).map((r) => r.endpoint);
  const gateAt = order.indexOf(GATE_MCP);
  const later = order.slice(gateAt + 1);
  const recs = {};
  for (const ep of order) recs[ep] = (await g.latestRecord(ep)).rec.probed_via;
  t("control", "3 the cron sweep measured the gate's own /mcp through the relay (the relay's call came back into the gate over HTTP)", gateAt >= 0 && isRelayText(recs[GATE_MCP]) && RELAYED.some((f) => f.host === "gate.horizonshield.dev"), JSON.stringify([gateAt, recs[GATE_MCP]]));
  t("attack", "3 the rows measured after it still say cron context (the HTTP request the relay made does not change the sweep's context)", later.length >= 2 && later.includes(AFTER) && later.every((ep) => recs[ep] === CRON_TEXT), JSON.stringify(later.map((ep) => [ep, recs[ep]])));
  const ownOthers = order.filter((ep) => ep !== GATE_MCP && /\.horizonshield\.dev\//.test(ep));
  t("attack", "3 the other own-zone rows are fetched directly in cron context, never through the relay", ownOthers.length === 8 && ownOthers.every((ep) => recs[ep] === CRON_TEXT) && !RELAYED.some((f) => f.host !== "gate.horizonshield.dev"), JSON.stringify(RELAYED.map((f) => f.host).filter((h) => h !== "gate.horizonshield.dev")));
  const selfCalls = RELAYED.filter((f) => f.host === "gate.horizonshield.dev");
  t("control", "3 the sweep's calls to the gate's own /mcp carry the sweep's mark", selfCalls.length > 0 && selfCalls.every((f) => typeof f.headers[MARK] === "string" && f.headers[MARK].startsWith("v1.")), selfCalls.length);
}

// ---- 4. relay configured: an HTTP /check of the gate's own /mcp in the middle of a cron sweep -----------------
{
  const g = freshEnv(RELAY_VARS);
  const HELD = "https://held4.redteam.invalid/mcp";
  await g.post("/watch", { endpoint: HELD, tier: "paid" }, { "x-sweep-token": OP });
  hold = makeHold("held4.redteam.invalid");
  const cronDone = g.cron();
  await hold.reached;
  RELAYED.length = 0;
  const check = await g.check(GATE_MCP);
  const duringCheck = RELAYED.filter((f) => f.host === "gate.horizonshield.dev").slice();
  hold.release();
  await cronDone;
  hold = null;
  const L = await g.latestRecord(HELD);
  t("control", "4 the on-demand check of the gate's own /mcp goes through the relay", isRelayText(check && check.probed_via) && duringCheck.length > 0, JSON.stringify([check && check.probed_via, duringCheck.length]));
  t("attack", "4 ... and its calls carry no sweep mark, although a cron sweep is running (the mark is for the sweep's own calls only)", duringCheck.length > 0 && duringCheck.every((f) => f.headers[MARK] === undefined), JSON.stringify(duringCheck.map((f) => f.headers[MARK] || null)));
  t("attack", "4 ... and the held sweep row still says cron context", L.rec.probed_via === CRON_TEXT, L.rec.probed_via);
}

// ---- 5. POST /sweep keeps the 0.4.21 text (http context; own-zone rows through the relay) -----------------------
{
  const g = freshEnv(RELAY_VARS);
  const EP = "https://post5.redteam.invalid/mcp";
  await g.post("/watch", { endpoint: EP, tier: "paid" }, { "x-sweep-token": OP });
  const s = await g.sweep({ force: true });
  const out = (await g.latestRecord(EP)).rec.probed_via;
  const own = (await g.latestRecord("https://mcp.horizonshield.dev/mcp")).rec.probed_via;
  t("control", "5 POST /sweep: an outside row says http context, as 0.4.21", s.status === 200 && out === HTTP_TEXT, out);
  t("control", "5 POST /sweep: an own-zone row goes through the relay, as 0.4.21", isRelayText(own), own);
}

// ---- report ------------------------------------------------------------------------------------------------
const kinds = {};
for (const r of R) { const k = kinds[r.kind] || [0, 0]; kinds[r.kind] = [k[0] + (r.ok ? 1 : 0), k[1] + 1]; }
console.log("--- 種別 ---");
for (const k of ["attack", "control"]) if (kinds[k]) console.log("  " + k.padEnd(10) + " " + kinds[k][0] + " / " + kinds[k][1]);
for (const r of R) console.log((r.ok ? "  ok   " : "  NG   ") + "[" + r.kind + "] " + r.name + (r.ok ? "" : "\n      " + r.detail));
const passed = R.filter((r) => r.ok).length;
console.log("=== " + passed + " / " + R.length + " 合格 (probe context、扉 0.4.22) ===");
process.exit(passed === R.length ? 0 : 1);
