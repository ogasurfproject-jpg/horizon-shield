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
quorum of agreement before it affirms. One reachable source below quorum cannot vouch for a
proof, because a lone source you cannot cross-check is trusted, not verified.

Seam 2, forged versus unverifiable. v2 collapsed two different failures into one bucket: a
height that provably does not exist on the chain, and a height that cannot be checked right
now because the source is down. Both came back not-authentic and both refused the proof,
which punishes an honest prover for an outage. v3 separates them:

  - a structurally impossible height is a bad coordinate. Fail closed, always, even if other
    sources are down. A provable lie does not become truer because a second source is
    unreachable.
  - a height no reachable source can affirm, and none structurally reject, is unverifiable
    now. The honest proof is not refused, but the not-before bound is not established, so it
    is not asserted not-backdated and not current. Named, retryable, never folded into valid.

Fail closed on the adversary, fail open on the outage. The same one rule as everywhere in the
ledger: the coordinate must come from a source the prover does not own, and no single such
source going dark may open or close the gate. The strongest form of the check reads a locally
synced header set and depends on no third-party API at all.

## Discrepancy record (v3.1, pre-anchor correction)

Found by: the founding witness, Federico Blanco Sanchez-Llanos, while porting v3 to his own
two-source production shape, through his independent second-opinion review. Reported to the
operator directly. Reproduced by the operator on the superseded bytes before any change.

Superseded bytes, kept on record (git commit e296dec5 holds them):

    d59c3385c17e3a8212a5df7d36d236479a3c122c45a069d91ae7301477cf532d  freshness_v3.py (v3, superseded)
    f17d3ee5d52f0cc0bb2a85f81be3eb2ef31a043fde18a2366e2e1409118c4a93  freshness_v3_redteam.py (v3, superseded)

The defect. v3 coupled the backdating check to the quorum. On a lone confirming read it set
not_backdated to None along with beacon_authentic, and only a hard False refuses, so a
genuinely backdated proof carrying a real historical block passed as indeterminate whenever
only one source was reachable. Reproduction on the superseded bytes: created_at long before
an authentic beacon, two of three sources down, one confirming; result unverifiable_now,
refused False, time_indeterminate True. A silent pass, the worst kind, because it leaves no
trace.

The correction. The two checks are decoupled. Corroboration (beacon_authentic) still needs a
quorum to affirm. The backdating check (not_backdated) runs against any confirmed read, even
a lone one below quorum, because a single independently fetched source is real data. The
asymmetry is deliberate: one honest witness is enough to refuse, corroboration is required to
vouch. A red-team case, backdated_lone_source, fails on the superseded bytes and passes on
the corrected ones. Residual, named: a lone corrupt source can cause a false refusal. That is
a recoverable fail-closed error, exposed when the other sources return, unlike the silent pass
it replaces.

## Seam 3, the veto, made explicit (v3.2, pre-anchor)

Prompted by the witness porting the tip discriminator to his live system and asking whether
v3 carries the near-tip residual. It does, and v3.2 makes the tip explicit so the residual is
shown and bounded rather than described.

Superseded bytes, kept on record (git commit 538fc75d holds them):

    e8300274a30f1fdf6d289243b2df8a73d6b9f0ef60e5ca94cfa2deb6643640b9  freshness_v3.py (v3.1, superseded)
    307429a92134206377e100dd723b4ce65c454d19e81093b58948218a4d48f701  freshness_v3_redteam.py (v3.1, superseded)

The veto, derived from data. v3.1 modeled a structural rejection as a fixture flag. v3.2
derives it: each source reports its own tip, and a height is structurally impossible, and
vetoes, only if it is malformed or beyond the HIGHEST tip among all reachable sources plus a
margin of six blocks, Bitcoin's own confirmation depth. A height a source lacks, just above
that source's tip (lag) or in a gap below it (fault), is evidence about that source and not
about the chain. It never vetoes; it degrades that source to cannot-confirm.

Why the highest reachable tip and not each source's own. Compared against its own tip, a
source lagging more than the margin behind the chain would veto a real block that another
source has already confirmed, and one honest source ten blocks behind would refuse the
current tip of the chain. One source's tip is never the whole set's tip. Two cases pin it:
stale_source_no_veto (ten behind, two confirm: authentic) and stale_source_lone_confirm (ten
behind, one confirms: unverifiable, not refused). The boundary is pinned exactly at tip plus
six (lag) and tip plus seven (structural) by margin_boundary_exact.

The near-tip residual, carried and bounded. Inside the margin, a fabricated height carrying a
random hash and an honest block no source has indexed yet look identical: both are
unverifiable_now. Nothing can break that tie at that moment, because nothing can confirm a
block that does not exist yet. The chain breaks it. When the height is mined, every honest
source returns the real hash: the fabricated claim mismatches and flips to forged, refused;
the honest claim matches and flips to authentic. The unknown bucket is a waiting room that
empties in the direction the truth points, within the confirmation depth. A forgery can never
be vouched for in the meantime, because no honest source will ever match a random hash, so
quorum stays structurally unreachable for it. advance_chain() models the chain moving, and
two cases test the convergence instead of asserting it: forged_near_tip_converges and
honest_fresh_converges.

Residual, named: with only one reachable tip, "beyond every reachable tip" rests on that one
source, so a stale lone source can cause a false refusal of a real far-ahead block.
Recoverable, exposed when the others return. Same class as the v3.1 residual.

These corrections are applied in place because v3 was pushed but not yet anchored. Once
anchored, any further correction is a new file that cites this one.

## Harness files pinned by this addendum

In fixed order, each with its SHA-256. Clone the repository, take the SHA-256 of each file,
compare it here, and check the time this addendum entered a Bitcoin block. No trust in the
operator is required: fetch the bytes, recompute the hash, check the anchor.

    6ba29b273011e736dece2d9fe4eb2102c18f3355284b30daaf23eba5e895fabb  freshness_v3.py
        time v3.2 implementation: multi-source quorum beacon, forged vs unverifiable split, backdating
        check decoupled from quorum, veto derived from the highest reachable tip plus a six-block margin,
        near-tip residual bounded by chain convergence, real Ed25519
    9e59daa94e668aa69108a001e88d36929cecf68c081ea29f879b6596add2842f  freshness_v3_redteam.py
        the adversary: eighteen checks. one honest witness refuses, a stale source cannot veto, the margin
        boundary is exact, a fabricated near-tip height waits then flips to forged, an honest fresh block
        waits then flips to authentic, honest outage not punished. offline, deterministic.

Run offline and deterministically:

    python3 freshness_v3.py ; python3 freshness_v3_redteam.py

Once this addendum is anchored, the byte sequence of both files above is fixed at that Bitcoin
block height. A later correction is a new addendum that cites this one, never an edit. v3 gets
its own anchor and its own adversarial review before it is treated as current, the same rule
turned on the operator. The witness's review has already run twice and found one defect and
one residual; both records stay here.
