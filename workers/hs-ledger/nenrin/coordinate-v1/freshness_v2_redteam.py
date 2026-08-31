# -*- coding: utf-8 -*-
"""
Freshness v2 red team. Attack the two-sided time box and the fail-closed currency default.
Real Ed25519, offline, deterministic. Confirms what is closed, and confirms the residual is
named rather than faked.

  1  backdated_below_beacon   created_at earlier than a beacon the content provably carries
                             -> refused, structurally.
  2  forged_beacon           a beacon value that does not match the involuntary source
                             -> not_backdated cannot be established, refused.
  3  beacon_absent           no beacon at all -> not-before not established, refused (a proof
                             claiming an old created_at with nothing to bound it below is not
                             trusted).
  4  postdated_future        created_at after the forward anchor -> refused (v1, still holds).
  5  stale_by_default        valid proof, no re-measurement -> valid_as_issued true,
                             current_now false. Fail-closed, not current-forever.
  6  tamper_beacon_in_content swap the beacon after signing -> id_integrity breaks.

Controls (must PASS):
  c1  honest_current         inside the window, fresh re-measurement -> valid and current.
  c2  window_disclosed       the creation window and its width are on the record, so the
                             residual (issuer choice inside the window) is visible.
  c3  currency_limit_named   the between-measurements gap is named unprovable, never folded
                             into current.

Reproduce: python3 freshness_v2_redteam.py   (expect all green)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import freshness_v2 as F

def run():
    fails = []; passed = 0; total = 0
    def ok(name, cond, why=""):
        nonlocal passed, total
        total += 1
        if cond:
            passed += 1; print("  green  %-26s ok" % name)
        else:
            fails.append(name + ": " + why); print("  RED    %-26s << %s" % (name, why))

    print("=== freshness v2 red team (two-sided time box + fail-closed currency) ===")
    SEED = "invinoveritas"
    _, trusted = F.keypair(SEED)
    beacon = {"source": "bitcoin", "height": 800100, "value": "0000d4e5f6", "time": 1_779_060_000}
    anchor = 1_779_120_000
    now = anchor + 1000

    # 1 backdated below beacon
    back = F.make_event(SEED, 1_700_000_000, "v", beacon)
    vb = F.verify_freshness(back, trusted, anchor, now, cadence_s=86400, last_remeasure_time=now - 100)
    ok("backdated_below_beacon",
       vb["checks"]["beacon_authentic"] and vb["checks"]["not_backdated"] is False and vb["valid_as_issued"] is False,
       "a created_at before the embedded beacon was accepted")

    # 2 forged beacon
    forged = {"source": "bitcoin", "height": 800100, "value": "deadbeef", "time": 1_779_060_000}
    ev2 = F.make_event(SEED, beacon["time"] + 50, "v", forged)
    v2 = F.verify_freshness(ev2, trusted, anchor, now)
    ok("forged_beacon",
       v2["checks"]["beacon_authentic"] is False and v2["valid_as_issued"] is False,
       "a beacon not matching the source was accepted")

    # 3 beacon absent
    ev3 = F.make_event(SEED, beacon["time"] + 50, "v", {})
    v3 = F.verify_freshness(ev3, trusted, anchor, now)
    ok("beacon_absent",
       v3["checks"]["not_backdated"] is None and v3["valid_as_issued"] is False,
       "a proof with no beacon to bound it below was trusted")

    # 4 postdated future
    post = F.make_event(SEED, anchor + 100000, "v", beacon)
    v4 = F.verify_freshness(post, trusted, anchor, now)
    ok("postdated_future", v4["checks"]["not_postdated"] is False and v4["valid_as_issued"] is False,
       "a future created_at passed the forward anchor")

    # 5 stale by default
    ev5 = F.make_event(SEED, beacon["time"] + 50, "v", beacon)
    v5 = F.verify_freshness(ev5, trusted, anchor, now)   # no cadence / re-measurement
    ok("stale_by_default",
       v5["valid_as_issued"] is True and v5["current_now"] is False,
       "with no re-measurement the proof was treated as current")

    # 6 tamper beacon in content after signing
    ev6 = F.make_event(SEED, beacon["time"] + 50, "v", beacon)
    ev6["content"] = {"verdict": "v", "beacon": {"source": "bitcoin", "height": 800200, "value": "0000a7b8c9", "time": 1_779_120_000}}
    v6 = F.verify_freshness(ev6, trusted, anchor, now)
    ok("tamper_beacon_in_content", v6["checks"]["id_integrity"] is False and v6["valid_as_issued"] is False,
       "swapping the beacon after signing was not caught")

    # c1 honest current
    good = F.make_event(SEED, beacon["time"] + 50, "v", beacon)
    vc1 = F.verify_freshness(good, trusted, anchor, now, cadence_s=86400, last_remeasure_time=now - 100)
    ok("c1_honest_current", vc1["valid_as_issued"] and vc1["current_now"], "an honest fresh proof was refused")

    # c2 window disclosed
    ok("c2_window_disclosed",
       vc1["disclosures"]["creation_window"] == [beacon["time"], anchor] and vc1["disclosures"]["window_width_s"] == anchor - beacon["time"],
       "the creation window or its width was not disclosed")

    # c3 currency limit named
    ok("c3_currency_limit_named",
       "not provable" in vc1["disclosures"]["currency_limit"],
       "the between-measurements gap was not named as unprovable")

    print("\n=== %d / %d ===" % (passed, total))
    if fails:
        print("freshness v2 not clear (fail-closed):")
        for f in fails:
            print("  - " + f)
        return 1
    print("backdating boxed below the beacon, postdating above the anchor, currency fail-closed, residual named. clear.")
    return 0

if __name__ == "__main__":
    sys.exit(run())
