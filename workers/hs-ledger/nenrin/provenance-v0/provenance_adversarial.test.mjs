// Adversarial test for nenrin-provenance-verify-v0. Builds a fully signed provenance graph for one task and
// then attacks it ACROSS layers: the cases below are ones no single layer can catch on its own.
import { evidenceId, chainContinuous } from "../task-delegation-bind-v0/bind.mjs";
import { newAgentKey, signObservation, signEdge } from "../task-delegation-bind-v0/sign.mjs";
import { grantRef, receiptId } from "../task-execution-bind-v0/bind_exec.mjs";
import { signGrant, signReceipt } from "../task-execution-bind-v0/sign_exec.mjs";
import { verifyProvenance, chainContinuousSet, LINK_PREFIX } from "./provenance_verify.mjs";
import { intentId, signIntent } from "../task-execution-bind-v0/preflight.mjs";

const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");
let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 240))); if (!c) fail++; };
const has = (arr, code) => arr.some((x) => x.code === code);
const reasonOf = (arr, code) => (arr.find((x) => x.code === code) || {}).reason;

const T = "task_prov_1", NB = "2026-09-18T00:00:00Z", NA = "2026-09-18T01:00:00Z", IN = "2026-09-18T00:30:00Z";
const A = "did:key:A", B = "did:key:B", C = "did:key:C", W1 = "did:key:W1", W2 = "did:key:W2", EVIL = "did:key:EVIL";
const K = {}; for (const id of [A, B, C, W1, W2, EVIL]) K[id] = newAgentKey();
const resolve = (id) => (K[id] ? K[id].publicKey : null);
const priv = (id) => K[id].privateKey;
const REF = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const GOODEV = { kind: "ledger_record", ref: REF, system: "ledger.horizonshield.dev" };

function mintObs(o) {
  const obs = { task_id: o.task || T, hop: { seq: o.seq, from: o.from, to: o.to }, prev_evidence_id: o.prev === undefined ? null : o.prev, conduct: { verdict: o.verdict, detail_ref: o.detail_ref === undefined ? null : o.detail_ref }, witness_id: o.witness, observed_at: IN };
  obs.evidence_id = evidenceId(obs);
  return obs;
}
const signObs = (obs, witnessKey, fromKey) => signEdge(signObservation(obs, priv(witnessKey)), priv(fromKey));
function mintGrant(o = {}) {
  const g = { schema: "task-execution-bind-v0/grant", task_id: o.task || T, action: { tool: "a2a.invoke", target: "/invoices/pay", args_sha256: "sha_args_ok" }, caller_id: A, provider_id: B, nonce: "n1", not_before: NB, not_after: NA };
  g.grant_ref = grantRef(g);
  return signGrant(g, priv(A));
}
function mintReceipt(g, o = {}) {
  const r = { schema: "task-execution-bind-v0/receipt", task_id: o.task || g.task_id, grant_ref: g.grant_ref, executed_action: { tool: "a2a.invoke", target: "/invoices/pay", args_sha256: "sha_args_ok" }, outcome: { status: o.status || "completed", result_sha256: o.result || "sha_res_1" }, provider_id: B, executed_at: IN };
  if (o.evidence !== null) r.outcome.evidence = o.evidence === undefined ? GOODEV : o.evidence;
  r.receipt_id = receiptId(r);
  return signReceipt(r, priv(o.signer || B));
}
// a two-hop chain A->B->C, hop 0 naming the receipt by digest
function chainFor(rcpt) {
  const h0 = signObs(mintObs({ seq: 0, from: A, to: B, witness: W1, verdict: "pass", detail_ref: LINK_PREFIX + rcpt.receipt_id }), W1, A);
  const h1 = signObs(mintObs({ seq: 1, from: B, to: C, witness: W2, verdict: "pass", prev: h0.evidence_id, detail_ref: "nenrin://" + T + "/1" }), W2, B);
  return [h0, h1];
}

const grant = mintGrant();
const receipt = mintReceipt(grant);
const [h0, h1] = chainFor(receipt);
const happy = { task_id: T, observations: [h0, h1], grant, receipt, resolve };

// ---- P0 happy path: the full graph is accepted, and the only finding is the honest "bound but unchecked" ----
const r0 = verifyProvenance(happy);
chk("P0 full signed graph is accepted with no refusals", r0.verdict === "accepted" && r0.refusals.length === 0, JSON.stringify(r0.refusals));
chk("P0 the only finding is evidence_bound_unchecked", r0.findings.length === 1 && r0.findings[0].code === "evidence_bound_unchecked", JSON.stringify(r0.findings));
chk("P0 one digest link, hop verdicts pass/pass, reconciled completed", r0.layers.linkage.links === 1 && r0.layers.delegation.hop_verdicts.map((h) => h.verdict).join(",") === "pass,pass" && r0.layers.execution.reconciliation === "reconciled" && r0.layers.execution.outcome.status === "completed");
chk("P0 the report writes the side-effect wall into does_not_establish", r0.does_not_establish.some((s) => s.includes("no side-effect oracle")));
chk("P0 establishes is populated and names the evidence pointer", r0.establishes.length >= 10 && r0.establishes.some((s) => s.includes("ledger_record:" + REF)));

// ---- P1 cross-layer: a receipt from a different task cannot be attached ----
const gOther = mintGrant({ task: "task_other" });
const rOther = mintReceipt(gOther, { task: "task_other" });
const r1 = verifyProvenance({ task_id: T, observations: [h0, h1], grant, receipt: rOther, resolve });
chk("P1 task_id mismatch is refused", r1.verdict === "refused" && has(r1.refusals, "task_id_mismatch"), JSON.stringify(r1.refusals));

// ---- P2 cross-layer: an observation naming a receipt that is not the reconciled one ----
const [b0, b1] = (() => { const x0 = signObs(mintObs({ seq: 0, from: A, to: B, witness: W1, verdict: "pass", detail_ref: LINK_PREFIX + "f".repeat(64) }), W1, A); const x1 = signObs(mintObs({ seq: 1, from: B, to: C, witness: W2, verdict: "pass", prev: x0.evidence_id }), W2, B); return [x0, x1]; })();
const r2 = verifyProvenance({ task_id: T, observations: [b0, b1], grant, receipt, resolve });
chk("P2 observation naming the wrong receipt by digest is refused (linkage_receipt_mismatch)", r2.verdict === "refused" && has(r2.refusals, "linkage_receipt_mismatch"), JSON.stringify(r2.refusals));

// ---- P3 cross-layer: execution is perfect but the delegation chain hides a hop ----
const h2 = signObs(mintObs({ seq: 2, from: B, to: C, witness: W2, verdict: "pass", prev: h0.evidence_id }), W2, B);
const r3 = verifyProvenance({ task_id: T, observations: [h0, h2], grant, receipt, resolve });
chk("P3 hidden hop refuses the whole provenance even though execution binds", r3.verdict === "refused" && has(r3.refusals, "delegation_chain_broken") && reasonOf(r3.refusals, "delegation_chain_broken") === "seq_gap" && r3.layers.execution.pair === "action_bound", JSON.stringify(r3.refusals));
chk("P3 a refused report establishes nothing (fail-closed for readers)", r3.establishes.length === 1 && r3.establishes[0] === "nothing: see refusals");

// ---- P4 witness disagreement on one hop is surfaced, never collapsed, and the chain still continues ----
const d0a = signObs(mintObs({ seq: 0, from: A, to: B, witness: W1, verdict: "pass", detail_ref: LINK_PREFIX + receipt.receipt_id }), W1, A);
const d0b = signObs(mintObs({ seq: 0, from: A, to: B, witness: W2, verdict: "fail", detail_ref: LINK_PREFIX + receipt.receipt_id }), W2, A);
const d1 = signObs(mintObs({ seq: 1, from: B, to: C, witness: W1, verdict: "pass", prev: d0a.evidence_id }), W1, B);
const r4 = verifyProvenance({ task_id: T, observations: [d0a, d0b, d1], grant, receipt, resolve });
chk("P4 disagreement is accepted as valid provenance with a witness_disagreement finding", r4.verdict === "accepted" && has(r4.findings, "witness_disagreement"), JSON.stringify(r4.refusals));
chk("P4 hop 0 aggregates to disagreement, not pass", r4.layers.delegation.hop_verdicts[0].verdict === "disagreement");
chk("P4 chain continuity holds with two witnesses on hop 0 (set-generalized R3)", r4.layers.delegation.chain.ok === true);

// ---- P5 provider equivocation refuses: no single outcome can be established ----
const receipt2 = mintReceipt(grant, { status: "failed", result: "sha_res_2" });
const r5 = verifyProvenance({ task_id: T, observations: [h0, h1], grant, receipt, receipts: [receipt, receipt2], resolve });
chk("P5 equivocation is refused (execution_equivocation) with both receipt ids", r5.verdict === "refused" && has(r5.refusals, "execution_equivocation") && r5.refusals.find((x) => x.code === "execution_equivocation").receipt_ids.length === 2, JSON.stringify(r5.refusals));

// ---- P6 a griefer's forged second receipt does NOT refuse (griefing resistance carries through) ----
const forged = mintReceipt(grant, { status: "failed", result: "sha_evil", signer: EVIL });
const r6 = verifyProvenance({ task_id: T, observations: [h0, h1], grant, receipt, receipts: [receipt, forged], resolve });
chk("P6 a stranger's forged receipt cannot refuse the provenance", r6.verdict === "accepted" && r6.layers.execution.reconciliation === "reconciled", JSON.stringify(r6.refusals));

// ---- P7 malformed evidence refuses ----
const rBad = mintReceipt(grant, { evidence: { kind: "vibes", ref: REF, system: "x" } });
const r7 = verifyProvenance({ task_id: T, observations: chainFor(rBad), grant, receipt: rBad, resolve });
chk("P7 malformed evidence pointer is refused (evidence_invalid / evidence_kind_unknown)", r7.verdict === "refused" && reasonOf(r7.refusals, "evidence_invalid") === "evidence_kind_unknown", JSON.stringify(r7.refusals));

// ---- P8 injected lookup: not found refuses; confirmed upgrades bound to confirmed ----
const r8a = verifyProvenance({ ...happy, lookup: () => ({ found: false, matches: false }) });
chk("P8a lookup not found refuses", r8a.verdict === "refused" && reasonOf(r8a.refusals, "evidence_invalid") === "evidence_not_found", JSON.stringify(r8a.refusals));
const r8b = verifyProvenance({ ...happy, lookup: (ev) => ({ found: ev.ref === REF, matches: true }) });
chk("P8b lookup confirmed accepts with checked_externally true and no unchecked finding", r8b.verdict === "accepted" && r8b.layers.evidence.checked_externally === true && !has(r8b.findings, "evidence_bound_unchecked") && r8b.establishes.some((s) => s.includes("confirmed by the injected lookup")));

// ---- P9 spoofed witness: caught with signatures, invisible without (what signatures add) ----
const s0 = signEdge(signObservation(mintObs({ seq: 0, from: A, to: B, witness: W1, verdict: "pass", detail_ref: LINK_PREFIX + receipt.receipt_id }), priv(EVIL)), priv(A));
const r9a = verifyProvenance({ task_id: T, observations: [s0, h1], grant, receipt, resolve });
chk("P9a spoofed witness signature is refused when signatures are required", r9a.verdict === "refused" && reasonOf(r9a.refusals, "delegation_observation_invalid") === "witness_sig_invalid", JSON.stringify(r9a.refusals));
const r9b = verifyProvenance({ task_id: T, observations: [s0, h1], grant, receipt, resolve, require_signatures: false });
chk("P9b the same spoof is structurally invisible without signatures (attribution is what sigs add)", r9b.verdict === "accepted");

// ---- P10 execution only: layers are optional and their absence is stated, not hidden ----
const r10 = verifyProvenance({ task_id: T, grant, receipt, resolve });
chk("P10 execution-only provenance is accepted with no_delegation_observations stated", r10.verdict === "accepted" && has(r10.findings, "no_delegation_observations") && r10.layers.delegation.present === false && r10.layers.linkage.links === 0);

// ---- P11 chainContinuousSet reduces to the pinned chainContinuous when one witness per hop ----
chk("P11 set R3 agrees with pinned R3 on a valid chain", chainContinuousSet([h0, h1]).ok === true && chainContinuous([h0, h1]).ok === true);
const forgedLink = mintObs({ seq: 1, from: B, to: C, witness: W2, verdict: "pass", prev: "deadbeef" });
chk("P11 set R3 agrees with pinned R3 on a forged link (broken_link)", chainContinuousSet([h0, forgedLink]).reason === "broken_link" && chainContinuous([h0, forgedLink]).reason === "broken_link");
chk("P11 set R3 agrees with pinned R3 on a hidden hop (seq_gap)", chainContinuousSet([h0, h2]).reason === "seq_gap" && chainContinuous([h0, h2]).reason === "seq_gap");

// ---- P12 pre-execution intent: declared == authorized == executed ----
function mintIntent(g, o = {}) {
  const i = { schema: "task-execution-bind-v0/intent", task_id: o.task || T, grant_ref: o.grantRef || g.grant_ref, proposed_action: { tool: "a2a.invoke", target: o.target || "/invoices/pay", args_sha256: "sha_args_ok" }, provider_id: B, declared_at: IN };
  i.intent_id = intentId(i);
  return signIntent(i, priv(o.signer || B));
}
const r12 = verifyProvenance({ ...happy, intent: mintIntent(grant) });
chk("P12 a matching signed intent is accepted and records the pre-execution promise", r12.verdict === "accepted" && r12.layers.preflight.present === true && r12.layers.preflight.declared_matches_executed === true, JSON.stringify(r12.refusals));
chk("P12 establishes the declared equals authorized equals executed chain", r12.establishes.some((sx) => sx.includes("declared equals authorized equals executed")));

// ---- P13 spoofed intent signature ----
const r13 = verifyProvenance({ ...happy, intent: mintIntent(grant, { signer: EVIL }) });
chk("P13 a spoofed intent signature is refused (preflight_signature_invalid)", r13.verdict === "refused" && has(r13.refusals, "preflight_signature_invalid"), JSON.stringify(r13.refusals));

// ---- P14 intent bound to a grant it does not hash to ----
const r14 = verifyProvenance({ ...happy, intent: mintIntent(grant, { grantRef: "deadbeef" }) });
chk("P14 an intent not hashing to the grant is refused (preflight_invalid / intent_unbound)", r14.verdict === "refused" && reasonOf(r14.refusals, "preflight_invalid") === "intent_unbound", JSON.stringify(r14.refusals));

// ---- P15 intent carrying a different task_id ----
const r15 = verifyProvenance({ ...happy, intent: mintIntent(grant, { task: "task_other" }) });
chk("P15 an intent with a different task_id is refused (task_id_mismatch)", r15.verdict === "refused" && has(r15.refusals, "task_id_mismatch"), JSON.stringify(r15.refusals));

// ---- determinism + no forbidden dashes ----
chk("report is deterministic for identical input", JSON.stringify(verifyProvenance(happy)) === JSON.stringify(r0));
chk("no em/en/bar dashes in graph or report", !DASH.test(JSON.stringify([happy.observations, grant, receipt, r0])));

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS (nenrin-provenance-verify-v0 adversarial)");
process.exit(fail ? 1 : 0);
