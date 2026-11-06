# trace-blind: a TRACE record inside the measurement of an anchored claim (illustrative)

Status: illustrative, 2026-11-07. Nothing here is on a ledger or stamped to Bitcoin. The plan and the result are made by `../gen_vectors.py`, the rows are invented, and four of the six TRACE records are signed with a test key. Two TRACE records are real: the summit demo record from agentrust-io/trace-registry and a bernstein record, both already in `workers/hs-ledger/nenrin/trace-bind-v0/sources/`. The point is the shape, not the numbers.

A TRACE v0.2 record says where a verifier ran: the runtime and its measurement, the build, the appraisal of the environment, and a hash of the tool transcript, signed by the producer's key. An anchored claim (`../SPEC.md`) says that the verifier's accuracy claim was fixed before it was measured and recomputed by outside keys. Put together, the accuracy claim is about a verifier that ran in a named environment, and a row only counts when its receipt says so.

## The rule the plan fixes

The plan (`vectors/inputs/plan.md`) pins, before anything is measured:

- the producer key thumbprints whose TRACE records are accepted;
- the runtime platform and measurement (here the real values from the summit demo record: `azure-cvm-sev-snp`, `sha384:5b0ce64a...`);
- the verifier build digest and the appraisal status (`affirming`);
- a time window: from the plan's anchor to the result;
- the binding of each receipt to its row: `tool_transcript.hash` = sha256 of `{"answer", "input_sha256", "row"}` (keys sorted, no spaces);
- the line: at least 2 of 6 rows correct.

A row counts as correct only when its receipt verifies (`nenrin_verify.trace.check_trace_record`, the Python port of `sdk/trace_verify.mjs`), matches every pin, falls inside the window and binds that row and that answer. Every other row counts as not correct, whatever the verifier answered.

In a real run, steps (2), (4) and (5) of the SPEC apply unchanged: the plan is anchored and confirmed in a block before the first receipt is issued, so a receipt with `iat` before that block cannot be counted; the result is a later entry; outside keys witness both.

## Vectors

`vectors/vectors.json`: 9 vectors, 2 to accept and 7 to refuse.

| id | kind | row | answer |
|---|---|---|---|
| TB01 | accept | r1: a receipt that verifies and matches every pin | counted correct |
| TB02 | refuse | r4: the real summit demo record (TEE runtime, affirming); signature valid | `producer_not_pinned`, `build_not_pinned`, `receipt_outside_window`, `transcript_mismatch` |
| TB03 | refuse | r5: the real bernstein record (software-only runtime, zero measurement) | `runtime_not_pinned` among six reasons |
| TB04 | refuse | r6: transcript hash changed after signing | `signature_invalid` |
| TB05 | refuse | a signed receipt whose transcript names another answer | `transcript_mismatch` |
| TB06 | refuse | a signed receipt with appraisal `none` | `appraisal_not_affirming` |
| TB07 | refuse | a signed receipt for another build | `build_not_pinned` |
| TB08 | accept | the decision over r1 to r6, and the result citing the plan's sha256 | 2 of 6 correct with a valid receipt; the line holds |
| TB09 | refuse | a result that counts answers and leaves the receipts out | states 5 of 6, the recount gives 2 of 6 |

TB02 is the case the arrangement is for: a genuine, validly signed TEE record that was issued before the plan existed and binds no row of this measurement is not evidence for this claim.

Run them with the anchored-claim vectors:

    cd docs/anchored-claim
    python3 -I -B gen_vectors.py --check

## What is illustrative, and what is not shown

- The plan, the rows, the answers and the result are invented. The plan's anchor time (2026-11-06T00:00:00Z) is stated, not anchored.
- Four receipts are signed with a test key derived from the public phrase `anchored-claim trace-blind test producer`. They stand for no producer. The runtime measurement they carry is copied from the summit demo record; no TEE produced them.
- No appraisal is checked here. TRACE records carry the appraisal's status; whether the environment's attestation evidence is genuine is the appraiser's work and the relying party's trust in it (vendor-rooted attestation).
- The two real records are checked for signature, profile and fields only. Whether their producers' keys are the ones agentrust-io/trace-registry lists is shown in the trace-chain vectors (`docs/trace-chain/`, TC01), not here.
- No witness answers are made for this illustration; step (5) is shown on real ledger entries in `../vectors/`.
