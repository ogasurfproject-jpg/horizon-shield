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
  independent sources and requires a quorum of agreement, so no single source opening or
  closing decides the verdict. One reachable source below quorum is not enough on its own,
  because a lone source you cannot cross-check is a source you are trusting, not verifying.

  Seam 2, forged vs unverifiable. v2 put two different things in one bucket. A height that
  provably does not exist on the chain, a fabricated or impossible height, and a height that
  cannot be checked right now because the explorer is down, rate limiting, or blocking, both
  came back not-authentic, and both refused the proof. That punishes an honest prover for an
  outage. v3 separates them, the way the witness's own reviewer was forced to:

    - a height a source affirmatively rejects is a bad coordinate. Fail closed, always, even
      if other sources are down. A provable lie does not become truer because a second source
      is unreachable. (Live: an explorer answering "no such block" / "impossible height",
      the 404 / 400 class, means the height itself is bad.)
    - a height no reachable source can affirm, and none reject, is unverifiable now. The
      honest prover is not branded a forger and the proof is not refused. But the not-before
      bound is not established, so it is not asserted not-backdated and not current. Named,
      retryable, never folded into valid. (Live: the 403 / 429 / 5xx / network class means the
      source cannot answer, not that the height is bad.)

Fail closed on the adversary, fail open on the outage. Real Ed25519, deterministic, offline.
A live version reads two or more block explorers (mempool.space and blockstream.info have the
same block-height request shape) or, stronger, a locally synced header set that needs no
third-party API at all. Here the sources are fixture tables and each can answer ok, bad, or
be unreachable, so both seams are exercised without a network.
"""
import json, hashlib
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.exceptions import InvalidSignature

def canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def sha256hex(s):
    return hashlib.sha256(s.encode("utf-8") if isinstance(s, str) else s).hexdigest()

def keypair(seed):
    sk = Ed25519PrivateKey.from_private_bytes(hashlib.sha256(("seed:" + seed).encode()).digest())
    return sk, sk.public_key().public_bytes_raw().hex()

# Several independent sources. Each maps (chain, height) -> one of:
#   {"status": "ok", "value": .., "time": ..}  the source affirms this height, with value/time
#   {"status": "bad"}                          the source affirmatively rejects this height
#                                              (no such / impossible block; live: 404 / 400)
#   key absent from the table                  the source cannot answer right now
#                                              (down / rate limited / blocked; live: 403/429/5xx)
# The prover owns none of these. Agreement across independent sources is the coordinate.
SOURCE_MEMPOOL = {
    ("bitcoin", 800100): {"status": "ok", "value": "0000d4e5f6", "time": 1_779_060_000},
    ("bitcoin", 800200): {"status": "ok", "value": "0000a7b8c9", "time": 1_779_120_000},
    ("bitcoin", -5):        {"status": "bad"},          # impossible height (negative)
    ("bitcoin", 999_999_999): {"status": "bad"},        # far beyond tip, no such block
}
SOURCE_BLOCKSTREAM = {
    ("bitcoin", 800100): {"status": "ok", "value": "0000d4e5f6", "time": 1_779_060_000},
    ("bitcoin", 800200): {"status": "ok", "value": "0000a7b8c9", "time": 1_779_120_000},
    ("bitcoin", -5):        {"status": "bad"},
    ("bitcoin", 999_999_999): {"status": "bad"},
}
SOURCE_LOCALHEADERS = {
    ("bitcoin", 800100): {"status": "ok", "value": "0000d4e5f6", "time": 1_779_060_000},
    ("bitcoin", 800200): {"status": "ok", "value": "0000a7b8c9", "time": 1_779_120_000},
    ("bitcoin", -5):        {"status": "bad"},
    ("bitcoin", 999_999_999): {"status": "bad"},
}
SOURCES = {"mempool": SOURCE_MEMPOOL, "blockstream": SOURCE_BLOCKSTREAM, "localheaders": SOURCE_LOCALHEADERS}
QUORUM = 2   # at least this many independent sources must agree before not-before is affirmed

def classify_beacon(claimed, sources, down=frozenset(), quorum=QUORUM):
    """Combine several independent sources into one beacon verdict.

    down is the set of source names unreachable for this check (simulates an outage). A
    source that is up but has no record for the height is also treated as unable to answer.
    Precedence is deliberate: any affirmative rejection fails closed, then any disagreement
    fails closed, then a quorum of agreement affirms, otherwise unverifiable.
    """
    key = (claimed.get("source"), claimed.get("height"))
    per = {}
    ok_match = 0; ok_mismatch = 0; bad = 0; agreed_time = None
    for name, tbl in sources.items():
        if name in down:
            per[name] = "down"; continue
        rec = tbl.get(key)
        if rec is None:
            per[name] = "unreachable"; continue          # up, but cannot answer this height
        if rec.get("status") == "bad":
            bad += 1; per[name] = "bad"
        elif rec.get("status") == "ok":
            if rec.get("value") == claimed.get("value") and rec.get("time") == claimed.get("time"):
                ok_match += 1; per[name] = "ok_match"; agreed_time = rec.get("time")
            else:
                ok_mismatch += 1; per[name] = "ok_mismatch"
        else:
            per[name] = "unreachable"
    if bad > 0:
        return {"verdict": "bad_coordinate", "per": per, "src_time": None}
    if ok_mismatch > 0:
        return {"verdict": "forged", "per": per, "src_time": None}
    if ok_match >= quorum:
        return {"verdict": "authentic", "per": per, "src_time": agreed_time}
    return {"verdict": "unverifiable_now", "per": per, "src_time": None}

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
    verdict = cls["verdict"]
    out["checks"]["beacon_verdict"] = verdict
    out["disclosures"]["beacon_sources"] = cls["per"]
    out["disclosures"]["quorum_required"] = quorum
    out["disclosures"]["sources_agreeing"] = sum(1 for v in cls["per"].values() if v == "ok_match")

    if verdict == "authentic":
        st = cls["src_time"]
        out["checks"]["beacon_authentic"] = True
        out["checks"]["time_verifiable"] = True
        out["checks"]["not_backdated"] = (ca >= st - clock_skew_s)
        out["disclosures"]["creation_window"] = [st, anchor_block_time]
        out["disclosures"]["window_width_s"] = anchor_block_time - st
    elif verdict in ("forged", "bad_coordinate"):
        out["checks"]["beacon_authentic"] = False
        out["checks"]["time_verifiable"] = True   # we could check, and it provably failed
        out["checks"]["not_backdated"] = False     # a bad coordinate is a provable time lie
        out["disclosures"]["beacon"] = (
            "bad_coordinate: a source affirmatively rejects this height (no such / impossible block). fail closed."
            if verdict == "bad_coordinate" else
            "forged: an affirming source disagrees with the claimed value. fail closed.")
    else:  # unverifiable_now
        out["checks"]["beacon_authentic"] = None
        out["checks"]["time_verifiable"] = False
        out["checks"]["not_backdated"] = None
        out["disclosures"]["beacon"] = (
            "unverifiable_now: no reachable source can affirm this height and none reject it. "
            "not-before not established. the honest proof is not refused, but it is not asserted "
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

    # refused: a hard fail on a provable lie (adversary). fail closed.
    refused = (out["checks"]["not_postdated"] is False
               or verdict in ("forged", "bad_coordinate")
               or (verdict == "authentic" and out["checks"]["not_backdated"] is False))
    out["refused"] = bool(refused)

    # valid as issued: authorship good AND time positively verified in-window. never on a refusal.
    out["valid_as_issued"] = (bool(all(core)) and verdict == "authentic"
                              and out["checks"]["not_backdated"] is True
                              and out["checks"]["not_postdated"] is not False
                              and not out["refused"])

    # time indeterminate: authorship good, nothing provably wrong, but the source is out so the
    # time axis cannot be verified now. the honest prover is not punished, and it is not asserted current.
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

    # honest, all sources up, fresh re-measurement -> valid and current
    ev = make_event(SEED, beacon["time"] + 50, "agent_reported", beacon)
    v = verify_freshness(ev, trusted, anchor, now, cadence_s=86400, last_remeasure_time=now - 100)
    assert v["valid_as_issued"] and v["current_now"], v

    # one explorer down, quorum still met by the other two -> still authentic (outage tolerated)
    v1down = verify_freshness(ev, trusted, anchor, now, down=frozenset(["mempool"]),
                              cadence_s=86400, last_remeasure_time=now - 100)
    assert v1down["checks"]["beacon_verdict"] == "authentic" and v1down["valid_as_issued"], v1down

    # only one source up, below quorum -> unverifiable, honest proof not refused, not current
    only1 = verify_freshness(ev, trusted, anchor, now, down=frozenset(["mempool", "blockstream"]))
    assert only1["checks"]["beacon_verdict"] == "unverifiable_now"
    assert only1["refused"] is False and only1["time_indeterminate"] is True and only1["current_now"] is False, only1

    # forged height that a source affirmatively rejects, other sources down -> fail closed
    forged_beacon = {"source": "bitcoin", "height": -5, "value": "0000dead", "time": beacon["time"]}
    evbad = make_event(SEED, beacon["time"] + 50, "agent_reported", forged_beacon)
    vbad = verify_freshness(evbad, trusted, anchor, now, down=frozenset(["blockstream", "localheaders"]))
    assert vbad["checks"]["beacon_verdict"] == "bad_coordinate" and vbad["refused"] is True, vbad

    # backdated below an authentic beacon -> fail closed
    back = make_event(SEED, 1_700_000_000, "agent_reported", beacon)
    vb = verify_freshness(back, trusted, anchor, now)
    assert vb["checks"]["beacon_verdict"] == "authentic" and vb["checks"]["not_backdated"] is False
    assert vb["refused"] is True and vb["valid_as_issued"] is False, vb

    print("freshness_v3 self_test: PASS")
    print("  honest all-up:", v["valid_as_issued"], "current", v["current_now"])
    print("  one source down (quorum met):", v1down["checks"]["beacon_verdict"], v1down["valid_as_issued"])
    print("  below quorum:", only1["checks"]["beacon_verdict"], "refused", only1["refused"],
          "indeterminate", only1["time_indeterminate"])
    print("  bad coordinate during outage:", vbad["checks"]["beacon_verdict"], "refused", vbad["refused"])
    print("  backdated below beacon: refused", vb["refused"])
    return 0

if __name__ == "__main__":
    import sys
    sys.exit(self_test())
