// candidate_evidence.mjs : NENRIN-side interop for reputation-aware agent discovery (a2aproject/A2A#1631) and an
// ordering primitive such as ziolndr's ARBITER. Given a task and several candidate agents, each with its own
// provenance records, it produces a per-candidate verified evidence bundle (nenrin-consume-v0) and assembles a
// run-record skeleton.
//
// It decides NOTHING. It does not choose which candidates are permitted, it does not order them, and it computes
// no trust score. The trust filter decides "permitted"; the orderer (ARBITER) decides the order; NENRIN supplies
// the verifiable material and an anchorable run record so a third party can recompute the permitted set and the
// order rather than trust the operator. permitted and order are left null on purpose.
import { consumeEvidence, postureLine } from "./consume.mjs";

export const CANDIDATE_EVIDENCE_VERSION = "0.1.0";

export function candidateEvidenceSet(task_id, candidates) {
  const evaluated = candidates.map((c) => {
    const bundle = consumeEvidence(Object.assign({}, c.records, { task_id }));
    return { candidate_id: c.candidate_id, bundle, posture: postureLine(bundle) };
  });
  return {
    schema: "nenrin-candidate-evidence-v0",
    version: CANDIDATE_EVIDENCE_VERSION,
    task_id,
    candidates: evaluated.map((e) => ({
      candidate_id: e.candidate_id,
      verified: e.bundle.facts.verified,
      disagreement_hops: e.posture.disagreement_hops,
      equivocations: e.posture.equivocations,
      outcome_status: e.posture.outcome_status,
      evidence_checked_externally: e.posture.evidence_checked_externally,
      anchors: e.bundle.anchors,
    })),
    contract: "NENRIN supplies verified per-candidate evidence and surfaced conflicts. It does not decide which candidates are permitted, it does not order them, and it computes no trust score. The trust filter decides permitted; the ordering primitive (for example ARBITER) decides order.",
    run_record: {
      task_id,
      evaluated_candidates: evaluated.map((e) => e.candidate_id),
      permitted: null,
      order: null,
      evidence_anchors: evaluated.map((e) => ({ candidate_id: e.candidate_id, anchors: e.bundle.anchors })),
      note: "permitted is filled by the trust filter and order by the orderer; NENRIN records them and can anchor this run_record to Bitcoin so a third party recomputes the permitted set and the returned order rather than trusting the operator",
    },
    does_not_establish: [
      "which candidates are permitted: that is the trust filter's decision, from this evidence and its own policy",
      "the order of the candidates: that is the orderer's output, for example ARBITER, over the permitted set",
      "any trust score: none is computed here, and absence of conflict is not evidence of good conduct",
    ],
    bundles: evaluated.map((e) => e.bundle),
  };
}
