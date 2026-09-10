# The first agreement record: entry 34, with Federico Blanco Sánchez-Llanos

**Date:** 2026-09-10. **Status:** design. Nothing signed, nothing filed, nothing sent.
**Schema:** `a2a-agreement-v1.1` (`ops/AGREEMENT_EXT_v0_1_DRAFT.md`).
**Verifier:** `workers/hs-ledger/nenrin/agreement-v0/agreement_verify.py`.

## 1. Why this one

The record layer needs a first record that is real. Entry 34 is the best candidate available:

- It is about a **fact**, not a promise. Two independent implementations of the NENRIN ring
  builder, one in Python and one in Node.js, reproduced the same eight 2026-08 rings byte for
  byte. Nothing remains to be performed, so nothing can fail to be performed.
- **Both parties already verified it independently**, on 2026-09-05, each pulling the other's
  bytes and recomputing. There is no dispute to settle, which is what a first record wants: the
  thing under test is the record layer, not the claim.
- It is **already anchored**: JIDEC entry 34, claim sha
  `fad6d00a25281102711573b151b321bc13b28c625fe65807c5eb3a12a04e393c`. The agreement record points
  at an anchored fact instead of asserting a new one.
- It has **no money in it**, which is exactly the shape v1.1 had to be fixed to express.

## 2. What building it found

Two holes, neither of which any fixture would have revealed. Both are closed, both are vectors.

1. **An agreement with no price could not be written.** v1.1 demanded `currency` and an amount or
   a fee basis unconditionally. Two peers agreeing about a fact owe each other nothing.
   `terms.consideration` is now `"money"` or `"none"`, REQUIRED, and `"none"` forbids every money
   field rather than leaving a reader to infer the absence from missing keys.
2. **The conduct subject had to be an exact domain match.** Federico's witness record
   `da9289a1117598658d171ca89de03028ca497e54cfe9ad75aaad2f0075d7adff` is about
   `mcp.horizonshield.dev`, while the party is `horizonshield.dev`. The rule as written rejected
   the only conduct record that actually exists between the two of us. The subject may now be the
   counterparty's domain or any host under it.

## 3. The shape, verified

The record below was built with dummy keys and dummy hashes and run through the verifier:
`accepted`, `signatures_checked: true`, no refusals, 2,845 canonical bytes (2,835 before the
host corrections in section 8; re-run after them, same verdict). What matters is the
three findings it carries, which the verifier writes and nobody can suppress:

- `conduct_self_measured` twice. Federico measured the HORIZON SHIELD endpoint himself. HORIZON
  SHIELD would measure his endpoint itself. **Neither conduct record was written by a third
  party**, because in this world no third party has measured either of us yet. Both sides declare
  it, so the record is accepted, and the sentence "each party pinned the counterparty's conduct as
  written by somebody other than the two parties" **disappears from what the record establishes**.
  That is the whole design working: the fact moves what the record proves, not whether it passed.
- `operator_is_a_party`. HORIZON SHIELD runs the intake and is one of the two parties. Declared
  inside the signed bytes, so a reader sees it without trusting a policy page.

Three disclosures on the very first record. That is the honest state of this world today, and the
right response is to publish it, not to wait for a cleaner one.

## 4. Prerequisites, in order

Every one of these is TOshi's hand.

1. **An agreement key for HORIZON SHIELD.** `openssl genpkey -algorithm ed25519`. The private half
   never leaves the Mac and is never named in chat, a file, or memory. The public half goes in the
   record and is served at the key URL.
2. **A key route on the gate.** `https://gate.horizonshield.dev/keys/agreement.json` serving
   `{"public_key_ed25519_b64": "..."}`. Host is under `horizonshield.dev`, which is the party
   domain, so the binding holds. This is a Worker change and a deploy.
3. **A conduct record about `api.babyblueviper.com`**, walked with
   `nenrin/a2a-conduct-walk/a2a_conduct_walk.py`. It does not exist yet. Its sha256 and URL fill
   party A's `conduct_record`, and `measured_by_domain` is `horizonshield.dev` with
   `self_measured: true`.
4. **The agent card sha256 for both sides.** Fetch each card, hash the bytes.
5. **A recent Bitcoin block** for `lower_bound`, from the gate's own coordinate machinery.
6. **Federico serves a key** at `https://babyblueviper.com/keys/agreement.json` and signs. That is
   his decision and the reason for the DM.

Until 1 to 6 exist the record cannot be signed, and until both signatures exist there is nothing
to file. No intake, no ledger entry, no anchor yet.

## 5. The record

```json
{
  "schema": "a2a-agreement-v1.1",
  "agreement_id": "TODO 32 lowercase hex, chosen at random",
  "agreed_at": "TODO YYYY-MM-DDTHH:MM:SSZ",
  "lower_bound": {"kind": "bitcoin_block", "height": 0, "hash": "TODO 64 hex"},
  "parties": [
    {
      "domain": "horizonshield.dev",
      "key_url": "https://gate.horizonshield.dev/keys/agreement.json",
      "public_key_ed25519_b64": "TODO prerequisite 1, generated off this machine",
      "agent_card": "https://mcp.horizonshield.dev/.well-known/agent-card.json",
      "agent_card_sha256": "f36353620147490a954f39862346d37bf7bbf48868a7b9fb5c69f61e16a90d6d",
      "conduct_record": {
        "sha256": "9e058efa16789bb1911eb237a160f7c3bcebc520ba3ee4d74f6d469d02648eb8",
        "url": "TODO once the walk record is filed; filing is a publish and is TOshi's hand",
        "subject_domain": "api.babyblueviper.com",
        "measured_by_domain": "horizonshield.dev",
        "self_measured": true
      },
      "role": "peer"
    },
    {
      "domain": "babyblueviper.com",
      "key_url": "https://api.babyblueviper.com/keys/agreement.json",
      "public_key_ed25519_b64": "TODO prerequisite 6, from Federico, and see section 8",
      "agent_card": "https://api.babyblueviper.com/.well-known/agent-card.json",
      "agent_card_sha256": "d8013f58216c5400108365656eaa7c32fad59985bff1a048bd1bd2a89b3e175d",
      "conduct_record": {
        "sha256": "da9289a1117598658d171ca89de03028ca497e54cfe9ad75aaad2f0075d7adff",
        "url": "https://ledger.horizonshield.dev/witness/da9289a1117598658d171ca89de03028ca497e54cfe9ad75aaad2f0075d7adff",
        "subject_domain": "mcp.horizonshield.dev",
        "measured_by_domain": "babyblueviper.com",
        "self_measured": true
      },
      "role": "peer"
    }
  ],
  "terms": {
    "what": "that two independent implementations of the NENRIN ring builder, one in Python and one in Node.js, reproduced the same eight 2026-08 rings byte for byte, as recorded in JIDEC entry 34",
    "consideration": "none",
    "disclosure_url": "https://ledger.horizonshield.dev/ledger/34"
  },
  "recorder": {"domain": "horizonshield.dev", "is_a_party": true, "fee": {"basis": "none"}},
  "record_paid_by": "neither",
  "establishes": [
    "that both parties signed these bytes at the stated time",
    "that each party named the counterparty's conduct record by sha256 at that moment",
    "that both of them stood behind the entry 34 result on the date they signed"
  ],
  "does_not_establish": [
    "that either party performed any work under this record",
    "that this record is a contract",
    "that money moved, or was ever owed",
    "that the conduct record each side pinned is accurate",
    "that the entry 34 result is correct, only that both parties say they stand behind it",
    "that either implementation is free of defects"
  ],
  "signatures": []
}
```

## 6. Open questions for Federico

These go in the DM, not decided here.

1. Will he serve an Ed25519 public key at a URL under his own domain and sign? The private half
   never leaves his machine and the verifier never fetches anything.
2. Does he object to the three disclosures being on the record, given that they name him as a self
   measurer? The alternative is waiting for a third party measurer, which would mean waiting
   indefinitely.
3. Does the wording of `terms.what` match what he believes he demonstrated? He asked once that his
   surname carry the accent and that citations use a record's own phrasing verbatim; the same care
   applies to a sentence he is about to sign.
4. Break it first. He is the one person who will try the verifier before signing anything, and the
   two holes above are proof that trying to use a thing is what finds its holes.

## 7. What this is not

It is not a contract, not a payment, and not an exchange. Nothing is matched, held, or settled.
When it exists it will be two keys over the same bytes, pointing at an anchored fact and at two
conduct records that both sides admit they wrote themselves.

## 8. What checking the prerequisites found (2026-09-11)

Section 4 was written from the design, not from the network. Four of its six items were
then checked against what the hosts actually serve, and three of the assumptions were
wrong. They are corrected above; what they were is recorded here, because a plan that is
quietly fixed teaches nobody anything.

**`babyblueviper.com` is a Substack publication.** The apex serves a subscription landing
page for "Baby Blue Viper: Enforcement Infrastructure for Capital & Compute". It has no
agent card, and Substack does not let its author serve an arbitrary path, so
`https://babyblueviper.com/keys/agreement.json` cannot exist. Prerequisites 2, 3, 4 and 6
were all written against a host that will never answer them.

**The agent is at `api.babyblueviper.com`.** It was in this repository the whole time,
in `verify-directory/survey/data/lookup_index.json` row 622, from the survey. The card is
served, and declares `invinoveritas-reasoning-agent`, A2A `protocolVersion` 0.3.0,
endpoint `https://api.babyblueviper.com/a2a`, transport JSONRPC.

This is the part worth telling Federico. `api.babyblueviper.com` is a host **under**
`babyblueviper.com`, so the party may still be `babyblueviper.com` while its key URL, its
card and the conduct record's subject all sit on the api host. Yesterday that combination
was three separate refusals. It holds today only because of the two rules his own review
produced: the subject may be the counterparty's domain or any host under it, and a key URL
under the party domain binds without being an exact match. The first record cannot be
built without the fix he asked for. That is not a compliment arranged after the fact; it
is the reason the record has a shape at all.

**His card declares no `capabilities.extensions[]`.** So the walk in prerequisite 3 will
record `conduct_ext_declared` FAIL, `compensation_well_formed` FAIL, and
`extension_echoed` FAIL. Three of five. The card does carry a top-level `compensation`
key, and prose about a 5% platform share settled over Lightning, but not in the
`params.compensation` place section 2 of the conduct extension reads, so the walk cannot
see it and will not pretend to.

That is a fact about the world, and the walk's own doctrine says a FAIL is one observation
and not a verdict. But a mostly-FAIL record about his agent, pinned by sha256 inside the
first agreement he is being asked to co-sign, is a different object socially than it is
technically, and this document will not decide that quietly on his behalf. Two honest
options, and the choice is TOshi's and then his:

- **Walk it and show him the record before asking for a signature.** The FAILs say his
  agent does not implement an extension almost nobody implements. Pinning it says only
  what it says, and `does_not_establish` already carries "that the conduct record each
  side pinned is accurate".
- **Ask him first whether he wants to declare the extension.** It is a few lines in his
  card. Then the walk is run afterwards and the record pins an agent that passes. This
  costs a round trip and risks reading as a condition of the agreement, which it is not.

**Federico has never served a key.** Both of his witness records in this ledger are
unsigned: they carry `witness_name` and `vantage`, and no `signed_domain`. Prerequisite 6
is therefore a genuinely new step for him and not a repeat of something he has already
done. The DM should say so plainly rather than implying it is routine.

**The local Bitcoin headers are stale.** Tip 965850 at 2026-09-06T23:38:48Z, about 530
blocks behind. `lower_bound` on a record signed today must not name that block, so
prerequisite 5 begins with a re-sync.

`ops/agreement_first_record_prep.sh` does prerequisites 3, 4 and 5 in one read-only pass
and prints the values that fill the TODOs above. It must run on the Mac: this session's
container and the bridge VM both have their egress denied and cannot reach any of these
hosts, which is why none of these values are filled in here already.

## 9. The walk was run, and the answer to section 8 is "neither yet" (2026-09-11)

`ops/agreement_first_record_prep.sh` ran on the Mac. Card hashes for both sides are in
`ops/first_record_prep_out/`. The walk of `api.babyblueviper.com` came back **FAIL 1 of 5**,
sha256 `e43f4fad0bcf124953893618489a6f6e01ff9c18d30c8c9ed4affa5bb8a7ab3b`, and reading it
showed that **two of those four failures were faults in the walk, not facts about that
agent**. His endpoint answered `http 402 Payment Required`, which is the correct behaviour
of an agent whose card declares `x402`, four payment methods and pay-per-use pricing; the
walk recorded it in the same bucket as a 500. And `compensation_well_formed` failed on a
declaration this project's own checker calls flawless, because the assertion was gated on
whether the extension was declared and filed a sentence about `capabilities.extensions` as
its evidence.

Both are fixed, with vectors, in `ops/conduct_v1_3_paid_endpoint_20260911.md`. Replayed
against the same card bytes the record is **FAIL 3 of 5**, and the two remaining failures
are the two that are true: he does not declare the conduct extension, so he does not echo
it.

So section 8's two options are both premature. The record to pin is the one produced after
the fix, and the walk has to be re-run on the Mac to produce it against the live endpoint
rather than against saved bytes. Prerequisite 3 is therefore: re-run the walk, read it,
then decide whether to show it to him before asking for a signature.

Prerequisite 5 did not complete. The header sync was called with no mode and wrote a
different window than the reader reads, so the manifest never advanced and the reader said
STALE, which is the failure behaving correctly. Fixed in the same pass.

## 10. The live walk, after the fix (2026-09-10T16:54:37Z)

Re-run against the live endpoint rather than saved bytes. It agrees with the replay
exactly: **FAIL 3 of 5**, sha256
`9e058efa16789bb1911eb237a160f7c3bcebc520ba3ee4d74f6d469d02648eb8`, 6,145 bytes.
`compensation_well_formed` passes and names where it read the declaration,
`measured_endpoint_answered` is `null` with the 402 note, `payment_required_as_declared`
passes, and `does_not_establish` carries the line about not having paid. The two failures
left are the two that are true about that agent.

Both agent card hashes came back bit for bit identical to the run thirteen minutes
earlier, which is not proof of anything but is the small corroboration `card_bytes_stable`
exists to give: his card did not move under us while we were reading it.

Filled above from this run: both `agent_card_sha256` values and party A's
`conduct_record.sha256`. Still open, and each is waiting on a person rather than a
command:

1. **The HORIZON SHIELD agreement key.** `openssl genpkey -algorithm ed25519`, TOshi's
   hand, private half never named anywhere.
2. **Party A's `conduct_record.url`.** The walk record exists but is not filed. Filing is
   a publish, so it is TOshi's hand, and it should follow the decision in section 8 about
   whether Federico sees the record first.
3. ~~**Party B's `conduct_record.url`.**~~ Filled 2026-09-11:
   `https://ledger.horizonshield.dev/witness/<sha>` answers 200 for that record.
   `/record/<sha>` and `/paths/<sha>` both answer 404, so `witness` is the shape, which
   is worth writing down rather than guessing again next time.
4. **`lower_bound`.** The header sync has not completed. The 2026-09-06 attempt refused
   with `below_min_peers` (0 peers finished, 2 required), and the run on 2026-09-11 wrote
   neither a manifest nor a refusal, so it did not reach either. Outbound 8333 is the
   thing to check.
5. **Federico's key and signature.** His hand, and section 8 first.
