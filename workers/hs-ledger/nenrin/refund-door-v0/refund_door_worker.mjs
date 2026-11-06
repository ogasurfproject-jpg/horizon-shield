// refund_door_worker.mjs: the hosted refund sandbox door at ledger.horizonshield.dev/sandbox/refund (the ledger worker
// routes /sandbox/refund* here). What it decides is refund_door_v0.mjs; this file adds the Cloudflare parts:
//
//   GET  /sandbox/refund                                  what the door is, its key, contract, pins and limits
//   GET  /sandbox/refund/keys/admission-door.json         the door's public key (role admission-door)
//   GET  /sandbox/refund/contract                         the sandbox contract, canonical text
//   POST /sandbox/refund/admit     x-hs-sandbox-key       {run_id, inputs | inputs_b64}: one live admission request
//   POST /sandbox/refund/replay    x-hs-sandbox-key       {requests: [{run_id, inputs | inputs_b64, consumed_at}]}
//
// The ledger's own routes do not decide anything (admission_intake.mjs stores and anchors what doors signed). This door
// decides, so it lives apart: its own path, its own Durable Object (RefundDoorDO, the single-use state), its own key
// (secret REFUND_DOOR_KEY, public key in door_key.mjs). It sends nothing to the ledger's intake; a record it signs
// reaches the ledger only if someone posts it there like any other door's.
//
// The sandbox key. POST needs the header x-hs-sandbox-key, handed to the runner owner out of band; the worker holds
// only its sha256 (secret REFUND_SANDBOX_KEY_SHA256). It authenticates the runner's channel, which is how the runner's
// PIC result reaches the door (profile section 6). Without both secrets and the public key the door answers 503
// door_unavailable and decides nothing.
//
// The Bitcoin view (chain_view in the a2a-admission-v0 record) is the gate's beacon rule: the second highest tip of
// three explorers, the block hash at that height and its 80-byte header agreed by two. Without a view the door answers
// 503 chain_view_unavailable and consumes nothing.
import { createHash, timingSafeEqual } from "node:crypto";
import * as door from "./refund_door_v0.mjs";
// The APS SDK is loaded on the first admission request, not when the module loads: the ledger's Node tests import the
// worker without installing the adapter's pinned package, and only the door needs it. wrangler bundles it either way.
let SDK = null;
const loadSdk = async () => (SDK ||= await import("./sdk_subset.mjs"));
export const SDK_FILES = ["v2/receipt-core/receipt.js", "v2/receipt-core/composite.js", "v2/action-reference/v2.js"]
  .map((f) => "workers/hs-ledger/nenrin/musubi-v0/adapters/aps_receipt/node_modules/agent-passport-system/dist/src/" + f);
import { DOOR_KEY } from "./door_key.mjs";
import { CONTRACT_TEXT, CONTRACT_SHA256 } from "./sandbox_contract.mjs";

export const BASE = "/sandbox/refund";
export const EXPLORERS = ["https://mempool.space/api", "https://blockstream.info/api", "https://mempool.emzy.de/api"];
const MAX_BODY = 16 << 20;
const sha256 = (b) => createHash("sha256").update(b).digest();
const json = (o, status = 200) => new Response(JSON.stringify(o, null, 1) + "\n", { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });

// The door's key, or why there is none. The seed must give the public key door_key.mjs names.
export function doorFrom(env, pinned = DOOR_KEY) {
  if (!pinned) return { why: "door_key_not_published" };
  if (!env || typeof env.REFUND_DOOR_KEY !== "string") return { why: "door_key_not_set" };
  let d;
  try { d = door.doorKeyFromSeed(env.REFUND_DOOR_KEY, pinned.key_id); } catch { return { why: "door_key_unreadable" }; }
  if (d.public_key_ed25519_b64 !== pinned.public_key_ed25519_b64) return { why: "door_key_not_the_published_key" };
  return { door: d };
}

const sandboxKeySet = (env) => !!env && typeof env.REFUND_SANDBOX_KEY_SHA256 === "string" && /^[0-9a-f]{64}$/.test(env.REFUND_SANDBOX_KEY_SHA256);
function sandboxKeyOk(request, env) {
  if (!sandboxKeySet(env)) return { why: "sandbox_key_not_set", status: 503 };
  const want = Buffer.from(env.REFUND_SANDBOX_KEY_SHA256, "hex");
  const got = request.headers.get("x-hs-sandbox-key");
  if (!got) return { why: "sandbox_key_missing", status: 401 };
  return timingSafeEqual(sha256(Buffer.from(got, "utf8")), want) ? null : { why: "sandbox_key_wrong", status: 403 };
}

async function text(fetchImpl, url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetchImpl(url, { signal: ctl.signal, headers: { accept: "text/plain" } });
    if (!r.ok) throw new Error(url + " answered " + r.status);
    return (await r.text()).trim();
  } finally { clearTimeout(t); }
}
function agreed(values) {
  const n = new Map();
  for (const v of values) if (v !== null) n.set(v, (n.get(v) || 0) + 1);
  for (const [v, c] of n) if (c >= 2) return v;
  return null;
}
export async function chainView(fetchImpl = fetch, explorers = EXPLORERS, ms = 6000) {
  const tips = await Promise.allSettled(explorers.map((e) => text(fetchImpl, e + "/blocks/tip/height", ms)));
  const up = [];
  tips.forEach((t, i) => { if (t.status === "fulfilled" && /^[0-9]{1,9}$/.test(t.value)) up.push({ e: explorers[i], h: Number(t.value) }); });
  if (up.length < 2) throw new Error("fewer than two block sources answered with a tip (" + up.length + ")");
  const height = up.map((x) => x.h).sort((a, b) => b - a)[1];
  const at = up.filter((x) => x.h >= height);
  const hv = (await Promise.allSettled(at.map((x) => text(fetchImpl, x.e + "/block-height/" + height, ms)))).map((r) => (r.status === "fulfilled" && /^[0-9a-f]{64}$/.test(r.value) ? r.value : null));
  const hash = agreed(hv);
  if (!hash) throw new Error("no two block sources agree on the block at " + height);
  const same = at.filter((_x, i) => hv[i] === hash);
  const header = agreed((await Promise.allSettled(same.map((x) => text(fetchImpl, x.e + "/block/" + hash + "/header", ms)))).map((r) => (r.status === "fulfilled" && /^[0-9a-f]{160}$/.test(r.value) ? r.value : null)));
  if (!header) throw new Error("no two block sources agree on the header of " + hash);
  const raw = Buffer.from(header, "hex");
  if (Buffer.from(sha256(sha256(raw))).reverse().toString("hex") !== hash) throw new Error("the header does not hash to the block hash at " + height);
  return { height, header_sha256: sha256(raw).toString("hex"), block_hash: hash, sources: same.map((x) => new URL(x.e).host) };
}
// A test may point the view at its own stand-in explorers on this machine; nothing else is accepted.
function explorersOf(env) {
  const v = env && typeof env.REFUND_TEST_EXPLORERS === "string" ? env.REFUND_TEST_EXPLORERS.split(",").map((s) => s.trim()).filter(Boolean) : null;
  return v && v.length === 3 && v.every((u) => /^http:\/\/127\.0\.0\.1:[0-9]{2,5}\/api$/.test(u)) ? v : EXPLORERS;
}

export function selfDescription(origin, env) {
  const d = doorFrom(env);
  return {
    service: "refund sandbox admission door", profile: door.PROFILE, contract_revision: door.CONTRACT_REVISION,
    issue: "https://github.com/aeoess/agent-governance-vocabulary/issues/193",
    ready: !!d.door && sandboxKeySet(env), why_not_ready: d.why || (sandboxKeySet(env) ? null : "sandbox_key_not_set"),
    key: DOOR_KEY ? door.keyDocument({ key_id: DOOR_KEY.key_id, public_key_ed25519_b64: DOOR_KEY.public_key_ed25519_b64 }, DOOR_KEY.not_before) : null,
    key_url: door.CONFIG.key_url, scope: { workflow_id: door.CONFIG.workflow_id, admission_issuer: door.CONFIG.admission_issuer, provider_namespace: door.CONFIG.provider_namespace },
    contract: { url: origin + BASE + "/contract", contract_id: door.CONTRACT.contract_id, contract_sha256: CONTRACT_SHA256, limits: door.CONTRACT.grant.limits },
    admit: { method: "POST", url: origin + BASE + "/admit", header: "x-hs-sandbox-key", body: "{run_id, inputs: {<the eleven files as strings>}} or {run_id, inputs_b64: {...}}", files: door.FILES },
    replay: { method: "POST", url: origin + BASE + "/replay", body: "{requests: [{run_id, inputs | inputs_b64, consumed_at}]}", note: "a fresh state in memory and the caller's instants; the live state is not read or written; records say replay" },
    records: { committed: door.ADMISSION_SCHEMA, signed: [door.RECORD_SCHEMA + " (version 0.1)", door.MAPPING_SCHEMA, door.REPLAY_SCHEMA], role: door.DOOR_ROLE,
      verify: "workers/hs-ledger/nenrin/refund-door-v0/verify_answer.mjs; a2a-admission-v0 also with workers/hs-ledger/nenrin/musubi-v0/admission_verify_v0.{py,mjs}" },
    window_seconds: door.CONFIG.window_seconds, evaluator_sha256: door.EVALUATOR_SHA256, sdk: { package: "agent-passport-system", version: "8.0.1", pins: "workers/hs-ledger/nenrin/musubi-v0/adapters/aps_receipt/PINS.json", files: SDK_FILES },
    chain_view_sources: explorersOf(env).map((u) => new URL(u).host),
    does_not_establish: door.NOT_ESTABLISHED,
  };
}

export async function handleRefundSandbox(request, env, url) {
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const origin = url.origin;
  if (request.method === "GET" && p === BASE) return json(selfDescription(origin, env));
  if (request.method === "GET" && p === BASE + "/contract") return new Response(CONTRACT_TEXT, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
  if (request.method === "GET" && p === BASE + "/keys/admission-door.json") {
    if (!DOOR_KEY) return json({ error: "door_key_not_published" }, 404);
    return json(door.keyDocument({ key_id: DOOR_KEY.key_id, public_key_ed25519_b64: DOOR_KEY.public_key_ed25519_b64 }, DOOR_KEY.not_before));
  }
  if (request.method === "POST" && (p === BASE + "/admit" || p === BASE + "/replay")) {
    const bad = sandboxKeyOk(request, env);
    if (bad) return json({ error: bad.why }, bad.status);
    const d = doorFrom(env);
    if (!d.door) return json({ error: "door_unavailable", why: d.why }, 503);
    const len = Number(request.headers.get("content-length") || "0");
    if (len > MAX_BODY) return json({ error: "body_over_16_mib" }, 413);
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: "body_over_16_mib" }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: "body_not_json" }, 400); }
    let view;
    try { view = await chainView(fetch, explorersOf(env)); } catch (e) { return json({ error: "chain_view_unavailable", detail: e.message, consumed: false }, 503); }
    if (p === BASE + "/replay") {
      const r = await door.replaySequence(body && body.requests, { sdk: await loadSdk(), door: d.door, chainView: view });
      return json({ ...r.body, chain_view: view }, r.status);
    }
    const req = door.readRequest(body);
    if (req.error) return json({ error: req.error, file: req.file || null }, 400);
    if (!env.REFUND_DOOR_DO) return json({ error: "door_unavailable", why: "state_not_bound" }, 503);
    const stub = env.REFUND_DOOR_DO.get(env.REFUND_DOOR_DO.idFromName("refund-sandbox/" + door.CONFIG.workflow_id));
    const r = await stub.fetch("https://refund-door.internal/admit", { method: "POST", body: JSON.stringify({ request: body, chain_view: view }) });
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
  }
  return json({ error: "not_found", see: origin + BASE }, 404);
}

// The single-use state. One instance per workflow; every admission request of the workflow runs inside
// blockConcurrencyWhile, so the read and the write of one request have no other request between them.
export class RefundDoorDO {
  constructor(state, env) {
    this.state = state; this.env = env;
    state.blockConcurrencyWhile(async () => {
      state.storage.sql.exec("CREATE TABLE IF NOT EXISTS consumed (scope TEXT PRIMARY KEY, row TEXT NOT NULL)");
    });
  }
  async fetch(request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/admit") return json({ error: "not_found" }, 404);
    const { request: body, chain_view } = await request.json();
    const d = doorFrom(this.env);
    if (!d.door) return json({ error: "door_unavailable", why: d.why }, 503);
    const sql = this.state.storage.sql;
    const state = {
      get: (k) => { const r = sql.exec("SELECT row FROM consumed WHERE scope = ?", k).toArray(); return r.length ? JSON.parse(r[0].row) : null; },
      put: (k, v) => { sql.exec("INSERT INTO consumed (scope, row) VALUES (?, ?)", k, JSON.stringify(v)); },
    };
    const sdk = await loadSdk();
    return this.state.blockConcurrencyWhile(async () => {
      const req = door.readRequest(body);
      if (req.error) return json({ error: req.error }, 400);
      const consumed_at = door.isoMs(Date.now());
      const r = await door.decide({ files: req.files, run_id: req.run_id, consumed_at, clock_source: "the door host's clock (Cloudflare Workers Date.now() in the Durable Object, read once per request before the checks)" },
        { sdk, state, door: d.door, chainView: chain_view });
      return json({ ...r.body, chain_view }, r.status);
    });
  }
}
