# MUSUBI (a2a-contract-v0)

A contract layer for agents that act on each other's behalf. Prove and price, do not enforce at runtime. HORIZON SHIELD anchors the record. It does not judge it. The settlement verdict is a function you recompute, not a decree you trust.

## Walk it yourself (no account, no key of ours, no network)

    git clone https://github.com/ogasurfproject-jpg/horizon-shield
    cd horizon-shield/workers/hs-ledger/nenrin/musubi-v0
    python3 -m venv .venv && . .venv/bin/activate
    pip install cryptography
    python3 contract_v0.py --selftest        # expect: SELF-TEST PASSED, 7 checks

`cryptography` is the only thing you install. If you prefer not to use a venv and pip refuses with "externally managed environment", `pip install --break-system-packages cryptography` does the same.

The verifier is offline by design. There is no endpoint to trust. You run the same code the operator runs and you reach the same verdict, or you have found a bug. This is a library and a CLI, not a hosted service; nothing needs to be deployed for you to check it.

## The CLI

    python3 contract_v0.py --selftest                     # 9 self checks
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
7. delegation on every axis, and the grant key door (2026-09-25, Issue #25): a child that widens who it may delegate to, drops or changes a condition the parent placed, outlives the parent's expiry, revokes slower, or accepts unscoped approvals is rejected; prohibiting a conditional action still narrows. A grant carrying any key outside the declared set (`GRANT_KEYS`) is refused, `grant_key_unknown`: a key no verifier reads is a key some reader can be made to trust.

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

    python3 spine_verify.py --selftest        # expect: SELF-TEST PASSED, 13 checks
    python3 spine_verify.py --contract c.json --exec e1.json --view headers.json --nenrin walk.json --ap2 att.json --child sub.json --external a202.json

- delegation laundering: a child contract that names its parent by an old sha (the parent's grant was edited) is foreign, hole `parent_not_found_by_sha`; a child within the parent grant that names the current sha is linked; a child that names the correct sha but widens the grant is `grant_escalation` (checks 2, 3, 4).
- payment without terms: an AP2 attestation that cites a cart but carries no `contract_sha256` is unbound, hole `payment_without_terms`; one that names other terms is `payment_names_other_contract` (checks 5, 6).
- A deviation is a settlement verdict, not a hole; a hole is a structural break in the thread. The spine is `intact` only when nothing threads to other terms.
- Phase 2 turns each producer (the NENRIN walker, the gate A2A face, TSUGI, the AP2 bridge) into a carrier of the sha; each one moves its stage from `unbound` to `linked`. Until then those stages read honestly as unbound.
- Phase 2, NENRIN walker (2026-09-25): `a2a_conduct_walk.py --context-contract-sha256 <sha>` writes `walk.context.contract_sha256` inside the canonical bytes, so the walk names its terms before it is signed and the nenrin stage reads `linked`. Two things anyone walking under a contract needs to know, both learned on the first execution of the first contract: pass `--endpoint` explicitly (the card default is usually `/mcp`, where an A2A walk fails; the contract names the a2a endpoint, for HORIZON SHIELD `/a2a`), and pass the contract sha with the flag rather than editing the record afterwards, because a post-edit breaks the signature.
- Since 2026-09-25 the executions are settled by `settle_v1_6` and the delegation stage uses the every-axis `grant_subset`.
- The `external` stage is the connector stance: a third party record (an A202 commercial agreement, a TRACE runtime attestation, a reputation entry) that carries this contract_sha256 is `linked`, one carrying another sha is a hole, and one carrying none is listed `unbound` without being a hole, because a third party schema owes this spine nothing. Ingest others' evidence and thread it, never grade it.

Design: `ops/MUSUBI_contract_sha256_spine_DESIGN.md`.

## settle v1.6: approvals bound to the terms (2026-09-25, Issue #25)
The first outside contractor (babyblueviper1) ran a cold break attempt at 330b94a0 against the whole settle chain and filed what was still open as Issue #25, reproductions pinned. Four gaps, each reproduced here before anything changed, then closed:

| | gap (where it lived) | closed by |
|---|---|---|
| D1 | a leftover `grant.authorized_prohibited` silently replaced `prohibited_actions` in the v0 and v1 settle paths | `verify_contract` refuses any grant key outside `GRANT_KEYS` (`grant_key_unknown`), so every layer that verifies first refuses it at the door; the base paths are superseded, not edited |
| D2 | `authorized_actions: []` settled as allow-everything in settle_v1 | inherited from v1.4: empty means nothing authorized |
| D3 | `grant_subset` ignored delegates, conditions, expiry, revocation speed, unscoped approvals | `grant_subset` narrows on every axis (contract_v0 check 7) |
| D4 | approvals were signed over `contract_id`, so a principal approval replayed under renegotiated terms with the same id; v1.5 had bound executions by sha and left approvals bound by the label | `a2a-approval-v2`: signed over `contract_sha256`, action, `valid_until_height`, `nonce`, `single_use`. A genuine principal signature over the old bytes is `label_bound` and never counts; a valid v2 for another sha is `other_terms`; unscoped approvals are refused as terms |

    python3 settle_v1_6.py --selftest       # expect: SELF-TEST PASSED, 9 checks
    python3 settle_v1_6.py --settle contract.json --event e1.json --view headers.json [--nenrin walk.json]

- The walk is v1.4's walk with the approval classifier swapped; ordering, ties and revocation are unchanged. Binding and the NENRIN cross check are v1.5's. Nothing under v1.6 was edited except `contract_v0.grant_subset` and the grant key door in `verify_contract`, both primitives every layer shares.
- Check D4 runs the replay against v1.5 (within_grant) and then v1.6 (label_bound, not counted, deviation named). Check D3 keeps a frozen copy of the old `grant_subset` to show it saw nothing. Checks D1 and D2 run the base v0 and v1 paths to show why they are superseded.
- Stated limits: as v1.4 and v1.5. A stolen principal key still signs a valid v2 approval.


## bond v0: the bond's teeth, without custody (2026-09-25)
Every settlement since v0 computes `bond_outcome`, but nothing recorded what the holder actually did with the money, and an outside review said so plainly. HS will not answer that with custody (refused at every layer). `bond_v0.py` makes the consequence a record: `a2a-bond-resolution-v0`, in which the party that `bond.holder` names states, over its own signature with the key pinned in the signed contract, what it did with the bond (`released` or `forfeited_to_principal`), pinned to `contract_sha256` and to the exact settlement bytes (`settlement_sha256`).

    python3 bond_v0.py --selftest      # expect: SELF-TEST PASSED, 7 checks
    python3 bond_v0.py --verify resolution.json --contract c.json --settlement s.json

- Three provable outcomes: `consistent` (the disposition matches the recomputable bond_outcome), `contradicts` (the holder's signed disposition disagrees with the outcome; misconduct provable from the bytes alone, priced in reputation), `premature` (a disposition before finality, on the record at the holder's own risk).
- Contract convention: `bond: {amount, currency, holder: "principal" | "contractor", reference}`. A third party holder is out of v0 scope and is refused as unsettleable, never guessed.
- Stated limits: nothing here moves money; the record proves the signed statement and its pins, and silence after finality is visible because the settlement is public.

## offer v0: negotiation as a chain of digests (2026-09-25)
The commercial extensions this layer is compared to carry an offer / counteroffer / acceptance state machine. With contract_sha256 the machine collapses into one rule this repo already lives by: every proposal is exact bytes named by digest, and every reply names the digest it replies to. `offer_v0.py` implements `a2a-offer-v0`: an offer carries an unsigned contract draft and is signed by the offering party with the key the draft pins for it; a counteroffer's `in_reply_to` names the previous offer's `offer_sha256`; acceptance is the final signed contract, whose body minus the optional `negotiation` block must hash-equal the accepted draft.

    python3 offer_v0.py --selftest     # expect: SELF-TEST PASSED, 8 checks
    python3 offer_v0.py --verify-chain o1.json o2.json --final contract.json

- A contract that differs from the accepted draft is `final_differs_from_accepted_offer`: whatever changed was never proposed (check 2). A draft edited after signing fails its signature; a broken `in_reply_to` is named; a stranger's offer is `offeror_not_a_party`.
- A reply that changes nothing and consecutive offers by one party are findings, not refusals: the way to accept is to sign.
- The `negotiation` block pins `head_offer_sha256` and `accepted_offer_sha256`, and both parties sign it inside the contract, so the provenance of the terms is inside the signed bytes.

## Delegation floors, numbers, and where the bytes live (2026-09-26, Issue #25 items 10 to 12)
The first outside verifier walked the chain from his side (record 3eb0a7b1 to batch b0d86bcd to Bitcoin block 968526) and then widened a delegated grant through three keys `grant_subset` did not compare. All three passed with zero violations at 25422d34 and now fail (2f07f267, check 8):

- finality: a child's `depth` is at least the parent's; its `max_target_bits`, decoded to a target with the same `bits_to_target` settle v1.1 uses, is at most the parent's (harder or equal). Omitting the axis when the parent carries it is a violation, the rule expiry and hops already follow.
- witnesses: compared by public key, not by name. Every parent witness key stays in the child; adding is allowed, replacing, dropping or emptying is not. A child adding its own party key is already refused by settle v1.4's `key_conflict`.
- revocation: the modes a settle layer reads are `anchor` and `delivery_ack`, and `verify_contract` refuses any other `effective_at` the way it refuses an undeclared grant key. An anchor parent requires an anchor child. A delivery_ack parent accepts anchor (authority ends sooner) or delivery_ack with `ack_window` at most the parent's. Any other child mode is a violation, never a fall-through. The ack_window requirement for delivery_ack stays in settle v1.4 (`ack_window_missing`), whose [H5] regression needs such a contract to pass verify so v1.3's veto hole stays demonstrable.
- privacy and ordering: in GRANT_KEYS with no settle-time reader yet, so no partial order is defined. A child holds them equal to the parent until one is; equality is the one rule that cannot be wrong in the widening direction. The first filed contract carries `privacy: public_record`, which is why they stay in GRANT_KEYS rather than being removed.

Numbers. `verify_contract` now runs the same `scan_numbers` the agreement layer runs: a non-finite number or an integer outside the RFC 7493 safe range is refused (`unsafe_number`), and a finite float is a finding (`non_integer_number`): its canonical bytes follow this runtime's float repr, so a verifier in another runtime may recompute a different `contract_sha256`. No filed contract contains a float. The next contract version forbids floats outright and pins canonical bytes to the rule the sieve layer already proves byte-identical across Python and Node: keys sorted by code point, non-ASCII unescaped, integers only within plus or minus 2^53, keys printable ASCII.

Where the bytes live. An anchor proves that bytes with this digest existed by this block; it does not keep the bytes. As of this date every filed MUSUBI record is held in at least two places that are not this ledger: the intake serves it content-addressed (`ctr:` and `exe:` by sha256), the batch is served raw at `ledger/{n}?format=raw`, the record files are committed to this repository at a named commit, and the first outside verifier holds a fork. The rule going forward is that a record's bytes are committed here before its batch is anchored, so the anchor never outlives the last copy this repository can be checked against. This is a statement of where copies are now, not a guarantee against every copy being lost.

## terms v0: meaning inside the signed bytes (2026-09-26, hole 9)
Two parties signing the same canonical bytes settles which bytes were agreed and nothing about what they mean. `deliverable: "high quality renovation"` verifies, anchors and settles perfectly while each party keeps its own idea of quality. An outside review put it as byte agreement is not semantic agreement. `terms_v0.py` (`a2a-terms-v0`) does not add a judge of meaning; it removes the place where meaning can hide.

    python3 terms_v0.py --selftest     # expect: SELF-TEST PASSED, 10 checks
    python3 terms_v0.py --verify terms.json --vocabulary glossary.json [--contract c.json]
    python3 terms_v0.py --completion terms.json --evidence measurements.json --vocabulary glossary.json

- Every deliverable is an item of one content addressed vocabulary (`a2a-vocabulary-v0`: any JSON document anyone publishes; a cost database wrapped in one, a trade standard, a two line glossary between two parties). The terms carry the vocabulary's sha256 over its exact published bytes; the contract carries `task.terms_sha256`; both parties sign the contract. Meaning is inside the signed bytes, not behind a URL whose content can change. Nothing here depends on JCCDB or on any HS dataset; JCCDB is one vocabulary that can be pinned, and check 10 pins a wrapped foreign dataset the same way.
- Every item carries `item_id`, an integer `quantity`, the `unit` the vocabulary fixes for that item, `tolerance_bp` (basis points; 200 is 2 percent) and a `completion_test {method, evidence_schema}`. An item missing any of `item_id`, `quantity`, `unit`, `completion_test` is refused as `unpinned_term`: free text is not a term. A `label` is allowed and the verifier does not read it.
- Integers only, and a float is a refusal here, not the finding it is in contract v0. A decimal is `{"value": 1874, "scale": 1}` (187.4); comparison is done at the common scale in integers. `deadline` is `{kind: "bitcoin_block", height}`; a wall clock is refused because no verifier here can read one offline.
- Vocabulary resolution needs the vocabulary bytes. With them: the digest must match, the document must call itself what the terms call it, every `item_id` must exist, the unit must be the one the vocabulary fixes, and a method must be one the vocabulary lists when it lists any. Without them the terms are `undetermined` with the reason, never accepted on faith and never refused for a fetch that did not happen. The verifier fetches nothing.
- Key doors at every level (terms, vocabulary ref, item, completion_test, evidence, measurement): a key no verifier reads is refused, never ignored, the same rule as `GRANT_KEYS`.
- `check_completion` is a pure function: terms plus measurements in, `within_terms` / `outside_terms` / `undetermined` out, with `deviation_bp` shown per item so the reader sees the arithmetic, not a grade. A measurement whose method is not the agreed `completion_test.method` is `outside_terms` (`method_mismatch`): the agreed test was not the one run. Two measurements for one item are refused, not averaged. Evidence must name `terms_sha256`.
- The terms are not signed on their own: the contract's two signatures cover `task.terms_sha256`, and `verify_contract` accepts a task carrying it unchanged (check 8). Swapping one coat out of three fails the pin (`terms_sha_mismatch`); a contract without the pin is `terms_not_pinned`.
- Stated limits: a measurement within tolerance is not a measurement that is true; who measured, and whether they are independent of either party, is a question for the signatures on the evidence and for the witness layer, not for this file.

## independence v0: from three keys toward three control domains, as counts (2026-09-26, holes 2 and 4)
Every layer here tells actors apart by Ed25519 key. settle v1.4 refuses one key held by two roles (`key_conflict`) and a party witnessing itself. That is key independence, and it says nothing about who owns the keys: one owner with three keys is three actors to every verifier in this directory and one economic subject in the world. The same review named the witness pool version of it: a fair draw from a poisoned pool is a fair draw from a poisoned pool. `independence_v0.py` (`a2a-independence-v0`) answers without central identity verification, with the step every other layer took: a declaration inside signed bytes and a measurement anyone recomputes.

    python3 independence_v0.py --selftest      # expect: SELF-TEST PASSED, 9 checks
    python3 independence_v0.py --contract c.json --declaration a.json --declaration b.json --declaration w.json
    python3 independence_v0.py --pool w1.json w2.json w3.json

- `a2a-actor-declaration-v0`: the holder of a key states, over that key's own signature, which legal entity answers for it (`registry`, `scheme`, `id`: the same triple legal-entity-v1 puts inside a signed agent card; houjin bangou and LEI ids are format checked, other schemes carried with a finding), the domain and key_url the key lives under, and optionally its AS number. Declared once per key, usable across contracts. Two different signed declarations for one key are a provable contradiction and the pair is refused (`conflicting_declarations`). A party key declaring a domain other than the one the contract pins is refused. A declaration signed by any other key is refused; a declaration for a key that is not an actor here is ignored with a finding.
- The vector over a contract's actors (principal, contractor, every witness) is counts only: `distinct_keys`, `distinct_hosts`, `distinct_sites`, `distinct_key_hosts`, `distinct_legal_entities`, `distinct_asns`, the groups that share an entity (`shared_legal_entity`), which witnesses share one with a party (`witness_party_overlap`), which witnesses live under a party's site, and who is `undeclared`. An undeclared actor is counted as undeclared, never guessed. A key that declares no entity is `declared_no_entity`, not an entity. The site rule is stated in the output (last two labels, or three under a listed second level suffix such as co.jp; no public suffix list ships here).
- A contract states its quorum in `requirements.independence`: `min_distinct_legal_entities`, `min_distinct_sites`, `min_distinct_key_hosts`, `min_distinct_asns`, `witnesses_independent_of_parties`, `declarations_required`. Any other key is refused. The verdict is `met` / `not_met` / `undetermined`, and `not_met` is used only when the missing declarations could not change it: two entities declared and one actor undeclared is `undetermined` against a minimum of 3 and `not_met` against 4. A contract that states no quorum gets `measured`, the vector alone. `verify_contract` accepts the block unchanged (check 1); `requirements` was never doored and this file doors its own block.
- `--pool` runs the same vector over a witness pool given as declarations, adding `pool_size` and `largest_entity_actors`, so a selection layer can state how much of the pool one entity holds, as a count (check 8: ten witnesses, eight under one entity).
- Stated limits: a declaration is not true because it is signed; two entities are not two owners because they are two registrations; nothing here fetched anything or consulted a register. The gain is the one legal-entity-v1 already bought on the card: the assertion sits inside signed bytes, a later denial is refuted by the bytes, and a lie is a provable lie rather than an absence.

## corroboration v0: a signed lie is still a signature, so count who else measured (2026-09-26, hole 1)
Every record in this directory proves who said what and never that it happened. A contractor and a colluding witness can both sign "1874 dm2 painted" over a wall nobody painted, and every signature verifies. No layer of cryptography closes that. What closes it, as far as anything does, is what closes it in the world: independent measurement, repeated, with a clock. `corroboration_v0.py` (`a2a-corroboration-v0`) adds no oracle. It counts.

    python3 corroboration_v0.py --selftest     # expect: SELF-TEST PASSED, 8 checks
    python3 corroboration_v0.py --contract c.json --terms t.json --view headers.json --vocabulary g.json \
        --measurement m1.json --measurement m2.json --declaration a.json --declaration b.json --declaration i1.json

- `a2a-measurement-v0`: one measurer, one item of the pinned terms, one figure, one method, signed by the measurer's own key, naming `terms_sha256` and `contract_sha256`. It carries a beacon (a Bitcoin block height and hash the measurer saw) and, once filed, an anchor (the block that holds the record, with the same proof format settle v1.1 verifies). Beacon at or after the contract's checkpoint plus a valid anchor put the record inside a window of blocks: not prefabricated before the contract, not backdated after the fact. A beacon older than the contract, a beacon the observed chain does not hold, or a missing anchor leaves the record provisional; an anchor in a block older than the record's own beacon is rejected as impossible; a proof that does not reach the block's merkle root is `anchor_proof_invalid`.
- Measurers resolve to legal entities through the same `a2a-actor-declaration-v0` independence v0 verifies. Corroboration is counted in entities, not signatures: the contractor and an "inspector" under the contractor's LEI are one voice (check 2), and with `measurers_independent_of_parties` they are zero. An undeclared measurer is an undeclared voice. The contract states the bar in `requirements.corroboration` (`min_corroborating_entities`, `measurers_independent_of_parties`; any other key refused); without the block the defaults are one entity, any.
- Per item: `corroborated` / `disputed` (entities on both sides; this file does not decide who is right) / `contradicted` / `undetermined` / `not_corroborated`, with counts of corroborating and contradicting entities, entities that contradicted themselves, provisional and undeclared voices, wrong method, rejected, and measurements anchored after the terms' deadline. `not_corroborated` is used only when the voices still missing could not reach the bar. Output is sorted by digest and identical under any input order.
- What the three files of today do together: terms v0 fixes what "done" means in the signed bytes; independence v0 turns keys into counted legal entities; corroboration v0 counts how many of those entities measured "done" inside a block window. "Signed by two" becomes "measured within tolerance by two legal entities that are not the parties, inside blocks 98 to 100, one entity disagreeing". Which of those words the verifier cannot vouch for is listed in every output.
- Stated limits: a measurement is not true because it is signed, anchored and agreed with; two entities are not two owners; nobody here knows whether a measurer stood in front of the wall. The gap between cryptographic truth and physical truth is not closed. It is narrowed to the set of legal entities that would all have to be lying inside the same block window, and that set is named.

## The grant type door (2026-09-26, Issue #25 round 3)
The first outside verifier widened through the new floors one level down: not through a key the verifier did not read, but through the type of a value under a key it did. `verify_contract` typed `authorized_actions`, `prohibited_actions` and the revocation mode and nothing else in the grant; `grant_subset` read each limit through `_int()` / `_target_of()` / `set(...)` and skipped the axis when the parent's value was not the expected type. So a parent both parties signed with `max_hops: "1"` (or `1.0`, or `true`) was accepted, and every child under it could carry `max_hops: 50` with zero refusals. `data_access: "db"` became the character set `{"d", "b"}`. Eight rows, all widening at 2f07f267, all with a well-typed control parent that refused the same child.

Closed the way the key door and the revocation door were closed: `grant_type_problems` types every declared key exactly as its readers read it, and `verify_contract` refuses a grant with any wrong type (`grant_type`) before anything compares it. `max_hops` and `expiry_height` are integers >= 0, never a bool; `finality` is `{depth >= 1, max_target_bits}` with the bits 8 lowercase hex that decode to a positive target; `data_access`, `delegation.allowed`, `authorized_actions`, `prohibited_actions` are lists of non empty strings; `delegation` is `{allowed: [...]}` (`{"allowed": []}` for none; the string `"none"` is refused, so one meaning has one spelling); `conditional` is a list of objects with unique string actions, `requires` a string when present; `witnesses` are objects with a string name and a canonical 32 byte key; `privacy` a string; `ordering` is `{same_height}` as settle v1 and v1.4 read it; `approval_policy` is `{allow_unscoped: bool}`; `revocation` carries only `effective_at` and an integer `ack_window >= 1` when present. `grant_subset` additionally reports an unreadable axis on either side as a violation, for any caller that compares grants without verifying them. The filed contract e15c0188 is well-typed on every axis and still verifies (check 9 loads it). The selftest fixture that carried `"delegation": "none"` now carries `{"allowed": []}` like the filed contract, and the contract prep script was changed the same way. Verifier's repro: 0/8 at this commit.

## The spine, with meaning, entities and measurements (2026-09-26)
`spine_verify` now threads three more stages after `external`, so the earlier stage positions do not move: `terms` (the bytes the contract pins in `task.terms_sha256`, verified by terms v0), `independence` (the actors resolved to legal entities through their own signed declarations, and the quorum the contract states, by independence v0) and `corroboration` (who measured "done", in entities, inside a block window, by corroboration v0). The thread now reads WHY (what was agreed to mean) -> AGREED -> DID -> MEASURED, and every link is the same `contract_sha256`.

    python3 spine_verify.py --contract c.json --exec e.json --view headers.json --nenrin walk.json \
        --terms t.json --vocabulary g.json --declaration a.json --declaration b.json --declaration w.json \
        --measurement m1.json --measurement m2.json

- Holes (structural breaks): terms handed in that are not the pinned bytes, or handed in under a contract that pins none (`terms_refused`); declarations that fail the quorum the contract states (`independence_quorum_not_met`) or do not verify; measurements that cannot be about this contract (`measurements_refused`) or that arrive without the terms or the chain view they need to be placed.
- Verdicts, not holes: `corroborated` / `disputed` / `contradicted` / `not_corroborated` / `undetermined` are reported in `corroboration_verdict`, the way a deviation is reported in `settlement_verdict`. A dispute about the work is a statement about the work, not a break in the thread.
- A stage with nothing handed in stays `none`; a contract that pins terms whose bytes were not supplied is `pinned_not_supplied`. The first filed thread (e15c0188) verifies exactly as before with the three stages at `none` (check 12).
- Output is identical under any order of declarations and measurements, duplicates included (check 13); messages name records by digest, never by position.
