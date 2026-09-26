# task-execution-bind-v0 (番人 draft, 2026-09-17)

Deterministically bind an AUTHORIZED action to its EXECUTION receipt at the caller/gateway execution
boundary, so a verifier can answer two questions the third-party observation layer (task-delegation-bind-v0)
is silent on by construction (see ../task-delegation-bind-v0/boundary_case.test.mjs):

- E1 authorized-action match: did the executed action equal the action the caller authorized?
- E2 outcome reconciliation: after a lost response, is the outcome recoverable, and is provider
  equivocation detectable rather than launderable into the favorable one?

plus E3 grant binding: the receipt commits to the grant by hash inside the provider's signed bytes.

## Position (not a land grab)
The action + outcome boundary already has an artifact of record: Poke-nushi's VATE in a2aproject/A2A#1769.
This module is a minimal, swappable REFERENCE implementation of the properties, so the composition seam
between the observation layer and an execution layer can be tested end to end. VATE remains the artifact of
record for this boundary; task-execution-bind-v0 does not claim ownership of it.

## Records
AuthorizationGrant (signed by the caller):
    { schema, task_id, action:{tool,target,args_sha256}, caller_id, provider_id, nonce,
      not_before, not_after, grant_ref, caller_sig }
- grant_ref = SHA-256(canonical(grant without grant_ref and caller_sig)). Anyone recomputes.
- provider_id names the executor the caller authorizes. null means an open grant (recorded as a finding).

ExecutionReceipt (signed by the provider named in the grant):
    { schema, task_id, grant_ref, executed_action:{tool,target,args_sha256}, outcome:{status,result_sha256},
      provider_id, executed_at, receipt_id, provider_sig }
- receipt_id = SHA-256(canonical(receipt without receipt_id and provider_sig)).
- grant_ref sits INSIDE the signed preimage, so the provider is bound to that specific grant.

canonical() and sha256hex() are imported from ../task-delegation-bind-v0/bind.mjs (canonical form pinned in its
SPEC.md: printable-ASCII keys sorted by code point, integers only, duplicate keys refused before hashing). The two layers share one
JCS, so a digest produced by either is recomputable by the other. That is what makes the digest-bound
carriage in compose.test.mjs verifiable across the seam.

## Invariants (the moat is the checks, not the binding)
- E1 action match: canonical(grant.action) must equal canonical(receipt.executed_action). A mutated target
  or args (the exact attack the observation layer cannot witness) yields action_diverged.
- E2 reconciliation: over the set of receipts for one grant_ref, one distinct receipt_id reconciles; more
  than one is equivocation, fail-closed, never the favorable one. A lost response is recovered by re-query.
- E3 grant binding: the receipt must hash-reference the grant (receipt_unbound otherwise), and it must come
  from the authorized executor (provider_not_authorized otherwise).
- Window: executed_at must fall in [not_before, not_after]. Timestamps must be strict RFC3339 UTC (a
  trailing Z, no offset, no date-only form), so a non-UTC offset cannot slip an execution past the window
  via Date.parse laxity; a malformed timestamp yields invalid_timestamp.
- Recompute: a tampered grant or receipt fails its own content hash.

## Out of scope for v0 (honest line)
- A signature proves WHO asserted, not that the assertion is TRUE. E1 establishes that the provider's CLAIMED
  action matches the authorization, not that the provider performed it in the world. There is no side-effect
  oracle in v0.
- E2 makes a lost outcome recoverable and equivocation detectable; it does NOT prevent equivocation and does
  NOT prove the reconciled outcome is the real-world outcome.
- nonce single-use is enforced by a stateful gateway at runtime; the pure verifier checks presence and
  window, not global uniqueness.
- an open grant (provider_id null) is accepted with an open_grant finding but is NOT reconcilable: name the
  executor to get attributable reconciliation (reconcileSigned returns no_authorized_provider otherwise).
- v0 is a draft, not outsider-validated. It aligns to a community convention if one emerges.

## Signature layer (sign_exec.mjs)
Two Ed25519 detached signatures (wire form: detached JWS, EdDSA; did:key resolves the key, no network):
- caller_sig: the caller signs canonical(grantPreimage). The authorization is attributable to the caller.
- provider_sig: the provider signs canonical(receiptPreimage), which includes grant_ref, so the receipt is
  bound to that grant and attributable to the provider.
reconcileSigned is scoped to the grant's authorized provider, which closes both griefing paths: a stranger
signing under its own id is not the authorized executor, and a stranger impersonating the executor's id fails
the signature check. Genuine equivocation (the authorized executor signing two conflicting outcomes) is
surfaced fail-closed.

## Outcome-evidence binding (outcome_evidence.mjs)
receipt.outcome.evidence = { kind, ref, system } names an independently checkable pointer (bitcoin_tx,
ledger_record, document_sha256, url_sha256). It sits inside the receipt preimage, so receipt_id and
provider_sig cover it. verifyEvidence checks shape, and an optional injected lookup(evidence) may confirm it;
the result always says whether a lookup ran (bound is never mistaken for confirmed).

## Cross-language determinism (exec_witness_emit.py + exec_cross_lang_test.mjs)
An independent Python canonical + sha256 builds a grant and receipt; the JS test recomputes both preimage
bytes and both ids and requires exact equality. The digest is not tied to this JS.

## Pre-execution authorization (preflight.mjs)
grant + intent, verified BEFORE execution. The provider signs, before running, what it is about to do
(proposed_action) referencing the grant by hash. verifyPreflight establishes that the declared action is inside
the caller's signed grant, from the authorized executor, in the window. It returns no allow or deny and no
score; the caller's gateway decides. intentMatchesReceipt gives declared == executed once the receipt exists.
Under a fixed-action grant that equality is implied when preflight and execution both pass, so the real value of
the intent is temporal: a signed pre-execution promise, checkable before the receipt exists.

## Interop: action_binding (VATE shape, optional, derived; 2026-09-26)
Poke-nushi's VATE (a2aproject/A2A#1769, admission-receipt and post-execution-receipt) binds a request by
    action_binding: { type, canonicalization, preimage_profile, digest: { alg, value } }
A grant, receipt or intent here MAY carry the same object over its action (grant.action, receipt.executed_action,
intent.proposed_action):
    { type: "canonical_request_digest", canonicalization: "musubi-canonical-v0",
      preimage_profile: "task-execution-bind-v0/action", digest: { alg: "sha-256", value: <64 hex> } }
value = SHA-256(canonical(action)), the same bytes E1 compares. A VATE recipient reads digest.value as its
effective_request_hash without reading this spec; it only needs the canonicalization name and its vectors
(../musubi-v0/canonical_vectors.json, reproduced byte for byte in Python and Node).

Rules:
- action_binding is DERIVED, like grant_ref and receipt_id: it sits outside every preimage and every signature
  (GRANT_DERIVED, RECEIPT_DERIVED, INTENT_DERIVED). Attaching it changes no id and no signature, so every published
  fixture keeps its grant_ref and receipt_id, and a record signed without it can carry it later.
- It adds no trust. The action it digests is already inside the signed bytes; the binding is a second spelling of
  the same fact for a reader with a different profile.
- Fail-closed when present (rule AB). A verifier that finds one recomputes it from the signed action and refuses
  the record on action_binding_mismatch (digest differs), action_binding_unknown_profile (a canonicalization or
  preimage_profile this verifier cannot recompute; accepting unchecked would let a claim ride on a verified record),
  or action_binding_malformed (wrong shape, wrong alg, null). Absent is not an error. The refusal names the record
  (grant, receipt or intent). Since the field is unsigned, a lying binding does not break provider_sig; the content
  verifier is what refuses it (sign_exec_adversarial shows both halves).
- The name is the one this repository already uses for its canonical bytes. One rule, one name; a second alias for
  the same bytes would only give a recipient two things to check against each other.

## Composition (linkage, not authority)
An observation may name an execution receipt by its content hash (detail_ref = nenrin-exec://<receipt_id>).
That is linkage: the observation's verdict stays the witness's own and never inherits the receipt's outcome,
and the receipt's outcome stays the provider's own and never inherits the verdict. compose.test.mjs shows a
witness "pass" and an execution "failed" coexisting, both valid, neither laundered into the other, and shows
that receipt tamper is caught by two independent detectors: the digest-bound link and the provider signature.
A composed verifier MUST also check that the observation, grant and receipt share one task_id (compose.test.mjs).
