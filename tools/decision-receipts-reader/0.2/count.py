import json, os, re, sys, glob

S, V = sys.argv[1], sys.argv[2]
exp = {}
kind = {}
files = [os.path.join(S, "expected.json"), os.path.join(S, "cose/expected-cose.json"),
         os.path.join(S, "approver-signature/expected-sa.json"), os.path.join(S, "first-check/expected-first.json")]
files += sorted(glob.glob(os.path.join(S, "expected-10/*.json"))) + sorted(glob.glob(os.path.join(S, "expected-08/*.json")))
for f in files:
    for v in json.load(open(f, encoding="utf-8"))["vectors"]:
        exp[v["name"]] = (v["expected"], v["text_result"])
        argv = (v.get("verifier") or {}).get("argv") or [""]
        kind[v["name"]] = argv[0]

ORD = {"first": 1, "second": 2, "third": 3}


def canon_exp(e, t):
    t0 = t.split(" (")[0]
    alt = re.findall(r"\(step (\d+) of ([0-9A-Z.]+)\)", t)
    if e == "pass":
        return [("pass",)]
    if e == "fail":
        m = re.match(r"fail at step (\d+) of ([0-9A-Z.]+)", t0)
        if m:
            r = [("fail", m.group(2), "step", int(m.group(1)))]
            r += [("fail", s, "step", int(n)) for n, s in alt]
            return r
        m = re.match(r"fail at [Cc]ase (\d+)(?: of 3\.3)?", t0)
        if m:
            return [("fail", "3.3", "case", int(m.group(1)))]
        m = re.match(r"fail at approver signature, check (\d+)", t0)
        if m:
            return [("fail", "3.11", "check", int(m.group(1)))]
    if e == "auditor-fail":
        m = re.search(r"(first|second|third) check", t0)
        return [("fail", "3.5", ORD[m.group(1)])]
    if e == "input-invalid":
        return [("invalid",)]
    if e == "refuse":
        m = re.search(r"Section 4,? item (\d+)", t0)
        return [("refused", "4", int(m.group(1)))]
    if e == "no-result":
        return [("no result",)]
    return [("?", e, t)]


def canon_ours(r):
    res, st = r.get("result"), r.get("step") or ""
    if res == "pass":
        return ("pass",)
    if res == "fail":
        m = re.match(r"([0-9A-Z.]+) step (\d+)$", st)
        if m:
            return ("fail", m.group(1), "step", int(m.group(2)))
        m = re.match(r"3\.3 case (\d+)$", st)
        if m:
            return ("fail", "3.3", "case", int(m.group(1)))
        m = re.match(r"3\.5 (first|second|third) check$", st)
        if m:
            return ("fail", "3.5", ORD[m.group(1)])
        if st.startswith("approver signature"):
            m = re.search(r"check (\d+)", st + " " + str(r.get("why", "")))
            return ("fail", "3.11", "check", int(m.group(1)) if m else None)
    if res == "refused":
        m = re.search(r"Section 4 item (\d+)", st)
        return ("refused", "4", int(m.group(1)) if m else None)
    if res == "invalid input":
        return ("invalid",)
    if res == "no result":
        return ("no result",)
    return ("?", res, st)


ours = json.load(open(V, encoding="utf-8"))["results"]
agree, cose_map, dis, missing = 0, [], [], []
for name, (e, t) in sorted(exp.items()):
    if name not in ours:
        missing.append(name)
        continue
    o = canon_ours(ours[name])
    c = canon_exp(e, t)
    if o in c:
        agree += 1
        continue
    # Appendix B.5 of -11: a step of B.3 that cose/expected-cose.json names for a decision receipt is the step of
    # the same number of Section 3.2; for an outcome receipt, of Section 3.4
    sec = {"decision": "3.2", "outcome": "3.4"}.get(kind.get(name))
    if sec and len(o) == 4 and o[1] == sec and ("fail", "B.3", "step", o[3]) in c:
        cose_map.append((name, t, ours[name].get("step")))
        continue
    dis.append((name, e, t, ours[name].get("result"), ours[name].get("step"), str(ours[name].get("why", ""))[:160]))
print("expected entries %d, verdicts %d, not in verdicts %d" % (len(exp), len(ours), len(missing)))
print("agree on result and step: %d / %d" % (agree, len(exp)))
print("agree by Appendix B.5 of -11 (the package names step n of B.3, dr_check names step n of Section 3.2 for a "
      "decision receipt or of Section 3.4 for an outcome receipt): %d" % len(cose_map))
for x in cose_map:
    print("  B5  %s | expected: %s | ours: %s" % x)
print("agree in all: %d / %d" % (agree + len(cose_map), len(exp)))
print("disagree: %d" % len(dis))
for x in dis:
    print("  DIS %s | expected %s: %s | ours %s: %s | why: %s" % x)
extra = sorted(set(ours) - set(exp))
print("verdicts without an expected entry: %d %s" % (len(extra), extra[:10]))
