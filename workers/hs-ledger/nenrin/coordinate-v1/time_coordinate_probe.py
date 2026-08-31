# -*- coding: utf-8 -*-
"""
Time Coordinate Integrity, the created_at probe (nenrin-time-v1)

This is the probe I promised Federico Blanco Sanchez-Llanos in the DM, built rather than
asserted, and pointed at the one class he named as still open on his signed-judgment
verifier: freshness.

His design is strong where mine was weak. A Nostr kind-30078 event binds the signed id
to pubkey and created_at, not to content alone, so a fresh keypair signing valid math
over identical content still fails the issued_by check. That closes authorship, the hole
my unkeyed sha256 could not close. This probe does not attack that. It confirms it, and
then presses the seam next to it.

The seam. created_at is bound, so no third party can change it after signing. But the
ISSUER chooses it at signing time. Binding stops tampering. It does not stop the issuer
choosing a false time. So created_at is one more coordinate the prover controls, on the
time axis, and the same rule applies as everywhere else in this ledger:

    the coordinate a verdict trusts must come from a source the prover does not own.

For time that source already exists here: the OpenTimestamps / Bitcoin anchor NENRIN
uses. Bitcoin block height is a clock no issuer controls. It gives, precisely:

  - not from the future. A created_at later than the anchor's block time is refused.
    Structural, because the issuer cannot make Bitcoin stamp a future block.
  - a lower bound on age. The bytes provably existed at or before the anchored block.

And, said honestly rather than dressed up, what an anchor and a signature together still
cannot give:

  - not older than claimed. A forward anchor proves not-newer-than, never not-older-than.
    Backdating created_at to earlier than reality is not caught by anchoring alone. Named.
  - currency. That a valid old proof describes the state NOW is not a property of any
    signature or any timestamp. Only re-measurement addresses it, the NENRIN ring / the
    daily sweep. A verifier must return valid, issued at T, and NOT current-by-itself.

This file models the event with real Ed25519 so the authorship result is real, not a
toy, then tests the time axis. Deterministic, offline. When Federico shares
verifier_attack_harness.py these vectors point at his real /verify-proof unchanged in
shape.
"""
import json, hashlib
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.exceptions import InvalidSignature

def canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def sha256hex(s):
    if isinstance(s, str):
        s = s.encode("utf-8")
    return hashlib.sha256(s).hexdigest()

# Deterministic keypairs from a seed, so runs reproduce.
def keypair(seed):
    sk = Ed25519PrivateKey.from_private_bytes(hashlib.sha256(("seed:" + seed).encode()).digest())
    pk = sk.public_key()
    pub_hex = pk.public_bytes_raw().hex()
    return sk, pub_hex

# A Nostr-shaped signed judgment. id binds pubkey + created_at + kind + tags + content.
def make_event(seed, created_at, content, kind=30078, tags=None):
    sk, pub = keypair(seed)
    preimage = canon([0, pub, created_at, kind, tags or [], content])
    ev_id = sha256hex(preimage)
    sig = sk.sign(bytes.fromhex(ev_id)).hex()
    return {"id": ev_id, "pubkey": pub, "created_at": created_at, "kind": kind,
            "tags": tags or [], "content": content, "sig": sig}

# The verifier. anchor_block_time is an involuntary clock (Bitcoin via OpenTimestamps);
# max_age_s, if set, is the caller's own currency requirement. clock_skew_s tolerates
# honest clock drift. issued_by is the pubkey the caller trusts as the issuer.
def verify_event(ev, trusted_pubkey, anchor_block_time=None, now=None,
                 max_age_s=None, clock_skew_s=300):
    out = {"checks": {}, "disclosures": {}}

    # id_integrity: recompute the id from the fields. Catches any post-signing tamper,
    # including a changed created_at, because created_at is in the preimage.
    recomputed = sha256hex(canon([0, ev["pubkey"], ev["created_at"], ev["kind"], ev["tags"], ev["content"]]))
    out["checks"]["id_integrity"] = (recomputed == ev["id"])

    # signature_valid: the pubkey in the event signed this id. Real Ed25519.
    try:
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(ev["pubkey"])).verify(
            bytes.fromhex(ev["sig"]), bytes.fromhex(ev["id"]))
        sig_ok = True
    except (InvalidSignature, ValueError):
        sig_ok = False
    out["checks"]["signature_valid"] = sig_ok

    # issued_by: the signer is the trusted issuer, not merely some valid signer. This is
    # Federico's authorship result: an impostor's own valid signature is not enough.
    out["checks"]["issued_by_trusted"] = (ev["pubkey"] == trusted_pubkey)

    # time coordinate integrity. Everything above can be true and the time still be a lie.
    ca = ev["created_at"]

    # not from the future, against an involuntary clock. If an anchor is present, use it,
    # because the issuer cannot make Bitcoin stamp a future block. Fall back to the
    # caller's own clock only, and say which was used.
    if anchor_block_time is not None:
        out["checks"]["not_postdated"] = (ca <= anchor_block_time + clock_skew_s)
        out["disclosures"]["time_source"] = "bitcoin_anchor_block_time"
    elif now is not None:
        out["checks"]["not_postdated"] = (ca <= now + clock_skew_s)
        out["disclosures"]["time_source"] = "verifier_local_clock (no involuntary anchor; weaker)"
    else:
        out["checks"]["not_postdated"] = None
        out["disclosures"]["time_source"] = "none supplied; postdating not checked"

    # lower bound on age from the anchor. Present only if anchored.
    if anchor_block_time is not None:
        out["disclosures"]["age_lower_bound_s"] = max(0, (now if now is not None else anchor_block_time) - anchor_block_time)
        out["disclosures"]["anchored_not_after_block_time"] = anchor_block_time

    # backdating: named, not claimed solved. A forward anchor cannot catch a created_at
    # earlier than reality.
    out["disclosures"]["backdating"] = ("not detectable from a forward anchor alone. created_at earlier "
                                        "than reality is not refuted by not-newer-than evidence. named, not solved.")

    # currency: valid is not current. Only re-measurement (a NENRIN ring / the sweep) speaks
    # to now. If the caller set max_age, report it, but flag that age bounds issuance, not truth.
    out["disclosures"]["currency"] = ("valid means issued by the trusted key at created_at. it is NOT a "
                                      "statement about the current state. currency needs re-measurement, "
                                      "not a signature.")
    if max_age_s is not None and now is not None and anchor_block_time is not None:
        fresh = (now - anchor_block_time) <= max_age_s
        out["checks"]["within_caller_max_age"] = fresh

    # overall: valid requires integrity, a real signature, the trusted issuer, and not being
    # postdated against whatever clock was supplied. Currency is never folded into valid.
    core = [out["checks"]["id_integrity"], out["checks"]["signature_valid"], out["checks"]["issued_by_trusted"]]
    postdate = out["checks"]["not_postdated"]
    out["valid"] = bool(all(core)) and (postdate is not False)
    if postdate is None:
        out["disclosures"]["warning"] = "no clock supplied, so postdating was not checked; valid does not cover freshness"
    out["record_sha256"] = sha256hex(canon({k: v for k, v in out.items() if k != "record_sha256"}))
    return out

def self_test():
    TRUSTED_SEED = "invinoveritas"
    _, trusted_pub = keypair(TRUSTED_SEED)
    anchor = 1_780_000_000   # a Bitcoin block time (fixture)
    now = anchor + 3600

    # honest: issuer signs a created_at at anchor time.
    ev = make_event(TRUSTED_SEED, anchor - 10, "verdict: agent_reported")
    v = verify_event(ev, trusted_pub, anchor_block_time=anchor, now=now)
    assert v["valid"] is True, v
    assert v["checks"]["issued_by_trusted"] and v["checks"]["not_postdated"]

    # impostor with a valid signature over identical content (Federico's authorship test).
    imp = make_event("some-other-key", anchor - 10, "verdict: agent_reported")
    vi = verify_event(imp, trusted_pub, anchor_block_time=anchor, now=now)
    assert vi["checks"]["signature_valid"] is True     # the impostor's own math is correct
    assert vi["checks"]["id_integrity"] is True
    assert vi["checks"]["issued_by_trusted"] is False  # but it is not the trusted issuer
    assert vi["valid"] is False

    # postdated by the true issuer: everything else valid, time is a future lie.
    post = make_event(TRUSTED_SEED, anchor + 100000, "verdict: agent_reported")
    vp = verify_event(post, trusted_pub, anchor_block_time=anchor, now=now)
    assert vp["checks"]["issued_by_trusted"] is True and vp["checks"]["signature_valid"] is True
    assert vp["checks"]["not_postdated"] is False and vp["valid"] is False

    print("time_coordinate_probe self_test: PASS")
    print("  honest:", v["valid"], "| impostor valid-sig:", vi["valid"],
          "(issued_by", vi["checks"]["issued_by_trusted"], ") | postdated:", vp["valid"])
    return 0

if __name__ == "__main__":
    import sys
    sys.exit(self_test())
