# agreement-v0

Offline reference implementation of the agreement record. Two schemas, one program, no service.

| schema | draft | status |
| --- | --- | --- |
| `a2a-agreement-v1` | [`ops/AGREEMENT_EXT_v0_DRAFT.md`](../../../../ops/AGREEMENT_EXT_v0_DRAFT.md) | anchored as JIDEC entry 39. Read exactly as written, never corrected |
| `a2a-agreement-v1.1` | [`ops/AGREEMENT_EXT_v0_1_DRAFT.md`](../../../../ops/AGREEMENT_EXT_v0_1_DRAFT.md) | every hole found in v0 and in the v0 verifier, closed |

A `conduct-v1` record is one sided: somebody measured somebody. This record is the other half: at
time T, party A and party B both signed the same bytes describing terms, and each of them pinned,
by sha256, a conduct record about the other, written by somebody who is neither of them.

| file | what it does |
| --- | --- |
| `agreement_verify.py` | reads a record, answers `accepted` / `refused` / `incomplete` with reasons |
| `agreement_sign.py` | one party adds its own signature, on its own machine |
| `agreement_redteam.py` | 149 vectors: 94 attacks, 38 controls, 12 misclassifications, 5 residuals. About 15 seconds |
| `agreement_mutation.py` | breaks the verifier one rule at a time and checks the adversary notices. 41 mutants, about 10 minutes |

There is no intake, no KV, no ring column, no fee, no URI. Those come when a real pair of parties
has a real agreement to record. A record layer built before it has two parties is an empty
exchange, and an empty exchange is worse than none.

## Run it

```
python3 agreement_redteam.py            # 149 / 149, needs cryptography, no network
python3 agreement_mutation.py           # 41 / 41, only worth running after editing the verifier
```

A v1.1 record end to end. The keys go INSIDE the record, which is what lets it verify offline
forever:

```
openssl genpkey -algorithm ed25519 -out a.pem
openssl genpkey -algorithm ed25519 -out b.pem
python3 agreement_verify.py --example > rec.json
python3 agreement_sign.py --pubkey a.pem        # put this key in parties[0]
python3 agreement_sign.py --pubkey b.pem        # and this one in parties[1]
python3 agreement_sign.py rec.json --key a.pem --domain party-a.example --out rec.json
python3 agreement_sign.py rec.json --key b.pem --domain party-b.example --out rec.json
python3 agreement_verify.py rec.json                       # accepted, with no key file at all
python3 agreement_verify.py rec.json --keys keys.json      # and the domain binding as well
```

`--example-v1` prints the v1 template instead; under v1 the keys live only at `key_url`, so
`--keys` is required before anything can be accepted. `keys.json` maps each `key_url` to the
public key served there. Exit codes: `0` accepted, `1` refused, `2` incomplete.

## The rule that matters

**The verdict is never `accepted` unless an Ed25519 verification actually ran and passed for both
parties.** A verifier that says accepted without that launders a one sided record into a two sided
claim, which is the exact failure this layer exists to prevent.

That flag is derived from the evidence printed in the report, never set beside it. It has to be:
`agreement_mutation.py` found on 2026-09-10 that replacing it with the constant `true` left the
whole adversary green. A flag that can disagree with the list it summarises is a flag that will.

Everything is offline on purpose. Nothing fetches `key_url`, the agent cards, the conduct records,
or a ledger. Two people holding the same record reach the same answer, and neither of them has to
be able to reach this operator. Reachability is the intake's problem (503, retry), not a verifier's.

## What the report separates

`signatures_checked` and `key_urls_checked` are two different questions, and `establishes` changes
with both. A v1.1 record verifies from its own bytes; adding a key file additionally proves the
signing key is the one that party serves at its own domain, and only then does the report claim
attribution to the domain. This is gate 0.4.4's discipline: what a record proves moves with the
facts, the verdict does not.

`findings` never change the verdict. They are written into the report so a reader sees what the
verifier saw and could not decide: a recorder that is a party, a conduct record measured by one of
the parties, two domains under one parent, an agreed_at in the future.

## Refusals

The v1 draft's section 4 names eight, and all eight are implemented:
`one_sided`, `signatures_disagree`, `self_agreement`, `bad_key_url`, `key_url_unreachable`,
`missing_conduct_sha`, `disclaimer_missing`, `fee_tied_to_outcome`.

Every refusal in a report carries `in_draft: true` or `false`, so a reader can tell the v1 draft's
rules from everything added since without reading any code. The full v1.1 list is section 4 of the
v0.1 draft, and `agreement_redteam.py` checks that the document and this program name exactly the
same codes, so the two cannot drift apart quietly.

## What building and then attacking the verifier found

Twenty one items, all closed in v1.1, all listed with their reasons in section 6 of the v0.1
draft. The v0 draft is not rewritten: its sha is anchored, and a dated draft whose text moves
afterwards is worth nothing. Six came from attacking the verifier rather than reading the draft:

1. **A lone surrogate killed the verifier.** `"\ud800"` is valid JSON, survives the parser, and
   then cannot be encoded as UTF-8. Found by fuzzing. A reader that dies has not refused anything.
2. **Five thousand levels of nesting killed it too**, along with every other recursive reader.
   Depth, node count, string length, array length and total size are now bounded, and checked
   iteratively before anything is canonicalized.
3. **A `key_url` that was a list, not a string**, raised TypeError. Found by fuzzing.
4. **The verifier's own `establishes` failed its own overclaim guard.** It said the record
   discloses "who paid for it", which its own rule reads as a claim that the deal was paid.
5. **`signatures_checked` could be set to a constant and no vector noticed.** Found by mutation.
6. **A public key of small order** makes one signature verify under many messages. The subgroup
   check is now done from first principles in pure python, with no library and no blocklist:
   a key is refused unless L times the point is the identity and the point is not.

And two more came from trying to build the first real record with a real counterparty
(`ops/agreement_first_record_federico_20260910.md`), which no fixture would ever have revealed:
an agreement with no price could not be written at all, and the conduct subject had to match the
party domain exactly, which rejected the only conduct record that actually exists between those
two parties. Using a thing is what finds its holes.

## What an `accepted` verdict does not establish

That either party performed, or that money moved. That the record is a contract, or that the terms
are lawful, fair or complete. That either party is solvent, competent or honest. That the conduct
records named are accurate, only that they are the records that were pinned. That the key each
party signed with is the key it serves at its `key_url`, unless `key_urls_checked` is true. That
this record was filed anywhere, or that it is the only one these parties signed. Anything about
time: the anchor bounds `agreed_at` from above and this program never sees one.

Two keys signing the same bytes is not two humans agreeing. It is two keys.
