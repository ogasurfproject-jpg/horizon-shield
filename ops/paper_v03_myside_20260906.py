#!/usr/bin/env python3
"""Paper v0.3, the author's side of the corrections that Federico's 7dc5bff8 made to Sections 4.2 and 6.
Abstract, 4.2 lead sentence, 3.3, 7, and two rows of Table 3. Exact-match, each once; refuses to write
otherwise. Run on main after 662ed4ad:

    python3 ops/paper_v03_myside_20260906.py
"""
import io
import sys

PATH = "papers/nenrin-reproducibility/manuscript_v0.1.md"

PAIRS = [
    # Abstract: two overclaims
    ("A second implementer, with no access to the reference source, wrote a builder in a different language (Node.js) from the anchored specification alone and ran it against the eight published August 2026 rings.",
     "A second implementer, who had executed the reference builder as a black box but had not read its body, wrote a builder in a different language (Node.js) from the anchored specification and the published ring files, and ran it against the eight published August 2026 rings."),
    ("the reference canonical form inherits nested key ordering from a language runtime rather than from the specification.",
     "the specification does not state the canonical form at all, so nested key ordering was inherited from a language runtime and reached the second implementer through the published artifacts rather than through the specification."),
    # 4.2 lead: conditions (a) and (d) as narrowed by the paragraphs that follow
    ("The second implementer (a) has not seen the reference source;",
     "The second implementer (a) has not read the body of the reference source;"),
    ("(d) runs blind against the published inputs and reports per-ring match or mismatch before seeing the reference outputs.",
     "(d) runs the byte comparison blind, in the sense narrowed below, and reports per-ring match or mismatch before either implementer has read the other's account of the result."),
    # 3.3: the spec does not state the form; the chain field as the code actually computes it
    ("The reference implementation expresses this as Python's json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2) followed by a newline.",
     "The reference implementation expresses this as Python's json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2) followed by a newline. The specification itself does not state this form; at version 1 it lives only in the reference builder's docstring and the ring-v1 README, and this paragraph is its first language-neutral statement (Section 6)."),
    ("The chain field prev_ring_sha256 is the SHA-256 of the previous month's ring file bytes, not of any compact or re-serialized form; this was a defect found and fixed before Ring 001 was anchored, and the reference builder refuses a previous ring whose bytes are not already canonical.",
     "The chain field prev_ring_sha256 is the SHA-256 of the previous month's ring file bytes. The reference builder computes it over the canonical bytes of the loaded previous ring and refuses a previous ring whose file bytes differ from them, so file bytes and canonical bytes are the same thing by construction; an earlier version hashed a compact re-serialization instead, a defect found and fixed before Ring 001 was anchored."),
    # 7: the limits line
    ("The canonical form is runtime-defined. Section 6.",
     "The canonical form is not in the specification. At version 1 it is stated only by the reference builder and its README, and it reached the second implementer through the published ring files; Section 6. The next revision must state it, and if it adopts RFC 8785 as written, the Python reference is the implementation that changes."),
    # Table 3: collation row, both implementation columns and the risk column
    ("| Key sort collation | by Unicode code point | `Array.prototype.sort()` with no comparator, i.e. by UTF-16 code unit |",
     "| Key sort collation | by Unicode code point, which is not the RFC 8785 order | `Array.prototype.sort()` with no comparator, i.e. by UTF-16 code unit, which is the order RFC 8785 Section 3.2.3 specifies |"),
    ("would be the first thing to exercise it, not an exotic input |",
     "would be the first thing to exercise it, not an exotic input. If a revision adopts RFC 8785 as written, the Python reference is the implementation that changes, not the Node.js one |"),
    # Table 3: chain row, Python column as the code computes it
    ("| Chain hash input | previous ring file bytes, not any re-serialized form |",
     "| Chain hash input | sha256 of the loaded previous ring's canonical bytes; the loader refuses a previous ring whose file bytes differ from them, so this equals the file bytes by construction |"),
]

FORBIDDEN = "‒–—―−－"


def main():
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
