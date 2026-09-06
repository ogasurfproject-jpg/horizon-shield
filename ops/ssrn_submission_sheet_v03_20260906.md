SSRN submission sheet, paper v0.3 (commit 686a7182), prepared 2026-09-06. Paste field by field. Nothing here goes into any repository except this sheet itself (the co-author's email is NOT written here; TOshi types it from the DM into the SSRN author field only).

TITLE
Same File In, Same Bytes Out: Reproducible Conduct Records for Agent-Facing Services, Tested by an Independent Reimplementation

FILE
papers/nenrin-reproducibility/nenrin_reproducibility_v0.3_686a7182.pdf (9 pages, A4)
sha256 0cedbb9ac9aa61447495b9b3dc48c931930c1e402507a8ea70ff74ff1bb1d6c4

ABSTRACT (308 words, one paragraph, no dashes)
AI agents can already discover services. What they cannot obtain is a record of how a service behaved that the service did not author. Scores and rankings fill that gap today, and scores are gameable by construction. NENRIN is a public, Bitcoin-anchored record of conduct for agent-facing services (Model Context Protocol servers and similar endpoints) built on counts rather than scores. Its third layer, the ring, bundles one calendar month of measured history for one endpoint into one file: how many times it was sampled, how many times it answered, how many distinct tool surfaces were observed, how many independent witnesses measured it, and what the record cannot say. The specification claims that anyone holding the same history can rebuild the ring byte for byte. This paper tests that claim the hard way. A second implementer, who had executed the reference builder as a black box but had not read its body, wrote a builder in a different language (Node.js) from the anchored specification and the published ring files, and ran it against the eight published August 2026 rings. All eight reproduced byte for byte, and both results were anchored (JIDEC entries 32 and 34). The exercise surfaced one seam that a naive port would have crossed without noticing: the specification does not state the canonical form at all, so nested key ordering was inherited from a language runtime and reached the second implementer through the published artifacts rather than through the specification. We report the protocol, the eight matches, the seam and its class, and the limits: byte reproducibility proves that the ring layer is deterministic, not that the measurements inside it are true; two implementations are not a community; the August rings carry a single witness. A blind rerun against the September rings, which will be the first to include a second witness, is pre-registered here.

AUTHOR 1 (corresponding)
Toshikatsu Oga
Affiliation: The HORIZONs Co., Ltd. (HORIZON SHIELD), Hiratsuka, Japan
ORCID: 0009-0000-9180-903X
Email: the address already on the SSRN account

AUTHOR 2
Federico Blanco Sánchez-Llanos (Sánchez with the accent)
Affiliation: Viper Labs
Email: the address he gave by LinkedIn DM on 2026-09-06 00:11 JST, typed into the SSRN field only, never into a file or a repository

KEYWORDS
reproducibility; independent reimplementation; transparency log; agent-facing services; Model Context Protocol; canonical JSON; RFC 8785; OpenTimestamps; Bitcoin anchoring; conduct record; verification; open witness

JEL CODES (suggested)
L15 Information and Product Quality; Standardization and Compatibility
L86 Information and Internet Services; Computer Software
D82 Asymmetric and Private Information; Mechanism Design
C88 Other Computer Software

SSRN NETWORKS / SUBJECT AREAS (pick what the form offers)
Computer Science Research Network (CompSciRN): Software Engineering; Cryptography and Security; Distributed Systems
Information Systems and eBusiness Network (ISN)
Economics Research Network (ERN): Industrial Organization, if offered

NOTES FOR THE FORM
Type: working paper. Date written: 2026-09-06. Not previously published. Code and data: public, github.com/ogasurfproject-jpg/horizon-shield (paper source and reference builder), github.com/ogasurfproject-jpg/mcp-conduct-register (history exports and rings), github.com/babyblueviper1/invinoveritas (independent Node.js builder), ledger.horizonshield.dev (JIDEC entries 32, 34, 36).
Funding: none. Conflicts: stated in the paper's Acknowledgements and disclosure section.
Both authors approve the text before posting; the co-author's approval is by LinkedIn DM, and SSRN will email him a consent notice after submission.

AFTER SUBMISSION
Record the SSRN abstract id in ops/ and in the paper's repository README once the paper is distributed; add the id to llms.txt Preprint section; tell Federico the id in one line.
