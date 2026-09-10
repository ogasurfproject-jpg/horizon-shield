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
`accepted`, `signatures_checked: true`, no refusals, 2,835 canonical bytes. What matters is the
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
3. **A conduct record about `babyblueviper.com`**, walked with
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
      "public_key_ed25519_b64": "TODO",
      "agent_card": "https://mcp.horizonshield.dev/.well-known/agent-card.json",
      "agent_card_sha256": "TODO",
      "conduct_record": {
        "sha256": "TODO the walk of babyblueviper.com",
        "url": "TODO",
        "subject_domain": "babyblueviper.com",
        "measured_by_domain": "horizonshield.dev",
        "self_measured": true
      },
      "role": "peer"
    },
    {
      "domain": "babyblueviper.com",
      "key_url": "https://babyblueviper.com/keys/agreement.json",
      "public_key_ed25519_b64": "TODO from Federico",
      "agent_card": "https://babyblueviper.com/.well-known/agent-card.json",
      "agent_card_sha256": "TODO",
      "conduct_record": {
        "sha256": "da9289a1117598658d171ca89de03028ca497e54cfe9ad75aaad2f0075d7adff",
        "url": "TODO the ledger URL for this witness record",
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
