# -*- coding: utf-8 -*-
"""
Freshness v3 red team. Attack the two seams v3 closes: the single-source beacon, and the
collapse of forged into unverifiable. Real Ed25519, offline, deterministic. The rule being
enforced is fail closed on the adversary, fail open on the outage, and the attacks press
exactly the boundary between those two.

  1  forged_height_during_outage   a fabricated height a source rejects, while other sources
                                   are down -> must fail closed. bad does not become
                                   unverifiable because a second source is unreachable.
  2  sources_disagree              one source affirms the claimed value, another affirms a
                                   different value for the same height -> forged, fail closed.
                                   a lying source cannot be averaged into a pass.
  3  lone_source_below_quorum      only one source reachable, it says ok -> unverifiable, NOT
                                   authentic. one source you cannot cross-check is trusted,
                                   not verified.
  4  backdated_below_beacon        created_at earlier than an authentic quorum beacon -> fail
                                   closed (carried from v2, now under quorum).
  5  postdated_future              created_at after the forward anchor -> fail closed.
  6  tamper_beacon_in_content      swap the beacon after signing -> id_integrity breaks.

Controls (must PASS):
  c1  honest_all_up               quorum met, in window, fresh -> valid and current.
  c2  outage_tolerated            one source down, quorum still met -> authentic, valid.
  c3  outage_not_punished         all sources down, honest proof -> unverifiable_now,
                                  refused False, time_indeterminate True, current False.
                                  the honest prover is not branded a forger.
  c4  window_disclosed            the creation window and the per-source map are on the record.

Reproduce: python3 freshness_v3_redteam.py   (expect all green)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import freshness_v3 as F

def run():
    fails = []; passed = 0; total = 0
    def ok(name, cond, why=""):
        nonlocal passed, total
        total += 1
        if cond:
            passed += 1; print("  green  %-28s ok" % name)
        else:
            fails.append(name + ": " + why); print("  RED    %-28s << %s" % (name, why))

    print("=== freshness v3 red team (multi-source beacon + forged/unverifiable split) ===")
    SEED = "invinoveritas"
    _, trusted = F.keypair(SEED)
    good = {"source": "bitcoin", "height": 800100, "value": "0000d4e5f6", "time": 1_779_060_000}
    anchor = 1_779_120_000
    now = anchor + 1000

    # 1 forged height during outage: a bad height, two of three sources down
    evbad = F.make_event(SEED, good["time"] + 50, "v", {"source": "bitcoin", "height": -5, "value": "x", "time": good["time"]})
    v1 = F.verify_freshness(evbad, trusted, anchor, now, down=frozenset(["blockstream", "localheaders"]))
    ok("forged_height_during_outage",
       v1["checks"]["beacon_verdict"] == "bad_coordinate" and v1["refused"] is True and v1["valid_as_issued"] is False,
       "a rejected height slipped through as unverifiable while sources were down")

    # 2 sources disagree: build a source set where one affirms a different value for 800100
    liar = dict(F.SOURCE_BLOCKSTREAM); liar[("bitcoin", 800100)] = {"status": "ok", "value": "0000beef11", "time": good["time"]}
    srcs = {"mempool": F.SOURCE_MEMPOOL, "blockstream": liar, "localheaders": F.SOURCE_LOCALHEADERS}
    ev2 = F.make_event(SEED, good["time"] + 50, "v", good)
    v2 = F.verify_freshness(ev2, trusted, anchor, now, sources=srcs)
    ok("sources_disagree",
       v2["checks"]["beacon_verdict"] == "forged" and v2["refused"] is True,
       "two sources disagreeing on the same height did not fail closed")

    # 3 lone source below quorum
    ev3 = F.make_event(SEED, good["time"] + 50, "v", good)
    v3 = F.verify_freshness(ev3, trusted, anchor, now, down=frozenset(["mempool", "blockstream"]))
    ok("lone_source_below_quorum",
       v3["checks"]["beacon_verdict"] == "unverifiable_now" and v3["valid_as_issued"] is False and v3["refused"] is False,
       "a single un-cross-checked source was treated as authentic")

    # 4 backdated below an authentic quorum beacon
    back = F.make_event(SEED, 1_700_000_000, "v", good)
    v4 = F.verify_freshness(back, trusted, anchor, now)
    ok("backdated_below_beacon",
       v4["checks"]["beacon_verdict"] == "authentic" and v4["checks"]["not_backdated"] is False and v4["refused"] is True,
       "a created_at before an authentic beacon was accepted")

    # 5 postdated future
    post = F.make_event(SEED, anchor + 100000, "v", good)
    v5 = F.verify_freshness(post, trusted, anchor, now)
    ok("postdated_future", v5["checks"]["not_postdated"] is False and v5["refused"] is True,
       "a future created_at passed the forward anchor")

    # 6 tamper beacon in content after signing
    ev6 = F.make_event(SEED, good["time"] + 50, "v", good)
    ev6["content"] = {"verdict": "v", "beacon": {"source": "bitcoin", "height": 800200, "value": "0000a7b8c9", "time": 1_779_120_000}}
    v6 = F.verify_freshness(ev6, trusted, anchor, now)
    ok("tamper_beacon_in_content", v6["checks"]["id_integrity"] is False and v6["valid_as_issued"] is False,
       "swapping the beacon after signing was not caught")

    # c1 honest all up
    ev = F.make_event(SEED, good["time"] + 50, "v", good)
    c1 = F.verify_freshness(ev, trusted, anchor, now, cadence_s=86400, last_remeasure_time=now - 100)
    ok("c1_honest_all_up", c1["valid_as_issued"] and c1["current_now"], "an honest fresh proof was refused")

    # c2 outage tolerated (one down, quorum met)
    c2 = F.verify_freshness(ev, trusted, anchor, now, down=frozenset(["mempool"]),
                            cadence_s=86400, last_remeasure_time=now - 100)
    ok("c2_outage_tolerated",
       c2["checks"]["beacon_verdict"] == "authentic" and c2["valid_as_issued"] is True,
       "a single source outage broke an otherwise-verifiable proof")

    # c3 outage not punished (all down)
    c3 = F.verify_freshness(ev, trusted, anchor, now, down=frozenset(["mempool", "blockstream", "localheaders"]))
    ok("c3_outage_not_punished",
       c3["checks"]["beacon_verdict"] == "unverifiable_now" and c3["refused"] is False
       and c3["time_indeterminate"] is True and c3["current_now"] is False,
       "a total outage either refused an honest proof or was folded into current")

    # c4 window + per-source map disclosed
    ok("c4_window_disclosed",
       c1["disclosures"]["creation_window"] == [good["time"], anchor]
       and c1["disclosures"]["sources_agreeing"] >= F.QUORUM
       and isinstance(c1["disclosures"]["beacon_sources"], dict),
       "the creation window or the per-source map was not disclosed")

    print("\n=== %d / %d ===" % (passed, total))
    if fails:
        print("freshness v3 not clear (fail-closed):")
        for f in fails:
            print("  - " + f)
        return 1
    print("single-source seam closed by quorum, forged split from unverifiable, honest outage not punished, "
          "provable lies fail closed. clear.")
    return 0

if __name__ == "__main__":
    sys.exit(run())
