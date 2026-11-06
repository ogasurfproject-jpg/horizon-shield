// test_inputs.mjs: the eleven input files of one refund case for the door's tests, built with the pinned APS SDK and
// test keys derived from fixed labels (the adapter selftest's labels, so its keys), signed for real so that the door has
// to find each problem in the content, not in a broken signature. Times are the fixed 2026-10-28 instants of the
// adapter selftest unless a test gives others (a live door checks against its own clock).
import { createHash, createPrivateKey, sign as edSign } from "node:crypto";
import * as A from "../musubi-v0/adapters/aps_receipt/adapter_aps_receipt.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
export const FIXED = { t0: "2026-10-28T00:00:00.000Z", approval: "2026-10-28T00:00:01.000Z", eval: "2026-10-28T00:05:00.000Z", consumed: "2026-10-28T00:10:00.000Z",
  validUntil: "2026-10-28T01:00:00.000Z", picExpires: "2026-10-28T00:30:00Z" };
// Instants around now for a live door: the intent a minute ago, the evaluation half a minute ago, 30 minutes of validity.
export function liveTimes(nowMs = Date.now()) {
  const iso = (ms) => new Date(ms).toISOString();
  return { t0: iso(nowMs - 60000), approval: iso(nowMs - 59000), eval: iso(nowMs - 30000), consumed: null,
    validUntil: iso(nowMs + 1800000), picExpires: iso(Math.floor((nowMs + 1800000) / 1000) * 1000).replace(".000Z", "Z") };
}

export function inputs(sdk, times = FIXED) {
  const seedOf = (label) => sha(Buffer.from("hs-aps-receipt-selftest/" + label, "utf8"));
  const bytes = (o) => new Uint8Array(Buffer.from(JSON.stringify(o, null, 2) + "\n", "utf8"));
  const Wk = A.REFUND.worker, Bk = A.REFUND.approval_boundary;
  const RUN = "run-door-0001";
  const edSignB64 = (seedHex, msg) => edSign(null, Buffer.from(msg, "utf8"), createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seedHex, "hex")]), format: "der", type: "pkcs8" })).toString("base64");
  function makeCase(o = {}) {
    const payload = o.payload || { payment_id: "pay_A", amount_minor: 4000, currency: "EUR" };
    const action = sdk.createActionReferenceInputV2({ agent_id: Wk, action_type: "refund", target: A.REFUND.target_prefix + payload.payment_id + A.REFUND.target_suffix,
      payload_ref: sdk.computePayloadRefV1(payload), scope_required: ["payments:refund"], issued_at: times.t0, nonce: o.actionNonce || "0123456789abcdef0123456789abcdef" });
    const actionRef = sdk.computeActionRefV2(action);
    const wS = { signer: Wk, key_id: "wrk-1", private_key: seedOf("worker") }, bS = { signer: Bk, key_id: "bnd-1", private_key: seedOf("boundary") };
    const delegation = "sha256:" + sha(Buffer.from("delegation-test", "utf8"));
    const intent = sdk.createReceiptV1({ profile: "aps-receipt-v1", receipt_type: "aps:action-intent:v1", issuer: Wk, subject_agent: Wk, action_ref: actionRef,
      delegation_ref: delegation, issued_at: times.t0, evidence_refs: [], result: { profile: "aps-action-intent-result-v1", status: "declared" } }, [wS]);
    const decisionId = o.decisionId || "decision-0001";
    const output = sdk.normalizeCoreDecisionOutputV1({ profile: "aps-core-decision-output-v1", verdict: "permit", effective_authority_ref: sha(Buffer.from("authority-test", "utf8")),
      constraints: [], valid_until: o.validUntil || times.validUntil });
    const decision = { authority_state: { grant: "refund-test" }, policy_input: { merchant_decision: { decision_id: decisionId, merchant_id: "merchant-test" } }, decision_context: { channel: "sandbox" }, decision_output: output };
    const built = sdk.buildDecisionRefV1({ action_ref: actionRef, ...decision });
    const approval = sdk.createReceiptV1({ profile: "aps-receipt-v1", receipt_type: "aps:policy-decision:v1", issuer: Bk, subject_agent: Wk, action_ref: actionRef,
      delegation_ref: delegation, decision_ref: built.decision_ref, issued_at: o.approvalIssuedAt || times.approval, evidence_refs: [], result: output, prev: intent.receipt_id }, [bS]);
    const claims = [{ evidence: ["merchant-approval"], text: JSON.stringify({ approval_ref: o.claimApprovalRef || approval.receipt_id, decision_id: decisionId }) }];
    const intentText = "Refund " + payload.amount_minor + " minor units of " + payload.currency + " on " + payload.payment_id + ".";
    const digests = { args_digest: sha(Buffer.from(A.jcs(payload), "utf8")), claims_digest: sha(Buffer.from(A.jcs(claims), "utf8")), intent_digest: sha(Buffer.from(intentText, "utf8")) };
    const att = { ...digests, attestation_version: "PIC-ATT/1.0", expires_at: o.picExpires || times.picExpires, impact: "money", provenance_ids: ["merchant-approval"], tool: "refund" };
    const attText = A.jcs(att);
    const proposal = { action: { args: payload, tool: "refund" }, claims, evidence: [{ alg: "ed25519", id: "merchant-approval", key_id: "merchant-test-v1", payload: attText,
      ref: "inline:merchant_approval_canonical_attestation", signature: edSignB64(seedOf("merchant"), attText), signer: "merchant-test-v1", type: "sig" }],
      impact: "money", intent: intentText, protocol: "PIC/1.0", provenance: [{ id: "merchant-approval", source: "merchant-signer:merchant-test-v1", trust: "trusted" }] };
    const files = {
      "inputs/pic-proposal.json": bytes(proposal), "inputs/aps-approval.json": bytes(approval), "inputs/aps-intent.json": bytes(intent), "inputs/aps-action.json": bytes(action),
      "inputs/aps-payload.json": bytes(payload), "inputs/decision-evidence.json": bytes(decision),
      "trust/pic-keys.json": bytes({ trusted_keys: { "merchant-test-v1": sdk.publicKeyFromPrivate(seedOf("merchant")) }, revoked_keys: [] }),
      "trust/aps-consumption.json": bytes({ schema: A.TRUST_SCHEMA, profile: "aps-receipt-v1", scope: ["payments:refund"], keys: [
        { signer: Wk, key_id: "wrk-1", role: "worker", public_key: sdk.publicKeyFromPrivate(seedOf("worker")), not_before: "2026-10-01T00:00:00.000Z", not_after: null, revoked_at: null },
        { signer: Bk, key_id: "bnd-1", role: "approval-boundary", public_key: sdk.publicKeyFromPrivate(seedOf("boundary")), not_before: "2026-10-01T00:00:00.000Z", not_after: null, revoked_at: o.boundaryRevokedAt || null }] }),
      "trust/handoff-issuance.json": bytes({ selection: "handoff-issuance-test" }), "trust/handoff-evaluation.json": bytes({ selection: "handoff-evaluation-test" }),
    };
    if (o.proposalFrom) files["inputs/pic-proposal.json"] = o.proposalFrom.files["inputs/pic-proposal.json"];
    const raw = (f) => "sha256:" + sha(files[f]);
    // J11: the runner's PIC result over the old proposal is the old result (it names the old proposal's bytes and digests).
    files["inputs/pic-verification.json"] = o.proposalFrom ? o.proposalFrom.files["inputs/pic-verification.json"]
      : bytes({ schema: A.PIC_RESULT_SCHEMA, contract_revision: A.CONTRACT_REVISION, run_id: o.runId || RUN, pic_sdk_commit: A.PIC_SDK_COMMIT,
        proposal_file_ref: raw("inputs/pic-proposal.json"), pic_trust_file_ref: raw("trust/pic-keys.json"), evaluated_at: times.eval, result: "allow", tool: "refund", impact: "money", ...digests, error_code: null });
    if (o.filesEdit) o.filesEdit(files);
    return { files, approval };
  }
  const asStrings = (files) => Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v).toString("utf8")]));
  return { makeCase, bytes, RUN, asStrings };
}
