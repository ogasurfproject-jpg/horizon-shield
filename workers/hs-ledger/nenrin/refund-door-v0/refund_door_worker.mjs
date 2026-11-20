// refund_door_worker.mjs: the hosted refund sandbox door at ledger.horizonshield.dev/sandbox/refund (the ledger worker
// routes /sandbox/refund* here). What it decides is refund_door_v0.mjs; this file adds the Cloudflare parts:
//
//   GET  /sandbox/refund                                  what the door is, its key, contract, pins and limits
//   GET  /sandbox/refund/keys/admission-door.json         the door's public key (role admission-door)
//   GET  /sandbox/refund/contract                         the sandbox contract, canonical text
//   POST /sandbox/refund/admit     x-hs-sandbox-key       {run_id, inputs | inputs_b64}: one live admission request
//   POST /sandbox/refund/replay    x-hs-sandbox-key       {requests: [{run_id, inputs | inputs_b64, consumed_at}]}
//   GET  /sandbox/refund/log                              the door's record: every run with its record count and head,
//                                                         and the requests without the sandbox key counted per day
//   GET  /sandbox/refund/log/run?run_id=<run_id>          one run's records, JSON Lines (no bytes); /log/unnamed: the
//                                                         requests without a readable run_id
//   GET  /sandbox/refund/log/bytes/<seq>  x-hs-log-key    the bytes of one record (a request body or an answer body)
//
// The record (refund_door_log.mjs, since 2026-11): every /admit with the sandbox key writes a request record before the
// door decides and an answer record after, the bytes of both, each record chained to the one before in its run. A commit
// writes its single-use row and its answer record in one transaction. When a record cannot be written the door answers
// 503 log_unavailable and consumes nothing. /replay is not recorded.
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
import * as log from "./refund_door_log.mjs";

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

const hexKeySet = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const logKeySet = (env) => !!env && hexKeySet(env.REFUND_LOG_KEY_SHA256);
function logKeyOk(request, env) {
  if (!logKeySet(env)) return { why: "log_key_not_set", status: 503 };
  const got = request.headers.get("x-hs-log-key");
  if (!got) return { why: "log_key_missing", status: 401 };
  return timingSafeEqual(sha256(Buffer.from(got, "utf8")), Buffer.from(env.REFUND_LOG_KEY_SHA256, "hex")) ? null : { why: "log_key_wrong", status: 403 };
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

export function selfDescription(origin, env, pinned = DOOR_KEY) {
  const d = doorFrom(env, pinned);
  return {
    service: "refund sandbox admission door", profile: door.PROFILE, contract_revision: door.CONTRACT_REVISION,
    issue: "https://github.com/aeoess/agent-governance-vocabulary/issues/193",
    ready: !!d.door && sandboxKeySet(env), why_not_ready: d.why || (sandboxKeySet(env) ? null : "sandbox_key_not_set"),
    key: pinned ? door.keyDocument({ key_id: pinned.key_id, public_key_ed25519_b64: pinned.public_key_ed25519_b64 }, pinned.not_before) : null,
    key_url: door.CONFIG.key_url, scope: { workflow_id: door.CONFIG.workflow_id, admission_issuer: door.CONFIG.admission_issuer, provider_namespace: door.CONFIG.provider_namespace },
    contract: { url: origin + BASE + "/contract", contract_id: door.CONTRACT.contract_id, contract_sha256: CONTRACT_SHA256, limits: door.CONTRACT.grant.limits },
    admit: { method: "POST", url: origin + BASE + "/admit", header: "x-hs-sandbox-key", body: "{run_id, inputs: {<the eleven files as strings>}} or {run_id, inputs_b64: {...}}", files: door.FILES },
    replay: { method: "POST", url: origin + BASE + "/replay", body: "{requests: [{run_id, inputs | inputs_b64, consumed_at}]}", note: "a fresh state in memory and the caller's instants; the live state is not read or written; records say replay" },
    records: { committed: door.ADMISSION_SCHEMA, signed: [door.RECORD_SCHEMA + " (version 0.1)", door.MAPPING_SCHEMA, door.REPLAY_SCHEMA], role: door.DOOR_ROLE,
      verify: "workers/hs-ledger/nenrin/refund-door-v0/verify_answer.mjs; a2a-admission-v0 also with workers/hs-ledger/nenrin/musubi-v0/admission_verify_v0.{py,mjs}" },
    window_seconds: door.CONFIG.window_seconds, evaluator_sha256: door.EVALUATOR_SHA256, sdk: { package: "agent-passport-system", version: "8.0.1", pins: "workers/hs-ledger/nenrin/musubi-v0/adapters/aps_receipt/PINS.json", files: SDK_FILES },
    chain_view_sources: explorersOf(env).map((u) => new URL(u).host),
    does_not_establish: door.NOT_ESTABLISHED,
    log: { schema: log.LOG_SCHEMA, runs: origin + BASE + "/log?after=<run_id>&limit=<1..1000>", run: origin + BASE + "/log/run?run_id=<run_id>&after=<seq>&limit=<1..1000>", unnamed: origin + BASE + "/log/unnamed",
      limits: { kept_bytes: log.LOG_CAP_BYTES, over: "507 log_full before the decision, nothing consumed, counted per day", page_max: log.PAGE_MAX, next: "header x-hs-log-next (runs: next_after)" },
      bytes: { url: origin + BASE + "/log/bytes/<seq>", header: "x-hs-log-key", ready: logKeySet(env) }, records: "every /admit with the sandbox key: a request record before the decision, an answer record after, the bytes of both; /replay is not recorded",
      chain: "record_sha256 = sha256 of the musubi-canonical-v0 bytes of the record without record_sha256; prev_record_sha256 names the record before in the same run (64 zeros for the first); the last is the run's head",
      does_not_establish: log.LOG_DOES_NOT_ESTABLISH },
  };
}

// The answer text exactly as json() writes it, so that the record holds the bytes the caller receives.
const answerText = (o) => JSON.stringify(o, null, 1) + "\n";
const ANSWER_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" };
const LOG_UNAVAILABLE = (detail) => ({ status: 503, text: answerText({ error: "log_unavailable", detail, consumed: false }) });

// The door's routes and its Durable Object, for one pinned public key. The worker uses the published key (below); the
// tests make one with their own key, which is how they reach a commit through the routes without the door's seed.
export function makeDoor({ pinned = DOOR_KEY, logCapBytes = log.LOG_CAP_BYTES } = {}) {
  const stubOf = (env) => env.REFUND_DOOR_DO.get(env.REFUND_DOOR_DO.idFromName("refund-sandbox/" + door.CONFIG.workflow_id));

  // POST /admit. The worker's own answers (door unavailable, 413, 400, 503 chain_view_unavailable) are the same, in the
  // same order, as before the record; they now go through the Durable Object too, so that they are recorded.
  async function admit(request, env) {
    const received_at = door.isoMs(Date.now());
    let pre = null, bytes = null, view = null, sha = null, length = null, declared = null, note = null, keep = false;
    const d = doorFrom(env, pinned);
    const len = Number(request.headers.get("content-length") || "0");
    if (!d.door) { pre = { status: 503, text: answerText({ error: "door_unavailable", why: d.why }) }; note = "body not read: the door was unavailable"; declared = len; }
    else if (len > MAX_BODY) { pre = { status: 413, text: answerText({ error: "body_over_16_mib" }) }; note = "body not read: content-length over 16 MiB"; declared = len; }
    else {
      bytes = new Uint8Array(await request.arrayBuffer());
      sha = sha256(bytes).toString("hex"); length = bytes.length; keep = true;
      const raw = new TextDecoder().decode(bytes);
      let body;
      if (raw.length > MAX_BODY) { pre = { status: 413, text: answerText({ error: "body_over_16_mib" }) }; keep = false; note = "body over 16 MiB: sha256 and length, not the bytes"; }
      else {
        try { body = JSON.parse(raw); } catch { pre = { status: 400, text: answerText({ error: "body_not_json" }) }; }
        if (!pre) {
          try { view = await chainView(fetch, explorersOf(env)); } catch (e) { pre = { status: 503, text: answerText({ error: "chain_view_unavailable", detail: e.message, consumed: false }) }; }
        }
        if (!pre) {
          const req = door.readRequest(body);
          if (req.error) pre = { status: 400, text: answerText({ error: req.error, file: req.file || null }) };
        }
      }
    }
    if (!env.REFUND_DOOR_DO) return json({ error: "door_unavailable", why: "state_not_bound" }, 503);
    const meta = new TextEncoder().encode(JSON.stringify({ pre, view, received_at, sha256: sha, length, declared_length: declared, note, kept: keep }));
    const body = keep ? bytes : new Uint8Array(0);
    const frame = new Uint8Array(4 + meta.length + body.length);
    new DataView(frame.buffer).setUint32(0, meta.length);
    frame.set(meta, 4); frame.set(body, 4 + meta.length);
    const r = await stubOf(env).fetch("https://refund-door.internal/admit", { method: "POST", body: frame });
    return new Response(r.body, { status: r.status, headers: ANSWER_HEADERS });
  }

  async function handleRefundSandbox(request, env, url) {
    const p = url.pathname.replace(/\/+$/, "") || "/";
    const origin = url.origin;
    if (request.method === "GET" && p === BASE) return json(selfDescription(origin, env, pinned));
    if (request.method === "GET" && p === BASE + "/contract") return new Response(CONTRACT_TEXT, { headers: ANSWER_HEADERS });
    if (request.method === "GET" && p === BASE + "/keys/admission-door.json") {
      if (!pinned) return json({ error: "door_key_not_published" }, 404);
      return json(door.keyDocument({ key_id: pinned.key_id, public_key_ed25519_b64: pinned.public_key_ed25519_b64 }, pinned.not_before));
    }
    if (request.method === "GET" && (p === BASE + "/log" || p === BASE + "/log/run" || p === BASE + "/log/unnamed" || p.startsWith(BASE + "/log/bytes/"))) {
      if (!env.REFUND_DOOR_DO) return json({ error: "door_unavailable", why: "state_not_bound" }, 503);
      let q;
      if (p === BASE + "/log") q = "/log";
      else if (p === BASE + "/log/unnamed") q = "/log/run?unnamed=1";
      else if (p === BASE + "/log/run") {
        const run = url.searchParams.get("run_id");
        if (run === null || !/^[A-Za-z0-9._:-]{1,128}$/.test(run)) return json({ error: "run_id" }, 400);
        q = "/log/run?run_id=" + encodeURIComponent(run);
      } else q = null;
      if (q !== null && q !== "/log") {
        const a = url.searchParams.get("after"), l = url.searchParams.get("limit");
        if ((a !== null && !/^(0|[1-9][0-9]{0,11})$/.test(a)) || (l !== null && !/^[1-9][0-9]{0,3}$/.test(l))) return json({ error: "after_or_limit" }, 400);
        if (a !== null) q += "&after=" + a;
        if (l !== null) q += "&limit=" + l;
      }
      if (q === "/log") {
        const a = url.searchParams.get("after"), l = url.searchParams.get("limit");
        if ((a !== null && !/^[A-Za-z0-9._:-]{0,128}$/.test(a)) || (l !== null && !/^[1-9][0-9]{0,3}$/.test(l))) return json({ error: "after_or_limit" }, 400);
        q = "/log?x=1" + (a !== null ? "&after=" + encodeURIComponent(a) : "") + (l !== null ? "&limit=" + l : "");
      }
      if (q === null) {
        const seq = p.slice((BASE + "/log/bytes/").length);
        if (!/^[1-9][0-9]{0,11}$/.test(seq)) return json({ error: "seq" }, 400);
        const bad = logKeyOk(request, env);
        if (bad) return json({ error: bad.why }, bad.status);
        q = "/log/bytes?seq=" + seq;
      }
      const r = await stubOf(env).fetch("https://refund-door.internal" + q);
      return new Response(r.body, { status: r.status, headers: r.headers });
    }
    if (request.method === "POST" && p === BASE + "/admit") {
      const bad = sandboxKeyOk(request, env);
      if (bad) {
        if (env && env.REFUND_DOOR_DO) {
          try { await stubOf(env).fetch("https://refund-door.internal/denied", { method: "POST", body: JSON.stringify({ day: new Date().toISOString().slice(0, 10), status: bad.status, why: bad.why }) }); } catch { /* the count is best effort; the answer stays */ }
        }
        return json({ error: bad.why }, bad.status);
      }
      return admit(request, env);
    }
    if (request.method === "POST" && p === BASE + "/replay") {
      const bad = sandboxKeyOk(request, env);
      if (bad) return json({ error: bad.why }, bad.status);
      const d = doorFrom(env, pinned);
      if (!d.door) return json({ error: "door_unavailable", why: d.why }, 503);
      const len = Number(request.headers.get("content-length") || "0");
      if (len > MAX_BODY) return json({ error: "body_over_16_mib" }, 413);
      const raw = await request.text();
      if (raw.length > MAX_BODY) return json({ error: "body_over_16_mib" }, 413);
      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: "body_not_json" }, 400); }
      let view;
      try { view = await chainView(fetch, explorersOf(env)); } catch (e) { return json({ error: "chain_view_unavailable", detail: e.message, consumed: false }, 503); }
      const r = await door.replaySequence(body && body.requests, { sdk: await loadSdk(), door: d.door, chainView: view });
      return json({ ...r.body, chain_view: view }, r.status);
    }
    return json({ error: "not_found", see: origin + BASE }, 404);
  }

  // The single-use state and the record. One instance per workflow; every admission request of the workflow runs inside
  // blockConcurrencyWhile, so the read and the write of one request, and its two records, have no other request between
  // them.
  class RefundDoorDO {
    constructor(state, env) {
      this.state = state; this.env = env;
      state.blockConcurrencyWhile(async () => {
        state.storage.sql.exec("CREATE TABLE IF NOT EXISTS consumed (scope TEXT PRIMARY KEY, row TEXT NOT NULL)");
        log.createTables(state.storage.sql);
      });
    }
    async fetch(request) {
      const u = new URL(request.url);
      const sql = this.state.storage.sql;
      const num = (k, d) => (u.searchParams.has(k) ? Number(u.searchParams.get(k)) : d);
      if (request.method === "GET" && u.pathname === "/log") {
        const t = log.listRuns(sql, { after: u.searchParams.has("after") ? u.searchParams.get("after") : null, limit: num("limit", log.PAGE_MAX) });
        return json({ schema: log.LOG_SCHEMA, workflow_id: door.CONFIG.workflow_id, limit_bytes: logCapBytes, used_bytes: log.usedBytes(sql), page_max: log.PAGE_MAX, ...t });
      }
      if (request.method === "GET" && u.pathname === "/log/run") {
        const run = u.searchParams.get("unnamed") === "1" ? null : u.searchParams.get("run_id");
        const h = log.runHead(sql, run);
        if (!h) return json({ error: "no_records" }, 404);
        const { lines, next } = log.runLines(sql, run, { after: num("after", 0), limit: num("limit", log.PAGE_MAX) });
        const hd = { ...ANSWER_HEADERS, "content-type": "application/x-ndjson; charset=utf-8", "x-hs-log-head": h.head, "x-hs-log-records": String(h.records), "x-hs-log-lines": String(lines.length) };
        if (next !== null) hd["x-hs-log-next"] = String(next);
        return new Response(lines.length ? lines.join("\n") + "\n" : "", { headers: hd });
      }
      if (request.method === "GET" && u.pathname === "/log/bytes") {
        const got = log.recordBytes(sql, Number(u.searchParams.get("seq")));
        if (!got) return json({ error: "no_record" }, 404);
        if (got.rec.kind === "request" && !got.rec.body_kept) return json({ error: "no_bytes_kept", note: got.rec.note }, 404);
        if (!got.bytes) return json({ error: "parts_missing" }, 500);
        return new Response(got.bytes, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store", "x-hs-log-sha256": got.rec.sha256, "x-hs-log-length": String(got.rec.length), "x-hs-log-kind": got.rec.kind } });
      }
      if (request.method === "POST" && u.pathname === "/denied") {
        const { day, status, why } = await request.json();
        log.countDenied(sql, String(day).slice(0, 10), Number(status), String(why).slice(0, 64));
        return json({ ok: true });
      }
      if (request.method !== "POST" || u.pathname !== "/admit") return json({ error: "not_found" }, 404);
      const frame = new Uint8Array(await request.arrayBuffer());
      const ml = new DataView(frame.buffer, frame.byteOffset).getUint32(0);
      const meta = JSON.parse(new TextDecoder().decode(frame.subarray(4, 4 + ml)));
      const bytes = meta.kept ? frame.subarray(4 + ml) : null;
      const text = bytes ? new TextDecoder().decode(bytes) : null;
      const run = text === null ? null : log.runOf(text);
      const sdk = meta.pre ? null : await loadSdk();
      const storage = this.state.storage;
      const out = (a) => new Response(a.text, { status: a.status, headers: ANSWER_HEADERS });
      return this.state.blockConcurrencyWhile(async () => {
        // The cap on the kept parts: a request that would pass it is refused before anything is decided or written,
        // and only counted.
        let used;
        try { used = log.usedBytes(sql); } catch (e) { return out(LOG_UNAVAILABLE("the record's size could not be read: " + e.message)); }
        if (!log.fits(used, bytes ? bytes.length : 0, logCapBytes)) {
          try { log.countDenied(sql, new Date().toISOString().slice(0, 10), 507, "log_full"); } catch { /* the count is best effort */ }
          return out({ status: 507, text: answerText({ error: "log_full", limit_bytes: logCapBytes, used_bytes: used, consumed: false }) });
        }
        let reqRec;
        try {
          reqRec = log.writeRequest(storage, { run, at: door.isoMs(Date.now()), received_at: meta.received_at, bytes, sha256: meta.sha256, length: meta.length, declared_length: meta.declared_length, note: meta.note });
        } catch (e) { return out(LOG_UNAVAILABLE("the request record could not be written: " + e.message)); }
        let answer, obj, consume = null;
        if (meta.pre) { answer = meta.pre; obj = JSON.parse(meta.pre.text); }
        else {
          const d = doorFrom(this.env, pinned);
          const body = JSON.parse(text);
          if (!d.door) { obj = { error: "door_unavailable", why: d.why }; answer = { status: 503, text: answerText(obj) }; }
          else {
            const req = door.readRequest(body);
            if (req.error) { obj = { error: req.error }; answer = { status: 400, text: answerText(obj) }; }
            else {
              // The door's state: reads go to the table; the one write is held until the answer record is written
              // with it, in one transaction.
              const state = {
                get: (k) => { if (consume && consume.scope === k) return structuredClone(consume.row); const r = sql.exec("SELECT row FROM consumed WHERE scope = ?", k).toArray(); return r.length ? JSON.parse(r[0].row) : null; },
                put: (k, v) => { if (consume) throw new Error("one write per request"); consume = { scope: k, row: v }; },
              };
              const consumed_at = door.isoMs(Date.now());
              const r = await door.decide({ files: req.files, run_id: req.run_id, consumed_at, clock_source: "the door host's clock (Cloudflare Workers Date.now() in the Durable Object, read once per request before the checks)" },
                { sdk, state, door: d.door, chainView: meta.view });
              obj = { ...r.body, chain_view: meta.view };
              answer = { status: r.status, text: answerText(obj) };
            }
          }
        }
        try {
          log.writeAnswer(storage, { run, at: door.isoMs(Date.now()), request_seq: reqRec.seq, status: answer.status, text: answer.text, verdict: log.verdictOf(obj), consume });
        } catch (e) { return out(LOG_UNAVAILABLE("the answer record could not be written, so nothing was consumed: " + e.message)); }
        return out(answer);
      });
    }
  }
  return { handleRefundSandbox, RefundDoorDO };
}

const PUBLISHED = makeDoor();
export const handleRefundSandbox = PUBLISHED.handleRefundSandbox;
export class RefundDoorDO extends PUBLISHED.RefundDoorDO {}
