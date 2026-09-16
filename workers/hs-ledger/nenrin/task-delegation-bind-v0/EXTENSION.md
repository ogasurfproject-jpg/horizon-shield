# NENRIN Task-Delegation Conduct Witnessing : an A2A adjacent verifier profile (draft v0)

Draft 2026-09-16. Aligned to A2A issue a2aproject/A2A#1769. This profile does not change A2A core.

## Where this sits
A2A issue #1769 ("where should verifier-side trust / permit / receipt artifacts for risky external actions live
relative to A2A") is converging on: A2A carries the invocation; a verifier layer carries the evidence, as compact
DIGEST-BOUND REFERENCES in A2A metadata (not full bodies); a reference is discovery-only and never implies
authority; digest equality proves LINKAGE, not authority; and none of this should change A2A core, it belongs in
an adjacent profile. This document is one such adjacent profile. It reuses that convention verbatim and adds the
one artifact class the issue's examples (permit / decision receipt / post-execution receipt, e.g. LemonCake x402,
QVAC) do not yet cover: an INDEPENDENT THIRD-PARTY CONDUCT OBSERVATION bound to a specific task and delegation hop,
with disagreement preserved rather than collapsed.

## What A2A already has, and the gap
- A2A has a Task with an `id`, `referenceTaskIds` to link a task to prior tasks, and authorization-fulfillment
  delegation (a task in `auth-required` can have its authorization fulfilled by another human/agent/service).
- A2A has NO standardized general A -> B -> C delegation-chain trust primitive, and no third-party conduct
  witnessing bound to a task. External Agent Manifest work says the same. That gap is what this profile fills.

## Carriage (A2A convention from #1769)
The witness evidence is NOT embedded in any party-signed payload (that would be conferred by the party under
evaluation = acquired, not third-party). It rides as a compact digest-bound reference in a sibling A2A Artifact
DataPart next to the mandate/task data, exactly as the AP2 fair-price attestation rides (validated 2026-09-16):
    { "kind": "data", "data": { "nenrin.conduct.observation_ref": { "task_id": "...", "hop_seq": 0, "evidence_id": "<sha256>", "resolve": "https://ledger.horizonshield.dev/witness/<sha256>" } } }
The receiver dereferences `resolve`, fetches the full WitnessObservation, and recomputes locally. The reference
carries linkage, never authority.

## WitnessObservation (the full body behind the digest)
    { task_id, hop:{seq,from,to}, prev_evidence_id, conduct:{verdict,detail_ref}, witness_id, observed_at,
      witness_sig, edge_sig, evidence_id }
- evidence_id = SHA-256 over the canonical preimage (record minus derived/envelope fields). Anyone recomputes.
- task_id references the A2A Task `id`; the chain of hops mirrors `referenceTaskIds` linkage across a delegation.

## Invariants (mapped to #1769 language)
- R1 independence: witness_id must differ from hop.from and hop.to. (This is the third-party requirement the
  permit/receipt examples lack; it is also #1769's "intermediate identity must not silently replace the requester",
  applied to the observer rather than the broker.)
- R2 non-forgery: stored evidence_id must recompute. (#1769: "digest equality proves linkage".)
- R3 chain continuity: hops contiguous from seq 0, each links the prior hop's evidence_id; a hidden or forged hop
  breaks continuity. (#1769: "post-execution evidence must link back to the same admitted action or be unrelated";
  the multi-hop `attenuation_chain` audit-trail concern.)
- R4 non-suppression: over the full witness set for a {task_id, hop}, differing verdicts aggregate to
  "disagreement", never the favorable one. (No #1769 example preserves observer disagreement; this is the wedge.)
- Signatures: witness_sig (Ed25519) makes the verdict attributable and non-repudiable; edge_sig (Ed25519 by
  hop.from) makes the delegation edge party-attested, so a broker cannot fabricate an edge. DIDs resolve to the key
  (did:key is self-contained), matching #1769's "public key endpoint for offline byte-match" (QVAC, LemonCake).
- Honest line (same as #1769): signatures and digests prove WHO asserted and LINKAGE, not that the assertion is
  TRUE. Attribution + independence + non-suppression together = attributable, independent, non-suppressible
  third-party observation. Currency, validity windows and revocation are separate, out of scope for v0.

## Reference implementation (already exists, adversarially tested)
- bind.mjs (canonical, evidence_id, R1..R4), sign.mjs (Ed25519 witness_sig / edge_sig), SPEC.md, INTEGRATION.md.
- bind_adversarial.test.mjs (12) + sign_adversarial.test.mjs (9) = 21 green: self-witness, bind-swap, hidden hop,
  forged link, spoofed witness, forged edge, cross-task replay, post-sign tamper are all rejected or detected.

## Status and honest scope
Draft. Reference implementation and adversarial tests exist and pass; this profile is NOT yet wired into the live
conduct witness / ledger / trust-signal, and is NOT yet published, so it is not yet outsider-verifiable. Publishing
this (and the reference impl) is step 1 of outsider-verifiability; live wiring per INTEGRATION.md is step 2; the
first real signed record is step 3. This profile requires no change to A2A core and is offered as an adjacent
verifier profile in the sense #1769 proposes.

## Aligns to
- A2A issue a2aproject/A2A#1769 (verifier-side trust artifacts relative to A2A)
- A2A Task `id`, `referenceTaskIds`, Artifact DataParts (life-of-a-task)
- Prior HORIZON SHIELD layers: conduct witness, NENRIN ledger, bilateral agreement, /trust-signal, JIDEC anchor
