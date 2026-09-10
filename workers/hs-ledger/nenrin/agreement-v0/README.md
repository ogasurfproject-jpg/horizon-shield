# agreement-v0

Offline reference implementation of the agreement record drafted in
[`ops/AGREEMENT_EXT_v0_DRAFT.md`](../../../../ops/AGREEMENT_EXT_v0_DRAFT.md)
(schema `a2a-agreement-v1`; the draft's sha256 is anchored as JIDEC entry 39).

A `conduct-v1` record is one sided: somebody measured somebody. This record is the other half:
at time T, party A and party B both signed the same bytes describing terms, and each of them
pointed at a conduct record, by sha256, written by somebody other than itself.

Three files, no service:

| file | what it does |
| --- | --- |
| `agreement_verify.py` | reads a record, answers `accepted` / `refused` / `incomplete` with reasons |
| `agreement_sign.py` | one party adds its own signature, on its own machine |
| `agreement_redteam.py` | 77 vectors: 46 attacks, 18 controls, 8 misclassifications, 5 residuals |

There is no intake here, no KV, no ring column, no fee, no URI. Those come when a real pair of
parties has a real agreement to record. A record layer built before it has two parties is an
empty exchange, and an empty exchange is worse than none.

## Run it

```
python3 agreement_redteam.py            # 77 / 77, needs cryptography, no network
python3 agreement_verify.py --example > rec.json
openssl genpkey -algorithm ed25519 -out a.pem
openssl genpkey -algorithm ed25519 -out b.pem
python3 agreement_sign.py --pubkey a.pem        # serve this JSON at your key_url
python3 agreement_sign.py rec.json --key a.pem --domain party-a.example --out rec.json
python3 agreement_sign.py rec.json --key b.pem --domain party-b.example --out rec.json
python3 agreement_verify.py rec.json --keys keys.json
```

`keys.json` maps each `key_url` to the public key served there. Exit codes: `0` accepted,
`1` refused, `2` incomplete.

## The rule that matters

**With no keys supplied the verdict is `incomplete`, never `accepted`.** A verifier that says
accepted without having checked a signature launders a one sided record into a two sided claim,
which is the exact failure this layer exists to prevent. `signatures_checked` is in every report
and is `false` until an actual Ed25519 verification ran.

It is offline on purpose. It does not fetch `key_url`, the conduct records, or a ledger. Two
people holding the same record and the same key file reach the same answer, and neither of them
has to be able to reach this operator. Reachability of `key_url` is the intake's problem (503,
retry), not a verifier's.

## Refusals

The draft's section 4 names eight. All eight are implemented:

`one_sided`, `signatures_disagree`, `self_agreement`, `bad_key_url`, `key_url_unreachable`,
`missing_conduct_sha`, `disclaimer_missing`, `fee_tied_to_outcome`.

Every refusal in a report carries `in_draft: true` or `false`, so a reader can tell the draft's
rules from this implementation's additions without reading the code.

## What building the verifier found, for v0.1 of the draft

The draft is anchored. It is not rewritten. These go into a v0.1 that will be anchored on its
own, and each of them is a vector in `agreement_redteam.py` today.

1. **`signature_not_a_party`.** Section 4 refuses fewer than two signatures. It never requires
   the two signatures to be the two parties. A and C can sign a record about A and B, and it
   counts two. Two signatures are not two sides unless they are the two sides.
2. **`key_url_not_pinned`.** `key_url` appears in `parties` (inside the signed bytes) and again
   in `signatures` (outside them, because signatures are removed before signing). The draft does
   not say which one binds. Whoever holds the record can swap the outer one. Here the inner one
   binds and a disagreement is refused.
3. **`recorder_fee` is refused but never defined.** Section 4 refuses a fee that varies with
   `terms.amount`; section 3 defines no field to read it from. Defined here as OPTIONAL
   `{basis, amount, currency}` with `basis` in `flat`, `per_record`, `subscription`, `none`.
   An unrecognised basis is refused rather than allowed through for not being a percentage.
4. **`roles_inconsistent`.** `role` is enumerated but the pair is not constrained. Two payers
   and no payee is a valid record under the draft and says nothing about who pays whom.
   Here: payer with payee, or peer with peer.
5. **`bad_conduct_sha`.** The draft says the conduct record is pinned "by sha" without fixing
   the encoding. An upper case sha compares unequal to the bytes it names. Here: 64 lower case
   hex, or refused.
6. **`unsafe_number`.** Nothing says how `terms.amount` is represented. An integer past 2^53 is
   rounded by the reader before any canonicalization runs, and money as a double is printed
   differently by different runtimes. Inside `terms` both are refused; elsewhere in the record a
   double is disclosed as a finding, which is the line the gate draws on itself since 0.4.2.
7. **`duplicate_json_key`.** The canonical form fixes key order and separators and says nothing
   about a key appearing twice. `{"amount":100,"amount":1}` shows one number to a human reading
   it and canonicalizes to the other. Refused at parse.
8. **`too_deep`.** Nothing bounds the shape. A record nested five thousand levels deep kills
   every recursive reader, this one included, with a traceback instead of a refusal. Depth and
   node limits, checked iteratively, before anything is canonicalized.
9. **`establishes_overclaims`.** `conduct-v1.1` section 11.1 requires both arrays. Nothing stops
   `establishes` from claiming that the money moved or the contract was formed, which is exactly
   what a filed agreement must not be read as. A closed list of claims is refused. The verifier
   applies the same guard to its own output.
10. **`record_paid_by` names a position.** `party_a` and `party_b` are indexes into an array.
    Reorder the array and the record silently reverses who paid. Naming the domain would not
    have that property. Reported as a finding, since the draft's own vocabulary is positional.
11. **The operator may be a party, and the draft never says so out loud.** Permitted here, and
    disclosed as `operator_is_a_party` when `--recorder-domain` is given. A recorder that is
    also a party has an interest in what it records, and that belongs in the record, not in a
    policy page.
12. **`self_agreement` cannot be complete offline.** Equal domains and subdomain relations are
    refused. Two siblings under one parent (`a.corp.example`, `b.corp.example`) are a finding,
    not a refusal, because deciding it needs a public suffix list and this verifier has no
    network. The report says so rather than pretending the check was made.
13. **Domain separation of the signature.** The signed bytes are the record minus `signatures`,
    so the only thing separating an agreement signature from any other Ed25519 signature by the
    same key is the `schema` field happening to be inside those bytes. An explicit context
    prefix would be stronger. Not changed here, because the draft is anchored and this
    implementation must match it.

## Findings, which are not refusals

`operator_is_a_party`, `shared_parent_domain`, `same_conduct_record`, `agreed_at_in_future`,
`not_canonical`, `paid_by_positional`, `upstream_unverified`, `disclaimer_thin`,
`non_integer_number`. A finding never changes the verdict. It is written into the report so that
a reader sees what the verifier saw and could not decide.

## What an `accepted` verdict does not establish

That either party performed, or that money moved. That the record is a contract, or that the
terms are lawful, fair or complete. That either party is solvent, competent or honest. That the
conduct records named are accurate, only that they are the records that were presented. That the
key at `key_url` is the one the party serves there, because this verifier is offline and was
handed the keys. Anything about time, because the upper bound comes from the Bitcoin anchor over
the batch and this program never sees one.

Two keys signing the same bytes is not two humans agreeing. It is two keys.
