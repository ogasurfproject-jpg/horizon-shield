// nenrin-consume-v0 : the read surface a TRUST ENGINE uses to consume NENRIN evidence.
//
// This is the composition seam the competitive picture points at: NENRIN is a neutral EVIDENCE source, and a
// reputation or policy engine (a TrustChain-style trust graph, a PHION-style risk gateway, a SINT-style policy
// gateway, or a caller's own gateway) is the DECISION maker. This surface lets such an engine read one task's
// verified evidence in a single call, in a compact and stable shape, and re-verify all of it itself.
//
// It runs the full provenance verification and PROJECTS it. It computes NO trust score and makes NO allow or
// deny decision. It returns verified FACTS, the CONFLICTS surfaced (disagreement and equivocation, never
// collapsed to the favorable value), the honest LIMITS carried through unchanged, content ANCHORS the engine
// can key on, and the steps to recompute everything offline without trusting this operator.
import { verifyProvenance } from "./provenance_verify.mjs";

export const CONSUME_VERSION = "0.1.0";

export function consumeEvidence(input) {
  const p = verifyProvenance(input);
  const L = p.layers;
  const exec = L.execution && L.execution.present && L.execution.complete ? L.execution : null;
  const pre = L.preflight && L.preflight.present && L.preflight.complete ? L.preflight : null;

  // verified FACTS. Each is a fact or null (not asserted), never a score.
  const facts = {
    verified: p.verdict === "accepted",
    authorized_before_execution: pre ? true : null,
    executed_matches_authorization: exec ? exec.pair === "action_bound" : null,
    outcome: exec && exec.outcome ? { status: exec.outcome.status, reconciled: exec.reconciliation === "reconciled" } : null,
    hops: L.delegation && L.delegation.present ? L.delegation.hop_verdicts.map((h) => ({ seq: h.seq, verdict: h.verdict, disagreement: h.verdict === "disagreement" })) : [],
    evidence_pointer: L.evidence && L.evidence.bound ? { bound: true, checked_externally: L.evidence.checked_externally } : { bound: false, checked_externally: false },
    digest_links: L.linkage ? L.linkage.links : 0,
  };

  // CONFLICTS are surfaced, never hidden and never collapsed into a favorable value.
  const conflicts = {
    refused: p.verdict === "refused",
    refusal_codes: p.refusals.map((r) => r.code),
    disagreements: p.findings.filter((f) => f.code === "witness_disagreement").map((f) => ({ seq: f.seq, witnesses: f.witnesses })),
    equivocations: p.refusals.filter((f) => f.code === "execution_equivocation").map((f) => ({ receipt_ids: f.receipt_ids })),
  };

  // content ANCHORS the engine can store and reference, all recomputable from the records.
  const anchors = {
    grant_ref: input && input.grant ? input.grant.grant_ref : null,
    intent_id: input && input.intent ? input.intent.intent_id : null,
    reconciled_receipt_id: exec && exec.receipt_id ? exec.receipt_id : null,
    observation_evidence_ids: (input && Array.isArray(input.observations) ? input.observations : []).map((o) => o && o.evidence_id),
  };

  return {
    schema: "nenrin-consume-v0", consume_version: CONSUME_VERSION, task_id: p.task_id,
    facts, conflicts, anchors,
    does_not_establish: p.does_not_establish,
    contract: "NENRIN returns verified evidence and its honest limits. It computes no trust score and makes no allow or deny decision. The consuming engine reads facts and conflicts and decides for itself. Absence of conflict is not evidence of good conduct; it may mean no evidence was presented.",
    reverify: {
      how: "re-run nenrin-provenance-verify-v0 on the same records with your own resolve and lookup; every hash and signature recomputes offline, with no clock and no network",
      provenance: p.recompute,
    },
    provenance: p,
  };
}

// a minimal posture line for engines that want counts to feed their own model. Counts only. Never a score,
// never a verdict, never a recommendation. A disagreement or equivocation count is surfaced, not smoothed away.
export function postureLine(consumed) {
  const f = consumed.facts, c = consumed.conflicts;
  return {
    task_id: consumed.task_id,
    verified: f.verified,
    hops: f.hops.length,
    disagreement_hops: f.hops.filter((h) => h.disagreement).length,
    equivocations: c.equivocations.length,
    outcome_status: f.outcome ? f.outcome.status : null,
    evidence_checked_externally: f.evidence_pointer.checked_externally,
    note: "counts only; not a score, not a verdict, not a recommendation",
  };
}
