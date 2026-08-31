# -*- coding: utf-8 -*-
"""
Freshness v2 (nenrin-time-v2): close backdating, make currency fail-closed

time_coordinate_probe (v1) named two things unsolved on the time axis. This file closes
the one that can be closed and makes the one that cannot fail-closed instead of open,
without pretending to close what is physics.

  1  backdating, created_at claimed earlier than reality. v1 could not catch it: a forward
     anchor proves not-newer-than, never not-older-than. v2 closes it with a beacon.

     Bind a recent unpredictable public value into the signed content: a recent Bitcoin
     block hash, or a drand round. The value did not exist before its own reveal time, so
     content that contains it could not have been created before then. A created_at earlier
     than the beacon is therefore a provable lie, refused. With the forward OpenTimestamps
     anchor on the other side, creation is boxed into [beacon_time, anchor_time], both ends
     fixed by events the issuer does not control. The issuer can still choose a created_at
     inside that window, so backdating is bounded to the window width, not eliminated to a
     point. Named. Embed the freshest beacon and anchor promptly and the window closes to
     minutes.

  2  currency, that a valid old proof describes the state NOW. This is not closable by any
     signature or timestamp. It is the reverse of Federico's own line that time can be
     recorded but not purchased: present truth can be observed but not proven from the past.
     What v2 changes is the default. v1 left a valid proof current-forever unless a caller
     opted into a max-age most never set. v2 makes freshness fail-closed: a proof carries a
     re-measurement cadence, and without an anchored re-measurement inside that cadence the
     verdict is stale by default, valid-as-issued but not current. The cadence and the last
     re-measurement are anchored, so freshness too is judged against a clock the prover does
     not own. What stays unprovable, the state in the gap between measurements, is named,
     never folded into current.

Same rule as the whole ledger, on both ends of time: the coordinate comes from a source the
prover does not own. Real Ed25519, deterministic, offline. A live version reads the beacon
from a Bitcoin block and the anchor from OpenTimestamps; here both are a fixture table so
the logic is reproducible without network.
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

# An involuntary public beacon registry. In production these are real: a Bitcoin block
# (height -> hash, time) or a drand round (round -> randomness, time). The verifier checks
# a claimed beacon against this source; a value that does not match is forged.
#   value is unpredictable before time. That is the whole property being used.
BEACON_SOURCE = {
    ("bitcoin", 800000): {"value": "0000a1b2c3", "time": 1_779_000_000},
    ("bitcoin", 800100): {"value": "0000d4e5f6", "time": 1_779_060_000},
    ("bitcoin", 800200): {"value": "0000a7b8c9", "time": 1_779_120_000},
}
def beacon_lookup(source, height):
    return BEACON_SOURCE.get((source, height))

# Event binds pubkey, created_at, and content. content carries the beacon, so the beacon
# is inside the signed id: it cannot be swapped without breaking the signature.
def make_event(seed, created_at, verdict, beacon, kind=30078):
    sk, pub = keypair(seed)
    content = {"verdict": verdict, "beacon": beacon}
    preimage = canon([0, pub, created_at, kind, [], content])
    ev_id = sha256hex(preimage)
    return {"id": ev_id, "pubkey": pub, "created_at": created_at, "kind": kind,
            "content": content, "sig": sk.sign(bytes.fromhex(ev_id)).hex()}

def verify_freshness(ev, trusted_pubkey, anchor_block_time, now,
                     cadence_s=None, last_remeasure_time=None, clock_skew_s=300):
    out = {"checks": {}, "disclosures": {}}

    # integrity + real signature + trusted issuer (unchanged from v1)
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

    # not postdated, against the forward anchor (v1)
    out["checks"]["not_postdated"] = (ca <= anchor_block_time + clock_skew_s)

    # beacon: authenticate it against the involuntary source, then enforce not-before.
    b = ev["content"].get("beacon") or {}
    src = beacon_lookup(b.get("source"), b.get("height"))
    if not src:
        out["checks"]["beacon_authentic"] = False
        out["checks"]["not_backdated"] = None
        out["disclosures"]["beacon"] = "absent or not found in the involuntary source; not-before not established"
    elif src["value"] != b.get("value") or src["time"] != b.get("time"):
        out["checks"]["beacon_authentic"] = False
        out["checks"]["not_backdated"] = None
        out["disclosures"]["beacon"] = "forged: does not match the source at that height"
    else:
        out["checks"]["beacon_authentic"] = True
        # content contains a value that did not exist before src.time, so it cannot have
        # been created before then. A created_at earlier than that is a provable lie.
        out["checks"]["not_backdated"] = (ca >= src["time"] - clock_skew_s)
        out["disclosures"]["creation_window"] = [src["time"], anchor_block_time]
        out["disclosures"]["window_width_s"] = anchor_block_time - src["time"]
        out["disclosures"]["backdating"] = ("bounded to the creation window, not eliminated to a point. "
                                            "the issuer may still choose within it; embed a fresher beacon "
                                            "and anchor promptly to narrow it.")

    # currency, fail-closed. valid-as-issued is separate from current-now.
    if cadence_s is not None and last_remeasure_time is not None:
        fresh = (now - last_remeasure_time) <= cadence_s
        out["checks"]["current"] = fresh
        out["disclosures"]["currency_basis"] = "anchored re-measurement within committed cadence"
    else:
        out["checks"]["current"] = False   # fail-closed: no re-measurement means not current
        out["disclosures"]["currency_basis"] = ("no anchored re-measurement supplied; stale by default. "
                                                "valid-as-issued is not a claim about now.")
    out["disclosures"]["currency_limit"] = ("the state between measurements is not provable from any signature "
                                            "or timestamp. cadence bounds staleness, it does not prove present truth.")

    core = [out["checks"]["id_integrity"], out["checks"]["signature_valid"], out["checks"]["issued_by_trusted"]]
    time_ok = (out["checks"]["not_postdated"] is not False
               and out["checks"].get("beacon_authentic") is True
               and out["checks"]["not_backdated"] is True)
    out["valid_as_issued"] = bool(all(core)) and time_ok
    out["current_now"] = out["valid_as_issued"] and (out["checks"]["current"] is True)
    out["record_sha256"] = sha256hex(canon({k: v for k, v in out.items() if k != "record_sha256"}))
    return out

def self_test():
    SEED = "invinoveritas"
    _, trusted = keypair(SEED)
    beacon = {"source": "bitcoin", "height": 800100, "value": "0000d4e5f6", "time": 1_779_060_000}
    anchor = 1_779_120_000     # a later block time (forward anchor)
    now = anchor + 1000

    # honest: created_at inside [beacon.time, anchor], fresh re-measurement present.
    ev = make_event(SEED, beacon["time"] + 50, "agent_reported", beacon)
    v = verify_freshness(ev, trusted, anchor, now, cadence_s=86400, last_remeasure_time=now - 100)
    assert v["valid_as_issued"] and v["current_now"], v

    # backdated below the beacon: content contains a value from block 800100, but claims a
    # created_at before that block existed. Provable lie.
    back = make_event(SEED, 1_700_000_000, "agent_reported", beacon)
    vb = verify_freshness(back, trusted, anchor, now, cadence_s=86400, last_remeasure_time=now - 100)
    assert vb["checks"]["beacon_authentic"] is True and vb["checks"]["not_backdated"] is False
    assert vb["valid_as_issued"] is False, vb

    # no re-measurement: valid as issued, but fail-closed on currency.
    stale = verify_freshness(ev, trusted, anchor, now)
    assert stale["valid_as_issued"] is True and stale["current_now"] is False

    print("freshness_v2 self_test: PASS")
    print("  honest:", v["valid_as_issued"], "current", v["current_now"],
          "| window", v["disclosures"]["creation_window"], "width_s", v["disclosures"]["window_width_s"])
    print("  backdated-below-beacon:", vb["valid_as_issued"], "(not_backdated", vb["checks"]["not_backdated"], ")")
    print("  no re-measurement -> current_now:", stale["current_now"], "(fail-closed)")
    return 0

if __name__ == "__main__":
    import sys
    sys.exit(self_test())
