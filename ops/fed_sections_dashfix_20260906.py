#!/usr/bin/env python3
"""House style pass over Federico's Sections 4.2 and 6 (commit 18862488): replace the nine
em dashes with punctuation that carries the same meaning. Each replacement is exact-match and
must occur exactly once; the script refuses to write if any of them does not. Run after the merge:

    python3 ops/fed_sections_dashfix_20260906.py

Prints the count of dashes before and after. Meaning unchanged; if a replacement changed the
sense, that is a bug in this file, not in the manuscript."""
import io
import sys

PATH = "papers/nenrin-reproducibility/manuscript_v0.1.md"

PAIRS = [
    ("the canonicalization rule — nothing else.",
     "the canonicalization rule, and nothing else."),
    ("the seam reported in Section 6 — a shared runtime could have inherited",
     "the seam reported in Section 6: a shared runtime could have inherited"),
    ("differs from sorted order — which, for this schema, is most of them.",
     "differs from sorted order, which, for this schema, is most of them."),
    ("an explicit recursive key sort — every plain object's keys sorted, every array's own order left untouched — immediately before serialization",
     "an explicit recursive key sort (every plain object's keys sorted, every array's own order left untouched) immediately before serialization"),
    ("| no — every fixed schema field name is ASCII,",
     "| no; every fixed schema field name is ASCII,"),
    ("| emitted raw — `JSON.stringify` has no ASCII-escaping mode",
     "| emitted raw; `JSON.stringify` has no ASCII-escaping mode"),
    ("| not yet — August 2026 is the first ring,",
     "| not yet; August 2026 is the first ring,"),
    ("simply didn't need to run — it is a piece of the reimplementation",
     "simply didn't need to run; it is a piece of the reimplementation"),
]

FORBIDDEN = "‒–—―−－"


def main():
    text = io.open(PATH, encoding="utf-8").read()
    before = sum(text.count(c) for c in FORBIDDEN)
    print("forbidden dashes before:", before)
    for old, new in PAIRS:
        n = text.count(old)
        if n != 1:
            sys.exit("expected exactly one match, found %d: %r" % (n, old[:60]))
    for old, new in PAIRS:
        text = text.replace(old, new)
    after = sum(text.count(c) for c in FORBIDDEN)
    print("forbidden dashes after:", after)
    if after != 0:
        for i, line in enumerate(text.splitlines(), 1):
            if any(c in line for c in FORBIDDEN):
                print("  line", i, ":", line[:120])
        sys.exit("dashes remain; not writing")
    io.open(PATH, "w", encoding="utf-8", newline="\n").write(text)
    print("written:", PATH)


if __name__ == "__main__":
    main()
