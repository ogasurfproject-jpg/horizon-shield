#!/usr/bin/env python3
"""House style pass over Federico's second batch (commits 84fed5ac and 7dc5bff8): replace the six
em dashes with punctuation that carries the same meaning. Exact-match, each must occur once; refuses
to write otherwise. Run after the merge:

    python3 ops/fed_sections_dashfix2_20260906.py
"""
import io
import sys

PATH = "papers/nenrin-reproducibility/manuscript_v0.1.md"

PAIRS = [
    ("was run as a black box — `make_ring.py --verify` was executed against the committed history exports and its output compared against the eight published rings — and its header",
     "was run as a black box (`make_ring.py --verify` was executed against the committed history exports and its output compared against the eight published rings) and its header"),
    ("cited at the head of the reference builder — the same header read under condition (a) above,",
     "cited at the head of the reference builder, the same header read under condition (a) above,"),
    ("Layer 3 section alone — that section sketches",
     "Layer 3 section alone: that section sketches"),
    ("was the comparison — the reimplementation's rebuilt bytes",
     "was the comparison: the reimplementation's rebuilt bytes"),
    ("and the ring-v1 README — artifacts, not the specification.",
     "and the ring-v1 README, which are artifacts, not the specification."),
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
