#!/usr/bin/env python3
"""After SSRN submission (abstract 7419998, 2026-09-06): record it in the manuscript header and in llms.txt.
Exact-match, each once; refuses to write otherwise. Run from ~/horizon-shield:

    python3 ops/post_ssrn_7419998.py
"""
import io
import sys

MS = "papers/nenrin-reproducibility/manuscript_v0.1.md"
LLMS = "llms.txt"

MS_OLD = "**Working paper, v0.3, 2026-09-06. Not yet posted.**"
MS_NEW = "**Working paper, v0.3, 2026-09-06. Submitted to SSRN on 2026-09-06 as abstract 7419998 (https://ssrn.com/abstract=7419998), under SSRN review at the time of this commit. License CC BY 4.0.**"

LLMS_ANCHOR = "- [PTKA Protocol Declaration on Zenodo (DOI)](https://doi.org/10.5281/zenodo.20175219)"
LLMS_NEW = ("- [Same File In, Same Bytes Out: reproducible NENRIN conduct records tested by an independent reimplementation, on SSRN]"
            "(https://ssrn.com/abstract=7419998): Submitted 2026-09-06, under SSRN review; CC BY 4.0. Two authors, Toshikatsu Oga and "
            "Federico Blanco Sánchez-Llanos. A second implementer rebuilt all eight August 2026 NENRIN rings byte for byte in Node.js "
            "from the anchored specification and the published ring files; the finding is that the specification does not state the "
            "canonical form, which lived only in the reference builder. Results anchored as JIDEC entries 32, 34 and 36. "
            "Source, PDF and reference builder: github.com/ogasurfproject-jpg/horizon-shield, papers/nenrin-reproducibility/.")

FORBIDDEN = "‒–—―−－─"


def main():
    ms = io.open(MS, encoding="utf-8").read()
    ll = io.open(LLMS, encoding="utf-8").read()
    if ms.count(MS_OLD) != 1:
        sys.exit("manuscript header line not found exactly once; not writing")
    if "7419998" in ll:
        sys.exit("llms.txt already mentions 7419998; not writing")
    lines = ll.split("\n")
    hits = [i for i, l in enumerate(lines) if l.startswith(LLMS_ANCHOR)]
    if len(hits) != 1:
        sys.exit("llms.txt anchor not found exactly once; not writing")
    if any(c in LLMS_NEW + MS_NEW for c in FORBIDDEN):
        sys.exit("forbidden dash in new text; not writing")
    ms = ms.replace(MS_OLD, MS_NEW)
    lines.insert(hits[0] + 1, LLMS_NEW)
    io.open(MS, "w", encoding="utf-8", newline="\n").write(ms)
    io.open(LLMS, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
    print("written:", MS, "and", LLMS, "(inserted after line", hits[0] + 1, ")")


if __name__ == "__main__":
    main()
