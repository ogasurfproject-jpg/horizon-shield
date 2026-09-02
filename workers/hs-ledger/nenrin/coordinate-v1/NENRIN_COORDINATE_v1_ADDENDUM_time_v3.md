# NENRIN coordinate-v1 addendum: time axis v3 (`nenrin-coordinate-v1-addendum-time-v3`)

This addendum cites NENRIN_COORDINATE_SPEC_v1 and supersedes the beacon check of its time
axis. It does not edit v1. A correction is a new file that cites the old, the same rule the
v1 manifest states, applied to the operator rather than carved around it.

Cited, anchored, unchanged:

    5be2b22e339d8b5c45a272325c49da189f10715b01683025ae903e83bf251df5  NENRIN_COORDINATE_SPEC_v1.md

## What v3 changes

freshness_v2 closed backdating with a public beacon and made currency fail-closed. Two seams
stayed open in v2. The cross-build with the founding witness made both concrete on a live
system (a single explorer, mempool.space, on his /verify-proof), so the operator closes them
on its own harness rather than only naming them to someone else.

Seam 1, single source. v2 checked the beacon against one source. One source the prover does
not own is still one point of failure: it can go dark, or lie, and decide the not-before
bound alone. v3 checks the beacon against two or more independent sources and requires a
quorum of agreement. One reachable source below quorum is unverifiable, not authentic,
because a lone source you cannot cross-check is trusted, not verified.

Seam 2, forged versus unverifiable. v2 collapsed two different failures into one bucket: a
height that provably does not exist on the chain, and a height that cannot be checked right
now because the source is down. Both came back not-authentic and both refused the proof,
which punishes an honest prover for an outage. v3 separates them:

  - a height a source affirmatively rejects is a bad coordinate. Fail closed, always, even if
    other sources are down. A provable lie does not become truer because a second source is
    unreachable. (Live: the "no such block" / "impossible height" answer, the 404 / 400 class.)
  - a height no reachable source can affirm, and none reject, is unverifiable now. The honest
    proof is not refused, but the not-before bound is not established, so it is not asserted
    not-backdated and not current. Named, retryable, never folded into valid. (Live: the
    unreachable / rate-limited / blocked answer, the 403 / 429 / 5xx class.)

Fail closed on the adversary, fail open on the outage. The same one rule as everywhere in the
ledger: the coordinate must come from a source the prover does not own, and no single such
source going dark may open or close the gate. The strongest form of the check reads a locally
synced header set and depends on no third-party API at all.

## Harness files pinned by this addendum

In fixed order, each with its SHA-256. Clone the repository, take the SHA-256 of each file,
compare it here, and check the time this addendum entered a Bitcoin block. No trust in the
operator is required: fetch the bytes, recompute the hash, check the anchor.

    d59c3385c17e3a8212a5df7d36d236479a3c122c45a069d91ae7301477cf532d  freshness_v3.py
        time v3 implementation: multi-source quorum beacon, forged vs unverifiable split, real Ed25519
    f17d3ee5d52f0cc0bb2a85f81be3eb2ef31a043fde18a2366e2e1409118c4a93  freshness_v3_redteam.py
        the adversary: forged-during-outage fails closed, lone source below quorum is unverifiable,
        honest total outage is not punished. ten checks, offline, deterministic.

Run offline and deterministically:

    python3 freshness_v3.py ; python3 freshness_v3_redteam.py

Once this addendum is anchored, the byte sequence of both files above is fixed at that Bitcoin
block height. A later correction is a new addendum that cites this one, never an edit. v3 gets
its own anchor and its own adversarial review before it is treated as current, the same rule
turned on the operator.
