# aps-receipt adapter

The input checks the HORIZON SHIELD admission door is to run for the bounded refund sandbox in
[aeoess/agent-governance-vocabulary#193](https://github.com/aeoess/agent-governance-vocabulary/issues/193)
(contract revision `review-2026-10-23`, sections 3 to 5), published so that anyone can repeat them on a published case.
The door side for this sandbox is not built yet: this adapter is the part that exists, and the door is to call it.

`adapter_aps_receipt.mjs` is a pure function over the eleven retained input files of one case, the runner's `run_id`
and the consumption instant. It parses each file once, strictly, keeps the bytes it hashed, and runs steps 1 to 8 of
the admission profile in order, stopping at the first failure:

| Step | Check |
|---|---|
| 0 | exactly the eleven section 3 files; each UTF-8, no byte order mark, no duplicate member, no NaN or Infinity, no negative zero, integers only and within the safe range; raw `sha256:` reference and musubi-canonical-v0 sha256 of each |
| 1 | `trust/aps-consumption.json`: the selected APS keys, their roles, scope and revocation state |
| 2 | `inputs/aps-intent.json`: `verifyReceiptV1`, stage `aps:action-intent:v1`, issuer and subject the refund worker |
| 3 | `inputs/aps-approval.json` with `inputs/decision-evidence.json`: `verifyReceiptWithDecisionV1` (decision reference and output bound, boundary identity the approval boundary); `prev` is the intent's `receipt_id` and both name the same action and subject (checked here: the composite's predecessor axis applies to action-result records); verdict `permit` with no constraints (the profile implements none); `valid_until` after the consumption instant; the approval signer not revoked at or before the consumption instant, a revocation before issuance included (`key_revoked`). `valid_until` is read before revocation, so a decision that has both expired and been signed by a key revoked before consumption is refused as `presentation_unverifiable` with `DECISION_EXPIRED_AT_CONSUMPTION` (a selftest case) |
| 4 | `inputs/aps-action.json`: ActionReferenceInputV2, action type, scope, worker and target of the refund profile, `computeActionRefV2` equal to the approval's `action_ref` |
| 5 | `inputs/aps-payload.json`: the closed refund object, `computePayloadRefV1` equal to the action's `payload_ref`, the payment ID equal to the one in the target |
| 6 | `policy_input.merchant_decision.decision_id` present |
| 7 | `inputs/pic-verification.json`: exactly the fourteen fields, this `run_id`, the pinned PIC SDK commit, `allow`, bound to the raw bytes of the retained proposal and keyring; the proposal's single merchant claim names this decision and this APS `receipt_id` (64 lowercase hex); the attestation it cites has not expired at the consumption instant and carries the result's digests |
| 8 | PIC `action.args` from the retained proposal equal to the APS payload; `args_digest`, `claims_digest` and `intent_digest` recomputed from the proposal. PIC `args_digest` is never compared with APS `payload_ref` |

A failure gives a reason from the closed `a2a-admission-v0` list (`presentation_unverifiable`, `outside_grant`,
`action_digest_mismatch`, `key_revoked`), the step and a finer code.

## What it does not do

It holds no key, signs nothing, keeps no state and decides nothing. Single-use consumption of the merchant decision,
the operation ID, the contract's limits, the committed record and the signed admission and mapping records are to be
the door's; the door side is not built yet and is to be closed source. The adapter does not run PIC: the PIC result is
the trusted runner's output, which the adapter binds to the retained bytes. It does not establish that a refund moved,
that the merchant is legitimate, or any revocation state beyond the selected trust file. Revocation at the consumption
instant is checked for the approval signer only; the worker key of the intent is checked at the intent's issuance, not
at consumption.

## Pins

`PINS.json` names `agent-passport-system` 8.0.1 by its npm integrity and by a digest over every file of the installed
package; the adapter refuses to run on any other bytes. The tag `v8.0.1` resolves to commit
`56e7b293c6cce232eff0b2891ddf7af85bfe01e3`, and the npm tarball's `package.json` is byte for byte the one at that
commit. The dist files were not rebuilt from source. PIC is pinned at `330fdd817ef81d43461ea1787939e0d1cc87d589`.

`trust/aps-consumption.json` is read in the shape `hs-aps-consumption-trust/0.1` until APS publishes its test trust
input; the shape is fixed at freeze.

## Run

    npm ci --ignore-scripts
    node selftest_aps_receipt.mjs
    node adapter_aps_receipt.mjs --case <dir> --run-id <id> --consumed-at 2026-10-28T00:10:00.000Z

The selftest builds its cases with the pinned SDK itself, signs them with test keys derived in memory from fixed
labels, and refuses each variant at its own check. Those are the adapter's own synthetic cases, not APS's native
fixtures.
