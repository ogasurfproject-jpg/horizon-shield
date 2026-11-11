#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
The contract door in two runtimes: contract_v0.py (the reference) and contract_door_v0.mjs must give every contract
the same verdict and the same refusal codes, and every pair of grants the same number of subset violations.

The corpus is fixtures/contract_door/corpus.json: signed contracts whose grant keeps or breaks one rule, one signed
contract edited in one place, junk, delegated children, and pairs of grants. Both runtimes read the same file.
fixtures/contract_door/terms_corpus.json (gen_contract_door_terms.py, 2026-11-09) adds the same for grant.payload_schema
and grant.exposure, and payloads: payload_problems must give the same codes in both runtimes.

  python3 contract_door_check.py
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import contract_v0 as v0

CORPUS = os.path.join(HERE, "fixtures", "contract_door", "corpus.json")
TERMS = os.path.join(HERE, "fixtures", "contract_door", "terms_corpus.json")


def py_door(c, parent):
    try:
        out = v0.verify_contract(c, parent=parent)
        return out["verdict"], sorted(x["code"] for x in out["refusals"])
    except Exception:
        return "refused", ["unreadable"]


def py_payload(c, a, p):
    try:
        return v0.payload_problems(c, a, p)
    except Exception:
        return ["unreadable"]


def run(verify=None, subset=None, corpus=CORPUS, payload=None):
    """Returns (doors compared, accepted, subsets compared, differences, payloads compared). verify, subset and payload replace
    the reference, for the mutants."""
    verify, subset, payload = verify or py_door, subset or v0.grant_subset, payload or py_payload
    K = json.load(open(corpus, encoding="utf-8"))
    r = subprocess.run(["node", os.path.join(HERE, "contract_door_v0.mjs"), "--parts", corpus], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("node failed: " + r.stderr[-800:])
    J = json.loads(r.stdout)
    diffs, accepted = [], 0
    for x, jd in zip(K["doors"], J["doors"]):
        pv, pc = verify(x["contract"], x["parent"])
        jv, jc = jd["verdict"], sorted(jd["refusals"])
        soft = "unreadable" in pc or "unreadable" in jc               # one runtime could not read it at all: the verdict must still agree
        accepted += pv == "accepted"
        if pv != jv or not (soft or pc == jc):
            diffs.append("door %-50s py %s %s   js %s %s" % (x["label"], pv, pc, jv, jc))
    for x, jn in zip(K["subsets"], J["subsets"]):
        try:
            pn = len(subset(x["child"], x["parent"]))
        except Exception:
            pn = None
        if not ((jn > 0) if pn is None else (pn == jn)):               # where the reference raises, the twin must not say "within"
            diffs.append("subset py %s js %s child %s" % (pn, jn, json.dumps(x["child"], default=str)[:160]))
    for x, jp in zip(K.get("payloads", []), J.get("payloads", [])):
        pp = payload(x["contract"], x["action"], x["payload"])
        if pp != jp:
            diffs.append("payload py %s js %s payload %s" % (pp, jp, json.dumps(x["payload"], default=str)[:120]))
    return len(K["doors"]), accepted, len(K["subsets"]), diffs, len(K.get("payloads", []))


def main():
    n, accepted, m, diffs, _ = run()
    for d in diffs:
        print("NG   " + d)
    print("contract door: %d contracts (%d accepted, %d refused), verdict and refusal codes %s" % (n, accepted, n - accepted, "identical" if not diffs else "DIFFER"))
    print("delegation: %d pairs of grants, the number of violations %s" % (m, "identical" if not diffs else "DIFFER"))
    if diffs or accepted < 10 or n - accepted < 60:
        print("FAILED: %d differences" % len(diffs)); return 1
    tn, ta, tm, tdiffs, tp = run(corpus=TERMS)
    for d in tdiffs:
        print("NG   " + d)
    print("payload_schema and exposure: %d contracts (%d accepted, %d refused), %d pairs of grants, %d payloads, %s" % (
        tn, ta, tn - ta, tm, tp, "identical" if not tdiffs else "DIFFER"))
    if tdiffs or ta < 20 or tn - ta < 40 or tp < 30:
        print("FAILED: %d differences" % len(tdiffs)); return 1
    # a check that cannot fail proves nothing: two wrong references, each of which must be noticed
    real = v0.grant_type_problems
    loose = lambda g: [x for x in real(g) if "limits" not in x[1]]
    v0.grant_type_problems = loose
    try:
        m1 = len(run()[3])
    finally:
        v0.grant_type_problems = real
    m2 = len(run(verify=lambda c, parent: ("accepted", []))[3])
    print("mutant  a reference that does not type grant.limits: %d differences noticed; a reference that accepts everything: %d noticed" % (m1, m2))
    if not (m1 and m2):
        print("FAILED: a wrong reference passed"); return 1
    v0.grant_type_problems = lambda g: [x for x in real(g) if "payload_schema" not in x[1]]
    try:
        m3 = len(run(corpus=TERMS)[3])
    finally:
        v0.grant_type_problems = real
    m4 = len(run(corpus=TERMS, payload=lambda c, a, p: [])[3])
    print("mutant  a reference that does not type grant.payload_schema: %d differences noticed; a reference that lets every payload through: %d noticed" % (m3, m4))
    if not (m3 and m4):
        print("FAILED: a wrong reference passed"); return 1
    print("ALL PASS (contract_door_check: %d contract door verdicts and %d delegation checks identical in Python and JavaScript, and %d, %d and %d payloads "
          "for payload_schema and exposure; 4 wrong references noticed)" % (n, m, tn, tm, tp))
    return 0


if __name__ == "__main__":
    sys.exit(main())
