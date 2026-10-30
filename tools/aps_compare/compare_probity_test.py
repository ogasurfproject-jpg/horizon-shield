#!/usr/bin/env python3
"""compare_probity_test: the comparison on a report built here from our own results (no network), and the ways it must
refuse: a case that disagrees, a declared difference that is not as declared, a missing case, other vectors; and the
same for the revision 2 results, where nothing is declared."""
import copy, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import compare_probity as C  # noqa: E402

ours = json.load(open(C.OURS, encoding="utf-8"))
results = []


def t(name, ok):
    results.append((name, bool(ok)))


def probity_from(o, declared=True, sha=None):
    """A report shaped like Probity's, saying what Probity published: our outcomes, except the three declared
    (revision 1; revision 2 declares nothing)."""
    cases = []
    for c in o["cases"]:
        r = c["reader"]
        layers = {"proof_of_possession": r.get("proof_of_possession", False), "key_authority": r.get("key_authority", "not_checked")}
        out = r["state"]
        d = C.DECLARED.get(c["name"]) if declared else None
        if d:
            out = d["probity"][0]
            if d["probity"][1]:
                layers["key_authority"] = d["probity"][1]
        cases.append({"name": c["name"], "readerOutcome": out, "layers": layers, "resolverRequests": c.get("resolver_requests") or []})
    return {"fixtureSHA256": sha or C.VECTORS_SHA256, "cases": cases}


P = probity_from(ours)
rows, prob = C.compare(ours, P)
t("our published results beside a report that says what Probity published: 17 agree, 3 declared, no problem",
  not prob and sum(r["status"] == "agree" for r in rows) == 17 and sum(r["status"] == "declared difference" for r in rows) == 3)
o2 = copy.deepcopy(ours)
next(c for c in o2["cases"] if c["name"] == "expired")["reader"]["state"] = "valid"
t("one case whose outcome differs is a problem", any(p.startswith("expired:") for p in C.compare(o2, P)[1]))
p2 = copy.deepcopy(P)
next(c for c in p2["cases"] if c["name"] == "version-changed")["readerOutcome"] = "indeterminate"
t("a declared difference that is not as declared is a problem", any("version-changed" in p for p in C.compare(ours, p2)[1]))
p3 = copy.deepcopy(P)
next(c for c in p3["cases"] if c["name"] == "valid-did-web-resolved")["resolverRequests"] = []
t("resolver requests that differ are a problem", any("resolver requests" in p for p in C.compare(ours, p3)[1]))
p4 = copy.deepcopy(P)
p4["cases"] = p4["cases"][:-1]
t("a case missing from the report is a problem", any("not in Probity" in p for p in C.compare(ours, p4)[1]))
p5 = dict(P, fixtureSHA256="0" * 64)
t("a report over other vectors is a problem", any("not over the 407ca2d5" in p for p in C.compare(ours, p5)[1]))
ours2 = json.load(open(C.OURS_R2, encoding="utf-8"))
P_r1 = probity_from(ours)                       # what Probity published, over revision 1
P_r2 = probity_from(ours2, declared=False, sha=C.VECTORS_R2_SHA256)   # what Probity published, over revision 2
rows2, prob2 = C.compare(ours2, P_r2, revision=2)
t("revision 2: our published results beside Probity's revision 2 report: 20 agree, nothing declared, no problem",
  not prob2 and sum(r["status"] == "agree" for r in rows2) == 20)
o3 = copy.deepcopy(ours2)
next(c for c in o3["cases"] if c["name"] == "version-changed")["reader"]["state"] = "invalid"
t("revision 2: the revision 1 outcome on a superseded case is now a problem", any(p.startswith("version-changed:") for p in C.compare(o3, P_r2, revision=2)[1]))
t("revision 2: a report over the revision 1 vectors is refused", any("not over the e061462" in p for p in C.compare(ours2, P_r1, revision=2)[1]))
t("the pinned revision 2 report is named by commit and sha256", C.PROBITY_PIN[2][2] == "055c2305" and len(C.PROBITY_R2_SHA256) == 64 and "055c23052f51b0d9022d58311e563031f673b134" in C.PROBITY_R2_URL)
t("revision 2: results over revision 1 are refused as revision 2", any("e061462" in p for p in C.compare(ours, P_r2, revision=2)[1]))
t("revision 2: our results name the reader commit, the file sha and the superseded vectors", ours2["reader"]["commit"] and len(ours2["reader"]["file_sha256"]) == 64
  and ours2["vectors"]["supersedes_sha256"] == C.VECTORS_SHA256 and ours2["summary"] == {"cases": 20, "agree_with_sdk_on_state_and_code": 20})
t("our results name the closed reader, its commit and file sha, and the vectors", ours["reader"]["commit"] and len(ours["reader"]["file_sha256"]) == 64 and ours["summary"] == {"cases": 20, "agree_with_sdk_on_state_and_code": 20})

bad = [n for n, ok in results if not ok]
for n, ok in results:
    print(("ok    " if ok else "FAIL  ") + n)
print("\n%d/%d passed" % (len(results) - len(bad), len(results)))
sys.exit(1 if bad else 0)
