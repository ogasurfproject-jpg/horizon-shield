# MUSUBI (a2a-contract-v0)

A contract layer for agents that act on each other's behalf. Prove and price, do not enforce at runtime. HORIZON SHIELD anchors the record. It does not judge it. The settlement verdict is a function you recompute, not a decree you trust.

## Walk it yourself (no account, no key of ours, no network)

    git clone https://github.com/ogasurfproject-jpg/horizon-shield
    cd horizon-shield/workers/hs-ledger/nenrin/musubi-v0
    python3 -m venv .venv && . .venv/bin/activate
    pip install cryptography
    python3 contract_v0.py --selftest        # expect: SELF-TEST PASSED, 6 of 6

`cryptography` is the only thing you install. If you prefer not to use a venv and pip refuses with "externally managed environment", `pip install --break-system-packages cryptography` does the same.

The verifier is offline by design. There is no endpoint to trust. You run the same code the operator runs and you reach the same verdict, or you have found a bug. This is a library and a CLI, not a hosted service; nothing needs to be deployed for you to check it.

## The CLI

    python3 contract_v0.py --selftest                     # 6 of 6 self checks
    python3 contract_v0.py --verify contract.json         # verify a signed contract
    python3 contract_v0.py --sign  contract_unsigned.json --key mykey.json --domain my.domain --out contract_A.json
    python3 contract_v0.py --settle contract.json --exec execution.json   # recompute the settlement verdict

## What each self check proves
1. build + two party sign + verify: a well formed contract with two valid signatures is accepted.
2. tamper after signing: one byte changed after signing is refused.
3. overclaim in establishes: a contract that claims performance or payment or legal effect in its own terms is refused.
4. settle, compliant execution: work inside the grant settles as within_grant.
5. settle, prohibited action: an action outside the grant settles as a deviation, named.
6. delegation subset: a sub grant that widens authority beyond its parent is rejected.

## Break it
Find a contract that verifies but should not, or a settlement that recomputes to the wrong verdict. Send the input that does it. A finding is worth more than a pass.

## Finding 7, and settle v1 (2026-09-24)
A red-team question on Bluesky (@quaxworld.art) asked what defines the authoritative event set when action and revocation receipts reach replicas in opposite orders, and whether that choice can be recomputed too. Taking it seriously exposed a real defect in `contract_v0.settle()`: it used the list order of execution records as time order. The same two records, swapped, flip the verdict when an approval and the conditional action it covers sit in different records. List order is arrival order. That is the bug the question described.

`settle_v1.py` replaces the rule. `contract_v0.py` is untouched (published, referenced).

    python3 settle_v1.py --selftest        # expect: SELF-TEST PASSED, 11 checks
    python3 settle_v1.py --settle contract.json --event e1.json --event rev.json --event e2.json   # any order

- The authoritative event set is every record bound to the contract, ordered by (anchor height, sha256 of the record bytes). Height recomputes from the chain, the sha from the bytes, arrival order plays no part. Check 1 shuffles the same records 50 times and asserts identical settlement bytes.
- When a revocation takes effect is a term of the signed grant, `grant.revocation.effective_at`: `anchor` or `delivery_ack`. A wall-clock rule is refused as not recomputable (check 8).
- Two records at the same height are a real ambiguity. They are broken by bytes only if the grant opts in with `grant.ordering.same_height: "record_sha256"`. Otherwise a tie that would change the outcome makes the verdict `underspecified`, and no guess leaks into the deviations list (checks 4, 5, 11).
- The same receipt delivered twice is one record (check 10). A revocation is terminal; re-granting is a new contract.
- What it does not establish is written into every settlement: that a claimed anchor height is true (recompute it against the chain), that the records are authentic (verify them first), that HS judged anything.

Check 7 reproduces the v0 defect and shows v1 settling identically in both orders. Break v1 next.

## Design
`ops/MUSUBI_a2a_contract_v0_DESIGN.md` in this repo.

The crypto primitives (canonical form, Ed25519 discipline, small order key rejection, the overclaim list) are shared verbatim with the agreement layer in `../agreement-v0/agreement_verify.py`. One source of truth. MUSUBI reuses them, it does not fork them, so the folder above must sit next to this one. That is why you clone the repo rather than download this file alone.

## Finding 8, and settle v1.1 (2026-09-24)
The same red team came back: let two replicas accept different anchor histories before finality, then reorg one after settlement. If authority is (height, sha), can both emit valid but incompatible receipts, and what proves convergence? For v1 the answer was yes. Working it through exposed two more holes of the same family, closed before anyone had to ask: v1 trusted whatever chain view it was handed, and it trusted the height a record claimed, so an approval could be backdated below the action it covers.

`settle_v1_1.py` adds this on top of v1 (v1 and v0 untouched).

    python3 settle_v1_1.py --selftest       # expect: SELF-TEST PASSED, 11 checks
    python3 settle_v1_1.py --settle contract.json --event e1.json --event e2.json --view a.json --view b.json
    python3 settle_v1_1.py --settle contract.json --check settlement.json --view later.json

- The chain view is raw 80 byte Bitcoin headers, verified, not trusted: prev hash linkage, double SHA256 proof of work against each header's nBits, a difficulty floor named in the signed grant (`grant.finality.max_target_bits`), and the contract's own checkpoint (`lower_bound`) must be in the view. Check 1 verifies the real mainnet genesis header; check 6 rejects four kinds of fabricated view.
- Fork choice is cumulative work computed from those headers. Equal work picks nothing (check 10).
- Every anchor carries a proof (append, prepend, sha256 operations, the OpenTimestamps model) from the record's commitment to the merkle root in the header at the claimed height. A record re-labelled to an older block without a proof into it is refused (check 7).
- The grant names `grant.finality.depth`. Above the horizon a settlement is `provisional`, bond `pending_finality`. Two forks can disagree, and both say provisional (check 2). After the reorg the recompute is final and the losing receipt is `superseded`, kept and never deleted (check 3). Replicas on the same verified view recompute identical bytes in any order (check 4). A heavier reorg deeper than the depth is exposed, not denied (check 5).
- A revocation counts only from the principal (check 9).
- Stated limits, also written into every settlement: linkage, work, floor and checkpoint are verified, not the full consensus rules; heaviest means heaviest among the views compared; record signatures are verified by the record verifiers, this function orders and compares.

## settle v1.2: authenticated settlement (2026-09-24)
Found by working past finding 8 before anyone asked. v1.1 still believed what a record said about who wrote it, and anchoring is permissionless. So a third party could anchor a revocation that merely says "principal" and turn an honest contractor's later work into deviations (a frame); a contractor could write an approval it never received into its own record (a hidden deviation); anyone could put acts in the contractor's name. And `contract.expiry` was a wall-clock date no settlement read.

`settle_v1_2.py` closes these on top of v1.1 (v1.1, v1, v0 untouched).

    python3 settle_v1_2.py --selftest       # expect: SELF-TEST PASSED, 13 checks

- The contract must verify (both parties signed, keys pinned in the signed bytes). Every key used comes from that contract, never from a record.
- Every record is signed before anchoring by the party its schema requires: execution by the contractor or a witness named in the signed grant (`grant.witnesses`), revocation by the principal, acknowledgement by the contractor. Others are rejected by sha (checks 2, 7, 8, 9).
- An approval counts only with the principal's signature over (contract_id, payload_digest, action). A self-written approval is a deviation, `forged_approval` (checks 4, 6).
- Expiry is `grant.expiry_height`; work anchored above it is `after_expiry` (check 11).
- Stated limits: a stolen key signs validly; an approval covers its action for the life of the contract; absence of signed evidence is not evidence of compliance.

## settle v1.3: authority under failure (2026-09-24)
A red-team reply on Bluesky (@tallybexro): can an agent exceed its delegated scope when a tool errors, a message is duplicated, or one side lies about settlement? A contract that only recomputes a clean verdict proves arithmetic, not delegation. Two of the three were open, and the third was half open: the test written for it found that one signed message anchored twice carried two different proofs, so its bytes differed and it counted twice.

`settle_v1_3.py` closes them on top of v1.2 (all earlier layers untouched).

    python3 settle_v1_3.py --selftest       # expect: SELF-TEST PASSED, 9 checks
    python3 settle_v1_3.py --settle contract.json --event ... --view headers.json --claim published_settlement.json

- One message, one record: copies of one signed body collapse to the earliest anchor that verifies, and the collapse is listed. A genuine retry is a new signed body and counts again (check 6).
- Every attempt goes in `performed_actions`; outcomes (`ok`, `error`, `timeout`, `partial`) go in `outcomes`. An outcome never excuses scope: a prohibited call that errored is still a deviation, and so is the fallback an agent reaches for after an error (checks 1, 2).
- A contractor-signed record that hides an attempt outside the schema is a deviation, `nonconforming_record`; a witness cannot charge the contractor that way (checks 3, 4, 5).
- `--claim` recomputes a published settlement and names every misreported field. A signed claim that differs is evidence against its signer, including a claim computed after quietly dropping a record (checks 7, 8).

## correction v0: a recomputation with provenance (2026-09-24)
Next reply from the same red team (@tallybexro): a recomputation is a correction only if it preserves the original inputs, names the changed field, and shows why the old result was wrong; otherwise it is a second opinion with no provenance. `verify_claim` in v1.3 only named the changed fields. That was an opinion.

`correction_v0.py` makes the correction a record of its own (schema `a2a-correction-v0`).

    python3 correction_v0.py --selftest     # expect: SELF-TEST PASSED, 7 checks
    python3 correction_v0.py --settle contract.json --event ... --view headers.json --claim claim.json
    python3 correction_v0.py --settle contract.json --event ... --view headers.json --claim claim.json --verify correction.json

- Inputs are pinned: the claim's sha (signatures included, so a signed claim stays bound to its signer), the contract sha, every record sha, the chain view (tip, horizon, pins, work, rules), and the sha of each settlement code file.
- Every changed field is listed with both values, and each difference is traced to a cause that points at an input: `record_omitted_by_claim`, `record_not_in_inputs`, `chain_view_differs`, `deviation_missing_in_claim` (with its evidence sha), `deviation_without_basis`, `verdict_follows`, and `unexplained` for anything the rules do not account for (checks 2 to 5).
- The correction is deterministic and `--verify` recomputes it; a doctored correction does not recompute (check 6).

## settle v1.4: the full adversarial pass (2026-09-24)
After four public red-team rounds, the whole stack was attacked on purpose. Each hole below was first reproduced against v1.3 with a working attack, then closed. The self test runs every attack against v1.3 (it succeeds) and then against v1.4 (it fails).

    python3 settle_v1_4.py --selftest       # expect: SELF-TEST PASSED, 11 checks

| | attack that worked on v1.3 | v1.4 |
|---|---|---|
| H1 | short branch padded with pre-checkpoint headers won fork choice | work counted only at or above the contract checkpoint |
| H2 | `authorized_actions: []` meant allow-all | explicit list required; empty means nothing is authorized |
| H3 | `Delete`, or a Cyrillic `е`, slipped past `prohibited_actions` | action names must match `^[a-z][a-z0-9_.:-]{0,63}$` |
| H4 | principal signed a `delete` as the "witness" and framed the contractor | party and witness keys must be pairwise distinct |
| H5 | contractor never acknowledged a delivery_ack revocation and kept authority | `ack_window` required; authority ends at min(ack, revocation + window) |
| H6 | ack named the second anchoring of a revocation and was lost after collapse | acks match the revocation's signed body |
| H7 | contractor re-signed 4 variants until its act sorted before a same-block revocation | `record_sha256` ties refused as grindable; within a block, authority ends first and approvals count only from an earlier block or the same record |
| H8 | one principal approval reused without limit | scoped approvals (`valid_until_height`, `nonce`, `single_use`); unscoped only if the grant allows |
| H9 | unbounded records, actions, headers | 10000 records, 256 actions, 200000 headers, 32 witnesses |

The ordering and scope rules now live in one walk; header verification, anchor proofs, signatures, schemas and duplicate collapse are reused from v1.1 to v1.3 unchanged.

## correction bundle v0: corrections that cannot be severed or quietly rewritten (2026-09-24)
Two more replies (@tallybexro): re-running code is a correction only if the original claim, inputs and evidence remain available, otherwise the new result quietly severs itself from what it corrects; and if a doctored correction passes, the chain is theater. correction v0 pinned hashes but carried no bytes, and nothing linked one correction to the next.

`correction_bundle_v0.py` packs the correction with everything it rests on: the claim bytes, the contract, every record, the header view, and `supersedes` (the sha of the previous bundle for the same claim).

    python3 correction_bundle_v0.py --selftest      # expect: SELF-TEST PASSED, 8 checks
    python3 correction_bundle_v0.py --verify bundle.json
    python3 correction_bundle_v0.py --chain b1.json b2.json b3.json

- A bundle re-verifies offline from its own bytes. Swapped claim bytes, a removed record, or a doctored correction each break it, by name (checks 1 to 4).
- A history of bundles is a hash chain. A doctored, dropped, reordered or quietly swapped bundle breaks a named link (check 5).
- Code drift is reported with the files that differ, never ignored (check 6).
- Stated limit: a rewrite of everything after bundle k verifies on its own. It is exposed by any earlier copy or anchored sha of a bundle it no longer contains, so anchor each bundle sha when issued.

## settle v1.5: binding by contract_sha256 (2026-09-25)
Every layer up to v1.4 bound a record to a contract by `contract_id`, a random handle written inside the record. A handle can be copied. Two records naming the same id are treated as one contract even when their terms differ, and a grant that is edited and re-signed keeps its id, so every past record silently follows the edit. The binding was a label, not the terms. This was prompted by an outside analysis that, without knowing MUSUBI existed, named the missing piece as the bilateral signed contract object and its last step: canonicalize, hash, and thread that hash through task, payment, evidence and recovery. `contract_v0` already is the object; v1.5 is the thread.

`contract_sha256` is the sha256 of the exact bytes both parties signed:

    contract_sha256(contract) = sha256( b"a2a-contract-v0\n" + canonical(contract without "signatures") )

which is `contract_v0.signing_bytes(contract)`. It is identical for both parties, does not change when the second signature lands, and recomputes for anyone from the contract minus its signatures. `contract_id` stays as a human handle; binding is by `contract_sha256`.

`settle_v1_5.py` binds by the sha, on top of v1.4 (v1.4 and every layer under it untouched).

    python3 settle_v1_5.py --selftest                       # expect: SELF-TEST PASSED, 9 checks
    python3 settle_v1_5.py --contract-sha256 contract.json  # print the sha and exit
    python3 settle_v1_5.py --settle contract.json --event e1.json --view headers.json
    python3 settle_v1_5.py --settle contract.json --event e1.json --view headers.json --nenrin walk.json

- A record is settled only if its `contract_ref.contract_sha256` equals the sha recomputed here from the contract. The rest are sorted into `foreign` (names other terms), `unbound` (names no sha) and `inconsistent` (names this sha with a mismatched id or payload) and reported, never counted.
- relabel: an execution really under contract B copies A's `contract_id`. v1.4 binds it by id and counts it; v1.5 sees B's sha, lists it foreign, never settles it (check 2).
- terms swap: a grant clause is edited and both parties re-sign, keeping the id. v1.4 turns a past action into a deviation; v1.5 sees the old sha on it, foreign, and the edited terms have nothing bound to them (check 3).
- evidence transplant: a bound execution cites a NENRIN walk produced under other terms (`walk.context.contract_sha256` differs). With the walk supplied, that is a deviation `evidence_names_other_contract` (check 4).
- strict mode (default) settles only sha-bound records. legacy mode also settles records that carry the right id but no sha, and marks the settlement `bound_by_label_only` (check 5).
- Stated limits: `within_grant` covers only the sha-bound records; foreign and unbound records are not judged false, only not these terms.

## spine_verify: one thread through a transaction (2026-09-25)
Binding one record type is not the spine; the spine is the same sha threaded through the whole transaction. `spine_verify.py` recomputes `contract_sha256` and follows it: contract, task, executions, nenrin, settlement, delegation, tsugi, ap2. For each stage it reports which records name these exact terms (`linked`), which name other terms (`foreign`), and which name none (`unbound`), and settles the execution records with `settle_v1_5`.

    python3 spine_verify.py --selftest        # expect: SELF-TEST PASSED, 9 checks
    python3 spine_verify.py --contract c.json --exec e1.json --view headers.json --nenrin walk.json --ap2 att.json --child sub.json

- delegation laundering: a child contract that names its parent by an old sha (the parent's grant was edited) is foreign, hole `parent_not_found_by_sha`; a child within the parent grant that names the current sha is linked; a child that names the correct sha but widens the grant is `grant_escalation` (checks 2, 3, 4).
- payment without terms: an AP2 attestation that cites a cart but carries no `contract_sha256` is unbound, hole `payment_without_terms`; one that names other terms is `payment_names_other_contract` (checks 5, 6).
- A deviation is a settlement verdict, not a hole; a hole is a structural break in the thread. The spine is `intact` only when nothing threads to other terms.
- Phase 2 turns each producer (the NENRIN walker, the gate A2A face, TSUGI, the AP2 bridge) into a carrier of the sha; each one moves its stage from `unbound` to `linked`. Until then those stages read honestly as unbound.

Design: `ops/MUSUBI_contract_sha256_spine_DESIGN.md`.
