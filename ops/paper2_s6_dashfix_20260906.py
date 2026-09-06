#!/usr/bin/env python3
"""House style pass after merging PR #20 (Section 6 by F.B.S.L.) into papers/nenrin-coordinate/manuscript_v0.1.md.

Three things, all exact match, each string must occur exactly once or nothing is written:
  1. seven em dashes in Section 6 become commas, colons or parentheses (meaning unchanged);
  2. the last paragraph of T.O.'s placeholder, which the PR left behind under the new Section 6, is removed
     (it is T.O.'s text, not F.B.S.L.'s, and it now repeats his paragraphs);
  3. the division of work note stops calling Section 6 a placeholder.

Run from ~/horizon-shield after the merge:

    python3 ops/paper2_s6_dashfix_20260906.py

Dry run against another copy:  python3 ops/paper2_s6_dashfix_20260906.py --check /tmp/p2_pr20.md
"""
import io
import re
import sys

PATH = "papers/nenrin-coordinate/manuscript_v0.1.md"
EM = "—"
FORBIDDEN = "‒–—―−－─"

PAIRS = [
    ("rather than the honest case " + EM + " a review that only tests the case a fix was built for",
     "rather than the honest case: a review that only tests the case a fix was built for"),
    ("suppress a legitimate reject; the correction " + EM + " the reference tip is the quorum-th highest reachable reading, not the maximum of whatever answers " + EM + " closes exactly that seam",
     "suppress a legitimate reject; the correction (the reference tip is the quorum-th highest reachable reading, not the maximum of whatever answers) closes exactly that seam"),
    ("resolves to Bitcoin block 965,447 " + EM + " the same block the from-genesis header file holds",
     "resolves to Bitcoin block 965,447, the same block the from-genesis header file holds"),
    ("Entry 31 is the fix, not a courtesy " + EM + " a refusal that only a human reading the specification",
     "Entry 31 is the fix, not a courtesy: a refusal that only a human reading the specification"),
    ("for a different, narrower reason " + EM + " closing a backdating gap on our own `/review` verdicts " + EM + " before the instant coordinate's gaming analysis",
     "for a different, narrower reason, closing a backdating gap on our own `/review` verdicts, before the instant coordinate's gaming analysis"),
    ("He then verified the sources and header-chain entries independently, re-hashing the raw bytes and deserialising the OpenTimestamps proofs with his own library, and found the sources addendum confirmed in Bitcoin block 965,447, the block that the from-genesis chain file later held at its offset with the same hash. His question about whether the two-chains refusal was queryable or only legible produced the refusals addendum and the refusal record on the ledger. His record-level derivation on his own review endpoint is the move the specification generalises, and his freshness beacon is the commit-reveal shape the instant addendum narrows its claim against.\n\n",
     ""),
    ("Section 6 and the witness half of Section 4.3 are his to write, and the current text there is a placeholder drafted from the anchored records for him to replace.",
     "Section 6 is his, written in his own voice from the anchored entries; the witness half of Section 4.3 was drafted by T.O. from the same entries and checked by F.B.S.L. against them."),
]


def apply(text):
    for a, b in PAIRS:
        n = text.count(a)
        if n != 1:
            sys.exit("expected exactly one match, found %d: %r" % (n, a[:80]))
        if any(c in b for c in FORBIDDEN):
            sys.exit("forbidden dash in replacement text")
    for a, b in PAIRS:
        text = text.replace(a, b)
    return text


def main():
    check = "--check" in sys.argv
    path = sys.argv[sys.argv.index("--check") + 1] if check else PATH
    text = io.open(path, encoding="utf-8").read()
    before = sum(text.count(c) for c in FORBIDDEN)
    out = apply(text)
    after = sum(out.count(c) for c in FORBIDDEN)
    words = len(re.findall(r"\S+", out))
    if check:
        print("dry run ok: forbidden %d -> %d, words %d, leftover paragraph %d -> %d"
              % (before, after, words, text.count("He then verified the sources"), out.count("He then verified the sources")))
        return
    if after != 0:
        sys.exit("forbidden dashes remain (%d); not writing" % after)
    io.open(path, "w", encoding="utf-8", newline="\n").write(out)
    print("written: forbidden %d -> 0, words %d" % (before, words))


if __name__ == "__main__":
    main()
