#!/usr/bin/env python3
"""Summarise coordinate_derivation across gate /history exports (paper 2, Table 2 and Section 9).

Fetches nothing. Reads the JSON files you pass (fresh exports from the gate, kept outside the repo):

    python3 ops/history_cd_summary.py /tmp/hist/*.json

Per file: entries, first and last "at", how many verdicts carry a coordinate_derivation block,
how many of those are derived (beacon present), how many fell back, and the fallback reasons.
"""
import collections
import json
import sys


def main(paths):
    grand = collections.Counter()
    for p in sorted(paths):
        d = json.load(open(p, encoding="utf-8"))
        es = d.get("entries") or []
        ats = sorted(e.get("at", "") for e in es if e.get("at"))
        withcd = derived = fallback = 0
        reasons = collections.Counter()
        since_030 = 0
        for e in es:
            if e.get("at", "") >= "2026-09-05T01:51:20Z":
                since_030 += 1
            cd = e.get("coordinate_derivation")
            if not isinstance(cd, dict):
                continue
            withcd += 1
            if cd.get("derived") and isinstance(cd.get("beacon"), dict):
                derived += 1
            else:
                fallback += 1
                reasons[str(cd.get("fallback") or cd.get("reason") or cd.get("mode") or sorted(cd.keys()))] += 1
        grand.update(entries=len(es), since_030=since_030, withcd=withcd, derived=derived, fallback=fallback)
        print("%-34s entries %3d  %s .. %s  since_0.3.0 %d  cd %d  derived %d  fallback %d"
              % (p.rsplit("/", 1)[-1], len(es), ats[0][:19] if ats else "", ats[-1][:19] if ats else "",
                 since_030, withcd, derived, fallback))
        for r, n in reasons.most_common():
            print("      fallback %d: %s" % (n, r))
        if es:
            last = es[-1]
            cd = last.get("coordinate_derivation")
            print("      last: at %s status %s cd_keys %s" % (last.get("at"), last.get("status"),
                  sorted(cd.keys()) if isinstance(cd, dict) else None))
    print("TOTAL entries %d, since 0.3.0 deploy %d, with coordinate_derivation %d, derived %d, fallback %d"
          % (grand["entries"], grand["since_030"], grand["withcd"], grand["derived"], grand["fallback"]))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
