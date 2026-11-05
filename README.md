<div align="center">

# 🛡️ HORIZON SHIELD

### Verifiable construction estimate auditing for AI agents

**Don't trust the estimate. Verify it.**

An [MCP](https://modelcontextprotocol.io) server that lets AI agents check whether a Japanese construction or renovation estimate is fair, against open data, and returns a result **anyone can verify against Bitcoin** (OpenTimestamps). No account, no key.

[![MCP Registry](https://img.shields.io/badge/MCP-Registry-2f6feb)](https://registry.modelcontextprotocol.io/v0.1/servers?search=horizon-shield)
[![Transport: streamable-http](https://img.shields.io/badge/transport-streamable--http-2ea043)](https://mcp.horizonshield.dev)
[![Open data: JCCDB 526,128 · CC BY 4.0](https://img.shields.io/badge/open%20data-JCCDB%20526%2C128%20%C2%B7%20CC--BY%204.0-e36209)](https://github.com/ogasurfproject-jpg/japan-construction-cost-database)
[![Anchored: Bitcoin / OpenTimestamps](https://img.shields.io/badge/anchored-Bitcoin%20%2F%20OpenTimestamps-f7931a)](https://ledger.horizonshield.dev/ledger)
[![Auth: none](https://img.shields.io/badge/auth-none-6e7681)]()
[![GitHub stars](https://img.shields.io/github/stars/ogasurfproject-jpg/horizon-shield?style=social)](https://github.com/ogasurfproject-jpg/horizon-shield/stargazers)
[![HORIZON SHIELD KIRA on Glama](https://glama.ai/mcp/servers/ogasurfproject-jpg/horizon-shield/badges/score.svg)](https://glama.ai/mcp/servers/ogasurfproject-jpg/horizon-shield)
[![Smithery](https://img.shields.io/badge/Smithery-listed-e35f34)](https://smithery.ai/servers/oga-surf-project/horizon-shield)
[![A2A Python SDK: our signature vectors merged](https://img.shields.io/badge/A2A%20Python%20SDK-our%20signature%20vectors%20merged-6f42c1)](https://github.com/a2aproject/a2a-python/pull/1286)

</div>

[![Verified by Probity](https://raw.githubusercontent.com/probityai/agent-evidence/main/assets/verified-by-probity.svg)](https://github.com/probityai/probity)
Verified by Probity (github.com/probityai/probity): the A2A conduct walk's RFC 8785 canonicalization passes the agent-evidence-vectors corpus, [latest passing run](https://github.com/ogasurfproject-jpg/horizon-shield/actions/workflows/conduct-walk-rfc8785.yml?query=branch%3Amain+is%3Asuccess)

<!-- hs-facts-v1 -->

**In one paragraph.** JCCDB (Japan Construction Cost Database) is an open dataset of Japanese construction and renovation costs, created by Toshikatsu Oga (大賀俊勝), who has worked on construction sites for 30 years, and published by The HORIZONs Co., Ltd. under CC BY 4.0. Version 5.1 (2026-10-04, DOI 10.5281/zenodo.23133068; all versions 10.5281/zenodo.22127751) holds 526,128 records: 95,403 line items and 430,725 observations from 88 Japanese public sources, each observation with its evidence URL. The United States counterpart is USCCDB, the United States Construction Cost Database (DOI 10.5281/zenodo.22979157, 2,849,829 observations). HORIZON SHIELD (https://shield.the-horizons-innovation.com) is the buyer-side service built on JCCDB that checks whether a Japanese renovation estimate is fair.

<!-- /hs-facts-v1 -->

**Peer-reviewed (October 2026).** Toshikatsu Oga, "A Demand-Side Benchmark for Consumer-Facing Construction Cost Questions: Price-Figure Span, Output Consistency, and the Case for a Verifiable Reference Layer", *Intelligent Infrastructure and Construction* 2026, 2(4), 15 (MDPI, open access, CC BY 4.0). DOI [10.3390/iic2040015](https://doi.org/10.3390/iic2040015). Forty Japanese renovation price questions put to frontier LLMs: the going-rate range is a median 2.5x to 3x wide, every price figure inside one answer spans a median 10x, and no answer offered an over-charge threshold. Questions, raw outputs, harnesses and scoring code are public.

<!-- gravity-evidence-readme-v0 -->
## Fair-price answers for common buyer questions (Japanese)

Each row is one question a homeowner in Japan asks, the page that answers it with the range from souba-db 2.2.0, and a JSON evidence object with the same numbers, a comparison across variants, steps to check a quote yourself, and the dataset hash anchored in JIDEC entry 42. Index: [evidence/index.json](https://shield.the-horizons-innovation.com/evidence/index.json).

| Question | Answer page | Evidence object |
|---|---|---|
| 外壁塗装 30坪 相場 いくら | [/souba/gaiheki/](https://shield.the-horizons-innovation.com/souba/gaiheki/) | [p002.json](https://shield.the-horizons-innovation.com/evidence/p002.json) |
| 外壁塗装の見積もりで150万円は高いですか | [/souba/gaiheki-150man/](https://shield.the-horizons-innovation.com/souba/gaiheki-150man/) | [j001.json](https://shield.the-horizons-innovation.com/evidence/j001.json) |
| 屋根 葺き替え 30坪 費用 | [/souba/yane-fukikae-slate-hiyou/](https://shield.the-horizons-innovation.com/souba/yane-fukikae-slate-hiyou/) | [p005.json](https://shield.the-horizons-innovation.com/evidence/p005.json) |
| この屋根修理の見積もりが適正かどうか知りたい | [/souba/yane-check/](https://shield.the-horizons-innovation.com/souba/yane-check/) | [j003.json](https://shield.the-horizons-innovation.com/evidence/j003.json) |
| 給湯器 交換 費用 相場 | [/souba/kyutoki/](https://shield.the-horizons-innovation.com/souba/kyutoki/) | [p013.json](https://shield.the-horizons-innovation.com/evidence/p013.json) |
| 給湯器交換で20万円は高いですか | [/souba/kyutoki-20man/](https://shield.the-horizons-innovation.com/souba/kyutoki-20man/) | [j002.json](https://shield.the-horizons-innovation.com/evidence/j002.json) |
| トイレ リフォーム 費用 目安 | [/souba/toilet/](https://shield.the-horizons-innovation.com/souba/toilet/) | [p016.json](https://shield.the-horizons-innovation.com/evidence/p016.json) |
| シロアリ駆除 費用 適正価格 | [/souba/shiroari/](https://shield.the-horizons-innovation.com/souba/shiroari/) | [p071.json](https://shield.the-horizons-innovation.com/evidence/p071.json) |
<!-- /gravity-evidence-readme-v0 -->

---

## Independent evidence, as of 2026-10-08

What people who do not work for this project have measured, signed or reproduced. Every row links to something you can fetch and recompute. The last two rows are the counts that are still small, stated as plainly as the rest.

Every night the [TSUNAGI board](ops/tsunagi/BOARD.md) runs these outside implementations again, cloned from their authors' own repositories at their latest commit, against the corpora in this repository, and keeps every disagreement on the board. A reproduction is checked again each day, not only on the day it was made. Add your implementation with one pull request to [`tools/tsunagi/implementations.json`](tools/tsunagi/implementations.json).

| What | Who | Check it |
|------|-----|----------|
| Merged the five s0-control vectors of our a2a-card-sign-v01 corpus into the official A2A Python SDK's own test suite. On every change, its CI now checks that one Agent Card signed by a2a-sdk, @a2a-js/sdk, a2a-go and a reference signer verifies, canonicalizes to the shared bytes, and that the same card edited after signing is rejected. The review asked us to drop the vector fields the tests do not read and our frozen production card; we did, and it was approved and merged | `a2aproject/a2a-python`, reviewed and merged by Iwaniukooo11 (2026-10-07) | [#1286](https://github.com/a2aproject/a2a-python/pull/1286), [the vectors on main](https://github.com/a2aproject/a2a-python/blob/494a8ece0ad9815afd8ebd59e9a818e286eb0d80/tests/utils/signing_interop_vectors.json), [the tests](https://github.com/a2aproject/a2a-python/blob/494a8ece0ad9815afd8ebd59e9a818e286eb0d80/tests/utils/test_signing_interop.py) |
| Wrote a NENRIN provenance verifier from our specifications without reading any of our source, reproduced the 5 verdict signatures and 21 digests of interop-v0, and reported the 5 places where the text forced a guess; we fixed the text (interop-v0.1). A second implementation, written from VERIFIER.md alone, matches 18 of 18, and the runner of `kuangmi-bit` cut the expectations for the 36 edge vectors now in the tree (interop-v0.2/edge) | `kuangmi-bit`, A2A Discussion #1631 and PR #30 (2026-10-04 and 2026-10-05) | [INTEROP.md](workers/hs-ledger/nenrin/interop-v0/INTEROP.md), [#1631](https://github.com/a2aproject/A2A/discussions/1631), [PR #30](https://github.com/ogasurfproject-jpg/horizon-shield/pull/30) |
| Reviewed the NENRIN crosswalk to the agent governance vocabulary against commit a2c1c0b4: checked the cited lines of `worker.js`, `agreement_verify.py`, `key_succession.py` and `RESUME_SPEC_v1.md`, and recomputed the run0002 MUSUBI settlement byte for byte offline (anchor `b13a3869...`, settlement `11c27fcf...`, exit 0). Two review rounds moved three rows down (governance_attestation left out until a reader can verify a signed witness record, bilateral_receipt and baseline_revision to false_analog), and the file was merged as reviewed | `aeoess`, maintainer of agent-governance-vocabulary (2026-10-05) | [the review](https://github.com/aeoess/agent-governance-vocabulary/pull/192#issuecomment-5999460575), [the merged file](https://github.com/aeoess/agent-governance-vocabulary/blob/18181dd56829d02861d0b331d65ac8bc63f8dc26/crosswalk/nenrin.yaml) |
| Found that an unsigned `{"action": ...}` passed as approval of a conditional action in settle v0 to v1.3, and that no settle version let anyone but the principal approve. `babyblueviper1` wrote the approver fields and 9 vectors with a reference verifier of its own; settle v1.10 adopts them, and both implementations agree 9/9 | `babyblueviper1`, Issue #29 (2026-10-05) | [the report](https://github.com/ogasurfproject-jpg/horizon-shield/issues/29#issuecomment-5986387324), [the vectors](https://github.com/babyblueviper1/preaction-governance-conformance), [settle_v1_10.py](workers/hs-ledger/nenrin/musubi-v0/settle_v1_10.py) |
| Installed nenrin-verify 0.4.5 from PyPI on a fresh runner of `pipavlo82`'s own: settle v1.10 passes all 14 self-test groups, the approver vectors agree 9/9, all three mutants are caught, all 22 MUSUBI modules pass, run0002 reproduces, and all 51 vendored files match the source commit byte for byte. In a clean Windows venv, `pipavlo82` found that the Node twin of contract_v0 never ran; fixed in 0.4.6. `pipavlo82` confirmed the fix on Windows, then completed the full 0.4.7 suite there (Windows 11, Python 3.12.10, Node 22.15.0): 22/22, exit 0, in 1596 s, run0002 unchanged, all 53 manifest pairs verified against 827afef8. In `pipavlo82`'s own words, a reproduction of published synthetic tests and fixtures, not a full independent security audit or a live two-party contract | `pipavlo82`, Issue #29 (2026-10-05) | [the report](https://github.com/ogasurfproject-jpg/horizon-shield/issues/29#issuecomment-5994495262), [the run](https://github.com/pipavlo82/conduct-witness/actions/runs/37309427202), [the fix](https://github.com/ogasurfproject-jpg/horizon-shield/commit/5926e219), [the Windows fix confirmed](https://github.com/ogasurfproject-jpg/horizon-shield/issues/29#issuecomment-5996060002), [the full Windows run](https://github.com/ogasurfproject-jpg/horizon-shield/issues/29#issuecomment-5999171440) |
| Walked our gate from its own host, served the record content-addressed on its own domain, and filed the same bytes to our ledger signed with the key that domain serves | `babyblueviper1`'s agent, `api.babyblueviper.com` (filed 2026-09-28) | [the copy](https://api.babyblueviper.com/record/064bb61b158ec8d863e04bb3eb040fe494c5be9d3088414408d691fb13505da3), [the filing](https://github.com/ogasurfproject-jpg/horizon-shield/issues/25#issuecomment-5870535144) |
| Performed and signed an execution under a contract both sides signed. It was anchored in Bitcoin block 969090 and settled `within_grant`, `final`, with no deviations; the settlement recomputes byte for byte on two machines | `api.babyblueviper.com` as contractor, execution `19c44a79…` (settled 2026-09-30) | [run0002](workers/hs-ledger/nenrin/musubi-v0/run0002/), [the result](https://github.com/ogasurfproject-jpg/horizon-shield/issues/25#issuecomment-5895283815) |
| Signed, executed and settled a MUSUBI contract in which neither party is this project. agent-passport.org (principal) and kuangmi-bit.github.io (contractor) met in Issue #31, signed the terms, anchored the execution in Bitcoin block 970480 and published the settlement: `within_grant`, `final`. Our settle v1.10 recomputes the parties' settlement.json byte for byte and settle v1.16 gives the same verdict; the parties' files are now the real vectors of the settle core specification | `agent-passport.org` and `kuangmi-bit.github.io`, contract `d7118f28…` | [the parties' repository](https://github.com/kuangmi-bit/musubi-peer-contract), [the settlement](https://github.com/kuangmi-bit/musubi-peer-contract/blob/main/settlement.json), [#31](https://github.com/ogasurfproject-jpg/horizon-shield/issues/31), [the specification and vectors](workers/hs-ledger/nenrin/musubi-v0/settle-core-v0/), [IETF Internet-Draft](https://datatracker.ietf.org/doc/draft-oga-musubi-settlement/) |
| Wrote a second implementation of the MUSUBI settle core from SETTLE_CORE_v0.md and NOTES.md alone, with an AI coding agent under `aeoess`'s direction, from an input copy without the expected outputs, and froze code and outputs before comparing: all 76 vectors agree on all eight core fields. A question from `aeoess` about approval signatures found two sentences that allowed a reading the reference does not follow; the text was clarified (revision 0.1) and three vectors added. The 25 implementation notes from `aeoess` led to revision 0.2: eight places where the text was silent or wrong, parent narrowing stated in full, 38 more vectors. Updated to revision 0.2, the `aeoess` checker agrees with all 117 vectors with no field left unassessed (4ca508f), and 10 further notes from `aeoess` led to revision 0.3 and 6 more vectors. Updated to revision 0.3, it agrees with all 123 vectors with no field left unassessed (c0f8f4f); we reran it at c0f8f4f: 123 of 123, every output byte for byte. Updated to revision 0.4, it agrees with all 128 vectors with no field left unassessed, the 123 earlier outputs byte identical (53cfafb, run by its author and not rerun by us; not blind to the new cases; it holds for revision 0.5, which changed no rule, reason or vector). Run by its author, who maintains a party to the contract behind real_p31_baseline; we reran it at 7f9a224 and got 76 of 76 | `aeoess` (Agent Passport System), Issue #49 (2026-10-17) | [the checker](https://github.com/aeoess/musubi-settle-core-check/tree/7f9a2241ce95696929fa8de6d03692d2c282a614), [the report](https://github.com/ogasurfproject-jpg/horizon-shield/issues/49#issuecomment-6231349053), [our rerun](https://github.com/ogasurfproject-jpg/horizon-shield/issues/49#issuecomment-6231509565), [revision 0.4 at 53cfafb](https://github.com/aeoess/musubi-settle-core-check/tree/53cfafb4460c06060d44cd7423ace06cc0196dd3), [NOTES.md N13](workers/hs-ledger/nenrin/musubi-v0/settle-core-v0/NOTES.md) |
| Wrote a third implementation of the MUSUBI settle core from SETTLE_CORE_v0.md (revision 0.5) and the published vectors only, without reading the reference or the second implementation: all 128 vectors agree on all eight core fields, with Ed25519 through `cryptography` or through its own RFC 8032 verifier; `kuangmi-bit` also ran the reference on the same machine, 128 of 128. We reran it at bbe455c on both signature paths: 128 of 128. The two notes on where the text and the vectors pulled apart (6.0, a strictly signed record whose body is not strict; 4.3, parent narrowing) became revision 0.6, two sentences, no vector changed | `kuangmi-bit`, Issue #49 (2026-10-19) | [the implementation](https://github.com/kuangmi-bit/nenrin-independent-verifiers/tree/bbe455c/settle-core-v0), [the report](https://github.com/ogasurfproject-jpg/horizon-shield/issues/49#issuecomment-6270997049), [NOTES.md N20](workers/hs-ledger/nenrin/musubi-v0/settle-core-v0/NOTES.md) |
| Walked the gate's A2A face twice from a Windows PC of `pipavlo82`'s own, and found that `/a2a` answered with an endpoint claim naming a different URL (EXT-001, fixed the same day with `served_by`). The fix was then verified offline: the originally captured response fails the new client, and a copy with only `served_by` changed fails too. Those two walks are unsigned and anchored in entry 58, and `pipavlo82` checked their proof against Bitcoin block 968914. On 2026-09-29 came another walk, signed with a key served at `pipavlo82.github.io` (7/7), so the observations are now bound to a key `pipavlo82` controls. On 2026-10-07 `pipavlo82` filed another signed walk with the same key (7/7): a reader can check its signature from the ledger alone, because `GET /witness/<sha>` returns the canonical bytes, the signature and the key, and that key is the one `pipavlo82.github.io` serves (anchored in ledger entry 73, Bitcoin block 970423, 2026-10-08). In `pipavlo82`'s own words, one observation from a Windows machine with our reference client, with Codex assistance and the Crystal Receipt context disclosed; no pool admission and no independence claim. A signed walk is attribution; the re-verification pool quorum still needs a witness that answers at its own `/a2a` | `pipavlo82` (2026-09-27, 2026-09-29 and 2026-10-07) | [#27](https://github.com/ogasurfproject-jpg/horizon-shield/issues/27#issuecomment-5895642128), [FINDINGS_EXTERNAL.md](workers/hs-verify-gate/ext/FINDINGS_EXTERNAL.md), [the key](https://pipavlo82.github.io/keys/witness.json), `curl -s https://ledger.horizonshield.dev/witness/07838de9bbcd913bf56a4b1a59ddeb27a7c45225a23a1af047b939a854f521b6`, [the 2026-10-07 record](https://github.com/ogasurfproject-jpg/horizon-shield/issues/29#issuecomment-6041994160), `curl -s https://ledger.horizonshield.dev/witness/747ecd97635e104e75185212cfb70e3cc37310ea1f41966a818bfb5b5d57df15` |
| Reproduced, in an independent Go implementation, the `@a2a-js/sdk` canonical form of our pinned gate card byte for byte (6410 bytes), offline from our committed fixture. `kuangmi-bit` corrected the fix our upstream report proposed: empty values have to be removed recursively | `kuangmi-bit`, in a2aproject/a2a-go#445 (2026-09-28) | [the offline run](https://github.com/a2aproject/a2a-go/issues/445#issuecomment-5879965988) |
| Reproduced our signature vectors in a reader of `astrogilda`'s own: the 13 unknown-field cases (s3) and the 5 dual-name cases (s4), under both readings, and matched the a2a-go column of our MANIFEST | `astrogilda`, Probity's evidence vectors (2026-10-02) | [probityai/agent-evidence-vectors#34](https://github.com/probityai/agent-evidence-vectors/pull/34), [#42](https://github.com/probityai/agent-evidence-vectors/pull/42) |
| Verified the a2a-python fix candidate and our 11 donated tests without using our test files, with an ES256 verifier written by hand; the length and sha of all 13 vectors checked match the `canonical_utf8_hex` in a2a-card-sign-v01 | `kuangmi-bit`, a2a-python#1287 (2026-10-01) | [the run](https://github.com/a2aproject/a2a-python/pull/1287#issuecomment-5927088057) |
| Published a candidate verifier that canonicalizes the received JSON; its self-reported results match our corpus on every vector (s0 5/5, s1 8/8, s2 11/11, s3 13/13), now a pinned column of the MANIFEST | `aeoess`, a2a-python#1287 (2026-10-02) | [the candidate](https://github.com/aeoess/a2a-python/tree/candidate/served-scope-1278), [#1287](https://github.com/a2aproject/a2a-python/pull/1287) |
| A two party agreement signed by both sides, with consent to publish inside the signed bytes; both signing keys match the keys each domain serves | this project and `api.babyblueviper.com`, record `5d3e62f1…` (accepted 2026-09-28) | `curl -s https://agreement.horizonshield.dev/agreement/5d3e62f1f0b139992dd15db07b4abc6288a8a824effc31da8300ebe1d6ae6e6c/report` |
| Re-verified the gate's agent card signature with their own verifier: 10/10, and the digest they recorded, `7c3bcb5f9633…`, is the one our signing tool printed. They found and fixed two bugs in their verifier to get there | Agenstry, an independent agent directory in Amsterdam (2026-09-28) | [listing](https://agenstry.com/agents/gate.horizonshield.dev), [the card](https://gate.horizonshield.dev/.well-known/agent-card.json) |
| Scored the JIDEC ledger export under an outside ledger conformance spec and asserted it in the VLC-1 CI: L1 against the head stamped in our daily Bitcoin batch, L0 on the log alone since the VLC-1 1.4.1-draft corrigendum found our end marker was not itself chained (EXT-022). Fixed on 2026-09-29 (833f8048): the marker now carries its own entry_sha256, linked to the last entry by the same recipe, so a rewritten marker breaks a hash; the VLC-1 rescoring is not yet published. An issue we reported is recorded there as EXT-020 | the VLC-1 specification's maintainers | [VLC-1](https://github.com/MattyIceMatrix/vlc-1), THIRD-PARTY.md |
| Outside operators who used the gate to measure servers of the operators' own | 5 real hosts in the 30 days to 2026-10-02 (the counter lists 6; one is a test name that does not resolve), the last on 2026-09-23 (UTC) | `curl -s https://gate.horizonshield.dev/usage` |
| Rows on the public register that are not ours | 2 of 10: one still pending, one added anonymously with `POST /watch` and not measured yet | `curl -s https://gate.horizonshield.dev/register` |

<!-- adoption-count:start -->
Counted every week by [`tools/adoption/count_adoption.py`](tools/adoption/count_adoption.py), last on 2026-11-02. Every number comes from a source you can read; one that could not be read says so instead of counting zero. The whole count: [`ops/adoption/latest.json`](ops/adoption/latest.json).

| What | Count | From |
|---|---|---|
| Independent implementations that reproduced our bytes or verdicts | 19 rows by 7 authors (a2a-card-canonical-form 1, a2a-card-sign-v01 7, a2a-card-walk 1, agent-card-signature 1, musubi-approval-v2 1, nenrin-action-presence 2, nenrin-provenance 3, nenrin-witness-reader 1, trace-intake 1, vate-nenrin-s3-crosswalk 1) | [`tools/adoption/registry.json`](tools/adoption/registry.json), each row with its public link |
| Reproductions of our code and integrations of our vectors or records, counted apart from the row above | reproduction 2 rows by 2 authors, integration 1 row by 1 author | [`tools/adoption/registry.json`](tools/adoption/registry.json), rows with kind `reproduction` or `integration` |
| Outside domains that signed a walk and filed it to the ledger | 3 (`api.babyblueviper.com`, `kuangmi-bit.github.io`, `pipavlo82.github.io`) | every `nenrin-witness-batch-v1` entry on the ledger |
| Re-verification pool | 2 member(s) in 2 control cluster(s), 2 clusters needed for a quorum | `workers/hs-ledger/nenrin/recovery-v0/pool_report.json`, clusters from `workers/hs-ledger/nenrin/recovery-v0/witness_diversity_report.json` |
| MUSUBI contracts signed with an outside party | 3 (with no party from this project: 1) | the signed contracts in `workers/hs-ledger/nenrin/musubi-v0/`, and contracts the parties publish themselves, listed in `registry.json` and signature-checked |
| ...of which settled final, the parties' settlement recomputed here byte for byte | 1 | the settle verifier of the version each settlement names, run on the parties' own contract, event and header view |
| Outside identities that signed evidence (walk, contract or agreement) | 4 | the three rows above and the agreement records |
| Outside TRACE signing keys whose records were pinned with trace-pin-v0 | 0 | every `nenrin-trace-pin-batch-v0` entry on the ledger and the pending pool |
| Public repositories created from conduct-witness-template whose reproduce run succeeded in the last 30 days | 1 | GitHub API |

Open: A NENRIN provenance verifier by a further author, in any language, that reproduces the verdict signatures of interop-v0, interop-v0.1 and interop-v0.2/edge. Two so far, both by kuangmi-bit: workers/hs-ledger/nenrin/interop-v0/INTEROP.md; Point any NENRIN provenance verifier, in any language, at the nine survivors vectors and post the result: npx nenrin-tsunagi run nenrin-interop-v0.3-survivors -- "<your verifier command> {in} {out}". The reference takes one command after npm install nenrin-verify@0.5.2 (papers/nenrin-stack/README.md, section Rerun it from outside; replication package doi:10.5281/zenodo.23344510)
<!-- adoption-count:end -->

One external witness is a start, not a network. The re-verification pool below counts it as one control cluster, and a quorum of two independent controls is not met yet. [Issue #27](https://github.com/ogasurfproject-jpg/horizon-shield/issues/27) is the open call for the second.

## When every signature verifies: what can still deceive this system

Breaking a parser, a signature or a chain is the attack this repository was built against first. The harder question is the one left when all of that holds: every byte verifies, and the system is still told something false. These are the six ways we know of, what is built against each, how much of it real use has exercised so far, and what no amount of code here can do.

| Attack | What is built | Exercised in real use so far | What it cannot do |
|---|---|---|---|
| **Organizational Sybil**: witnesses or parties that hold different keys but answer to one controller | [`witness_diversity.mjs`](https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/recovery-v0/witness_diversity.mjs) groups the pool into control clusters, using the registered domain, IP, name servers, key and declared legal entity as strong signals and the ASN or shared hosting as weak ones, and the draw never takes a second member of a cluster. [`independence_v0.py`](https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/musubi-v0/independence_v0.py) counts the distinct legal entities among a contract's actors, from declarations signed by each key, against a quorum the contract states | The re-verification pool has one member, so it reports `single_control_cluster` and quorum short. Neither signed contract has stated an independence quorum yet. Since 2026-10-02 a contract can make finality depend on one: [settle v1.8](https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/musubi-v0/settle_v1_8.py) refuses `final` until the stated quorum is met, and [convergence v0](https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/musubi-v0/convergence_v0.py) (settle v1.9) does not count a measurer that shares a signed history with a party. No signed contract uses either yet | Stop a Sybil that uses different providers and different legal entities. It makes one expensive and visible; it does not make one impossible |
| **Signed lie**: a correct signature over an observation that is false | [`corroboration_v0.py`](https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/musubi-v0/corroboration_v0.py) counts measurements by legal entity, not by signature, and counts one only when it sits inside a Bitcoin beacon and anchor window. Each item comes out corroborated, disputed, contradicted, undetermined or not corroborated. NENRIN keeps disagreements instead of resolving them, and [response-v0](https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/response-v0) lets the measured party answer on the ledger | Two outside witnesses have walked the gate (issues #25 and #27), and one outside finding changed the protocol (EXT-001). No signed contract has required corroboration yet. Since 2026-10-02 one can: settle v1.8 holds `final` until corroboration is met, and settle v1.9 counts only measurers drawn by a future Bitcoin block from a pool both parties pinned, measuring after the draw, agreeing from two or more methods | Decide who is right when independent entities disagree, or catch a lie that every independent measurer tells |
| **Semantic contract**: both sides sign the same bytes and read "done" differently | [`terms_v0.py`](https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/musubi-v0/terms_v0.py): every deliverable is an item of a content addressed vocabulary, with a quantity, a unit, a tolerance and a completion test. Free text is refused as `unpinned_term`, and `check_completion` is a pure function of the terms and the measurements | Both signed contracts are witness walks: done means a filed walk, which `settle` checks as `within_grant`. No contract has used vocabulary items yet. Under settle v1.8 a contract that opts into the gate must pin its terms, or it is not settled at all | Fix any meaning the vocabulary does not name |
| **Hidden decision influence**: a published rule, with a prompt, reward or incentive nobody sees steering the choice | The sieve and the policy behind a contract decision are signed and pinned by sha256 beside the contract ([run0001](https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/musubi-v0/run0001)). conduct-v1 requires an agent to disclose who pays it: referral, listing and success fees, in its agent card | In run0001 the sieve and the hidden instruction detector are pinned but not published, so the outside recompute marked them NOT CHECKED | Prove that nothing undeclared influenced a decision. A pinned rule shows which rule was applied, not that it was the only influence |
| **Durable availability**: the anchor survives and every copy of the bytes is gone | [`mirror-v0`](https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/mirror-v0/BECOME_A_MIRROR.md) lets anyone hold a copy and verify it offline against the anchors. Two honest mirrors share `content_sha256`. [evidence-v0](https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/evidence-v0) copies the gate's verdict bytes into this repository every day and asks Software Heritage to archive it. `/evidence/trace` and `/record` serve raw bytes whose sha256 is their name | One mirror is held outside this company: `babyblueviper1`'s, against which one of our agreements was diffed on 2026-09-28 | Guarantee that any copy survives. Availability is the count of independent holders, and today that count is small |
| **Fake observable surface**: every public face reports healthy while the real state is not | The gate calls real tools where the operator consents, not only health pages, and the day and the tool it measures are derived from a Bitcoin beacon neither side chooses ([`nenrin_instant.js`](https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-verify-gate/src/nenrin_instant.js)), so a face kept only for measurement day has no day to aim at. Outside witnesses walk from the witnesses' own networks, and a disagreement between vantages is kept. Runtime attestations can now be pinned beside those observations: `POST /evidence/trace` checks a TRACE Trust Record's signature and anchors its bytes ([trace-pin-v0](https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/trace-pin-v0)) | Two outside vantages so far. No TRACE record from an outside party has been pinned yet | See past a surface that is equally false to every observer at every moment. External observation measures what is served, and says so |
| **Key compromise**: a stolen key makes signatures that are mathematically genuine | key-history-v1 ([spec](https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-verify-gate/ext/KEY_HISTORY_v1.md), served at `/.well-known/key-history.json`): every key has a status (active, retired or revoked) and a `compromised_from` time, which is the earliest the key could have been exposed. A signature by a revoked key is attributed only when a clock the operator does not control shows the bytes existed before that time. The JWKS never serves a revoked key | Four keys are listed: card, agreement, witness and operator. None revoked | Say when a key was really stolen. `compromised_from` is the operator's statement, and so is anything built on it |
| **Physical-world oracle**: everyone signs that the work was done, and it was not | A measurement in [`corroboration_v0.py`](https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/musubi-v0/corroboration_v0.py) carries the Bitcoin block hash the measurer saw and later an anchor, so it cannot have been prepared before the contract or dated after it. It is counted per legal entity, never per signature | No contract has required a measurement yet; the first one that pays for physical work is the first test. Since 2026-10-02 such a contract can require the measurers to be drawn rather than chosen (settle v1.9), so the parties cannot bring their own | Turn the physical world into proof. When every entity lies together, the ledger keeps exactly who said so, when, and against which terms |
| **Network**: nobody else takes part | Nothing in code. Every door is open, needs no key and costs nothing | Counted in the table above, including what is still small. `/usage` has counted who asked, separately from what was measured, since 2026-09-28 (`requesters`). From gate 0.4.21 on, the gate's own measurements (its scheduled sweeps) are left out of `/usage`, so its counts are lower from that version | Create participants. Only use does that |

One verifier threads the contract rows together: [`spine_verify.py`](https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/musubi-v0/spine_verify.py) reads a contract from what it was agreed to mean (`terms_sha256`), through who agreed and who did it, to who measured done, in entities, inside a block window. The first three rows share a limit worth naming once: the verifiers exist and are tested against their own attacks, but a verifier nobody's contract invokes proves only that it would work. The next contract that pays for real work is the one that has to state an independence quorum, name its deliverables from a vocabulary and require corroboration. Since 2026-10-02 the contract itself can make that binding: settle v1.8 (`requirements.spine`) refuses `final` until every stage is in place, and settle v1.9 (`requirements.convergence`) adds measurers nobody chose. What is still missing is a signed contract that uses them, and one between two parties neither of which is this project.

All of MUSUBI also installs without a clone: `pip install 'nenrin-verify[ca2a]'` (0.7.0) carries `musubi-v0/` byte for byte, settle v1 to v1.16 and settle core v0 with its 128 vectors included. `musubi-verify --settle-core`, `musubi-verify --pilot51-set2` and `musubi-verify --run0002` recompute them; [QUICKSTART.md](QUICKSTART.md) takes five minutes.

## One timeline: what each record answers

The layers above are not separate products. Each one answers one question about the same piece of work, in order, and each is a record you can fetch and recompute without trusting us. None of them answers the question of the row below it, and the table says what each one does not prove.

| Order | Question | Record | Verify it with | What it does not prove |
|---|---|---|---|---|
| 1 | What did the parties agree? | MUSUBI contract (`a2a-contract-v0`), a grant both sides signed: allowed, prohibited and conditional actions, approvers, finality depth | [`contract_v0.py`](workers/hs-ledger/nenrin/musubi-v0/contract_v0.py) | That anyone will do it, or that it is a legal contract |
| 2 | What does the contractor say it did? | Execution record (`a2a-execution-v0`), signed by the contractor, naming the contract by `contract_sha256` | [`settle_v1_10.py`](workers/hs-ledger/nenrin/musubi-v0/settle_v1_10.py) | That the act happened in the world |
| 3 | What did the runtime attest it ran? | A TRACE Trust Record, pinned by the sha256 of its RFC 8785 form and anchored | [trace-pin-v0](workers/hs-ledger/nenrin/trace-pin-v0) | That the attestation's own claims are true. No TRACE record from an outside party has been pinned yet |
| 4 | What did someone outside observe? | Witness record (`jidec-path-v1`), signed by the witness with a key its own domain serves | `nenrin-verify`, or replay the walk with [`a2a_conduct_walk.py`](workers/hs-ledger/nenrin/a2a-conduct-walk) | That any response was correct, or that the agent behaves the same at other instants |
| 5 | Did the observers agree? | Discrepancy record, kept instead of resolved, and the measured party's signed reply ([response-v0](workers/hs-ledger/nenrin/response-v0)) | [NENRIN_DISCREPANCY_0001.md](workers/hs-ledger/nenrin/NENRIN_DISCREPANCY_0001.md) | Which observer was right |
| 6 | When it broke, did it really come back? | TSUGI recovery chain: drift, proposal, authorization, execution, re-verification by witnesses drawn from a Bitcoin block | `tsugi-verify` ([recovery-v0](workers/hs-ledger/nenrin/recovery-v0)) | That the repair was the right one, only that it was authorized, done and re-checked |
| 7 | Could any of this have been changed later? | JIDEC: every record above lands in an append-only, hash-linked ledger whose entries are stamped to Bitcoin | [Verify this project without trusting it](#jidec-verify-this-project-without-trusting-it) | That a record is true, only that it existed by a block and has not changed since |

Settle reads rows 1, 2, 4 and 7 together: it recomputes whether the anchored executions stayed inside the grant, and from v1.8 on a contract can refuse `final` until independent measurements agree (row 4) and the measurers were drawn rather than chosen. The row no layer can fill is the one the section above ends on: when every independent party tells the same lie, the timeline records exactly who said it, when, and against which terms. Runtime evidence (row 3) and outside observation (row 4) are complementary for that reason: one says what ran inside, the other what was served to everyone else, and a contract can require both.

## Price ranges you can recompute

Every `get_price_range` answer carries a `recompute` block: the URL and SHA-256 of the `souba-db.json` bytes it used (the same file is in this repository at [`data/souba-db.json`](data/souba-db.json)), the entry `id` of each row, and the formula: the table value, or the table value times the regional multiplier in the same file, rounded half up. [`tools/recompute_price_range.py`](tools/recompute_price_range.py) checks an answer end to end with the Python standard library, and fails on any byte or row that differs.

What it shows is that the answer equals the published table. It does not show that the table is right: the values are curated by a named curator against the sources listed in the file, not computed from those sources by a published formula.

## NENRIN: tree rings for AI facing services

> A tree adds one ring a year. Nobody can paint one in afterwards. NENRIN gives that property to software services.

In the thirty days to 2026-08-14, this server's listing on one MCP directory was shown **93,983** times, by that directory's own dashboard (24 clicks, 421 profile views, and zero tool calls made through the listing). Those are impressions on one directory, not search results across search engines or AI assistants. Calls that reach the server by other routes are a different number, and how many of them came from outside, we cannot say: the usage counter deliberately stores no IP addresses, so it cannot separate our own automated checks from external traffic. An earlier version of this paragraph said the server was invoked **0** times and called the 93,983 AI search results. The zero holds only for calls through that one listing, so the claim for the server as a whole is withdrawn here rather than quietly deleted, and the NENRIN specification's copy of the sentence is corrected by a later ledger entry (seed_entry_nenrin_spec_correction_20261013.json) because the anchored bytes cannot be edited. Discovery is solved. Choice is not. An agent picking between 90,000 servers can only read what each vendor wrote about itself. NENRIN adds the missing layer: records of conduct that the vendor did not author and cannot delete.

How it works, in three lines:

1. **Open witnessing.** Anyone can measure any endpoint and submit the walk to the public ledger under the witness's own name and vantage. The operator holds no veto: acceptance is mechanical schema checking, and the code that enforces this is in this repository.
2. **Discrepancies are the product.** When two witnesses report incompatible observations of the same target, the disagreement itself becomes a permanent, citable record. The founding one is real: [NENRIN_DISCREPANCY_0001](workers/hs-ledger/nenrin/NENRIN_DISCREPANCY_0001.md), two honest witnesses, one target, both correct.
3. **Rings.** Each month the accepted records bundle into a ring that carries the hash of the previous ring, timestamped to Bitcoin. Eighteen months of rings cannot be created in an afternoon, by anyone, including us.

The specification is anchored on the public ledger as entry 19
(`sha256 9ccba2e325fd2a555fcdb2dec519b8c6bf7a669064674846aea98ecfff824e3d`):
[NENRIN_SPEC_v1.md](workers/hs-ledger/nenrin/NENRIN_SPEC_v1.md). It names its own prior art (Certificate Transparency, Rekor, in-toto, SLSA, OpenTimestamps), states exactly which combination is claimed as new, and invites refutation into the same ledger.

**The witness intake is live.** Start here:

```
curl -s https://ledger.horizonshield.dev/witness
```

We are the first test subject under our own rules. The ledger keeps the record of our gate failing its own test, and the full 522 incident that started all of this. Unflattering records stay.

**If a register that cannot delete criticism of its own operator is infrastructure you want to exist, star this repository.** Stars are how researchers and agent platforms find it. The rings accumulate either way. They accumulate faster with witnesses.

## Task-bound conduct: binding an A2A Task to its evidence

Choice does not end when an agent picks a server. It picks, then it delegates a task. What that delegated task actually did, observed by someone other than the two parties, is the evidence the next agent needs. NENRIN binds it to the A2A Task id itself (`a2a.task.id`, aligned to A2A issues #1769 and #2103), not to "this server failed once".

The conduct walk already talks to a real agent over A2A and receives a real Task with an id. It now files a signed, content-addressed observation bound to that id: who delegated to whom on task T, and how the walked agent behaved. The witness signs the observation (`witness_sig`), the requesting party signs the delegation edge (`edge_sig`), and both keys live inside the `did:key` identifiers, so anyone verifies with no network and no trust in us.

Three reads, each a real record you can fetch now:

```
curl -s "https://ledger.horizonshield.dev/witness/task?task_id=d1651c71-28b0-422b-8f14-e2dc66c5a145"
curl -s "https://ledger.horizonshield.dev/trust-signal?task_id=d1651c71-28b0-422b-8f14-e2dc66c5a145"
curl -s "https://ledger.horizonshield.dev/witness/task/evidence/0bff13042d89ec0bc33f2f5149612774f8a706e67c1f345abfc1f10962e31608"
```

The first returns the full witness set per delegation hop, with the aggregate verdict computed so a disagreement is preserved and never the favorable one. The second returns the same as a consumable signal that carries counts and verdicts and never a numeric score. The third returns one observation with its anchor status: this evidence sits in NENRIN ledger entry 44, a `nenrin-task-witness-batch-v1` bundle timestamped to Bitcoin like every other ring.

What the signatures prove, stated plainly: who asserted the observation and who attested the delegation edge, not that the assertion is true. The ledger attests that the witness is distinct from both hop parties by key (R1); it does not attest operator independence, so a self-witness satisfies R1 and says so in its own record. A genuine third-party observation is the same walk run by someone with no stake, filed to the same live endpoints.

The loop this closes: an agent discovers a server, reads conduct the server did not write, chooses, delegates a task, the task is witnessed, the evidence accumulates bound to the task id, and the next agent chooses on it. The code is in [`workers/hs-ledger/nenrin/task-delegation-bind-v0`](workers/hs-ledger/nenrin/task-delegation-bind-v0) (the ledger faces and the producer) and [`workers/hs-ledger/nenrin/a2a-conduct-walk`](workers/hs-ledger/nenrin/a2a-conduct-walk) (the walk that binds, with `--bind-task`).

## TSUGI: proof of recovery, the second pillar

Verification says whether an endpoint conforms today. It says nothing about what happened when it broke, or whether it is really back. TSUGI (継, from kintsugi: the repair is visible and becomes part of the object's history) is the layer after verification. It does not repair; it proves recovery.

Five record types, hash-linked: drift (a witness measured a public surface and it did or did not match), proposal (one repair from a closed catalog of five primitives, with what it does not establish), authorization (the operator's Ed25519 signature over the proposal hash, expiring), execution (before and after state), verify (the witness measured again). The verifier refuses an execution of a human-approval primitive whose authorization is unsigned, signed by an untrusted key, or expired. The operator's public key is served at `https://gate.horizonshield.dev/keys/operator.json`, the same way the agreement and witness keys are.

Re-verification witnesses are not chosen by the operator. They are drawn from a public pool with `sha256(bitcoin block hash | pool hash | record hash)` as the seed, so a third party recomputes who should have been asked. A drawn witness receives only a blind request (no expected values) and returns only a signed observation; nothing it says is executed. This is the July 2026 lesson turned around: unknown agents may observe you, never instruct you.

Two real incidents are recorded in [`workers/hs-ledger/nenrin/recovery-v0`](workers/hs-ledger/nenrin/recovery-v0): a raw deploy that bypassed the deploy guard and silently broke the card signature and the OpenAI domain challenge (found by an external verifier, closed with an unsigned chat approval, which the strict verifier flags as such), and a card signature broken by two version bumps deployed without a re-sign (found by the daily witness, closed with a signed authorization, twelve records). The pool of external witnesses was empty on 2026-09-20, and the records say so instead of pretending a quorum. It held one member, `babyblueviper1`'s agent, until 2026-10-22, and the records reported the quorum as short rather than met. Since commit 89305502 it holds two, `api.babyblueviper.com` and `kuangmi-bit`'s CloudBase host, which the diversity check (witness_diversity v2.3) counts as two control clusters, so a quorum of two can be met. Incident 2 can be recomputed in a browser, hashes and the operator's Ed25519 signature, with no trust in this project: https://shield.the-horizons-innovation.com/tsugi/ Its chain file and record hashes are anchored as [JIDEC entry 50](https://ledger.horizonshield.dev/ledger/50) (OpenTimestamps, Bitcoin).

## Repository map

| Path | What it is |
|------|------------|
| `workers/hs-verify-gate` | The verification gate: nightly sweeps, on demand checks, `probed_via` route disclosure, `gate_commit` pinning, surface change tracking |
| `workers/hs-ledger` | The JIDEC append only ledger and the NENRIN witness intake |
| `workers/hs-ledger/nenrin/task-delegation-bind-v0` | Task-bound conduct: an A2A Task id bound to a signed, Bitcoin-anchored witness observation; the `/witness/task`, `/trust-signal?task_id` and `/witness/task/evidence` faces |
| `workers/hs-ledger/nenrin/a2a-conduct-walk` | The conduct walk that measures an agent and, with `--bind-task`, files the observation under the real `a2a.task.id` |
| `workers/hs-ledger/nenrin/agreement-v0` | The agreement record: two agents, two signatures, one set of bytes. Verifier written twice, in Python and JavaScript, and proved to agree |
| `workers/hs-ledger/nenrin/recovery-v0` | TSUGI (継), the second pillar: proof of recovery. A drift witness measures eight public surfaces of the gate daily; a repair is proposed from a closed catalog, authorized with the operator's Ed25519 key (trust anchor at `/keys/operator.json`), executed, re-verified, and the whole chain is hash-linked so anyone recomputes it. Random re-verification witnesses are drawn from a public pool with a Bitcoin block as the seed, so nobody can claim the operator chose them. Two real incidents are in the tree as 7- and 12-record chains. The verifier is JavaScript (`recovery_verify.mjs`, one file as `sdk/tsugi_verify.mjs`); the repository's Python twin (`recovery_verify.py`) agrees with it on the record bytes, the hashes, the signatures and the draw, and on the refusal codes its twin test checks. The full report, refusal text included, is matched by the Python package `nenrin-verify` (0.2.0, `tsugi-verify`): the same output as `node tsugi_verify.mjs`, byte for byte, on 98 frozen cases and on 29,228 edits of the real chains |
| `workers/hs-verify-relay` | The public edge relay born from the 522 incident (documented in the discrepancy record) |
| `verify-directory` | The public register page: every listed server, our own included, with its live verdict |
| everything else | The GitHub Pages site for the human facing service at the-horizons-innovation.com |

## The agreement record: the other half of a measurement

A conduct record is one sided. Somebody measured somebody. Nothing in it records the other half of
commerce: that **two** agents agreed on terms, and that **both** said so.

`a2a-agreement-v1.1` is that record. At time T, party A and party B both signed the same canonical
bytes describing terms, and each of them pinned, by sha256, a conduct record about the OTHER party
written by somebody who is neither of them.

What it refuses to be is as load bearing as what it is. **No custody. No matching. No editorial
step.** The recorder must not hold funds, must not decide whether a deal happens, and must not
charge a fee that varies with the amount or the outcome. A record whose fee moves with the number
is refused by name. Refusal is mechanical, and none of the terms are ever judged by anyone in this
layer.

The claim is not a new primitive. It is the combination: two mandatory signatures, the
counterparty's measured conduct pinned by sha at the moment of signing, an intake that judges
nothing, and an external anchor nobody here operates. Prior art is named in the draft rather than
left for a reader to find: AP2, x402, ACP, MPP, Cedulon, the 1F916 Agent Record, and SCITT.

**The verifier is written twice.** Once in Python, once in JavaScript, by design and not by
accident: two implementations that disagree are the exact seam this project measures everywhere
else, and building one into this layer on purpose would be a poor joke. 5,286 frozen cases, and
the two produce the same report byte for byte, including every refusal code and the English
sentence attached to it. Proving that moved the Python once, when the JavaScript disagreed on two
cases and the check that settled it was running the Python against its own frozen fixture, where
it failed the same two.

Then the rules were broken on purpose, 77 ways in Python and 36 in JavaScript, to find out whether
the 5,286 cases could tell. Six breakages survived, and not one was a defect in either
implementation. They were holes in the test set. All six are closed.

- The record: [`ops/AGREEMENT_EXT_v0_1_DRAFT.md`](ops/AGREEMENT_EXT_v0_1_DRAFT.md).
  v0 is anchored as [JIDEC entry 39](https://ledger.horizonshield.dev/ledger/39) and does not move.
- The verifiers, the adversary and the contract:
  [`workers/hs-ledger/nenrin/agreement-v0`](workers/hs-ledger/nenrin/agreement-v0)
- What an intake may and may not do, written before one existed:
  [`ops/AGREEMENT_INTAKE_v0_BOUNDARY.md`](ops/AGREEMENT_INTAKE_v0_BOUNDARY.md); the five open
  decisions and how they were settled: [`ops/AGREEMENT_INTAKE_v0_DECISIONS.md`](ops/AGREEMENT_INTAKE_v0_DECISIONS.md);
  state: [`ops/AGREEMENT_INTAKE_v0_STATUS.md`](ops/AGREEMENT_INTAKE_v0_STATUS.md)

The intake exists since 2026-09-16 ([`agreement_intake.mjs`](workers/hs-ledger/nenrin/agreement-v0/agreement_intake.mjs),
wired into the ledger worker): `POST /agreement` accepts a record only when both signatures verify
against the keys each party serves at its `key_url`, deduplicates atomically, serves the record by
sha at `GET /agreement/{canonical_sha256}`, and bundles the accepted pool into a daily anchored
ledger entry. It judges nothing. The first record it accepted, between this project's agent and
`babyblueviper1`'s agent, is in the tree as
[`first_agreement_record.json`](workers/hs-ledger/nenrin/agreement-v0/first_agreement_record.json).
An earlier version of this paragraph said there was no intake; the code had been written and
deployed but not committed, which this repository noticed on 2026-09-20 and corrected.

The second record between the same two agents was re-signed on 2026-09-28 with `"publication": "public"`
inside the bytes both parties signed (record-privacy-v1: nothing bilateral is published on one side's say so).
It was accepted the same day with both signing keys matching the keys each domain serves, and each side's
pinned conduct record is filed on the ledger:
[`5d3e62f1…/report`](https://agreement.horizonshield.dev/agreement/5d3e62f1f0b139992dd15db07b4abc6288a8a824effc31da8300ebe1d6ae6e6c/report).

## The register, as a repository

The same measurements are published as a standalone, machine generated repository:
**[mcp-conduct-register](https://github.com/ogasurfproject-jpg/mcp-conduct-register)**.

Nobody selects the rows there either. A script rebuilds the table from the public API once a day,
and the same run writes a
[`register.json`](https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/register.json)
snapshot so an agent can read the register without parsing Markdown. It carries a `CITATION.cff`,
so the register can be cited the way a dataset is cited, and an
[`llms.txt`](https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/llms.txt)
that states in plain words what the register is and, more importantly, what it is not.

## Three ways in, none of which need us

Since 2026-09-04 the gate can be used without asking anyone at HORIZON SHIELD.

**For the server you operate.** Put `{"allow_tool_call": true}` at `/.well-known/mcp-conduct.json` on your
origin. Only the owner of an origin can place a file there, so the gate takes it as consent, measures
determinism on the public register with it, and writes into every verdict where it read it (gate 0.2.4).
Add a `compensation` block to your agent card (`paid_by`, `referral_fee`, `listing_fee`; the content is not
judged, only its absence) and `POST /watch` once. A row can then reach `verified` with no hand of ours involved.

**For your CI.** One step measures the server on every push and recomputes the verdict hash on the runner,
so the gate is never trusted:
[wedjat-check-action](https://github.com/ogasurfproject-jpg/wedjat-check-action)
(`uses: ogasurfproject-jpg/wedjat-check-action@v1`). It fails the job on a measured failure and leaves
unmeasured conditions unmeasured; `require` and `must_pass` decide how strict that is.

**For the agent that connects.** [`mcp-conduct`](https://www.npmjs.com/package/mcp-conduct) on npm
(zero dependencies) reads `/is-verified` before an MCP client connects and applies a policy you choose:
`warn`, `measured` (block only what was measured and did not pass), `verified-only`, or `off`.
`verified` is `true` or `null`, never `false`; not measured is never failed. Source:
[mcp-conduct](https://github.com/ogasurfproject-jpg/mcp-conduct).

Stated plainly: as of 2026-09-05 the register holds our own servers and nobody else's. The doors are open;
the first outside row has not walked through yet.

## JIDEC: verify this project without trusting it

The verification process behind HORIZON SHIELD's results is published as a Bitcoin anchored, append only public ledger. You do not have to trust us: fetch the anchored bytes, hash them yourself, and check the timestamp.

- Start here: <https://ledger.horizonshield.dev/llms.txt>
- Ledger index: <https://ledger.horizonshield.dev/ledger>
- Machine readable catalog (RFC 9727): <https://ledger.horizonshield.dev/.well-known/api-catalog>
- Read only MCP endpoint: <https://jidec.horizonshield.dev/mcp>

One line is enough to check any entry:

```
curl -s "https://ledger.horizonshield.dev/ledger/5?format=raw" | shasum -a 256
```

What this proves and what it does not is stated by the ledger itself at `/health` under `transparency`, including that OpenTimestamps has no RFC, ISO or eIDAS standing.

The previous hostnames, `hs-ledger.oga-surf-project.workers.dev` and `hs-jidec-mcp.oga-surf-project.workers.dev`, still answer and always will. Records already anchored to Bitcoin cite them, so retiring them would make past receipts unverifiable.

## What the MCP server does

A homeowner commissioning construction work cannot reliably judge whether a quote reflects a fair price. This is a textbook credence good problem. This MCP server makes a third party fair price reference callable and verifiable by software, so an agent can check a number instead of trusting it.

- **Protocol:** Model Context Protocol (MCP)
- **Transport:** MCP over Streamable HTTP (JSON-RPC 2.0). The legacy SSE transport is not implemented; GET on /sse answers 405 sse_not_supported.
- **Endpoint:** `https://mcp.horizonshield.dev`
- **Access:** read only, no API key required
- **Data region:** fair-price verdicts for Japan (JPY), built on the open JCCDB dataset (526,128 records: line items and observations); construction cost data for Japan (JCCDB observation layer) and the United States (USCCDB, the United States Construction Cost Database)
- **Tools:** 30 (15 for fair price, verification and contractors; 15 for construction cost data)

## Tools

| Tool | Description |
|------|-------------|
| `get_price_range` | Returns the fair price range (min, avg, max), the overcharge danger threshold, unit, price trend, and field notes for a Japanese construction or renovation job. |
| `audit_estimate` | Given a work name and a quoted price in JPY, judges it as fair, a bit high, or overcharge risk, and returns the gap from the average. |
| `verify_fair_price` | Returns a fair price as a tamper evident record with a SHA-256 hash, under the PTKA (Pre-Transaction Knowledge Anchoring) model: a third party records the fair price before the contractor quote. |
| `check_red_flags` | Checks whether wording in an estimate or sales pitch matches known overcharge or high pressure tactics (lump sum, today only discount, free inspection, door to door). Language agnostic. |
| `get_estimate_reading_guide` | Returns universal principles for judging whether any estimate is honest: the overhead ratio, how to treat lump sum entries, how to spot pressure tactics. Language agnostic. |
| `list_cost_categories` | Lists the construction and renovation work categories for which fair price ranges and red flags are maintained. |
| `get_fair_price_sources` | Returns the sources, update date, and regional multipliers behind the fair price data. |
| `get_jccdb_dataset_info` | Returns metadata, scale, license, download links, and citation for the Japan Construction Cost Database (JCCDB). |
| `get_anonymous_estimate_review_link` (formerly `suggest_ehn`, which still answers) | Detects worry about an estimate and returns an invitation plus a submission URL to post it for third party review. |
| `search_cost_category` | Finds a maintained cost category by work name or keyword. |
| `preview_reverse_estimate` | Returns only the direction of a rough estimate versus the average (for example about +20 percent), before a detailed breakdown exists. |
| `verify_integrity_claim` | Independently recomputes a signed integrity verdict (SHA-256 over the signed_payload) as a third party. Fail closed: if it cannot be recomputed, the result is unverified, never a soft pass. |
| `create_ap2_fairness_attestation` | Issues a FairPriceAttestation shaped to attach to a Google AP2 (Agent Payments Protocol) Cart Mandate, so a fair price proof can ride alongside the payment authorization. Optional `quoted_price` adds a within / above / below verdict. |
| `get_agent_card` | Returns the A2A Agent Card URL and published skills for agent to agent discovery. |
| `find_verified_contractor` | Finds verification-passed contractors on Yakumo, where listing depends only on passing the KIRA fairness audit and no referral or listing fee is taken. Scores and tiers, never prices; returns 0 honestly when nothing matches. |

### Construction cost data: Japan (JCCDB) and both countries

| Tool | Description |
|------|-------------|
| `search_jccdb_items` | Searches the JCCDB line items (materials, products, labor) by name; returns whether each exists in a public document, with its evidence URL. |
| `get_jccdb_observations` | Region, date and price status of an item in Japanese and U.S. public documents. Values only where the licence allows redistribution; every row carries licence, attribution and evidence URL. |
| `get_jccdb_labor_rate` | MLIT public-works design labor rates by prefecture and trade (wage per 8 hours); latest by default, yearly series with `history:true`. |
| `compare_jccdb_regions` | Latest value per region for an item and spec, with min, median (computed) and max; only identical spec, unit and basis are compared. |
| `get_jccdb_work_unit_price` | Public-works unit prices for work items (materials, labor and equipment combined), with composition-ratio rows. Not renovation quote prices. |
| `get_jccdb_index_series` | Construction cost index series (NHCCI, PPI, MLIT deflator and others) over a period, with year-over-year change computed by this service. |
| `get_jccdb_coverage` | What the observation layers hold: rows per country, layer and source, priced rows and source periods; empty combinations are listed as absent. |

### Construction cost data: United States (USCCDB)

USCCDB is the United States Construction Cost Database: U.S. public-domain federal data and city open data, one row per observation with source URL, sha256 and licence. The four chain tools compute on request and are not distributed as files. Public-works prices, statistics and estimates are reference data, not renovation quotes.

| Tool | Description |
|------|-------------|
| `get_us_construction_prices` | U.S. public construction cost data by layer, region, period and item: Davis-Bacon wages, BLS wages, public unit costs, equipment rates, permits and spending, indexes and area factors, HUD cost limits, state DOT bid prices. |
| `get_us_prevailing_wage` | Davis-Bacon general wage determinations by state, county and trade: base wage and fringe with decision number and source URL. Minimums for federally funded work, not private market rates. |
| `get_us_permits` | U.S. building permits by region and year: Census BPS and distributions of declared valuations in city permit data. Not contract prices. |
| `get_us_area_factor` | DoD Area Cost Factors and USACE CWCCIS state adjustment factors by state, county, ZIP, city or overseas country. Budgeting factors, not a test of a quote. |
| `get_us_price_chain` | Estimated U.S. prices along the distribution chain for construction materials and chemicals: landed import cost, wholesale, retail range and contractor, with formula, source URL and sha256 on every row. Computed on request. |
| `get_us_import_landed_cost` | Landed cost of U.S. imports by HS 10-digit code (Census IMDB): customs value, CIF, calculated duty including Section 232, unit cost, effective duty rate and top partner countries. |
| `get_us_trade_margins` | U.S. wholesale and retail gross margins by NAICS (Census AWTS, ARTS, AIES 2024) with kake_cost_ratio = 1 - margin; optionally the BEA 2007 margin structure. Industry averages. |
| `get_us_contract_discounts` | Published discount rates off list price in U.S. public contracts (Washington DES, NASPO ValuePoint MRO) with kake_ratio = 1 - discount. Rates are ceilings; list bases differ by row. |

The same public data, read for a homeowner holding a quote, one question per page with every figure linked to the record it comes from: [Guides](https://horizonshield.dev/guides/) · [Roof replacement cost in Austin, TX](https://horizonshield.dev/guides/roof-replacement-cost-austin-tx/) · [Is my roofing quote too high?](https://horizonshield.dev/guides/is-my-roofing-quote-too-high/) · [Overhead and profit on a contractor quote](https://horizonshield.dev/guides/overhead-and-profit-on-a-contractor-quote/) · [Trades hourly rates in Austin, TX](https://horizonshield.dev/guides/trades-hourly-rates-austin-tx/) · [How many squares is my roof?](https://horizonshield.dev/guides/how-many-squares-is-my-roof/) · [Do I need a roof permit in Austin?](https://horizonshield.dev/guides/roof-permit-austin/) · [Can a roofer waive my deductible in Texas?](https://horizonshield.dev/guides/roofer-waive-deductible-texas/) · [Price good only today](https://horizonshield.dev/guides/price-good-only-today/) · [How much deposit?](https://horizonshield.dev/guides/contractor-deposit-how-much/) · [Material prices up: is the quote justified?](https://horizonshield.dev/guides/material-prices-up-is-my-quote-justified/) · [Lead paint and RRP certification](https://horizonshield.dev/guides/lead-paint-rrp-certified-contractor/) · [Scope of work before quotes](https://horizonshield.dev/guides/scope-of-work-before-quotes/). The quote check itself: [shield.the-horizons-innovation.com/us/](https://horizonshield.dev/).

## Connecting

This is a remote MCP server. Point any MCP client at the endpoint.

```json
{
  "mcpServers": {
    "horizon-shield": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.horizonshield.dev/"]
    }
  }
}
```

If your client supports remote MCP servers directly, use the endpoint URL above.

### In Claude, without configuration

The construction cost data server (`https://ccdb.horizonshield.dev/mcp`, fifteen read-only tools for JCCDB and USCCDB) is listed in the Claude connector directory after Anthropic's automated review: https://claude.ai/directory/connectors/horizon-shield-construction-cost-data . Open the page in Claude and press Connect; no key and no account with us. It is a community connector, which means it passed the automated review and is not verified by Anthropic.
<!-- claude-directory-v1 -->

## Example

```
audit_estimate(work: "外壁塗装 30坪", quoted_price: 1500000)
```

Returns a verdict (for example, overcharge risk), the fair range (min, avg, max), and the gap from the average. `verify_fair_price` additionally returns a SHA-256 fingerprint of the fair price claim under PTKA (the PTKA declaration is anchored in Bitcoin; the receipt is kept by the issuer, and from 2026-10-19 each day's receipts are listed in one JIDEC ledger entry the next day).

## Verify a verdict yourself

Every `verify_fair_price` call returns a `verify_url` of the form `https://shield.the-horizons-innovation.com/verify/?id=<claim_sha256>`. The [public verify page](https://shield.the-horizons-innovation.com/verify/) recomputes the SHA-256 in your own browser (Web Crypto) and checks it against the receipt. Nothing is sent to any server. The same claim is served back as JSON at `https://mcp.horizonshield.dev/ledger/<claim_sha256>`. Trust is conferred by recomputation, not assumed in the issuer.

Twenty real overcharge diagnoses are also published as tamper evident receipts, each with `claim.txt`, its SHA-256 digest, and an OpenTimestamps proof:

```
sha256sum claim.txt
ots verify -f claim.txt proof.ots
```

- Index of the 20 receipts: <https://shield.the-horizons-innovation.com/souba/kajou-seikyu-jirei-20/>
- The dataset these verdicts belong to is anchored at Bitcoin block 949356.

## AP2 bridge

Google's Agent Payments Protocol (AP2) makes what a user **authorized** verifiable through a signed, tamper evident Mandate. `create_ap2_fairness_attestation` issues a parallel attestation that makes **value** verifiable, shaped to attach to an AP2 Cart Mandate before the user signs. Parallel layers, same philosophy: pre transaction, tamper evident, independently recomputable.

## Data and academic record

- Fair price data is built on the openly published **JCCDB** dataset (526,128 records: 95,403 Japanese construction line items and 430,725 source-cited observations, CC BY 4.0): <https://github.com/ogasurfproject-jpg/japan-construction-cost-database>
- PTKA protocol declaration anchored at Bitcoin block 949356 (2026-05-14); JCCDB Extended paper at block 951871 (2026-06-01)
- JCCDB origin paper: [Zenodo 10.5281/zenodo.20019572](https://doi.org/10.5281/zenodo.20019572)
- Audit hash and macro correction: [SSRN 6738701](https://ssrn.com/abstract=6738701), mirrored at [engrXiv](https://engrxiv.org/preprint/view/7007)
- VRQ framework and PTKA model: [SSRN 6807738](https://ssrn.com/abstract=6807738)
- Reproduction package (buyer side verification gate): [GitHub](https://github.com/ogasurfproject-jpg/hs-ehn-verify), archived at [Zenodo 10.5281/zenodo.20756867](https://doi.org/10.5281/zenodo.20756867) (MIT, runnable: `node test/run_local.mjs`)

## Author

Toshikatsu Oga (大賀俊勝), The HORIZONs Co., Ltd., Hiratsuka, Japan. A carpenter of thirty years. ORCID [0009-0000-9180-903X](https://orcid.org/0009-0000-9180-903X).

> "Cheapest is not the same as fair."

> "Verify, don't trust."

> "Thirty years on site taught me the enemy is the middleman, not the craftsman."

Full collection (50 quotes, JSON-LD): [TOshi Oga, in his own words](https://shield.the-horizons-innovation.com/quotes/)

Live diagnostic: <https://shield.the-horizons-innovation.com> · The Evidence: <https://shield.the-horizons-innovation.com/evidence-en/> · The Movement: <https://shield.the-horizons-innovation.com/movement-us/>

## License

Data: JCCDB, CC BY 4.0. Server code: see the LICENSE file in this repository.
