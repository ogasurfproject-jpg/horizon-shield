# -*- coding: utf-8 -*-
"""
Join guard red team. Attack the composition, not the sub-layers. The whole point of
Federico's finding is that the sub-layers are green. So every attack here keeps evidence
integrity, canonical and reproducible all true, and tries to get a wrong adjudication
past the join. Fail-closed, deterministic, offline.

  1  wrong_coordinate_cheap    truthful pinned read of a cheaper category than the subject
  2  wrong_coordinate_scope    right category, understated scope quantity
  3  coordinate_absent         evidence with no coordinate at all
  4  subject_swapped           coordinate derived, then the subject artifact is changed
  5  bind_is_output_not_input  on a pass, the bound coordinate is the derived one, never
                               the asserted one, even when they happen to match
  6  no_line_items             a subject with no line items yields no derivable coordinate

Controls (must PASS):
  c1  honest_pass              asserted == derived, amount in range -> pass
  c2  honest_reject_amount     asserted == derived, amount out of range -> reject for amount,
                               not for the join

Reproduce: python3 join_redteam.py   (expect all green)
"""
import sys, os, copy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import join_guard as J

def run():
    fails = []; passed = 0; total = 0
    def ok(name, cond, why=""):
        nonlocal passed, total
        total += 1
        if cond:
            passed += 1; print("  green  %-26s ok" % name)
        else:
            fails.append(name + ": " + why); print("  RED    %-26s << %s" % (name, why))

    print("=== join guard red team (attack the composition, sub-layers stay green) ===")

    subject = {"work_id": "W-1", "line_items": [
        {"work_class": "finish", "qty": 8.0, "desc": "paint"},
        {"work_class": "structural", "qty": 6.0, "desc": "beam"},
    ]}
    derived = J.derive_coordinate(subject)  # structural, scope 14.0

    # 1 wrong_coordinate_cheap: valid pinned evidence of 'finish' while subject is structural
    ev = J.signed_evidence({"category": "finish", "scope_qty": 14.0}, 400000)
    v = J.adjudicate(subject, ev, J.price_range_of)
    ok("wrong_coordinate_cheap",
       v["checks"]["evidence_integrity"] and v["checks"]["canonical"] and v["checks"]["reproducible"]
       and v["verdict"] == "reject" and v["reason"] == "coordinate_chosen_by_prover",
       "all sub-layers green but join did not reject: " + str(v.get("verdict")) + "/" + str(v.get("reason")))

    # 2 wrong_coordinate_scope: right category, understated scope
    ev2 = J.signed_evidence({"category": "structural", "scope_qty": 4.0}, 3000000)
    v2 = J.adjudicate(subject, ev2, J.price_range_of)
    ok("wrong_coordinate_scope",
       v2["verdict"] == "reject" and v2["reason"] == "coordinate_chosen_by_prover",
       "understated scope passed the join")

    # 3 coordinate_absent
    ev3 = J.signed_evidence({}, 3000000)
    v3 = J.adjudicate(subject, ev3, J.price_range_of)
    ok("coordinate_absent", v3["verdict"] == "reject" and v3["reason"].startswith("coordinate_absent"),
       "coordinate-free evidence was adjudicated")

    # 4 subject_swapped: derive on one subject, adjudicate a different one with matching evidence.
    #   The verdict binds subject_sha256, so the swap is visible: evidence built for the
    #   original subject's coordinate must not silently adjudicate a different subject.
    other = {"work_id": "W-1", "line_items": [{"work_class": "finish", "qty": 14.0, "desc": "paint only"}]}
    ev4 = J.signed_evidence({"category": "structural", "scope_qty": 14.0}, 3000000)  # matches ORIGINAL derived
    v4 = J.adjudicate(other, ev4, J.price_range_of)  # but adjudicate the swapped (finish) subject
    ok("subject_swapped",
       v4["verdict"] == "reject" and v4["reason"] == "coordinate_chosen_by_prover"
       and v4["subject_sha256"] == J.sha256hex(J.canon(other)),
       "a swapped subject was adjudicated against evidence for the original coordinate")

    # 5 bind_is_output_not_input: on a genuine pass, bound coordinate == derived, and the
    #   record never elevates the asserted coordinate.
    evok = J.signed_evidence({"category": "structural", "scope_qty": 14.0}, 3000000)
    vok = J.adjudicate(subject, evok, J.price_range_of)
    ok("bind_is_output_not_input",
       vok["verdict"] == "pass" and vok["bound_coordinate"]["source"] == "derived_from_subject"
       and vok["bound_coordinate"]["category"] == derived["category"],
       "the pass did not bind the derived coordinate as an output")

    # 6 no_line_items: no derivable coordinate -> reject, never a silent pass
    empty = {"work_id": "W-0", "line_items": []}
    ev6 = J.signed_evidence({"category": "finish", "scope_qty": 0.0}, 0)
    v6 = J.adjudicate(empty, ev6, J.price_range_of)
    ok("no_line_items", v6["verdict"] == "reject" and v6["reason"].startswith("no_derivable_coordinate"),
       "an estimate with no line items was adjudicated")

    # c1 honest_pass
    vc1 = J.adjudicate(subject, J.signed_evidence({"category": "structural", "scope_qty": 14.0}, 3000000), J.price_range_of)
    ok("c1_honest_pass", vc1["verdict"] == "pass", "honest matched estimate did not pass")

    # c2 honest_reject_amount: matched coordinate, amount out of range -> reject for amount
    vc2 = J.adjudicate(subject, J.signed_evidence({"category": "structural", "scope_qty": 14.0}, 100000), J.price_range_of)
    ok("c2_honest_reject_amount",
       vc2["verdict"] == "reject" and vc2["reason"] == "amount_outside_range_for_derived_category",
       "matched coordinate with a bad amount rejected for the wrong reason: " + str(vc2.get("reason")))

    print("\n=== %d / %d ===" % (passed, total))
    if fails:
        print("join not clear (fail-closed):")
        for f in fails:
            print("  - " + f)
        return 1
    print("every sub-layer stayed green and the join still refused the wrong coordinate. clear.")
    return 0

if __name__ == "__main__":
    sys.exit(run())
