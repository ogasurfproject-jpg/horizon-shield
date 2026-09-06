#!/usr/bin/env python3
"""Paper 2 v0.4 (verification pass, 番人 2026-09-06):
  1. Section 7 prose: renumber so there are three departures (persist / tip agreement / salt order),
     with the legacy fallback as the symptom of the tip-agreement departure, not a separate "fourth departure".
  2. Abstract: shorter, and the time line no longer implies the deployed check syncs from genesis
     (that is the operator's machine; the production gate is a two-explorer quorum).
  3. Abstract: "one defect and two residuals" replaced with "drove three corrections to the time axis",
     to match Section 6 (F.B.S.L.) and Section 4.3; his section is not touched.

Line-based replacement by unique prefix (each paragraph is one line), so the long old text is not retyped.
sha256 guarded to v0.3. Section 6, the witness half of 4.3, and Table 3 are not touched.

    python3 ops/paper2_v04_verify_20260906.py
"""
import hashlib
import io
import re
import sys

PATH = "papers/nenrin-coordinate/manuscript_v0.1.md"
EXPECT_SHA = "0543e061a98a252a22c4d974dab17a6f2d98c1fff6eb6f60068aff9ca3d0b770"
FORBIDDEN = "‒–—―−－─"

NEW_ABSTRACT = (
"A verifier can be sound on every layer it runs and still return the wrong verdict, because the party being "
"verified was allowed to choose which coordinate got measured; a truthful, reproducible read of the wrong "
"coordinate passes. This paper reports one rule that closes the defect: the verifier derives the coordinate from "
"a source the party being verified does not control and binds the derived value into the verdict as an output a "
"third party recomputes. It shows the rule at four scales in one Bitcoin-anchored record system for agent-facing "
"services: the record (which cost category an estimate is judged against, derived from its own line items), the "
"population (which servers exist to be counted, derived from Certificate Transparency rather than self-"
"declaration), time (when a verdict was created, bracketed by a Bitcoin block-header set the prover cannot "
"choose), and the instant (which day and which tool a conduct measurement samples, derived from a salt committed "
"before the window and a block hash the subject cannot influence). Each instance has a runnable reference "
"implementation, an adversarial harness that holds every sub-layer green while it attacks the coordinate, and an "
"anchored specification whose corrections are appended, never edited. An independent verifier built the "
"counterpart state on his own system, drove three corrections to the operator's time axis, and asked the "
"question that turned a refusal from a sentence in prose into a queryable ledger record; his account is in his "
"own words. The paper also reports what is deployed against what is designed, with the operator as a subject of "
"its own rule: the time check runs from genesis over the peer to peer network on the operator's machine but as a "
"two-explorer quorum in the production gate, the census has a live coordinate and no anchored record yet, the "
"record-level guard is a harness not yet wired into the adjudication, and the instant coordinate, deployed but "
"not yet exercised, showed three departures from its anchored design found while this paper was written, one of "
"which the operator's own verifier would refuse. The limits are named with the claims: determinism is not truth; "
"a quorum buys operator independence, not implementation independence; a refusal proves a contradiction, not "
"which side was honest; the census boundary is structural for private networks and clients that ignore "
"Certificate Transparency."
)

NEW_SEC7 = (
"Three rows of that table were changed by the act of writing it. On 2026-09-06 the first author re-exported the "
"gate's public history for all eight endpoints and ran the operator's own beacon verifier over them, expecting to "
"report the first derived verdicts from the 2026-09-05 18:00 UTC sweep, the first scheduled sweep after gate "
"0.3.0 was deployed. There were none, and each reason is a departure from entry 33. First, the persisted history "
"entry does not carry the derivation block at all: the verdict object the gate returns to a caller carries it, but "
"the function that condenses a verdict into a history entry copies status, reachability, the record hash, consent, "
"conditions and surface, and nothing about the coordinate, so the export that feeds the rings, the public archive "
"and the verifier is structurally silent on whether any instant was ever derived, and the claim register's check "
"passed by finding nothing to check. Second, that first sweep did not derive at all; it fell back to the legacy "
"schedule, as the gate's own sweep summary records, because agreement is demanded on a height each source "
"computes from its own tip, and two honest explorers one block apart never agree, the seam the harness closed in "
"versions 3.2 and 3.3 and the production code did not inherit. Third, the production code creates the window's "
"salt lazily at the first sweep of the window and, in the same call, reads a beacon six blocks below the current "
"tip, a block mined about an hour before the salt existed; the addendum requires the commitment to be anchored "
"below the window's opening height and the beacon to be a block mined after the salt, the operator's verifier "
"implements that order and marks the reverse as falsified with the words that the gate could have chosen the salt "
"knowing the hash, so had the sweep derived, the operator's own verifier would have refused the result. None of "
"this changes the design, all of it changes the row, and the repairs are three: persist the derivation block in "
"the history entry; agree on a hash at one reference height rather than on per-source heights; and create the "
"salt at the window's opening and bind only to a block mined after it, publishing the commitment when it is made. "
"The operator is a subject of the rule, and this is what that costs: the paper reports the deployment it found, "
"not the one it meant to describe."
)

# (unique line prefix, new full line)
REPL = [
("A verifier can be sound on every layer it runs and still return the wrong verdict", NEW_ABSTRACT),
("Three rows of that table were changed by the act of writing it.", NEW_SEC7),
]


def main():
    text = io.open(PATH, encoding="utf-8").read()
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    if sha != EXPECT_SHA:
        sys.exit("manuscript sha256 is %s, expected %s; not writing" % (sha[:16], EXPECT_SHA[:16]))
    lines = text.split("\n")
    for prefix, new in REPL:
        hits = [i for i, l in enumerate(lines) if l.startswith(prefix)]
        if len(hits) != 1:
            sys.exit("prefix matched %d lines: %r" % (len(hits), prefix))
        if any(c in new for c in FORBIDDEN):
            sys.exit("forbidden dash in new text")
        lines[hits[0]] = new
    out = "\n".join(lines)
    if any(c in out for c in FORBIDDEN):
        sys.exit("forbidden dash remains; not writing")
    # guard: Section 6 and Table 3 untouched
    if "Written by F.B.S.L." not in out or "| 33 | nenrin-instant-v1" not in out:
        sys.exit("sanity check failed; not writing")
    io.open(PATH, "w", encoding="utf-8", newline="\n").write(out)
    print("written: %d paragraphs, %d words, sha256 %s"
          % (len(REPL), len(re.findall(r"\S+", out)), hashlib.sha256(out.encode("utf-8")).hexdigest()))


if __name__ == "__main__":
    main()
