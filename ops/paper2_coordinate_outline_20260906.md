# Paper 2, outline and evidence ledger (2026-09-06, 番人 draft for TOshi to cut)

Working title (two candidates, pick one):
A. The Prover Does Not Choose the Coordinate: One Rule, Four Scales, for Anchored Conduct Records
B. Coordinate Integrity for Verifiers: Record, Population, Time and Instant Under One Fail-Closed Rule

Thesis, one sentence: a verifier can be sound on every layer and still return the wrong verdict when the party being verified chose which coordinate got measured; the fix is one rule, the verifier derives the coordinate from a source the prover does not control and binds the derived value into the verdict, and this paper shows that rule instantiated at four scales, each with a runnable reference implementation, an adversarial harness, an anchored specification, and an independent witness.

Falsifiable claim (from the anchored spec section 8, narrowed by the instants addendum section 6): none of the components is new (CT, Rekor, in-toto, SLSA, OpenTimestamps, tx_hash derivation, commit-reveal against future randomness); the claimed novelty is the one rule instantiated at record, population, time and instant scale together, with the census expressed as an open witness, disagreement as a citable record, and the operator measured under the same rules. Anyone who finds a prior instance of the full combination is invited to anchor it beside the claim.

Relation to paper 1: paper 1 tested one layer's determinism (same file in, same bytes out). Paper 2 is about what determinism cannot fix: a deterministic, reproducible read of the wrong coordinate. Paper 1 is cited once, for the anchoring method and the reimplementation discipline; nothing else is repeated.

## Structure (target 6,000 words, 4 tables)

Abstract (limits inside it, as in paper 1).

1. The defect. Two anchored sentences from the founding external witness, quoted from the specification (not from private messages): three sound layers, wrong verdict, because the coordinate is chosen by the party being verified; and for a census there is no fetch-the-bytes-yourself. Composition fails where every layer passes.

2. Prior art and the narrowing. CT and Rekor (transparency logs), in-toto and SLSA (provenance), OpenTimestamps (anchoring), the witness's own tx_hash derivation on /review (record-level coordinate as an output), and his freshness_beacon (binding a timestamp to a future block, reported the same day, existed first). State plainly what each already does and where the rule here goes past it: they all take delivery of an artifact the submitter chose; conduct over time needs the coordinate chosen by neither subject nor measurer.

3. One rule. Derive from the subject or from an involuntary channel; accept prover evidence only where its coordinate equals the derived one; bind the derived coordinate into the verdict with the words derived_from_subject and never asserted_by_prover; mismatch is a named hard failure; fail closed on the adversary, fail open on the outage (a provable lie versus an unverifiable-now).

4. Four instances (each: subject, coordinate, the involuntary source, what the prover used to be able to choose, what the guard derives, what the verdict binds, the refusal name).
4.1 Record: the join guard. Estimate as subject; cost category derived from line items as the most expensive work class present; refusal coordinate_chosen_by_prover; subject_sha256 bound so a swapped subject is visible.
4.2 Population: the census. Callability and observability coincide for public HTTPS under SCT-enforcing clients; three sets (declared and callable, declared no footprint, undeclared callable) plus the residual named unknown never absent; CT snapshot hash as the coordinate; census as a jidec-path-v1 witness; census discrepancy as a first-class record.
4.3 Time: the beacon, v2 to v3. Backdating closed by a public beacon; two seams found on a live system (single source; forged folded with unverifiable) and closed: quorum of independent operators (the sources addendum: operator independence is what a quorum buys, implementation independence is not, corroboration from outside the quorum is evidence not a vote, the authentic rule is a fork chosen with the number written next to it); then localheaders v1 to v3: a chain not a website, the courier is the network (Bitcoin p2p getheaders), from genesis with no checkpoint; then refusals v1: two valid chains, refuse and name, and the refusal itself is a ledger record (entry 30 is a red team refusal on a test chain, say so).
4.4 Instant: which day and which tool. The computable bucket (sha256(endpoint) mod 7) meant the target could compute its measurement day; the server's own tools/list order chose the tool. Salted commit-reveal against a future Bitcoin block hash derives both. Found by the operator's own transparency letter, which was simultaneously a disclosure and an exploit recipe; kept on the record; implemented in gate 0.3.0 as the coordinate_derivation block; zero derived verdicts in the committed history as of 2026-09-06 (claim register C15), so deployed but not yet exercised; salt is single use per window (residual named).

5. Adversarial harnesses. Table 1: instance, harness file, vector count, what stays green in every attack (evidence integrity, canonical, reproducible), what is refused. Counts taken from the files at draft time (join 8, census 10, freshness v2 9, instant js 26 py 17 per the claim register; time, localheaders, p2p, stream: count from the files).

6. The witness's side. Entry 25 (witness state record 0001): the founding witness's corresponding state on his own verifier (three sources, quorum tip, unanimity for authentic), his review of the operator's harness (one defect, two residuals), his independent verification of entries 26, 27 and 28 (raw bytes re-hashed, .ots deserialised with his own library, block 965447 on entry 26), and his question that produced refusals v1 (is "two valid chains, refuse and name" queryable on the ledger or only legible in prose). Written from the anchored records, not from messages; his own account of his system in his own words where the record carries them.

7. What is deployed versus designed, in one table (Table 2): instance, spec entry, code pinned by manifest, deployed in production, exercised on real data, first real exercise expected. The instant coordinate row reads deployed 0.3.0, exercised no, September history. The census row reads live coordinate crt.sh only, single source. This table is the paper's honesty spine, the way the retention failure and the label collapse were in paper 1.

8. Limits. The census boundary is structural for private networks, non-HTTPS transports and clients that ignore SCTs; named unknown, never absent. The quorum shares an axis the witness named in his own source (mempool codebase). A refusal is a record, not a detection: it says which chain was not chosen and why, not that the other was right. The operator is a subject: its own endpoints are counted under the same census and its own adjudications under the same join guard. Determinism is not truth (carried from paper 1).

9. Pre-registration. Two things the September records will show for the first time: derived verdicts in the committed history (C15 turns from "no derived beacons" to counts), and a second party's census of the operator's scope, which either matches or produces the first census discrepancy record. Either result is reported in a revision.

Appendix A: reproduce (the eight harness commands from the manifest, all offline, plus the live census command).
Appendix B: the anchored entries, verbatim claim heads and hashes (Table 3 below), with Bitcoin blocks filled from the ledger at draft time.
Acknowledgements and disclosure: same shape as paper 1 (operator conflict, second author's own service, no money either way).

## Evidence ledger (Table 3 seed; sha256 prefixes recomputed from the local claim files on 2026-09-06)

| entry | schema | what it anchors | claim sha256 (prefix) |
|---|---|---|---|
| 22 | nenrin-coordinate-v1 | the specification, two scales | 5be2b22e339d8b5c |
| 23 | nenrin-coordinate-v1-manifest | pinned bytes of the eight harness files | 24a7ed47167dc068 |
| 24 | addendum time-v3 | quorum; forged versus unverifiable; v3.1 discrepancy, v3.2 veto, v3.3 tip under quorum | 447bcf4f38cd8099 |
| 25 | nenrin-witness-state-0001 | the founding witness's corresponding state | 950edfee4e57835f |
| 26 | addendum sources-v1 | operator independence, corroboration, the authentic rule | 04908cd53c006ea0 |
| 27 | addendum localheaders-v1 | a chain and not a website | f5512ea3bb476e33 |
| 28 | addendum localheaders-v2 | the courier is the network (p2p) | 5ed2027f4ce46a11 |
| 29 | addendum localheaders-v3 | from genesis, no checkpoint | 937ce7049c1962f9 |
| 30 | refusal record (JSON) | a red team refusal, chain test, two valid chains named | 07830db2cf32aaee |
| 31 | addendum refusals-v1 | a refusal is a record | 71683e3a7b44bda0 |
| 33 | nenrin-instant-v1 | the instant coordinate; narrowing after freshness_beacon | e228dfd8e5353525 |

Bitcoin blocks: 22, 23, 24, 26 confirmed (local .ots carry attestations); 25, 27 to 31, 33 to be read from the ledger pages at draft time (the local .ots copies are pre-upgrade; entry 26 is at block 965447 per the witness's check). Paper 1's entries 32, 34, 36 are cited only for method.

## Tables planned
Table 1 harnesses (section 5). Table 2 deployed versus designed (section 7). Table 3 anchored entries (Appendix B). Table 4, optional: the four instances side by side (subject, coordinate, involuntary source, refusal name), if section 4 gets long.

## Decisions for TOshi (my recommendation in parentheses)
1. Keep the transparency letter story in 4.4, the disclosure that was also an exploit recipe. (Keep. It is the paper's equivalent of paper 1's retention failure, and it is already anchored in entry 33.)
2. Name HORIZON SHIELD's fair-price adjudication as the record-level exposure. (Keep. The spec names it; hiding it would contradict the anchored text.)
3. Present entry 30 as what it is, a red team refusal on a test chain, not a production refusal. (Yes, in those words.)
4. Quote the witness's two sentences from the anchored spec. (Yes. They are in an anchored public document; no private message is quoted anywhere.)
5. Co-authorship. His two questions are the origin, his verifier is the counterpart state, his checks are in the record. (Invite after 7419998 goes live, with this outline attached as a GitHub path, the same way as paper 1. Until he answers, draft as two authors with his sections marked, as before: section 6 and the witness half of 4.3 are his to write or correct.)
6. Word budget 6,000, one week, September history not required (the pre-registration covers it).

## Order of work
1. TOshi reads this and cuts. 2. 番人 drafts sections 1 to 5 and 7 to 9 with Table 3 filled from the ledger, as papers/nenrin-coordinate/manuscript_v0.1.md, after 7419998 is live. 3. Invite DM to the witness with the path and commit. 4. His section 6 and corrections. 5. v0.2 review, PDF, SSRN with the same sheet.
