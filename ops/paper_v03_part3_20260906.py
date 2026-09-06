#!/usr/bin/env python3
"""Paper v0.3, part 3: the last author-side overclaims (Conclusion, 5.1 lead, 5.2 closing line, Section 8 wording),
entry 32's Bitcoin block in 3.4, a pointer to correction entry 36 in 4.2(a) and in Table 2.
Exact-match, each once; refuses to write otherwise.

    python3 ops/paper_v03_part3_20260906.py
"""
import io
import sys

PATH = "papers/nenrin-reproducibility/manuscript_v0.1.md"
BLOCK_32 = "965566"
BLOCK_32_TIME = "2026-09-05 04:53 UTC"

PAIRS = [
    # 3.4: entry 32's block
    ("Ring 001, covering August 2026 for eight endpoints, is JIDEC entry 32 (claim SHA-256 f3e589efca103f3f717a68857618411f5f0864e0ad1aa264089e70b9d89081cc).",
     "Ring 001, covering August 2026 for eight endpoints, is JIDEC entry 32 (claim SHA-256 f3e589efca103f3f717a68857618411f5f0864e0ad1aa264089e70b9d89081cc, confirmed in Bitcoin block " + BLOCK_32 + " on " + BLOCK_32_TIME + ")."),
    # 4.2 (a): pointer to the correction record
    ("What was not read, before or during the reimplementation, was the body of make_ring.py: the logic that turns history entries into ring fields. That narrower claim is the one this paper stands on.",
     "What was not read, before or during the reimplementation, was the body of make_ring.py: the logic that turns history entries into ring fields. That narrower claim is the one this paper stands on. The anchored record is not edited; the narrowing is appended to the same ledger as a correction record, JIDEC entry 36, and both records are reproduced in Appendix B."),
    # 5.1 lead
    ("All eight endpoints are operated by the author (Layer 4, self-application);",
     "All eight endpoints are operated by the first author (Layer 4, self-application);"),
    # 5.2 Table 2: correction row, and the closing line
    ("| Result record | JIDEC entry 34, claim fad6d00a..., schema nenrin-ring-reimpl-match-v1 |",
     "| Result record | JIDEC entry 34, claim fad6d00a..., schema nenrin-ring-reimpl-match-v1, Bitcoin block 965627 |\n| Correction record | JIDEC entry 36, claim 69158463e659d3b3d158d8068a0506ccc9101beeca6ab2acc5b87aec493edc9c, schema nenrin-ring-reimpl-match-v1-correction; narrows two provenance phrases of entry 34, changes no hash and no result |"),
    ("The result: eight of eight rings byte-identical across the two implementations, from the same committed history, with the second implementer's run performed blind.",
     "The result: eight of eight rings byte-identical across the two implementations, from the same committed history, with the byte comparison performed blind."),
    # 8: the pre-registered rerun, worded the way 4.2 now defines blind
    ("The second implementer has stated that he will rerun make_ring.js against the September inputs blind, without first seeing the reference outputs, and report per-ring match or mismatch.",
     "The second implementer has stated that he will rerun make_ring.js against the September inputs and report per-ring match or mismatch before either implementer has read the other's result, the same sense of blind as in Section 4.2(d)."),
    # 9: Conclusion
    ("was true in principle from the day the specification was anchored and untested in fact until a stranger to the source did it in another language.",
     "was true in principle from the day the specification was anchored and untested in fact until someone who had not read the source did it in another language."),
    ("Same file in, same bytes out, from someone who never saw the source.",
     "Same file in, same bytes out, from someone who had not read the source."),
]

FORBIDDEN = "‒–—―−－─"


SEED_36 = "workers/hs-ledger/seed_entry_nenrin_reimpl_correction_20260906.json"
CLAIM_36_SHA = "69158463e659d3b3d158d8068a0506ccc9101beeca6ab2acc5b87aec493edc9c"
APPB_TAIL_OLD = "and as a correction record on the same ledger, JIDEC entry 36."


def main():
    if "PLACEHOLDER" in BLOCK_32 or "PLACEHOLDER" in BLOCK_32_TIME:
        sys.exit("entry 32 block not filled in this script; not writing")
    import json, hashlib
    seed = json.load(io.open(SEED_36, encoding="utf-8"))
    rec = seed["record_canonical"]
    if hashlib.sha256(rec.encode("utf-8")).hexdigest() != CLAIM_36_SHA:
        sys.exit("seed record for entry 36 does not hash to the ledger's claim; not writing")
    appb_tail_new = (APPB_TAIL_OLD + "\n\nJIDEC entry 36, fetched raw from ledger.horizonshield.dev/ledger/36?format=raw. SHA-256 of these exact bytes: "
                     + CLAIM_36_SHA + ". OpenTimestamps proof submitted on 2026-09-06 and pending at the time of writing; the Bitcoin block appears in the "
                     "ledger entry when confirmed.\n\n" + "\n".join(("    " + l) if l else "" for l in rec.rstrip("\n").split("\n")))
    PAIRS.append((APPB_TAIL_OLD, appb_tail_new))
    text = io.open(PATH, encoding="utf-8").read()
    for old, new in PAIRS:
        n = text.count(old)
        if n != 1:
            sys.exit("expected exactly one match, found %d: %r" % (n, old[:70]))
    for old, new in PAIRS:
        text = text.replace(old, new)
    bad = sum(text.count(c) for c in FORBIDDEN)
    if bad:
        sys.exit("forbidden dashes present after edit: %d; not writing" % bad)
    io.open(PATH, "w", encoding="utf-8", newline="\n").write(text)
    print("written:", PATH, "replacements:", len(PAIRS), "words:", len(text.split()))


if __name__ == "__main__":
    main()
