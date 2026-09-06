#!/usr/bin/env python3
"""Paper v0.3, part 2: front matter, 4.3 block number, 5.1 p001 sentence, Section 7 label-collapse limit,
Acknowledgements for two authors, Appendix B (entry 34 verbatim, block 965627), References.
Exact-match, each once; refuses to write otherwise. Run after paper_v03_myside_20260906.py:

    python3 ops/paper_v03_part2_20260906.py

One token is left on purpose and must be filled before posting: ENTRY_CORRECTION_N (the JIDEC entry number
of the correction record that narrows entry 34's two phrases). The pre-submission check greps for it."""
import io
import sys

PATH = "papers/nenrin-reproducibility/manuscript_v0.1.md"
CLAIM_34 = "workers/hs-ledger/claim_34.txt"
CLAIM_34_SHA = "fad6d00a25281102711573b151b321bc13b28c625fe65807c5eb3a12a04e393c"

FRONT_OLD = "**Working paper, draft v0.2, 2026-09-05 (co-authorship confirmed 23:34 JST). Not yet posted.**"
FRONT_NEW = "**Working paper, v0.3, 2026-09-06. Not yet posted.**"

DIV_OLD = ("[Division of work, stated for the record: T.O. designed and operates NENRIN, wrote the reference implementation, and drafted this paper. "
           "F.B.S.L. wrote the independent Node.js implementation and performed the blind runs; Sections 4.2 and 6 are his to write and the current text "
           "there is a placeholder drafted from the anchored record for him to replace. Both authors approve the final text before posting.]")
DIV_NEW = ("Division of work, stated for the record: T.O. designed and operates NENRIN, wrote the reference implementation, and drafted this paper. "
           "F.B.S.L. wrote the independent Node.js implementation, performed the blind runs, and wrote Sections 4.2 and 6, including Table 3. "
           "Both authors approve the final text before posting.")

P43_OLD = "appended to the ledger as JIDEC entry 34 (claim SHA-256 fad6d00a25281102711573b151b321bc13b28c625fe65807c5eb3a12a04e393c)."
P43_NEW = ("appended to the ledger as JIDEC entry 34 (claim SHA-256 fad6d00a25281102711573b151b321bc13b28c625fe65807c5eb3a12a04e393c, "
           "confirmed in Bitcoin block 965627 on 2026-09-05 14:58 UTC).")

P51_OLD = "The p001 row is a partner endpoint that is pending on all twenty-six instants; a ring that could only be built when the numbers were good would not be a record."
P51_NEW = (P51_OLD + " Every one of those twenty-six is pending for the same reason: the owner had not consented to a tool call, so determinism was not "
           "measured, and the gate's status label reads pending for an unmeasured condition exactly as it does for a failed one. The record behind each "
           "instant keeps the two apart (measured: false); the label, and the ring's instants_by_status count, do not. Section 7 returns to this.")

P7_ANCHOR = ("The canonical form is not in the specification. At version 1 it is stated only by the reference builder and its README, and it reached the "
             "second implementer through the published ring files; Section 6. The next revision must state it, and if it adopts RFC 8785 as written, the "
             "Python reference is the implementation that changes.")
P7_NEW = (P7_ANCHOR + "\n\n"
          "The status label collapses two distinctions that the records keep. A gate record separates an instrument failure (reachable null, gate_side true) "
          "from a target that did not answer (reachable false), and a condition that was not measured (measured false) from one that was measured and failed; "
          "the one-word status does not, reading held for the first pair and pending for the second, and the ring's instants_by_status inherits the label. "
          "The unmeasured count survives in the ring only as prose in its limits sentence. Both collapses were found by the first author while writing an "
          "adapter for an open semantic type system for verification evidence (trustless-ai/semantic-abi), where they appear as test vectors that fail "
          "against his own system and are filed as such. The fix belongs to the next ring schema: counted fields for instrument failures and for unmeasured "
          "conditions, beside the status counts.")

ACK_OLD = ("The author operates every endpoint measured in this paper and the ledger that anchors the records; that is Layer 4 of the design, and it is also "
           "a conflict of interest, stated here. Neither author received compensation for any part of this work. No party paid for any measurement or record cited.")
ACK_NEW = ("The first author operates every endpoint measured in this paper and the ledger that anchors the records; that is Layer 4 of the design, and it is "
           "also a conflict of interest, stated here. The second author operates invinoveritas, a separate verification service; none of its endpoints is in "
           "the rings reported here, and it has been measured under the same ledger's witness path. The two authors are also collaborating on a separate open "
           "project, an adapter for the semantic-abi type system, and no payment has passed between them in either direction. Neither author received "
           "compensation for any part of this work. No party paid for any measurement or record cited.")

APPB_OLD = ("[Insert the record_canonical of JIDEC entry 34 verbatim, as fetched raw from ledger.horizonshield.dev/ledger/34?format=raw, with its claim "
            "SHA-256 and, once confirmed, its Bitcoin block.]")

REFS_OLD_PREFIX = "[To be completed: Certificate Transparency (RFC 6962 / RFC 9162);"

REFS_NEW = """Laurie, B., Langley, A., Kasper, E. (2013). Certificate Transparency. RFC 6962, IETF. https://www.rfc-editor.org/rfc/rfc6962

Laurie, B., Messeri, E., Stradling, R. (2021). Certificate Transparency Version 2.0. RFC 9162, IETF. https://www.rfc-editor.org/rfc/rfc9162

Sigstore project. Rekor: a transparency log for software supply chain signatures. https://github.com/sigstore/rekor and https://docs.sigstore.dev

Reproducible Builds project. https://reproducible-builds.org

Lamb, C., Zacchiroli, S. (2022). Reproducible Builds: Increasing the Integrity of Software Supply Chains. IEEE Software 39(2), 62 to 70. https://doi.org/10.1109/MS.2021.3073045

Debian Project. ReproducibleBuilds. https://wiki.debian.org/ReproducibleBuilds

Torres-Arias, S., Afzali, H., Kuppusamy, T. K., Curtmola, R., Cappos, J. (2019). in-toto: Providing farm-to-table guarantees for bits and bytes. Proceedings of the 28th USENIX Security Symposium, 1393 to 1410.

in-toto Attestation Framework, Statement v1. https://github.com/in-toto/attestation

SLSA: Supply-chain Levels for Software Artifacts, version 1.0 (2023). https://slsa.dev

Todd, P. (2016). OpenTimestamps: Scalable, Trust-Minimized, Distributed Timestamping with Bitcoin. https://petertodd.org/2016/opentimestamps-announcement and https://opentimestamps.org

Rundgren, A., Jordan, B., Erdtman, S. (2020). JSON Canonicalization Scheme (JCS). RFC 8785, IETF. https://www.rfc-editor.org/rfc/rfc8785

Model Context Protocol specification. https://modelcontextprotocol.io/specification

Oga, T. (2026). NENRIN v1: Machine-Readable Tree Rings for Agent-Facing Services (NENRIN_SPEC_v1.md), SHA-256 9ccba2e325fd2a555fcdb2dec519b8c6bf7a669064674846aea98ecfff824e3d. github.com/ogasurfproject-jpg/horizon-shield, workers/hs-ledger/nenrin/. Reference builder make_ring.py, SHA-256 69719fed5ae6387bc9b363914e61ab70c8bfee320710fcd028191b90e41aa2c4, in ring-v1/.

Oga, T. (2026). JIDEC_PATH_SPEC_v1.md, the jidec-path-v1 record format (JIDEC ledger entry 5). github.com/ogasurfproject-jpg/horizon-shield, workers/hs-ledger/.

Blanco Sánchez-Llanos, F. (2026). make_ring.js, independent Node.js implementation of NENRIN Layer 3. github.com/babyblueviper1/invinoveritas, scripts/nenrin_ring_reimpl/make_ring.js, commit 917dd97ff8e30107810d9a059e9091077f5171d0, SHA-256 5167188aeefb4852ca941a96856724f8831abd46be331cd9544898ba038e82a8.

JIDEC ledger, HORIZON SHIELD. Entry 32 (Ring 001, rings/2026-08.sha256, claim f3e589efca103f3f717a68857618411f5f0864e0ad1aa264089e70b9d89081cc), entry 33 (instant coordinate addendum), entry 34 (reimplementation match record, claim fad6d00a25281102711573b151b321bc13b28c625fe65807c5eb3a12a04e393c, Bitcoin block 965627), entry ENTRY_CORRECTION_N (correction record narrowing two phrases of entry 34). https://ledger.horizonshield.dev/ledger/{n} and ?format=raw for the exact bytes.

mcp-conduct-register. Public register with committed history exports and rings. github.com/ogasurfproject-jpg/mcp-conduct-register

Oga, T. (2026). Verification for the Buyer, Not the Seller. SSRN working paper 6964439. https://ssrn.com/abstract=6964439

Oga, T. (2026). A Demand-Side Benchmark for Consumer-Facing Construction Cost Questions: Price-Figure Span, Output Consistency, and the Case for a Verifiable Reference Layer. engrXiv 7814. https://doi.org/10.31224/7814

Oga, T. (2026). SSRN working paper 6872819 (a benchmark of general-purpose language models against a structured construction-cost engine on renovation cost questions). https://ssrn.com/abstract=6872819
"""

FORBIDDEN = "‒–—―−－"


def main():
    text = io.open(PATH, encoding="utf-8").read()
    claim = io.open(CLAIM_34, encoding="utf-8").read()
    import hashlib
    sha = hashlib.sha256(claim.encode("utf-8")).hexdigest()
    if sha != CLAIM_34_SHA:
        sys.exit("claim_34.txt sha256 %s does not equal %s; not writing" % (sha, CLAIM_34_SHA))
    appb_new = (
        "JIDEC entry 34, fetched raw from ledger.horizonshield.dev/ledger/34?format=raw. SHA-256 of these exact bytes: " + CLAIM_34_SHA +
        ". Anchored in Bitcoin block 965627 (2026-09-05 14:58 UTC). Reproduced unedited, including the surname without its accent, as the record was written.\n\n"
        + "\n".join(("    " + l) if l else "" for l in claim.rstrip("\n").split("\n")) +
        "\n\nTwo phrases in this record, \"written from the spec alone\" and \"implementation_2_source_seen: none of implementation_1\", are broader than the "
        "account in Section 4.2: the reference builder was executed as a black box in an earlier recompute, and the field set and canonical form were taken "
        "from the published ring files. An anchored record is not edited. The narrowing is appended instead, in the register's README (2026-09-06) and as "
        "a correction record on the same ledger, JIDEC entry ENTRY_CORRECTION_N."
    )
    pairs = [
        (FRONT_OLD, FRONT_NEW),
        (DIV_OLD, DIV_NEW),
        (P43_OLD, P43_NEW),
        (P51_OLD, P51_NEW),
        (P7_ANCHOR, P7_NEW),
        (ACK_OLD, ACK_NEW),
        (APPB_OLD, appb_new),
    ]
    for old, new in pairs:
        n = text.count(old)
        if n != 1:
            sys.exit("expected exactly one match, found %d: %r" % (n, old[:70]))
    if text.count(REFS_OLD_PREFIX) != 1:
        sys.exit("references placeholder not found once")
    for old, new in pairs:
        text = text.replace(old, new)
    # References: replace the whole placeholder paragraph (one line starting with the prefix)
    lines = text.split("\n")
    idx = next(i for i, l in enumerate(lines) if l.startswith(REFS_OLD_PREFIX))
    lines[idx] = REFS_NEW.rstrip("\n")
    text = "\n".join(lines)
    bad = sum(text.count(c) for c in FORBIDDEN)
    if bad:
        sys.exit("forbidden dashes present after edit: %d; not writing" % bad)
    io.open(PATH, "w", encoding="utf-8", newline="\n").write(text)
    print("written:", PATH, "replacements:", len(pairs) + 1, "words:", len(text.split()), "tokens left:", text.count("ENTRY_CORRECTION_N"))


if __name__ == "__main__":
    main()
