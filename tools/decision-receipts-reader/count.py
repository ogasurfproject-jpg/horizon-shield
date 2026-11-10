"""count.py (dr_check 0.1.1): counts the vectors where the verdicts of dr_check.py agree with expected.json of the
author's test package, on the result (pass, fail or refused) and on the failing step or the Section 4 item.
Usage: python3 -I -B count.py <out_dir>/gruszka06_verdicts.json <package_dir>/expected.json
Prints "<agree>/<total> vectors agree (result and step)" and one line for each vector that does not. Exit 0 only
when every vector agrees and every vector of the verdicts that expected.json does not name was not run (its files
are not in this package). Python standard library only."""
import json, re, sys


def norm_exp(t):
    if t.startswith("pass"):
        return ("pass", None)
    m = re.match(r"fail at step (\d+) of (3\.[24])$", t)
    if m:
        return ("fail", "%s step %s" % (m.group(2), m.group(1)))
    m = re.match(r"fail at Case (\d) of 3\.3$", t)
    if m:
        return ("fail", "3.3 case " + m.group(1))
    m = re.match(r"refused under Section 4 item (\d) after a pass$", t)
    if m:
        return ("refused", "Section 4 item " + m.group(1))
    return ("?", t)


def main():
    ours = json.load(open(sys.argv[1]))["results"]
    exp = json.load(open(sys.argv[2]))["vectors"]
    agree, bad = 0, []
    for e in exp:
        n = e["name"]
        o = ours.get(n)
        want = norm_exp(e["text_result"])
        got = (o["result"], o["step"]) if o else ("missing", None)
        if want == got:
            agree += 1
        else:
            bad.append("%s: expected %s, dr_check %s" % (n, want, got))
    names = {e["name"] for e in exp}
    extra = sorted(n for n in set(ours) - names if ours[n]["result"] != "not run")
    absent = sorted(n for n in set(ours) - names if ours[n]["result"] == "not run")
    print("%d/%d vectors agree (result and step)" % (agree, len(exp)))
    for b in bad:
        print("  " + b)
    for n in extra:
        print("  %s: in the verdicts, not in expected.json" % n)
    for n in absent:
        print("  %s: not in this package, not run" % n)
    return 0 if agree == len(exp) and not extra else 1


if __name__ == "__main__":
    sys.exit(main())
