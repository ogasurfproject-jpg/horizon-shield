# nenrin-provenance-verify-v0 (番人 draft, 2026-09-17)

One verifier over the whole provenance graph of one A2A task. It composes three layers that each stand on
their own, imports their pinned primitives unchanged, and adds only the cross-layer checks no single layer can
make. It opens no socket and has no clock; key resolution (resolve) and evidence confirmation (lookup) are
injected, exactly like the layers below it.

## What it composes
- task-delegation-bind-v0 (../task-delegation-bind-v0, pin 4d7c9c270c2846465fafdea9833869c5660c4ae2):
  third-party OBSERVATION of the delegation chain. R1 independence, R2 recompute, R3 continuity,
  R4 non-suppression; witness_sig and edge_sig.
- task-execution-bind-v0 (../task-execution-bind-v0): caller/gateway ACTION + OUTCOME binding.
  E1 authorized-action match, E2 outcome reconciliation, E3 grant binding; caller_sig and provider_sig.
- outcome_evidence (../task-execution-bind-v0/outcome_evidence.mjs): the outcome's commitment to an
  independently checkable pointer (bitcoin_tx, ledger_record, document_sha256, url_sha256).

## What only this layer checks
- task identity: every presented record carries the task_id under verification.
- digest-bound linkage: an observation whose conduct.detail_ref is nenrin-exec://<receipt_id> must name the
  RECONCILED receipt, and the digest must recompute. Linkage, not authority: the observation's verdict never
  inherits the receipt's outcome, and the receipt's outcome never inherits the verdict.
- R3 over a SET: chainContinuousSet generalizes the pinned chainContinuous to several witnesses per hop
  (every non-root prev_evidence_id must resolve to some presented prior-hop observation). With one witness per
  hop it is the pinned check; provenance_adversarial asserts the two agree on valid, forged and hidden-hop cases.

## Report
    { schema: "nenrin-provenance-verify-v0", verifier_version, task_id, verdict: accepted|refused,
      refusals: [{code, why, ...}], findings: [{code, why, ...}],
      layers: { identity, delegation, execution, evidence, linkage },
      establishes: [...], does_not_establish: [...], recompute: {...} }
Same shape as a2a-agreement-verify-v0. Fail-closed for readers: a refused report's establishes is exactly
["nothing: see refusals"]. Witness disagreement is a finding with hop verdict "disagreement", never collapsed to
the favorable verdict. Provider equivocation is a refusal: no single outcome can be established.

## Refusal codes
task_id_missing, task_id_mismatch, delegation_observation_invalid, delegation_chain_broken,
execution_incomplete_pair, execution_invalid, execution_signature_invalid, execution_equivocation,
execution_unreconciled, evidence_invalid, linkage_receipt_mismatch.

## Finding codes (declared, non-fatal)
no_delegation_observations, no_execution_records, witness_disagreement, self_authorized, open_grant,
evidence_bound_unchecked, no_evidence_bound, no_digest_link.

## The wall (written into every report)
No signature can cross it, and no report from this verifier claims to:
- that any executed action occurred in the world: E1 compares the provider's signed claim to the caller's
  signed authorization and has no side-effect oracle;
- that the reconciled outcome is the real-world outcome: E2 proves recoverability and surfaces
  equivocation, it does not prove truth;
- that any witness is unaffiliated with the parties: R1 proves structural distinctness, not independence;
- that bound evidence exists in its system or says what the provider claims, unless
  layers.evidence.checked_externally is true, and even then only what the injected lookup reported;
- anything about time beyond the record contents: no clock, no anchor seen here;
- that this is the only provenance these parties produced for this task_id.
The honest way to get closer to the wall is not to claim more, but to bind outcomes to pointers a reader can
check in a system that is already independently verifiable (outcome_evidence). That moves "the provider
claims X" to "the provider committed to E in S, go check S", without any trusted oracle.

## Run
    node provenance_adversarial.test.mjs
    node ../task-execution-bind-v0/bind_exec_adversarial.test.mjs
    node ../task-execution-bind-v0/sign_exec_adversarial.test.mjs
    node ../task-execution-bind-v0/compose.test.mjs
    node ../task-execution-bind-v0/outcome_evidence.test.mjs
    node ../task-execution-bind-v0/exec_cross_lang_test.mjs   (runs exec_witness_emit.py via python3)

## Honest scope
v0 is a draft, not outsider-validated. Signatures and digests prove who asserted and the linkage, not that any
assertion is true. The execution boundary already has an artifact of record (Poke-nushi's VATE, a2aproject/A2A
#1769); task-execution-bind-v0 is a minimal, swappable reference implementation so the composition seam can be
tested end to end, and this verifier is what tests it. Neither claims ownership of that boundary.
