# -*- coding: utf-8 -*-
"""
Freshness v3 (nenrin-time-v3): multi-source beacon, and forged vs unverifiable split

v2 closed backdating with a beacon and made currency fail-closed. Two seams stayed open in
v2, and the cross-build with the founding witness made both concrete, so the operator closes
them on its own harness rather than only naming them to someone else. v3 cites v2 and
supersedes its beacon check. It does not edit v2. A correction is a new file that cites the
old, the manifest rule applied to the operator, not an exception carved for it.

  Seam 1, single source. v2 checked the beacon against one source. A single explorer going
  dark, or lying, decided the not-before bound alone. The rule under everything is the same:
  the coordinate must come from a source the prover does not own, and one source the prover
  does not own is still one point of failure. v3 checks the beacon against several
  independent sources and requires a quorum of agreement before it AFFIRMS. One reachable
  source below quorum cannot vouch for a proof, because a lone source you cannot cross-check
  is trusted, not verified.

  Seam 2, forged vs unverifiable. v2 put two different things in one bucket. A height that
  provably does not exist on the chain, and a height that cannot be checked right now because
  the explorer is down, rate limiting, or blocking, both came back not-authentic, and both
  refused the proof. That punishes an honest prover for an outage. v3 separates them:
    - a structurally impossible height is a bad coordinate. Fail closed, always, even if
      other sources are down. A provable lie does not become truer because a second source
      is unreachable.
    - a height no reachable source can affirm, and none structurally reject, is unverifiable
      now. The honest prover is not branded a forger and the proof is not refused. But the
      not-before bound is not established, so it is not asserted not-backdated and not
      current. Named, retryable, never folded into valid.

Correction v3.1, pre-anchor, found by the founding witness's review (recorded in the addendum
with the superseded sha). v3 coupled the backdating check to the quorum, so a backdated proof
carrying a real block passed as indeterminate whenever only one source was reachable.
Reproduced on the old bytes, then decoupled: corroboration (beacon_authentic) still needs a
quorum to affirm; the backdating check (not_backdated) runs against ANY confirmed read, even
a lone one, because a single independently fetched source is real data. One honest witness is
enough to refuse, corroboration is required to vouch. Residual named: a lone corrupt source
can cause a false refusal, a recoverable fail-closed error exposed when the others return.

v3.2, the tip made explicit (prompted by the witness porting the tip discriminator live and
asking whether v3 carries the near-tip residual):

  Seam 3, the veto, now derived from data rather than a fixture flag. Each source reports its
  own tip. A height is STRUCTURALLY impossible, and vetoes, only if it is malformed (negative,
  not an integer) or beyond the HIGHEST tip among all reachable sources plus a margin of
  MARGIN_BLOCKS (6, Bitcoin's own confirmation depth). It is compared against the highest
  reachable tip, not against each source's own tip, on purpose: a source lagging more than the
  margin behind the chain would otherwise veto a real block that another source has already
  confirmed. One source's tip is never the whole set's tip. A height a source lacks, whether
  just above that source's tip (lag) or in a gap below it (fault), is evidence about that
  source and not about the chain, and never vetoes; it degrades that source to cannot-confirm.

  The near-tip residual, carried and bounded. Inside the margin, a fabricated height with a
  random hash and an honest block that no source has indexed yet look identical: both are
  unverifiable_now. Nothing can break that tie at that moment, because nothing can confirm a
  block that does not exist yet. What breaks it is the chain advancing. When the height is
  actually mined, every honest source returns the real hash: the fabricated claim mismatches
  and flips to forged, refused; the honest claim matches and flips to authentic. The unknown
  bucket is a waiting room that empties in the direction the truth points, within the
  confirmation depth. A forgery can never be vouched for in the meantime, because no honest
  source will ever match a random hash, so quorum stays structurally unreachable for it.
  advance_chain() models the chain moving so the convergence is tested, not asserted.

  Residual named: with only one reachable tip, "beyond every reachable tip" rests on that one
  source; a stale lone source can cause a false refusal of a real far-ahead block. Recoverable,
  exposed when the others return. Same class as the v3.1 residual.

Fail closed on the adversary, fail open on the outage, refuse on one honest witness, vouch
only on corroboration, and let the chain settle what no source can. Real Ed25519,
deterministic, offline. A live version reads two or more block explorers (mempool.space and
blockstream.info share the block-height and tip-height request shapes) or, stronger, a
locally synced header set that needs no third-party API at all.
"""
import json, hashlib, copy
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.exceptions import InvalidSignature

def canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def sha256hex(s):
    return hashlib.sha256(s.encode("utf-8") if isinstance(s, str) else s).hexdigest()

def keypair(seed):
    sk = Ed25519PrivateKey.from_private_bytes(hashlib.sha256(("seed:" + seed).encode()).digest())
    return sk, sk.public_key().public_bytes_raw().hex()

MARGIN_BLOCKS = 6   # Bitcoin's own confirmation depth. within it, unindexed is lag, not impossible.

# Several independent sources. Each reports the chain it follows, its own tip, and the blocks
# it has indexed. The prover owns none of these. A block a source lacks is that source's lag or
# fault, never a veto. Only malformed, or beyond the highest reachable tip plus margin, vetoes.
SOURCE_MEMPOOL = {"chain": "bitcoin", "tip": 800200, "blocks": {
    800100: {"value": "0000d4e5f6", "time": 1_779_060_000},
    800200: {"value": "0000a7b8c9", "time": 1_779_120_000},
}}
SOURCE_BLOCKSTREAM = {"chain": "bitcoin", "tip": 800200, "blocks": {
    800100: {"value": "0000d4e5f6", "time": 1_779_060_000},
    800200: {"value": "0000a7b8c9", "time": 1_779_120_000},
}}
SOURCE_LOCALHEADERS = {"chain": "bitcoin", "tip": 800200, "blocks": {
    800100: {"value": "0000d4e5f6", "time": 1_779_060_000},
    800200: {"value": "0000a7b8c9", "time": 1_779_120_000},
}}
SOURCES = {"mempool": SOURCE_MEMPOOL, "blockstream": SOURCE_BLOCKSTREAM, "localheaders": SOURCE_LOCALHEADERS}
QUORUM = 2   # at least this many independent sources must agree before not-before is AFFIRMED

def advance_chain(sources, height, value, time):
    """Model the chain moving: every source indexes the real block at height and its tip rises.
    Returns a deep copy; fixtures are never mutated. Used to test convergence, not assert it."""
    out = copy.deepcopy(sources)
    for src in out.values():
        src["blocks"][height] = {"value": value, "time": time}
        src["tip"] = max(src["tip"], height)
    return out

def classify_beacon(claimed, sources, down=frozenset(), quorum=QUORUM, margin=MARGIN_BLOCKS):
    """Combine several independent sources into one beacon verdict.

    Precedence is deliberate: malformed fails closed; beyond the highest reachable tip plus
    margin fails closed; any disagreement fails closed; a quorum of agreement affirms;
    otherwise unverifiable. confirmed_time is returned from ANY matching read, even a lone
    one below quorum, so the backdating check can still run against real data (v3.1).
    """
    chain = claimed.get("source"); h = claimed.get("height")
    per = {}; tips = []
    for name, src in sources.items():
        if name in down:
            per[name] = "down"; continue
        if src.get("chain") != chain:
            per[name] = "unreachable"; continue
        tips.append(src["tip"])
    base = {"per": per, "confirmed_time": None, "ok_match": 0, "max_tip": (max(tips) if tips else None),
            "margin": margin, "structural_reason": None}

    if isinstance(h, bool) or not isinstance(h, int) or h < 0:
        base["structural_reason"] = "malformed height"
        return dict(base, verdict="bad_coordinate")
    if not tips:
        return dict(base, verdict="unverifiable_now")        # nothing reachable: cannot judge structure
    if h > base["max_tip"] + margin:
        base["structural_reason"] = "beyond the highest reachable tip plus margin"
        return dict(base, verdict="bad_coordinate")

    ok_match = 0; ok_mismatch = 0; confirmed_time = None
    for name, src in sources.items():
        if per.get(name) in ("down", "unreachable"):
            continue
        rec = src["blocks"].get(h)
        if rec is None:
            per[name] = "lag" if h > src["tip"] else "unreachable"   # not indexed yet, or a gap. no veto.
            continue
        if rec.get("value") == claimed.get("value") and rec.get("time") == claimed.get("time"):
            ok_match += 1; per[name] = "ok_match"; confirmed_time = rec.get("time")
        else:
            ok_mismatch += 1; per[name] = "ok_mismatch"
    base.update(confirmed_time=confirmed_time, ok_match=ok_match)
    if ok_mismatch > 0:
        return dict(base, verdict="forged")
    if ok_match >= quorum:
        return dict(base, verdict="authentic")
    return dict(base, verdict="unverifiable_now")

def make_event(seed, created_at, verdict, beacon, kind=30078):
    sk, pub = keypair(seed)
    content = {"verdict": verdict, "beacon": beacon}
    preimage = canon([0, pub, created_at, kind, [], content])
    ev_id = sha256hex(preimage)
    return {"id": ev_id, "pubkey": pub, "created_at": created_at, "kind": kind,
            "content": content, "sig": sk.sign(bytes.fromhex(ev_id)).hex()}

def verify_freshness(ev, trusted_pubkey, anchor_block_time, now, sources=None, down=frozenset(),
                     quorum=QUORUM, cadence_s=None, last_remeasure_time=None, clock_skew_s=300):
    if sources is None:
        sources = SOURCES
    out = {"checks": {}, "disclosures": {}}

    # integrity + real signature + trusted issuer (unchanged from v2)
    recomputed = sha256hex(canon([0, ev["pubkey"], ev["created_at"], ev["kind"], [], ev["content"]]))
    out["checks"]["id_integrity"] = (recomputed == ev["id"])
    try:
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(ev["pubkey"])).verify(
            bytes.fromhex(ev["sig"]), bytes.fromhex(ev["id"]))
        sig_ok = True
    except (InvalidSignature, ValueError):
        sig_ok = False
    out["checks"]["signature_valid"] = sig_ok
    out["checks"]["issued_by_trusted"] = (ev["pubkey"] == trusted_pubkey)

    ca = ev["created_at"]
    out["checks"]["not_postdated"] = (ca <= anchor_block_time + clock_skew_s)

    # multi-source beacon
    b = ev["content"].get("beacon") or {}
    cls = classify_beacon(b, sources, down, quorum)
    verdict = cls["verdict"]; ct = cls["confirmed_time"]
    out["checks"]["beacon_verdict"] = verdict
    out["disclosures"]["beacon_sources"] = cls["per"]
    out["disclosures"]["quorum_required"] = quorum
    out["disclosures"]["sources_agreeing"] = cls["ok_match"]
    out["disclosures"]["highest_reachable_tip"] = cls["max_tip"]
    out["disclosures"]["margin_blocks"] = cls["margin"]

    if verdict == "authentic":
        out["checks"]["beacon_authentic"] = True
        out["checks"]["time_verifiable"] = True
        out["checks"]["not_backdated"] = (ca >= ct - clock_skew_s)
        out["disclosures"]["creation_window"] = [ct, anchor_block_time]
        out["disclosures"]["window_width_s"] = anchor_block_time - ct
    elif verdict in ("forged", "bad_coordinate"):
        out["checks"]["beacon_authentic"] = False
        out["checks"]["time_verifiable"] = True   # we could check, and it provably failed
        out["checks"]["not_backdated"] = False     # a bad coordinate is a provable time lie
        out["disclosures"]["beacon"] = (
            "bad_coordinate (%s): structurally impossible. fail closed regardless of outages." % cls["structural_reason"]
            if verdict == "bad_coordinate" else
            "forged: an affirming source disagrees with the claimed value. fail closed.")
    else:  # unverifiable_now: cannot AFFIRM. but if one real read exists, backdating is still checked.
        out["checks"]["beacon_authentic"] = None
        out["checks"]["time_verifiable"] = False
        if ct is not None:
            # DECOUPLED (v3.1): a lone confirmed read is real data. it cannot vouch, but it can refuse.
            out["checks"]["not_backdated"] = (ca >= ct - clock_skew_s)
            out["disclosures"]["beacon"] = (
                "unverifiable_now: only one source confirms this height, below quorum, so the proof is not "
                "affirmed. the backdating check still ran against that confirmed read; a created_at before "
                "it is refused. residual: a lone corrupt source could cause a false refusal, recoverable and "
                "exposed when other sources return.")
        else:
            out["checks"]["not_backdated"] = None
            h = b.get("height"); mt = cls["max_tip"]
            if isinstance(h, int) and mt is not None and h > mt:
                out["disclosures"]["beacon"] = (
                    "unverifiable_now, near tip: no source has indexed this height yet and it is within the "
                    "margin above the highest reachable tip. an honest fresh block and a fabricated height look "
                    "the same here. not refused, not affirmed. the chain settles it: when the height is mined, "
                    "a fabricated hash mismatches and flips to forged, an honest one matches and flips to "
                    "authentic. re-check after confirmation depth.")
            else:
                out["disclosures"]["beacon"] = (
                    "unverifiable_now: no reachable source can affirm this height and none structurally reject "
                    "it. not-before not established. the honest proof is not refused, but it is not asserted "
                    "not-backdated and not current. retry when a quorum of sources returns.")

    # currency, fail-closed (unchanged from v2)
    if cadence_s is not None and last_remeasure_time is not None:
        out["checks"]["current"] = ((now - last_remeasure_time) <= cadence_s)
        out["disclosures"]["currency_basis"] = "anchored re-measurement within committed cadence"
    else:
        out["checks"]["current"] = False
        out["disclosures"]["currency_basis"] = ("no anchored re-measurement supplied; stale by default. "
                                                "valid-as-issued is not a claim about now.")
    out["disclosures"]["currency_limit"] = ("the state between measurements is not provable from any signature "
                                            "or timestamp. cadence bounds staleness, it does not prove present truth.")

    core = [out["checks"]["id_integrity"], out["checks"]["signature_valid"], out["checks"]["issued_by_trusted"]]

    # refused: a hard fail on a provable lie (adversary). fail closed. any hard False on not_backdated
    # refuses, whether the beacon was corroborated or read from a lone source (v3.1).
    refused = (out["checks"]["not_postdated"] is False
               or verdict in ("forged", "bad_coordinate")
               or out["checks"]["not_backdated"] is False)
    out["refused"] = bool(refused)

    # valid as issued: authorship good AND time positively verified in-window by a QUORUM. never on a refusal.
    out["valid_as_issued"] = (bool(all(core)) and verdict == "authentic"
                              and out["checks"]["not_backdated"] is True
                              and out["checks"]["not_postdated"] is not False
                              and not out["refused"])

    # time indeterminate: authorship good, nothing provably wrong, but corroboration is out (or the block is
    # not yet indexed) so the time axis cannot be affirmed now. not punished, not asserted current.
    out["time_indeterminate"] = (bool(all(core)) and verdict == "unverifiable_now" and not out["refused"])

    out["current_now"] = bool(out["valid_as_issued"] and out["checks"]["current"] is True)
    out["record_sha256"] = sha256hex(canon({k: v for k, v in out.items() if k != "record_sha256"}))
    return out

def self_test():
    SEED = "invinoveritas"
    _, trusted = keypair(SEED)
    beacon = {"source": "bitcoin", "height": 800100, "value": "0000d4e5f6", "time": 1_779_060_000}
    anchor = 1_779_120_000
    now = anchor + 1000

    ev = make_event(SEED, beacon["time"] + 50, "agent_reported", beacon)
    v = verify_freshness(ev, trusted, anchor, now, cadence_s=86400, last_remeasure_time=now - 100)
    assert v["valid_as_issued"] and v["current_now"], v

    v1down = verify_freshness(ev, trusted, anchor, now, down=frozenset(["mempool"]),
                              cadence_s=86400, last_remeasure_time=now - 100)
    assert v1down["checks"]["beacon_verdict"] == "authentic" and v1down["valid_as_issued"], v1down

    only1 = verify_freshness(ev, trusted, anchor, now, down=frozenset(["mempool", "blockstream"]))
    assert only1["checks"]["beacon_verdict"] == "unverifiable_now"
    assert only1["refused"] is False and only1["time_indeterminate"] is True and only1["current_now"] is False, only1

    back1 = make_event(SEED, 1_700_000_000, "agent_reported", beacon)
    vb1 = verify_freshness(back1, trusted, anchor, now, down=frozenset(["mempool", "blockstream"]))
    assert vb1["checks"]["not_backdated"] is False and vb1["refused"] is True, vb1

    evbad = make_event(SEED, beacon["time"] + 50, "agent_reported",
                       {"source": "bitcoin", "height": -5, "value": "0000dead", "time": beacon["time"]})
    vbad = verify_freshness(evbad, trusted, anchor, now, down=frozenset(["blockstream", "localheaders"]))
    assert vbad["checks"]["beacon_verdict"] == "bad_coordinate" and vbad["refused"] is True, vbad

    # v3.2 convergence: a fabricated near-tip height waits, then flips to forged when the chain arrives.
    fake = {"source": "bitcoin", "height": 800203, "value": "deadbeef00", "time": 1_779_121_800}
    evf = make_event(SEED, fake["time"] + 50, "agent_reported", fake)
    late_anchor = fake["time"] + 3600
    before = verify_freshness(evf, trusted, late_anchor, late_anchor + 1000)
    assert before["checks"]["beacon_verdict"] == "unverifiable_now" and before["refused"] is False, before
    after = verify_freshness(evf, trusted, late_anchor, late_anchor + 1000,
                             sources=advance_chain(SOURCES, 800203, "0000c0ffee", 1_779_121_800))
    assert after["checks"]["beacon_verdict"] == "forged" and after["refused"] is True, after

    print("freshness_v3 self_test: PASS")
    print("  honest all-up:", v["valid_as_issued"], "current", v["current_now"])
    print("  one source down (quorum met):", v1down["checks"]["beacon_verdict"], v1down["valid_as_issued"])
    print("  below quorum, honest:", only1["checks"]["beacon_verdict"], "refused", only1["refused"])
    print("  below quorum, BACKDATED (v3.1):", vb1["checks"]["beacon_verdict"], "refused", vb1["refused"])
    print("  malformed during outage:", vbad["checks"]["beacon_verdict"], "refused", vbad["refused"])
    print("  fabricated near tip (v3.2): before", before["checks"]["beacon_verdict"], "refused", before["refused"],
          "| after chain advances", after["checks"]["beacon_verdict"], "refused", after["refused"])
    return 0

if __name__ == "__main__":
    import sys
    sys.exit(self_test())
