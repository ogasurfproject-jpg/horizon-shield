#!/usr/bin/env python3
"""compare_probity: HORIZON SHIELD's APS 2.0 reader output beside Probity's independent reader, case by case.

    python3 tools/aps_compare/compare_probity.py                  # fetches Probity's report at the pinned commit
    python3 tools/aps_compare/compare_probity.py --report r.json  # offline, a copy of that report

Both readers ran on aeoess's frozen vectors (agent-passport-vectors-v2.json, commit 407ca2d5, sha256 9fce76db...).
Ours is closed source; verify-directory/admission/aps-v2/results-407ca2d5.json is its published output. Probity's is
public (probityai/agent-evidence-atlas, experiments/aps-corrected20-2026-10-10/report.json), pinned here by commit and
sha256. For every case this compares the final outcome, proof_of_possession and key_authority where our reader reports
them, and the resolver requests. Three outcomes are declared to differ, and are checked to differ exactly as declared:
did-web-resolver-not-found (ours invalid / key_authority rejected, following the SDK; Probity indeterminate /
unresolved, following draft-04 section 3.5), version-changed and record-type-changed (ours invalid, Probity
unsupported). Exit 0 when everything else agrees and the declared differences are exactly these; 1 otherwise.
It does not run either reader: it compares what each published. Standard library only.

Revision 2 (2026-10-12). aeoess published a second revision of the vectors (agent-passport-vectors-v2-r2.json, commit
e061462, sha256 9bd1f184...): the same twenty passports, preimages, keys and resolver table, with the three outcomes
above changed to what Probity reported. Our reader now follows revision 2; results-e061462.json is its output. The
second comparison holds that file beside Probity's report over revision 2 (probityai/agent-evidence at 055c2305,
site/experiments/aps-corrected20-r2-2026-10-27/report.json, sha256 70f806ad...), pinned by commit and sha256, and declares
no difference: all twenty must agree. Probity's revision 2 report is the same reader as its revision 1 report, run over
the e061462 file. The first comparison stays as it was, over results-407ca2d5.json (the published output of the reader
at 270502b) beside Probity's revision 1 report. By default both run, each against its own pinned report.
"""
import argparse, hashlib, json, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OURS = os.path.join(ROOT, "verify-directory", "admission", "aps-v2", "results-407ca2d5.json")
OURS_R2 = os.path.join(ROOT, "verify-directory", "admission", "aps-v2", "results-e061462.json")
VECTORS_R2_SHA256 = "9bd1f1849910c85f0555baf8efaa529aa9d057dce13c24606285b8643a003b89"
PROBITY_URL = ("https://raw.githubusercontent.com/probityai/agent-evidence-atlas/82436c01307d425960f3b3353af35a824a1d3b21/"
               "experiments/aps-corrected20-2026-10-10/report.json")
PROBITY_SHA256 = "1598f87559130cb0e7a2e4ca59e5d6a2a584b402149bc28baad30dd9eaa01df1"
PROBITY_R2_URL = ("https://raw.githubusercontent.com/probityai/agent-evidence/055c23052f51b0d9022d58311e563031f673b134/"
                  "site/experiments/aps-corrected20-r2-2026-10-27/report.json")
PROBITY_R2_SHA256 = "70f806adadeb42e659e5c2480f6beeb14e22bda9c4df125733a693ff178a4b88"
PROBITY_PIN = {1: (PROBITY_URL, PROBITY_SHA256, "82436c01"), 2: (PROBITY_R2_URL, PROBITY_R2_SHA256, "055c2305")}
VECTORS_SHA256 = "9fce76dbf13de9749a2ef52c8dedecce08e4874da0203b39a7d941eb479b5ac5"
DECLARED = {
    "did-web-resolver-not-found": {"ours": ("invalid", "rejected"), "probity": ("indeterminate", "unresolved")},
    "version-changed": {"ours": ("invalid", None), "probity": ("unsupported", None)},
    "record-type-changed": {"ours": ("invalid", None), "probity": ("unsupported", None)},
}


def fetch(url):
    req = urllib.request.Request(url, headers={"user-agent": "hs-aps-compare/0 (+https://github.com/ogasurfproject-jpg/horizon-shield)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def compare(ours, probity, declared=None, revision=1):
    """Returns (rows, problems). revision 1: our results over the 407ca2d5 vectors, three declared differences.
    revision 2: our results over the e061462 vectors (which supersede 407ca2d5), no declared difference."""
    declared = DECLARED if declared is None and revision == 1 else (declared or {})
    prob = []
    if revision == 1 and ours.get("vectors", {}).get("sha256") != VECTORS_SHA256:
        prob.append("our results are not over the 407ca2d5 vectors")
    if revision == 2 and (ours.get("vectors", {}).get("sha256") != VECTORS_R2_SHA256 or ours.get("vectors", {}).get("supersedes_sha256") != VECTORS_SHA256):
        prob.append("our results are not over the e061462 vectors (revision 2 of the 407ca2d5 file)")
    if revision == 1 and probity.get("fixtureSHA256") != VECTORS_SHA256:
        prob.append("Probity's report is not over the 407ca2d5 vectors")
    if revision == 2 and probity.get("fixtureSHA256") != VECTORS_R2_SHA256:
        prob.append("Probity's report is not over the e061462 vectors")
    theirs = {c["name"]: c for c in probity.get("cases", [])}
    rows = []
    for c in ours.get("cases", []):
        name, r = c["name"], c["reader"]
        t = theirs.pop(name, None)
        if t is None:
            prob.append("%s: not in Probity's report" % name)
            continue
        tl = t.get("layers", {})
        diffs = []
        if r.get("state") != t.get("readerOutcome"):
            diffs.append("outcome %s / %s" % (r.get("state"), t.get("readerOutcome")))
        if "proof_of_possession" in r and r["proof_of_possession"] != tl.get("proof_of_possession"):
            diffs.append("proof_of_possession %s / %s" % (r["proof_of_possession"], tl.get("proof_of_possession")))
        if "key_authority" in r and r["key_authority"] != tl.get("key_authority"):
            diffs.append("key_authority %s / %s" % (r["key_authority"], tl.get("key_authority")))
        if (c.get("resolver_requests") or []) != (t.get("resolverRequests") or []):
            diffs.append("resolver requests differ")
        d = declared.get(name)
        if d:
            want = d["ours"][0] == r.get("state") and d["probity"][0] == t.get("readerOutcome") \
                and (d["ours"][1] is None or (r.get("key_authority") == d["ours"][1] and tl.get("key_authority") == d["probity"][1]))
            other = [x for x in diffs if not x.startswith("outcome") and not x.startswith("key_authority")]
            ok = want and not other
            rows.append({"name": name, "status": "declared difference" if ok else "UNEXPECTED", "detail": diffs})
            if not ok:
                prob.append("%s: the declared difference is not what was published: %s" % (name, diffs))
        else:
            rows.append({"name": name, "status": "agree" if not diffs else "DIFFER", "detail": diffs})
            if diffs:
                prob.append("%s: %s" % (name, "; ".join(diffs)))
    for name in theirs:
        prob.append("%s: in Probity's report, not in ours" % name)
    return rows, prob


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--report", help="a local copy of Probity's report.json for the one revision chosen with --revision "
                                     "(else fetched at the pinned commit)")
    ap.add_argument("--ours", default=None, help="our results file (default: the one for the revision)")
    ap.add_argument("--revision", choices=("1", "2", "both"), default="both")
    a = ap.parse_args()
    if a.report and a.revision == "both":
        ap.error("--report is one revision's report: choose it with --revision 1 or --revision 2")
    failed = False
    for rev in ((1, 2) if a.revision == "both" else (int(a.revision),)):
        url, pinned, short = PROBITY_PIN[rev]
        raw = open(a.report, "rb").read() if a.report else fetch(url)
        if hashlib.sha256(raw).hexdigest() != pinned:
            print("Probity's revision %d report is not the pinned file (sha256 %s, pinned %s)" % (rev, hashlib.sha256(raw).hexdigest(), pinned))
            failed = True
            continue
        probity = json.loads(raw.decode("utf-8"))
        path = a.ours or (OURS if rev == 1 else OURS_R2)
        print("== revision %d: %s beside Probity's report at %s ==" % (rev, os.path.basename(path), short))
        rows, prob = compare(json.load(open(path, encoding="utf-8")), probity, revision=rev)
        for r in rows:
            print("%-36s %-20s %s" % (r["name"], r["status"], "; ".join(r["detail"])))
        agree = sum(r["status"] == "agree" for r in rows)
        declared = sum(r["status"] == "declared difference" for r in rows)
        print("\n%d agree, %d declared differences as declared, %d problems\n" % (agree, declared, len(prob)))
        for p in prob:
            print("PROBLEM " + p)
        failed = failed or bool(prob)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
