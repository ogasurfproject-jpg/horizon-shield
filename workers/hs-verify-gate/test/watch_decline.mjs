// 0.3.1: /watch records who asked; an origin's well-known listing: "decline" stops measurement;
// the sweep is ordered least recently measured first; DELETE /watch removes a row with a public tombstone.
// Offline. globalThis.fetch is replaced; *.redteam.invalid never resolves for real (RFC 2606).
// Run: node test/watch_decline.mjs   (in workers/hs-verify-gate)
import worker from "../src/worker.js";

const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const jres = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
const CARD = { name: "Redteam Agent", description: "an adversarial mock", url: "",
  compensation: { paid_by: "public", referral_fee: false, listing_fee: false, success_fee_pct: 0, disclosure_url: "https://example.invalid/disclosure" } };
const TOOL = { name: "alpha", description: "redteam tool alpha", inputSchema: { type: "object", properties: {} } };

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

// origin -> well-known body (undefined = 404)
const WK = {
  "https://declined.redteam.invalid": { allow_tool_call: true, listing: "decline" },
  "https://open.redteam.invalid": undefined,
  "https://consenting.redteam.invalid": { allow_tool_call: true },
  "https://sloppy.redteam.invalid": { allow_tool_call: true, listing: "DECLINE" },   // wrong case: not a decline (exact value only)
};
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  const origin = u.origin;
  if (!/\.redteam\.invalid$/.test(u.hostname)) return new Response("no", { status: 500 });   // beacon etc.: fail closed
  if (u.pathname === "/.well-known/mcp-conduct.json") return WK[origin] === undefined ? new Response("", { status: 404 }) : jres(WK[origin]);
  if (u.pathname === "/.well-known/agent-card.json") return jres(CARD);
  if (u.pathname === "/mcp" && (init && init.method) === "POST") {
    const body = JSON.parse(init.body); const id = body.id;
    if (body.method === "initialize") return jres({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "rt", version: "0" }, capabilities: { tools: {} } } });
    if (body.method === "tools/list") return jres({ jsonrpc: "2.0", id, result: { tools: [TOOL] } });
    if (body.method === "tools/call") return jres({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "constant answer" }] } });
    return jres({ jsonrpc: "2.0", id, error: { code: -32601, message: "nope" } });
  }
  return new Response("not found", { status: 404 });
};

const ENV = { HS_VERIFY_KV: kv(), SWEEP_TOKEN: "redteam-sweep-token", GATE_COMMIT: "redteam-local" };
const call = (path, init) => worker.fetch(new Request("https://gate.horizonshield.dev" + path, init), ENV, CTX);
const post = (path, body, headers) => call(path, { method: "POST", headers: { "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) });

const R = [];
const t = (kind, name, ok, detail = "") => R.push({ kind, name, ok: !!ok, detail: String(detail) });

// --- /watch records who asked and what the origin's file said ---
const w1 = await (await post("/watch", { endpoint: "https://declined.redteam.invalid/mcp" })).json();
t("control", "anonymous /watch is accepted (the register stays open to anyone)", w1.ok === true, JSON.stringify(w1).slice(0, 120));
t("control", "the row records requested_by anonymous", w1.requested_by === "anonymous", w1.requested_by);
t("control", "the row records that the origin's file said decline at request time", w1.owner_file_at_request === "decline" && w1.owner_declined === true, JSON.stringify([w1.owner_file_at_request, w1.owner_declined]));
const w2 = await (await post("/watch", { endpoint: "https://open.redteam.invalid/mcp" })).json();
t("control", "an origin with no file is recorded as absent, not declined", w2.owner_file_at_request === "absent" && w2.owner_declined === false, JSON.stringify(w2).slice(0, 160));
const w3 = await (await post("/watch", { endpoint: "https://consenting.redteam.invalid/mcp" }, { "x-sweep-token": "redteam-sweep-token" })).json();
t("control", "the operator's own request is recorded as operator, file as consent", w3.requested_by === "operator" && w3.owner_file_at_request === "consent", JSON.stringify([w3.requested_by, w3.owner_file_at_request]));
const w4 = await (await post("/watch", { endpoint: "https://sloppy.redteam.invalid/mcp" })).json();
t("attack", "listing: DECLINE (wrong case) is not a decline; only the exact value counts", w4.owner_declined === false, w4.owner_file_at_request);
const w1b = await (await post("/watch", { endpoint: "https://declined.redteam.invalid/mcp" }, { "x-sweep-token": "redteam-sweep-token" })).json();
t("attack", "re-watching by the operator does not rewrite who asked first", w1b.requested_by === "anonymous", w1b.requested_by);

// --- starvation: eight daily self endpoints must not consume every slot forever ---
const sw0 = await (await post("/sweep", { force: true }, { "x-sweep-token": "redteam-sweep-token" })).json();
const over0 = (sw0.skipped || []).filter((x) => /over MAX_PER_SWEEP/.test(x.reason));
t("control", "first sweep on an empty history: ties keep register order, the overflow is recorded, never silent", over0.length >= 1 && /never/.test(over0[0].reason), JSON.stringify(over0.map((x) => x.endpoint)));
const sw = await (await post("/sweep", { force: true }, { "x-sweep-token": "redteam-sweep-token" })).json();
const measured = new Set((sw.results || []).map((r) => r.endpoint));
const over1 = (sw.skipped || []).filter((x) => /over MAX_PER_SWEEP/.test(x.reason)).map((x) => x.endpoint);
t("attack", "second sweep: never-measured rows go first; the rows that overflow are the ones measured most recently, not the newcomers", over1.length >= 1 && over1.every((e) => /horizonshield\.dev/.test(e)) && !over1.some((e) => /redteam\.invalid/.test(e)), JSON.stringify(over1));
const skippedDeclined = (sw.skipped || []).filter((s) => /owner declined/.test(s.reason)).map((s) => s.endpoint);
t("control", "the sweep does not measure the declined endpoint", !measured.has("https://declined.redteam.invalid/mcp"), [...measured].join(","));
t("control", "the sweep names the declined endpoint in skipped with the reason", skippedDeclined.includes("https://declined.redteam.invalid/mcp"), JSON.stringify(skippedDeclined));
t("control", "the sweep still measures the open and consenting endpoints", measured.has("https://open.redteam.invalid/mcp") && measured.has("https://consenting.redteam.invalid/mcp"), [...measured].join(","));
t("attack", "the wrong-case decline is measured like anyone else", measured.has("https://sloppy.redteam.invalid/mcp"), "");
const hist = await (await call("/history?endpoint=" + encodeURIComponent("https://declined.redteam.invalid/mcp"))).json();
t("control", "no verdict exists for the declined row", !(hist.entries || []).length, JSON.stringify(hist).slice(0, 100));

// --- the refusal is visible on the register and the watchlist ---
const reg = await (await call("/register")).json();
const row = (reg.rows || []).find((r) => r.endpoint === "https://declined.redteam.invalid/mcp");
t("control", "the register row says owner_declined with a date and how", !!(row && row.owner_declined && row.owner_declined.since && /decline/.test(row.owner_declined.how)), JSON.stringify(row && row.owner_declined));
t("control", "every register row carries requested_by", (reg.rows || []).every((r) => typeof r.requested_by === "string" && r.requested_by), JSON.stringify((reg.rows || []).map((r) => r.requested_by)));
const wl = await (await call("/watchlist")).json();
const wrow = (wl.watched || []).find((r) => r.endpoint === "https://declined.redteam.invalid/mcp");
t("control", "the watchlist shows owner_declined true for that row", !!(wrow && wrow.owner_declined === true), JSON.stringify(wrow));

// --- withdrawing the decline resumes measurement ---
WK["https://declined.redteam.invalid"] = { allow_tool_call: true };
let measured2 = new Set();
for (let i = 0; i < 3 && !measured2.has("https://declined.redteam.invalid/mcp"); i++) {
  const sw2 = await (await post("/sweep", { force: true }, { "x-sweep-token": "redteam-sweep-token" })).json();
  measured2 = new Set((sw2.results || []).map((r) => r.endpoint));
}
t("control", "removing listing: decline resumes measurement at the next sweep", measured2.has("https://declined.redteam.invalid/mcp"), [...measured2].join(","));
const reg2 = await (await call("/register")).json();
const row2 = (reg2.rows || []).find((r) => r.endpoint === "https://declined.redteam.invalid/mcp");
t("control", "the register row no longer says declined", !(row2 && row2.owner_declined), JSON.stringify(row2 && row2.owner_declined));
const spec = await (await call("/spec")).json();
t("control", "/spec states the listing: decline rule", /decline/.test(JSON.stringify(spec.well_known_consent || {})), "");

// --- removal at the owner's request: operator only, reason required, public tombstone, history kept ---
const del = (body, headers) => call("/watch", { method: "DELETE", headers: { "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) });
const d1 = await del({ endpoint: "https://open.redteam.invalid/mcp", reason: "owner asked by email 2026-09-05" });
t("attack", "DELETE /watch without the operator token is refused", d1.status === 403, String(d1.status));
const d2 = await del({ endpoint: "https://open.redteam.invalid/mcp", reason: "x" }, { "x-sweep-token": "redteam-sweep-token" });
t("attack", "DELETE /watch without a real reason is refused (a removal without a reason is a silent edit)", d2.status === 400, String(d2.status));
const d3 = await del({ endpoint: "https://mcp.horizonshield.dev/mcp", reason: "trying to remove a self row" }, { "x-sweep-token": "redteam-sweep-token" });
t("attack", "the operator cannot remove its own self rows (they live in the source)", d3.status === 404, String(d3.status));
const d4 = await (await del({ endpoint: "https://open.redteam.invalid/mcp", reason: "owner asked by email 2026-09-05" }, { "x-sweep-token": "redteam-sweep-token" })).json();
t("control", "a removal with the token and a reason succeeds and returns the tombstone", d4.ok === true && d4.removed && d4.removed.reason === "owner asked by email 2026-09-05" && d4.removed.requested_by === "anonymous", JSON.stringify(d4).slice(0, 200));
const reg3 = await (await call("/register")).json();
t("control", "the removed row is gone from the register rows", !(reg3.rows || []).some((r) => r.endpoint === "https://open.redteam.invalid/mcp"), "");
t("control", "the register lists the removal publicly with endpoint, date and reason", (reg3.removed_rows || []).some((x) => x.endpoint === "https://open.redteam.invalid/mcp" && x.removed_at && x.reason), JSON.stringify(reg3.removed_rows));
const wl2 = await (await call("/watchlist")).json();
t("control", "the watchlist lists the removal too", (wl2.removed || []).some((x) => x.endpoint === "https://open.redteam.invalid/mcp"), "");
const h2 = await (await call("/history?endpoint=" + encodeURIComponent("https://open.redteam.invalid/mcp"))).json();
t("control", "history of a removed row is still readable (records are never deleted)", (h2.entries || []).length >= 1, String((h2.entries || []).length));
const d5 = await del({ endpoint: "https://open.redteam.invalid/mcp", reason: "owner asked by email 2026-09-05" }, { "x-sweep-token": "redteam-sweep-token" });
t("control", "removing it twice is a 404, not a second tombstone", d5.status === 404, String(d5.status));

// --- report ---
const k = {};
for (const r of R) { const [a, b] = k[r.kind] || [0, 0]; k[r.kind] = [a + (r.ok ? 1 : 0), b + 1]; }
console.log("--- 種別 ---");
for (const kind of ["attack", "control"]) if (k[kind]) console.log("  %s %d / %d", kind.padEnd(10), k[kind][0], k[kind][1]);
for (const r of R) if (!r.ok) console.log("  NG  [%s] %s\n      %s", r.kind, r.name, r.detail);
const passed = R.filter((r) => r.ok).length;
console.log("\n=== %d / %d 合格 (watch requested_by + listing: decline, 扉 0.3.1) ===", passed, R.length);
if (passed === R.length) console.log("誰でも乗せられる。誰が乗せたかは残る。断れるのは origin だけで、断った事実も残る。");
process.exit(passed === R.length ? 0 : 1);
