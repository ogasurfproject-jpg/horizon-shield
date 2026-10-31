# MUSUBI settle core v0

Status: draft for independent implementation. Written from the reference code, not from intent.
Date: 2026-10-17. Describes a2a-settlement-v1.16 (settle_v1_16.py).
Revision 0.1, 2026-10-17: two sentences about approval signatures were unclear (6.0, 10.4). The reference did not change; section 13 lists the clarifications and their vectors.
Revision 0.2, 2026-10-17: the answers to 25 implementation notes (NOTES.md N14) and the full parent narrowing rule (4.3). The reference did not change; section 13 lists each place and its vector.

Revision 0.3, 2026-10-18: the answers to 10 more implementation notes (NOTES.md N15): how non-finite numbers are spelled, which approver values are carried, and pinned approvers on a parent. The reference did not change; section 13 lists each place and its vector.

Revision 0.4, 2026-10-18: every underspecified reason was checked against the expected results of the vectors (NOTES.md N17). Ten were produced by no vector. Four are reachable and have vectors now; two need inputs the vector layout cannot carry and are driven by `exercise_inputs.py`; four can never fire, because 4.1 refuses the same inputs first (4.2). 6.2 now says records are counted after identical bytes are merged. The reference did not change; section 13 lists each place.

Revision 0.5, 2026-10-19: two statements about the reference were wrong and are corrected (NOTES.md N18): the sha256 of agreement_verify.py in section 16 named the vendored copy in sdk-python, not the agreement-v0 copy the reference imports; and section 12 said settle_v1_15.py gives the same core fields outside the vectors of section 13, which it does not. No rule, reason or vector changed.

Revision 0.6, 2026-10-20: two places where a third independent implementation found the text and the vectors pulling apart are now stated (NOTES.md N20): in 6.0, a strictly signed record whose body is not strict is set aside as well as adding its reason; in 4.3, failing 4.1 with the parent supplied adds only `parent_narrowing_failed`, never `contract_not_verified`. Both sentences say what the vectors already expected. No rule of the reference, reason or vector changed.

Revision 0.7, 2026-10-20: one consequence of 8.1 and 7.1 that the text implied but did not state (NOTES.md N21): the anchor is unsigned and an extra key in it is strict, so whoever holds the copies can choose the record_sha256 order of two same-block executions, and with it which of the two is reported `conditional` when they compete for one single use approval. The verdict, the codes and the bond outcome do not move. 8.3 now says so. No rule of the reference, reason or vector changed.

Revision 0.8, 2026-10-22: the file list in section 16 named two files at their revision 0.4 contents (NOTES.md N22). admission_verify_v0.py and recovery_verify.py changed since, in layers outside settle core; on the 128 vectors the complete output of the reference is the same before and after. The list now gives the current sha256 and the commit it was taken at. No rule, reason or vector changed.

Revision 0.9, 2026-10-23: the reference added `unscoped_approvals_refused` when 4.1 rejected the contract, contrary to 4.2, which applies only when 4.1 accepts (NOTES.md N23). Differential fuzzing against two independent implementations that follow the text found it. The reference is fixed (settle_v1_16.py); on the 128 vectors its complete output is the same before and after. 2.3 and 9.2 now say plainly that every bound record is triaged (6.0) and keeps its disposition whatever sections 4 and 5 find, as the reference and the vectors already did. No rule, reason or vector changed; section 16 gives the new sha256 of settle_v1_16.py.

Revision 0.10, 2026-10-27: section 17 is new, outside core v0: the one settle rule that reads `requirements.furui` (a2a-settlement-v1.17), which reads admissions (section 1), and the shape of `requirements.furui` it accepts. Core v0 does not change: the contract door of 4.1 gains no rule, the 128 vectors did not change, file for file, and an implementation of core v0 that does not read `requirements.furui` is unaffected. The two shape vectors and the rule's own are in `vectors_v1_17/`. The reference's contract door (contract_v0.py and contract_door_v0.mjs, 4.1) is unchanged, byte for byte; the shape is checked by requirements_furui_v0.py and its twin, which only contract builders (before signing), settle v1.17 and render_scope_v0 read. No core vector carries `requirements.furui`.

Revision 0.11, 2026-10-31: two places where the text was silent on what the reference does (NOTES.md N25, N26), both found by Pico's blind run K001 (piiiico/agent-errata#16), in which programs written by models from the text and the vector inputs alone were compared with the vectors. The 8 hex characters of `max_target_bits` are the 32 bit value written big-endian, so `207fffff` is `0x207fffff` (4.1 rule 10, 5.1 rule 1, 5.2). A reason added by 4.2 stops the examination of records, as 2.3 already said; 4.2 now says so itself. Both sentences state what the reference and the vectors already did. No rule of the reference, reason or vector changed; on the 128 vectors the complete output of the reference is the same before and after.

## 0. Why this document exists

Until now the MUSUBI settle function was defined only by Python code (settle_v1.py to settle_v1_16.py, each layer importing the ones below it).
A function that only one program can compute is a tool, not a protocol.
This document states one well defined part of it, "settle core v0", in plain language.
A stranger should be able to write a second implementation from this text and the vectors alone, without reading the reference.

The words MUST, MUST NOT and MAY are normative.
"The reference" means settle_v1_16.py and the files it imports, at the versions listed in section 16.
Writing this document against settle_v1_10.py found places where the code accepted input a careful second implementation would read differently, and one place where a record nobody signed could change the verdict (NOTES.md N1 to N11).
settle_v1_16.py was written to close them, and this document describes it. Section 13 lists what changed.
Where the reference still does something surprising, this document says so and marks it WRITTEN BEHAVIOUR.
Written behaviour is still normative for core v0: a second implementation that differs on it will disagree with the vectors.

## 1. Scope

Settle core v0 is exactly what the reference computes when the contract carries none of the following:

- `requirements.spine` (the spine gate, settle v1.8),
- `requirements.convergence` (drawn measurers, settle v1.9),
- `grant.approval_policy.approvers` (pinned approvers, settle v1.10),
- `grant.limits` (which forces `requirements.admission`),
- `requirements.admission` (settle v1.11 to v1.14 read it; the admissions input is passed through unchanged).

It is computed in binding mode "strict" over exactly one header view.

Out of scope, and not defined here:

- choosing between several header views (fork choice by work above the checkpoint),
- binding mode "legacy" (records bound by contract_id only),
- fetching anything. Settle core v0 never touches the network. Every key it uses is inside the contract.

A key is carried when it is present with a value other than null, with two exceptions. `requirements.spine` and `requirements.convergence` are carried whenever the key is present, null included: their gates then answer `spine_requirement_incomplete` and `convergence_requirement_incomplete`. And `grant.approval_policy.approvers` is carried only when it is a well formed approver list (4.1 rule 10); any other value that is present, null and `[]` included, refuses the contract in 4.1 (WRITTEN BEHAVIOUR). Vectors `synth_limits_null`, `synth_admission_null`, `synth_approvers_object`, `synth_approvers_string`, `synth_approvers_zero`.

If a contract carries any of the keys above, this document does not define the result.
An implementation MUST NOT claim core v0 conformance for such an input.

## 2. Inputs, outputs and the shape of the computation

### 2.1 Inputs

1. `contract`: one JSON object (schema `a2a-contract-v0`).
2. `events`: a list of JSON values. Each is meant to be a record: an execution (`a2a-execution-v0`), a revocation (`a2a-revocation-v0`) or a revocation acknowledgement (`a2a-revocation-ack-v0`). Anything else is ignored. Order carries no meaning.
3. `view`: one JSON object `{"headers": [{"height": H, "hex": "<160 lowercase hex>"}, ...]}`, raw 80 byte Bitcoin block headers. Other keys are ignored.
4. `nenrin_records`: optional list of JSON values (walk records cited by executions). Absent and empty mean the same thing. A value that is not a list is treated as absent.
5. `parent`: optional, the parent contract, needed only when `contract.parent_contract` is present (4.3).

If `contract` is not an object, the settlement is underspecified with the single reason `contract_not_verified`. If `events` is not a list, it is underspecified with `input_not_settleable`. Nothing else is computed in either case.

Keys are not a separate input.
The principal's and contractor's Ed25519 public keys are `parties[i].public_key_ed25519_b64` inside the contract, and witness keys are `grant.witnesses[i].public_key_ed25519_b64`.
`key_url` is never fetched. Checking that the key served at `key_url` equals the pinned key is outside settle core.

### 2.2 Reading JSON

Inputs are parsed as JSON with one extra rule: an object with a duplicate key is an error and no settlement is produced.
Text nested deeper than 512 levels of `[` or `{` (counted outside strings) is also an error.

Numbers MUST be integers within plus or minus (2^53 - 1). The contract is checked for this in 4.1, records in 6.0, the view in 5.1 and walks in section 11.
A JSON value with a non-integer number is not "strict" in the sense of 6.0.

The tokens `NaN`, `Infinity` and `-Infinity` are read as numbers that are not integers (WRITTEN BEHAVIOUR of the reference's reader, Python's json module). A value holding one is therefore not strict. It is not a parse error. Vectors `synth_nan_in_signed_body`, `synth_infinity_in_signed_body`, `synth_negative_infinity_in_signed_body`.
Exactly these three spellings, case sensitive. `nan`, `+Infinity` or `infinity` is a parse error, and no settlement is produced. A number token whose value is too large for a double (for example `1e400`) is read as an infinity, so it too is a non-integer number.
An integer token longer than 4300 digits is an error, and no settlement is produced: the reader raises (WRITTEN BEHAVIOUR). There is no vector, because there is no settlement to compare.

A JSON value is an "integer" in this document only if it is written as an integer token: no fraction, no exponent.
`true` and `false` are never integers.

### 2.3 The computation in one paragraph

Compute contract_sha256 (3.3) and bind records by it (6.1).
Triage every bound record (6.0), whatever sections 4 and 5 find: records not strictly signed by a party are rejected or set aside here with their dispositions (9.2), and no later step sees them.
Check the contract's terms (section 4) and verify the header view (section 5).
Every problem found so far is collected; none of them stops the other checks in this paragraph.
If 5.1 rules 1 to 8 passed, collapse copies of one signed body (6.4), whether or not section 4 found a problem.
If a problem was found in 4.1, 4.2 or 5.1 rules 1 to 8, no record is examined further: the dispositions given by 6.0 and 6.4 stand, the `revoked_by` test of 6.5, 6.6 and section 7 do not run, the event set is empty, and a bound record kept by 6.0 and not dropped by 6.4 has no disposition (revision 0.9).
Otherwise: check conformance (6.6), check anchors (section 7).
Records that pass are the event set, ordered by anchor height then record sha256 (section 8).
Walk the event set against the grant (section 10), add the NENRIN checks (section 11), and decide the verdict (section 12), status (8.5) and bond outcome (9.3).
The checks of 4.3, 5.1 rule 9, 6.0 (a record that fails closed), 7.4 (below the lower bound) and 11 (a cited walk) are collected in the same way and make the settlement underspecified; they never stop the computation of the event set.

### 2.4 Output

The output is one JSON object. Section 9 lists the core fields a second implementation MUST reproduce exactly.
Everything else the reference writes is informative.

## 3. Canonical form, digests and signatures

### 3.1 Canonical JSON (musubi-canonical-v0)

`canonical(v)` is the UTF-8 encoding of this text:

1. Objects: keys sorted by Unicode code point, at every level. Written `{"k":v,...}` with no whitespace.
2. Arrays: `[a,b,...]` with no whitespace.
3. Strings: written between `"`. Escape only `"` as `\"`, `\` as `\\`, and U+0000 to U+001F. Of those, U+0008 is `\b`, U+000C is `\f`, U+000A is `\n`, U+000D is `\r`, U+0009 is `\t`, and the rest are `\u00xx` with lowercase hex. Every other character is written as itself, including U+007F, U+2028, U+2029 and all non-ASCII. A lone surrogate code unit (U+D800 to U+DFFF not part of a valid pair) is written `\udxxx` with lowercase hex.
4. Integers: decimal, `-` only for negatives, no leading zeros, no fraction, no exponent.
5. `true`, `false`, `null` as literals.
6. A number that is not an integer can only occur in a value that is not strict, but such a value can still be signed (6.0 needs its signing bytes). It is written as Python's json module writes it: `NaN`, `Infinity`, `-Infinity`, and a finite float as Python's `repr` (`1.5`, `1e+16`, `1.0`). Not `nan`, not `null`. A signature over a body holding one verifies only over these spellings (vectors `synth_nan_in_signed_body`, `synth_infinity_in_signed_body`, `synth_negative_infinity_in_signed_body`).

The reference ships fixed inputs for this rule (musubi-v0/canonical_vectors.json) and a Node twin (canonical_v0.mjs).

### 3.2 Base64 and keys

Base64 is standard base64 (RFC 4648 section 4) with padding, and MUST be canonical: decoding then re-encoding gives the same text.
A public key is 32 bytes after decoding, a signature 64 bytes. Any other length, any non-canonical text, or any non-string is "unusable".

A public key is also unusable if it is not the canonical encoding of a point on edwards25519, if it is the identity point, or if the point is not in the prime order subgroup (small order or mixed order points).

### 3.3 The digests

| name | definition |
|---|---|
| contract signing bytes | `b"a2a-contract-v0\n" + canonical(contract without its "signatures" key)` |
| contract_sha256 | lowercase hex sha256 of the contract signing bytes |
| record_sha256 | lowercase hex sha256 of `canonical(record)`, the whole record including `anchor` and `signatures` |
| body digest | sha256 of `canonical(record without its "anchor" key)`. It includes `signatures`. Anchor proofs start from these 32 bytes |
| record signing bytes | context + `canonical(record without "signatures" and without "anchor")`. Context is `b"a2a-execution-v0\n"`, `b"a2a-revocation-v0\n"` or `b"a2a-revocation-ack-v0\n"` by the record's schema |

contract_sha256 is the identity of the terms. It does not change when a signature is added. A record is bound to a contract only by it (6.1).

### 3.4 Ed25519 verification

`verify(pub_b64, sig_b64, message)` returns one of: true, false, unusable.
It returns unusable when the key or signature fails 3.2. Otherwise it is RFC 8032 Ed25519 verification of the 64 byte signature over the message bytes.
The reference uses the Python `cryptography` package (OpenSSL). See NOTES.md N9 on libraries that differ for adversarial signatures.

A 64 byte signature is "strict" when its last 32 bytes, read as a little-endian integer S, are below the group order L = 2^252 + 27742317777372353535851937790883648493, and its first 32 bytes R pass the public key test of 3.2 (a canonical encoding of a point of prime order, not the identity).
"Strictly verifies" means the signature is strict and verify returned true. Libraries that disagree on lax signatures all agree on strict ones.

Everywhere below, "verifies" means verify returned true. False and unusable are both "does not verify", except in the contract door (4.1), which names them differently.

## 4. The contract

### 4.1 The contract door (contract verification)

The contract is accepted only if every check below passes. Any failure gives the single underspecified reason `contract_not_verified` (section 4.2 is then skipped).
The reference reports a list of refusal codes alongside; those codes are informative. Only `contract_not_verified` is core.

1. `schema` is `"a2a-contract-v0"`.
2. `contract_id` and `nonce` are each 32 lowercase hex characters.
3. `parties` is a list of exactly two objects whose `role` values are exactly one `"principal"` and one `"contractor"`.
4. Each party's `domain` normalizes to a bare hostname: leading and trailing whitespace removed (every character Python's `str.strip()` removes, not only U+0020), then lowercased, then one or more trailing dots removed. The result has no `/`, `@`, `:` or space, at least two labels, each label matching `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`. The two normalized domains differ.
5. Each party's `key_url` is an `https://` URL. (Whether its host is under the domain is a finding, not a refusal.)
6. Each party's `public_key_ed25519_b64` decodes as canonical base64 to 32 bytes. (The point check of 3.2 is applied later, when signatures are verified.)
7. `task` is an object with a non-empty string `purpose`. `task.payload_digest`, when present and not null, is 64 lowercase hex.
8. `grant` is an object. Its keys are only: `authorized_actions`, `prohibited_actions`, `conditional`, `delegation`, `data_access`, `max_hops`, `privacy`, `revocation`, `finality`, `witnesses`, `expiry_height`, `ordering`, `approval_policy`, `limits`. Any other key refuses the contract.
9. `grant.authorized_actions` and `grant.prohibited_actions` are both lists of non-empty strings, and no action is in both.
10. Typed grant keys, each checked only when present and not null:
    - `data_access`: list of non-empty strings.
    - `max_hops`, `expiry_height`: integer >= 0.
    - `delegation`: object with exactly one key, `allowed`, a list of non-empty strings. `{}` refuses the contract (vector `synth_delegation_empty_object`).
    - `conditional`: list of objects, each with a non-empty string `action`; actions unique; `requires`, when present, a string.
    - `finality`: object with keys only from `depth`, `max_target_bits`. `depth`, when present, integer >= 1. `max_target_bits`, when present, 8 lowercase hex, the 32 bit value written big-endian (`207fffff` is `0x207fffff`), that decodes (5.2) to a positive target.
    - `witnesses`: list of objects, each with a non-empty string `name` and a `public_key_ed25519_b64` that decodes to 32 bytes.
    - `privacy`: non-empty string.
    - `ordering`: object with no key other than `same_height`, which is optional (`{}` is accepted, vector `synth_ordering_empty_object`); `same_height`, when present, a string or null.
    - `approval_policy`: object with keys only from `allow_unscoped` (boolean) and `approvers`. `approvers`, when present, must be a list of 1 to 16 objects, each with keys only from `name`, `public_key_ed25519_b64` and `actions`: a non-empty string `name`, a canonical 32 byte `public_key_ed25519_b64`, names and keys unique across the list, and `actions` a non-empty list of distinct non-empty strings, each the `action` of an entry of `conditional`. Anything else refuses. A list that passes is carried and out of scope (section 1).
    - `revocation`: an object whose `effective_at` is `"anchor"` or `"delivery_ack"`, with keys only from `effective_at`, `ack_window`; `ack_window`, when present, integer >= 1.
11. No number anywhere in the contract (signatures included) is a non-integer, NaN, an infinity, or an integer outside plus or minus (2^53 - 1).
12. Every object key anywhere in the contract is printable ASCII (U+0020 to U+007E).
13. `establishes` is a non-empty list. No string in it matches, case-insensitively, any of: `\bperformed\b`, `\bdeliver(ed|y)\b`, `\bmoney (moved|was sent)\b`, `\bfunds? (moved|were sent|were transferred)\b`, `\bpaid\b(?!\s+for\s+(this|the)\s+record)`, `\bpayment (was|has been) (made|completed|settled|received)\b`, `\bcontract\b`, `\bbinding\b`, `\bguarantee`, `\bescrow\b`, `\bcustody\b`, `\bsolvent\b`, `\blawful\b`, `\bfair\b`, `\bcertified\b`.
14. `does_not_establish` is a non-empty list. Lowercased, its strings together contain: one of `runtime` or `enforce`; one of `judge`, `liability` or `fault`; `deviat`; and `legal`. Each of the four groups must be hit by at least one string.
15. `signatures` is a list. For each object in it: its `domain` normalizes (rule 4) to a party's normalized domain, or the contract is refused. Its `signature` is verified (3.4) with that party's key over the contract signing bytes. False or unusable refuses the contract, even if the same party also has a good signature (WRITTEN BEHAVIOUR). `alg` is not read.
16. Each party has at least one signature that verifies.
Not read by the door, and not read anywhere in core v0: `expiry` (a wall clock), `agreed_at`, `requirements.recovery`, `selection_provenance`, `liability_boundary`, `settlement`. `requirements.furui` is not read in core v0 (section 17, outside it, reads it). `lower_bound` is not checked here; section 5 checks it. `requirements.evidence` is read in section 11, `bond` and `parent_contract` in 4.3.

### 4.2 Settleable terms

Only when 4.1 accepts, each of these adds the underspecified reason shown:

| condition | reason |
|---|---|
| `grant.authorized_actions` is not a list | `authorized_actions_missing` |
| an action name in `authorized_actions`, `prohibited_actions` or `conditional[].action` does not match `^[a-z][a-z0-9_.:-]{0,63}$` (see 13, N1) | `grant_action_name_invalid` |
| more than 32 witnesses | `too_many_witnesses` |
| a witness key does not decode to 32 bytes | `witness_key_invalid` |
| two witnesses share a name, or any two of {principal key, contractor key, each witness key} decode to the same 32 bytes | `key_conflict` |
| `grant.ordering.same_height` is present and is neither null nor `"conservative"` | `tie_policy_refused` |
| `grant.revocation` is an object and `effective_at` is not `"anchor"` or `"delivery_ack"` | `revocation_policy_not_recomputable` |
| `effective_at` is `"delivery_ack"` and `ack_window` is not an integer >= 1 | `ack_window_missing` |
| `grant.finality.depth` is not an integer >= 1 (including a missing `finality` or `depth`) | `finality_policy_missing` |
| `grant.expiry_height` is present, not null, and not an integer >= 0 | `bad_expiry_height` |
| `grant.approval_policy.allow_unscoped` is truthy | `unscoped_approvals_refused` |

Any of these stops the computation: no record is examined further (2.3).

An empty `authorized_actions` list means nothing is authorized. It is not an error.

Four rows of this table cannot add their reason in core v0: `authorized_actions_missing`, `witness_key_invalid`, `revocation_policy_not_recomputable` and `bad_expiry_height`. 4.1 rules 9 and 10 refuse the same inputs first, and this table applies only when 4.1 accepts, so the input settles as `contract_not_verified`. The rows are kept so that no code changes meaning; an implementation that never emits these four agrees with the reference (revision 0.4, `exercise_inputs.py` cases D1 to D6).

### 4.3 Strict terms

Whether or not 4.1 accepts, each of these adds the underspecified reason shown:

| condition | reason |
|---|---|
| a `signatures[].signature` decodes to 64 bytes and is not strict (3.4) | `contract_signature_not_strict` |
| `bond` is present and not null, and is not an object whose `amount` is an integer from 1 to 2^53 - 1 (`true` is not an integer) | `bond_malformed` |
| `parent_contract` is present and not null, and no parent was supplied | `parent_not_supplied` |
| `parent_contract` is present and not null, and the parent is not an object, or does not pass 4.1 on its own, or the contract does not pass 4.1 with the parent supplied (the reference's door then also checks that `parent_contract.contract_id` equals the parent's `contract_id` and that the child's grant is a subset of the parent's: `contract_v0.grant_subset`) | `parent_narrowing_failed` |

These checks do not stop the walk; the event set and dispositions are still computed (section 2.3). In the last row, "does not pass 4.1 with the parent supplied" is judged by 4.3.1 and adds only `parent_narrowing_failed`; whether the settlement is `contract_not_verified` is decided by 4.1 on the contract on its own (vectors `synth_parent_full_*`).
#### 4.3.1 Parent narrowing (grant_subset)

This applies when `parent_contract` is present and not null. The contract passes 4.1 with the parent supplied if and only if it passes 4.1 on its own, `parent_contract` is an object whose `contract_id` equals the parent's `contract_id` (a missing `contract_id` fails), and the child grant C is within the parent grant P. C is within P when none of the following holds. In each rule, a list that is absent or null counts as empty, "has an integer" means the key is present with an integer that is not a boolean, and "the parent sets" a key means the key is present with a value other than null. Both grants have already passed 4.1 rule 10, so every value has its declared type.

1. An entry of `C.authorized_actions` is not in `P.authorized_actions`.
2. An entry of `P.prohibited_actions` is not in `C.prohibited_actions`.
3. An entry of `C.data_access` is not in `P.data_access`. A child without `data_access` is narrower, not wider.
4. P has an integer `max_hops` p, and C has no integer `max_hops` or one above p - 1. A child that copies the parent's `max_hops` is not within (vector `synth_parent_full_identical`), and under a parent with `max_hops` 0 no child is within.
5. An entry of `C.delegation.allowed` is not in `P.delegation.allowed`.
6. For each entry of `P.conditional`, with `a` its `action` and r its `requires` (a missing `requires` is null, on either side): skip it when either (i) `a` is in `C.prohibited_actions`, or (ii) `a` is not in `C.authorized_actions` and is not the `action` of any entry of `C.conditional` (the child cannot do `a` at all). Otherwise it is a violation if no entry of `C.conditional` has the action `a`, or the one that has it (actions are unique, 4.1 rule 10) has a `requires` other than r. An action that C both authorizes and makes conditional is judged by this rule like any other.
7. The `action` of an entry of `C.conditional` is in neither `P.authorized_actions` nor the actions of `P.conditional`.
8. P has an integer `expiry_height` e, and C has no integer `expiry_height` or one above e.
9. P has a `revocation` object; let m be its `effective_at`. Then C must have a `revocation` object with an `effective_at`. If m is `"anchor"`, C's must be `"anchor"`. If m is `"delivery_ack"`, C's may be `"anchor"` (authority ends sooner) or `"delivery_ack"`; in the second case, when P has an integer `ack_window` w, C must have an integer `ack_window` of at most w (a child without one is a violation), and when P has none, C's `ack_window` is not compared. Anything else is a violation.
10. P has a `finality` object. Then C must have one; when P has an integer `depth` d, C must have an integer `depth` of at least d; when P's `max_target_bits` decodes (5.2), C's must be present and decode to a target no larger (absent, or not decoding, is a violation). Both grants passed 4.1 rule 10, so a target that is present is positive.
11. P has a witness with a string `public_key_ed25519_b64`. Then C must have at least one witness with such a key, and every such key of P must equal, as a string, the key of one of C's witnesses. Witnesses are compared by key; the names are labels (vector `synth_parent_full_witness_renamed`).
12. For each of `privacy` and `ordering` separately: when the parent sets it, C must set it to an equal JSON value. After 4.1 rule 10 these values hold only strings, objects and null, so equality is exact: `{}` is not equal to `{"same_height": null}`. No order is defined for these two, so they are held equal. An `ordering` of `{"same_height": null}` counts as set (vector `synth_parent_full_without_ordering`).
13. `C.approval_policy.allow_unscoped` is `true` and `P.approval_policy.allow_unscoped` is not (absent counts as not true). (In core v0 a true `allow_unscoped` already gives `unscoped_approvals_refused`, 4.2.)
14. The pinned approvers differ: the parent's `approval_policy.approvers` and the child's, each taken as the empty list when absent, compared as sets of canonical entries. The order of the entries does not matter; each entry is compared as its canonical bytes (3.1), so the order of the strings in its `actions` does, as for any array. A child that carries approvers is out of scope (section 1), so in core v0 this applies when the parent pins approvers and the child has none: a violation (vector `synth_parent_approvers_child_drops`). No core v0 input can reach the order of `actions`.

The parent must also pass 4.1 on its own. Vectors `synth_parent_full_*` take a parent that sets every axis and change one axis per vector.

## 5. The header view

### 5.1 Verifying the view

The view is checked under two contract terms: the difficulty floor `grant.finality.max_target_bits` and the checkpoint `lower_bound` (`height`, `hash`).
Any failure below gives the underspecified reason `chain_view_rejected`. The view is checked even when section 4 already failed.

1. `grant.finality.max_target_bits` is 8 lowercase hex, the 32 bit value written big-endian, and decodes (5.2) to a target, the floor.
2. `lower_bound` is an object with an integer `height` and a 64 lowercase hex `hash`.
3. `view.headers` is a non-empty list.
4. Each header is an object with an integer `height` >= 0 and a `hex` of 160 lowercase hex characters, optionally followed by one line feed (WRITTEN BEHAVIOUR of the lower layers; rule 9 below then refuses the line feed under its own reason).
5. Heights are consecutive in list order: each is the previous plus one.
6. From the second header on, bytes 4 to 36 of the header, reversed, as hex, equal the previous header's hash.
7. The header's own nBits (bytes 72 to 76, little-endian unsigned 32 bit) decode to a target; that target is not above the floor; the header hash read as a big-endian 256 bit number is not above that target.
8. The view holds a header at `lower_bound.height` whose hash equals `lower_bound.hash`.

The header hash is sha256(sha256(80 raw bytes)), byte-reversed, as lowercase hex (the usual display order).
The merkle root used by anchors (7.5) is bytes 36 to 68 of the raw header, not reversed.
The tip is the height of the last header.
The view may start below the checkpoint. The first header's previous-hash field is not checked.
Consensus rules beyond these (retargeting, timestamps, transactions) are not checked.

9. Separately, when `view` is an object whose `headers` is a list, every header is an object with an integer `height` and a `hex` of exactly 160 lowercase hex characters, and every string, key and number in the view is strict (6.0, first list). If not, the reason `view_not_strict` is added. A header in upper case therefore gives both `chain_view_rejected` and `view_not_strict`; one that ends in a line feed gives only `view_not_strict`. A view that is not an object, or whose `headers` is not a list, gives `chain_view_rejected` only (vectors `synth_view_not_an_object`, `synth_view_headers_not_a_list`). Rule 9 does not stop the walk.

If the view verifies but holds more than 200000 headers, the reason is `input_too_large` instead, and no record is examined.

### 5.2 Compact target decoding

`max_target_bits` gives `bits` as 8 lowercase hex: the 32 bit value written big-endian, so `207fffff` is `0x207fffff` and `17080000` is `0x17080000`. A header's own nBits (5.1 rule 7) is the same kind of value stored little-endian in bytes 72 to 76.

For a 32 bit value `bits`: `exp = bits >> 24`, `mant = bits & 0x007fffff`.
If `bits & 0x00800000` is set, or `mant` is 0, there is no target (invalid).
Otherwise the target is `mant << (8 * (exp - 3))` when `exp >= 3`, else `mant >> (8 * (3 - exp))`.

## 6. Records before their anchors

### 6.0 Strict records and triage

A JSON value is strict when, at every depth up to 512 levels: every string and every object key is free of U+0000 to U+001F and U+007F; every key is ASCII; every number is an integer within plus or minus (2^53 - 1). A value nested deeper is not strict.

A record's parts:

- the body: the record without `signatures` and `anchor`. This is what its signers signed (3.3, record signing bytes).
- the anchor: `anchor`. Nobody signed it.
- the signatures list: `signatures`. Nobody signed it either.

The body is not strict when the body as a value is not strict, or (when present) `nenrin_ref` is neither null nor 64 lowercase hex, or `contract_ref.contract_sha256` or `contract_ref.payload_digest` is present and not 64 lowercase hex, or, for an execution: `performed_actions` or `delegated_to` is present and not a list of strings; `approvals` is present and not a list of objects; or an approval has a `sig_b64` or a `signature` that decodes to 64 bytes and is not strict (3.4). Each of the two keys is checked on its own, whichever are present: a strict `sig_b64` does not excuse a `signature` that is not strict. This is the only place an approval's `signature` is read; 10.4 never verifies it.

The anchor is not strict when it is present and: it is not strict as a value; or its `block_hash` is present and not exactly 64 lowercase hex; or a proof operation's `hex` is present and is not exactly pairs of lowercase hex digits (the empty string is allowed).

A record is strictly signed when one entry of `signatures` has a role its schema allows (6.5 table), a signature that strictly verifies (3.4) with the matching key over the record signing bytes, and is itself a strict value.

First, a record of one of the three schemas whose record_sha256 cannot be computed at all (for example an integer too long to write out) is set aside with reason `record_not_strict`. The others are bound (6.1). Each bound record is then triaged, in this order:

| condition | result |
|---|---|
| not strictly signed, body not strict | set aside, `record_not_strict` |
| not strictly signed, but a signature verifies under 3.4 alone (lax) | set aside, `signature_not_strict` |
| not strictly signed otherwise | rejected (disposition `rejected`) |
| strictly signed, body not strict | set aside, `record_not_strict`, and the underspecified reason `record_not_strict` is added: the record is a party's own statement, so setting it aside does not make the input settleable |
| strictly signed, anchor not strict, and another bound record with the same record signing bytes is kept by this table and anchors validly (6.4) | set aside, `anchor_not_strict` |
| strictly signed, anchor not strict, otherwise | underspecified reason `anchor_not_strict` |
| a revocation, and `grant.revocation` is not an object | set aside, `revocation_not_provided_for` (the contract cannot be revoked) |
| otherwise | kept |

Only the fourth row both sets a record aside and adds a reason; the first three set aside or reject without one (vectors `synth_nan_in_signed_body` and `synth_unsigned_float_beside_good` show the two cases).
Set aside and rejected records are never examined again: no collapse (6.4), size limit (6.2), conformance check, anchor check or NENRIN check sees them. They are listed with their disposition (9.2).
Problems in the signatures list of a strictly signed record (an extra entry that does not verify or is not strict) are ignored.

A third party holding copies of genuine records can change their anchors and signature lists but not their bodies. The table is arranged so that such copies are set aside or rejected whenever the genuine record is in the input.

### 6.1 Binding

Let `cid = contract.contract_id`, `pdg = contract.task.payload_digest` (it may be absent), `csha = contract_sha256`.
Walk `events` in the given order. Skip anything that is not an object, or whose `schema` is not one of the three record schemas.
Skip a record whose record_sha256 was already seen (identical bytes are one record). Then, with `ref = contract_ref` if it is an object, else empty:

| condition, in this order | class |
|---|---|
| `ref.contract_sha256` absent or null, and `ref.contract_id == cid` | unbound (not settled in strict mode) |
| `ref.contract_sha256` absent or null otherwise | not ours: dropped silently |
| `ref.contract_sha256` is not 64 lowercase hex | inconsistent |
| `ref.contract_sha256 != csha` | foreign |
| `ref.contract_id != cid` | inconsistent |
| `pdg` is present and not null, and `ref.payload_digest != pdg` | inconsistent |
| otherwise | bound |

Only bound records go further. Foreign, inconsistent and unbound records are listed (section 9) and never settled.
Binding runs even when sections 4 or 5 failed; its classes are then still reported.
Binding is by `contract_sha256` alone, so a record made under earlier terms with the same `contract_id` is foreign and is never triaged (6.0).

### 6.2 Size limit

If more than 10000 records are kept by 6.0, the reason `input_too_large` is added and no record is examined further. Records are counted after identical bytes are merged (6.3): 10001 copies of one record are one record (revision 0.4, `exercise_inputs.py` cases E4 to E6).

### 6.3 Identical bytes

Two inputs with the same record_sha256 are one record. Supplying a record twice changes nothing.

### 6.4 Several copies of one signed body

The same signed body can reach the input more than once: anchored twice (two calendars, two batches), or with another `signatures` list. These copies differ only in their unsigned parts.
Group the records kept by 6.0 by their record signing bytes (3.3). In a group with more than one distinct record_sha256:

- A copy "anchors validly" if: its `anchor.height` is an integer >= 0 that the view holds; `anchor.block_hash` equals the view's hash at that height; the proof (7.5) reaches that block's merkle root; and the batch leg rule (7.6) accepts it.
- If at least one copy anchors validly, keep the one with the smallest (height, record_sha256) and drop the others. Dropped copies are listed (disposition `duplicate_dropped`).
- If none does, keep them all. Each is then examined on its own.

This is done when section 5 rules 1 to 8 passed, whether or not section 4 did. Note that "anchors validly" does not compare the height with the checkpoint (see NOTES.md N7).

### 6.5 Authentication

Authentication is part of 6.0: only strictly signed records are kept. The roles and keys are:

| schema | signer it needs | key |
|---|---|---|
| a2a-execution-v0 | a signature with `role` `"contractor"`, or with `role` `"witness"` and a `witness_name` | the contractor's party key, or the key of the grant witness with that exact name |
| a2a-revocation-v0 | `role` `"principal"` | the principal's party key |
| a2a-revocation-ack-v0 | `role` `"contractor"` | the contractor's party key |

`signatures` must be a non-empty list. Each entry is an object with `role`, `sig_b64` and, for a witness, `witness_name`.
An entry with another role, or one that does not strictly verify, is skipped.

Then, for a kept revocation: if its `revoked_by` field is not `"principal"`, it is ignored (disposition `ignored`), even though the principal signed it.

### 6.6 Conformance

Allowed top-level fields:

- execution: `schema`, `contract_ref`, `performed_actions`, `approvals`, `delegated_to`, `nenrin_ref`, `outcomes`, `anchor`, `signatures`,
- revocation: `schema`, `contract_ref`, `revoked_by`, `anchor`, `signatures`,
- acknowledgement: `schema`, `contract_ref`, `revocation_sha256`, `acked_by`, `anchor`, `signatures`.

A record has a conformance problem if:

- it has a field outside its list,
- (execution) `performed_actions` is not a list of strings,
- (execution) `outcomes` is present, not null, and not an object; or one of its keys is not in `performed_actions`; or one of its values is not `"ok"`, `"error"`, `"timeout"` or `"partial"`,
- (execution) it lists more than 256 performed actions,
- (execution) a performed action, or the `action` of an approval that is an object, does not match `^[a-z][a-z0-9_.:-]{0,63}$`. An approval object with no `action` counts as not matching. (A name ending in a line feed never gets here: its body is not strict, 6.0.)

If an execution with a problem has a contractor signature that verifies, it is a charge: the deviation `nonconforming_record` is added, and the record continues to section 7. Its acts are still judged.
Any other record with a problem is rejected (disposition `rejected`). The computation is then repeated without the rejected records, until no new record is rejected, so no check reads a rejected record.

The types of `approvals`, `delegated_to`, `nenrin_ref` and `contract_ref` are checked in 6.0.

## 7. Anchors

### 7.1 What an anchor is

An anchor says where a record's body was committed to Bitcoin:
`"anchor": {"height": H, "block_hash": "<64 hex>", "proof": [op, ...]}`.
The anchor is not signed. Anyone holding a record can change it. The checks below decide whether the claim holds against the verified view.

### 7.2 Height

The height of a record is `anchor.height` when `anchor` is an object and `height` is an integer >= 0. Otherwise the record has no height.

### 7.3 Order of the checks

For each record that passed section 6, apply 7.4, 7.5 and 7.6 in this order. The first failure decides what happens to the record.
Every record that reaches this section is strictly signed by a party (6.0).

### 7.4 Height and block

| condition, in this order | result |
|---|---|
| no height (7.2), or `anchor.block_hash` is not 64 lowercase hex | underspecified reason `anchor_incomplete` |
| height < `lower_bound.height` | underspecified reason `anchor_below_lower_bound`. The body names this contract, and the contract names the checkpoint's block hash, so no honest anchor can be below it |
| height > tip, or the view holds no header at that height | underspecified reason `anchor_beyond_observed_chain` |
| `anchor.block_hash` != the view's hash at that height | disposition `orphaned`: excluded, no reason added, but its height counts for finality (8.5) |

### 7.5 The proof

`anchor.proof` must be a non-empty list of at most 512 operations. Start with the 32 byte body digest (3.3) as the current bytes, and apply each operation:

| op | effect |
|---|---|
| `{"op": "sha256"}` | current = sha256(current) |
| `{"op": "hexlify"}` | current = the ASCII bytes of the lowercase hex of current |
| `{"op": "append", "hex": X}` | current = current + bytes(X) |
| `{"op": "prepend", "hex": X}` | current = bytes(X) + current |

`X` is a string of pairs of lowercase hex digits (the empty string is allowed) of at most 4096 bytes. (An operand with anything else, a line feed included, never gets here: the anchor is not strict, 6.0.)
Any other op, a missing or malformed operand, a non-object entry, or current bytes longer than 65536 at any step, fails the proof.
The proof holds if the final bytes equal the merkle root of the header at the record's height (5.1).
If it fails: underspecified reason `anchor_proof_invalid`.

### 7.6 The batch leg rule

A ledger lists records by their hex sha inside a batch, and stamps the batch. A proof can pass through such a batch with `hexlify`.
A hex digest that merely appears somewhere in stamped bytes is not a listing. So:

1. If no op in the proof is `hexlify`, the rule accepts.
2. If any `hexlify` is not the first op, or there is more than one, refuse (`hexlify_not_leading`).
3. Rebuild the batch: walk the ops after the first one, up to the first `sha256`. Each must be `append` or `prepend`, else refuse (`batch_leg_malformed`). If there is no `sha256`, refuse (`batch_leg_malformed`). The batch is (all prepend operands, the later one in front) + the ASCII lowercase hex of the body digest + (all append operands, in order).
4. The batch bytes must be UTF-8 text that parses as strict JSON (2.2; so `NaN` is read as a number, vector `synth_batch_bytes_with_nan`) into an object whose `schema` is one of `nenrin-agreement-batch-v1` (typed), `nenrin-witness-batch-v1`, `nenrin-trace-pin-batch-v0`. Else refuse (`batch_not_json` or `batch_schema_unknown`).
5. `records` is a list of objects (else `batch_schema_unknown`). If `count` is present it equals the length of `records` (else `batch_count_mismatch`).
6. Exactly one `records[i]` has `sha` equal to the hex digest. None: `record_not_listed_in_batch`. More: `record_listed_twice`.
7. For a typed batch: the record's schema maps to a kind (`a2a-execution-v0` to `execution`; revocations and acknowledgements have no kind, so they are refused with `record_kind_unknown`, WRITTEN BEHAVIOUR). `records[i].kind` equals that kind (else `record_kind_mismatch`). If `records[i].schema` is present it equals the record's schema (else `record_schema_mismatch`).
8. The string value of `records[i].sha` must be written in the raw text as the 64 hex characters themselves, with no escapes (else refuse, code `internal`), and its first character must sit at byte offset equal to the total length of the prepend operands (else refuse, `batch_leg_splice_not_at_listing`).

If the rule refuses: underspecified reason `anchor_batch_leg_refused`. The refusal code is informative detail.

If all of 7.4 to 7.6 pass, the record is accepted (disposition `accepted`).

## 8. The event set and finality

### 8.1 Order

The event set is the accepted records sorted by (height, record_sha256 as a lowercase hex string). Arrival order plays no part.

### 8.2 Kinds

Each event has a kind: `execution`, `revocation` or `revocation_ack`, by schema.

### 8.3 Same block

Two records in the same block are not ordered by their bytes for any rule that matters. Section 10 says how same-block cases are decided. The order of 8.1 only fixes the listing and the order in which single use approvals are consumed (10.4).
That order is not a signed fact: the anchor is unsigned (7.1) and an extra key in it passes 6.0, so whoever holds the copies can change a record's record_sha256 without touching its body or its proof. When two executions in one block compete for one single use approval carried by an earlier record, the holder can therefore choose which of the two is reported `conditional`. The verdict, the deviation codes and the bond outcome do not change (NOTES.md N21).

### 8.4 Horizon

With tip T and `grant.finality.depth` k, the finality horizon is `T - k + 1`.

### 8.5 Status

- If the verdict is `underspecified`: `undetermined`.
- Otherwise `final` if every accepted record's height and every orphaned record's height is at or below the horizon; else `provisional`.

With no accepted and no orphaned record, the status is `final`.
Foreign, rejected, ignored and set aside records do not affect status.

## 9. Output

### 9.1 Core fields

A second implementation MUST reproduce these exactly. They are what the vectors' expected.json files hold.

| field | value |
|---|---|
| `contract_sha256` | 3.3, computed even for a contract the door refuses; null when the contract is not a JSON object (vector `synth_contract_not_object`) |
| `verdict` | `within_grant`, `deviation`, `nothing_to_settle` or `underspecified` (section 12) |
| `status` | `final`, `provisional` or `undetermined` (8.5) |
| `bond_outcome` | 9.3 |
| `deviation_codes` | the sorted set of deviation codes (Appendix A). Empty when the verdict is not `deviation` |
| `underspecified_reasons` | the sorted set of underspecified reasons (Appendix A). Empty unless the verdict is `underspecified` |
| `event_set` | the list of 8.1, each item `{"kind", "sha256", "height"}` with sha256 the record_sha256. Empty when the walk did not run. A reason from 4.3, 5.1 rule 9, 6.0, 7.4 (below the lower bound) or 11 (a cited walk) does not empty it |
| `dispositions` | an object mapping record_sha256 to one code, for every record the computation classified (9.2) |

`deviation_codes` and `underspecified_reasons` are sets. The reference may list a code more than once (one per action); that multiplicity is informative.

### 9.2 Dispositions

| code | meaning |
|---|---|
| `foreign`, `inconsistent`, `unbound` | 6.1 |
| `record_not_strict`, `signature_not_strict`, `anchor_not_strict`, `revocation_not_provided_for` | 6.0, set aside, or (for `record_not_strict` and `anchor_not_strict`) failing closed with the same reason added to the settlement |
| `duplicate_dropped` | 6.4 |
| `rejected` | 6.0 or 6.6 |
| `ignored` | 6.5, a revocation whose `revoked_by` is not `"principal"` |
| `anchor_incomplete`, `anchor_beyond_observed_chain`, `anchor_proof_invalid`, `anchor_batch_leg_refused` | 7.4 to 7.6, with the same reason added to the settlement |
| `anchor_below_lower_bound` | 7.4, with the same reason added |
| `orphaned` | 7.4 |
| `accepted` | in the event set |

Every bound record is triaged (6.0) whatever sections 4 and 5 find, so a record that 6.0 rejects or sets aside always has its disposition, and so does a copy that 6.4 drops whenever 6.4 runs (2.3). A bound record kept by 6.0 that the computation examined no further, because 4.1, 4.2, 5.1 rules 1 to 8 or 6.2 failed, has no disposition (revision 0.9).
A record that is not ours (6.1, dropped silently) has no disposition. A record set aside because it cannot be digested has no record_sha256 and so no disposition; it is counted in the informative `v1_16.refused`.
Every record has at most one disposition.

### 9.3 Bond outcome

If `contract.bond` is absent or null: `n/a`. A bond of any other form than an object with a positive integer `amount` makes the settlement underspecified (4.3) and the outcome is then `undetermined` when the value is one the lower layers read as a bond (an object with a truthy `amount`), else `n/a`.
For a well formed bond: `undetermined` if the verdict is `underspecified`; else `pending_finality` if the status is `provisional`; else `held` for `within_grant` and `nothing_to_settle`, and `forfeited` for `deviation`.

### 9.4 Informative fields

Everything else the reference writes is informative: `schema`, `settled_under`, `v1_16`, `signed_body_collapse`, `contract_id`, `binding_mode`, `bound_by_label_only`, `ordering_rule`, `approval_rule`, `anchor_rule`, `view_rules`, `chain_tip`, `finality_horizon`, `pinned_blocks`, `revocations`, `approvals`, `binding`, `orphaned`, `predates_contract`, `ignored`, `rejected`, `duplicate_anchorings`, `establishes`, `does_not_establish`, `spine_gate`, `convergence_gate`, `approval_gate`, `signatures`, the full `underspecified` and `deviations` objects (heights, `why` texts, details), and their order.
The informative fields are useful when comparing implementations. They are not part of conformance.

## 10. Grant evaluation

The walk runs over the event set (8.1) only. Let `g = contract.grant`.

### 10.1 Revocation

For each accepted revocation at height h, its effective height E is:

- `effective_at` `"anchor"`: E = h.
- `effective_at` `"delivery_ack"`: E = the smallest of h + `ack_window` and the heights of every accepted acknowledgement whose `revocation_sha256` names this revocation.

An acknowledgement names a revocation if its `revocation_sha256` equals the lowercase hex body digest of the revocation, or the record_sha256 of a copy of that revocation that is still in the input after 6.4. A copy 6.4 dropped no longer names the revocation (WRITTEN BEHAVIOUR: settle v1.4 collects every anchored copy, but since settle v1.15 the copies of one signed body are reduced before v1.4 sees them). Vector `synth_ack_names_dropped_copy`.
An acknowledgement anchored before its revocation makes E earlier than h (WRITTEN BEHAVIOUR, see NOTES.md N5).

Sort the revocations by (E, record_sha256). An execution at height h is revoked if some revocation has E <= h. Authority ends at block E inclusive: an act in the same block as an anchor-mode revocation is revoked.
For a revoked execution, every string in `performed_actions` gives the deviation `revoked`, and nothing else in that record is judged (no expiry, prohibited, conditional, unauthorized or delegation check, and no approval nonce is consumed).

If the grant has no `revocation` object, a revocation never gets here: it is set aside in 6.0 (`revocation_not_provided_for`).

### 10.2 Expiry

If `g.expiry_height` is present and not null, every string action of an execution with height h > expiry_height gives `after_expiry`.
This does not stop the other checks for that action: an expired prohibited action gives both `after_expiry` and `prohibited`.
An execution at exactly expiry_height is not expired.

### 10.3 Actions and delegation

For each accepted, unrevoked execution, for each string `a` in `performed_actions`, in order, after 10.2:

1. If `a` is in `g.prohibited_actions`: deviation `prohibited`. Next action.
2. Else if `a` is the `action` of some `g.conditional` entry: apply 10.4. Next action. (A conditional action does not need to be in `authorized_actions`.)
3. Else if `a` is not in `g.authorized_actions`: deviation `unauthorized`.

Every entry of `performed_actions` and `delegated_to` is a string here (6.0).
Comparison is exact string equality. There is no case folding or Unicode normalization.

Then, for each entry `d` of `delegated_to` not in `g.delegation.allowed` (empty when absent): deviation `delegation`.
An outcome (`outcomes`) never excuses an act. An attempt that errored is judged like one that succeeded.

### 10.4 Conditional actions and approvals

Every approval carried by an accepted execution (revoked or not) is classified. With `pk` the principal's key and `csha` this contract's contract_sha256:

1. Not an object, or no principal key: `forged` (10.5). (Once 4.1 accepts, the principal always has a usable key, so in core v0 only "not an object" can apply.)
2. If `valid_until_height` is an integer >= 0, `nonce` is a string of 32 lowercase hex characters (a nonce with a line feed never gets here, 6.0), `single_use` is a boolean, and `contract_sha256` is 64 lowercase hex: compute
   `b"a2a-approval-v2\n" + canonical({"contract_sha256": <its contract_sha256>, "action": <its action>, "valid_until_height": .., "nonce": .., "single_use": ..})`.
   If `sig_b64` verifies over it with `pk`: `counted` when its contract_sha256 equals csha, else `other_terms`.
3. Otherwise, if `sig_b64` verifies with `pk` over either older form, it is `label_bound`:
   - `b"a2a-approval-v1\n" + canonical({"contract_id", "payload_digest", "action", "valid_until_height", "nonce", "single_use"})` with contract_id and payload_digest from the contract, only when the field checks of step 2 other than contract_sha256 hold, or
   - `b"a2a-approval-v0\n" + canonical({"contract_id", "payload_digest", "action"})`.
4. Otherwise `forged`.

A missing field is canonicalized as null. The approval's `by` field is not read.
Only `sig_b64` is verified. An approval whose signature is only under another key, such as `signature`, is `forged` (10.5), even when that value would verify.
`label_bound` and `other_terms` approvals are listed (informative) and never count. They are not deviations.

A conditional action `a` in an execution at height h with record sha s is approved if some counted approval, taken in event set order (records by 8.1, approvals in list order within a record), satisfies all of:

- its `action` equals `a`,
- it is carried by the same record s, or by a record at a height strictly below h (a record in the same block does not count),
- h <= its `valid_until_height`,
- if its `single_use` is true, its `nonce` has not been consumed yet.

The first approval that satisfies all four is used. If it is single use, its nonce is consumed. The set of consumed nonces is shared across all actions and all executions (see NOTES.md N5).
If no approval satisfies all four: deviation `conditional`.
The value of `requires` in the conditional entry is not read: every conditional action needs a counted approval.

### 10.5 Forged approvals

Every approval classified `forged` adds the deviation `forged_approval`, whatever its action, whether or not the action was needed.

## 11. NENRIN checks

### 11.1 Cross check

Only when `nenrin_records` is a non-empty list.
A walk that is not strict (6.0, first paragraph) is left out. Index every other object in it by its record_sha256 (3.3).
For each execution kept by 6.0 and not rejected by 6.6, left after 6.4 (once per record_sha256), whatever section 7 then decides about its anchor (an orphaned execution is still read: WRITTEN BEHAVIOUR, vector `synth_cited_walk_orphaned_execution`), look up the walk whose record_sha256 equals the execution's `nenrin_ref`.
If found, and the walk's `context` is an object whose `contract_sha256` is present, not null, and not equal to csha: deviation `evidence_names_other_contract`.
If an execution's `nenrin_ref` names a walk that was left out for not being strict: underspecified reason `walk_not_strict`. The contractor chose what to cite, and leaving the walk out silently could hide a deviation.

Records that were rejected or set aside are never checked here (NOTES.md N2).

### 11.2 Required evidence

When `requirements.evidence` is `"nenrin_required"`, each accepted execution whose `nenrin_ref` is not 64 lowercase hex gives the deviation `evidence_missing`. This is applied after section 12 found `within_grant` or `deviation`.

## 12. Verdict

- `underspecified` if any underspecified reason was found (sections 4, 5, 6.0, 6.2, 7, 11). Then `deviations` is empty and status is `undetermined`.
- Else `deviation` if any deviation was found (sections 6.6, 10, 11).
- Else `nothing_to_settle` if the event set is empty: no record was read, so nothing was found within the grant or outside it. Status is as 8.5 gives it (`final` with no orphaned record).
- Else `within_grant`.

`within_grant` covers only the accepted records.
One strictly signed record whose anchor fails 7.4 (first, second or third row), 7.5 or 7.6 makes the whole settlement `underspecified`. A record that is not strictly signed never does.

## 13. Written behaviour, and what v1.16 changed

These are what the reference still does. They are normative for core v0 because the vectors pin them, or would.

| item | vector |
|---|---|
| An extra bad signature from a party refuses the contract even when that party also signed correctly | none |
| Revocations and acknowledgements cannot pass a typed batch leg (no kind) | none |
| An acknowledgement anchored before its revocation ends authority at the acknowledgement's height | none |
| An orphaned record is excluded without making the settlement underspecified, yet its claimed height still counts for status | `real_p31_anchor_names_other_height` |
| A header ending in a line feed passes 5.1 rules 1 to 8 and is refused only by rule 9 (`view_not_strict`); one in upper case is refused by both | `synth_view_header_trailing_newline` |
| A party-signed record that names this contract_sha256 with another contract_id or payload_digest is inconsistent (6.1) and is never triaged, so a deviation it shows is not read | none |

Changed in settle v1.16 (each was written behaviour of settle v1.10 to v1.15; NOTES.md has the details):

| before | now | vector |
|---|---|---|
| The NENRIN cross check read every bound execution, also rejected and unsigned ones: anyone could add a charge and forfeit a bond (N2) | only records strictly signed and not rejected are read by any check | `synth_nenrin_check_reads_rejected_record`, `synth_unsigned_copies_anchored_first` |
| A trailing line feed passed in block_hash, proof operands, headers, action names and approval nonces (N1) | strict forms (6.0, 5.1 rule 9) | `real_p31_proof_operand_trailing_newline`, `real_p31_proof_operand_trailing_newline_beside_good`, `real_p31_block_hash_trailing_newline`, `synth_action_name_trailing_newline`, `synth_approval_nonce_trailing_newline`, `synth_view_header_trailing_newline` |
| `delegated_to` and `approvals` were not type checked; an object in `delegated_to` stopped the reference (N3, N6) | 6.0 | `synth_delegated_to_object` |
| Floats and unsafe integers in records, views and walks were accepted (N4) | 6.0, 5.1 rule 9, 11.1 | `synth_float_in_signed_body`, `synth_unsafe_integer_in_signed_body`, `synth_unsigned_float_beside_good`, `synth_cited_walk_not_strict` |
| A revocation against a grant with no revocation block stopped the reference (N6) | set aside | `synth_revocation_irrevocable_grant` |
| The bond test used truthiness, so `[]` was no bond in Python and a bond in JavaScript (N8) | `bond_malformed` | `synth_bond_empty_list`, `synth_bond_amount_string` |
| Signatures were checked by OpenSSL alone (N9) | strict signatures (3.4) | `synth_signature_s_plus_l`, `synth_strict_signature_beside_malleated`, `real_p31_contract_bad_principal_signature` |
| A copy with a junk signatures entry was a second body that blocked the verdict (N10, fixed in v1.15) | copies of one signed body collapse (6.4) | `real_p31_copy_with_junk_signature_entry` |
| An anchor below the checkpoint was dropped without a word; `parent_contract` and `requirements.evidence` were never read; an empty event set was `within_grant` (N11) | `anchor_below_lower_bound`; 4.3; 11.2; `nothing_to_settle` | `real_p31_anchor_below_checkpoint`, `synth_parent_not_supplied`, `synth_parent_supplied_narrows`, `synth_parent_widened`, `synth_nenrin_required_without_ref`, `synth_nothing_to_settle` |

Clarified in revision 0.1 of this text. The first separately written implementation (aeoess/musubi-settle-core-check, horizon-shield Issue #49) asked which reading was meant; the reference did not change, the text had not said what it does:

| a reader could take the text to mean | what the reference does | vector |
|---|---|---|
| an approval signed only under `signature` counts | only `sig_b64` is verified, so such an approval is `forged` (10.4, 10.5) | `synth_approval_signature_key_only` |
| a strict `sig_b64` makes a malleated `signature` beside it harmless | each key is checked for strictness on its own; the body is not strict (6.0) | `synth_approval_lax_signature_beside_good_sig_b64` |
| (control) | `sig_b64` and `signature` with the same strict value: counted | `synth_approval_signature_key_same_value` |

Clarified in revision 0.2 of this text, from the 25 implementation notes of the same implementation (NOTES.md N14). The reference did not change:

| note | what the text now says | vector |
|---|---|---|
| A1 | `contract_sha256` is null when the contract is not a JSON object (9.1) | `synth_contract_not_object` |
| A3 | an integer token longer than 4300 digits stops the computation, no settlement (2.2) | none |
| A6 | domain normalization strips all leading and trailing whitespace (4.1 rule 4) | `synth_domain_leading_tab` |
| A7 | `delegation` must carry `allowed`; `ordering` may be `{}` (4.1 rule 10) | `synth_delegation_empty_object`, `synth_ordering_empty_object` |
| A10 | parent narrowing stated in full (4.3.1) | `synth_parent_full_*` (25) |
| A12, A15 | `NaN`, `Infinity`, `-Infinity` are read as numbers, in records and in batch bytes (2.2, 7.6) | `synth_nan_in_signed_body`, `synth_batch_bytes_with_nan` |
| A14 | the cross check reads an execution whatever its anchor result (11.1) | `synth_cited_walk_orphaned_execution` |
| A16 | `view_not_strict` only for a view that is an object with a `headers` list (5.1 rule 9) | `synth_view_not_an_object`, `synth_view_headers_not_a_list` |
| A20 | what "carries" means for each out of scope key (section 1) | `synth_limits_null`, `synth_admission_null` |
| A21 | a floor whose mantissa is zero decodes to no target: both the door and the view refuse | `synth_floor_zero_mantissa` |
| A22 | a copy dropped by 6.4 no longer names its revocation (10.1) | `synth_ack_names_dropped_copy` |
| A24 | 10.4 step 1 "no principal key" cannot apply once 4.1 accepts | none |

Clarified in revision 0.3, from 10 more notes of the same implementation (impl/AMBIGUITIES.md B1 to B10, NOTES.md N15). The reference did not change:

| note | what the text now says | vector |
|---|---|---|
| B2 | non-finite numbers are written `NaN`, `Infinity`, `-Infinity` in canonical form (3.1 item 6) | `synth_infinity_in_signed_body`, `synth_negative_infinity_in_signed_body` |
| B7 | only a well formed approver list is carried; `{}`, `""`, `0`, null and `[]` refuse in 4.1 (section 1, 4.1 rule 10) | `synth_approvers_object`, `synth_approvers_string`, `synth_approvers_zero` |
| B5 | rule 14 applies when the parent pins approvers and the child has none (4.3.1) | `synth_parent_approvers_child_drops` |
| C3 | rule 14 compares each approver entry as canonical bytes, so the order of `actions` inside an entry counts; core v0 cannot reach it (4.3.1) | none (out of scope) |
| B8 | exactly three spellings; `nan` and `+Infinity` stop the reader; `1e400` is an infinity (2.2) | none (no settlement to compare) |

Checked in revision 0.4 (NOTES.md N17): which underspecified reasons the vectors actually produce. The reference did not change:

| reason | what was missing | vector or exercise |
|---|---|---|
| `grant_action_name_invalid` | no vector; 4.1 accepts any non-empty string, 4.2 applies the name pattern | `synth_grant_action_name_invalid` |
| `too_many_witnesses` | no vector; 33 refuse, 32 are accepted | `synth_too_many_witnesses`, `synth_witnesses_32` |
| `ack_window_missing` | no vector; 4.1 allows `delivery_ack` without `ack_window` | `synth_delivery_ack_without_window` |
| `finality_policy_missing` | no vector; 4.1 allows `finality` without `depth` | `synth_finality_without_depth` |
| `input_not_settleable` | events that are not a list cannot be written as event files | `exercise_inputs.py` E1 to E3 |
| `input_too_large` (records) | 10001 records would be 10001 files; the count is after 6.3 | `exercise_inputs.py` E4 to E6 |
| `input_too_large` (headers) | more than 200000 verified headers | none: not exercised |
| `authorized_actions_missing`, `witness_key_invalid`, `revocation_policy_not_recomputable`, `bad_expiry_height` | cannot fire: 4.1 refuses first (4.2) | `exercise_inputs.py` D1 to D6 show `contract_not_verified` |

## 14. What this does not establish

- That any record is true. A signature proves which key signed, not that the act happened as described.
- That no key was stolen. A stolen key signs validly. Key rotation and compromise are outside settle.
- That acts nobody recorded did not happen. `within_grant` covers the accepted records only.
- That a foreign, unbound, inconsistent, rejected, orphaned or predated record is false. Only that it was not settled here.
- Full Bitcoin consensus validity. Only linkage, proof of work against each header's own nBits, the grant's difficulty floor and the signed checkpoint are checked.
- That the view is the heaviest chain. Core v0 takes one view as given. A reorganization deeper than the finality depth can change a final settlement.
- That the key at a party's `key_url` is the key in the contract. Settle never fetches.
- That the walk cited by `nenrin_ref` is correct. Section 11 only compares the contract it names.
- That anyone judged liability or fault, or that this is a legal contract. The verdict is a function anyone can recompute from the same bytes.
- That the parts out of scope (section 1) hold. A contract that relies on the spine gate, convergence, pinned approvers or limits must be settled by a settler that reads them.
- That settle layers before v1.16 agree. They do not. Over the 128 vectors, settle_v1_15.py gives different core fields (dispositions aside) on 51 and stops with an exception on 3, including vectors section 13 does not list (NOTES.md N18). This document specifies v1.16 only.
- That a record set aside or rejected is false. Only that it was not strictly signed, or not readable strictly, so it was not settled here.

## 15. How to report a disagreement

A disagreement is valuable. It means either the text, the reference or your implementation is wrong, and only a comparison finds out which.

1. Run your implementation over `vectors/`. For each vector, compare your core fields (9.1) with `expected.json`.
2. Run `python3 run_reference.py` from the folder holding this document, to confirm the reference still gives the expected values on your machine.
3. For each vector you disagree on, write down: the vector id; the core field; the expected value and yours; the section of this document you followed; and, if you can, the step where your computation first diverged (for example "6.6: I treated the name as nonconforming").
4. Say whether the vector is listed in section 13. If it is, say whether you think the behaviour should change.
5. If you disagree on an input that is not a vector, attach the input files (contract, events, view, walks) so the reference can be run on them.
6. Open an issue on the repository that publishes this document (at the time of writing github.com/ogasurfproject-jpg/horizon-shield) titled `settle core v0 disagreement: <vector id>`, with the above.

Do not change your implementation to match a vector you believe is wrong without saying so. A silent match hides a defect.
A reported disagreement is resolved by changing this text, the reference, or the vector, and the change is recorded with a new version of this document.

## 16. Test vectors and the reference

This document lives in `musubi-v0/settle-core-v0/` beside the reference, with `NOTES.md`, `gen_vectors.py`, `run_reference.py`, `inputs/peer31/` (the outside parties' contract, anchored record and header view, as they published them) and `vectors/`.

`vectors/` holds one folder per vector:

- `contract.json`, `view.json`, `events/eNN.json` (the events, in any order), `nenrin/nNN.json` when the vector supplies walks, `parent.json` when it supplies a parent contract,
- `expected.json`: the core fields (9.1).

`vectors/vectors.json` indexes them with each file's sha256, a description, the section each vector tests, and the four synthetic public keys.
Real vectors use the real records, contracts and Bitcoin headers of two settled engagements, with one change each (the record bodies cannot change without breaking the real Bitcoin anchors). `real_p31_baseline` is the first MUSUBI contract settled with no party from this project (agent-passport.org and kuangmi-bit.github.io, Bitcoin block 970480).
Synthetic vectors use keys named synthetic-principal, synthetic-contractor, synthetic-witness and synthetic-stranger, derived from fixed seeds, and a synthetic header chain at regtest difficulty (`max_target_bits` `207fffff`, checkpoint height 800001).
`gen_vectors.py` regenerates every vector from the two real inputs and the reference; it is deterministic.
`run_reference.py` runs the reference over every vector and checks every file hash and every core field.
`exercise_inputs.py` builds in memory the inputs the vector layout cannot carry (events that are not a list, 10001 records) and the inputs of the four rows of 4.2 that cannot fire, runs the reference on them, and compares its lines with `EXERCISE.txt` (`--check`).

The reference, as run for these vectors (first 16 hex digits of each file's sha256):
settle_v1.py 0e51350331c8931c, settle_v1_1.py a2391a5db199bcda, settle_v1_10.py 34beeebaa1397059, settle_v1_11.py fb03687cbacd2713, settle_v1_12.py 40a8fbb82a8e7680, settle_v1_13.py eb02b3a6544b1bf1, settle_v1_14.py 7d0704fa060adafd, settle_v1_15.py a2be5de8ba60656e, settle_v1_16.py a7a1621224a63ef2, settle_v1_2.py 6c674fd54a1a5c89, settle_v1_3.py 17119bbc7802647f, settle_v1_4.py ef3779d05fc98e40, settle_v1_5.py f9b313566713cdc4, settle_v1_6.py 6752a748ed7b6e3b, settle_v1_7.py 878a3a3697775d3a, settle_v1_8.py fe61f67c1593c776, settle_v1_9.py 7a84302be1ec38a1, admission_verify_v0.py 4bc36aa7a34ec024, agreement_verify.py fd8c34ce8a11cf42 (agreement-v0/agreement_verify.py, the copy settle_v1_16.py imports), anchor_compose.py a661f673c05dbe6e, approval_v3.py e8dde985dbe6fbf4, clause_eval_v0.py fee48c3a66c28fe1, contract_v0.py 211a568783705e11, convergence_v0.py 65a267380fa623f5, corroboration_v0.py 62ae1d6c27a92228, independence_v0.py 50964883c27896de, recovery_verify.py fd4c93f015f6b495, spine_verify.py ad2076d49be6763e, terms_v0.py 6532d5c6160a3974, as of commit f23867e0, except settle_v1_16.py, which is its revision 0.9 copy (NOTES.md N23; ec332ecb387e9b56 at f23867e0). Python 3.14.7, cryptography 50.0.1. Two of these files changed after revision 0.4 without changing any output on the vectors (NOTES.md N22).
The reference is called as a library, `settle_v1_16.settle_v1_16(contract, events, view, parent=..., nenrin_records=...)`. Its command line (`--settle`, `--event`, `--view`, `--nenrin`, `--parent`) first checks each view's strict form and runs fork choice, and for a view that does not pass prints why and writes no settlement.

## 17. The content rule (a2a-settlement-v1.17), outside core v0

This section is not part of core v0: the rule reads admissions, and a contract that requires admission is out of scope (section 1). It is written here so that an implementation that settles admissions can add the rule from the text, and its vectors are kept apart, in `vectors_v1_17/`.

The reference is settle_v1_17.py, called as `settle_v1_17.settle_v1_17(contract, events, view, admissions=..., relying_keys=...)`. It is settle v1.16 plus one rule.

When it applies. Only when `requirements.furui.rules_sha256` is 64 lowercase hex. For every other contract the output is v1.16's, byte for byte, schema line included (checked over the 128 vectors of section 16 and every admission fixture case).

The shape it accepts. `requirements.furui`, when present and not null, is an object whose keys are only `rules_sha256` and `scope_text`. `rules_sha256`, when present and not null, is 64 lowercase hex; `scope_text`, when present and not null, is a non-empty string. Any other shape refuses the contract (code `bad_requirements_furui`, contract_not_verified). Vectors `v117_requirements_furui_inert` and `v117_requirements_furui_malformed`. The check is requirements_furui_v0.problems (requirements_furui_v0.mjs is its twin); settle_v1_17 runs it first, and it is read otherwise only by contract builders, before signing, and by render_scope_v0. Core v0 does not check this shape: the contract door of 4.1 is unchanged, and a core v0 implementation that does not read `requirements.furui` settles those two contracts as it settles any other.

What it reads. The admissions v1.11 reads: an admission named by an accepted execution's `admission_ref`, for the action performed, that verifies under the relying party's key in hand and was not used by an earlier action. Executions are taken in event set order (8.1); within one, actions in `performed_actions` order. Each admission is read once.

The rule, for each such action and admission:

1. If v1.11 raised `executed_after_refusal` for the same execution, action and admission, nothing is added.
2. Else, if the admission's `rules.version` is `"0.3"` and its `content.rules_sha256` is not the contract's `requirements.furui.rules_sha256`: deviation `content_rules_mismatch`.
3. Else, if the admission's decision is `admit` and either its `rules.version` is not `"0.3"` (it carries no content check) or its `content.checked` is not `true`: deviation `content_not_checked`.

Any deviation makes the verdict `deviation`, and the bond outcome follows as in 9.3. The output also carries `content_gate`: the rule, the named rules_sha256, the admissions read and the count of each code.

What it does not do. It reads digests and two fields. It does not read the content, run a check, or recompute rules_sha256 from any file (furui_rules_id_v0.py says how that digest is made). That the door ran the check its admission names, or that the same check would answer the same way again, is not established.

Vectors. `vectors_v1_17/vectors.json` indexes them, with `admission_versions` saying which admission versions the generator could write (version 0.3 only when admission_verify_v0 knows it). Each vector folder holds the core files of section 16 plus `admissions/aNN.json` (each with its anchor) and `relying_keys.json`; `expected.json` holds the core fields (9.1) and `content_gate_counts`. `run_reference.py` checks them after the core vectors.

## Appendix A. Codes

Underspecified reasons in core v0:
`contract_not_verified`, `input_not_settleable`, `contract_signature_not_strict`, `bond_malformed`, `parent_not_supplied`, `parent_narrowing_failed`, `view_not_strict`, `record_not_strict`, `anchor_not_strict`, `anchor_below_lower_bound`, `walk_not_strict`, `authorized_actions_missing`, `grant_action_name_invalid`, `too_many_witnesses`, `witness_key_invalid`, `key_conflict`, `tie_policy_refused`, `revocation_policy_not_recomputable`, `ack_window_missing`, `finality_policy_missing`, `bad_expiry_height`, `unscoped_approvals_refused`, `chain_view_rejected`, `input_too_large`, `anchor_incomplete`, `anchor_beyond_observed_chain`, `anchor_proof_invalid`, `anchor_batch_leg_refused`.

Of these, `authorized_actions_missing`, `witness_key_invalid`, `revocation_policy_not_recomputable` and `bad_expiry_height` cannot be reached in core v0 (4.2).

Deviation codes in core v0:
`revoked`, `after_expiry`, `prohibited`, `conditional`, `unauthorized`, `delegation`, `forged_approval`, `nonconforming_record`, `evidence_names_other_contract`, `evidence_missing`.

Verdicts: `within_grant`, `deviation`, `nothing_to_settle`, `underspecified`.

Dispositions: section 9.2.
