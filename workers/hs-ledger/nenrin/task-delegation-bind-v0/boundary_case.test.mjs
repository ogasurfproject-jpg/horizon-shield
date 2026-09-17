// boundary_case.test.mjs
// Labeled boundary case for a2aproject/A2A#1769 (Poke-nushi's VATE points).
// Shows BY CONSTRUCTION that a fully R1..R4-valid WitnessObservation set is silent on
//   (a) authorized-action match, and
//   (b) post-response-loss outcome / completion.
// It does NOT add those properties; it makes the boundary testable rather than asserted.
// Method: take real-world scenarios that differ ONLY in a dimension v0 does not model
// (the executed target argument; whether the hop completed), map each through the honest v0
// mapping (which has no slot for those), and show v0 yields byte-identical, equally-valid
// evidence. Identical evidence means v0 cannot witness the difference.

import { preimage, evidenceId, verifyObservation, chainContinuous, aggregateVerdict } from "./bind.mjs";

let fail = 0;
const chk = (name, cond) => { console.log((cond ? "ok   " : "FAIL ") + name); if (!cond) fail++; };

// The honest v0 mapping: a WitnessObservation carries task, hop, prev link, a conduct verdict,
// witness and time. It has NO slot for the scenario's authorized/executed target or its outcome.
function toV0Observation(sc, prev) {
  const o = {
    task_id: sc.task,
    hop: sc.hop,
    prev_evidence_id: prev,
    conduct: { verdict: sc.witnessVerdict, detail_ref: null },
    witness_id: sc.witness,
    observed_at: sc.at,
  };
  o.evidence_id = evidenceId(o);
  return o;
}

const base = { task: "t-boundary", hop: { seq: 0, from: "A", to: "B" }, witness: "W", witnessVerdict: "ok", at: "2026-09-18T00:00:00Z" };

// ---- Structural: the v0 preimage cannot carry action or outcome ----
const keys = Object.keys(preimage(toV0Observation(base, null))).sort();
const forbidden = ["authorization", "authorized_action", "executed_action", "action", "args", "target", "outcome", "completion"];
chk("v0 preimage carries none of {authorization, action, args, target, outcome, completion}",
    forbidden.every((k) => !keys.includes(k)));
chk("v0 preimage is exactly {conduct, hop, observed_at, prev_evidence_id, task_id, witness_id}",
    JSON.stringify(keys) === JSON.stringify(["conduct", "hop", "observed_at", "prev_evidence_id", "task_id", "witness_id"]));

// ---- (a) authorized-action match is unrepresented ----
// Two scenarios the gateway/caller would treat as different: the executed target matches the
// authorization, or it was mutated. They differ ONLY in a field v0 does not model.
const scMatch   = { ...base, authorizedTarget: "/invoices/pay", executedTarget: "/invoices/pay" };
const scDiverge = { ...base, authorizedTarget: "/invoices/pay", executedTarget: "/attacker/acct" };
const oMatch = toV0Observation(scMatch, null);
const oDiverge = toV0Observation(scDiverge, null);
chk("action-match and action-diverge map to the SAME v0 evidence_id (v0 is blind to the executed target)",
    oMatch.evidence_id === oDiverge.evidence_id);
chk("both are R1+R2 valid, so the silence is not an invalidity",
    verifyObservation(oMatch).ok === true && verifyObservation(oDiverge).ok === true);

// ---- (b) post-response-loss outcome is unrepresented ----
// Two scenarios: the hop completed, or its response was lost and the true outcome is unknown.
const scCompleted = { ...base, completed: true };
const scLost      = { ...base, completed: false, responseLost: true };
chk("completed and response-lost map to the SAME v0 evidence_id (v0 is blind to outcome/completion)",
    toV0Observation(scCompleted, null).evidence_id === toV0Observation(scLost, null).evidence_id);

// ---- The set is nonetheless fully R1..R4 valid (the boundary is a silence, not a defect) ----
const h0 = toV0Observation({ ...base, hop: { seq: 0, from: "A", to: "B" }, witness: "W1" }, null);
const h1 = toV0Observation({ ...base, hop: { seq: 1, from: "B", to: "C" }, witness: "W2" }, h0.evidence_id);
const set = [h0, h1];
chk("R1 independence holds for both hops", verifyObservation(h0).ok && verifyObservation(h1).ok);
chk("R3 chain continuous", chainContinuous(set).ok === true);
chk("R4 aggregate is a clean verdict, not disagreement", aggregateVerdict([h0]) === "ok");

// Conclusion, by construction: a fully R1..R4-valid observation set is invariant to
// (a) whether the executed action matched the authorized one, and (b) whether the hop completed
// or its response was lost. v0 witnesses neither. Those are the action-binding and the
// outcome/reconciliation layers (VATE), not the third-party observation layer (this one).
chk("no em/en/bar dashes in any record produced here",
    !/[—–―]/.test(JSON.stringify(set) + JSON.stringify(oMatch) + JSON.stringify(oDiverge)));

console.log(fail ? ("\nFAIL " + fail) : "\nall boundary assertions hold (v0 is silent on action-match and outcome by construction)");
process.exit(fail ? 1 : 0);
