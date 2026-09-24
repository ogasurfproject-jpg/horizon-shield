#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Closes the first step of the SEP-3004 caller-governance delta-loss demonstration.
#
# sep3004_replay.py proved record -> protected preimage -> a795c1d9, but its two source records were
# already byte-identical, so it never showed WHY two different authority decisions land on the same
# record. This script derives the event record FROM the raw decisions, independently, so the
# "different decisions -> identical record" transition is re-run, not assumed.
#
# The protected projection below (protected_view / canonical_bytes / event_hash) is copied verbatim
# from sep3004_replay.py so the second half stays byte-identical to the already-confirmed replay;
# diff them to check.
import json, hashlib, sys

REGISTERED_CG = {"session_id", "invoked_by_principal_id", "purpose_declared", "flagged"}


def protected_view(record):
    r = dict(record)
    r.pop("event_hash", None)
    exts = r.get("extensions")
    if isinstance(exts, dict):
        e = dict(exts)
        cg = e.get("caller-governance")
        if isinstance(cg, dict):
            e["caller-governance"] = {k: v for k, v in cg.items() if k in REGISTERED_CG}
        r["extensions"] = e
    return r


def canonical_bytes(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def event_hash(record):
    b = canonical_bytes(protected_view(record))
    return b, hashlib.sha256(b).hexdigest()


# --- the new half: derive the record from the raw authority decision ---
def effective(decision):
    """Host authority intersection: effective = requested AND hostAllowed, request order kept.
    This is the host's own rule; recomputing it needs no external spec."""
    allowed = set(decision.get("hostAllowed") or [])
    return [a for a in (decision.get("requested") or []) if a in allowed]


def build_record(decision, template):
    """Build the witnessed event record for the decision. The record carries the OUTCOME and the
    declared purpose, and none of the authority arrays (requested / hostAllowed / effective). That
    omission is where the caller-governance delta is lost: the arrays never enter the record, so two
    decisions with the same effective-read produce the same record."""
    eff = effective(decision)
    rec = dict(template)
    rec["outcome"] = "allowed" if "read" in eff else "denied"
    return rec, eff


def main():
    fx = sys.argv[1] if len(sys.argv) > 1 else "SEP3004_CURRENT_HEAD_PROJECTION.fixture.json"
    d = json.load(open(fx))
    decA, decB = d["decisionA"], d["decisionB"]
    cg = d["currentRegisteredCallerGovernance"]
    expected_hash = cg["eventHashA"]
    template = {k: v for k, v in cg["recordA"].items() if k not in ("event_hash", "outcome")}

    print("=== 1. the two decisions are genuinely different (raw inputs) ===")
    print("decisionA requested/hostAllowed:", decA["requested"], "/", decA["hostAllowed"])
    print("decisionB requested/hostAllowed:", decB["requested"], "/", decB["hostAllowed"])
    print("decisionA == decisionB (raw):", decA == decB)
    print("fixture externalProfileSeparation says commitments differ:",
          d["externalProfileSeparation"]["commitmentsDifferent"])
    print()

    print("=== 2. effective = requested AND hostAllowed, re-derived here ===")
    recA, effA = build_record(decA, template)
    recB, effB = build_record(decB, template)
    print("effective(A):", effA, " matches fixture decisionA.effective:", effA == decA["effective"])
    print("effective(B):", effB, " matches fixture decisionB.effective:", effB == decB["effective"])
    print("both collapse to the same effective:", effA == effB)
    print()

    print("=== 3. record built from each decision (not taken from the fixture) ===")
    print("record(A) == record(B) byte-identical:", canonical_bytes(recA) == canonical_bytes(recB))
    print("the record carries no authority arrays; only outcome =", recA["outcome"], "and purpose")
    print()

    print("=== 4. each derived record projects to the witnessed preimage ===")
    bA, hA = event_hash(recA)
    bB, hB = event_hash(recB)
    print("event_hash(record from A):", hA, "== a795c1d9...:", hA == expected_hash)
    print("event_hash(record from B):", hB, "== a795c1d9...:", hB == expected_hash)
    print("preimage length:", len(bA), "bytes")
    print()

    ok = (decA != decB and effA == effB == ["read"] and
          canonical_bytes(recA) == canonical_bytes(recB) and hA == expected_hash and hB == expected_hash)

    print("=== honest limit ===")
    print("The external decision digests differ and are NOT recomputed here; recomputing them needs")
    print("the external decision spec (auec-authority-delta-c14n-v2_1), which is that layer, not this one:")
    print("  A:", decA["externalDecisionDigest"])
    print("  B:", decB["externalDecisionDigest"])
    print("Re-derived here: the intersection rule (both effective=read) and the record construction")
    print("that omits the authority arrays, which is where the delta is actually lost.")
    print()
    print("CLOSED (derivable half):", ok)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
