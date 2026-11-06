# Anchored claim, v0

Status: v0, 2026-11-07. No new record format. An anchored claim is a fixed arrangement of records this repository already writes and reads: ledger entries with OpenTimestamps proofs, witness-answer-v0.1 (`tools/outward/`), witness-answer-v0 and furui-check-day-v0 (`workers/hs-ledger/nenrin/`).

A verifier's makers say how well it works: "it stops at most 10% of these attacks", "it wrongly stops at most 1% of ordinary requests". An anchored claim makes such a statement checkable after the fact by people who do not trust the makers:

1. **Write first.** The claim, the rule that will decide it, and the headline for each outcome are written down before anything is measured.
2. **Anchor.** The sha256 of those bytes goes into an append-only ledger, and the ledger entry is stamped to Bitcoin. Measuring starts only after the stamp is in a block.
3. **Measure.** The measurement runs. Its records are named by sha256.
4. **Record the result.** The result goes into a later entry of the same ledger. It cites the plan and carries every number the rule needs.
5. **Recomputed by outside keys.** Someone on another domain recomputes the digests and the Bitcoin anchors of (2) and (4) and signs what they recomputed with a key served from their own domain.

The claim cannot move after the measurement is seen: the rule is fixed in a block older than the result, the result entry comes later in the same chain, and a reader can recompute the decision from the two anchored files alone.

## 1. The records, exactly

| step | record | exact form | check |
|---|---|---|---|
| (1) plan | any UTF-8 file | must contain: what is measured and on which rows, the decision rule as a formula with its thresholds, and a headline written in advance for each outcome | a person reads it; (4) recomputes it |
| (2) anchor | ledger entry P | `claim_sha256` = sha256(plan bytes); OpenTimestamps proof of `claim_sha256` with a Bitcoin attestation at block Hp | sha256, jidec-chain-v1 from entry 1 (`survive-v0/verify_chain.py`), proof against the header of Hp (`outward_witness.py` `ots_step`) |
| (3) measurement | files named by sha256 in the result; when the verifier is the FURUI runner, its signed furui-check-day-v0 day records | as they are | the result names each by sha256; when rows are drawn, the draw uses the hash of block Hp or a later block |
| (4) result | ledger entry R in the same ledger, R > P | `claim_sha256` = sha256(result bytes); cites P by entry number or by P's `claim_sha256`; `created_at` after the timestamp in the header of Hp; anchored to Bitcoin like P | as (2), plus the order checks and the decision recomputed from the plan's rule and the result's numbers |
| (5) witness | witness-answer-v0.1, kind `outside-record`, `record_kind` `bytes`, one answer for P's bytes and one for R's | `record_sha256` = the entry's `claim_sha256`; `recomputed` includes `bytes_sha256` and `ots_anchor`; `anchor` = {Hp or Hr, block hash}; key served from the witness's own domain, which is not the claimant's | `outward_witness.py verify` (shape, key, key_id, signature), then the hash and anchor compared with (2) and (4) |

Measurement records may be witnessed on their own: a FURUI day record is witnessed with witness-answer-v0 kind `furui-day` (`workers/hs-ledger/nenrin/witness-answer-v0/PROCEDURE.md`), and the signed answer is then anchored in a witness batch (example: entry 256 below).

## 2. Verdicts

A checker runs (2), (4), the order checks, the decision and (5) and answers one of:

- `anchored_claim_ok`: every check holds and both the plan and the result carry a signed witness answer that matches.
- `anchored_unwitnessed`: every check holds, but (5) is missing for the plan or the result.
- `not_yet`: a proof has no Bitcoin attestation yet, or the header it needs is not at hand. Not a failure; do not start measuring while the plan is in this state.
- `refused`, with every reason found: `plan_bytes_not_anchored_bytes`, `result_bytes_not_anchored_bytes`, `plan_not_in_chain`, `plan_anchor_fails`, `result_entry_not_after_plan_entry`, `result_created_not_after_plan_block`, `result_does_not_cite_plan`, `decision_not_recomputed`, `witness_signature_fails_<plan|result>`, `witness_signed_other_hash_<plan|result>`, `witness_anchor_differs_<plan|result>`.

## 3. Worked examples from the ledger

**blind-06 of FURUI (entries 231 and 232).** The plan (`data/furui-blind-06/BLIND06_PLAN.md`, entry 231, sha256 `a49269c9...`) names version A7.4, six lines with their thresholds and bound methods (one-sided 95% Clopper-Pearson; a normal bound for L4), the salt commitment, the draw rule (the hash of the block that confirms the plan), and the headline for each outcome. Its proof reaches block 974072. The draw used that block's hash (`block_height.txt`, `block_hash.txt`) and the committed salt. The result (entry 232, sha256 `7cc39be8...`) cites entry 231, was made at 12:40 UTC on 2026-11-01, after block 974072 (header time 03:32 UTC), and its proof reaches block 974128. From the counts in the result, under the plan's rule, every bound is recomputed to the printed digit and every "Pass if" count of the plan (18 of 270, 12 of 1,963, 38 of 1,000, 102 of 3,000, 2,437 of 3,000) follows from its threshold. The headline the plan wrote for "all six lines hold" is the result's headline, word for word. Vectors AC01 to AC06.

**Entry 256: an outside key over a measurement record.** pipavlo82 recomputed the FURUI day record of 2026-11-03 (furui-check-day-v0, sha256 `280f70f3...`, listed in entry 250) and signed a witness-answer-v0 with the key `pipavlo82.github.io` serves. The signed answer travels inside a commitment record (sha256 `afe669a3...`), itself signed with the same key, and the ledger's witness batch of 2026-11-06 (entry 256) lists it, stamped to block 974743. Vector AC07.

**Entry 261: the other direction.** horizonshield.dev recomputed invinoveritas.dev's slot log of 2026-11-03 (their record, anchored by their own OpenTimestamps proof in block 974459) and signed a witness-answer-v0.1 `outside-record`. The signed answer is entry 261, byte for byte. Its own proof was pending when it was copied here. Vector AC08.

**Earlier blind tests.** blind-01 to blind-05 followed steps (1) to (4) in the same ledger (for example blind-04: draw plan 194, drawn set 195, measurement pin 196, score 202; blind-05: plan 224, result 225). Checks by outside people of blind-04 are recorded as entries 212, 221 and 223, written by the operator from what they reported, not as answers signed with their keys. They are not in the vectors.

**A plan fixed only by a git commit** shows when a hosting service saw it, not when it existed by a clock nobody controls. It meets (1) and not (2).

## 4. Vectors

`vectors/vectors.json` lists 15: 8 to accept, 7 to refuse. Each has its inputs and output with sha256 and the expectation. The ledger entries and Bitcoin headers they read are a set pinned in `vectors/inputs/kept_1f9243f5/` as committed at 1f9243f5 (headers of the night of 2026-11-06, blocks 974072 and 974128 only), so a header outside that set, such as block 974743 of entry 256, is `not_offline` in AC07 even after a later night adds it.

| id | kind | what | answer |
|---|---|---|---|
| AC01 | accept | entry 231: bytes, chain from entry 1, proof against the pinned header of 974072 | ok |
| AC02 | accept | entry 232: the same, block 974128 | ok |
| AC03 | accept | order: 232 after 231, made after block 974072, cites entry 231; the draw block is the plan's block; the salt matches its commitment | all true |
| AC04 | accept | decision: six bounds recomputed from the result's counts under the plan's rule; the headline written in advance | all six hold |
| AC05 | accept | witness-answer-v0.1 over 231 and 232 (test key) | verify, hashes and anchors match |
| AC06 | accept | blind-06 as one anchored claim | `anchored_claim_ok` |
| AC07 | accept | entry 256: pipavlo82's signed answer and record, listed once in the batch | signatures verify; anchor `not_offline` |
| AC08 | accept | entry 261: horizonshield.dev's signed answer over invinoveritas.dev's record | verifies; own anchor pending at copy |
| AC11 | refuse | the plan with one threshold changed after anchoring (18 to 19 of 270) | `plan_bytes_not_anchored_bytes`; the proof stamps the original |
| AC12 | refuse | the order reversed: 232 named as plan, 231 as result | three order reasons |
| AC13 | refuse | a validly signed witness answer over other bytes | `witness_signed_other_hash_plan` |
| AC14 | refuse | that answer with its hash set to the right one after signing | `witness_signature_fails_plan` |
| AC15 | refuse | a witness key on the claimant's own domain | refused at the shape step |
| AC16 | refuse | a plan proof with no Bitcoin attestation yet (entry 250 as kept) | `not_yet` |
| AC17 | refuse | the proof of 231 against the header of block 974128 | merkle root differs |

The witness answers are signed with the public test key of RFC 8032 section 7.1 TEST 1, as in `witness-answer-v0/vectors.json`. They show the mechanics over these exact bytes. No outside key has signed answers over entries 231 and 232 yet; until one does, blind-06 is `anchored_unwitnessed` in fact, and AC06 is `anchored_claim_ok` only with the test key.

## 5. Run it

    cd docs/anchored-claim
    python3 -I -B gen_vectors.py --check     # rebuilds every vector and compares byte for byte; exit 0 when all agree

Python 3.9 or later; `cryptography` for the TRACE port used by `trace-blind/`. The script closes outbound sockets before it starts. `python3 -I -B gen_vectors.py` writes the vectors again.

## 6. Apply it to your own verifier

You need an append-only log whose entries carry a sha256 and an OpenTimestamps proof, a domain you control, and the two files in `tools/outward/`.

1. Write `plan.md`: what the verifier will be measured on, how rows are chosen (a salt committed by its sha256 and a block hash to come is enough), the decision rule with thresholds and bound method, and one headline per outcome.
2. Append `sha256(plan.md)` to your log and stamp it: `ots stamp plan.md`. Wait until `ots upgrade plan.md.ots` reports a Bitcoin attestation, and note the block height Hp.
3. Measure. If rows are drawn, draw them with the hash of block Hp. Keep every measurement file and note its sha256.
4. Write `result.md`: cite the plan's log entry and sha256, give every number the rule needs and the headline the plan chose. Append it to the same log and stamp it.
5. Ask someone on another domain to witness both files:

        python3 -I -B outward_witness.py fetch bytes --url <plan URL> --ots-url <plan .ots URL> --subject <your domain> --out facts.json
        python3 -I -B outward_witness.py build facts.json --key <their key.pem> --out answer_plan.json
        python3 -I -B outward_witness.py verify answer_plan.json --fetch

   and the same for `result.md`. `outward_witness.py` refuses a subject in its `OPERATOR_SUFFIXES`, which lists the domains of whoever runs it; a witness puts their own domains there. `gen_vectors.py` does the same in its process (`as_witness`).
6. Publish the two files, their proofs, the measurement files and the signed answers. Anyone can then run the checks of section 2 on them; `gen_vectors.py` shows each check as a call into the existing code.

## 7. What a passing check does not establish

That the claim is true of anything but the measured rows; that the rows were representative; that the plan was the only plan written (an operator can anchor several and publish one; listing every plan entry in the ledger is how to look for that); that the measurement code did what the plan says (the measurement files and a recount do that); that the Bitcoin headers kept in this repository are those of the chain your own node holds; that a witness ran the steps it lists. A signature shows who asserted, not that the assertion is right.

## 8. Files

| file | what |
|---|---|
| `SPEC.md` | this page |
| `gen_vectors.py` | builds `vectors/` and `trace-blind/vectors/`; with `--check`, compares byte for byte and holds every answer to its expectation |
| `vectors/vectors.json` | every vector: inputs and output with sha256, expectation, the four inputs copied from the ledger's public answers and the pinned inputs |
| `vectors/inputs/` | the copied ledger answers (entries 256 and 261, the pending proof of entry 250), the pinned entries 231, 232, 250 and 256 with two Bitcoin headers (`kept_1f9243f5/`), the witness answers, the edited plan |
| `vectors/outputs/` | the answer of each vector |
| `trace-blind/` | an illustrative anchored claim whose measurement includes TRACE records |
