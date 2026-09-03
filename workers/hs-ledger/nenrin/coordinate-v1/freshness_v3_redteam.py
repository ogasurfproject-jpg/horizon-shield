# -*- coding: utf-8 -*-
"""
Freshness v3 red team. Attack the seams v3 closes: the single-source beacon, the collapse of
forged into unverifiable, the coupling of the backdating check to the quorum (v3.1), and the
tip-derived veto with its near-tip residual (v3.2). Real Ed25519, offline, deterministic.
The rule being enforced: fail closed on the adversary, fail open on the outage, refuse on
one honest witness, vouch only on corroboration, and let the chain settle what no source can.

Attacks:
  1  forged_height_during_outage      malformed height, other sources down -> fail closed.
  2  sources_disagree                 two sources affirm different values -> forged, fail closed.
  3  lone_source_below_quorum         one source reachable, honest -> unverifiable, not authentic.
  4  backdated_below_beacon           created_at before an authentic quorum beacon -> fail closed.
  5  postdated_future                 created_at after the forward anchor -> fail closed.
  6  tamper_beacon_in_content         beacon swapped after signing -> id_integrity breaks.
  7  backdated_lone_source   (v3.1)   backdated, one confirming source -> REFUSED. the defect the
                                      founding witness found; on the v3 bytes this passed.
  8  beyond_all_tips_refused (v3.2)   height past the highest reachable tip plus margin -> structural,
                                      refused, even though no source can index it.
  9  margin_boundary_exact   (v3.2)   tip+6 is lag (unverifiable, not refused); tip+7 is structural
                                      (refused). the boundary pinned, same depth the witness chose.
 10  stale_source_no_veto    (v3.2)   one source ten blocks behind lacks a real block that two others
                                      confirm -> authentic. under a per-source tip rule that stale
                                      source would veto a corroborated block. it must not.
 11  stale_source_lone_confirm (v3.2) one source ten behind, one down, one confirming -> unverifiable,
                                      NOT refused. a stale source must not turn one honest read into
                                      a refusal.
 12  forged_near_tip_converges (v3.2) fabricated height inside the margin: before the chain arrives,
                                      unverifiable (the residual, shown not hidden); after the chain
                                      indexes the real block, forged and refused. the waiting room
                                      empties toward refusal.
 13  honest_fresh_converges  (v3.2)   an honest unindexed block: unverifiable before, authentic after.
                                      the same waiting room empties toward affirmation.

Controls (must PASS):
  c1  honest_all_up                   quorum met, in window, fresh -> valid and current.
  c2  outage_tolerated                one source down, quorum still met -> authentic, valid.
  c3  outage_not_punished             all sources down, honest -> unverifiable, refused False,
                                      time_indeterminate True, current False.
  c4  window_disclosed                creation window, per-source map, highest tip, margin on record.
  c5  gap_source_no_veto              a source with a gap below its tip (fault) -> cannot-confirm,
                                      never a veto.

Reproduce: python3 freshness_v3_redteam.py   (expect all green)
"""
import sys, os, copy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import freshness_v3 as F

def with_source(name, **changes):
    """Copy SOURCES and modify one source (tip=, blocks=, drop=height)."""
    srcs = copy.deepcopy(F.SOURCES)
    s = srcs[name]
    if "tip" in changes: s["tip"] = changes["tip"]
    if "set" in changes:
        for h, rec in changes["set"].items(): s["blocks"][h] = rec
    if "drop" in changes:
        for h in changes["drop"]: s["blocks"].pop(h, None)
    return srcs

def run():
    fails = []; passed = 0; total = 0
    def ok(name, cond, why=""):
        nonlocal passed, total
        total += 1
        if cond:
            passed += 1; print("  green  %-30s ok" % name)
        else:
            fails.append(name + ": " + why); print("  RED    %-30s << %s" % (name, why))

    print("=== freshness v3 red team (quorum + forged/unverifiable + v3.1 decoupling + v3.2 tip and convergence) ===")
    SEED = "invinoveritas"
    _, trusted = F.keypair(SEED)
    good = {"source": "bitcoin", "height": 800100, "value": "0000d4e5f6", "time": 1_779_060_000}
    tipb = {"source": "bitcoin", "height": 800200, "value": "0000a7b8c9", "time": 1_779_120_000}
    anchor = 1_779_120_000
    now = anchor + 1000
    TIP = 800200

    # 1 malformed height during outage
    evbad = F.make_event(SEED, good["time"] + 50, "v", {"source": "bitcoin", "height": -5, "value": "x", "time": good["time"]})
    v1 = F.verify_freshness(evbad, trusted, anchor, now, down=frozenset(["blockstream", "localheaders"]))
    ok("forged_height_during_outage",
       v1["checks"]["beacon_verdict"] == "bad_coordinate" and v1["refused"] is True and v1["valid_as_issued"] is False,
       "a malformed height slipped through as unverifiable while sources were down")

    # 2 sources disagree
    srcs2 = with_source("blockstream", set={800100: {"value": "0000beef11", "time": good["time"]}})
    ev2 = F.make_event(SEED, good["time"] + 50, "v", good)
    v2 = F.verify_freshness(ev2, trusted, anchor, now, sources=srcs2)
    ok("sources_disagree", v2["checks"]["beacon_verdict"] == "forged" and v2["refused"] is True,
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
    ev6["content"] = {"verdict": "v", "beacon": dict(tipb)}
    v6 = F.verify_freshness(ev6, trusted, anchor, now)
    ok("tamper_beacon_in_content", v6["checks"]["id_integrity"] is False and v6["valid_as_issued"] is False,
       "swapping the beacon after signing was not caught")

    # 7 (v3.1) backdated proof, one confirming source -> refused
    back7 = F.make_event(SEED, 1_700_000_000, "v", good)
    v7 = F.verify_freshness(back7, trusted, anchor, now, down=frozenset(["mempool", "blockstream"]))
    ok("backdated_lone_source",
       v7["checks"]["beacon_verdict"] == "unverifiable_now" and v7["checks"]["not_backdated"] is False
       and v7["refused"] is True and v7["time_indeterminate"] is False,
       "a backdated proof passed as indeterminate because only one source was up (the v3 defect)")

    # 8 (v3.2) beyond all tips + margin -> structural, refused
    far = {"source": "bitcoin", "height": TIP + 7, "value": "0000ffff77", "time": anchor + 4200}
    ev8 = F.make_event(SEED, far["time"] + 50, "v", far)
    v8 = F.verify_freshness(ev8, trusted, far["time"] + 3600, far["time"] + 4600)
    ok("beyond_all_tips_refused",
       v8["checks"]["beacon_verdict"] == "bad_coordinate" and v8["refused"] is True
       and "beyond" in (v8["disclosures"].get("beacon") or ""),
       "a height past every reachable tip plus margin was not refused")

    # 9 (v3.2) exact boundary: tip+6 lag, tip+7 structural
    edge6 = {"source": "bitcoin", "height": TIP + 6, "value": "0000ffff66", "time": anchor + 3600}
    ev9a = F.make_event(SEED, edge6["time"] + 50, "v", edge6)
    v9a = F.verify_freshness(ev9a, trusted, edge6["time"] + 3600, edge6["time"] + 4600)
    ok("margin_boundary_exact",
       v9a["checks"]["beacon_verdict"] == "unverifiable_now" and v9a["refused"] is False
       and v8["checks"]["beacon_verdict"] == "bad_coordinate",
       "the tip+6 / tip+7 boundary is not where the margin says it is")

    # 10 (v3.2) stale source (ten behind) must not veto a block two others confirm
    srcs10 = with_source("localheaders", tip=TIP - 10, drop=[TIP])
    ev10 = F.make_event(SEED, tipb["time"] + 50, "v", tipb)
    v10 = F.verify_freshness(ev10, trusted, anchor + 3600, anchor + 4600, sources=srcs10,
                             cadence_s=86400, last_remeasure_time=anchor + 4500)
    ok("stale_source_no_veto",
       v10["checks"]["beacon_verdict"] == "authentic" and v10["valid_as_issued"] is True
       and v10["disclosures"]["beacon_sources"]["localheaders"] == "lag",
       "a source lagging past the margin vetoed a block two sources confirmed (per-source tip hole)")

    # 11 (v3.2) stale source, one down, one confirming -> unverifiable, NOT refused
    v11 = F.verify_freshness(ev10, trusted, anchor + 3600, anchor + 4600, sources=srcs10, down=frozenset(["blockstream"]))
    ok("stale_source_lone_confirm",
       v11["checks"]["beacon_verdict"] == "unverifiable_now" and v11["refused"] is False
       and v11["time_indeterminate"] is True,
       "a stale source turned one honest confirming read into a refusal")

    # 12 (v3.2) fabricated near-tip height: waits, then flips to forged when the chain arrives
    fake = {"source": "bitcoin", "height": TIP + 3, "value": "deadbeef00", "time": anchor + 1800}
    ev12 = F.make_event(SEED, fake["time"] + 50, "v", fake)
    la = fake["time"] + 3600
    b12 = F.verify_freshness(ev12, trusted, la, la + 1000)
    a12 = F.verify_freshness(ev12, trusted, la, la + 1000, sources=F.advance_chain(F.SOURCES, TIP + 3, "0000c0ffee", anchor + 1800))
    ok("forged_near_tip_converges",
       b12["checks"]["beacon_verdict"] == "unverifiable_now" and b12["refused"] is False and b12["valid_as_issued"] is False
       and "near tip" in (b12["disclosures"].get("beacon") or "")
       and a12["checks"]["beacon_verdict"] == "forged" and a12["refused"] is True,
       "a fabricated near-tip height was either refused early (overclaim) or not refused once the chain arrived")

    # 13 (v3.2) honest unindexed block: waits, then flips to authentic
    fresh = {"source": "bitcoin", "height": TIP + 1, "value": "0000f00d01", "time": anchor + 600}
    ev13 = F.make_event(SEED, fresh["time"] + 50, "v", fresh)
    lb = fresh["time"] + 3600
    b13 = F.verify_freshness(ev13, trusted, lb, lb + 1000)
    a13 = F.verify_freshness(ev13, trusted, lb, lb + 1000, sources=F.advance_chain(F.SOURCES, TIP + 1, "0000f00d01", anchor + 600),
                             cadence_s=86400, last_remeasure_time=lb + 900)
    ok("honest_fresh_converges",
       b13["checks"]["beacon_verdict"] == "unverifiable_now" and b13["refused"] is False
       and a13["checks"]["beacon_verdict"] == "authentic" and a13["valid_as_issued"] is True and a13["current_now"] is True,
       "an honest fresh block was refused early, or did not become authentic once indexed")

    # c1 honest all up
    ev = F.make_event(SEED, good["time"] + 50, "v", good)
    c1 = F.verify_freshness(ev, trusted, anchor, now, cadence_s=86400, last_remeasure_time=now - 100)
    ok("c1_honest_all_up", c1["valid_as_issued"] and c1["current_now"], "an honest fresh proof was refused")

    # c2 outage tolerated
    c2 = F.verify_freshness(ev, trusted, anchor, now, down=frozenset(["mempool"]), cadence_s=86400, last_remeasure_time=now - 100)
    ok("c2_outage_tolerated", c2["checks"]["beacon_verdict"] == "authentic" and c2["valid_as_issued"] is True,
       "a single source outage broke an otherwise-verifiable proof")

    # c3 outage not punished (all down)
    c3 = F.verify_freshness(ev, trusted, anchor, now, down=frozenset(["mempool", "blockstream", "localheaders"]))
    ok("c3_outage_not_punished",
       c3["checks"]["beacon_verdict"] == "unverifiable_now" and c3["refused"] is False
       and c3["time_indeterminate"] is True and c3["current_now"] is False,
       "a total outage either refused an honest proof or was folded into current")

    # c4 disclosures
    ok("c4_window_disclosed",
       c1["disclosures"]["creation_window"] == [good["time"], anchor]
       and c1["disclosures"]["sources_agreeing"] >= F.QUORUM
       and c1["disclosures"]["highest_reachable_tip"] == TIP
       and c1["disclosures"]["margin_blocks"] == F.MARGIN_BLOCKS,
       "the creation window, per-source map, highest tip or margin was not disclosed")

    # c5 a gap below a source's tip (fault) is cannot-confirm, never a veto
    srcs5 = with_source("localheaders", drop=[800100])
    c5 = F.verify_freshness(ev, trusted, anchor, now, sources=srcs5, cadence_s=86400, last_remeasure_time=now - 100)
    ok("c5_gap_source_no_veto",
       c5["checks"]["beacon_verdict"] == "authentic" and c5["valid_as_issued"] is True
       and c5["disclosures"]["beacon_sources"]["localheaders"] == "unreachable",
       "a source merely missing an old block was allowed to veto a corroborated claim")

    print("\n=== %d / %d ===" % (passed, total))
    if fails:
        print("freshness v3 not clear (fail-closed):")
        for f in fails:
            print("  - " + f)
        return 1
    print("quorum closes the single source, forged split from unverifiable, one honest witness refuses (v3.1), "
          "veto derived from the highest reachable tip so a stale source cannot veto (v3.2), near-tip residual shown "
          "and bounded by convergence, honest outage not punished, provable lies fail closed. clear.")
    return 0

if __name__ == "__main__":
    sys.exit(run())
