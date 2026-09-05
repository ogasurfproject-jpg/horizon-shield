# Same File In, Same Bytes Out: Reproducible Conduct Records for Agent-Facing Services, Tested by an Independent Reimplementation

**Working paper, draft v0.2, 2026-09-05 (co-authorship confirmed 23:34 JST). Not yet posted.**

Toshikatsu Oga, The HORIZ音s株式会社 (HORIZON SHIELD), Hiratsuka, Japan. ORCID 0009-0000-9180-903X.

Federico Blanco Sánchez-Llanos, Viper Labs (builds invinoveritas, a verification layer for autonomous agents).

[Division of work, stated for the record: T.O. designed and operates NENRIN, wrote the reference implementation, and drafted this paper. F.B.S.L. wrote the independent Node.js implementation and performed the blind runs; Sections 4.2 and 6 are his to write and the current text there is a placeholder drafted from the anchored record for him to replace. Both authors approve the final text before posting.]

## Abstract

AI agents can already discover services. What they cannot obtain is a record of how a service behaved that the service did not author. Scores and rankings fill that gap today, and scores are gameable by construction. NENRIN is a public, Bitcoin-anchored record of conduct for agent-facing services (Model Context Protocol servers and similar endpoints) built on counts rather than scores. Its third layer, the ring, bundles one calendar month of measured history for one endpoint into one file: how many times it was sampled, how many times it answered, how many distinct tool surfaces were observed, how many independent witnesses measured it, and what the record cannot say. The specification claims that anyone holding the same history can rebuild the ring byte for byte. This paper tests that claim the hard way. A second implementer, with no access to the reference source, wrote a builder in a different language (Node.js) from the anchored specification alone and ran it against the eight published August 2026 rings. All eight reproduced byte for byte, and both results were anchored (JIDEC entries 32 and 34). The exercise surfaced one seam that a naive port would have crossed without noticing: the reference canonical form inherits nested key ordering from a language runtime rather than from the specification. We report the protocol, the eight matches, the seam and its class, and the limits: byte reproducibility proves that the ring layer is deterministic, not that the measurements inside it are true; two implementations are not a community; the August rings carry a single witness. A blind rerun against the September rings, which will be the first to include a second witness, is pre-registered here.

## 1. The question

A claim of the form "anyone can verify this" costs nothing to make and is rarely tested by anyone but its author. In the growing ecosystem of agent-facing services, verification claims are common and tests are not. This paper is about one such claim and one such test.

The claim is in the NENRIN specification, Layer 3: a ring is deterministic in its inputs, so a stranger holding the same measured history can rebuild the ring and obtain the same bytes, and therefore the same SHA-256 that was anchored to Bitcoin. Until 2026-09-05 that claim had been exercised by exactly one person, the author of the reference implementation, which is to say it had not been tested at all. Running one's own program twice is not reproducibility.

The test is an independent reimplementation. A second person reads the specification, checks that the specification he is reading is the one the reference cites (by hash), writes a builder in a language the reference does not use, and runs it blind against the published inputs. Either the bytes match, or they do not, and either result is a finding. This is the discipline of reproducible builds applied not to software artifacts but to behavioral measurements of live services.

We report a match, eight of eight, and we report what the match does and does not establish.

## 2. Background

### 2.1 Discovery without conduct

Agent-facing services are discovered through registries and directories. Discovery is solved; conduct is not recorded. In one measured thirty-day window, one MCP server appeared in 93,983 search results and was invoked zero times. What an agent, or a person deciding whether to let an agent connect, cannot obtain is a record taken by parties other than the service itself, accumulated over time, and published whether or not it flatters the subject.

The common substitutes are scores, rankings and badges. Each is a single number chosen by whoever publishes it, and each can be improved by acting on the number rather than on the conduct. NENRIN's design rule is counts with denominators, never rates, scores or ranks, so that any reader who computes a rate has visibly left the record.

### 2.2 Prior art

The components are known and are named deliberately, in the specification and here. Transparency logs (Certificate Transparency; Sigstore Rekor) provide append-only, publicly auditable records. Reproducible builds (the Reproducible Builds project; Debian's bit-for-bit reproducibility effort) establish that independently produced artifacts should be byte-identical from the same source. Supply-chain provenance (in-toto; SLSA) records who did what to which inputs. Anchored timestamps (OpenTimestamps) bind a hash to a Bitcoin block. JSON canonicalization (RFC 8785, the JSON Canonicalization Scheme) defines a language-neutral serialization so that the same data structure yields the same bytes in any implementation. None of these is claimed as new.

What NENRIN combines, and what this paper tests one layer of, is: conduct of agent-facing services as the subject; an open witness model where anyone may submit anchored observations; witness disagreement as a first-class citable record; chained monthly bundles that form a duration credential no one can purchase; and the operator's own services measured under identical rules with failures retained. The specification states this combination as a falsifiable novelty claim and invites anyone who finds a prior instance to submit it as a witness record. This paper does not repeat that claim; it tests the reproducibility of one layer.

## 3. NENRIN Layer 3 as implemented

### 3.1 Inputs

A ring is built from two inputs. The first is the history export of one endpoint from the measuring instrument (the verification gate), a JSON document of dated records, each carrying a record SHA-256, a status (verified, pending, held), a consent source, and where measured, the hash of the endpoint's tool manifest. The second, optional, input is a set of witness records: walks of the same endpoint submitted by independent parties to the ledger in the jidec-path-v1 format, each carrying a walked_at time, a base URL, node fetches with body hashes, assertions, a verdict, and a witness identity.

A practical failure is worth recording. The instrument originally retained thirty records per endpoint. By early September the August window for the busiest endpoints was one sweep away from falling out of retention, which would have made the August ring unbuildable from a live export. Retention was raised to four hundred and, more importantly, the history exports were placed under an append-only daily archive in a public repository (github.com/ogasurfproject-jpg/mcp-conduct-register, directory history/). The rings in this paper were built from, and were reproduced from, those committed exports. A record that can only be rebuilt from a live endpoint is not reproducible; a record rebuilt from committed bytes is.

### 3.2 Output

For one endpoint and one calendar month, the builder emits one JSON object with these fields: schema (nenrin-ring-v1), ring (the month), endpoint, first_instant, last_instant, instants_sampled, instants_reached, instants_by_status, instants_by_consent_source, manifest_hashes_observed, surface_changes, witnesses, witness_identities, discrepancies, record_sha256_first, record_sha256_last, prev_ring, prev_ring_sha256, limits, and recompute. Every numeric field is a count. The limits field is a sentence generated from the counts that states what the ring cannot say, for example that with one witness no discrepancy could have been recorded, or that determinism was not measured on some instants because no owner consent existed to call a tool.

### 3.3 Bytes

The ring file is the UTF-8 encoding of the object serialized with keys sorted at every nesting level, two-space indentation, non-ASCII characters unescaped, and a single trailing newline. The reference implementation expresses this as Python's json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2) followed by a newline. The SHA-256 of these bytes is the ring's identity. The chain field prev_ring_sha256 is the SHA-256 of the previous month's ring file bytes, not of any compact or re-serialized form; this was a defect found and fixed before Ring 001 was anchored, and the reference builder refuses a previous ring whose bytes are not already canonical.

### 3.4 Anchoring

A month's rings are listed in a plain text file of SHA-256 values with paths (rings/2026-08.sha256). That file's SHA-256 is appended to the JIDEC ledger as a claim, and the claim is stamped with OpenTimestamps, which places it in a Bitcoin block within hours. Ring 001, covering August 2026 for eight endpoints, is JIDEC entry 32 (claim SHA-256 f3e589efca103f3f717a68857618411f5f0864e0ad1aa264089e70b9d89081cc).

## 4. Protocol

### 4.1 What "anyone can recompute" means operationally

1. Obtain the history export for the endpoint and month as committed in the public repository.
2. Run a builder that implements Section 3.
3. Compare the resulting bytes, or their SHA-256, with the anchored value.

The reference builder exposes this as a verify mode: given a ring file and the history it claims to be built from, rebuild and compare byte for byte, printing the first differing field if any.

### 4.2 Independent reimplementation

[Placeholder drafted by T.O. from JIDEC entry 34. To be rewritten by F.B.S.L., who performed the work.]

The stronger test adds four conditions. The second implementer (a) has not seen the reference source; (b) reads the specification and confirms by SHA-256 that it is the document the reference cites; (c) implements in a different language, so that runtime defaults cannot be inherited by accident; (d) runs blind against the published inputs and reports per-ring match or mismatch before seeing the reference outputs.

Condition (a) is a statement by the implementer and cannot be proven; it is recorded as such in the anchored record ("implementation_2_source_seen: none of implementation_1 (implementer's statement)"). Condition (b) is checkable and was checked: the specification's SHA-256, 9ccba2e325fd2a555fcdb2dec519b8c6bf7a669064674846aea98ecfff824e3d, matches the value cited at the head of the reference builder.

### 4.3 Recording the result

The result is not a message; it is a record. The second implementer's file was fetched fresh from its public repository at a named commit and hashed. The reference builder, the specification, each history export, and each anchored ring hash were hashed on the spot. All of these, with the result and its limits, were serialized as one plain text record and appended to the ledger as JIDEC entry 34 (claim SHA-256 fad6d00a25281102711573b151b321bc13b28c625fe65807c5eb3a12a04e393c). The second implementer then independently fetched entry 34 raw and re-hashed it, and fetched his own file from GitHub at the commit and re-hashed it, confirming both values. No hash in this paper was copied from a message.

## 5. Results

### 5.1 The eight August rings

Table 1 lists the eight endpoints, the counts their rings carry, and the outcome of both implementations. All eight endpoints are operated by the author (Layer 4, self-application); no external endpoint had consented to tool calls in August, which is itself stated in every ring's limits.

| Endpoint (slug) | sampled | reached | by status | manifest hashes | witnesses | ring SHA-256 (prefix) | Python | Node.js |
|---|---|---|---|---|---|---|---|---|
| mcp-horizonshield-dev-mcp | 26 | 26 | verified 23, pending 3 | 3 | 1 | 9ca61125 | match | match |
| hearing-horizonshield-dev-mcp | 26 | 26 | verified 23, pending 3 | 2 | 1 | ceb47d33 | match | match |
| web-horizonshield-dev-mcp | 26 | 26 | verified 23, pending 3 | 1 | 1 | 06d1f77b | match | match |
| gate-horizonshield-dev-mcp | 26 | 18 | verified 17, held 9 | 3 | 1 | e473f717 | match | match |
| jidec-horizonshield-dev-mcp | 24 | 22 | verified 22, held 2 | 1 | 1 | 3a215b6c | match | match |
| p001-horizonshield-dev-mcp | 26 | 26 | pending 26 | 1 | 1 | 00155986 | match | match |
| p002-horizonshield-dev-mcp | 26 | 26 | verified 18, pending 8 | 1 | 1 | 1f8d4f45 | match | match |
| femtech-horizonshield-dev-mcp | 5 | 5 | verified 5 | 2 | 1 | 7a310f5d | match | match |

Two rows deserve comment because they are unflattering and were kept. The gate row is the instrument measuring itself: nine of twenty-six instants are held because the gate cannot reach its own door from inside the same edge network, a limitation the ring states rather than hides. The p001 row is a partner endpoint that is pending on all twenty-six instants; a ring that could only be built when the numbers were good would not be a record.

### 5.2 Artifacts

Table 2 lists every artifact whose hash appears in entry 34.

| Artifact | Identity |
|---|---|
| Specification, NENRIN_SPEC_v1.md | SHA-256 9ccba2e325fd2a555fcdb2dec519b8c6bf7a669064674846aea98ecfff824e3d |
| Reference builder, make_ring.py (Python) | SHA-256 69719fed5ae6387bc9b363914e61ab70c8bfee320710fcd028191b90e41aa2c4 |
| Independent builder, make_ring.js (Node.js) | SHA-256 5167188aeefb4852ca941a96856724f8831abd46be331cd9544898ba038e82a8, 7,955 bytes, github.com/babyblueviper1/invinoveritas, commit 917dd97ff8e30107810d9a059e9091077f5171d0 (2026-09-05T13:08:01Z) |
| History exports (9 files, committed) | SHA-256 of each listed in entry 34 |
| Ring hashes, rings/2026-08.sha256 | JIDEC entry 32, claim f3e589ef... |
| Result record | JIDEC entry 34, claim fad6d00a..., schema nenrin-ring-reimpl-match-v1 |

The result: eight of eight rings byte-identical across the two implementations, from the same committed history, with the second implementer's run performed blind.

## 6. The seam

[Placeholder drafted by T.O. To be rewritten or corrected by F.B.S.L., who found the seam. Table 3 in particular should be checked against what the Node.js implementation actually does.]

The reimplementation succeeded, and the reason it did is the most useful thing in this paper: the implementer checked one thing that a port would have assumed.

Python's json.dumps(sort_keys=True) sorts dictionary keys at every level of nesting. JavaScript's JSON.stringify sorts nothing; it emits keys in insertion order. A port that reproduced the ring-building logic exactly and serialized with JSON.stringify(obj, null, 2) would produce output that looks like a ring, parses as a ring, carries the same counts, and hashes to a different value. Neither implementation alone could detect this: each is self-consistent. Only the comparison of bytes across the two exposes it. The second implementer did not fall into it. He checked the reference behaviour rather than assuming it, and added an explicit recursive key sort (objects sorted, arrays left in order) before serialization. A naive port would have looked plausible and been wrong in a way that neither implementation alone could have caught; that is why the seam, and not the byte match, is the finding.

The seam is real and it is the specification's fault, not the implementer's. The specification defines the canonical form by reference to a language runtime ("Python's json.dumps with these options") rather than by stating the rules. It was reproducible in practice; it was under-specified in principle. RFC 8785 exists precisely to remove this class of seam, and a future revision of the specification should either adopt it or state the serialization rules language-neutrally: key ordering by Unicode code point, string escaping, number formatting, whitespace, and the trailing newline.

Table 3 lists the latent seams of this class, and whether the August rings exercise them.

| Seam | Python reference behaviour | Exercised by August rings? | Risk |
|---|---|---|---|
| Nested key order | sorted at every level | yes, every ring | found and closed by the reimplementer |
| Key sort collation | by Unicode code point | no (all keys ASCII) | latent; JavaScript default sort is by UTF-16 code unit, which differs only for astral characters |
| String escaping of control characters | \uXXXX lowercase | no (no control characters in ring values) | latent |
| Non-ASCII characters | emitted raw (ensure_ascii=False) | no (all August ring values are ASCII) | latent; both runtimes emit raw UTF-8, so a match is expected but has not been exercised |
| Number formatting | integers only | yes | none while all numbers are counts; a float would open it |
| Indentation and separators | two spaces, ", " and ": " | yes, every ring | matched |
| Trailing newline | one | yes, every ring | matched |
| Chain hash input | previous ring file bytes | not yet (first ring, prev null) | first exercised by the September rings |

Two rows in Table 3 are marked as not yet exercised. The chain hash and the witness path (Section 7) are exactly the parts the September rings will test for the first time.

## 7. Limits

This paper claims less than it might appear to, and the record it cites says so in its own text.

Determinism is not truth. A byte-identical ring proves that the ring layer is a deterministic function of its inputs. It proves nothing about whether the inputs, the measurements inside the history export, are accurate. That question belongs to Layers 1 and 2 (open witnessing and discrepancy records), where an independent party measures the same endpoint and disagreement becomes a citable record. In August 2026 every ring carries witnesses: 1, the operator's own instrument, and the limits sentence in every ring says that no discrepancy could have been recorded because nobody else was positioned to record one.

Two is not many. Two implementations by two cooperating people is the minimum that makes the word "independent" meaningful, and no more. The second implementer is a technical peer who has cross-verified other parts of this ledger; he is not an adversary. An adversarial reimplementation, one that tries to produce a ring that parses and passes casual inspection while hashing differently, is a different test and has not been run.

The inputs are operator-published. The history exports were committed by the operator. The second implementer fetched them from the operator's repository. Reproducing the operator's rings from the operator's exports is a test of the builder, not of the operator. The anchoring of the exports' hashes in entry 34, and the daily append-only archive, make later alteration detectable; they do not make the original measurement independent. The independent measurement exists (one witness walk of the gate endpoint on 2026-09-05, submitted to the ledger by the second implementer) and enters the record in the September rings.

The canonical form is runtime-defined. Section 6.

The retention failure happened. Section 3.1. A reproducibility claim that depends on a live cache is not a reproducibility claim; the fix was to commit the inputs, and it was made one sweep before it would have been too late.

## 8. Pre-registration of the next test

The September 2026 rings will be built in the first days of October 2026 from the committed history exports and the witness records accepted by the ledger during September. Two things will be exercised for the first time: the chain field (prev_ring_sha256 equal to the SHA-256 of the August ring file bytes) and the witness path (the gate endpoint will carry witnesses: 2, and its limits sentence will change accordingly). The second implementer has stated that he will rerun make_ring.js against the September inputs blind, without first seeing the reference outputs, and report per-ring match or mismatch. The outcome, either way, will be appended to the ledger and reported in a revision of this paper. A mismatch on the chain or witness path would be a more valuable result than the eight matches reported here, because it would locate a second seam.

## 9. Conclusion

"Anyone can recompute this" was true in principle from the day the specification was anchored and untested in fact until a stranger to the source did it in another language. The eight matches are the evidence. The seam is the finding. The limits are the honest perimeter: this shows that the ring layer is a deterministic public function, and it points to the exact places, the chain and the witness path, where the next test will look.

Same file in, same bytes out, from someone who never saw the source. That is what verifiable was supposed to mean, and now, for one layer of one system, it has been checked rather than claimed.

## Appendix A. Reproduce it yourself

Clone github.com/ogasurfproject-jpg/mcp-conduct-register. For any August ring:

    python3 scripts/make_ring.py --verify rings/<slug>/2026-08.json --history history/<slug>.json

Compare the printed SHA-256 with the corresponding line of rings/2026-08.sha256, and compare the SHA-256 of that file with the claim of JIDEC entry 32 at ledger.horizonshield.dev/ledger/32. For the independent implementation, clone github.com/babyblueviper1/invinoveritas at commit 917dd97f and run scripts/nenrin_ring_reimpl/make_ring.js against the same history files.

## Appendix B. The anchored result record

[Insert the record_canonical of JIDEC entry 34 verbatim, as fetched raw from ledger.horizonshield.dev/ledger/34?format=raw, with its claim SHA-256 and, once confirmed, its Bitcoin block.]

## Acknowledgements and disclosure

The author operates every endpoint measured in this paper and the ledger that anchors the records; that is Layer 4 of the design, and it is also a conflict of interest, stated here. Neither author received compensation for any part of this work. No party paid for any measurement or record cited.

## References

[To be completed: Certificate Transparency (RFC 6962 / RFC 9162); Sigstore Rekor; Reproducible Builds project; Debian reproducible builds; in-toto; SLSA; OpenTimestamps (Todd, 2016); RFC 8785 JSON Canonicalization Scheme; Model Context Protocol specification; NENRIN_SPEC_v1.md (JIDEC entry, SHA-256 9ccba2e3...); JIDEC ledger entries 32, 33, 34; the author's prior working papers on buyer-side verification (SSRN 6964439) and LLM benchmarking (SSRN 6872819).]
