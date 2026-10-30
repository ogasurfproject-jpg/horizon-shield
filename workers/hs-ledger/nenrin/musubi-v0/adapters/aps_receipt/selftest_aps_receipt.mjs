#!/usr/bin/env node
// Selftest of adapter_aps_receipt.mjs. Builds the eleven section 3 files of one refund case with the pinned APS SDK
// itself (createReceiptV1, buildDecisionRefV1, createActionReferenceInputV2, computePayloadRefV1), signed with test keys
// derived in memory from fixed labels (nothing is written to disk), then runs the adapter over the case and over
// variants that must be refused, each named by the acceptance case of the contract it belongs to (section 11).
//
// These are the adapter's own synthetic cases. They are not APS's native fixtures, which APS produces for the agreed
// fixture set; the per-case output over that set is published separately.
//
//   npm ci --ignore-scripts && node selftest_aps_receipt.mjs
import { createHash, createPrivateKey, sign as edSign } from "node:crypto";
import { readFileSync, mkdtempSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "./adapter_aps_receipt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { sdk } = await A.pinnedSdk();
const sha = (b) => createHash("sha256").update(b).digest("hex");
const seedOf = (label) => sha(Buffer.from("hs-aps-receipt-selftest/" + label, "utf8"));
const bytes = (o) => new Uint8Array(Buffer.from(JSON.stringify(o, null, 2) + "\n", "utf8"));
const W = A.REFUND.worker, B = A.REFUND.approval_boundary;
const T0 = "2026-10-28T00:00:00.000Z", T1 = "2026-10-28T00:00:01.000Z", TEVAL = "2026-10-28T00:05:00.000Z";
const CONSUMED = "2026-10-28T00:10:00.000Z", UNTIL = "2026-10-28T01:00:00.000Z", PIC_EXP = "2026-10-28T00:30:00Z";
const RUN = "run-selftest-0001";

function edSignB64(seedHex, msg) {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seedHex, "hex")]);
  return edSign(null, Buffer.from(msg, "utf8"), createPrivateKey({ key: der, format: "der", type: "pkcs8" })).toString("base64");
}

// One case. Every option changes the inputs before they are signed, so the signatures stay genuine and the adapter
// has to find the problem in the content, not in a broken signature.
function makeCase(o = {}) {
  const payload = o.payload || { payment_id: "pay_A", amount_minor: 4000, currency: "EUR" };
  const actPayload = o.actPayload || payload;
  const pid = o.targetPaymentId || actPayload.payment_id;
  const action = sdk.createActionReferenceInputV2({
    agent_id: o.agent_id || W, action_type: o.action_type || "refund",
    target: o.target || (A.REFUND.target_prefix + pid + A.REFUND.target_suffix),
    payload_ref: sdk.computePayloadRefV1(actPayload), scope_required: o.scope || ["payments:refund"], issued_at: T0, nonce: "0123456789abcdef0123456789abcdef",
  });
  const actionRef = sdk.computeActionRefV2(action);
  const kidB = o.boundaryKid || "bnd-1";
  const wSigner = { signer: W, key_id: "wrk-1", private_key: seedOf("worker") };
  const bSigner = { signer: B, key_id: kidB, private_key: seedOf(kidB === "bnd-1" ? "boundary" : kidB) };
  const delegation = "sha256:" + sha(Buffer.from("delegation-test", "utf8"));
  const intent = sdk.createReceiptV1({ profile: "aps-receipt-v1", receipt_type: "aps:action-intent:v1", issuer: W, subject_agent: W,
    action_ref: o.intentActionRef || actionRef, delegation_ref: delegation, issued_at: T0, evidence_refs: [],
    result: { profile: "aps-action-intent-result-v1", status: "declared" } }, [wSigner]);
  const otherIntent = o.otherIntent ? sdk.createReceiptV1({ profile: "aps-receipt-v1", receipt_type: "aps:action-intent:v1", issuer: W, subject_agent: W,
    action_ref: actionRef, delegation_ref: delegation, issued_at: "2026-10-27T23:59:00.000Z", evidence_refs: [],
    result: { profile: "aps-action-intent-result-v1", status: "declared" } }, [wSigner]) : null;
  const decisionId = "decision_id" in o ? o.decision_id : "decision-0001";
  const md = decisionId === undefined ? { merchant_id: "merchant-test" } : { decision_id: decisionId, merchant_id: "merchant-test" };
  const output = sdk.normalizeCoreDecisionOutputV1({ profile: "aps-core-decision-output-v1", verdict: o.verdict || "permit",
    effective_authority_ref: (o.verdict === "deny") ? null : sha(Buffer.from("authority-test", "utf8")), constraints: o.constraints || [],
    valid_until: o.verdict === "deny" ? null : (o.validUntil || UNTIL) });
  const decision = { authority_state: { grant: "refund-test" }, policy_input: { merchant_decision: md }, decision_context: { channel: "sandbox" }, decision_output: output };
  const built = sdk.buildDecisionRefV1({ action_ref: actionRef, ...decision });
  const approval = sdk.createReceiptV1({ profile: "aps-receipt-v1", receipt_type: "aps:policy-decision:v1", issuer: B, subject_agent: o.approvalSubject || W,
    action_ref: actionRef, delegation_ref: delegation, decision_ref: built.decision_ref, issued_at: o.approvalIssuedAt || T1, evidence_refs: [],
    result: output, prev: (otherIntent || intent).receipt_id }, [bSigner]);
  const claimApproval = o.claimApprovalRef || approval.receipt_id;
  const claimText = JSON.stringify({ approval_ref: claimApproval, decision_id: o.claimDecisionId || decisionId || "decision-0001" });
  const picArgs = o.picArgs || payload;
  const claims = [{ evidence: ["merchant-approval"], text: claimText }];
  const intentText = "Refund " + picArgs.amount_minor + " minor units of " + picArgs.currency + " on " + picArgs.payment_id + ".";
  const digests = { args_digest: sha(Buffer.from(A.jcs(picArgs), "utf8")), claims_digest: sha(Buffer.from(A.jcs(claims), "utf8")), intent_digest: sha(Buffer.from(intentText, "utf8")) };
  const att = { ...digests, attestation_version: "PIC-ATT/1.0", expires_at: o.picExpires || PIC_EXP, impact: "money", provenance_ids: ["merchant-approval"], tool: "refund" };
  const attText = A.jcs(att);
  const proposal = { action: { args: picArgs, tool: o.picTool || "refund" }, claims,
    evidence: [{ alg: "ed25519", id: "merchant-approval", key_id: "merchant-test-v1", payload: attText, ref: "inline:merchant_approval_canonical_attestation",
      signature: edSignB64(seedOf("merchant"), attText), signer: "merchant-test-v1", type: "sig" }],
    impact: "money", intent: intentText, protocol: "PIC/1.0", provenance: [{ id: "merchant-approval", source: "merchant-signer:merchant-test-v1", trust: "trusted" }] };
  const picKeys = { trusted_keys: { "merchant-test-v1": Buffer.from(sdk.publicKeyFromPrivate(seedOf("merchant")), "hex").toString("base64") } };
  const files = {
    "inputs/pic-proposal.json": o.proposalBytes ? o.proposalBytes(proposal) : bytes(proposal),
    "inputs/aps-approval.json": bytes(approval), "inputs/aps-intent.json": bytes(intent), "inputs/aps-action.json": bytes(action),
    "inputs/aps-payload.json": bytes(payload), "inputs/decision-evidence.json": bytes(o.decisionEdit ? o.decisionEdit(decision) : decision),
    "trust/pic-keys.json": bytes(picKeys),
    "trust/aps-consumption.json": bytes({ schema: A.TRUST_SCHEMA, profile: "aps-receipt-v1", scope: ["payments:refund"], keys: [
      { signer: W, key_id: "wrk-1", role: "worker", public_key: sdk.publicKeyFromPrivate(seedOf("worker")), not_before: "2026-10-01T00:00:00.000Z", not_after: null, revoked_at: null },
      { signer: B, key_id: "bnd-1", role: "approval-boundary", public_key: sdk.publicKeyFromPrivate(seedOf("boundary")), not_before: "2026-10-01T00:00:00.000Z", not_after: null, revoked_at: o.boundaryRevokedAt || null },
    ] }),
    "trust/handoff-issuance.json": bytes({ selection: "handoff-issuance-test" }),
    "trust/handoff-evaluation.json": bytes({ selection: "handoff-evaluation-test" }),
  };
  const raw = (f) => "sha256:" + sha(files[f]);
  const result = { schema: A.PIC_RESULT_SCHEMA, contract_revision: A.CONTRACT_REVISION, run_id: o.resultRunId || RUN, pic_sdk_commit: A.PIC_SDK_COMMIT,
    proposal_file_ref: raw("inputs/pic-proposal.json"), pic_trust_file_ref: raw("trust/pic-keys.json"), evaluated_at: TEVAL,
    result: o.picResult || "allow", tool: "refund", impact: "money", ...digests, error_code: null, ...(o.resultEdit || {}) };
  files["inputs/pic-verification.json"] = bytes(result);
  if (o.filesEdit) o.filesEdit(files);
  return { files, approval, intent, otherIntent };
}

const tamperSig = (f) => (files) => {
  const r = JSON.parse(Buffer.from(files[f]).toString("utf8"));
  const v = r.signatures[0].value; r.signatures[0].value = (v[0] === "0" ? "1" : "0") + v.slice(1);
  files[f] = bytes(r);
};

// The action_ref of another refund (pay_B), for an intent that names a different action than its approval.
const OTHER_ACTION_REF = sdk.computeActionRefV2(JSON.parse(Buffer.from(makeCase({ payload: { payment_id: "pay_B", amount_minor: 4000, currency: "EUR" } }).files["inputs/aps-action.json"]).toString("utf8")));

const CASES = [
  ["J01 exact original approval (the admission half)", {}, null],
  ["J02 changed payment ID in the payload", { filesEdit: (f) => { f["inputs/aps-payload.json"] = bytes({ payment_id: "pay_B", amount_minor: 4000, currency: "EUR" }); } }, "PAYLOAD_REF"],
  ["J02 changed amount in the payload (4001)", { filesEdit: (f) => { f["inputs/aps-payload.json"] = bytes({ payment_id: "pay_A", amount_minor: 4001, currency: "EUR" }); } }, "PAYLOAD_REF"],
  ["J02 changed currency in the payload (USD)", { filesEdit: (f) => { f["inputs/aps-payload.json"] = bytes({ payment_id: "pay_A", amount_minor: 4000, currency: "USD" }); } }, "PAYLOAD_SCHEMA"],
  ["J02 changed payment ID in action and payload, approval for pay_A", { filesEdit: (f) => {
    const alt = makeCase({ payload: { payment_id: "pay_B", amount_minor: 4000, currency: "EUR" } });
    f["inputs/aps-action.json"] = alt.files["inputs/aps-action.json"]; f["inputs/aps-payload.json"] = alt.files["inputs/aps-payload.json"]; } }, "ACTION_REF"],
  ["J03 wrong tool at the PIC boundary", { picTool: "payments_send" }, "PIC_PROPOSAL_PROFILE"],
  ["J03 wrong action type, signed", { action_type: "chargeback" }, "ACTION_TYPE"],
  ["J03 wrong target host, signed", { target: "https://payments.elsewhere.example/v1/payments/pay_A/refunds" }, "TARGET"],
  ["J03 wrong worker, signed", { agent_id: "did:example:other-worker" }, "WORKER"],
  ["J03 wider scope, signed", { scope: ["payments:refund", "payments:write"] }, "SCOPE"],
  ["J04 missing PIC proposal", { filesEdit: (f) => { delete f["inputs/pic-proposal.json"]; } }, "INPUT_SET"],
  ["J04 forged APS approval signature", { filesEdit: tamperSig("inputs/aps-approval.json") }, "APPROVAL_NOT_VALID"],
  ["J04 forged APS intent signature", { filesEdit: tamperSig("inputs/aps-intent.json") }, "INTENT_NOT_VALID"],
  ["J04 APS approval under a key not in the trust selection", { boundaryKid: "bnd-x" }, "APPROVAL_NOT_VALID"],
  ["J04 APS decision expired before consumption", { validUntil: "2026-10-28T00:09:59.999Z" }, "DECISION_EXPIRED_AT_CONSUMPTION"],
  ["J04 PIC attestation expired before consumption", { picExpires: "2026-10-28T00:09:00Z" }, "PIC_EXPIRED_AT_CONSUMPTION"],
  ["profile: deny verdict", { verdict: "deny" }, "VERDICT_NOT_PERMIT"],
  ["profile: permit with a constraint (section 5: none implemented)", { constraints: ["refund_max_minor:1"] }, "DECISION_CONSTRAINTS"],
  ["J05 decision component changed after binding", { decisionEdit: (d) => ({ ...d, decision_context: { channel: "elsewhere" } }) }, "DECISION_NOT_BOUND"],
  ["J05 decision component missing", { decisionEdit: (d) => ({ authority_state: d.authority_state, policy_input: d.policy_input, decision_output: d.decision_output }) }, "DECISION_COMPONENTS"],
  ["J05 merchant decision ID differs in the PIC claim", { claimDecisionId: "decision-9999" }, "PIC_DECISION_ID"],
  ["J05 merchant decision ID absent, signed", { decision_id: undefined }, "DECISION_ID"],
  ["J05 approval names another intent", { otherIntent: true }, "APPROVAL_PREV"],
  ["J05 intent names another action than its approval, both signed", { intentActionRef: OTHER_ACTION_REF }, "APPROVAL_INTENT_ACTION"],
  ["J05 approval names another subject than its intent, signed", { approvalSubject: "did:example:other-worker" }, "APPROVAL_INTENT_ACTION"],
  ["J06 PIC result from another run", { resultRunId: "run-selftest-0000" }, "PIC_RESULT_RUN_ID"],
  ["J06 PIC result block", { picResult: "block" }, "PIC_RESULT_NOT_ALLOW"],
  ["J06 PIC result for other proposal bytes", { resultEdit: { proposal_file_ref: "sha256:" + "0".repeat(64) } }, "PIC_PROPOSAL_FILE_REF"],
  ["J06 PIC result for other keyring bytes", { resultEdit: { pic_trust_file_ref: "sha256:" + "0".repeat(64) } }, "PIC_TRUST_FILE_REF"],
  ["J06 proposal re-serialized after evaluation (same content, other bytes)", { filesEdit: (f) => {
    const p = JSON.parse(Buffer.from(f["inputs/pic-proposal.json"]).toString("utf8")); f["inputs/pic-proposal.json"] = new Uint8Array(Buffer.from(JSON.stringify(p) + "\n")); } }, "PIC_PROPOSAL_FILE_REF"],
  ["J06 PIC result digest not the attestation's", { resultEdit: { args_digest: "0".repeat(64) } }, "PIC_ATTESTATION_DIGESTS"],
  ["J06 extra field in the PIC result", { resultEdit: { arguments: { payment_id: "pay_A" } } }, "PIC_RESULT_SHAPE"],
  ["J06 PIC arguments other than the APS payload", { picArgs: { payment_id: "pay_A", amount_minor: 3999, currency: "EUR" } }, "PIC_ARGS_NOT_PAYLOAD"],
  ["J11 new APS receipt with the old PIC proposal", { claimApprovalRef: "a".repeat(64) }, "PIC_APPROVAL_REF"],
  ["J11 PIC approval_ref not in APS form", { claimApprovalRef: "approval-001" }, "PIC_APPROVAL_REF_FORM"],
  ["J14 APS approval signer revoked before consumption", { boundaryRevokedAt: "2026-10-28T00:09:00.000Z" }, "APPROVAL_SIGNER_REVOKED_AT_CONSUMPTION"],
  ["J14 APS approval signer revoked before the approval was issued", { boundaryRevokedAt: "2026-10-27T23:00:00.000Z" }, "APPROVAL_SIGNER_REVOKED_AT_CONSUMPTION"],
  ["J14 control: revoked after consumption", { boundaryRevokedAt: "2026-10-28T00:10:00.001Z" }, null],
  ["J04 and J14 together: decision expired and approval signer revoked before consumption (step 3 reads valid_until first)", { validUntil: "2026-10-28T00:09:59.999Z", boundaryRevokedAt: "2026-10-28T00:09:00.000Z" }, "DECISION_EXPIRED_AT_CONSUMPTION"],
  ["parse: duplicate member", { filesEdit: (f) => { f["inputs/aps-payload.json"] = new Uint8Array(Buffer.from('{"payment_id":"pay_A","amount_minor":4000,"amount_minor":4000,"currency":"EUR"}')); } }, "STRICT_PARSE"],
  ["parse: negative zero", { filesEdit: (f) => { f["trust/handoff-issuance.json"] = new Uint8Array(Buffer.from('{"n":-0}')); } }, "STRICT_PARSE"],
  ["parse: negative zero inside a string is text", { filesEdit: (f) => { f["trust/handoff-issuance.json"] = new Uint8Array(Buffer.from('{"selection":"-0","n":-10}')); } }, null],
  ["parse: NaN", { filesEdit: (f) => { f["trust/handoff-issuance.json"] = new Uint8Array(Buffer.from('{"selection":NaN}')); } }, "STRICT_PARSE"],
  ["parse: integer outside the safe range", { filesEdit: (f) => { f["trust/handoff-evaluation.json"] = new Uint8Array(Buffer.from('{"n":9007199254740993}')); } }, "STRICT_PARSE"],
  ["parse: byte order mark", { filesEdit: (f) => { f["trust/pic-keys.json"] = new Uint8Array(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(f["trust/pic-keys.json"])])); } }, "STRICT_PARSE"],
  ["parse: not UTF-8", { filesEdit: (f) => { f["trust/handoff-issuance.json"] = new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]); } }, "STRICT_PARSE"],
  ["input set: a twelfth file", { filesEdit: (f) => { f["inputs/extra.json"] = bytes({}); } }, "INPUT_SET"],
];

let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log("FAIL " + m); } };

// [1] the pinned SDK
console.log("[1] agent-passport-system " + (await A.pinnedSdk()).version + ", package tree matches PINS.json");
{
  const tmp = mkdtempSync(join(tmpdir(), "apsr-pin-"));
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.resolve("agent-passport-system")))));
  cpSync(root, join(tmp, "p"), { recursive: true });
  const before = A.treeDigest(join(tmp, "p"));
  writeFileSync(join(tmp, "p", "dist", "src", "v2", "receipt-core", "composite.js"), "// changed\n", { flag: "a" });
  ok(before === JSON.parse(readFileSync(join(HERE, "PINS.json"), "utf8")).aps.package_tree_sha256, "a copy of the installed package has the pinned tree digest");
  ok(A.treeDigest(join(tmp, "p")) !== before, "one appended line in composite.js changes the tree digest");
}

// [2] PIC canonical digests against the pic-standard refund-approval example (74f980c)
{
  const ex = { args: { amount_minor: 4000, currency: "EUR", payment_id: "pay_A" },
    claims: [{ evidence: ["merchant-approval"], text: "{\"approval_ref\":\"approval-001\",\"decision_id\":\"decision-001\"}" }],
    intent: "Refund 4000 minor units of EUR on pay_A per merchant decision decision-001." };
  ok(sha(Buffer.from(A.jcs(ex.args))) === "0807321ed7a9fd18ced8b410487ef10a43c8f539d1f36b2693619fce62b4e698", "args_digest of the PIC example");
  ok(sha(Buffer.from(A.jcs(ex.claims))) === "6839325fba8f811b60270aa5a7d9bdb8a7459d858cbd47aeb1d3aac6607452fd", "claims_digest of the PIC example");
  ok(sha(Buffer.from(ex.intent, "utf8")) === "19ee57d309fd1491642bc291bb84cc9b8d417b0036d1db7045745ad999c464b2", "intent_digest of the PIC example");
  for (const bad of [NaN, Infinity, 2 ** 53, "\ud800"]) { let threw = false; try { A.jcs({ v: bad }); } catch { threw = true; } ok(threw, "PIC canonical JSON refuses " + String(bad)); }
  console.log("[2] PIC canonical JSON: the three digests of the pic-standard refund-approval example, and four refusals");
}

// [3] the cases
const results = [];
for (const [name, o, want] of CASES) {
  const c = makeCase(o);
  const r = await A.checkRefundCase({ files: c.files, run_id: RUN, consumed_at: CONSUMED });
  results.push({ name, verified: r.verified, reason: r.reason, step: r.step, code: r.code });
  ok(want === null ? r.verified === true : (r.verified === false && r.code === want && A.REASONS_USED.includes(r.reason)),
    name + ": wanted " + (want || "verified") + ", got " + (r.verified ? "verified" : r.code + " (" + r.detail + ")"));
  if (want === null) {
    ok(r.inputs.length === 11 && r.inputs.every((x) => /^sha256:[0-9a-f]{64}$/.test(x.raw_sha256) && /^[0-9a-f]{64}$/.test(x.canonical_sha256)), name + ": both hashes of all eleven files");
    ok(r.approval_ref === c.approval.receipt_id && r.decision_id === "decision-0001" && r.tuple.amount_minor === 4000, name + ": the verified identifiers");
  }
}
const refused = results.filter((r) => !r.verified);
console.log("[3] " + results.length + " cases: " + (results.length - refused.length) + " verified, " + refused.length + " refused, each at its own check");
for (const r of results) console.log("    " + (r.verified ? "verified" : ("refused  step " + r.step + "  " + r.reason + "  " + r.code)).padEnd(78) + r.name);

// [4] the same inputs give the same answer, and the arguments are not read from the run
{
  const c = makeCase();
  const a = await A.checkRefundCase({ files: c.files, run_id: RUN, consumed_at: CONSUMED });
  const b = await A.checkRefundCase({ files: c.files, run_id: RUN, consumed_at: CONSUMED });
  ok(JSON.stringify(a) === JSON.stringify(b), "two runs over the same bytes give the same output");
  const late = await A.checkRefundCase({ files: c.files, run_id: RUN, consumed_at: "2026-10-28T00:04:59.999Z" });
  ok(late.code === "PIC_EVALUATED_AT", "a consumption instant before the PIC evaluation is refused");
  const bad = await A.checkRefundCase({ files: c.files, run_id: RUN, consumed_at: "2026-10-28T00:10:00Z" });
  ok(bad.code === "CONSUMED_AT", "the consumption instant must be UTC with milliseconds");
  console.log("[4] determinism and the consumption clock");
}

// [5] the adapter holds no state, key or network
{
  const src = readFileSync(join(HERE, "adapter_aps_receipt.mjs"), "utf8");
  for (const w of ["writeFileSync", "fetch(", "setInterval", "process.env", "createPrivateKey", "sign("]) ok(!src.includes(w), "the adapter does not use " + w);
  console.log("[5] the adapter writes nothing, opens no socket, reads no environment and signs nothing");
}

console.log(fail === 0 ? "ALL PASS (" + n + " checks)" : fail + " of " + n + " checks FAILED");
process.exit(fail === 0 ? 0 : 1);
