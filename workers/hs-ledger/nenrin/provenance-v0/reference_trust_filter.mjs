// reference_trust_filter.mjs : a REFERENCE (example) trust filter for the a2aproject/A2A#1631 discovery interop
// with ziolndr's ARBITER. IT IS NOT PART OF NENRIN. NENRIN supplies evidence and computes no permitted set and no
// score. This is one explicit, minimal policy a trust engine MIGHT apply to a NENRIN candidateEvidenceSet to
// produce the finite permitted field an orderer (ARBITER) then ranks. It is stated in full so a third party can
// recompute permitted from the evidence rather than trust the operator; a real engine uses its own policy.
//
// Policy, fail-closed:
//   permitted = candidates with verified === true AND equivocations === 0
//   excluded  = everything else, each with its reason
// Deliberate boundary: a witness DISAGREEMENT does not remove a candidate. The unresolved conflict is carried
// INTO permitted (disagreement_hops stays > 0 on that candidate) so the orderer weighs it rather than having it
// normalized away before ordering. A provider EQUIVOCATION is fail-closed and excluded.
export const REFERENCE_TRUST_FILTER_VERSION = "0.1.0";

export function referenceTrustFilter(set) {
  const permitted = [], excluded = [];
  for (const c of set.candidates) {
    if (c.verified === true && c.equivocations === 0) permitted.push(c.candidate_id);
    else excluded.push({ candidate_id: c.candidate_id, reason: c.verified !== true ? "not verified" : "provider equivocation, fail-closed", disagreement_hops: c.disagreement_hops, equivocations: c.equivocations });
  }
  return {
    schema: "reference-trust-filter-v0",
    version: REFERENCE_TRUST_FILTER_VERSION,
    not_nenrin: "This filter is not part of NENRIN. NENRIN supplies evidence and computes no permitted set and no score. This is one example policy, stated in full so permitted can be recomputed from the evidence.",
    policy: "permitted = verified === true AND equivocations === 0; a witness disagreement is carried into permitted (not removed) so the orderer weighs it; a provider equivocation is fail-closed and excluded",
    permitted,
    excluded,
  };
}
