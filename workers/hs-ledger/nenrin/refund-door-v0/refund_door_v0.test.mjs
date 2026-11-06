#!/usr/bin/env node
// Tests of the refund sandbox door (refund_door_v0.mjs, refund_door_worker.mjs, verify_answer.mjs). No network: fetch
// is replaced by a function that throws, and the chain view comes from stand-in explorers in memory.
//
//   npm ci --ignore-scripts   (in ../musubi-v0/adapters/aps_receipt: the pinned APS SDK)
//   node refund_door_v0.test.mjs                         the door's own cases
//   node refund_door_v0.test.mjs --published <dir>       also the published connected run (probityai/probity dcc07c3c,
//                                                         run j01-connected-20261028-r2: APS inputs from the APS SDK, PIC
//                                                         proposals and results from pic-standard's producer 6856f36),
//                                                         read from <dir> as data, each file checked against its sha256
//
// The cases follow the acceptance list of the contract (section 11) that admission claims: J01 (the admission half),
// J02 to J09, J10 (the verdict only), J11 and J14. The door's synthetic inputs are built here with the pinned SDK and
// test keys derived from fixed labels, as the adapter's selftest builds them.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "../musubi-v0/adapters/aps_receipt/adapter_aps_receipt.mjs";
import * as D from "./refund_door_v0.mjs";
import * as W from "./refund_door_worker.mjs";
import * as S from "./sdk_subset.mjs";
import { verifyAnswers } from "./verify_answer.mjs";
import * as T from "./test_inputs.mjs";
import { overLimit as ceOverLimit } from "../musubi-v0/clause_eval_v0.mjs";
import { verifyAdmissionText } from "../musubi-v0/admission_verify_v0.mjs";
import { parseStrict } from "../agreement-v0/agreement_canonical.mjs";
import { canonical } from "../musubi-v0/canonical_v0.mjs";

globalThis.fetch = async () => { throw new Error("no network in this test"); };
const HERE = dirname(fileURLToPath(import.meta.url));
const sha = (b) => createHash("sha256").update(b).digest("hex");
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log("FAIL " + m); } };
const { sdk: PINNED } = await A.pinnedSdk();
const sdk = PINNED;
const VIEW = { height: 922000, header_sha256: "ab".repeat(32) };
const door = D.doorKeyFromSeed(Buffer.from(sha(Buffer.from("hs-refund-door-test/door")), "hex").toString("base64"), "door-test-1");

// ---------------------------------------------------------------- the inputs (test_inputs.mjs, as the adapter selftest builds them)
const { makeCase, bytes, RUN } = T.inputs(sdk);
const CONSUMED = T.FIXED.consumed;
const run = (state, c, at = CONSUMED, runId = RUN) => D.decide({ files: c.files, run_id: runId, consumed_at: at, clock_source: "test clock" }, { sdk, state, door, chainView: VIEW });
const rec = (t) => JSON.parse(t);
const verifyOne = (a) => verifyAnswers(a, D.keyDocument(door, null))[0].problems;

// [1] pins: the evaluator, the contract, the SDK subset
{
  ok(D.EVALUATOR_SHA256 === sha(readFileSync(join(HERE, "..", "musubi-v0", "clause_eval_v0.py"))), "EVALUATOR_SHA256 is the sha256 of clause_eval_v0.py");
  const { execFileSync } = await import("node:child_process");
  let chk = ""; try { chk = execFileSync(process.execPath, [join(HERE, "make_sandbox_contract.mjs"), "--check"], { encoding: "utf8" }); } catch (e) { chk = String(e.stdout || "") + String(e.stderr || ""); }
  ok(/is what make_sandbox_contract\.mjs writes/.test(chk), "sandbox_contract.mjs is what make_sandbox_contract.mjs writes, and the contract door accepts it");
  for (const k of ["verifyReceiptV1", "verifyReceiptWithDecisionV1", "computeActionRefV2", "computePayloadRefV1", "validateActionReferenceInputV2"]) ok(S[k] === PINNED[k], "sdk_subset." + k + " is the pinned SDK's own function");
  const root = realpathSync(join(HERE, "..", "musubi-v0", "adapters", "aps_receipt", "node_modules", "agent-passport-system"));
  const seen = new Set(), todo = S.SDK_ENTRY_FILES.map((p) => realpathSync(resolve(HERE, p)));
  while (todo.length) {
    const f = todo.pop(); if (seen.has(f)) continue; seen.add(f);
    for (const m of readFileSync(f, "utf8").matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n;]*?from\s+['"](\.[^'"]+)['"]/g)) todo.push(realpathSync(resolve(dirname(f), m[1])));
  }
  ok([...seen].every((f) => !relative(root, f).startsWith("..")), "every SDK file the subset loads (" + seen.size + ") lies inside the pinned package");
  ok(JSON.stringify(W.SDK_FILES) === JSON.stringify(S.SDK_ENTRY_FILES.map((p) => p.replace("../musubi-v0/", "workers/hs-ledger/nenrin/musubi-v0/"))), "the worker names the same SDK files as sdk_subset.mjs");
  const vectors = [[4000], [5000], [5001], [0], [-1], [null], [4000.5]];
  ok(vectors.every(([a]) => D.overLimit(D.CONTRACT, "refund", a) === ceOverLimit(D.CONTRACT, "refund", a)), "the door's limit rule is clause_eval_v0's on " + vectors.length + " amounts");
  ok(D.overLimit({ grant: { limits: { refund: { max_amount: "5000", unit: "EUR" } } } }, "refund", 1) === ceOverLimit({ grant: { limits: { refund: { max_amount: "5000", unit: "EUR" } } } }, "refund", 1), "and on an unreadable limit");
  console.log("[1] pins: evaluator fee48c3a, contract " + D.CONTRACT.contract_id + ", SDK subset " + seen.size + " files inside the pinned package, the limit rule");
}

// [2] the door's cases
const base = makeCase();
{
  const st = D.memoryState();
  const a1 = await run(st, base);
  ok(a1.body.disposition === "committed" && st.size() === 1, "J01 the exact original approval commits once");
  const r31 = rec(a1.body.admission);
  ok(Object.keys(r31).length === 22 && r31.schema === "refund-sandbox-admission/0.1" && r31.state === "committed" && r31.tool === "refund", "J01 3.1 has exactly the 22 fields of contract section 5");
  ok(r31.committed_at === "2026-10-28T00:10:00Z" && r31.valid_until === "2026-10-28T00:20:00Z", "J01 committed_at whole seconds, valid_until 600 s later (inside the decision and the attestation)");
  ok(r31.approval_ref === base.approval.receipt_id && r31.aps_evidence_ref === "sha256:" + sha(base.files["inputs/aps-approval.json"]), "J01 3.1 names the approval and the raw file hashes");
  ok(a1.body.admission_ref === "sha256:" + sha(Buffer.from(A.jcs(r31))), "J01 admission_ref = sha256 of JCS(3.1)");
  const v = verifyAdmissionText(a1.body.a2a_admission, door.public_key_ed25519_b64, parseStrict(canonical(D.CONTRACT)));
  ok(v.verdict === "accepted", "J01 3.2 is accepted by admission_verify_v0 under the door key and the sandbox contract: " + JSON.stringify(v));
  const r32 = rec(a1.body.a2a_admission);
  ok(r32.decision === "admit" && r32.reasons[0] === "within_grant" && r32.publication === "public" && r32.presentation_ref.length === 11 && r32.presentation_ref.every((p) => p.verified === true), "J01 3.2 admit, within_grant, eleven verified presentations");
  ok(r32.action_ref.nonce === "decision-0001" && r32.chain_view.height === VIEW.height, "J01 3.2 nonce is the merchant decision, chain view carried");
  const m = rec(a1.body.mapping);
  ok(m.schema === "hs-refund-admission-mapping-v0" && m.disposition === "committed" && m.admission_ref === a1.body.admission_ref && m.admission_sha256 === a1.body.admission_sha256 && m.consumed_at === CONSUMED && m.inputs.length === 11, "J01 3.3 committed, joins 3.1 and 3.2");
  ok(verifyOne(a1.body).length === 0, "J01 the answer verifies (verify_answer): " + verifyOne(a1.body).join("; "));
  ok(verifyAdmissionText(a1.body.a2a_admission, D.doorKeyFromSeed(Buffer.alloc(32, 9).toString("base64"), "x").public_key_ed25519_b64, parseStrict(canonical(D.CONTRACT))).refusals.includes("bad_signature"), "J01 3.2 under another key: bad_signature");

  const a2 = await run(st, base, "2026-10-28T00:10:05.000Z");
  ok(a2.body.disposition === "committed" && a2.body.admission_ref === a1.body.admission_ref && a2.body.repeated && st.size() === 1, "J07 same decision and content: the existing admission, nothing new consumed");

  const j08 = makeCase({ payload: { payment_id: "pay_A", amount_minor: 3000, currency: "EUR" } });
  const a3 = await run(st, j08, "2026-10-28T00:10:06.000Z");
  ok(a3.body.disposition === "refused" && a3.body.reason === "nonce_reused" && a3.body.code === "DECISION_CONSUMED_OTHER_CONTENT" && st.size() === 1, "J08 same decision, changed amount: refused nonce_reused");
  ok(verifyOne(a3.body).length === 0 && rec(a3.body.a2a_admission).decision === "refuse", "J08 the refusal is signed and verifies");

  const j10 = makeCase({ approvalIssuedAt: "2026-10-28T00:00:02.000Z" });
  ok(j10.approval.receipt_id !== base.approval.receipt_id, "J10 the reissue is a new APS receipt");
  const a4 = await run(st, j10, "2026-10-28T00:10:07.000Z");
  const m4 = rec(a4.body.mapping);
  ok(a4.body.disposition === "resolved_existing" && m4.operation_id === m.operation_id && m4.original_admission_ref === a1.body.admission_ref && m4.admission_ref === null && a4.body.a2a_admission === null && st.size() === 1,
    "J10 reissue with new matching PIC evidence: resolved_existing, the original operation and admission, no new consumption");
  ok(verifyOne(a4.body).length === 0, "J10 the signed verdict verifies");

  const j11 = makeCase({ approvalIssuedAt: "2026-10-28T00:00:03.000Z", proposalFrom: base });
  const a5 = await run(st, j11, "2026-10-28T00:10:08.000Z");
  ok(a5.body.disposition === "refused" && a5.body.step === 7 && a5.body.code === "PIC_APPROVAL_REF" && st.size() === 1, "J11 new APS receipt with the old PIC proposal: refused at step 7, " + a5.body.code);

  const j09 = makeCase({ decisionId: "decision-0002", actionNonce: "fedcba9876543210fedcba9876543210" });
  const a6 = await run(st, j09, "2026-10-28T00:10:09.000Z");
  ok(a6.body.disposition === "committed" && a6.body.operation_id !== a1.body.operation_id && st.size() === 2, "J09 a new decision with an identical refund: a distinct operation");

  const runOther = await run(D.memoryState(), base, CONSUMED, "run-door-0002");
  ok(runOther.body.code === "PIC_RESULT_RUN_ID", "J06 the PIC result of another run is refused at the door too");
  console.log("[2] J01, J07, J08, J09, J10, J11 in one state: " + st.size() + " decisions consumed");
}

// [3] refusals before consumption (J02 to J06, J14, step 9): signed, verifiable, nothing consumed
{
  const cases = [
    ["J02 amount changed in the payload", { filesEdit: (f) => { f["inputs/aps-payload.json"] = bytes({ payment_id: "pay_A", amount_minor: 4001, currency: "EUR" }); } }, "PAYLOAD_REF"],
    ["J02 currency changed", { filesEdit: (f) => { f["inputs/aps-payload.json"] = bytes({ payment_id: "pay_A", amount_minor: 4000, currency: "USD" }); } }, "PAYLOAD_SCHEMA"],
    ["J04 PIC proposal missing", { filesEdit: (f) => { delete f["inputs/pic-proposal.json"]; } }, "INPUT_SET"],
    ["J04 decision expired at consumption", { validUntil: "2026-10-28T00:09:59.999Z" }, "DECISION_EXPIRED_AT_CONSUMPTION"],
    ["J04 PIC attestation expired at consumption", { picExpires: "2026-10-28T00:09:00Z" }, "PIC_EXPIRED_AT_CONSUMPTION"],
    ["J05 decision component changed", { filesEdit: (f) => { const d = JSON.parse(Buffer.from(f["inputs/decision-evidence.json"]).toString()); d.decision_context = { channel: "elsewhere" }; f["inputs/decision-evidence.json"] = bytes(d); } }, "DECISION_NOT_BOUND"],
    ["J06 PIC result not allow", { filesEdit: (f) => { const r = JSON.parse(Buffer.from(f["inputs/pic-verification.json"]).toString()); r.result = "block"; f["inputs/pic-verification.json"] = bytes(r); } }, "PIC_RESULT_NOT_ALLOW"],
    ["J14 approval signer revoked before consumption", { boundaryRevokedAt: "2026-10-28T00:09:00.000Z" }, "APPROVAL_SIGNER_REVOKED_AT_CONSUMPTION"],
    ["J14 approval signer revoked before the approval was issued", { boundaryRevokedAt: "2026-10-27T23:00:00.000Z" }, "APPROVAL_SIGNER_REVOKED_AT_CONSUMPTION"],
    ["step 9 amount over the contract's limit (5001 > 5000)", { payload: { payment_id: "pay_A", amount_minor: 5001, currency: "EUR" } }, "AMOUNT_OVER_LIMIT"],
    ["step 9 empty window (committed_at rounds up past the decision's end)", { validUntil: "2026-10-28T00:10:00.900Z" }, "ADMISSION_WINDOW_EMPTY", "2026-10-28T00:10:00.200Z"],
    ["parse: duplicate member", { filesEdit: (f) => { f["inputs/aps-payload.json"] = new Uint8Array(Buffer.from('{"payment_id":"pay_A","amount_minor":4000,"amount_minor":4000,"currency":"EUR"}')); } }, "STRICT_PARSE"],
  ];
  let k = 0;
  for (const [name, o, code, at] of cases) {
    const st = D.memoryState();
    const a = await run(st, makeCase(o), at || CONSUMED);
    const r32 = rec(a.body.a2a_admission), m = rec(a.body.mapping);
    ok(a.body.disposition === "refused" && a.body.code === code && st.size() === 0 && r32.decision === "refuse" && m.disposition === "refused" && m.code === code && m.operation_id === null, name + ": wanted " + code + ", got " + a.body.disposition + " " + a.body.code);
    ok(verifyOne(a.body).length === 0, name + ": the refusal verifies " + verifyOne(a.body).join("; "));
    k++;
  }
  const c14 = await run(D.memoryState(), makeCase({ boundaryRevokedAt: "2026-10-28T00:10:00.001Z" }));
  ok(c14.body.disposition === "committed", "J14 control: revoked after consumption, committed");
  ok((await run(D.memoryState(), makeCase({ boundaryRevokedAt: "2026-10-28T00:09:00.000Z" }))).body.reason === "key_revoked", "J14 is named key_revoked");
  console.log("[3] " + k + " refusals before consumption, each signed and verifiable, nothing consumed; J14 control commits");
}

// [4] the reader's checks catch tampering; replay records are marked
{
  const a = (await run(D.memoryState(), base)).body;
  const t1 = { ...a, a2a_admission: a.a2a_admission.replace('"decision":"admit"', '"decision":"refuse"') };
  ok(verifyOne(t1).some((p) => /a2a_admission/.test(p)), "a changed decision in 3.2 is caught");
  const t2 = { ...a, mapping: a.mapping.replace(/"operation_id":"[^"]+"/, '"operation_id":"op-x"') };
  ok(verifyOne(t2).some((p) => /mapping/.test(p)), "a changed operation_id in 3.3 is caught");
  const t3 = { ...a, admission: a.admission.replace("4000", "4001") };
  ok(verifyOne(t3).some((p) => /admission_ref/.test(p)), "a changed amount in 3.1 is caught");
  const rp = await D.replaySequence([
    { run_id: RUN, inputs: Object.fromEntries(Object.entries(base.files).map(([k, v]) => [k, Buffer.from(v).toString("utf8")])), consumed_at: CONSUMED },
    { run_id: RUN, inputs: Object.fromEntries(Object.entries(base.files).map(([k, v]) => [k, Buffer.from(v).toString("utf8")])), consumed_at: "2026-10-28T00:10:01.000Z" },
  ], { sdk, door, chainView: VIEW });
  const r0 = rp.body.results[0], m0 = rec(r0.mapping), x0 = rec(r0.a2a_admission);
  ok(rp.status === 200 && r0.disposition === "committed" && rp.body.results[1].repeated && m0.schema === "hs-refund-admission-replay-v0" && !("publication" in x0) && x0.admission_id.startsWith("replay-"),
    "replay: committed then repeated, mapping schema hs-refund-admission-replay-v0, no publication, admission_id replay-");
  ok(verifyAnswers(rp.body, D.keyDocument(door, null)).every((r) => r.problems.length === 0), "replay answers verify");
  ok(/caller/.test(m0.clock_source), "replay names the caller's clock");
  ok((await D.replaySequence([{ run_id: RUN, inputs: {}, consumed_at: "2026-10-28T00:10:00Z" }], { sdk, door, chainView: VIEW })).status === 400, "replay refuses an instant without milliseconds");
  const b64 = await D.replaySequence([{ run_id: RUN, inputs_b64: Object.fromEntries(Object.entries(base.files).map(([k, v]) => [k, Buffer.from(v).toString("base64")])), consumed_at: CONSUMED }], { sdk, door, chainView: VIEW });
  ok(b64.body.results[0].disposition === "committed", "inputs_b64 gives the same bytes");
  console.log("[4] tampering caught in 3.1, 3.2, 3.3; replay marked and verifiable");
}

// [5] the worker: keys, the sandbox key, the chain view, the answers before the state
{
  const seed = Buffer.from(sha(Buffer.from("hs-refund-door-test/door")), "hex").toString("base64");
  const pinned = { key_id: "door-test-1", public_key_ed25519_b64: door.public_key_ed25519_b64, not_before: null };
  ok(W.doorFrom({ REFUND_DOOR_KEY: seed }, pinned).door, "the seed gives the published key");
  ok(W.doorFrom({ REFUND_DOOR_KEY: Buffer.alloc(32, 1).toString("base64") }, pinned).why === "door_key_not_the_published_key", "another seed is refused");
  ok(W.doorFrom({}, pinned).why === "door_key_not_set" && W.doorFrom({ REFUND_DOOR_KEY: seed }, null).why === "door_key_not_published", "no seed, or no published key: unavailable");
  const u = new URL("https://ledger.horizonshield.dev/sandbox/refund/admit");
  const key = "k".repeat(43);
  const env = { REFUND_SANDBOX_KEY_SHA256: sha(Buffer.from(key)), REFUND_DOOR_KEY: seed };
  const post = (h) => new Request(u, { method: "POST", headers: h, body: "{}" });
  ok((await W.handleRefundSandbox(post({}), env, u)).status === 401, "POST without the sandbox key: 401");
  ok((await W.handleRefundSandbox(post({ "x-hs-sandbox-key": "wrong" }), env, u)).status === 403, "POST with a wrong sandbox key: 403");
  ok((await W.handleRefundSandbox(post({ "x-hs-sandbox-key": key }), { REFUND_DOOR_KEY: seed }, u)).status === 503, "no sandbox key hash set: 503");
  const { DOOR_KEY } = await import("./door_key.mjs");
  const r = await W.handleRefundSandbox(post({ "x-hs-sandbox-key": key }), env, u);
  const rj = await r.json();
  ok(r.status === 503 && rj.error === "door_unavailable" && rj.why === (DOOR_KEY ? "door_key_not_the_published_key" : "door_key_not_published"),
    "a seed that is not the published key's (or no published key): 503 door_unavailable, " + rj.why);
  ok(DOOR_KEY === null || (/^[A-Za-z0-9+/]{43}=$/.test(DOOR_KEY.public_key_ed25519_b64) && Buffer.from(DOOR_KEY.public_key_ed25519_b64, "base64").length === 32 && typeof DOOR_KEY.key_id === "string" && Object.keys(DOOR_KEY).sort().join() === "key_id,not_before,public_key_ed25519_b64"),
    "door_key.mjs is null or one Ed25519 public key with key_id and not_before");
  const g = await W.handleRefundSandbox(new Request("https://ledger.horizonshield.dev/sandbox/refund"), env, new URL("https://ledger.horizonshield.dev/sandbox/refund"));
  const gj = await g.json();
  ok(g.status === 200 && gj.ready === false && gj.why_not_ready === (DOOR_KEY ? "door_key_not_the_published_key" : "door_key_not_published") && gj.contract.contract_sha256 === (await import("./sandbox_contract.mjs")).CONTRACT_SHA256, "GET /sandbox/refund describes the door and says why it is not ready");
  const header = "00".repeat(80), raw = Buffer.from(header, "hex");
  const hh = Buffer.from(createHash("sha256").update(createHash("sha256").update(raw).digest()).digest()).reverse().toString("hex");
  const ex = (tip, hash, hdr) => async (url) => { const p = new URL(url).pathname; const t = p.endsWith("/tip/height") ? String(tip) : p.includes("/block-height/") ? hash : hdr; return new Response(t); };
  const mk = (fs) => async (url, init) => fs[["a", "b", "c"].indexOf(new URL(url).hostname)](url, init);
  const E = ["https://a/api", "https://b/api", "https://c/api"];
  const cv = await W.chainView(mk([ex(100, hh, header), ex(101, hh, header), ex(99, "ff".repeat(32), header)]), E);
  ok(cv.height === 100 && cv.header_sha256 === sha(raw) && cv.block_hash === hh, "chain view: second highest tip, hash and header agreed by two");
  let threw = null; try { await W.chainView(mk([ex(100, hh, header), ex(100, "ee".repeat(32), header), ex(100, "ff".repeat(32), header)]), E); } catch (e) { threw = e.message; }
  ok(/agree on the block/.test(threw || ""), "chain view: no two agree on the hash, no view");
  threw = null; try { await W.chainView(mk([ex(100, hh, "11".repeat(80)), ex(100, hh, "11".repeat(80)), ex(1, hh, header)]), E); } catch (e) { threw = e.message; }
  ok(/does not hash/.test(threw || ""), "chain view: a header that does not hash to the block, no view");
  const src = readFileSync(join(HERE, "refund_door_v0.mjs"), "utf8");
  for (const w of ["fetch(", "process.env", "setInterval", "writeFileSync"]) ok(!src.includes(w), "refund_door_v0.mjs does not use " + w);
  console.log("[5] the worker: published key and seed, sandbox key 401/403/503, door_unavailable, self-description, chain view rule");
}

// [6] the published connected run, as data
const pi = process.argv.indexOf("--published");
if (pi > 0) {
  const dir = process.argv[pi + 1];
  const PUB = JSON.parse(readFileSync(join(HERE, "published_run_pins.json"), "utf8"));
  const R = PUB.run_dir;
  let bad = 0;
  for (const { sha256: h, path: p } of PUB.files) { let got = null; try { got = sha(readFileSync(join(dir, p))); } catch { got = null; } if (got !== h) { bad++; console.log("  sha differs or missing: " + p); } }
  ok(bad === 0, "the " + PUB.files.length + " published files match their sha256 at " + PUB.repository + " " + PUB.commit.slice(0, 8));
  if (bad === 0) {
    const caseIn = (c) => Object.fromEntries(D.FILES.map((f) => [f, readFileSync(join(dir, R, "cases", c, f), "utf8")]));
    const seq = PUB.sequence.map((s) => ({ run_id: PUB.run_id, inputs: caseIn(s.case), consumed_at: s.consumed_at }));
    const rp = await D.replaySequence(seq, { sdk, door, chainView: VIEW });
    const got = rp.body.results.map((r) => r.disposition + (r.code ? ":" + r.code : ""));
    PUB.sequence.forEach((s, i) => ok(got[i] === s.expect, "published " + s.case + " at " + s.consumed_at + ": wanted " + s.expect + ", got " + got[i]));
    ok(verifyAnswers(rp.body, D.keyDocument(door, null)).every((r) => r.problems.length === 0), "every answer over the published run verifies");
    const standin = JSON.parse(readFileSync(join(dir, R, "admission", "state.json"), "utf8")).decisions;
    for (const [i, s] of PUB.sequence.entries()) {
      if (s.expect !== "committed" || rp.body.results[i].repeated) continue;
      const ours = rec(rp.body.results[i].admission);
      const theirs = Object.values(standin).map((x) => x.record).find((x) => x.decision_id === ours.decision_id);
      // The run's stand-in committed on its own clock, a moment after the adapter call; the instants here are the adapter
      // call's. So committed_at and valid_until are compared only where the two round to the same second (j01).
      const skip = ["admission_issuer", "operation_id"].concat(s.same_second ? [] : ["committed_at", "valid_until"]);
      const diff = theirs ? Object.keys(ours).filter((k) => !skip.includes(k) && JSON.stringify(ours[k]) !== JSON.stringify(theirs[k])) : ["no stand-in record"];
      ok(diff.length === 0 && Object.keys(theirs).length === Object.keys(ours).length && Date.parse(ours.valid_until) - Date.parse(ours.committed_at) === 600000,
        "published " + s.case + ": the door's 3.1 equals the run's stand-in record field for field except " + skip.join(", ") + (diff.length ? " (differs: " + diff.join(", ") + ")" : ""));
    }
    console.log("[6] published run " + PUB.repository + " " + PUB.commit.slice(0, 8) + " " + PUB.run_id + ": " + got.join(", "));
  }
}

console.log(fail === 0 ? "refund door: ALL PASS (" + n + " checks)" : "refund door: " + fail + " of " + n + " checks FAILED");
process.exit(fail === 0 ? 0 : 1);
