#!/usr/bin/env node
// Tests of the door's record (refund_door_log.mjs) through the routes and the Durable Object (refund_door_worker.mjs),
// with a stand-in Durable Object over node:sqlite (test_do.mjs). No network: fetch answers only the stand-in explorers
// on 127.0.0.1, and throws for anything else. Test keys from fixed labels, the door's clock fixed per request.
//
//   node refund_door_log.test.mjs
//
// What it holds:
//   [1] J01 (the admission half), J07, J08, J09, J10, J11, J02 to J06, J14 and step 9 through /admit: every answer is
//       the same bytes the door gave before the record (decide() over the same inputs and instant), and each request
//       and answer is recorded with its bytes;
//   [2] the run's records read back: the chain holds, the head is the last record, a record removed or changed is
//       caught; a body over 1 MiB is kept in parts whose joined sha256 is the request's;
//   [3] the worker's own answers (400 body_not_json, 400 from the request reader, 503 chain_view_unavailable, 503
//       door_unavailable, 413) are recorded too; 401 and 403 keep no body, only a count per day;
//   [4] a record that cannot be written: 503 log_unavailable and nothing consumed, at the request record and at the
//       answer record; the same request afterwards commits;
//   [5] /replay is not recorded; the bytes need the read key; GET /sandbox/refund names the record in one field;
//   [6] the cap on the kept bytes: a request that would pass it is refused before the decision (507 log_full), nothing
//       consumed, only counted; the same decision afterwards, small enough, commits;
//   [7] the readers in pages: a run read 5 lines at a time joins to the same chain and head; the runs 1 at a time.
import { createHash } from "node:crypto";
import * as D from "./refund_door_v0.mjs";
import * as W from "./refund_door_worker.mjs";
import * as L from "./refund_door_log.mjs";
import * as A from "../musubi-v0/adapters/aps_receipt/adapter_aps_receipt.mjs";
import * as T from "./test_inputs.mjs";
import { stand_in } from "./test_do.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log("FAIL " + m); } };
const { sdk } = await A.pinnedSdk();

// ---------------------------------------------------------------- the stand-in door
const SEED = Buffer.from(sha(Buffer.from("hs-refund-door-test/door")), "hex").toString("base64");
const doorKey = D.doorKeyFromSeed(SEED, "door-test-1");
const PIN = { key_id: "door-test-1", public_key_ed25519_b64: doorKey.public_key_ed25519_b64, not_before: null };
const { handleRefundSandbox, RefundDoorDO } = W.makeDoor({ pinned: PIN });
const SANDBOX_KEY = "s".repeat(43), LOG_KEY = "l".repeat(43);
const EXPL = ["http://127.0.0.1:9101/api", "http://127.0.0.1:9102/api", "http://127.0.0.1:9103/api"];
const HEADER = "00".repeat(80);
const HASH = Buffer.from(sha(createHash("sha256").update(Buffer.from(HEADER, "hex")).digest()), "hex").reverse().toString("hex");
let explorersUp = true;
globalThis.fetch = async (u) => {
  const url = new URL(u);
  if (!explorersUp || url.hostname !== "127.0.0.1") throw new Error("no network in this test");
  const p = url.pathname;
  return new Response(p.endsWith("/tip/height") ? "922001" : p.includes("/block-height/") ? HASH : HEADER);
};
const VIEW = await W.chainView(globalThis.fetch, EXPL);

async function newDoor(extra = {}, H = RefundDoorDO) {
  const S = await stand_in();
  const env = { REFUND_DOOR_KEY: SEED, REFUND_SANDBOX_KEY_SHA256: sha(Buffer.from(SANDBOX_KEY)), REFUND_LOG_KEY_SHA256: sha(Buffer.from(LOG_KEY)), REFUND_TEST_EXPLORERS: EXPL.join(","), ...extra };
  env.REFUND_DOOR_DO = S.namespace(H, env);
  return { S, env };
}
const ORIGIN = "https://ledger.horizonshield.dev";
const call = (env, path, init = {}) => { const u = new URL(ORIGIN + path); return handleRefundSandbox(new Request(u, init), env, u); };
const admitRaw = (env, raw, headers = { "x-hs-sandbox-key": SANDBOX_KEY }) => call(env, "/sandbox/refund/admit", { method: "POST", headers, body: raw });
const realNow = Date.now;
const at = (iso) => { Date.now = () => Date.parse(iso); };

const { makeCase, RUN, asStrings } = T.inputs(sdk);
const bodyOf = (c, runId = RUN, extra = {}) => JSON.stringify({ run_id: runId, inputs: asStrings(c.files), ...extra });

// ---------------------------------------------------------------- [1] the cases, answer bytes as before
const { S, env } = await newDoor();
const mem = D.memoryState();
const sent = [];
{
  const base = makeCase();
  const cases = [
    ["J01", base, "2026-10-28T00:10:00.000Z"],
    ["J07", base, "2026-10-28T00:10:05.000Z"],
    ["J08", makeCase({ payload: { payment_id: "pay_A", amount_minor: 3000, currency: "EUR" } }), "2026-10-28T00:10:06.000Z"],
    ["J10", makeCase({ approvalIssuedAt: "2026-10-28T00:00:02.000Z" }), "2026-10-28T00:10:07.000Z"],
    ["J11", makeCase({ approvalIssuedAt: "2026-10-28T00:00:03.000Z", proposalFrom: base }), "2026-10-28T00:10:08.000Z"],
    ["J09", makeCase({ decisionId: "decision-0002", actionNonce: "fedcba9876543210fedcba9876543210" }), "2026-10-28T00:10:09.000Z"],
    ["J02 amount", makeCase({ filesEdit: (f) => { f["inputs/aps-payload.json"] = new Uint8Array(Buffer.from(JSON.stringify({ payment_id: "pay_A", amount_minor: 4001, currency: "EUR" }, null, 2) + "\n")); } }), "2026-10-28T00:10:10.000Z"],
    ["J04 missing", makeCase({ filesEdit: (f) => { delete f["inputs/pic-proposal.json"]; } }), "2026-10-28T00:10:11.000Z"],
    ["J04 expired", makeCase({ validUntil: "2026-10-28T00:09:59.999Z" }), "2026-10-28T00:10:12.000Z"],
    ["J05", makeCase({ filesEdit: (f) => { const d = JSON.parse(Buffer.from(f["inputs/decision-evidence.json"]).toString()); d.decision_context = { channel: "elsewhere" }; f["inputs/decision-evidence.json"] = new Uint8Array(Buffer.from(JSON.stringify(d, null, 2) + "\n")); } }), "2026-10-28T00:10:13.000Z"],
    ["J06", makeCase({ runId: "run-door-0002" }), "2026-10-28T00:10:14.000Z"],
    ["J14", makeCase({ boundaryRevokedAt: "2026-10-28T00:09:00.000Z" }), "2026-10-28T00:10:15.000Z"],
    ["step 9 limit", makeCase({ payload: { payment_id: "pay_A", amount_minor: 5001, currency: "EUR" } }), "2026-10-28T00:10:16.000Z"],
  ];
  const want = { J01: "committed", J07: "committed", J08: "refused:DECISION_CONSUMED_OTHER_CONTENT", J10: "resolved_existing", J11: "refused:PIC_APPROVAL_REF", J09: "committed",
    "J02 amount": "refused:PAYLOAD_REF", "J04 missing": "refused:INPUT_SET", "J04 expired": "refused:DECISION_EXPIRED_AT_CONSUMPTION", J05: "refused:DECISION_NOT_BOUND",
    J06: "refused:PIC_RESULT_RUN_ID", J14: "refused:APPROVAL_SIGNER_REVOKED_AT_CONSUMPTION", "step 9 limit": "refused:AMOUNT_OVER_LIMIT" };
  for (const [name, c, t] of cases) {
    at(t);
    const raw = bodyOf(c);
    const r = await admitRaw(env, raw);
    const text = await r.text();
    const before = await D.decide({ files: c.files, run_id: RUN, consumed_at: t, clock_source: "the door host's clock (Cloudflare Workers Date.now() in the Durable Object, read once per request before the checks)" }, { sdk, state: mem, door: doorKey, chainView: VIEW });
    const wantText = JSON.stringify({ ...before.body, chain_view: VIEW }, null, 1) + "\n";
    ok(r.status === before.status && text === wantText, name + ": the answer is the same bytes as the door without the record");
    const o = JSON.parse(text);
    ok(o.disposition + (o.code ? ":" + o.code : "") === want[name], name + ": wanted " + want[name] + ", got " + o.disposition + ":" + o.code);
    sent.push({ name, raw, text });
  }
  Date.now = realNow;
  ok(S.count("consumed") === mem.size() && mem.size() === 2, "the live table holds the same consumptions as the door without the record (2)");
  console.log("[1] " + cases.length + " requests through /admit (J01, J07, J08, J10, J11, J09, J02, J04 twice, J05, J06, J14, step 9): the same answer bytes as before the record");
}

// ---------------------------------------------------------------- [2] reading the run, the chain, the parts
{
  const listing = await (await call(env, "/sandbox/refund/log")).json();
  const run = listing.runs.find((x) => x.run_id === RUN);
  ok(run && run.records === 2 * sent.length, "GET /log: the run has a request and an answer record per request (" + (run && run.records) + ")");
  const r = await call(env, "/sandbox/refund/log/run?run_id=" + RUN);
  const lines = (await r.text()).trimEnd().split("\n");
  const head = L.checkRun(lines);
  ok(head === run.head && r.headers.get("x-hs-log-head") === head && lines.length === run.records, "the chain holds and its last record is the head GET /log names");
  const recs = lines.map((l) => JSON.parse(l));
  let good = 0;
  sent.forEach((s, i) => {
    const q = recs[2 * i], a = recs[2 * i + 1];
    if (q.kind === "request" && q.sha256 === sha(Buffer.from(s.raw)) && q.length === Buffer.byteLength(s.raw) && q.body_kept === true
      && a.kind === "answer" && a.request_seq === q.seq && a.sha256 === sha(Buffer.from(s.text)) && a.status === 200 && a.disposition === JSON.parse(s.text).disposition && a.mapping_sha256 === JSON.parse(s.text).mapping_sha256) good++;
  });
  ok(good === sent.length, "every request record holds the body's sha256 and length, every answer record the answer's sha256 and the mapping verdict (" + good + "/" + sent.length + ")");
  const missing = lines.filter((_l, i) => i !== 3);
  let caught = null; try { L.checkRun(missing); } catch (e) { caught = e.message; }
  ok(/prev_record_sha256/.test(caught || ""), "a record removed from the run is caught: " + caught);
  const changed = lines.slice(); changed[1] = changed[1].replace('"status":200', '"status":201');
  caught = null; try { L.checkRun(changed); } catch (e) { caught = e.message; }
  ok(/record_sha256/.test(caught || ""), "a record changed is caught: " + caught);
  const b1 = await call(env, "/sandbox/refund/log/bytes/" + recs[0].seq, { headers: { "x-hs-log-key": LOG_KEY } });
  ok(b1.status === 200 && Buffer.from(await b1.arrayBuffer()).toString("utf8") === sent[0].raw && b1.headers.get("x-hs-log-sha256") === sha(Buffer.from(sent[0].raw)), "the request bytes read back are the bytes sent");
  const b2 = await call(env, "/sandbox/refund/log/bytes/" + recs[1].seq, { headers: { "x-hs-log-key": LOG_KEY } });
  ok(b2.status === 200 && Buffer.from(await b2.arrayBuffer()).toString("utf8") === sent[0].text, "the answer bytes read back are the bytes answered");

  // a body over 1 MiB: an extra member the request reader ignores; the answer is the J07 repeat of J01
  at("2026-10-28T00:10:20.000Z");
  const big = bodyOf(makeCase(), RUN, { note: "x".repeat(2.5 * (1 << 20)) });
  const ra = await admitRaw(env, big);
  Date.now = realNow;
  const ta = await ra.text();
  ok(ra.status === 200 && JSON.parse(ta).repeated, "a 2.5 MiB body: answered (the existing admission again)");
  const all = (await (await call(env, "/sandbox/refund/log/run?run_id=" + RUN)).text()).trimEnd().split("\n").map((l) => JSON.parse(l));
  const qb = all[all.length - 2];
  ok(qb.parts === 3 && S.count("log_part") > 0, "the 2.5 MiB body is kept in 3 parts");
  const parts = S.db.prepare("SELECT part FROM log_part WHERE seq = ? ORDER BY i").all(qb.seq).map((x) => Buffer.from(x.part));
  ok(parts.every((p) => p.length <= L.PART) && sha(Buffer.concat(parts)) === qb.sha256 && qb.sha256 === sha(Buffer.from(big)), "the parts joined hash to the request's sha256, and each part is at most 1 MiB");
  console.log("[2] the run read back: chain, head, removal and change caught, bytes read back, a 2.5 MiB body in 3 parts");
}

// ---------------------------------------------------------------- [3] the worker's own answers, and no body without the key
{
  const before = S.count("log_record");
  at("2026-10-28T00:11:00.000Z");
  const r1 = await admitRaw(env, "{not json");
  ok(r1.status === 400 && (await r1.json()).error === "body_not_json", "400 body_not_json");
  const r2 = await admitRaw(env, JSON.stringify({ run_id: "run-door-0009", inputs: { "inputs/aps-payload.json": 5 } }));
  ok(r2.status === 400 && (await r2.json()).error === "input_not_a_string", "400 from the request reader");
  explorersUp = false;
  const r3 = await admitRaw(env, bodyOf(makeCase({ decisionId: "decision-0003", actionNonce: "11112222333344445555666677778888" })));
  explorersUp = true;
  const j3 = await r3.json();
  ok(r3.status === 503 && j3.error === "chain_view_unavailable" && j3.consumed === false, "503 chain_view_unavailable");
  const r4 = await admitRaw(env, "x", { "x-hs-sandbox-key": SANDBOX_KEY, "content-length": String((16 << 20) + 1) });
  ok(r4.status === 413, "413 by content-length");
  Date.now = realNow;
  ok(S.count("log_record") === before + 8 && S.count("consumed") === 2, "each of the four is recorded, request and answer, and nothing is consumed");
  const unLines = (await (await call(env, "/sandbox/refund/log/unnamed")).text()).trimEnd().split("\n");
  const un = unLines.map((l) => JSON.parse(l));
  ok(un.length === 4 && un[0].run_id === null && un[1].error === "body_not_json" && un[3].status === 413 && un[2].body_kept === false && un[2].declared_length === (16 << 20) + 1 && un[2].sha256 === null,
    "a body that is not JSON, and the 413 whose body was not read, are recorded without a run; the 413 keeps no bytes");
  ok(L.checkRun(unLines) === un[un.length - 1].record_sha256, "the records without a run chain too");
  const r9 = (await (await call(env, "/sandbox/refund/log/run?run_id=run-door-0009")).text()).trimEnd().split("\n").map((l) => JSON.parse(l));
  ok(r9.length === 2 && r9[1].error === "input_not_a_string" && r9[1].status === 400, "the reader's 400 is recorded in its run");

  const recs = S.count("log_record");
  const d1 = await admitRaw(env, bodyOf(makeCase()), {});
  const d2 = await admitRaw(env, bodyOf(makeCase()), { "x-hs-sandbox-key": "wrong" });
  const d3 = await admitRaw(env, bodyOf(makeCase()), { "x-hs-sandbox-key": "wrong" });
  ok(d1.status === 401 && d2.status === 403 && d3.status === 403, "401 without the key, 403 with a wrong key");
  const ls = await (await call(env, "/sandbox/refund/log")).json();
  const day = new Date().toISOString().slice(0, 10);
  ok(S.count("log_record") === recs && ls.denied.some((x) => x.day === day && x.status === 401 && x.n === 1) && ls.denied.some((x) => x.day === day && x.status === 403 && x.why === "sandbox_key_wrong" && x.n === 2),
    "401 and 403 keep no record and no body, only a count per day, status and reason");

  const { S: S2, env: env2 } = await newDoor({ REFUND_DOOR_KEY: Buffer.alloc(32, 1).toString("base64") });
  const r5 = await admitRaw(env2, bodyOf(makeCase()));
  const j5 = await r5.json();
  ok(r5.status === 503 && j5.error === "door_unavailable" && j5.why === "door_key_not_the_published_key", "503 door_unavailable, as before");
  const rec5 = S2.db.prepare("SELECT rec FROM log_record ORDER BY seq").all().map((x) => JSON.parse(x.rec));
  ok(rec5.length === 2 && rec5[0].body_kept === false && /door was unavailable/.test(rec5[0].note) && rec5[1].status === 503, "and recorded, without the body (it was not read)");
  const nb = { ...env2 }; delete nb.REFUND_DOOR_DO;
  const r6 = await admitRaw(nb, bodyOf(makeCase()));
  ok(r6.status === 503 && (await r6.json()).why === "state_not_bound", "no Durable Object bound: 503 state_not_bound, nothing answered unrecorded");
  console.log("[3] the worker's 400, 400, 503, 413 and 503 door_unavailable recorded; 401 and 403 counted per day without a body");
}

// ---------------------------------------------------------------- [4] a record that cannot be written
{
  const c3 = makeCase({ decisionId: "decision-0003", actionNonce: "11112222333344445555666677778888" });
  const consumed = S.count("consumed"), records = S.count("log_record");
  at("2026-10-28T00:12:00.000Z");
  S.failTransaction(1);
  const r1 = await admitRaw(env, bodyOf(c3));
  const j1 = await r1.json();
  ok(r1.status === 503 && j1.error === "log_unavailable" && j1.consumed === false && S.count("consumed") === consumed && S.count("log_record") === records, "the request record cannot be written: 503 log_unavailable, nothing decided, nothing consumed");
  S.failTransaction(2);
  const r2 = await admitRaw(env, bodyOf(c3));
  const j2 = await r2.json();
  ok(r2.status === 503 && j2.error === "log_unavailable" && /nothing was consumed/.test(j2.detail) && S.count("consumed") === consumed && S.count("log_record") === records + 1,
    "the answer record cannot be written: 503 log_unavailable, the commit rolled back with it, the request record stays without an answer");
  const r3 = await admitRaw(env, bodyOf(c3));
  const j3 = await r3.json();
  Date.now = realNow;
  ok(r3.status === 200 && j3.disposition === "committed" && !j3.repeated && S.count("consumed") === consumed + 1, "the same request afterwards commits: the failed attempts consumed nothing");
  const lines = (await (await call(env, "/sandbox/refund/log/run?run_id=" + RUN)).text()).trimEnd().split("\n");
  L.checkRun(lines);
  const last = lines.slice(-3).map((l) => JSON.parse(l));
  ok(last[0].kind === "request" && last[1].kind === "request" && last[2].kind === "answer" && last[2].request_seq === last[1].seq && last[2].disposition === "committed", "the record shows the request without an answer, then the request and its committed answer");
  console.log("[4] a record that cannot be written: 503 log_unavailable at the request record and at the answer record, nothing consumed; the retry commits");
}

// ---------------------------------------------------------------- [5] replay, the read key, the self-description
{
  const records = S.count("log_record"), consumed = S.count("consumed");
  const rp = await call(env, "/sandbox/refund/replay", { method: "POST", headers: { "x-hs-sandbox-key": SANDBOX_KEY }, body: JSON.stringify({ requests: [{ run_id: RUN, inputs: asStrings(makeCase().files), consumed_at: "2026-10-28T00:10:00.000Z" }] }) });
  ok(rp.status === 200 && (await rp.json()).results[0].disposition === "committed" && S.count("log_record") === records && S.count("consumed") === consumed, "/replay answers and is not recorded, the live state untouched");
  const path = "/sandbox/refund/log/bytes/1";
  ok((await call(env, path)).status === 401, "bytes without the read key: 401");
  ok((await call(env, path, { headers: { "x-hs-log-key": SANDBOX_KEY } })).status === 403, "bytes with the sandbox key instead of the read key: 403");
  const nk = { ...env }; delete nk.REFUND_LOG_KEY_SHA256;
  ok((await call(nk, path, { headers: { "x-hs-log-key": LOG_KEY } })).status === 503, "no read key set: 503");
  ok((await call(env, "/sandbox/refund/log/run?run_id=bad%20id")).status === 400 && (await call(env, "/sandbox/refund/log/bytes/0", { headers: { "x-hs-log-key": LOG_KEY } })).status === 400, "a bad run_id or seq: 400");
  const g = await (await call(env, "/sandbox/refund")).json();
  const { log, ...rest } = g;
  const old = W.selfDescription(ORIGIN, env, PIN); delete old.log;
  ok(g.ready === true && log && log.schema === L.LOG_SCHEMA && log.bytes.ready === true && JSON.stringify(rest) === JSON.stringify(old) && Object.keys(g).length === 19, "GET /sandbox/refund: ready, and the record named in one field (log)");
  console.log("[5] /replay not recorded; bytes behind the read key; GET /sandbox/refund names the record in one field");
}

// ---------------------------------------------------------------- [6] the cap on the kept bytes
{
  const CAP = Math.floor(2.5 * (1 << 20));
  const capped = W.makeDoor({ pinned: PIN, logCapBytes: CAP });
  const { S: S6, env: e6 } = await newDoor({}, capped.RefundDoorDO);
  const call6 = (path, init = {}) => { const u = new URL(ORIGIN + path); return capped.handleRefundSandbox(new Request(u, init), e6, u); };
  const post6 = (raw) => call6("/sandbox/refund/admit", { method: "POST", headers: { "x-hs-sandbox-key": SANDBOX_KEY }, body: raw });
  const pad = "x".repeat(1 << 20);
  const c2 = makeCase({ decisionId: "decision-0002", actionNonce: "fedcba9876543210fedcba9876543210" });
  at("2026-10-28T00:10:00.000Z");
  const a1 = await post6(bodyOf(makeCase(), RUN, { note: pad }));
  ok(a1.status === 200 && (await a1.json()).disposition === "committed" && S6.count("consumed") === 1, "a 1 MiB body under the cap: recorded and decided (committed)");
  const records = S6.count("log_record");
  at("2026-10-28T00:10:01.000Z");
  const a2 = await post6(bodyOf(c2, RUN, { note: pad }));
  const j2 = await a2.json();
  ok(a2.status === 507 && j2.error === "log_full" && j2.consumed === false && j2.limit_bytes === CAP && S6.count("consumed") === 1 && S6.count("log_record") === records,
    "another 1 MiB body would pass the cap: 507 log_full before the decision, nothing consumed, nothing recorded");
  const l6 = await (await call6("/sandbox/refund/log")).json();
  ok(l6.limit_bytes === CAP && l6.used_bytes > (1 << 20) && l6.used_bytes <= CAP && l6.denied_total.some((x) => x.status === 507 && x.why === "log_full" && x.n === 1), "GET /log: the cap, the bytes used, and the refusal counted (507 log_full 1)");
  at("2026-10-28T00:10:02.000Z");
  const a3 = await post6(bodyOf(c2));
  Date.now = realNow;
  ok(a3.status === 200 && (await a3.json()).disposition === "committed" && S6.count("consumed") === 2, "the same decision afterwards without the padding commits: the refusal consumed nothing");
  console.log("[6] the cap on the kept bytes: 507 log_full before the decision, nothing consumed, counted; a smaller request still fits");
}

// ---------------------------------------------------------------- [7] reading in pages
{
  const full = await call(env, "/sandbox/refund/log/run?run_id=" + RUN);
  const all = (await full.text()).trimEnd().split("\n");
  const head = full.headers.get("x-hs-log-head");
  ok(full.headers.get("x-hs-log-next") === null && all.length === Number(full.headers.get("x-hs-log-records")), "one page when the run is under 1000 lines, no next");
  let after = 0, prev = L.ZERO, joined = [], pages = 0, chained = true;
  for (;;) {
    const r = await call(env, "/sandbox/refund/log/run?run_id=" + RUN + "&limit=5&after=" + after);
    const lines = (await r.text()).trimEnd().split("\n").filter(Boolean);
    try { prev = L.checkRun(lines, prev); } catch { chained = false; }
    joined = joined.concat(lines); pages++;
    const nx = r.headers.get("x-hs-log-next");
    if (nx === null) break;
    after = nx;
  }
  ok(chained && prev === head && joined.join("\n") === all.join("\n") && pages === Math.ceil(all.length / 5), "the run read 5 lines at a time: " + pages + " pages, each page checked from the last line before, the same lines and head");
  const big = await call(env, "/sandbox/refund/log/run?run_id=" + RUN + "&limit=1001");
  ok(big.status === 400 || Number(big.headers.get("x-hs-log-lines")) <= L.PAGE_MAX, "a limit over 1000 is not served past 1000");
  ok((await call(env, "/sandbox/refund/log/run?run_id=" + RUN + "&after=-1")).status === 400 && (await call(env, "/sandbox/refund/log?limit=0")).status === 400, "a bad after or limit: 400");
  const listAll = (await (await call(env, "/sandbox/refund/log")).json()).runs;
  let cur = null, got = [];
  for (let i = 0; i < 20; i++) {
    const j = await (await call(env, "/sandbox/refund/log?limit=1" + (cur === null ? "" : "&after=" + encodeURIComponent(cur)))).json();
    got = got.concat(j.runs); if (j.next_after === null) break; cur = j.next_after;
  }
  ok(JSON.stringify(got) === JSON.stringify(listAll) && listAll.length >= 3, "the runs read 1 at a time join to the same list (" + listAll.length + " runs, the unnamed one first)");
  console.log("[7] reading in pages: the run in pages of 5 joins to the same chain and head; the runs 1 at a time");
}

console.log(fail === 0 ? "refund door record: ALL PASS (" + n + " checks)" : "refund door record: " + fail + " of " + n + " checks FAILED");
process.exit(fail === 0 ? 0 : 1);
