// quarantine_route: TSUGI の隔離の口 (扉 0.4.10)。運営のみ、提案 hash 必須、隔離中は測らん・配らん・lookup が quarantined と言う、解除も記録。
// 隔離は停止であって所見やない。この suite は「止まる」ことと「止めた事実が残る」ことだけ見る。走らせ方: node test/quarantine_route.test.mjs
import worker from "../src/worker.js";

const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const jres = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
function kv() {
  const store = new Map();
  return {
    store,
    get: async (k, type) => { const v = store.has(k) ? store.get(k) : null; return (type === "json" && v !== null) ? JSON.parse(v) : v; },
    put: async (k, v) => { store.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    delete: async (k) => { store.delete(k); },
    list: async (o) => ({ keys: [...store.keys()].filter((k) => k.startsWith((o && o.prefix) || "")).map((name) => ({ name })), list_complete: true }),
  };
}
const CARD = { name: "Q Agent", description: "a mock", url: "", capabilities: {}, skills: [] };
const TOOL = { name: "alpha", description: "tool alpha", inputSchema: { type: "object", properties: {} } };
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  if (!/\.redteam\.invalid$/.test(u.hostname)) return new Response("no", { status: 500 });
  if (u.pathname === "/.well-known/mcp-conduct.json") return jres({ allow_tool_call: true });
  if (u.pathname === "/.well-known/agent-card.json") return jres(CARD);
  if (u.pathname === "/mcp" && (init && init.method) === "POST") {
    const body = JSON.parse(init.body); const id = body.id;
    if (body.method === "initialize") return jres({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "q", version: "0" }, capabilities: { tools: {} } } });
    if (body.method === "tools/list") return jres({ jsonrpc: "2.0", id, result: { tools: [TOOL] } });
    if (body.method === "tools/call") return jres({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "constant" }] } });
    return jres({ jsonrpc: "2.0", id, error: { code: -32601, message: "nope" } });
  }
  return new Response("not found", { status: 404 });
};
const TOKEN = "quarantine-test-token";
const ENV = { HS_VERIFY_KV: kv(), SWEEP_TOKEN: TOKEN, GATE_COMMIT: "quarantine-local" };
const O = "https://gate.horizonshield.dev";
const call = (path, init) => worker.fetch(new Request(O + path, init), ENV, CTX);
const post = (path, body, headers) => call(path, { method: "POST", headers: { "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) });
const auth = { "x-sweep-token": TOKEN };
let pass = 0, fail = 0; const out = [];
const t = (name, ok, d) => { ok ? pass++ : fail++; out.push((ok ? "  ok   " : "  NG   ") + name + (ok || !d ? "" : "  <<< " + d)); };
const EP = "https://q.redteam.invalid/mcp";
const PSHA = "a".repeat(64), ASHA = "b".repeat(64);

// a row to quarantine
const w = await (await post("/watch", { endpoint: EP }, auth)).json();
t("setup: the row is on the register", w.ok === true, JSON.stringify(w).slice(0, 120));

// auth
t("no token -> 403 (never a silent stop)", (await post("/register/quarantine", { endpoint: EP, proposal_sha256: PSHA, reason: "signature drift on the card" })).status === 403);
t("wrong token -> 403", (await post("/register/quarantine", { endpoint: EP, proposal_sha256: PSHA, reason: "signature drift on the card" }, { "x-sweep-token": "nope" })).status === 403);
t("not configured -> 503", (await worker.fetch(new Request(O + "/register/quarantine", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { HS_VERIFY_KV: kv() }, CTX)).status === 503);
// shape
t("proposal_sha256 missing -> 400 (a quarantine cites the proposal that asked for it)", (await (await post("/register/quarantine", { endpoint: EP, reason: "signature drift on the card" }, auth)).json()).error === "proposal_sha256_required");
t("reason too short -> 400", (await (await post("/register/quarantine", { endpoint: EP, proposal_sha256: PSHA, reason: "x" }, auth)).json()).error === "reason_required");
t("bad until -> 400", (await (await post("/register/quarantine", { endpoint: EP, proposal_sha256: PSHA, reason: "signature drift on the card", until: "tomorrow" }, auth)).json()).error === "bad_until");
t("unknown endpoint -> 404 not_on_register", (await post("/register/quarantine", { endpoint: "https://nobody.redteam.invalid/mcp", proposal_sha256: PSHA, reason: "signature drift on the card" }, auth)).status === 404);
t("lift when not quarantined -> 409", (await post("/register/quarantine", { endpoint: EP, proposal_sha256: PSHA, reason: "lifting a stop that is not there", lift: true }, auth)).status === 409);

// quarantine
const q1 = await (await post("/register/quarantine", { endpoint: EP, proposal_sha256: PSHA, authorization_sha256: ASHA, reason: "R1 unpinned deploy: stop serving verdicts for this row until it is redeployed through the guard" }, auth)).json();
t("quarantine -> ok with since, proposal and authorization hashes on the row", q1.ok === true && q1.quarantined && q1.quarantined.proposal_sha256 === PSHA && q1.quarantined.authorization_sha256 === ASHA && /Z$/.test(q1.quarantined.since), JSON.stringify(q1).slice(0, 200));
t("the response says it is a stop, not a finding", Array.isArray(q1.does_not_establish) && q1.does_not_establish.some((x) => /not a finding/.test(x)));
const lk = await (await call("/register/lookup?endpoint=" + encodeURIComponent(EP))).json();
t("lookup: status quarantined, meaning names the proposal and says it is not a finding", lk.status === "quarantined" && /proposal a{64}/.test(lk.status_meaning || lk.meaning || JSON.stringify(lk)) && /not a finding/.test(JSON.stringify(lk)), JSON.stringify(lk).slice(0, 300));
t("lookup carries the quarantined object", lk.quarantined && lk.quarantined.proposal_sha256 === PSHA);
const reg = await (await call("/register")).json();
const row = (reg.rows || []).find((r) => r.endpoint === EP);
t("/register row shows quarantined active with the proposal hash and the effect", row && row.quarantined && row.quarantined.active === true && row.quarantined.proposal_sha256 === PSHA && /not a finding/.test(row.quarantined.effect), JSON.stringify(row).slice(0, 300));

// sweep skips it, recording why
const sw = await (await post("/sweep", { force: true }, auth)).json();
const skip = (sw.skipped || []).find((x) => x.endpoint === EP);
t("sweep: the quarantined row is skipped with the reason naming TSUGI and the proposal", !!skip && /quarantined by the operator under TSUGI/.test(skip.reason) && /a{16}/.test(skip.reason), JSON.stringify(sw).slice(0, 400));
t("sweep: the quarantined row was not measured", !(sw.results || []).some((r) => r.endpoint === EP));

// expiry
const q2 = await (await post("/register/quarantine", { endpoint: EP, proposal_sha256: PSHA, reason: "same stop, with an until in the past", until: "2020-01-01T00:00:00Z" }, auth)).json();
const lk2 = await (await call("/register/lookup?endpoint=" + encodeURIComponent(EP))).json();
t("an expired until: the quarantine is not active, lookup falls through (the row still records it)", q2.ok === true && lk2.status !== "quarantined" && lk2.quarantined && lk2.quarantined.until === "2020-01-01T00:00:00Z", lk2.status);

// lift
const q3 = await (await post("/register/quarantine", { endpoint: EP, proposal_sha256: PSHA, reason: "redeployed through the guard, witness measured 0 drift", lift: true }, auth)).json();
const lk3 = await (await call("/register/lookup?endpoint=" + encodeURIComponent(EP))).json();
t("lift -> ok, the row records the lift with what it was", q3.ok === true && q3.quarantined === null && q3.quarantine_lifted && q3.quarantine_lifted.was && q3.quarantine_lifted.was.proposal_sha256 === PSHA);
t("after the lift: lookup is no longer quarantined and carries quarantine_lifted", lk3.status !== "quarantined" && lk3.quarantined === null && lk3.quarantine_lifted && lk3.quarantine_lifted.proposal_sha256 === PSHA, lk3.status);
const reg2 = await (await call("/register")).json();
const row2 = (reg2.rows || []).find((r) => r.endpoint === EP);
t("/register row after the lift shows quarantine_lifted and no active quarantine", row2 && !row2.quarantined && row2.quarantine_lifted && row2.quarantine_lifted.proposal_sha256 === PSHA);
const sw2 = await (await post("/sweep", { force: true }, auth)).json();
t("sweep after the lift measures the row again (or skips it for another stated reason, never for quarantine)", !(sw2.skipped || []).some((x) => x.endpoint === EP && /quarantined/.test(x.reason)));

const spec = await (await call("/spec")).json();
t("control: /spec reports 0.4.12", spec.version === "0.4.12", spec.version);
console.log(out.join("\n"));
console.log("=== " + pass + " / " + (pass + fail) + " 合格 (quarantine route、扉 0.4.10) ===");
if (fail) process.exit(1);
