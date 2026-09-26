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

## Canonical form, pinned (the portable part of the verification contract)

Artifact identity is a SHA-256 over the UTF-8 bytes of canonical(preimage), where preimage is the record without
evidence_id, witness_sig and edge_sig. The record's schema name sits inside the hashed bytes. There is no domain
prefix in v0; the agreement and contract record families add one, this family commits its type through the schema
field instead. The canonical rule is the one the sieve and contract layers already prove byte-identical across
Python and Node. Its name is musubi-canonical-v0, its vectors are ../musubi-v0/canonical_vectors.json, and that name
is the value the execution layer writes into a VATE-shaped action_binding.canonicalization (one rule, one name):

- object keys sorted by code point at every level; keys are printable ASCII (U+0020..U+007E), so code point order
  and UTF-16 order agree in every runtime;
- separators "," and ":" with no whitespace;
- strings escape only '"', backslash and U+0000..U+001F (short forms for \b \f \n \r \t, the rest \u00xx
  lowercase); everything else raw, including non-ASCII, U+007F, U+2028 and U+2029;
- integers only, within plus or minus 2^53 - 1, no fraction, no exponent; a decimal is written as an integer at a
  stated scale;
- true, false, null, {} and [] as literals.

Refusals, before anything is hashed (strict_json.mjs, shared by bind.mjs and the ledger face):
duplicate_key (the same key twice in one object at any depth; neither first-wins nor last-wins is a result),
non_integer_number, unsafe_number, key_not_printable_ascii, bad_json. A record that fails one of these has no
evidence_id and is not stored. The rule only refuses; it never changes the bytes of a valid record, so every
published fixture keeps its evidence_id (bind_adversarial A5).

Bindings a record carries, as separate fields never derived from A2A task or context ids: task_id (the A2A Task
id the observation is about), hop {seq, from, to}, prev_evidence_id (the chain), and, on the execution side,
grant_ref (the authorization) and the digest of the action covered. Rules the verdict is computed under are
numbered (R1 to R4 here, E1 to E3 in task-execution-bind-v0) and named in every verification report together with
establishes, does_not_establish, the signer identities that resolved, and a recompute recipe. The report returns a
status, never a score; the admission decision stays with the recipient.
