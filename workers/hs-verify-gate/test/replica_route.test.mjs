// replica_route (0.4.23, 2026-11-05): Marketplace customers' endpoints are measured by the replica only, and the gate
// lists them on its public register after recomputing each record itself.
//
// Three workers run in this one process, each with its own storage and its own module instance (the gate code is
// imported twice under two query strings, so the module state of one never reaches the other):
//   marketplace   hs-ms-marketplace, unchanged, with subscriptions seeded in its store; GET /admin/daily is the source
//   replica       the gate code with GATE_PLATFORM=azure, GATE_PUBLIC_ORIGIN=https://gate-az.horizonshield.dev,
//                 OWN_ROWS=off, GATE_PATHS=replica, MARKETPLACE_DAILY_URL and MARKETPLACE_DAILY_TOKEN
//   gate          the gate code with REPLICA_ORIGIN=https://gate-az.horizonshield.dev
// globalThis.fetch is a router: gate-az.horizonshield.dev goes to the replica's fetch, marketplace.horizonshield.dev to
// the marketplace's fetch, *.customer.invalid to a mock MCP server, every other horizonshield.dev host answers 404,
// and any other host throws. Nothing leaves the process.
//
// Storage: in-memory by default. HS_ROUTE_STORES=<path to a module exporting makeStores> swaps it, which is how the
// same scenario is run with the replica on Azure Table and Blob fakes.
//
// Cases: (a) the two endpoints on /admin/daily become paid rows on the replica, are measured every day, and appear on
// the gate's register with a link to the replica's record; (b) one byte changed in the replica's stored record: the
// gate says it does not recompute and gives no link; (c) the replica does not answer; (d) an endpoint that leaves the
// list; (e) the gate does not measure a covered endpoint a second time; (f) the gate reads the same list too, so the
// customers' endpoints are also paid rows on the gate, left to the replica while its records recompute and measured by
// the gate when they do not (counted against the paid seats; rows the gate already had are not rewritten).
// Run: node test/replica_route.test.mjs   (in workers/hs-verify-gate)
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

// ---- clock ----
const RealDate = Date;
const NOW = { v: RealDate.parse("2026-11-05T18:00:00.000Z") };
class FixedDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW.v); else super(...a); }
  static now() { return NOW.v; }
}
FixedDate.parse = RealDate.parse;
FixedDate.UTC = RealDate.UTC;
globalThis.Date = FixedDate;
const at = (iso) => { NOW.v = RealDate.parse(iso); };

const gateMod = await import(new URL("../src/worker.js?role=gate", import.meta.url).href);
const replicaMod = await import(new URL("../src/worker.js?role=replica", import.meta.url).href);
const marketMod = await import(new URL("../../hs-ms-marketplace/src/worker.js", import.meta.url).href);
const gateW = gateMod.default, replicaW = replicaMod.default, marketW = marketMod.default;

// ---- storage ----
function memKv() {
  const store = new Map();
  return {
    store,
    async get(key, type) {
      if (!store.has(key)) return null;
      const v = store.get(key);
      return (type === "json" || (type && type.type === "json")) ? JSON.parse(v) : v;
    },
    async put(key, v) { store.set(String(key), typeof v === "string" ? v : String(v)); },
    async delete(key) { store.delete(key); },
    async list(o) {
      const p = (o && o.prefix) || "";
      return { keys: [...store.keys()].filter((k) => k.startsWith(p)).sort().map((name) => ({ name })), list_complete: true };
    }
  };
}
let stores;
if (process.env.HS_ROUTE_STORES) {
  const m = await import(pathToFileURL(process.env.HS_ROUTE_STORES).href);
  stores = await m.makeStores({ gateLeaseClass: gateMod.SweepLeaseDO, now: () => Date.now() });
} else {
  stores = { label: "in-memory", gateKv: memKv(), gateLease: undefined, replicaKv: memKv(), replicaLease: undefined, marketKv: memKv() };
}

// ---- the three workers ----
const AZ = "https://gate-az.horizonshield.dev";
const CF = "https://gate.horizonshield.dev";
const MKT = "https://marketplace.horizonshield.dev";
const OP_GATE = "op-gate-token", OP_REPLICA = "op-replica-token";
const ADMIN = "market-admin-token", DAILY_READ = "market-daily-read-token";
const marketEnv = { MS_TENANT_ID: "aaaaaaaa-0000-4000-8000-000000000001", MS_API_APP_ID: "aaaaaaaa-0000-4000-8000-000000000002", MS_LOGIN_APP_ID: "aaaaaaaa-0000-4000-8000-000000000003", MS_API_CLIENT_SECRET: "s", ADMIN_TOKEN: ADMIN, DAILY_READ_TOKEN: DAILY_READ, MS_SUBS: stores.marketKv };
const replicaEnv = { HS_VERIFY_KV: stores.replicaKv, ...(stores.replicaLease ? { SWEEP_LEASE_DO: stores.replicaLease } : {}), SWEEP_TOKEN: OP_REPLICA, GATE_COMMIT: "route-local",
  GATE_PLATFORM: "azure", GATE_PUBLIC_ORIGIN: AZ, OWN_ROWS: "off", GATE_PATHS: "replica",
  MARKETPLACE_DAILY_URL: MKT + "/admin/daily", MARKETPLACE_DAILY_TOKEN: DAILY_READ };
// hs-ms-marketplace 0.2.1 opens GET /admin/daily to DAILY_READ_TOKEN. Before 0.2.1 only ADMIN_TOKEN does, and the replica is
// then given ADMIN_TOKEN as MARKETPLACE_DAILY_TOKEN. The gate code is the same either way; the test follows the marketplace it finds.
const probe = await marketW.fetch(new Request(MKT + "/admin/daily", { headers: { authorization: "Bearer " + DAILY_READ } }), marketEnv, {}, async () => { throw new Error("no"); });
const READ_KEY = probe.status === 200 ? DAILY_READ : ADMIN;
replicaEnv.MARKETPLACE_DAILY_TOKEN = READ_KEY;
const gateEnv = { HS_VERIFY_KV: stores.gateKv, ...(stores.gateLease ? { SWEEP_LEASE_DO: stores.gateLease } : {}), SWEEP_TOKEN: OP_GATE, GATE_COMMIT: "route-local", REPLICA_ORIGIN: AZ };

const pending = [];
const CTX = { waitUntil(p) { pending.push(Promise.resolve(p).catch(() => null)); }, passThroughOnException() {} };
const drain = async () => { while (pending.length) await pending.shift(); };

// ---- the outside world ----
const jres = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
const TOOLS = [{ name: "alpha", description: "tool alpha", inputSchema: { type: "object", properties: {} } }];
const CARD = { name: "Customer Agent", description: "a customer endpoint", url: "",
  compensation: { paid_by: "public", referral_fee: false, listing_fee: false, success_fee_pct: 0, disclosure_url: "https://customer.invalid/disclosure" } };
let ACTIVE = "none";                     // which worker's sweep is running (the router counts customer fetches per side)
const customerFetches = { gate: 0, replica: 0, none: 0 };
let replicaDown = null;                  // null | "refused" | "503" | "hang"
const marketAuthSeen = [];
globalThis.fetch = async (url, init) => {
  const req = url instanceof Request ? url : null;
  const u = new URL(req ? req.url : url);
  if (u.origin === AZ) {
    if (replicaDown === "refused") throw new TypeError("fetch failed (connection refused)");
    if (replicaDown === "503") return new Response("upstream unavailable", { status: 503 });
    if (replicaDown === "hang") return new Promise(() => {});
    const r = await replicaW.fetch(new Request(u.href, init), replicaEnv, CTX);
    return r;
  }
  if (u.origin === MKT) {
    marketAuthSeen.push((init && init.headers && (init.headers.authorization || init.headers.Authorization)) || "");
    return marketW.fetch(new Request(u.href, init), marketEnv, {}, async () => { throw new Error("the marketplace calls nothing in this test"); });
  }
  if (/\.customer\.invalid$/.test(u.hostname)) {
    customerFetches[ACTIVE] = (customerFetches[ACTIVE] || 0) + 1;
    if (u.pathname === "/.well-known/mcp-conduct.json") return jres({ allow_tool_call: true });
    if (u.pathname === "/.well-known/agent-card.json") return jres(CARD);
    if (u.pathname === "/mcp" && init && init.method === "POST") {
      const b = JSON.parse(init.body); const id = b.id;
      if (b.method === "initialize") return jres({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "cust", version: "1" }, capabilities: { tools: {} } } });
      if (b.method === "tools/list") return jres({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      if (b.method === "tools/call") return jres({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "constant answer" }] } });
      return jres({ jsonrpc: "2.0", id, error: { code: -32601, message: "nope" } });
    }
    return new Response("not found", { status: 404 });
  }
  if (/(^|\.)horizonshield\.dev$/.test(u.hostname)) return new Response("not found", { status: 404 });   // the gate's own rows, the ledger
  if (/^(mempool\.space|blockstream\.info|mempool\.emzy\.de|raw\.githubusercontent\.com)$/.test(u.hostname)) return new Response("no", { status: 500 });
  throw new Error("replica_route: network blocked for " + u.hostname);
};

const sha256 = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const callW = async (w, env, origin, p, init) => { const r = await w.fetch(new Request(origin + p, init), env, CTX); const text = await r.text(); await drain(); let j = null; try { j = JSON.parse(text); } catch (_e) {} return { status: r.status, text, j }; };
const gate = (p, init) => callW(gateW, gateEnv, CF, p, init);
const replica = (p, init) => callW(replicaW, replicaEnv, AZ, p, init);
const market = (p, init) => callW(marketW, marketEnv, MKT, p, init);
const cron = async (w, env, side) => { ACTIVE = side; await w.scheduled({ cron: "0 18 * * *", scheduledTime: Date.now() }, env, CTX); await drain(); ACTIVE = "none"; };
const replicaCron = () => cron(replicaW, replicaEnv, "replica");
const gateCron = () => cron(gateW, gateEnv, "gate");
const lastSweep = async (side) => (side === "gate" ? await gate("/sweep/last") : await replica("/sweep/last")).j;
const hist = async (side, ep) => ((side === "gate" ? await gate("/history?endpoint=" + encodeURIComponent(ep)) : await replica("/history?endpoint=" + encodeURIComponent(ep))).j || {}).entries || [];
const regRow = (reg, ep) => ((reg && reg.rows) || []).find((r) => r.endpoint === ep);

const R = [];
const t = (kind, name, ok, detail = "") => R.push({ kind, name, ok: !!ok, detail: String(detail).slice(0, 500) });

// ---- seed: the marketplace has two subscriptions owed daily measurement, and one endpoint on an unknown plan ----
const EP1 = "https://c1.customer.invalid/mcp", EP2 = "https://c2.customer.invalid/mcp", EPX = "https://cx.customer.invalid/mcp";
const SUB1 = "11111111-1111-4111-8111-111111111111", SUB2 = "22222222-2222-4222-8222-222222222222", SUB3 = "33333333-3333-4333-8333-333333333333";
await stores.marketKv.put("sub:" + SUB1, JSON.stringify({ id: SUB1, planId: "endpoint-verification", status: "Subscribed", events: [], endpoints: [{ endpoint: EP1, added_at: "2026-11-01T00:00:00Z" }], keep: [] }));
await stores.marketKv.put("sub:" + SUB2, JSON.stringify({ id: SUB2, planId: "endpoint-verification-pro", status: "Subscribed", events: [], endpoints: [{ endpoint: EP2, added_at: "2026-11-01T00:00:00Z" }], keep: [] }));
await stores.marketKv.put("sub:" + SUB3, JSON.stringify({ id: SUB3, planId: "no-such-plan", status: "Subscribed", events: [], endpoints: [{ endpoint: EPX, added_at: "2026-11-01T00:00:00Z" }], keep: [] }));
const daily0 = await market("/admin/daily", { headers: { authorization: "Bearer " + ADMIN } });
t("control", "0 seed: /admin/daily owes daily measurement to exactly the two endpoints (the unknown plan's endpoint is not daily)",
  daily0.status === 200 && JSON.stringify(daily0.j.daily.map((d) => d.endpoint).sort()) === JSON.stringify([EP1, EP2]), JSON.stringify(daily0.j && daily0.j.daily));
// The gate already has EP1 as a paid row (registered before the replica existed). This is the double measurement (e) guards.
const pre = await gate("/watch", { method: "POST", headers: { "content-type": "application/json", "x-sweep-token": OP_GATE }, body: JSON.stringify({ endpoint: EP1, tier: "paid" }) });
t("control", "0 seed: the gate has its own paid row for EP1", pre.status === 200 && pre.j.tier === "paid", pre.text.slice(0, 200));

// ---- day 1: the replica reads the list and measures; the gate imports and does not measure EP1 ----
at("2026-11-05T18:00:00.000Z");
await replicaCron();
let rs = await lastSweep("replica");
t("control", "a day 1: the replica read the daily list and added the two endpoints as rows", rs.route_sync && rs.route_sync.ok === true && JSON.stringify(rs.route_sync.added.sort()) === JSON.stringify([EP1, EP2]) && rs.route_sync.listed === 2, JSON.stringify(rs.route_sync));
t("attack", "a the endpoint on an unknown plan (not owed daily) is not routed to the replica", !(await replica("/watch?endpoint=" + encodeURIComponent(EPX))).j.registered, "");
const w1 = (await replica("/watch?endpoint=" + encodeURIComponent(EP1))).j;
t("control", "a the replica's row is paid, daily, source marketplace", w1.registered === true && w1.tier === "paid" && w1.cadence === "daily" && w1.source === "marketplace", JSON.stringify(w1));
t("control", "a day 1: the replica measured both endpoints in its cron sweep", JSON.stringify(rs.results.map((r) => r.endpoint).sort()) === JSON.stringify([EP1, EP2]), JSON.stringify(rs.results.map((r) => r.endpoint)));
t("attack", "a the replica read the list with the key it was given (" + (READ_KEY === DAILY_READ ? "the read-only DAILY_READ_TOKEN" : "ADMIN_TOKEN, marketplace before 0.2.1") + ") and no other", marketAuthSeen.length > 0 && marketAuthSeen.every((h) => h === "Bearer " + READ_KEY), JSON.stringify(marketAuthSeen));
const replicaDump = async () => { const out = []; const l = await stores.replicaKv.list({ prefix: "" }); for (const k of l.keys) out.push(k.name + "=" + (await stores.replicaKv.get(k.name))); return out.join("\n"); };
t("attack", "a the key's value is written nowhere in the replica's store (sweep record, rows, day record)", !(await replicaDump()).includes(READ_KEY), "");
const rreg1 = (await replica("/register")).j;
t("control", "a the replica's /register returns the Marketplace rows only, in the gate's /register row shape",
  rreg1.count === 2 && JSON.stringify(rreg1.rows.map((r) => r.endpoint).sort()) === JSON.stringify([EP1, EP2]) && rreg1.rows.every((r) => r.latest && r.latest.record_url && r.latest.record_url.startsWith(AZ + "/record/") && r.history_url.startsWith(AZ + "/history")),
  String(JSON.stringify(rreg1)).slice(0, 400));
await replica("/watch", { method: "POST", headers: { "content-type": "application/json", "x-sweep-token": OP_REPLICA }, body: JSON.stringify({ endpoint: "https://ops.customer.invalid/mcp", tier: "paid" }) });
const rreg1b = (await replica("/register")).j;
t("attack", "a a row the operator added by hand on the replica (not from the Marketplace list) is not on the replica's /register", !regRow(rreg1b, "https://ops.customer.invalid/mcp") && rreg1b.count === 2, JSON.stringify(rreg1b.rows.map((r) => r.endpoint)));
await replica("/watch", { method: "DELETE", headers: { "content-type": "application/json", "x-sweep-token": OP_REPLICA }, body: JSON.stringify({ endpoint: "https://ops.customer.invalid/mcp", reason: "test row, not a customer" }) });

at("2026-11-05T18:05:00.000Z");
const before1 = customerFetches.gate;
await gateCron();
let gs = await lastSweep("gate");
t("control", "a day 1: the gate read the replica's register and recomputed both records", gs.replica_import && gs.replica_import.ok === true && gs.replica_import.recomputes === 2 && gs.replica_import.records_fetched === 2, JSON.stringify(gs.replica_import));
t("attack", "e day 1: the gate did not measure EP1 (its own paid row), because the replica did and the record recomputed", !gs.results.some((r) => r.endpoint === EP1) && gs.skipped.some((s) => s.endpoint === EP1 && /measured by the replica/.test(s.reason)), JSON.stringify(gs.skipped.filter((s) => s.endpoint === EP1)));
t("attack", "e day 1: the gate made no request to either customer endpoint during its sweep", customerFetches.gate === before1, customerFetches.gate - before1);
const day1 = (await gate("/sweep/day?day=2026-11-05")).j;
t("control", "e the gate's day record counts EP1 as excused (measured_by_replica), so the day is not reported as missing it", (day1.excused || []).some((e) => e.endpoint === EP1 && e.reason_code === "measured_by_replica") && !(day1.missing || []).some((m) => (m.endpoint || m) === EP1), String(JSON.stringify({ excused: day1.excused, missing: day1.missing })).slice(0, 400));
let greg = (await gate("/register")).j;
const rh1 = await hist("replica", EP1), rh2 = await hist("replica", EP2);
let g1 = regRow(greg, EP1), g2 = regRow(greg, EP2);
t("control", "a the gate's register: EP1 (its own row) carries the replica's record link, the note names it",
  g1 && g1.replica && g1.replica.recomputes === true && g1.replica.note === "measured by the replica, record: " + AZ + "/record/" + rh1.at(-1).record_sha256, JSON.stringify(g1 && g1.replica));
t("control", "a the gate's register: EP2 (no gate row) is listed as a paid daily row measured by the replica, latest from the recomputed bytes",
  g2 && g2.measured_by === "replica" && g2.tier === "paid" && g2.cadence === "daily" && g2.latest && g2.latest.record_sha256 === rh2.at(-1).record_sha256 && g2.latest.record_url === AZ + "/record/" + rh2.at(-1).record_sha256 && g2.history_url === AZ + "/history?endpoint=" + encodeURIComponent(EP2),
  String(JSON.stringify(g2)).slice(0, 400));
const rb = await replica("/record/" + rh2.at(-1).record_sha256);
t("control", "a the linked bytes hash to the sha and say measured_from azure and the replica's origin", sha256(rb.text) === rh2.at(-1).record_sha256 && rb.j.measured_from.platform === "azure" && rb.j.measured_from.origin === AZ, "");
t("control", "a the gate's register says how many replica rows it holds and when it read them", greg.replica_import && greg.replica_import.rows === 2 && greg.replica_import.recomputes === 2 && greg.replica_import.imported_at === "2026-11-05T18:05:00.000Z", String(JSON.stringify(greg.replica_import)).slice(0, 300));
t("control", "a the gate's own rows are unchanged on its register store (no replica field written into watch:reg rows)", !(await stores.gateKv.get((await stores.gateKv.list({ prefix: "watch:reg:" })).keys[0].name)).includes("replica"), "");
const vj = (await gate("/verified.json")).j;
t("control", "a /verified.json on the gate is built from the same register (a replica row that passed is listed with the replica's record)",
  Array.isArray(vj.servers) && vj.register_count === greg.count && (vj.servers.find((s) => s.endpoint === EP2) || {}).record_sha256 === (g2.latest.status === "verified" ? g2.latest.record_sha256 : undefined), String(JSON.stringify(vj.servers)).slice(0, 300));

// ---- day 2: measured again by the replica, the link moves to the new record ----
at("2026-11-06T18:00:00.000Z");
await replicaCron();
at("2026-11-06T18:05:00.000Z");
const before2 = customerFetches.gate;
await gateCron();
gs = await lastSweep("gate");
greg = (await gate("/register")).j;
const rh1b = await hist("replica", EP1), rh2b = await hist("replica", EP2);
t("control", "a day 2: the replica measured each endpoint again (2 records each, one per day)", rh1b.length === 2 && rh2b.length === 2 && rh1b[1].at.startsWith("2026-11-06") && rh2b[1].at.startsWith("2026-11-06"), JSON.stringify([rh1b.map((e) => e.at), rh2b.map((e) => e.at)]));
t("control", "a day 2: the gate's links moved to the new records", regRow(greg, EP1).replica.record_url === AZ + "/record/" + rh1b[1].record_sha256 && regRow(greg, EP2).latest.record_sha256 === rh2b[1].record_sha256, "");
t("attack", "e day 2: still no gate measurement of EP1 and no gate request to a customer endpoint", !gs.results.some((r) => r.endpoint === EP1) && customerFetches.gate === before2 && (await hist("gate", EP1)).length === 0, JSON.stringify(gs.results.map((r) => r.endpoint)));
t("control", "a day 2: a second gate run on the same day fetches no record again (2 records fetched in the first run, 0 in the second)", gs.replica_import.records_fetched === 2, JSON.stringify(gs.replica_import));
at("2026-11-06T19:00:00.000Z");
await gateCron();
gs = await lastSweep("gate");
t("control", "a day 2, 19:00 run: the same shas, already recomputed today, are not fetched again", gs.replica_import.ok === true && gs.replica_import.records_fetched === 0 && gs.replica_import.recomputes === 2, JSON.stringify(gs.replica_import));

// ---- day 3 (b): one byte of the replica's stored record changed ----
at("2026-11-07T18:00:00.000Z");
await replicaCron();
const rh2c = await hist("replica", EP2);
const badSha = rh2c.at(-1).record_sha256;
const orig = await stores.replicaKv.get("rec:" + badSha, "text");
const flipped = orig.replace('"status":"verified"', '"status":"verifiee"') !== orig ? orig.replace('"status":"verified"', '"status":"verifiee"') : orig.slice(0, -2) + (orig.at(-2) === "}" ? "]" : "}") + orig.slice(-1);
await stores.replicaKv.put("rec:" + badSha, flipped);
t("control", "b setup: the stored bytes differ from the original in exactly one byte", orig.length === flipped.length && [...orig].filter((c, i) => c !== flipped[i]).length === 1, "");
at("2026-11-07T18:05:00.000Z");
await gateCron();
gs = await lastSweep("gate");
greg = (await gate("/register")).j;
g2 = regRow(greg, EP2); g1 = regRow(greg, EP1);
t("attack", "b the gate says the record does not recompute, with the reason (SHA-256 of the served bytes)",
  g2 && g2.replica.recomputes === false && g2.replica.note === "replica record does not recompute" && /SHA-256 of the served bytes is [0-9a-f]{64}, not the sha in the path/.test(g2.replica.reason) && g2.replica.claimed_record_sha256 === badSha, JSON.stringify(g2 && g2.replica));
t("attack", "b no link to the replica's record is given for that row (no record_url, latest is null)", g2 && !("record_url" in g2.replica) && g2.latest === null && !JSON.stringify(g2).includes(AZ + "/record/"), String(JSON.stringify(g2)).slice(0, 300));
t("control", "b the row is not hidden: it stays on the register, and the sweep record names it", !!g2 && gs.replica_import.does_not_recompute.some((d) => d.endpoint === EP2), JSON.stringify(gs.replica_import.does_not_recompute));
t("control", "b the other row still links (one bad record does not stop the others)", g1.replica.recomputes === true && g1.replica.record_url.endsWith((await hist("replica", EP1)).at(-1).record_sha256), "");
t("control", "b the replica's /register still claims its sha (the gate did not take the list's word for it)", regRow((await replica("/register")).j, EP2).latest.record_sha256 === badSha, "");
// measured_from that names another origin: bytes that hash correctly but were not measured by this replica
{
  const kv2 = memKv();
  const bogus = JSON.stringify({ endpoint: EP1, checked_at: "2026-11-07T18:00:00.000Z", status: "verified", measured_from: { platform: "azure", origin: "https://elsewhere.invalid" } });
  const bsha = sha256(bogus);
  await kv2.put("rec:" + bsha, bogus);
  const fakeReplicaEnv = { HS_VERIFY_KV: kv2, GATE_PATHS: "replica", GATE_PLATFORM: "azure", GATE_PUBLIC_ORIGIN: AZ, OWN_ROWS: "off" };
  const regBody = JSON.stringify({ rows: [{ endpoint: EP1, latest: { at: "2026-11-07T18:00:00.000Z", status: "verified", record_sha256: bsha } }] });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url instanceof Request ? url.url : url);
    if (u.origin === AZ && u.pathname === "/register") return new Response(regBody, { status: 200 });
    if (u.origin === AZ && u.pathname.startsWith("/record/")) return replicaW.fetch(new Request(u.href, init), fakeReplicaEnv, CTX);
    return realFetch(url, init);
  };
  const gkv = memKv();
  const genv = { ...gateEnv, HS_VERIFY_KV: gkv, SWEEP_LEASE_DO: undefined };
  await gateW.scheduled({ cron: "0 18 * * *" }, genv, CTX); await drain();
  const gr = (await callW(gateW, genv, CF, "/register")).j;
  globalThis.fetch = realFetch;
  const row = regRow(gr, EP1);
  t("attack", "b a record whose bytes hash correctly but whose measured_from names another origin is refused", row && row.replica.recomputes === false && /measured_from in the record/.test(row.replica.reason) && !row.replica.record_url, JSON.stringify(row && row.replica));
}

// ---- day 4 to 6 (c): the replica does not answer ----
at("2026-11-08T18:05:00.000Z");
replicaDown = "refused";
const before4 = customerFetches.gate;
await gateCron();
gs = await lastSweep("gate");
greg = (await gate("/register")).j;
t("control", "c day 4, connection refused: the sweep records the failed read and keeps going", gs.replica_import.ok === false && /did not answer/.test(gs.replica_import.reason) && gs.replica_import.kept_rows_from === "2026-11-07T18:05:00.000Z", JSON.stringify(gs.replica_import));
t("control", "c day 4: the register keeps the rows from the last read and says the last read failed", greg.replica_import.last_attempt.ok === false && regRow(greg, EP1).replica.recomputes === true && /last read of the replica's register failed/.test(greg.replica_import.note), String(JSON.stringify(greg.replica_import)).slice(0, 400));
t("control", "c day 4: within 48 hours of the last good record, the gate still leaves EP1 to the replica", !gs.results.some((r) => r.endpoint === EP1) && customerFetches.gate === before4, "");
at("2026-11-09T18:05:00.000Z");
replicaDown = "503";
await gateCron();
gs = await lastSweep("gate");
t("control", "c day 5, HTTP 503: recorded as not answering, nothing replaced", gs.replica_import.ok === false && /HTTP 503/.test(gs.replica_import.reason), JSON.stringify(gs.replica_import));
t("attack", "c day 5: the replica's newest checked record of EP1 is over 48 hours old, so the gate measures EP1 itself again (its own paid row)", gs.results.some((r) => r.endpoint === EP1) && (await hist("gate", EP1)).length === 1, JSON.stringify(gs.results.map((r) => r.endpoint)));
at("2026-11-10T18:05:00.000Z");
replicaDown = "hang";
const t0 = RealDate.now();
await gateCron();
const waited = RealDate.now() - t0;
gs = await lastSweep("gate");
greg = (await gate("/register")).j;
t("control", "c day 6, no answer at all: the read is cut at 10 s and recorded as a timeout", gs.replica_import.ok === false && /timeout/.test(gs.replica_import.reason) && waited >= 9500 && waited < 30000, waited + " ms " + JSON.stringify(gs.replica_import));
t("control", "c day 6: the gate keeps measuring EP1 daily while the replica is away", gs.results.some((r) => r.endpoint === EP1) && (await hist("gate", EP1)).length === 2, JSON.stringify(gs.results.map((r) => r.endpoint)));
t("control", "c day 6, over 48 hours without a good read: the replica's rows are still listed, marked stale", regRow(greg, EP2).replica.stale === true && regRow(greg, EP1).replica.stale === true, JSON.stringify(regRow(greg, EP2).replica));
replicaDown = null;

// ---- day 7 (d): EP2 leaves the Marketplace list ----
const del = await market("/admin/subscriptions/" + SUB2 + "/endpoints", { method: "DELETE", headers: { authorization: "Bearer " + ADMIN, "content-type": "application/json" }, body: JSON.stringify({ endpoint: EP2 }) });
t("control", "d setup: the operator removes EP2 from its subscription on the marketplace", del.status === 200, del.text.slice(0, 200));
at("2026-11-11T18:00:00.000Z");
const ep2Before = (await hist("replica", EP2)).length;
await replicaCron();
rs = await lastSweep("replica");
t("control", "d the replica marks EP2 as off the list (and changes nothing else)", rs.route_sync.ok === true && JSON.stringify(rs.route_sync.unlisted) === JSON.stringify([EP2]) && rs.route_sync.unchanged === 1, JSON.stringify(rs.route_sync));
t("attack", "d the replica does not measure EP2 any more; the skip says why", !rs.results.some((r) => r.endpoint === EP2) && rs.skipped.some((s) => s.endpoint === EP2 && /off the Microsoft Marketplace daily list/.test(s.reason)) && (await hist("replica", EP2)).length === ep2Before, JSON.stringify(rs.skipped.filter((s) => s.endpoint === EP2)));
const w2 = (await replica("/watch?endpoint=" + encodeURIComponent(EP2))).j;
t("control", "d the row is not deleted: still registered, with the mark and its time", w2.registered === true && w2.marketplace_unlisted && w2.marketplace_unlisted.at === "2026-11-11T18:00:00.000Z", JSON.stringify(w2));
t("control", "d the history and records stay readable on the replica", (await hist("replica", EP2)).length === ep2Before && (await replica("/record/" + (await hist("replica", EP2)).at(-2).record_sha256)).status === 200, "");
const rreg7 = (await replica("/register")).j;
t("control", "d the replica's /register lists EP2 under unlisted, not among the rows", !regRow(rreg7, EP2) && rreg7.unlisted.some((u) => u.endpoint === EP2 && u.since === "2026-11-11T18:00:00.000Z"), JSON.stringify(rreg7.unlisted));
t("control", "d EP1 is still measured by the replica", rs.results.some((r) => r.endpoint === EP1), "");
at("2026-11-11T18:05:00.000Z");
await gateCron();
greg = (await gate("/register")).j;
t("control", "d the gate's register no longer lists EP2 as a replica row and names it under replica_import.unlisted", !regRow(greg, EP2) && greg.replica_import.unlisted.some((u) => u.endpoint === EP2), JSON.stringify(greg.replica_import.unlisted));
t("control", "d after the outage, EP1 links to the replica's record again", regRow(greg, EP1).replica.recomputes === true && !regRow(greg, EP1).replica.stale, JSON.stringify(regRow(greg, EP1).replica));
// back on the list
await market("/admin/subscriptions/" + SUB2 + "/endpoints", { method: "POST", headers: { authorization: "Bearer " + ADMIN, "content-type": "application/json" }, body: JSON.stringify({ endpoint: EP2 }) });
at("2026-11-12T18:00:00.000Z");
await replicaCron();
rs = await lastSweep("replica");
t("control", "d EP2 back on the list: the mark is taken off and it is measured again", JSON.stringify(rs.route_sync.relisted) === JSON.stringify([EP2]) && rs.results.some((r) => r.endpoint === EP2) && !(await replica("/watch?endpoint=" + encodeURIComponent(EP2))).j.marketplace_unlisted, JSON.stringify(rs.route_sync));

// ---- the list cannot be read: nothing is marked ----
at("2026-11-13T18:00:00.000Z");
replicaEnv.MARKETPLACE_DAILY_TOKEN = "wrong-key";
await replicaCron();
rs = await lastSweep("replica");
t("attack", "d a list that cannot be read (401) is not an empty list: no row is marked, both are measured", rs.route_sync.ok === false && /HTTP 401/.test(rs.route_sync.reason) && rs.route_sync.unlisted.length === 0 && rs.results.filter((r) => r.endpoint === EP1 || r.endpoint === EP2).length === 2, JSON.stringify(rs.route_sync));
replicaEnv.MARKETPLACE_DAILY_TOKEN = READ_KEY;

// ---- the replica never imports (the gate reading the list is case f) ----
t("attack", "e the replica role does not import (REPLICA_ORIGIN is ignored under GATE_PATHS=replica)", await (async () => { replicaEnv.REPLICA_ORIGIN = AZ; at("2026-11-14T18:00:00.000Z"); await replicaCron(); delete replicaEnv.REPLICA_ORIGIN; const s = await lastSweep("replica"); return !s.replica_import && !(await stores.replicaKv.get("replica:import")); })(), "");
// ---- a record that changes after the gate checked it: found on the next UTC day ----
{
  at("2026-11-14T18:05:00.000Z");
  await gateCron();
  const sha1 = (await hist("replica", EP1)).at(-1).record_sha256;
  t("control", "b' day 14, 18:05: EP1's newest record recomputes", regRow((await gate("/register")).j, EP1).replica.record_url === AZ + "/record/" + sha1, "");
  const o = await stores.replicaKv.get("rec:" + sha1, "text");
  await stores.replicaKv.put("rec:" + sha1, o.slice(0, -1) + "]");   // the last byte, } to ]
  at("2026-11-14T19:00:00.000Z");
  await gateCron();
  let s2 = await lastSweep("gate");
  t("control", "b' same day, 19:00: a sha checked earlier that day is not fetched again (the change is not seen yet)", s2.replica_import.records_fetched === 0 && regRow((await gate("/register")).j, EP1).replica.recomputes === true, JSON.stringify(s2.replica_import));
  at("2026-11-15T18:05:00.000Z");
  const nBefore = (await hist("gate", EP1)).length;
  await gateCron();
  s2 = await lastSweep("gate");
  const row = regRow((await gate("/register")).j, EP1);
  t("attack", "b' next UTC day: the gate fetches the record again, finds it changed, drops the link", row.replica.recomputes === false && !row.replica.record_url && s2.replica_import.records_fetched >= 1, JSON.stringify(row.replica));
  t("attack", "b' ... and measures EP1 itself again, since nothing from the replica recomputes", s2.results.some((r) => r.endpoint === EP1) && (await hist("gate", EP1)).length === nBefore + 1, "");
}

// ---- (f) the gate reads the same list: the customers' endpoints are paid rows on the gate too ----
{
  const gkvF = memKv();
  const genvF = { ...gateEnv, HS_VERIFY_KV: gkvF, SWEEP_LEASE_DO: undefined, MARKETPLACE_DAILY_URL: MKT + "/admin/daily", MARKETPLACE_DAILY_TOKEN: READ_KEY };
  const gF = (p, init) => callW(gateW, genvF, CF, p, init);
  const cronF = () => cron(gateW, genvF, "gate");
  const lastF = async () => (await gF("/sweep/last")).j;
  const histF = async (ep) => ((await gF("/history?endpoint=" + encodeURIComponent(ep))).j || {}).entries || [];
  // EP1 is already on this gate as a free row someone registered (no source); EP2 is not on it.
  const pf = await gF("/watch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: EP1 }) });
  t("control", "f setup: a fresh gate with EP1 as a free row (registered over POST /watch, no source)", pf.status === 200 && pf.j.tier === "free", pf.text.slice(0, 200));
  at("2026-11-16T18:00:00.000Z");
  await replicaCron();
  at("2026-11-16T18:05:00.000Z");
  const nAuth = marketAuthSeen.length, bF = customerFetches.gate;
  await cronF();
  let sF = await lastF();
  t("control", "f the gate's cron sweep read the daily list with the key it was given and added EP2 as a paid row (role gate)",
    sF.route_sync && sF.route_sync.ok === true && sF.route_sync.role === "gate" && JSON.stringify(sF.route_sync.added) === JSON.stringify([EP2]) && marketAuthSeen.length === nAuth + 1 && marketAuthSeen.at(-1) === "Bearer " + READ_KEY, JSON.stringify(sF.route_sync));
  const wF2 = (await gF("/watch?endpoint=" + encodeURIComponent(EP2))).j, wF1 = (await gF("/watch?endpoint=" + encodeURIComponent(EP1))).j;
  t("control", "f EP2 on the gate: paid, daily, source marketplace", wF2.registered === true && wF2.tier === "paid" && wF2.cadence === "daily" && wF2.source === "marketplace", JSON.stringify(wF2));
  t("attack", "f a row the gate already had (EP1, free, no source) is not rewritten: still free, no source, named under kept_rows", wF1.tier === "free" && !wF1.source && JSON.stringify((sF.route_sync || {}).kept_rows) === JSON.stringify([EP1]), JSON.stringify(wF1));
  t("attack", "f while the replica's records recompute, the gate measures neither endpoint and makes no customer request", !sF.results.some((r) => r.endpoint === EP1 || r.endpoint === EP2) && customerFetches.gate === bF && sF.skipped.some((x) => x.endpoint === EP2 && /measured by the replica/.test(x.reason)), JSON.stringify(sF.results.map((r) => r.endpoint)));
  const dumpF = async () => { const out = []; const l = await gkvF.list({ prefix: "" }); for (const k of l.keys) out.push(k.name + "=" + (await gkvF.get(k.name))); return out.join("\n"); };
  t("attack", "f the key's value is written nowhere in the gate's store", !(await dumpF()).includes(READ_KEY), "");
  const regF = (await gF("/register")).j;
  t("control", "f the gate's register: EP2 is the gate's own row (source marketplace) carrying the replica's record link", (() => { const r = regRow(regF, EP2); return r && r.source === "marketplace" && !r.measured_by && r.replica && r.replica.recomputes === true; })(), String(JSON.stringify(regRow(regF, EP2))).slice(0, 300));
  // a sweep started over HTTP does not read the list (this worker cannot reach its own zone over HTTP)
  at("2026-11-16T18:30:00.000Z");
  const nAuth2 = marketAuthSeen.length;
  const ps = await gF("/sweep", { method: "POST", headers: { "x-sweep-token": OP_GATE } });
  sF = await lastF();
  t("control", "f POST /sweep on the gate: the list is not read, and the record says why", ps.status === 200 && sF.route_sync && sF.route_sync.skipped === true && /cron runs read the list/.test(sF.route_sync.reason) && marketAuthSeen.length === nAuth2, JSON.stringify(sF.route_sync));
  // the replica stops: after 48 hours the gate measures the customers' endpoints itself
  replicaDown = "refused";
  at("2026-11-17T18:05:00.000Z");
  await cronF();
  sF = await lastF();
  t("control", "f day 1 of the outage (within 48 hours of the replica's last record): the gate still leaves both to the replica", !sF.results.some((r) => r.endpoint === EP1 || r.endpoint === EP2), JSON.stringify(sF.results.map((r) => r.endpoint)));
  at("2026-11-18T18:05:00.000Z");
  await cronF();
  sF = await lastF();
  t("attack", "f over 48 hours without a replica record: the gate measures EP2 (its paid marketplace row) itself", sF.results.some((r) => r.endpoint === EP2) && (await histF(EP2)).length === 1, JSON.stringify(sF.results.map((r) => r.endpoint)));
  replicaDown = null;
  // EP2 leaves the list: the gate marks its row and stops measuring it; the row stays
  await market("/admin/subscriptions/" + SUB2 + "/endpoints", { method: "DELETE", headers: { authorization: "Bearer " + ADMIN, "content-type": "application/json" }, body: JSON.stringify({ endpoint: EP2 }) });
  at("2026-11-19T18:05:00.000Z");
  await cronF();
  sF = await lastF();
  const regF2 = (await gF("/register")).j;
  t("control", "f EP2 off the list: the gate marks its row, does not measure it, and still lists it with the mark", JSON.stringify((sF.route_sync || {}).unlisted) === JSON.stringify([EP2]) && !sF.results.some((r) => r.endpoint === EP2) && regRow(regF2, EP2) && regRow(regF2, EP2).marketplace_unlisted && regRow(regF2, EP2).marketplace_unlisted.since === "2026-11-19T18:05:00.000Z" && (await histF(EP2)).length === 1, JSON.stringify(sF.route_sync));
  t("attack", "f the free row EP1 (no source) is never marked by the list", !(await gF("/watch?endpoint=" + encodeURIComponent(EP1))).j.marketplace_unlisted, "");
  await market("/admin/subscriptions/" + SUB2 + "/endpoints", { method: "POST", headers: { authorization: "Bearer " + ADMIN, "content-type": "application/json" }, body: JSON.stringify({ endpoint: EP2 }) });
  // no paid seat: the gate does not add the row and says so
  const gkvG = memKv();
  const genvG = { ...genvF, HS_VERIFY_KV: gkvG, SUBREQUEST_BUDGET: "10" };
  at("2026-11-20T18:05:00.000Z");
  ACTIVE = "gate"; await gateW.scheduled({ cron: "0 18 * * *", scheduledTime: Date.now() }, genvG, CTX); await drain(); ACTIVE = "none";
  const sG = (await callW(gateW, genvG, CF, "/sweep/last")).j;
  t("attack", "f with no paid seat left (subrequest budget 10, 0 seats a run) the gate adds no row and names both as paid_capacity_full",
    sG.route_sync && sG.route_sync.ok === true && sG.route_sync.added.length === 0 && sG.route_sync.refused.length === 2 && sG.route_sync.refused.every((x) => /^paid_capacity_full/.test(x.reason)) && !(await callW(gateW, genvG, CF, "/watch?endpoint=" + encodeURIComponent(EP2))).j.registered, JSON.stringify(sG.route_sync));
}

const hz = (await gate("/health")).j, hr = (await replica("/health")).j;
t("control", "/health names where each side measures (measured_from on both)", JSON.stringify(hz.measured_from) === JSON.stringify({ platform: "cloudflare", origin: CF }) && JSON.stringify(hr.measured_from) === JSON.stringify({ platform: "azure", origin: AZ }), JSON.stringify([hz.measured_from, hr.measured_from]));

if (typeof stores.afterCheck === "function") { const c = await stores.afterCheck(); t("control", "stores: " + c.name, c.ok, c.detail); }

const passed = R.filter((r) => r.ok).length;
for (const kind of ["attack", "control"]) console.log("  " + kind.padEnd(8) + R.filter((r) => r.kind === kind && r.ok).length + " / " + R.filter((r) => r.kind === kind).length);
for (const r of R) console.log("  " + (r.ok ? "ok  " : "NG  ") + " [" + r.kind + "] " + r.name + (r.ok ? "" : "\n        " + r.detail));
console.log("stores: " + stores.label + "; customer requests: gate " + customerFetches.gate + ", replica " + customerFetches.replica);
console.log("=== " + passed + " / " + R.length + " 合格 (replica route、扉 0.4.23) ===");
process.exit(passed === R.length ? 0 : 1);
