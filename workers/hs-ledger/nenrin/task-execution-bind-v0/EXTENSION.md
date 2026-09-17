# task-execution-bind-v0 : invariants and adversarial vector map

Companion to SPEC.md. Lists each invariant with the exact test vector that exercises it, so a reviewer can
target them. Same honest scope as task-delegation-bind-v0: signatures and digests prove WHO asserted and the
linkage, not that the assertion is true.

## E1 authorized-action match
- bind_exec_adversarial "E1a executed target divergence is caught (action_diverged)"
- bind_exec_adversarial "E1b executed args divergence is caught (action_diverged)"
Honest scope: establishes that the provider's signed executed_action matches the caller's signed authorization.
It does NOT establish that the provider performed the action. That is a side-effect claim, out of scope for v0.

## E2 outcome reconciliation
- bind_exec_adversarial "E2 lost-response re-query reconciles to a stable outcome"
- bind_exec_adversarial "E2 conflicting outcomes yield equivocation (fail-closed, not the favorable one)"
- sign_exec_adversarial "genuine equivocation by the authorized provider is surfaced (fail-closed)"
Honest scope: makes a lost outcome recoverable and equivocation detectable. It does NOT prevent equivocation
and does NOT prove the reconciled outcome is the real-world outcome.

## E3 grant binding and authorized executor
- bind_exec_adversarial "E3 receipt not hashing to the grant is rejected (receipt_unbound)"
- bind_exec_adversarial "receipt from an unauthorized executor is rejected (provider_not_authorized)"

## Griefing resistance (the reconciliation is only meaningful if it is attributable)
- sign_exec_adversarial "griefing A (stranger under own id) cannot manufacture equivocation"
- sign_exec_adversarial "griefing B (stranger impersonating provider id) cannot manufacture equivocation"
This is the seam most worth pushing on: equivocation is scoped to the grant's authorized provider and gated on
a valid provider signature, so a third party cannot manufacture a false equivocation to grief a provider.

## Timestamp strictness and open-grant reconciliation
- bind_exec_adversarial "non-UTC executed_at is rejected (invalid_timestamp)"
- sign_exec_adversarial "reconcileSigned with no authorized provider is explicit (no_authorized_provider)"

## Tamper and attribution
- bind_exec_adversarial "grant tamper is caught (grant_recompute_mismatch)"
- bind_exec_adversarial "receipt tamper is caught (receipt_recompute_mismatch)"
- sign_exec_adversarial "spoofed caller signature rejected (caller_sig_invalid)"
- sign_exec_adversarial "spoofed provider signature rejected (provider_sig_invalid)"
- sign_exec_adversarial "post-sign receipt tamper rejected (provider_sig_invalid)"

## Declared, non-fatal disclosures (recorded, not refused; mirrors conduct_self_measured in agreement-v0)
- self_authorized: caller_id equals the grant's provider_id.
- open_grant: the grant names no provider_id.

## Outcome-evidence binding
- outcome_evidence "mutated evidence pointer breaks receipt_id" and "... breaks provider_sig"
- outcome_evidence "lookup not found refuses", "lookup mismatch refuses", "lookup confirmed accepts",
  "a throwing lookup is treated as not confirmed, never as confirmed"

## Cross-language determinism
- exec_cross_lang "grant preimage bytes agree (python canonical == JS canonical)"
- exec_cross_lang "receipt_id recomputed in JS equals the python value"

## Composition with task-delegation-bind-v0 (linkage, not authority)
- compose "they disagree yet both are valid: neither layer laundered into the other"
- compose "receipt tamper breaks the digest-bound link the observation committed to"
- compose "receipt tamper also breaks the provider signature"
The observation layer answers "who did what on this hop, observed by whom, and where did observers disagree".
This layer answers "did the executed action match the authorization, and what was the reconciled outcome".
Neither subsumes the other; a digest-bound reference carries one into the other without conferring authority.
