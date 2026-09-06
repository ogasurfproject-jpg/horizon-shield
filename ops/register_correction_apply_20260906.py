#!/usr/bin/env python3
"""Append the 2026-09-06 correction line to mcp-conduct-register/README.md, directly after the
"2026-09-05 (update)" line. Earlier lines are not touched; corrections are appended, never rewritten.
Refuses to run twice. Run from anywhere:

    python3 ~/horizon-shield/ops/register_correction_apply_20260906.py
"""
import io
import os
import sys

PATH = os.path.expanduser("~/mcp-conduct-register/README.md")
ANCHOR = "- 2026-09-05 (update):"
MARK = "- 2026-09-06 (correction to the 2026-09-05 update above"

LINE = ("- 2026-09-06 (correction to the 2026-09-05 update above; that line stays as written): two phrases in it claim more than the "
        "record supports and are narrowed here, with the reimplementer's agreement. \"From Layer 3 of NENRIN_SPEC_v1.md alone\": the "
        "specification's Layer 3 sketch names 11 of a ring's 20 fields and does not state the canonical form at all; the remaining fields "
        "and the byte rules were taken from the published ring files in this repository, read before the reimplementation was written. "
        "\"Without ever seeing this repository's source\": in the recompute recorded two lines above, the reimplementer had cloned this "
        "repository, executed `scripts/make_ring.py --verify` as a black box, and read its docstring header for the specification hash it "
        "cites; the body of `make_ring.py`, the logic that turns history entries into ring fields, was not read before or during the "
        "reimplementation. What was blind was the byte comparison: the rebuilt bytes were not checked against the eight published rings "
        "until the verify run reported match or mismatch. The full account, written by the reimplementer, is Section 4.2 of "
        "papers/nenrin-reproducibility/manuscript_v0.1.md in github.com/ogasurfproject-jpg/horizon-shield. Ledger entry 34 stays as anchored, "
        "including its field `implementation_2_source_seen`; a correction record that cites it is appended to the same ledger.")


def main():
    text = io.open(PATH, encoding="utf-8").read()
    if MARK in text:
        sys.exit("correction line already present; nothing to do")
    lines = text.split("\n")
    hits = [i for i, l in enumerate(lines) if l.startswith(ANCHOR)]
    if len(hits) != 1:
        sys.exit("expected exactly one anchor line, found %d" % len(hits))
    lines.insert(hits[0] + 1, LINE)
    out = "\n".join(lines)
    if any(c in LINE for c in "\u2014\u2013\u2015\u2500\u2501\uff0d"):
        sys.exit("forbidden dash in the new line; not writing")
    io.open(PATH, "w", encoding="utf-8", newline="\n").write(out)
    print("inserted after line", hits[0] + 1, "of", PATH)


if __name__ == "__main__":
    main()
