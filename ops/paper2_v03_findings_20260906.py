#!/usr/bin/env python3
"""Paper 2, after PR #20: the three production findings on the instant coordinate (Section 7 spine),
Table 3 Bitcoin block heights, and the sentences that depended on "no derived verdict yet".
Exact match, each once; refuses to write otherwise. Run from ~/horizon-shield:

    python3 ops/paper2_v03_findings_20260906.py
"""
import hashlib
import io
import re
import sys

PATH = "papers/nenrin-coordinate/manuscript_v0.1.md"
EXPECT_SHA = "f23470a0487929f2302a2fc8c3c4e4ef6166f6a55ba0179497ca1f158166366d"
FORBIDDEN = "‒–—―−－─"

PAIRS = [
# header
("**Working paper, draft v0.2, 2026-09-06 (co-authorship confirmed 12:10 JST). Not yet posted.**",
 "**Working paper, draft v0.3, 2026-09-06 (Section 6 by F.B.S.L. merged as PR #20; three production findings added to Section 7). Not yet posted.**"),
# abstract
("We also report what is deployed against what is designed: the instant coordinate runs in the production gate but has produced no derived verdict in the committed history at the time of writing; the census has a live coordinate but no anchored census record yet; the record-level guard exists as a harness and is not wired into the production adjudication.",
 "We also report what is deployed against what is designed, and the operator is the subject of that report. The instant coordinate runs in the production gate, and three departures from its own anchored design were found while this paper was being written: the first scheduled sweep after deployment fell back to the predictable legacy schedule and the persisted record does not say why, because the history entry the gate keeps drops the derivation block entirely; and the production code creates the salt after the block it binds to, which the operator's own verifier is written to refuse. All three are open at the time of writing and are dated in Section 7. The census has a live coordinate but no anchored census record yet; the record-level guard exists as a harness and is not wired into the production adjudication."),
# 4.3 production paragraph
("It reads two independently operated block sources and requires them to agree on height and hash before it treats the result as a beacon, records the height and hash it used so that anyone holding the chain can falsify a wrong beacon permanently, and otherwise falls back to the legacy schedule and says so in the verdict.",
 "It reads two independently operated block sources and requires them to agree on height and hash before it treats the result as a beacon, records the height and hash it used so that anyone holding the chain can falsify a wrong beacon permanently, and otherwise falls back to the legacy schedule and says so in the verdict. As deployed, each source's height is its own reported tip less six, so two honest sources whose tips differ by one block, which is ordinary, fail to agree; the reference-tip rule that version 3.3 of the harness adopted for exactly this reason was not carried into the production code (Section 7)."),
# 4.4 last paragraph
("At the time of writing, the committed history exports carry no verdict with a derived beacon; the operator's own claim register reports this as an open item. Deployed, disclosed, and not yet exercised on real data: Table 2 says so, and Section 9 pre-registers the first exercise.",
 "Whether it has ever derived is another matter, and the answer found on 2026-09-06 is in Section 7: the first scheduled sweep after deployment fell back, the persisted history does not carry the derivation block, and the order of salt and block in the production code is the reverse of the one the addendum requires. Deployed, disclosed, and not yet exercised as designed: Table 2 says so, and Section 9 pre-registers the first exercise."),
# table 2 row
("| instant coordinate | entry 33 | entry 33 (Python), gate 0.3.0 (JavaScript) | yes, gate 0.3.0, with legacy fallback disclosed | no: zero derived verdicts in the committed history as of 2026-09-06 | the September 2026 history exports |",
 "| instant coordinate | entry 33 | entry 33 (Python), gate 0.3.0 (JavaScript) | yes, gate 0.3.0, with legacy fallback disclosed; three departures from entry 33 open as of 2026-09-06 (below) | no: the first sweep after deployment (2026-09-05 18:00 UTC) fell back to the legacy schedule, and the persisted history carries no derivation block | after the three repairs below, the first window whose salt predates its beacon |"),
# section 7 paragraph after table (anchor: the line that opens section 8)
("## 8. Limits\n\nDeterminism is not truth.",
 "Three rows of that table were changed by the act of writing it. On 2026-09-06 the first author re-exported the gate's public history for all eight endpoints and ran the operator's own beacon verifier over them, expecting to report the first derived verdicts from the 2026-09-05 18:00 UTC sweep, the first scheduled sweep after gate 0.3.0 was deployed. There were none, and the reason was not the one Table 2 had assumed. First, the sweep had fallen back: the gate's own sweep summary records the legacy schedule as the cadence in force that day. Second, the persisted history entry does not carry the derivation block at all. The verdict object the gate returns to a caller carries it, but the function that condenses a verdict into a history entry copies status, reachability, the record hash, consent, conditions and surface, and nothing about the coordinate; so the export that feeds the rings, the public archive and the verifier is structurally silent on whether any instant was ever derived, and the claim register's check passed by finding nothing to check. Third, the production code creates the window's salt lazily at the first sweep of the window and, in the same call, reads a beacon six blocks below the current tip, a block mined about an hour before the salt existed. The addendum requires the commitment to be anchored below the window's opening height and the beacon to be a block mined after the salt; the operator's verifier implements that order and marks the reverse as falsified, with the words that the gate could have chosen the salt knowing the hash. Had the sweep derived, the operator's own verifier would have refused the result. The likely cause of the fallback is a fourth departure, visible in the same code: agreement is demanded on a height each source computes from its own tip, so two honest explorers one block apart cannot agree, which is the seam the harness closed in version 3.2 and 3.3 and the production code did not inherit. None of this changes the design, all of it changes the row, and the repairs are three: persist the derivation block in the history entry; create the salt at the window's opening and bind only to a block mined after it, publishing the commitment when it is made; and agree on a hash at one reference height rather than on heights. The operator is a subject of the rule, and this is what that costs: the paper reports the deployment it found, not the one it meant to describe.\n\n## 8. Limits\n\nDeterminism is not truth."),
# section 9
("First, derived verdicts: the operator's claim register currently reports no derived beacon in any committed history export; the September exports either carry coordinate_derivation blocks with anchored salt commitments, or they carry the legacy fallback disclosed, and the count of each is a fact about the deployment, not about the design.",
 "First, derived verdicts: none exists, and Section 7 says why. Once the three repairs are deployed, the September exports either carry coordinate_derivation blocks whose beacon the operator's verifier confirms, the block at that height and the salt before the block, or they carry the legacy fallback disclosed; the count of each, and the date of the first confirmed derived verdict, is a fact about the deployment, not about the design, and is reported as measured."),
# appendix B intro and table with blocks
("Table 3 lists the ledger entries this paper rests on, with the SHA-256 of each anchored document as recomputed from the repository on 2026-09-06; all eleven values equal the claims of the corresponding ledger entries. Bitcoin block heights are read from the ledger at the time of posting and filled in the posted version.",
 "Table 3 lists the ledger entries this paper rests on, with the SHA-256 of each anchored document as recomputed from the repository on 2026-09-06; all eleven values equal the claims of the corresponding ledger entries. Bitcoin block heights were read from the ledger on 2026-09-06, when every entry was confirmed."),
("| entry | schema | anchors | claim SHA-256 |\n|---|---|---|---|\n",
 "| entry | schema | anchors | claim SHA-256 | Bitcoin block |\n|---|---|---|---|---|\n"),
("| 22 | nenrin-coordinate-v1 | the specification, two scales | 5be2b22e339d8b5c45a272325c49da189f10715b01683025ae903e83bf251df5 |",
 "| 22 | nenrin-coordinate-v1 | the specification, two scales | 5be2b22e339d8b5c45a272325c49da189f10715b01683025ae903e83bf251df5 | 965312 |"),
("| 23 | nenrin-coordinate-v1-manifest | pinned bytes of the eight harness files | 24a7ed47167dc068f5bd06d94cc47c65f7e5af938efd740d288d45301181586b |",
 "| 23 | nenrin-coordinate-v1-manifest | pinned bytes of the eight harness files | 24a7ed47167dc068f5bd06d94cc47c65f7e5af938efd740d288d45301181586b | 965333 |"),
("| 24 | addendum time-v3 | quorum; forged versus unverifiable; corrections v3.1, v3.2, v3.3 | 447bcf4f38cd8099683ccd396467609438aa47399e9bb9b75d7c425900147611 |",
 "| 24 | addendum time-v3 | quorum; forged versus unverifiable; corrections v3.1, v3.2, v3.3 | 447bcf4f38cd8099683ccd396467609438aa47399e9bb9b75d7c425900147611 | 965333 |"),
("| 25 | nenrin-witness-state-0001 | the founding witness's corresponding state | 950edfee4e57835f7bdf7f22e07c54392fad692ad88f5c89aacfee5cdf8a64b4 |",
 "| 25 | nenrin-witness-state-0001 | the founding witness's corresponding state | 950edfee4e57835f7bdf7f22e07c54392fad692ad88f5c89aacfee5cdf8a64b4 | 965345 |"),
("| 26 | addendum sources-v1 | operator independence, outside corroboration, the rule for authentic | 04908cd53c006ea0ebd24535ab8d3c884317cd2aeeff7a24f136c8a459cf50dc |",
 "| 26 | addendum sources-v1 | operator independence, outside corroboration, the rule for authentic | 04908cd53c006ea0ebd24535ab8d3c884317cd2aeeff7a24f136c8a459cf50dc | 965447 |"),
("| 27 | addendum localheaders-v1 | a chain and not a website | f5512ea3bb476e3356f96979c9a922e102f35d893659d76ad151fed5450f6162 |",
 "| 27 | addendum localheaders-v1 | a chain and not a website | f5512ea3bb476e3356f96979c9a922e102f35d893659d76ad151fed5450f6162 | 965458 |"),
("| 28 | addendum localheaders-v2 | the courier is the network | 5ed2027f4ce46a11a35dc065c74b02b81a4289c759225776f9383f4909cdf5f4 |",
 "| 28 | addendum localheaders-v2 | the courier is the network | 5ed2027f4ce46a11a35dc065c74b02b81a4289c759225776f9383f4909cdf5f4 | 965458 |"),
("| 29 | addendum localheaders-v3 | from genesis, no checkpoint | 937ce7049c1962f9e862af5f124ae31a40ef39c230a5c0937a1a23257a861693 |",
 "| 29 | addendum localheaders-v3 | from genesis, no checkpoint | 937ce7049c1962f9e862af5f124ae31a40ef39c230a5c0937a1a23257a861693 | 965458 |"),
("| 30 | nenrin-localheaders-refusal-1 | a red team refusal record, test network, two valid chains at height 12 | 07830db2cf32aaee74b77c3cc563318515d276a505288ae574a3666f7defcf26 |",
 "| 30 | nenrin-localheaders-refusal-1 | a red team refusal record, test network, two valid chains at height 12 | 07830db2cf32aaee74b77c3cc563318515d276a505288ae574a3666f7defcf26 | 965464 |"),
("| 31 | addendum refusals-v1 | a refusal is a record | 71683e3a7b44bda0f55f6aefbf0e34280d05dc15f45eb36b8b128fe61bf469b5 |",
 "| 31 | addendum refusals-v1 | a refusal is a record | 71683e3a7b44bda0f55f6aefbf0e34280d05dc15f45eb36b8b128fe61bf469b5 | 965464 |"),
("| 33 | nenrin-instant-v1 | the instant coordinate; the narrowing after the witness's freshness beacon | e228dfd8e5353525fb11cc245be48cff7ef6d01433b27f472f5fc8bb6de39c7d |",
 "| 33 | nenrin-instant-v1 | the instant coordinate; the narrowing after the witness's freshness beacon | e228dfd8e5353525fb11cc245be48cff7ef6d01433b27f472f5fc8bb6de39c7d | 965566 |"),
]


def main():
    text = io.open(PATH, encoding="utf-8").read()
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    if sha != EXPECT_SHA:
        sys.exit("manuscript sha256 is %s, expected %s; not writing" % (sha[:16], EXPECT_SHA[:16]))
    for a, b in PAIRS:
        n = text.count(a)
        if n != 1:
            sys.exit("expected exactly one match, found %d: %r" % (n, a[:90]))
        if any(c in b for c in FORBIDDEN):
            sys.exit("forbidden dash in replacement")
    for a, b in PAIRS:
        text = text.replace(a, b)
    if any(c in text for c in FORBIDDEN):
        sys.exit("forbidden dash remains; not writing")
    io.open(PATH, "w", encoding="utf-8", newline="\n").write(text)
    print("written: %d replacements, %d words, sha256 %s" % (len(PAIRS), len(re.findall(r"\S+", text)),
          hashlib.sha256(text.encode("utf-8")).hexdigest()))


if __name__ == "__main__":
    main()
