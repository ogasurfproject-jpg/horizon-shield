# -*- coding: utf-8 -*-
"""
Time coordinate red team. Attack the created_at axis of a signed judgment. Real Ed25519,
offline, deterministic. The authorship layer is confirmed, not attacked, because Federico
already closed it; the attacks press the time seam next to it, and the controls prove the
honest cases and the named-unsolved cases are reported honestly rather than faked.

  1  tamper_created_at        change created_at after signing -> id_integrity breaks
  2  impostor_valid_sig       a fresh key signs valid math over identical content ->
                              signature_valid true, id_integrity true, issued_by false,
                              valid false. Federico's own result, reproduced.
  3  issuer_postdated_anchor  the true issuer stamps a future created_at, checked against
                              the Bitcoin anchor -> refused, structurally.
  4  no_clock_no_silent_pass  no anchor and no clock -> postdating is not checked, and the
                              verdict must SAY so, not quietly call itself fresh.
  5  weak_local_clock_only    with only the verifier's own clock, a postdate is still
                              caught, and the record discloses the weaker time source.

Controls (must PASS):
  c1  honest_valid            trusted issuer, sane time -> valid.
  c2  backdating_named        a backdated created_at is NOT claimed caught; the record
                              names backdating as unsolved by a forward anchor.
  c3  currency_named          a valid old proof is valid, and the record says valid is not
                              current; currency needs re-measurement.

Reproduce: python3 time_redteam.py   (expect all green)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import time_coordinate_probe as T

def run():
    fails = []; passed = 0; total = 0
    def ok(name, cond, why=""):
        nonlocal passed, total
        total += 1
        if cond:
            passed += 1; print("  green  %-24s ok" % name)
        else:
            fails.append(name + ": " + why); print("  RED    %-24s << %s" % (name, why))

    print("=== time coordinate red team (attack created_at, real Ed25519, offline) ===")
    TRUSTED = "invinoveritas"
    _, trusted_pub = T.keypair(TRUSTED)
    anchor = 1_780_000_000
    now = anchor + 3600

    # 1 tamper_created_at
    ev = T.make_event(TRUSTED, anchor - 10, "verdict")
    ev2 = dict(ev); ev2["created_at"] = anchor - 999999   # change it after signing
    v = T.verify_event(ev2, trusted_pub, anchor_block_time=anchor, now=now)
    ok("tamper_created_at", v["checks"]["id_integrity"] is False and v["valid"] is False,
       "a post-signing created_at change was not caught by id_integrity")

    # 2 impostor_valid_sig
    imp = T.make_event("attacker-key", anchor - 10, "verdict")
    vi = T.verify_event(imp, trusted_pub, anchor_block_time=anchor, now=now)
    ok("impostor_valid_sig",
       vi["checks"]["signature_valid"] and vi["checks"]["id_integrity"]
       and vi["checks"]["issued_by_trusted"] is False and vi["valid"] is False,
       "an impostor's valid signature over identical content was accepted")

    # 3 issuer_postdated_anchor
    post = T.make_event(TRUSTED, anchor + 100000, "verdict")
    vp = T.verify_event(post, trusted_pub, anchor_block_time=anchor, now=now)
    ok("issuer_postdated_anchor",
       vp["checks"]["issued_by_trusted"] and vp["checks"]["not_postdated"] is False and vp["valid"] is False,
       "a future created_at passed against the Bitcoin anchor")

    # 4 no_clock_no_silent_pass
    ev4 = T.make_event(TRUSTED, anchor + 100000, "verdict")
    v4 = T.verify_event(ev4, trusted_pub, anchor_block_time=None, now=None)
    ok("no_clock_no_silent_pass",
       v4["checks"]["not_postdated"] is None and "not check" in v4["disclosures"].get("warning", "").lower(),
       "with no clock, the verdict did not disclose that postdating was unchecked")

    # 5 weak_local_clock_only
    v5 = T.verify_event(post, trusted_pub, anchor_block_time=None, now=now)
    ok("weak_local_clock_only",
       v5["checks"]["not_postdated"] is False and "local_clock" in v5["disclosures"]["time_source"],
       "a postdate slipped past the local clock, or the weaker source was not disclosed")

    # c1 honest_valid
    good = T.make_event(TRUSTED, anchor - 10, "verdict")
    vc1 = T.verify_event(good, trusted_pub, anchor_block_time=anchor, now=now)
    ok("c1_honest_valid", vc1["valid"] is True, "an honest, sanely-timed proof was refused")

    # c2 backdating_named
    back = T.make_event(TRUSTED, anchor - 500000, "verdict")   # claims older than 'reality'
    vc2 = T.verify_event(back, trusted_pub, anchor_block_time=anchor, now=now)
    ok("c2_backdating_named",
       vc2["valid"] is True and "not solved" in vc2["disclosures"]["backdating"],
       "backdating was either silently caught or not named as unsolved")

    # c3 currency_named: a valid old proof is valid, and currency is named as not covered.
    old = T.make_event(TRUSTED, anchor - 10, "verdict")
    vc3 = T.verify_event(old, trusted_pub, anchor_block_time=anchor, now=anchor + 10**7)
    ok("c3_currency_named",
       vc3["valid"] is True and "re-measurement" in vc3["disclosures"]["currency"],
       "currency was folded into valid, or not named as needing re-measurement")

    print("\n=== %d / %d ===" % (passed, total))
    if fails:
        print("time axis not clear (fail-closed):")
        for f in fails:
            print("  - " + f)
        return 1
    print("authorship confirmed, postdating refused against the anchor, backdating and currency named not faked. clear.")
    return 0

if __name__ == "__main__":
    sys.exit(run())
