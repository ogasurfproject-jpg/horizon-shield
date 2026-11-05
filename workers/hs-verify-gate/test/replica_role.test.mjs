// replica_role (0.4.23, 2026-11-05): the same gate code runs as a replica on another platform, set only by env vars.
//
// Why. The measuring part of this gate is to run a second time on Azure Functions for a limited set of rows. Three
// things in 0.4.22 assumed the one Cloudflare deployment: the gate's own rows were measured wherever the code ran
// (DEFAULT_WATCHLIST), the public origin was written into URLs as a constant, and every route was served. A fourth,
// the context written into probed_via ("http" or "cron"), was a module variable until 0.4.21, so an HTTP request
// arriving in the middle of a cron sweep in the same process could turn the sweep's records into "(http context)";
// 0.4.22 passes it with each call, and section 4 checks that it holds here too. 0.4.23 adds one field to
// the hashed bytes, measured_from {platform, origin}, and four env vars:
//   GATE_PLATFORM       cloudflare (default) | azure | ...    goes into measured_from.platform
//   GATE_PUBLIC_ORIGIN  https://gate.horizonshield.dev (default)   measured_from.origin, record, history and lookup URLs
//   OWN_ROWS            on (default) | off                      off: the gate's own rows are not measured
//   GATE_PATHS          all (default) | replica                 replica: only REPLICA_ROUTES are served, the rest 404
// With no vars the gate behaves as 0.4.22 except for the one field. A value that does not parse falls to the safe side.
//
// Offline: *.redteam.invalid never resolves, explorers and the ledger are stubbed to fail (legacy coordinate rule).
// 0.4.23: GET /register is on the replica's list too (it returns the Marketplace customers' rows only; test/replica_route.test.mjs).
// Run: node test/replica_role.test.mjs   (in workers/hs-verify-gate)
import worker from "../src/worker.js";
import { createHash } from "node:crypto";

const OP = "op-token-replica";
const CF_ORIGIN = "https://gate.horizonshield.dev";
const AZ_ORIGIN = "https://gate-az.horizonshield.dev";
const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const sha256 = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const jres = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
const TOOL = { name: "alpha", description: "redteam tool alpha", inputSchema: { type: "object", properties: {} } };
const CARD = { name: "Redteam Agent", description: "an adversarial mock", url: "",
  compensation: { paid_by: "public", referral_fee: false, listing_fee: false, success_fee_pct: 0, disclosure_url: "https://example.invalid/disclosure" } };

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

// The outside world. A hold on one host's tools/list lets a test run an HTTP request in the middle of a sweep.
let hold = null;   // { host, reached: Promise, reach(), release(), released: Promise }
function makeHold(host) {
  let reach, release;
  const h = { host, reached: new Promise((r) => { reach = r; }), released: new Promise((r) => { release = r; }) };
  h.reach = reach; h.release = release;
  return h;
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
globalThis.fetch = async (url, init) => outside(typeof url === "string" ? url : url.url, init);

const REPLICA_VARS = { GATE_PLATFORM: "azure", GATE_PUBLIC_ORIGIN: AZ_ORIGIN, OWN_ROWS: "off", GATE_PATHS: "replica" };
function freshEnv(extra, origin) {
  const env = Object.assign({ HS_VERIFY_KV: kv(), SWEEP_TOKEN: OP, GATE_COMMIT: "replica-local" }, extra || {});
  const O = origin || CF_ORIGIN;
  const call = (p, init) => worker.fetch(new Request(O + p, init), env, CTX);
  const post = (p, body, headers, method) => call(p, { method: method || "POST", headers: { "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) });
  const getj = async (p) => { const r = await call(p); return { status: r.status, j: await r.json() }; };
  const sweep = async (body) => { const r = await post("/sweep", body || {}, { "x-sweep-token": OP }); return { status: r.status, j: await r.json() }; };
  const cron = async () => { const ps = []; await worker.scheduled({ cron: "0 18 * * *" }, env, { waitUntil(p) { ps.push(Promise.resolve(p).catch(() => null)); } }); await Promise.all(ps); };
  const latestRecord = async (ep) => {
    const h = await getj("/history?endpoint=" + encodeURIComponent(ep));
    const e = h.j.entries[h.j.entries.length - 1];
    const r = await call("/record/" + e.record_sha256);
    const bytes = await r.text();
    return { entry: e, status: r.status, bytes, rec: JSON.parse(bytes) };
  };
  return { env, call, post, getj, sweep, cron, latestRecord };
}
const SELF = ["mcp", "hearing", "web", "jidec", "p001", "p002", "gate", "femtech", "ccdb"].map((h) => "https://" + h + ".horizonshield.dev/mcp");
const EP = "https://a.redteam.invalid/mcp";

const R = [];
const t = (kind, name, ok, detail = "") => R.push({ kind, name, ok: !!ok, detail: String(detail).slice(0, 400) });
const keysAfter = (o, k) => { const ks = Object.keys(o); const i = ks.indexOf(k); return i >= 0 ? ks[i + 1] : undefined; };

// ---- 1. no vars: as 0.4.22, plus measured_from naming Cloudflare and the gate's origin ------------------------
{
  const { post, getj, sweep, latestRecord, call } = freshEnv();
  await post("/watch", { endpoint: EP, tier: "paid" }, { "x-sweep-token": OP });
  const s = await sweep({ force: true });
  const measured = s.j.results.map((r) => r.endpoint);
  t("control", "1 no vars: the forced sweep measures the gate's own 9 rows and the registered row", s.status === 200 && SELF.every((e) => measured.includes(e)) && measured.includes(EP) && measured.length === 10, JSON.stringify(measured));
  const L = await latestRecord(EP);
  t("control", "1 no vars: the record carries measured_from {platform: cloudflare, origin: https://gate.horizonshield.dev}", JSON.stringify(L.rec.measured_from) === JSON.stringify({ platform: "cloudflare", origin: CF_ORIGIN }), JSON.stringify(L.rec.measured_from));
  t("control", "1 the field is inside the hashed bytes: SHA-256 of the bytes at /record/<sha> is record_sha256, and the bytes contain measured_from", L.status === 200 && sha256(L.bytes) === L.entry.record_sha256 && L.bytes.includes('"measured_from":{"platform":"cloudflare","origin":"https://gate.horizonshield.dev"}'), L.status);
  t("control", "1 the field sits right after probed_via (one place, so a reader comparing two records finds it at once)", keysAfter(L.rec, "probed_via") === "measured_from", Object.keys(L.rec).join(","));
  t("control", "1 no vars: probed_via of a POST /sweep is unchanged (http context, as 0.4.22)", L.rec.probed_via === "direct from the gate worker (http context)", L.rec.probed_via);
  t("control", "1 no vars: the history entry's record_url is on the gate's origin", L.entry.record_url === CF_ORIGIN + "/record/" + L.entry.record_sha256, L.entry.record_url);
  const lk = await getj("/register/lookup?endpoint=" + encodeURIComponent(EP));
  t("control", "1 no vars: /register/lookup names the gate's origin for the history, the register and a fresh reading", lk.j.conduct_record === CF_ORIGIN + "/history?endpoint=" + encodeURIComponent(EP) && lk.j.register === CF_ORIGIN + "/register" && /^POST https:\/\/gate\.horizonshield\.dev\/check /.test(lk.j.fresh_reading) && lk.j.last_measured.record_url === L.entry.record_url, JSON.stringify([lk.j.conduct_record, lk.j.register]));
  const iv = await getj("/is-verified?endpoint=" + encodeURIComponent(EP));
  t("control", "1 no vars: /is-verified history_url is on the gate's origin", iv.j.history_url === CF_ORIGIN + "/history?endpoint=" + encodeURIComponent(EP), iv.j.history_url);
  const reg = await getj("/register");
  const row = (reg.j.rows || []).find((r) => r.endpoint === EP);
  t("control", "1 no vars: the public register row's history_url is on the gate's origin", row && row.history_url === CF_ORIGIN + "/history?endpoint=" + encodeURIComponent(EP), row && row.history_url);
  const served = [];
  for (const [m, p] of [["GET", "/spec"], ["GET", "/.well-known/agent-card.json"], ["GET", "/register"], ["GET", "/openapi.json"], ["GET", "/watchlist"]]) served.push((await call(p, { method: m })).status);
  t("control", "1 no vars: every route is served (spec, card, register, openapi, watchlist answer 200)", served.every((x) => x === 200), JSON.stringify(served));
  const anon = await post("/watch", { endpoint: "https://anon.redteam.invalid/mcp" });
  t("control", "1 no vars: anyone can still add a free row with POST /watch (200, requested_by anonymous)", anon.status === 200 && (await anon.json()).requested_by === "anonymous", anon.status);
}

// ---- 2. replica vars: azure, its own origin, no own rows, a short list of routes ------------------------------
{
  const { env, post, getj, sweep, latestRecord, call } = freshEnv(REPLICA_VARS, AZ_ORIGIN);
  const noKey = await post("/watch", { endpoint: EP, tier: "paid" });
  t("attack", "2 replica: POST /watch without the operator key is refused (403), nothing is written", noKey.status === 403 && ![...env.HS_VERIFY_KV.store.keys()].some((k) => k.startsWith("watch:")), noKey.status);
  const withKey = await post("/watch", { endpoint: EP, tier: "paid" }, { "x-sweep-token": OP });
  const wj = await withKey.json();
  t("control", "2 replica: POST /watch with the operator key registers a paid row", withKey.status === 200 && wj.tier === "paid" && wj.requested_by === "operator", JSON.stringify(wj).slice(0, 200));
  const s = await sweep({ force: true });
  const measured = s.j.results.map((r) => r.endpoint);
  t("attack", "2 replica (OWN_ROWS=off): the forced sweep measures only the registered row, none of the gate's own rows", s.status === 200 && measured.length === 1 && measured[0] === EP && !SELF.some((e) => measured.includes(e)), JSON.stringify(measured));
  const L = await latestRecord(EP);
  t("control", "2 replica: measured_from is {platform: azure, origin: https://gate-az.horizonshield.dev}", JSON.stringify(L.rec.measured_from) === JSON.stringify({ platform: "azure", origin: AZ_ORIGIN }), JSON.stringify(L.rec.measured_from));
  t("control", "2 replica: the bytes at /record/<sha> hash to record_sha256", L.status === 200 && sha256(L.bytes) === L.entry.record_sha256, L.status);
  t("control", "2 replica: the record_url in the history entry is on the replica's origin", L.entry.record_url === AZ_ORIGIN + "/record/" + L.entry.record_sha256, L.entry.record_url);
  const lk = await getj("/register/lookup?endpoint=" + encodeURIComponent(EP));
  t("control", "2 replica: /register/lookup sends the history to the replica's origin and the public register and fresh readings to the gate",
    lk.status === 200 && lk.j.conduct_record === AZ_ORIGIN + "/history?endpoint=" + encodeURIComponent(EP) && lk.j.register === CF_ORIGIN + "/register" && /^POST https:\/\/gate\.horizonshield\.dev\/check /.test(lk.j.fresh_reading) && lk.j.last_measured.record_url === L.entry.record_url,
    JSON.stringify([lk.status, lk.j.conduct_record, lk.j.register]));
  const iv = await getj("/is-verified?endpoint=" + encodeURIComponent(EP));
  t("control", "2 replica: /is-verified history_url and record_url are on the replica's origin", iv.status === 200 && iv.j.history_url === AZ_ORIGIN + "/history?endpoint=" + encodeURIComponent(EP) && iv.j.record_url === L.entry.record_url, JSON.stringify([iv.j.history_url, iv.j.record_url]));
  // every listed route answers with something other than not_served_here
  const listed = [
    ["GET", "/health"], ["GET", "/record/" + L.entry.record_sha256], ["GET", "/history?endpoint=" + encodeURIComponent(EP)], ["GET", "/nenrin/window"], ["GET", "/nenrin/window/w1"],
    ["GET", "/register/lookup?endpoint=" + encodeURIComponent(EP)], ["GET", "/is-verified?endpoint=" + encodeURIComponent(EP)], ["GET", "/watch?endpoint=" + encodeURIComponent(EP)],
    ["GET", "/sweep/last"], ["GET", "/sweep/day"], ["GET", "/register"]
  ];
  const got = [];
  for (const [m, p] of listed) { const r = await call(p, { method: m }); const j = await r.json().catch(() => ({})); got.push([m + " " + p.split("?")[0], r.status, j.error || null]); }
  t("control", "2 replica: every listed GET route is served (none answers not_served_here)", got.every((g) => g[2] !== "not_served_here"), JSON.stringify(got));
  const keysBefore = [...env.HS_VERIFY_KV.store.keys()].sort().join("\n");
  const hidden = [
    ["GET", "/spec"], ["POST", "/check"], ["GET", "/check?endpoint=" + encodeURIComponent(EP)], ["POST", "/mcp"], ["GET", "/mcp"], ["POST", "/a2a"], ["GET", "/.well-known/agent-card.json"],
    ["GET", "/verified.json"], ["GET", "/e/a.redteam.invalid/mcp"], ["GET", "/embed?endpoint=" + encodeURIComponent(EP)], ["GET", "/badge?endpoint=" + encodeURIComponent(EP)],
    ["GET", "/usage"], ["GET", "/openapi.json"], ["GET", "/watchlist"], ["GET", "/changes"], ["POST", "/ae/evaluate"], ["GET", "/self"], ["GET", "/nenrin/probe"], ["POST", "/feed/batch"],
    ["GET", "/mould"], ["GET", "/keys/witness.json"], ["GET", "/"], ["PUT", "/watch"], ["POST", "/history"], ["GET", "/record"], ["GET", "/nenrin/window/x1"]
  ];
  const nh = [];
  for (const [m, p] of hidden) {
    const r = await call(p, { method: m, headers: { "content-type": "application/json", "x-sweep-token": OP }, body: m === "GET" ? undefined : "{}" });
    const j = await r.json().catch(() => ({}));
    nh.push([m + " " + p.split("?")[0], r.status, j.error || null]);
  }
  t("attack", "2 replica (GATE_PATHS=replica): every other route answers 404 not_served_here, even with the operator key (" + hidden.length + " routes)", nh.every((g) => g[1] === 404 && g[2] === "not_served_here"), JSON.stringify(nh.filter((g) => !(g[1] === 404 && g[2] === "not_served_here"))));
  const keysAfter404 = [...env.HS_VERIFY_KV.store.keys()].sort().join("\n");
  t("attack", "2 replica: the refused routes read and wrote nothing (no usage counter, no key added)", keysBefore === keysAfter404, "");
  const nf = await getj("/spec");
  t("control", "2 replica: the 404 names the gate's origin and lists the routes this origin serves", nf.j.gate === CF_ORIGIN && Array.isArray(nf.j.served) && nf.j.served.includes("GET /record/<record_sha256>") && nf.j.served.includes("POST /watch"), JSON.stringify(nf.j.served));
  const del = await post("/watch", { endpoint: EP, reason: "test removal on the replica" }, { "x-sweep-token": OP }, "DELETE");
  t("control", "2 replica: DELETE /watch with the operator key is served (the operator removes a row)", del.status === 200, del.status);
  const cron = await freshEnv(REPLICA_VARS, AZ_ORIGIN);
  await cron.post("/watch", { endpoint: EP, tier: "paid" }, { "x-sweep-token": OP });
  await cron.cron();
  const C = await cron.latestRecord(EP);
  t("control", "2 replica: a cron sweep measures the row and its record says cron context and azure", C.rec.probed_via === "direct from the gate worker (cron context)" && (C.rec.measured_from || {}).platform === "azure", JSON.stringify([C.rec.probed_via, C.rec.measured_from]));
}

// ---- 3. values that do not parse fall to the safe side ------------------------------------------------------
{
  const recOf = async (extra) => {
    const { post } = freshEnv(extra);
    const r = await post("/check", { endpoint: EP });
    return r.json();
  };
  const bad = [
    [{ GATE_PUBLIC_ORIGIN: "http://gate-az.horizonshield.dev" }, "plain http"],
    [{ GATE_PUBLIC_ORIGIN: "https://gate-az.horizonshield.dev/sub" }, "a path"],
    [{ GATE_PUBLIC_ORIGIN: "https://gate-az.horizonshield.dev/?x=1" }, "a query"],
    [{ GATE_PUBLIC_ORIGIN: "https://u:p@gate-az.horizonshield.dev" }, "credentials"],
    [{ GATE_PUBLIC_ORIGIN: "gate-az.horizonshield.dev" }, "no scheme"],
  ];
  for (const [vars, what] of bad) {
    const r = await recOf(vars);
    t("attack", "3 GATE_PUBLIC_ORIGIN with " + what + " is not used: measured_from.origin stays the gate's origin", r.measured_from && (r.measured_from || {}).origin === CF_ORIGIN, JSON.stringify(r.measured_from));
  }
  const ok = await recOf({ GATE_PUBLIC_ORIGIN: "https://gate-az.horizonshield.dev/" });
  t("control", "3 a trailing slash is accepted and dropped (the origin, not a URL)", (ok.measured_from || {}).origin === AZ_ORIGIN, JSON.stringify(ok.measured_from));
  for (const p of ["Azure", "azure functions", "", "a".repeat(40)]) {
    const r = await recOf({ GATE_PLATFORM: p });
    t("attack", "3 GATE_PLATFORM " + JSON.stringify(p.length > 20 ? p.slice(0, 8) + "..." : p) + " is not used: platform stays cloudflare", r.measured_from && (r.measured_from || {}).platform === "cloudflare", JSON.stringify(r.measured_from));
  }
  const chk = await recOf({});
  t("control", "3 POST /check (on demand, http context) carries the field too, with the defaults", JSON.stringify(chk.measured_from) === JSON.stringify({ platform: "cloudflare", origin: CF_ORIGIN }) && chk.probed_via === "direct from the gate worker (http context)", JSON.stringify([chk.measured_from, chk.probed_via]));
  const selfRows = async (extra) => { const { getj } = freshEnv(Object.assign({ GATE_PATHS: "all" }, extra)); const w = await getj("/watchlist"); return w.j.watched.filter((x) => x.tier === "self").length; };
  t("control", "3 OWN_ROWS unset or on: the 9 own rows are on the list", (await selfRows({})) === 9 && (await selfRows({ OWN_ROWS: "on" })) === 9 && (await selfRows({ OWN_ROWS: "ON" })) === 9, "");
  t("attack", "3 OWN_ROWS off, or a mistyped value: the own rows are left out (the safe side for a replica)", (await selfRows({ OWN_ROWS: "off" })) === 0 && (await selfRows({ OWN_ROWS: "of" })) === 0 && (await selfRows({ OWN_ROWS: "false" })) === 0, "");
  const pathsOf = async (v) => { const { call } = freshEnv(v === undefined ? {} : { GATE_PATHS: v }); return (await call("/spec")).status; };
  t("control", "3 GATE_PATHS unset or all: /spec is served", (await pathsOf(undefined)) === 200 && (await pathsOf("all")) === 200 && (await pathsOf("ALL")) === 200, "");
  t("attack", "3 GATE_PATHS replica, or a mistyped value: /spec is not served (the safe side)", (await pathsOf("replica")) === 404 && (await pathsOf("replcia")) === 404 && (await pathsOf("none")) === 404, "");
}

// ---- 4. probed_via and the sweep's fetch count are per call: an HTTP request in the middle of a cron sweep -------
{
  const HELD = "https://held.redteam.invalid/mcp";
  const run = async (concurrent) => {
    const g = freshEnv({ OWN_ROWS: "off" });
    await g.post("/watch", { endpoint: HELD, tier: "paid" }, { "x-sweep-token": OP });
    hold = makeHold("held.redteam.invalid");
    const cronDone = g.cron();
    await hold.reached;   // the cron sweep is now inside runCheck for HELD, waiting on tools/list
    let check = null;
    if (concurrent) check = await (await g.post("/check", { endpoint: "https://other.redteam.invalid/mcp" })).json();
    hold.release();
    await cronDone;
    hold = null;
    const L = await g.latestRecord(HELD);
    const last = await g.getj("/sweep/last");
    return { rec: L.rec, check, used: last.j.subrequests && last.j.subrequests.used };
  };
  const base = await run(false);
  const both = await run(true);
  t("control", "4 baseline: a cron sweep alone writes probed_via (cron context)", base.rec.probed_via === "direct from the gate worker (cron context)", base.rec.probed_via);
  t("attack", "4 an HTTP POST /check served while the cron sweep is in the middle of a row does not change that row's probed_via (still cron context)", both.rec.probed_via === "direct from the gate worker (cron context)", both.rec.probed_via);
  t("control", "4 ... and the on-demand check says http context", both.check && both.check.probed_via === "direct from the gate worker (http context)", both.check && both.check.probed_via);
  t("attack", "4 ... and the fetches of the HTTP check are not counted in the sweep's budget (same count as the sweep alone: " + base.used + ")", typeof base.used === "number" && base.used > 0 && both.used === base.used, JSON.stringify([base.used, both.used]));
}

// ---- 5. records without measured_from (before 0.4.23) still read --------------------------------------------
{
  const { env, post, getj, sweep, latestRecord, call } = freshEnv();
  await post("/watch", { endpoint: EP, tier: "paid" }, { "x-sweep-token": OP });
  await sweep({ force: true });
  const L = await latestRecord(EP);
  // Make the 0.4.22 shape of the same record: the bytes without the field, stored under their own sha, and a history
  // entry pointing at them, as a 0.4.22 sweep would have left them.
  const old = JSON.parse(L.bytes); delete old.measured_from; old.gate_version = "0.4.22";
  const oldBytes = JSON.stringify(old); const oldSha = sha256(oldBytes);
  env.HS_VERIFY_KV.store.set("rec:" + oldSha, oldBytes);
  const hk = [...env.HS_VERIFY_KV.store.keys()].find((k) => k.startsWith("hist:") && JSON.parse(env.HS_VERIFY_KV.store.get(k)).entries.some((e) => e.record_sha256 === L.entry.record_sha256));
  const h = JSON.parse(env.HS_VERIFY_KV.store.get(hk));
  h.entries = [Object.assign({}, L.entry, { record_sha256: oldSha, record_url: CF_ORIGIN + "/record/" + oldSha, at: "2026-11-01T18:00:00.000Z" })];
  env.HS_VERIFY_KV.store.set(hk, JSON.stringify(h));
  const r = await call("/record/" + oldSha); const b = await r.text();
  t("control", "5 an old record (no measured_from) is served as stored and still hashes to its sha", r.status === 200 && b === oldBytes && sha256(b) === oldSha, r.status);
  const lk = await getj("/register/lookup?endpoint=" + encodeURIComponent(EP));
  const iv = await getj("/is-verified?endpoint=" + encodeURIComponent(EP));
  t("control", "5 /register/lookup and /is-verified read a history whose latest entry points at an old record", lk.status === 200 && lk.j.last_measured.record_sha256 === oldSha && iv.status === 200 && iv.j.record_sha256 === oldSha, JSON.stringify([lk.status, iv.status]));
  const s2 = await sweep({ force: true });
  const L2 = await latestRecord(EP);
  const hist = await getj("/history?endpoint=" + encodeURIComponent(EP));
  t("control", "5 the next sweep appends a new record (with the field) after the old entry; the old entry is left as it was", s2.status === 200 && hist.j.entries.length === 2 && hist.j.entries[0].record_sha256 === oldSha && L2.rec.measured_from && (L2.rec.measured_from || {}).platform === "cloudflare", JSON.stringify([s2.status, hist.j.entries.length]));
  t("control", "5 an old entry and a new one with the same conditions are not reported as a change (the field is not a condition)", s2.j.results.find((x) => x.endpoint === EP).changed === false, JSON.stringify(s2.j.results.find((x) => x.endpoint === EP)));
}

// ---- report ------------------------------------------------------------------------------------------------
const kinds = {};
for (const r of R) { const k = kinds[r.kind] || [0, 0]; kinds[r.kind] = [k[0] + (r.ok ? 1 : 0), k[1] + 1]; }
console.log("--- 種別 ---");
for (const k of ["attack", "control"]) if (kinds[k]) console.log("  " + k.padEnd(10) + " " + kinds[k][0] + " / " + kinds[k][1]);
for (const r of R) console.log((r.ok ? "  ok   " : "  NG   ") + "[" + r.kind + "] " + r.name + (r.ok ? "" : "\n      " + r.detail));
const passed = R.filter((r) => r.ok).length;
console.log("=== " + passed + " / " + R.length + " 合格 (replica role、扉 0.4.23) ===");
process.exit(passed === R.length ? 0 : 1);
