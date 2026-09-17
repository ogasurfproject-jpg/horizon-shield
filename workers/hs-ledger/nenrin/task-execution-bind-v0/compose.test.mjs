// compose.test.mjs
// Proves the composition seam between the two layers for a2aproject/A2A#1769:
//   task-delegation-bind-v0  (third-party OBSERVATION of the delegation chain), and
//   task-execution-bind-v0   (caller/gateway ACTION + OUTCOME binding).
// The claim Heaviside479 accepted is that they COMPOSE, neither subsumes the other. This test shows the
// composition is LINKAGE, not AUTHORITY: an observation names an execution receipt by its content hash
// (digest-bound carriage), but the observation's verdict is the witness's own and never inherits the
// receipt's outcome, and the receipt's outcome is the provider's own and never inherits the verdict.
import { evidenceId, verifyObservation, aggregateVerdict } from "../task-delegation-bind-v0/bind.mjs";
import { grantRef, receiptId, verifyExecution, reconcileOutcome } from "./bind_exec.mjs";
import { newAgentKey, signReceipt, verifyReceiptSig } from "./sign_exec.mjs";

const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");
let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 200))); if (!c) fail++; };

const T = "task_compose_7a";
const NB = "2026-09-18T00:00:00Z", NA = "2026-09-18T01:00:00Z", IN = "2026-09-18T00:30:00Z";
const CALLER = "did:key:CALLER", PROVIDER = "did:key:PROVIDER";
const provKey = newAgentKey();
const resolve = (id) => (id === PROVIDER ? provKey.publicKey : null);

// --- execution layer: a grant+receipt whose ACTION matches but whose OUTCOME is a business failure ---
const grant = { schema: "task-execution-bind-v0/grant", task_id: T, action: { tool: "a2a.invoke", target: "/invoices/pay", args_sha256: "sha_args_ok" }, caller_id: CALLER, provider_id: PROVIDER, nonce: "n1", not_before: NB, not_after: NA };
grant.grant_ref = grantRef(grant);
let receipt = { schema: "task-execution-bind-v0/receipt", task_id: T, grant_ref: grant.grant_ref, executed_action: { tool: "a2a.invoke", target: "/invoices/pay", args_sha256: "sha_args_ok" }, outcome: { status: "failed", result_sha256: "sha_declined" }, provider_id: PROVIDER, executed_at: IN };
receipt.receipt_id = receiptId(receipt);
receipt = signReceipt(receipt, provKey.privateKey);

// --- observation layer: an independent witness rates the hop conduct "pass" and NAMES the receipt by hash ---
const obs = { task_id: T, hop: { seq: 0, from: CALLER, to: PROVIDER }, prev_evidence_id: null, conduct: { verdict: "pass", detail_ref: "nenrin-exec://" + receipt.receipt_id }, witness_id: "did:key:WITNESS", observed_at: IN };
obs.evidence_id = evidenceId(obs);

// ---- each layer is valid on its own ----
const ve = verifyExecution(grant, receipt);
chk("execution pair binds the action (E1 action_bound), independent of the business outcome", ve.ok === true && ve.reason === "action_bound", ve.reason);
chk("observation is R1+R2 valid on its own", verifyObservation(obs).ok === true);
chk("provider signature on the receipt verifies", verifyReceiptSig(receipt, resolve(PROVIDER)) === true);

// ---- digest-bound carriage: the observation names the receipt by its content hash, and it recomputes ----
const named = obs.conduct.detail_ref.split("nenrin-exec://")[1];
chk("observation carries the receipt by digest and it recomputes to the same id", named === receiptId(receipt));

// ---- LINKAGE, NOT AUTHORITY: verdict and outcome answer different questions and neither becomes the other ----
const verdict = aggregateVerdict([obs]);          // computed with no read of the receipt
const rec = reconcileOutcome([receipt], grant.grant_ref); // computed with no read of the observation
chk("observation verdict is the witness's own (pass)", verdict === "pass");
chk("execution outcome is the provider's own (failed)", rec.status === "reconciled" && rec.outcome.status === "failed");
chk("they disagree yet both are valid: neither layer laundered into the other", verdict === "pass" && rec.outcome.status === "failed");

// ---- authority independence: the observation does not derive its evidence_id or verdict from the receipt ----
const evBefore = obs.evidence_id;
chk("the observation's evidence_id is a pure function of the observation, not the receipt", evidenceId(obs) === evBefore);

// ---- tamper crosses TWO independent detectors: the digest link and the provider signature ----
const tampered = Object.assign({}, receipt, { outcome: { status: "completed", result_sha256: "sha_paid" } });
// receipt_id and provider_sig are now stale relative to the mutated outcome
const linkStillMatches = obs.conduct.detail_ref.split("nenrin-exec://")[1] === receiptId(tampered);
chk("receipt tamper breaks the digest-bound link the observation committed to", linkStillMatches === false);
chk("receipt tamper also breaks the provider signature", verifyReceiptSig(tampered, resolve(PROVIDER)) === false);
chk("the observation itself stays valid under receipt tamper (it committed to the true receipt hash)", verifyObservation(obs).ok === true && obs.evidence_id === evBefore);

// ---- a composed verifier MUST check the three records share one task_id ----
chk("observation, grant and receipt share one task_id", obs.task_id === grant.task_id && grant.task_id === receipt.task_id);

// ---- no forbidden dashes ----
chk("no em/en/bar dashes in any record", !DASH.test(JSON.stringify([grant, receipt, obs])));

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS (composition seam: linkage not authority)");
process.exit(fail ? 1 : 0);
