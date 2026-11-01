# Admission records (a2a-admission-v0)

A relying party (a shop, an API, the principal itself) can decide at its own door, before an action, whether an agent
that says it acts under a signed MUSUBI contract may go ahead, and sign what it decided. That signed answer is an
admission record. Settlement reads the execution against it afterwards.

**The implementation of the door is not public. The record is public, and anyone can check it with the verifier in
this directory.** This page describes the shape of the record and how to check and recompute it. Nothing here issues an
identity, and nobody but the relying party stops anything. HORIZON SHIELD anchors records sent to its ledger and
settles after the fact. It renders no decision.

**Changed 2026-11-01.** MUSUBI admission records can be at version 0.4, in the shape of FURUI A7.4, the version measured in the blind test FURUI blind-06 (plan: ledger entry 231; result: ledger entry 232; records in commit 200d5d96). The content block carries a salted commitment to the content (`input_commit`, so the content cannot be guessed from the public record), the digest of the check, the rule set (`furui-rules-id-v1`), a decision (stop or pass), two marks (`off_topic` and `rule_conflict`), and whether the check was read and answered. Off-topic content is marked and, by default, not stopped (`on_off_topic: mark_only`). A row the model refused to read at both stages is recorded as unchecked; under the default policy (`on_unchecked: refuse`) such a request is refused, which is stricter than the measurement, where it was not stopped (1 of 963 ordinary rows in blind-06). The rates measured in blind-06 hold for the scopes of the public datasets used there; a relying party's scope is rendered from the contract (musubi-scope-v0), and rates on such scopes have not been measured. A door whose policy does not require a content check still writes a v0.1 record with no content block. Settle v1.18 and earlier do not read the 0.4 content block. FURUI is not yet wired into the door.

**Changed 2026-10-27.** MUSUBI admission records are now at version 0.3. A relying party that runs its own FURUI check can record the result as digests and three flags (instructions to an AI found, a conflict with the scope it gave, not checked), and settle v1.17 reads them. Records and settlements made before are unchanged byte for byte. FURUI is not yet wired into the door: its policy.furui is required = false, so a submission without a check is admitted as before. Public commit 3eba279d; the ledger intake is admission-intake 0.3.2.

## Files

| file | what it is |
|---|---|
| `admission_verify_v0.py`, `admission_verify_v0.mjs` | the verifying side: `verify_admission`, `admission_sha256`, `action_digest`, the applicant's signed request, the principal's revocation record. Python is the reference |
| `schemas/a2a-admission-v0.schema.json`, `schemas/a2a-revocation-v0.schema.json` | the shape of the two records (the verifier is the reference) |
| `clause_eval_v0.py`, `clause_eval_v0.mjs` | how one action reads against a signed grant, limits included. Every admission names the Python file by sha256, and settlement imports it |
| `settle_v1_11.py` | settle v1.10 plus one rule, applied only when `requirements.admission` is `required_before_execution` |
| `settle_v1_12.py` | settle v1.11 plus one rule, applied only when the grant carries `limits` |
| `contract_v0.py`, `contract_door_v0.mjs` | the contract door, with `grant.limits`, in Python and JavaScript |
| `admission_intake.mjs` | `POST /admission` and `POST /revocation` for the ledger worker. Stores and anchors what was signed. It decides nothing |
| `peer_kit.py` | the applicant's side: `request` before acting, `exec` naming the admission, `settle` |
| `fixtures/` | records a door signed, with the sha256 of each file in `fixtures/ADMISSION_FIXTURES.sha256` |

## The record

    {"schema": "a2a-admission-v0", "admission_id", "relying_party": {"domain", "key_url"},
     "contract_ref": {"contract_id", "contract_sha256"}, "action_ref": {"action_binding_digest", "nonce"},
     "presentation_ref": [{"adapter", "sha256", "verified", "self_asserted"?, "self_declared"?}],
     "chain_view": {"height", "header_sha256"}, "revocations_seen": [...],
     "decision": "admit" | "escalate" | "refuse", "reasons": [...], "clause",
     "rules": {"admit": "a2a-admission-v0", "version": "0.1", "evaluator_sha256"},
     "establishes": [...], "does_not_establish": [...], "publication"?: "public", "signatures": [{"domain", "alg": "ed25519", "sig"}]}

- **Signed bytes**: the ASCII line `a2a-admission-v0`, a newline, then the musubi-canonical-v0 bytes of the record
  without `signatures`. `admission_sha256` is the sha256 of those bytes; an execution record names it.
- **Who signs**: the relying party, with a key served at `relying_party.key_url`, which must be https on
  `relying_party.domain`. A record signed with the applicant's own contract key is refused (`self_admission`).
- **Reasons**, a closed list: `within_grant`, `conditional_needs_approval`, `prohibited_action`, `outside_grant`,
  `amount_over_limit`, `delegation_exceeds_parent`, `contract_expired`, `nonce_reused`, `grant_revoked`, `key_revoked`,
  `presentation_unverifiable`, `signer_not_on_own_domain`, `action_digest_mismatch`, `content_flagged`,
  `content_unchecked`, `exposure_full`. There is no score. The last three are refusals a door may add from its own
  policy: the relying party's own content check refused the content that came with the request (`content_flagged`),
  no such check covers those exact bytes (`content_unchecked`), or the relying party's own record of what it admitted
  already holds the most acts of this kind its policy allows in the window (`exposure_full`).
  Changed 2026-10-26: the last three reasons were added to the closed list (and to the intake and the schema). Records
  made before keep verifying as they are; a verifier holding an older copy of the list refuses a new record that carries
  one of the three, as a closed list should.
  Changed 2026-10-27: v0.3 adds `content_scope_conflict`, the relying party's content check found that answering the
  content as asked would act against the task scope it was given (a rule the scope forbids, a step it requires, or a
  topic it does not cover). It is a separate flag from `content_flagged` (an instruction to an AI in the content) and
  never counted with it. `content_unchecked` also covers a check that returned no answer, and a request that came
  without content when the door's policy requires a check.
- **`action_ref.action_binding_digest`**: sha256 of the musubi-canonical-v0 bytes of
  `{contract_sha256, action, target, amount, nonce, expiry_height}`. It binds what was asked to what was admitted, and
  settlement requires the execution to state the same values.
- **`presentation_ref`**: what the applicant showed, by the sha256 of its canonical bytes, and whether the relying
  party verified it. `verified: null` means not verified. `self_declared` lists fields the applicant brought as its own
  result; a record that carries it is a refusal.
- **`revocations_seen`**: the revocations the relying party obeyed, each as `{sha256, anchored, height}`. A revocation
  without an anchor has no proven time, and the record's `does_not_establish` says so.
- **`rules.evaluator_sha256`**: the sha256 of `clause_eval_v0.py` as the relying party ran it. Settlement recomputes the
  clauses with the same file.
- **Versions**: a record with `rules.version: "0.1"` (2026-10-10) is as above. A record with no `rules.version` is v0:
  its `revocations_seen` are sha256 strings and the third line of its `does_not_establish` differs. The verifier, the
  intake and settlement accept each with its own stated limits and refuse one that carries the other's.
- **Version 0.2 (2026-10-20)**: the record carries one more field, `immune`, the verdict of the immune rules
  (`immune_v0.py`, a2a-immune-v0) over the request: `{"rules", "evaluator_sha256", "terms_sha256", "verdict", "codes",
  "evidence_sha256", "second_signal"}`. `terms_sha256` names the contract's `requirements.immune` the rules read
  (null only with `not_run`). It carries digests and codes, never the values the rules read; the evidence digest is
  salted with the opening's salt, so a guessed value cannot be tested against it. Two reasons are added,
  `immune_hold` and `immune_reject`, and `does_not_establish` gains one line. The verdict is `clear`, `flagged`,
  `released`, `hold`, `reject` or `not_run`, and it must agree with the decision: `reject` only with `refuse` and
  `immune_reject`, `hold` only with `escalate` or `refuse` and `immune_hold`, `released` only with
  `"second_signal": "witnesses"`, `flagged` only with the mark codes or `indicator_seen`. The decision is never looser
  than the contract's (`immune_v0.combine`). Checked against its contract, a record must be v0.2 when the contract
  carries immune terms (`immune_missing`), must name those terms (`immune_terms_not_this_contracts`) and may say
  `not_run` only on a refusal (`immune_not_run`). In every version `chain_view.height` and every other number is an
  integer within 2^53 - 1. See "Immune rules" below.
- **Version 0.3 (2026-10-27)**: the record keeps `immune` and carries one more field, `content`, the relying party's
  account of its content check (a2a-content-check-v0): `{"rules", "input_sha256", "check_sha256", "rules_sha256",
  "scope_sha256", "verdict", "scope_conflict", "answered", "checked"}`. `input_sha256` is the sha256 of the
  musubi-canonical-v0 bytes of the content the door received, `check_sha256` that of the check's own record,
  `rules_sha256` the identifier of the rule set the door's policy names, `scope_sha256` the task scope the check was
  given; each is null when absent. `verdict` is `instruction` or `none`, `scope_conflict` is `none`,
  `forbidden_by_rule`, `skips_required_step` or `outside_task`, both null when there is no answer. It carries digests
  and flags, never the content. One reason is added, `content_scope_conflict`, and `does_not_establish` gains one
  line. Seven rules tie the block to the record, and a record that breaks one is malformed: (1) not `checked` means no
  flags and `content_unchecked`; (2) `checked` means the three digests are there; (3) not `answered` means no flags and
  `content_unchecked`; (4) `verdict` `instruction` if and only if `content_flagged`; (5) a conflict other than `none`
  if and only if `content_scope_conflict`; (6) no `scope_sha256`, no conflict; (7) an `admit` carries none of the
  three content reasons. Whether a flag refuses or escalates is the door's policy; the record says which it did.
- **Publication**: a record leaves the relying party only by the relying party's choice. The ledger intake stores a
  record only when its signed bytes say `"publication": "public"`.

## Checking a record

    python3 admission_verify_v0.py --verify adm.json --key <base64 Ed25519 key from relying_party.key_url> --contract c.AB.json

`verify_admission` returns `accepted`, or `refused` with codes: `malformed`, `does_not_establish_altered`,
`signer_not_on_own_domain`, `bad_signature`, `other_contract`, `self_admission`. It checks that the record is the
relying party's, unaltered, for these terms. It does not say whether the decision was right. That is what settlement
recomputes.

## The applicant's request and the principal's revocation

The applicant asks with an `a2a-action-request-v0`: `{contract_ref, action: {action, target, amount}, nonce,
expiry_height, approvals, requester: {role}, action_binding, signatures}`, signed over the ASCII line
`a2a-action-request-v0`, a newline and the canonical bytes without `signatures`, with the key the contract names for
its role (`peer_kit.py request`, `admission_verify_v0.build_action_request`). `amount` is an integer in the unit
`grant.limits` states for the action.

The principal ends a grant, or one key's use of it, with an `a2a-revocation-v0` signed over the ASCII line
`a2a-revocation-v0`, a newline and the canonical bytes without `signatures` and `anchor`
(`admission_verify_v0.build_revocation`, `revocation_signed_by_principal`).

## How settlement reads it

An execution record under a contract that requires admission carries
`admission_ref: [{action, admission_sha256, executed: {action, target, amount, nonce, expiry_height}}]`.

**v1.11.** Only for a contract with `requirements.admission = "required_before_execution"`; every other contract
settles to settle v1.10's bytes.

| deviation | when |
|---|---|
| `unadmitted_execution` | no admission is named, or the one named is not in hand, does not verify, or was already used |
| `executed_after_refusal` | the admission said refuse, or escalate with no countable approval carried |
| `executed_other_than_admitted` | the digest of what was executed is not the admission's `action_binding_digest` |
| `admission_after_execution` | the admission is anchored above the execution, or not anchored |
| `admitted_out_of_grant` | the admission said admit and the clause evaluator, run again, puts the action outside the grant |

**v1.12.** Only for a contract whose grant carries `limits`; every other contract settles to v1.11's bytes.

| deviation | when |
|---|---|
| `amount_over_limit` | `executed.amount` is above `grant.limits[action].max_amount`, or the record states no amount for a limited action |
| `admitted_out_of_grant` | that action was admitted: the relying party's signed admission says admit |

`grant.limits` is `{"<action>": {"max_amount": <integer >= 1>, "unit": "JPY"}}`. A limit is a cap; no approval lifts it.
The contract door refuses limits in a contract that does not require admission, because the amount of an execution
is stated only with its admission.

    python3 settle_v1_12.py --settle c.AB.json --event e.anchored.json --view headers.json --admission adm.anchored.json --relying-key shop.example=<base64>

**v1.18.** Only for a contract that requires admission, and only when an execution names an admission of version 0.3
that escalated on the content; otherwise v1.17's bytes (SETTLE_CORE_v0.md section 18).

| deviation | when |
|---|---|
| `executed_after_content_escalate` | the admission said escalate with a content reason, and the execution carries no approval that counts for the action, valid at its height and not already counted once if single_use (unless v1.11 already raised `executed_after_refusal`) |

## Immune rules (immune_v0.py)

The clauses ask whether a kind of act is inside the grant. The immune rules ask where the values of the act came from.
They have no head: no party (the relying party, the principal, the operator of this repository) holds a key that turns
a rule on, releases a hold or ends an inflammation. Their terms are `requirements.immune` in the contract both parties
sign, and the terms pin every key whose record can count (owners, reporters, witnesses); everything else they read is a
record that authenticates itself against a pinned key, or the Bitcoin chain. They only tighten, and tightening is cheap
while loosening is slow: an owner can withdraw its mark or kill its own key at once, but a contract that replaces
another is evaluated under both term sets, the strictest verdict winning, until `change_delay_blocks` after the later
of the new contract's own Bitcoin lower bound and the height of the first admission signed under it. Every replaced
contract still in force binds, in the order the signed admissions show (`binding_priors`).

Passing is bounded, not trusted. No rule sees every harm, so the terms also sign what an act that passes every rule
may still do: an exposure budget per action (at most `max_acts` admitted in any `window_blocks`) and a cooling-off
delay (an action waits `delay` blocks after the rules let it through, and any one pinned key may stop it in that
time). The worst a run of passing acts can do in one window is `max_acts` times what the grant lets one act do.

| Rule | What it reads | Finding |
| --- | --- | --- |
| receptor | a field the contract closes takes only the listed values, and must be present | reject, `receptor_closed` |
| mark | a watched field's value is self: in `marked` or a receptor's values, marked by an owner the contract pins for that field (a2a-immune-attestation-v0; an address only by its own domain's owner; `owner_threshold` keys of that owner; counting `mark_delay_blocks` after it was made, while a withdrawal counts at once), or acquired self for that field | mode `second_signal`: hold, `unmarked_from_content` (the door served the value) or `unmarked_novel`; mode `flag`: the act goes on, verdict `flagged` |
| second signal | for each held value, every one of the n witnesses drawn from the pinned pool (one entity each) by the block hash `beacon_offset` (6 or more) blocks after that value was first held, the draw seeded by the value (`value_key`: action, field, digest), each confirming after that block and before the hold expires (a2a-immune-observation-v0, naming the value key); any one of them stops it by saying not_confirmed or nothing; a look-alike of the value is never released | verdict `released` |
| expiry | a held value no second signal answered within `hold_expiry_blocks` of when it was first held; adding values to the request or signing the same terms again does not start it over | reject, `hold_expired` |
| indicator | an extracted value (address, host, URL, account-like string, repo) or a named field's value that pinned reporters of at least `min_distinct_entities` entities reported within `window_blocks` and have not withdrawn (a2a-immune-indicator-v0) | reject, `indicator_match`; on a quiet action (a read) flagged, `indicator_seen` |
| negative selection | an indicator that matches the contract's own self, or a value this request carries in a field that a live pinned owner's mark covers | not in force; the evaluation says it was suppressed. A mark never stands for a domain, another field or a value the request does not carry. Acquired self never suppresses |
| inflammation | at least `threshold` refusals of what the agent itself asked for within `window_blocks` (holds, flags, reads, expired holds, unverifiable and replayed requests are not danger signals) | hold every act outside `quiet_actions`; it ends by itself `cool_blocks` after the last signal |
| acquired self | the values the witnesses confirmed in acts the door carried out, `finality_blocks` deep | self for that action and field. Nothing else teaches: not an approval, not the door's list of served values |
| innate scan | with `innate`, every extracted value in any field of a non-quiet act that is not self | flagged, field `*`: `unmarked_from_content` when the door served it, else `unmarked_novel` |
| terms | the contract has `requirements.immune` but it is not well formed | reject, `terms_malformed` |
| veto | a key the contract pins said not_confirmed during a cooling-off delay | reject, `vetoed` |
| exposure | the contract's exposure budget for this action in the current window is used up | hold, `exposure_full`; it cools as the window moves |
| cooling off | the contract delays this action by a fixed number of blocks, during which any pinned key may veto | hold, `cooling_off` |

`fixtures/admission_immune/demo.json` is the first attack end to end: a genuine agent key and grant, a payee and a
recipient taken from an attacker's mail, the attacker vouching for its own address, a poisoned report against the real
supplier, fourteen admissions a door signed. Anyone recomputes every one of them from the contract, the records, the
served content and the block headers in the fixture:

    python3 immune_v0.py --check-demo

## Stated limits

- A record shows what a relying party signed. It does not show that the relying party ran any particular code;
  settlement does not need that, because it recomputes the clauses from the contract.
- The amount settlement reads is the one the execution record states and the admission's digest binds. Whether that
  amount moved in the world is outside these records.
- A revocation without an anchor has no proven time. A revocation the relying party did not hold is not in its record.
- An act the immune rules let through can still do harm inside the bound the terms sign (the exposure budget, the
  cooling-off delay, the grant's own limits). The extractor of served values does not see every obfuscated form, which
  is why an unmarked value is held whether or not it was seen. Whether a value appeared in served content depends on
  the door's own list of served tokens; it changes only the code a finding carries, never a verdict or what is learned.
- A veto names the cooling-off key, which is computed from the request's detail. A public admission carries only the
  detail's commitment, so a pinned key outside the house can veto only an act whose key the door shows it (SHIKEN shows
  them in `shk immune status`).
- An owner's mark proves that a key the contract pins signed it, not that the key was not stolen before its owner
  killed it. A witness draw proves the witnesses could not be chosen before the block existed, not that they did not
  collude after it; since every drawn witness must confirm, a coalition of c in a pool of N gets a value through with probability
  C(c, n) / C(N, n), zero when c < n. Two entities the contract names are not proven to be two owners in the world; reports can
  only refuse more, never admit more.
- A v0.3 record says what the relying party says it checked: the digests of the bytes and of the check's record, the
  rule set's identifier and the flags. It does not show that any check ran, or that the same check would answer the
  same way again (a model's answer can change between runs). Without the content disclosed, a reader can only match
  digests. The door HS runs does not yet connect a content check; so far the check has run in tests only.
- The fixture records were made with fixed test keys by a door this repository does not carry. Their sha256 is listed
  so that a change to them is visible; the settlements they lead to are recomputed here on every run.
  `fixtures/admission_content/cases.json` (v0.3) was made from the v0.2 fixture and signed with a scratch key, before the
  door writes v0.3; the door's own records replace it.

## Tests

    python3 admission_verify_v0.py --selftest        # records of all four versions, the request, the revocation, the JavaScript twin
    python3 immune_v0.py --selftest                  # the immune rules, and the first attack recomputed
    python3 immune_v0.py --check-demo
    python3 admission_verify_v0.py --check-fixtures
    python3 settle_v1_11.py --selftest
    python3 settle_v1_12.py --selftest
    python3 settle_regression.py                     # run0002, the outside parties' contract, the corpus, the published contracts
    python3 contract_door_check.py                   # the contract door in Python and JavaScript
    python3 contract_v0.py --selftest
    python3 clause_eval_v0.py --selftest
    node admission_intake.test.mjs
    python3 peer_kit.py selftest
