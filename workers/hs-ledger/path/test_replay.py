#!/usr/bin/env python3
"""Local proof for jidec_path.py --replay — no network. Anchor a path from a
fixture, then replay against (a) identical live => MATCH, (b) mutated live =>
DRIFT pinpointed to the right node."""
import sys, jidec_path as jp, test_jidec_path as t

BASE, PDFGEN = t.BASE, t.PDFGEN

def anchor_reference():
    # walk once against the OK fixture => this is our anchored observation
    res = t.run(t.CANARY_OK, t.ENTRY4_SRC_OK, walked_at="2026-07-25T10:00:00Z")
    return res["presented"]

def replay_against(canary, entry4):
    anchored = anchor_reference()
    return jp.replay(
        anchored, BASE, PDFGEN,
        transport=t.make_transport(canary, entry4),
        clock=t.fixed_clock,
    )

def main():
    fails = []

    # A. identical live => no drift
    a = replay_against(t.CANARY_OK, t.ENTRY4_SRC_OK)
    print("A no-drift:", a["drift"], "| verdicts", a["anchored_verdict"], a["fresh_verdict"])
    if a["drift"]:
        fails.append("identical live reported drift")

    # B. /canary drifted (node 0 fetch + node 1 compute change)
    b = replay_against(t.CANARY_DRIFT, t.ENTRY4_SRC_OK)
    changed_b = [d["n"] for d in b["diffs"] if d["changed"]]
    print("B canary-drift:", b["drift"], "| changed nodes:", changed_b,
          "| verdicts", b["anchored_verdict"], b["fresh_verdict"])
    if not b["drift"]:
        fails.append("canary drift not detected")
    if 0 not in changed_b:
        fails.append("canary drift did not flag node 0")
    if b["fresh_verdict"] != "FAIL":
        fails.append("canary drift fresh verdict should be FAIL")

    # C. anchored entry-#4 source drifted (node 2 immutable) => alarming
    src_tampered = b"var HS_AUDIT_CANARY_EXPECT = { hash: \"DEADBEEFDEADBEEF\" };\n"
    c = replay_against(t.CANARY_OK, src_tampered)
    changed_c = [d["n"] for d in c["diffs"] if d["changed"]]
    imm_changed = [d["n"] for d in c["diffs"] if d["changed"] and d["immutable"]]
    print("C source-drift:", c["drift"], "| changed nodes:", changed_c,
          "| immutable changed:", imm_changed)
    if 2 not in changed_c:
        fails.append("source drift did not flag node 2")
    if 2 not in imm_changed:
        fails.append("source drift not marked immutable/alarming")

    print()
    if fails:
        print("FAIL:")
        for f in fails: print("  -", f)
        return 1
    print("ALL PASS (3/3 replay scenarios)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
