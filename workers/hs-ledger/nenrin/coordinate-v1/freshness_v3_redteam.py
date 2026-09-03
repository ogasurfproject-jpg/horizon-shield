# -*- coding: utf-8 -*-
"""
Freshness v3 red team. Attack the seams v3 closes: the single-source beacon, the collapse
of forged into unverifiable, and (v3.1) the coupling of the backdating check to the quorum.
Real Ed25519, offline, deterministic. The rule being enforced is fail closed on the
adversary, fail open on the outage, refuse on one honest witness, vouch only on
corroboration, and the attacks press exactly the boundaries between those.

  1  forged_height_during_outage     a structurally bad height, while other sources are down
                                     -> must fail closed. bad does not become unverifiable
                                     because a second source is unreachable.
  2  sources_disagree                one source affirms the claimed value, another affirms a
                                     different value for the same height -> forged, fail closed.
  3  lone_source_below_quorum        only one source reachable, honest proof -> unverifiable,
                                     NOT authentic. one source cannot vouch.
  4  backdated_below_beacon          created_at earlier than an authentic quorum beacon ->
                                     fail closed.
  5  postdated_future                created_at after the forward anchor -> fail closed.
  6  tamper_beacon_in_content        swap the beacon after signing -> id_integrity breaks.
  7  backdated_lone_source  (v3.1)   a BACKDATED proof with only one source reachable and
                                     confirming the beacon -> must be REFUSED. On the v3 bytes
                                     this passed as indeterminate: the defect the founding
                                     witness's review found. One honest witness is enough to
                                     refuse.
  8  structural_veto_beats_majority  two sources affirm a height, a third structurally rejects
                                     it -> refused. deliberate: two sources agreeing on an
                                     impossible height means both are wrong or compromised.

Controls (must PASS):
  c1  honest_all_up                  quorum met, in window, fresh -> valid and current.
  c2  outage_tolerated               one source down, quorum still met -> authentic, valid.
  c3  outage_not_punished            all sources down, honest proof -> unverifiable_now,
                                     refused False, time_indeterminate True, current False.
  c4  window_disclosed               creation window and per-source map are on the record.
  c5  lagging_source_no_veto (v3.1)  two sources confirm a real height, the third simply lacks
                                     it (lag) -> authentic. a plain not-found is not a veto.
                                     this is the liveness guarantee that bounds seam 3.

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
            passed += 1; print("  green  %-32s ok" % name)
        else:
            fails.append(name + ": " + why); print("  RED    %-32s << %s" % (name, why))

    print("=== freshness v3 red team (multi-source beacon + forged/unverifiable split + v3.1 decoupling) ===")
    SEED = "invinoveritas"
    _, trusted = F.keypair(SEED)
    good = {"source": "bitcoin", "height": 800100, "value": "0000d4e5f6", "time": 1_779_060_000}
    anchor = 1_779_120_000
    now = anchor + 1000

    # 1 forged height during outage: a structurally bad height, two of three sources down
    evbad = F.make_event(SEED, good["time"] + 50, "v", {"source": "bitcoin", "height": -5, "value": "x", "time": good["time"]})
    v1 = F.verify_freshness(evbad, trusted, anchor, now, down=frozenset(["blockstream", "localheaders"]))
    ok("forged_height_during_outage",
       v1["checks"]["beacon_verdict"] == "bad_coordinate" and v1["refused"] is True and v1["valid_as_issued"] is False,
       "a rejected height slipped through as unverifiable while sources were down")

    # 2 sources disagree
    liar = dict(F.SOURCE_BLOCKSTREAM); liar[("bitcoin", 800100)] = {"status": "ok", "value": "0000beef11", "time": good["time"]}
    srcs = {"mempool": F.SOURCE_MEMPOOL, "blockstream": liar, "localheaders": F.SOURCE_LOCALHEADERS}
    ev2 = F.make_event(SEED, good["time"] + 50, "v", good)
    v2 = F.verify_freshness(ev2, trusted, anchor, now, sources=srcs)
    ok("sources_disagree",
       v2["checks"]["beacon_verdict"] == "forged" and v2["refused"] is True,
       "two sources disagreeing on the same height did not fail closed")

    # 3 lone source below quorum, honest
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

    # 7 (v3.1) backdated proof, only ONE source reachable and confirming -> must be refused
    back7 = F.make_event(SEED, 1_700_000_000, "v", good)
    v7 = F.verify_freshness(back7, trusted, anchor, now, down=frozenset(["mempool", "blockstream"]))
    ok("backdated_lone_source",
       v7["checks"]["beacon_verdict"] == "unverifiable_now" and v7["checks"]["not_backdated"] is False
       and v7["refused"] is True and v7["time_indeterminate"] is False,
       "a backdated proof passed as indeterminate because only one source was up (the v3 defect)")

    # 8 structural veto beats majority: two affirm, one structurally rejects -> refused
    veto = dict(F.SOURCE_LOCALHEADERS); veto[("bitcoin", 800100)] = {"status": "bad", "reason": "impossible"}
    srcs8 = {"mempool": F.SOURCE_MEMPOOL, "blockstream": F.SOURCE_BLOCKSTREAM, "localheaders": veto}
    ev8 = F.make_event(SEED, good["time"] + 50, "v", good)
    v8 = F.verify_freshness(ev8, trusted, anchor, now, sources=srcs8)
    ok("structural_veto_beats_majority",
       v8["checks"]["beacon_verdict"] == "bad_coordinate" and v8["refused"] is True,
       "a structural reject was outvoted by two agreeing sources")

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

    # c5 (v3.1) lagging source does not veto: third source simply lacks the height
    lag = dict(F.SOURCE_LOCALHEADERS); del lag[("bitcoin", 800100)]
    srcs5 = {"mempool": F.SOURCE_MEMPOOL, "blockstream": F.SOURCE_BLOCKSTREAM, "localheaders": lag}
    c5 = F.verify_freshness(ev, trusted, anchor, now, sources=srcs5, cadence_s=86400, last_remeasure_time=now - 100)
    ok("c5_lagging_source_no_veto",
       c5["checks"]["beacon_verdict"] == "authentic" and c5["valid_as_issued"] is True
       and c5["disclosures"]["beacon_sources"]["localheaders"] == "unreachable",
       "a source merely lacking a fresh height was allowed to veto a corroborated claim")

    print("\n=== %d / %d ===" % (passed, total))
    if fails:
        print("freshness v3 not clear (fail-closed):")
        for f in fails:
            print("  - " + f)
        return 1
    print("single-source seam closed by quorum, forged split from unverifiable, honest outage not punished, "
          "one honest witness refuses (v3.1), structural veto deliberate and bounded by liveness, provable lies fail closed. clear.")
    return 0

if __name__ == "__main__":
    sys.exit(run())
