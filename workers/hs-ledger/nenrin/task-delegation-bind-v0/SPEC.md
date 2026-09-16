# task-delegation-bind-v0 (番人 draft, 2026-09-16)

Deterministically bind an A2A Task id to NENRIN conduct evidence, so that trust becomes
"who did what on THIS delegated task, observed by whom" instead of "this agent failed once".

## Anchor
- A2A Task `id` (v1.0 literal; retrievable via tasks/get). HS holds no authority over it; it is asserted by the A2A layer.
- Evidence is a sibling NENRIN record keyed by task_id + hop, NOT embedded in any party-signed payload.
  Rationale = conferred, not acquired: the party under evaluation must not be able to mint its own verdict.
  Same shape as the AP2 fair-price attestation (content hash + public recompute + sibling carriage).

## Record (WitnessObservation)
    { task_id, hop:{seq,from,to}, prev_evidence_id, conduct:{verdict,detail_ref}, witness_id, observed_at, evidence_id }
- evidence_id = SHA-256(canonical(record without evidence_id)). Anyone recomputes; no trust in issuer.

## Invariants (the moat = the hard part, not the binding)
- R1 independence: witness_id must differ from hop.from and hop.to. A party cannot witness its own hop.
- R2 non-forgery: stored evidence_id must recompute. A swapped verdict changes the hash and fails.
- R3 chain continuity: hops are contiguous from seq 0 and each links the prior hop's evidence_id.
  A hidden or forged hop (A to C, hiding B) breaks continuity.
- R4 non-suppression: the aggregate over the full witness set for a {task_id, hop} is fail-closed;
  disagreeing verdicts yield "disagreement", never the favorable one. The read returns the full set.

## Out of scope for v0 (honest line)
- No DID/JWS party signatures yet (roadmap); v0 proves the deterministic content-addressed core only.
- No external standard exists yet for task-id to evidence binding (checked 2026-09-16), so v0 stays minimal and
  anchors only on the real A2A Task `id`; align to a community convention if one emerges.

## Signature layer (v0 + sig)
Two Ed25519 detached signatures (wire form: detached JWS, EdDSA; DIDs resolve to the key, did:key is self-contained):
- witness_sig: the witness signs canonical(preimage). The verdict becomes attributable and non-repudiable (R2 catches tamper, this catches spoofing of witness_id).
- edge_sig: the delegating party (hop.from) signs canonical({task_id, hop}). The edge A->B is party-attested, not just witness-claimed. This closes the self-asserted-chain hole at the party level.
Honest line: signatures prove WHO asserted, not that the assertion is TRUE. Attribution (sigs) + independence (R1) + non-suppression (R4) together = attributable, independent, non-suppressible observations. Signing does not change evidence_id (preimage excludes sigs).
