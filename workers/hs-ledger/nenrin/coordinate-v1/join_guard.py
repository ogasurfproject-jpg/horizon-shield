# -*- coding: utf-8 -*-
"""
Coordinate Integrity, the join guard (nenrin-join-v1)

The defect, stated by Federico Blanco Sanchez-Llanos in public:

    "Three verification layers can each be sound and still produce a wrong verdict. An
     agent authorised to release escrow A submits a truthful, canonically-pinned,
     independently re-derivable read of escrow B. Every layer returns green. The
     adjudication is wrong. The defect is in none of them. It is in the join: the
     evidence coordinate is chosen by the party being verified. Fail-closed
     verification is not fail-closed composition."

His fix on his own half: /review artifact_source takes a tx_hash and derives block,
contract, status and logs from the receipt. Coordinate fields are outputs, never inputs.
Assert a different contract than the transaction actually touched and it is a hard 422.

This file is the same fix on HORIZON SHIELD's half, generalised so one mechanism covers
both the record level and the population level:

    A verdict about a subject S must bind evidence whose coordinate the VERIFIER derived
    from S, from a source the prover does not control. Evidence supplied by the prover is
    accepted only if its coordinate equals the derived one. The verdict binds the derived
    coordinate, an output, never the asserted one. Mismatch is a hard fail named
    coordinate_chosen_by_prover, the 422.

HORIZON SHIELD instance, the fair-price adjudication. Subject S = the estimate. The
coordinate = which cost category and scope the estimate is judged against. Today a
contractor, the party being verified, can label the work as a cheap category while the
line items describe an expensive one, and a price-range read of the cheap category is
truthful, pinned and reproducible. Every sub-layer is green. The adjudication is wrong.
The join guard derives the category from the estimate's own line items and refuses when
the asserted coordinate differs.

The same guard is the census one scale up: there the subject is a population, the source
the prover does not control is Certificate Transparency, and the derived coordinate is
the CT snapshot. Prover chooses the coordinate is one defect. The verifier derives the
coordinate from a source the prover does not own is one fix, at both scales.

Counts, never scores. Unmeasured is never a pass. The bound coordinate is always the
derived output. Fail-closed. Runs offline, deterministic.
"""
import json, hashlib, sys, os

SPEC = "nenrin-join-v1"

def canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def sha256hex(s):
    if isinstance(s, str):
        s = s.encode("utf-8")
    return hashlib.sha256(s).hexdigest()

# ---------------------------------------------------------------------------
# Domain derivation for the fair-price instance. The coordinate is derived from the
# estimate's own line items, not from any label the submitter attached. This stands in
# for the real JCCDB classification; the point under test is the JOIN, that the
# coordinate is an output of the artifact, computed by the verifier.
#
# Category is the most expensive work class present in the line items (a cheap label
# cannot hide an expensive line). Scope is the summed quantity. Both are functions of S.
WORK_CLASS_RANK = {"finish": 1, "interior": 2, "plumbing": 3, "structural": 4, "seismic": 5}

def derive_coordinate(estimate):
    items = estimate.get("line_items", [])
    if not items:
        raise ValueError("cannot derive a coordinate from an estimate with no line items")
    top = max(items, key=lambda it: WORK_CLASS_RANK.get(it.get("work_class", ""), 0))
    category = top.get("work_class", "")
    scope_qty = round(sum(float(it.get("qty", 0)) for it in items), 3)
    return {"category": category, "scope_qty": scope_qty,
            "derived_from": "estimate.line_items", "subject_sha256": sha256hex(canon(estimate))}

# ---------------------------------------------------------------------------
# The guard. Sub-layers can each be green; the join is what this enforces.
def adjudicate(estimate, submitted_evidence, price_range_of):
    """
    estimate: the subject S (line items).
    submitted_evidence: prover-supplied, shape:
        { coordinate:{category, scope_qty}, amount:number,
          evidence_sha256:str, canonical:bool, reproducible:bool }
      evidence_sha256 must recompute over the evidence body (integrity sub-layer).
    price_range_of: fn(category) -> (low, high). Stands in for JCCDB.
    Returns a verdict record. The bound coordinate is always the derived output.
    """
    result = {"spec": SPEC, "subject_sha256": sha256hex(canon(estimate)), "checks": {}}

    # Sub-layer 1: evidence integrity. This is the layer that can be green on wrong evidence.
    body = {k: submitted_evidence[k] for k in submitted_evidence if k != "evidence_sha256"}
    integrity = submitted_evidence.get("evidence_sha256") == sha256hex(canon(body))
    result["checks"]["evidence_integrity"] = integrity

    # Sub-layer 2 and 3: canonical and reproducible, as the prover claims. Recorded, and
    # deliberately NOT sufficient. This is Federico's point: all green, still wrong.
    result["checks"]["canonical"] = bool(submitted_evidence.get("canonical"))
    result["checks"]["reproducible"] = bool(submitted_evidence.get("reproducible"))

    # Derive the coordinate from the subject, from the artifact the verifier holds.
    try:
        derived = derive_coordinate(estimate)
    except ValueError as e:
        result["verdict"] = "reject"
        result["reason"] = "no_derivable_coordinate: " + str(e)
        result["record_sha256"] = sha256hex(canon({k: v for k, v in result.items() if k != "record_sha256"}))
        return result
    result["derived_coordinate"] = derived

    submitted_coord = submitted_evidence.get("coordinate")
    if not submitted_coord or "category" not in submitted_coord:
        result["verdict"] = "reject"
        result["reason"] = "coordinate_absent: a coordinate-bound verdict needs evidence carrying a coordinate"
        result["record_sha256"] = sha256hex(canon({k: v for k, v in result.items() if k != "record_sha256"}))
        return result

    # THE JOIN. Federico's 422. Even with every sub-layer green, if the coordinate the
    # prover supplied is not the coordinate derived from the subject, the adjudication is
    # about the wrong thing. Hard fail, named.
    coord_match = (submitted_coord.get("category") == derived["category"]
                   and float(submitted_coord.get("scope_qty", -1)) == derived["scope_qty"])
    result["checks"]["coordinate_integrity"] = coord_match
    if not coord_match:
        result["verdict"] = "reject"
        result["reason"] = "coordinate_chosen_by_prover"
        result["detail"] = {"asserted": submitted_coord, "derived": {"category": derived["category"], "scope_qty": derived["scope_qty"]}}
        result["note"] = ("every sub-layer above may be green. The verdict is still refused because the "
                          "evidence is a truthful, pinned read of a coordinate the subject does not occupy.")
        result["record_sha256"] = sha256hex(canon({k: v for k, v in result.items() if k != "record_sha256"}))
        return result

    if not integrity:
        result["verdict"] = "reject"
        result["reason"] = "evidence_integrity_failed"
        result["record_sha256"] = sha256hex(canon({k: v for k, v in result.items() if k != "record_sha256"}))
        return result

    # Only now, coordinate confirmed as an output of the subject, judge the amount, and
    # BIND the derived coordinate into the verdict, never the asserted one.
    low, high = price_range_of(derived["category"])
    within = low <= float(submitted_evidence.get("amount", 0)) <= high
    result["bound_coordinate"] = {"category": derived["category"], "scope_qty": derived["scope_qty"],
                                  "source": "derived_from_subject", "never": "asserted_by_prover"}
    result["checks"]["amount_within_range"] = within
    result["verdict"] = "pass" if within else "reject"
    if not within:
        result["reason"] = "amount_outside_range_for_derived_category"
    result["record_sha256"] = sha256hex(canon({k: v for k, v in result.items() if k != "record_sha256"}))
    return result

def signed_evidence(coordinate, amount, canonical=True, reproducible=True):
    ev = {"coordinate": coordinate, "amount": amount, "canonical": canonical, "reproducible": reproducible}
    ev["evidence_sha256"] = sha256hex(canon(ev))
    return ev

# Stand-in JCCDB ranges. structural is expensive, finish is cheap.
RANGES = {"finish": (0, 500000), "interior": (300000, 1500000),
          "plumbing": (400000, 2000000), "structural": (2000000, 12000000), "seismic": (5000000, 30000000)}
def price_range_of(cat):
    return RANGES.get(cat, (0, 0))

def self_test():
    # Subject: the line items describe structural work (the true, expensive coordinate).
    estimate = {"work_id": "W-100", "line_items": [
        {"work_class": "finish", "qty": 10.0, "desc": "paint"},
        {"work_class": "structural", "qty": 4.0, "desc": "beam replacement"},
    ]}
    derived = derive_coordinate(estimate)
    assert derived["category"] == "structural", derived

    # Honest: prover asserts the derived coordinate, amount within structural range.
    honest = signed_evidence({"category": "structural", "scope_qty": 14.0}, 3000000)
    v = adjudicate(estimate, honest, price_range_of)
    assert v["verdict"] == "pass", v
    assert v["bound_coordinate"]["category"] == "structural"

    # The escrow A/B shape: a truthful, pinned, reproducible read of the CHEAP category,
    # while the subject is structural. Every sub-layer green. Join must reject.
    wrong = signed_evidence({"category": "finish", "scope_qty": 14.0}, 400000)
    v2 = adjudicate(estimate, wrong, price_range_of)
    assert v2["checks"]["evidence_integrity"] is True
    assert v2["checks"]["canonical"] is True and v2["checks"]["reproducible"] is True
    assert v2["verdict"] == "reject" and v2["reason"] == "coordinate_chosen_by_prover", v2

    print("join_guard self_test: PASS")
    print("  derived coordinate:", derived["category"], "scope", derived["scope_qty"])
    print("  honest verdict:", v["verdict"], "bound", v["bound_coordinate"]["category"])
    print("  wrong-coordinate attack: sub-layers green, join verdict:", v2["verdict"], "reason:", v2["reason"])
    return 0

if __name__ == "__main__":
    sys.exit(self_test())
