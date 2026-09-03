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

  - a height a source structurally rejects is a bad coordinate. Fail closed, always, even if
    other sources are down. A provable lie does not become truer because a second source is
    unreachable.
  - a height no reachable source can affirm, and none reject, is unverifiable now. The honest
    proof is not refused, but the not-before bound is not established, so it is not asserted
    not-backdated and not current. Named, retryable, never folded into valid.

Fail closed on the adversary, fail open on the outage. The same one rule as everywhere in the
ledger: the coordinate must come from a source the prover does not own, and no single such
source going dark may open or close the gate. The strongest form of the check reads a locally
synced header set and depends on no third-party API at all.

## Discrepancy record (v3.1, pre-anchor correction)

Found by: the founding witness, Federico Blanco Sanchez-Llanos, while porting v3 to his own
two-source production shape, through his independent second-opinion review. Reported to the
operator directly. Reproduced by the operator on the superseded bytes before any change.

Superseded bytes, kept on record (git commit e296dec5 holds them):

    d59c3385c17e3a8212a5df7d36d236479a3c122c45a069d91ae7301477cf532d  freshness_v3.py (superseded)
    f17d3ee5d52f0cc0bb2a85f81be3eb2ef31a043fde18a2366e2e1409118c4a93  freshness_v3_redteam.py (superseded)

The defect. v3 coupled the backdating check to the quorum. On a lone confirming read it set
not_backdated to None along with beacon_authentic, and only a hard False refuses, so a
genuinely backdated proof carrying a real historical block passed as indeterminate whenever
only one source was reachable. Reproduction on the superseded bytes: a proof with created_at
long before an authentic beacon, two of three sources down, one confirming; result
unverifiable_now, refused False, time_indeterminate True. A silent pass, the worst kind,
because it leaves no trace.

The correction. The two checks are decoupled. Corroboration (beacon_authentic) still needs a
quorum to affirm. The backdating check (not_backdated) runs against any confirmed read, even
a lone one below quorum, because a single independently fetched source is real data. The
asymmetry is deliberate: one honest witness is enough to refuse, corroboration is required to
vouch. A red-team case, backdated_lone_source, fails on the superseded bytes and passes on
the corrected ones. Residual, named: a lone corrupt source can cause a false refusal. That is
a recoverable fail-closed error, exposed when the other sources return, unlike the silent pass
it replaces.

This correction is applied in place because v3 was pushed but not yet anchored. Once anchored,
any further correction is a new file that cites this one.

## Seam 3, the veto (named by the witness, bounded here)

One source structurally rejecting a height beats two sources agreeing on it. That is
deliberate and right for the adversarial case, because two sources agreeing on a value for
an impossible height means both are wrong or compromised, and the honest reject is the only
defense. But it holds only when the reject is structural: the height is malformed, or beyond
the tip of every reachable source. A plain not-found from a source whose own tip is at or
past the claimed height is lag or fault, evidence about that source and not about the chain,
and it must not veto; it degrades that source to cannot-confirm.

Live mapping: compare the claimed height to each source's reported tip. Beyond every tip, or
malformed, is a structural reject. Not found below a source's own tip is that source lagging.
The harness models a structural reject as status bad with reason impossible, and a lagging
source as simply lacking the height. Two red-team cases pin both sides:
structural_veto_beats_majority (refused) and lagging_source_no_veto (authentic). The veto is
kept where it is right and removed where it would deny a corroborated claim over one source's
lag.

## Harness files pinned by this addendum

In fixed order, each with its SHA-256. Clone the repository, take the SHA-256 of each file,
compare it here, and check the time this addendum entered a Bitcoin block. No trust in the
operator is required: fetch the bytes, recompute the hash, check the anchor.

    e8300274a30f1fdf6d289243b2df8a73d6b9f0ef60e5ca94cfa2deb6643640b9  freshness_v3.py
        time v3.1 implementation: multi-source quorum beacon, forged vs unverifiable split, backdating
        check decoupled from quorum, structural veto bounded by liveness, real Ed25519
    307429a92134206377e100dd723b4ce65c454d19e81093b58948218a4d48f701  freshness_v3_redteam.py
        the adversary: thirteen checks. forged-during-outage fails closed, lone source cannot vouch but
        can refuse (backdated_lone_source), structural veto beats majority, lagging source does not veto,
        honest total outage is not punished. offline, deterministic.

Run offline and deterministically:

    python3 freshness_v3.py ; python3 freshness_v3_redteam.py

Once this addendum is anchored, the byte sequence of both files above is fixed at that Bitcoin
block height. A later correction is a new addendum that cites this one, never an edit. v3 gets
its own anchor and its own adversarial review before it is treated as current, the same rule
turned on the operator. The witness's review already ran once and found a defect; that record
stays here.
