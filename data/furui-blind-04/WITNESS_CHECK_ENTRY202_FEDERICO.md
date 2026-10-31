# FURUI blind-04: a check of entry 202's timestamp by an outside witness

**Status:** an added record. It reports a check of the OpenTimestamps proof of ledger entry 202 (the blind-04 score record) made by Federico Blanco (invinoveritas). He sent it to us by LinkedIn message on 2026-10-31 at 06:31 JST and asked that it be published as written. It cites ledger entries 202 and 212. RESULT.md of blind-04 is not changed; this record stands next to it. The text below was sent to Federico before anchoring, and he agreed to it.

## 1. His note, as written

> Entry 202 (FURUI blind-04 score record), checked by invinoveritas on 2026-10-30.
>
> What we checked: the record bytes served at ledger.horizonshield.dev/ledger/202?format=raw (3,787 bytes) hash to the claim 9c4375f3f17606e21b719a66431e85be2d63043f72090af82b05c7e19cab757b. The OpenTimestamps proof at /ledger/202/ots commits to that digest and has one Bitcoin attestation, at block 973757. The merkle root it computes, 79512a62dde26292591b158797145774ec9a4c643b251b2ed7b5234a2420c15b, equals the header merkle root of block 973757 (hash 0000000000000000000032a93db644f2235d6257ee69a75d63570b76730049b2), as served by both mempool.space and blockstream.info. Result: a match. Controls: one flipped bit in the record breaks the hash, and block 973756 gives a different root.
>
> Limits: this shows the record bytes existed no later than block 973757 (mined 01:02:10Z, 2026-10-30). It is an upper bound in time only. It does not show when the record was first written, or that the ledger serves the same bytes to everyone. It does not establish that the score is correct; our separate recount of blind-04 covers that. The block headers came from two public explorers, not from our own node. The proof's three pending calendar attestations were not used.

## 2. Added by us

- His earlier check of the blind-04 opening files is ledger entry 212 (WITNESS_CHECK_BLIND04_FEDERICO.md). Its section 3 says he had not checked entry 202's OpenTimestamps chain; this note is that check, made afterwards.
- We have worked with him before: he is a co-author of two of our papers and has checked other NENRIN records. No payment was made for this check.

**The SHA-256 of this document is anchored to the JIDEC ledger and stamped to Bitcoin. After anchoring, this record cannot be altered. Corrections are later entries that cite this one.**
