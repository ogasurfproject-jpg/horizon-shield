# Agreement Record v0.1 (`a2a-agreement-v1.1`), DRAFT

**Status:** draft, 2026-09-10. NOT served at a URI, NOT anchored. It exists because building the
reference verifier for v0 found thirteen holes in v0, and then fuzzing and mutating that verifier
found six more in the verifier itself. Every one of them is closed here and every one is a vector
in `workers/hs-ledger/nenrin/agreement-v0/agreement_redteam.py`.

**Relationship to v0.** v0 (`ops/AGREEMENT_EXT_v0_DRAFT.md`, schema `a2a-agreement-v1`) is
anchored: its sha256 is JIDEC entry 39, and it stays exactly as written. It is not corrected, not
amended, and not withdrawn. A dated draft whose text moves afterwards is worth nothing, which is
the whole reason for anchoring it. This is a second document with a second schema name. The
reference verifier reads both, and says which one it read.

**Author:** The HORIZ音s株式会社 / HORIZON SHIELD. **License:** Apache-2.0, as `conduct-v1`.
**Language:** RFC 2119 keywords. Field names are exact.
**Reference implementation:** `workers/hs-ledger/nenrin/agreement-v0/agreement_verify.py`
(offline, no network), `agreement_sign.py`, `agreement_redteam.py` (166 vectors),
`agreement_mutation.py` (58 mutants).

## 1. What this records

At time T, party A and party B both signed the same bytes describing terms, and each of them
pinned, by sha256, a conduct record about the OTHER party. It is not an exchange. Nothing here
matches orders, holds funds, takes custody, or declares a contract formed.

The four properties from v0 section 2 are unchanged and are what this document exists to serve:
both signatures or nothing; an external clock nobody owns; the counterparty's conduct at that
instant, by sha; no custody, no matching, no fee tied to the deal.

## 2. The record

Schema `a2a-agreement-v1.1`. Canonical bytes as in `conduct-v1` section 4: UTF-8, keys sorted at
every level, separators `,` and `:` with no spaces, non-ASCII unescaped. A v1.1 record travels in
canonical form; a reader MUST refuse bytes that are not canonical (`not_canonical`), so that the
sha an anchor carries is the sha the holder has.

- `schema`: `"a2a-agreement-v1.1"`.
- `agreement_id`: 32 lowercase hex characters, chosen at random by the parties. REQUIRED.
- `agreed_at`: exactly `YYYY-MM-DDTHH:MM:SSZ`. One instant, one spelling. It is a claim by the
  parties; the anchor is what bounds it from above.
- `lower_bound`: OPTIONAL `{ "kind": "bitcoin_block", "height": <integer>, "hash": <64 lowercase
  hex> }`. A record that names a block by hash cannot have been written before that block existed.
- `parties`: exactly two objects, each:
  - `domain`: a bare hostname, lowercase, at least two labels.
  - `key_url`: an https URL whose host is under that party's own domain.
  - `public_key_ed25519_b64`: the 32 byte Ed25519 public key, canonical base64, INSIDE the signed
    bytes. It MUST be a point of prime order L and MUST NOT be the identity.
  - `agent_card`: an https URL. `agent_card_sha256`: 64 lowercase hex.
  - `conduct_record`: `{ "sha256", "url", "subject_domain", "measured_by_domain",
    "self_measured" (OPTIONAL boolean) }`.
  - `role`: `"payer"`, `"payee"` or `"peer"`. The pair MUST be payer with payee, or peer with peer.
- `terms`: `{ "what", "consideration", "disclosure_url", ... }`. `what` and `disclosure_url` are
  always REQUIRED. `consideration` is `"money"` or `"none"` and is REQUIRED: not every agreement
  has a price, and an agreement that has none MUST say so rather than leave the fields out and
  let a reader infer the absence from missing keys.
  - `consideration: "money"` REQUIRES the roles to be payer and payee, `currency` (three upper
    case letters, ISO 4217), `who_pays_whom` as `{ "from", "to" }` naming the payer's and the
    payee's domains exactly, and either `fee_basis` or `amount_minor_units` (a non negative
    integer in the currency's minor units) together with `minor_unit_scale` (an integer 0 to 4).
  - `consideration: "none"` REQUIRES both roles to be `peer`, and FORBIDS `currency`,
    `amount_minor_units`, `minor_unit_scale`, `fee_basis` and `who_pays_whom`. Two parties
    agreeing about a fact owe each other nothing, and the record says that rather than implying it.

  The content of `terms` is NOT judged by anyone in this layer. `record_paid_by` and
  `recorder.fee` are about who paid for the RECORD and are unaffected by `consideration`.
- `recorder`: REQUIRED. `{ "domain", "is_a_party": true|false, "fee": { "basis", ... } }`.
  `basis` MUST be one of `flat`, `per_record`, `subscription`, `none`.
- `record_paid_by`: a party's `domain`, or `"both"`, `"neither"`, `"third_party"`.
- `upstream`: OPTIONAL `{ "protocol", "reference" }`, recorded as declared, never verified here.
- `establishes` / `does_not_establish`: non empty arrays of strings, as in `conduct-v1.1`
  section 11.1.
- `signatures`: exactly two, each `{ "domain", "alg": "ed25519", "signature" }`, and NOTHING else.

## 3. What is signed

    Ed25519( "a2a-agreement-v1.1" + LF + canonical(record without "signatures") )

The context prefix is part of the message. A signature made by the same key over anything else,
including a v1 agreement record with otherwise identical content, does not verify here.

Signatures are removed before signing, so the signature block is outside the signed bytes and
whoever holds the record can rewrite it. Therefore nothing that binds anything may live there:
the key and its URL live in the party entry, which is signed.

## 4. What a reader MUST refuse

Shape and text, before any field is read: `bad_json`, `duplicate_json_key`, `too_deep`
(depth or node count over the limit, or a self referring record), `bad_text` (a lone surrogate, a
control character, an over long string, an over long array), `too_large` (canonical bytes over
16384), `bad_schema`, `not_canonical`.

Content: `not_two_parties`, `bad_party`, `one_sided`, `extra_signatures`, `signature_not_a_party`, `signatures_disagree`,
`signature_invalid`, `bad_signature`, `signature_key_url_present`, `self_agreement`,
`bad_domain`, `bad_key_url`, `key_url_unreachable`, `key_url_mismatch`, `bad_public_key`,
`same_public_key`, `bad_agreement_id`, `bad_agreed_at`, `bad_lower_bound`, `missing_conduct_sha`,
`bad_conduct_sha`, `bad_card_sha`, `conduct_subject_wrong`, `conduct_self_measured_undeclared`,
`bad_role`, `roles_inconsistent`, `terms_contradict_roles`, `bad_consideration`, `bad_currency`, `bad_amount`,
`unsafe_number`, `bad_recorder`, `recorder_undisclosed`, `fee_tied_to_outcome`,
`bad_record_paid_by`, `disclaimer_missing`, `disclaimer_incomplete`, `establishes_overclaims`,
`missing_field`.

Refusal is mechanical. No editorial step exists, and none may be added.

One code belongs to v1 alone and never appears under v1.1: `key_url_not_pinned`, which exists
because v1 carries the key URL in two places, one signed and one not. v1.1 refuses the unsigned
place outright (`signature_key_url_present`), so the disagreement it names cannot arise.

## 5. What is recorded but not refused

`operator_is_a_party`, `conduct_self_measured`, `shared_parent_domain`, `same_conduct_record`,
`agreed_at_in_future`, `upstream_unverified`, `punycode_domain`, `non_integer_number`. Three more
belong to v1 alone, where the rule they name is advice rather than a requirement:
`disclaimer_thin`, `paid_by_positional`, and `not_canonical`, which under v1.1 is a refusal.
A finding never changes the verdict. It changes what the record establishes, which is a different question
and is the discipline gate 0.4.4 adopted for unsigned agent cards: presence or absence of a fact
moves what a record proves, not whether it passed.

## 6. What changed from v1, and why

Each of these was found by building the v1 verifier, then fuzzing it, then breaking it on purpose.

1. **Two signatures must be the two parties.** v1 refuses fewer than two. It never says they must
   be the two sides, so A and C can sign a record about A and B and it counts two.
2. **`key_url` binds in one place only.** v1 carries it in `parties` (signed) and in `signatures`
   (unsigned) and never says which one binds. v1.1 forbids it in the signature block outright.
3. **The key itself is in the signed bytes.** In v1 the key is only at `key_url`, so verifying a
   two year old record needs a live server that may have rotated, moved, or gone. v1.1 records
   verify offline, forever, from the record alone; `key_url` then adds a domain binding, checked
   separately and reported separately, rather than being the only way in.
4. **The public key must be a point of prime order.** A small order or identity key makes one
   signature verify under many messages, which is not a signature.
5. **The recorder fee is defined.** v1 section 4 refuses a fee that varies with the deal, and v1
   section 3 defines no field to read it from.
6. **The recorder is named and its interest is declared in the signed bytes.** v1 permits the
   operator to be a party and never says so out loud.
7. **Roles must pair, and the terms must not contradict them.** v1 enumerates `role` but allows
   two payers, and `who_pays_whom` is prose that can say the opposite of the roles.
8. **Money is an integer in minor units with an explicit scale.** v1 says nothing about how
   `amount` is written, so a price can be a double, or an integer past 2^53 that the reader rounds
   before any canonicalization runs.
9. **`agreement_id`.** Without one, two honest agreements with identical terms in the same second
   are one record, and a filed record cannot be referred to.
10. **`record_paid_by` names a domain.** `party_a` and `party_b` are indexes into an array;
    reorder the array and the record silently reverses who paid.
11. **Hashes are 64 lowercase hex, and the agent card is pinned by sha.** A card named by URL alone
    can be rewritten after the fact; an upper case sha compares unequal to the bytes it names.
12. **A context prefix.** See section 3.
13. **Whose conduct is pinned is decided.** v1 section 1 says "written by somebody other than
    themselves" and v1 section 2 says "the counterparty's conduct". Those are two different
    requirements and v1 asks for both without saying so. v1.1 requires both: the subject is the
    counterparty, and the measurer is neither party. A record measured by one of the parties is
    permitted only when it says so, and then it is accepted with the third party claim removed
    from `establishes`.
14. **The shape and the text are bounded.** Found by fuzzing the v1 verifier: a lone surrogate
    (`"\ud800"`) is valid JSON, survives the parser, and then kills UTF-8 encoding. Five thousand
    levels of nesting kills every recursive reader. Neither is a refusal in v1, because v1 never
    imagined either. A reader that dies has not refused anything.
15. **Duplicate keys are refused at the door.** `{"amount":100,"amount":1}` shows one number to a
    person reading it and canonicalizes to the other.
16. **`establishes` may not overclaim.** `conduct-v1.1` section 11.1 requires both arrays and
    nothing stops `establishes` from claiming that the money moved or a contract was formed, which
    is exactly what a filed agreement must not be read as. `does_not_establish` must cover
    performance, contract, money and the accuracy of the conduct records.
17. **Canonical form is required, not merely noted.**
18. **A `lower_bound`.** The anchor bounds `agreed_at` from above. Nothing bounded it from below.
19. **Two domains may not present one key.**
20. **An agreement may have no price, and must say so.** v1's `terms` demands an amount or a fee
    basis unconditionally. Two parties agreeing about a FACT owe each other nothing, and there was
    no way to write that: the absence of a price could only be inferred from missing keys. Found on
    2026-09-10 while designing the first real record, which is exactly such an agreement.
21. **A conduct record is about an endpoint host, not about a bare domain.** The subject check
    first required the counterparty's domain exactly. The only conduct record that actually exists
    between the two parties of that first record names `mcp.horizonshield.dev`, while the party is
    `horizonshield.dev`, so the rule as written rejected the one real record in the world. The
    subject may now be the counterparty's domain or any host under it. Found the same way, and it
    could not have been found any other way: no fixture would have looked wrong.

## 7. What v1.1 still does not do

It does not resolve registrable domains: two siblings under one parent are reported, not refused,
because deciding it needs a public suffix list and the reference verifier has no network. It does
not fetch anything, so it never establishes that a key is served where a party says it is unless
somebody hands it that fact. It does not check that a conduct record exists or says anything; it
checks that one is named, by sha, per side. It does not detect that a record was filed once, twice
or never; that is the intake's job, and `agreement_id` plus the canonical sha is what the intake
deduplicates on. It does not make anybody honest.

## 8. What a filed agreement does not establish

That either party performed. That the terms are lawful, fair or complete. That money moved. That
either party is solvent, competent or honest. That the conduct records pinned were accurate; only
that they were the records pinned, by sha, at that moment. That this record is a contract: it is
evidence that two keys signed the same bytes at a time bounded from above by a Bitcoin block, and
from below by whatever `lower_bound` names, and nothing more.

Two keys signing the same bytes is not two humans agreeing. It is two keys.

## 9. Prior art

Unchanged from v0 section 6 (AP2, x402 and `google-agentic-commerce/a2a-x402`, ACP, MPP, Cedulon
`draft-dogru-cedulon-08`, 1F916 Agent Record `draft-maintainer-1f916-agent-record-01`, NENRIN and
`conduct-v1`), and that section is anchored, so it is cited rather than restated. Nothing in this
revision claims a new primitive. What is claimed is still the combination: two mandatory
signatures, an intake that judges nothing, an external anchor, and the counterparty's measured
conduct pinned by sha at the moment of agreement. What v1.1 adds is that a reader can check all of
it from the record alone, with no network, in any language, ten years later.

## 10. Still deliberately not here

A URI. An anchor. An intake. A fee schedule. Those come when a real pair of parties has a real
agreement to record. A record layer built before it has two parties is an empty exchange, and an
empty exchange is worse than none.
