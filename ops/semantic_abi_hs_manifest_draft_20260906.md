# semantic-abi adapters/horizon-shield: manifest draft v0 (2026-09-06 01:00 JST, 番人)

Read before writing a line of adapter code. Sources read tonight from the Mac mount (ops/semantic_abi_20260906/):
schema/manifest-v0.md, schema/manifest.schema.json, adapters/invinoveritas/{README.md, adapter.mjs, vectors.mjs, demo.mjs},
adapters/horizon-shield/README.md (294 bytes, "pending onboarding", cells report CANNOT_CHECK / UNVERIFIABLE until real).
Still to read: runner/README.md, runner/demo.mjs, runner/src/evaluate.mjs (exports PAIR, BACKEND, run()), runner/vectors/.

## 0. What the schema demands (so the manifest is not bent to fit)

- manifest.schema.json: `{component, author, declarations[]}`; each declaration = `endpoint`, `consumes`,
  `establishes {authority_class, claim_type, scope}`, `does_not_establish [authority_class...]`, and EXACTLY ONE of
  `issued_at` (a component that originates a claim) or `verification_time` (a component that checks someone else's claim).
- authority_class is an open enum in v0-draft (12 values). Proposing a new value is allowed; the freeze is an open item.
- Two result levels, never collapsed: pair outcome PRESERVED | VIOLATED | UNVERIFIABLE; backend PASS | FAIL | CANNOT_CHECK.
- Adapter rule: authored by the owner, no shared checker code. observe(vector) returns the pair outcome it actually
  measured (VIOLATED if the backend told the two claims apart, PRESERVED if it did not); the shared runner grades against
  the vector's oracle. The adapter never grades itself.
- Federico's flagship shape: an adversarial pair whose underlying claims genuinely differ (oracle VIOLATED, fixed and
  version-independent), replayed against a pre-fix preimage (observed PRESERVED, backend FAIL: the real historical
  collapse) and a post-fix preimage (observed VIOLATED, backend PASS), plus a clean control (oracle PRESERVED, PASS).
  His before/after is in a private repo, so he vendors a hash-cited copy. Ours is public, so we can cite commits by URL.

## 1. The HS flagship: instrument failure is not a statement about the target

Relation 1 in the README: reject/evidence_against ≠ reject/insufficient_evidence.
HS has the same distinction, with a real, shipped, git-verifiable collapse and fix, all in the public repo:

| date | commit | what it says |
|---|---|---|
| 2026-08-15 | a87fa8bc | gate-side failures now read `reachable: null` so the boolean never blames the target (522 found from outside by Federico) |
| 2026-08-19 | 3077a482 (patch52) | the gate could not measure itself and recorded that as the target being unreachable; an unmeasured self is now recorded as unmeasured |
| 2026-08-19 | 522d4208 (patch53) | a relay that throws still blamed the target; fixed |
| 2026-08-20 | 0dcf1668 (gate58) | `reachable` becomes tri-state (true / false / null) |

Current derivation (worker.js at HEAD, record assembly): `gateSide = some result has gate_side === true`;
`unreachable = some result has transport === true`; `reachable: gateSide ? null : !unreachable`;
`status: passed ? "verified" : ((unreachable || gateSide) ? "held" : "pending")`.
The record's `record_sha256` is sha256 over the record with `record_sha256` and `recompute_note` removed, serialised as
JSON.stringify(record) (key insertion order as built; the /spec text names the Python equivalent). `reachable`,
`status`, and every condition's `gate_side` / `transport` / `measured` flags are inside the preimage.

Mapping to relation 1:

| HS record | meaning | semantic-abi |
|---|---|---|
| status pending (reachable true, a condition failed) | measured, and the endpoint did not pass | reject/evidence_against |
| status held, reachable false (transport failure at the target) | the target did not answer from this vantage at this time | evidence against reachability only, nothing else |
| status held, reachable null (gate_side true) | the instrument failed; nothing was learned about the target | reject/insufficient_evidence |
| determinism `measured: false` (no owner consent) | not measured; "unmeasured is not failed" | insufficient_evidence, at condition scope |

Pre-patch52 shape: a gate-side relay failure produced `reachable: false, status: held` with no gate_side flag, byte-identical
in shape to a genuine target outage. The gate did this to itself daily at 03:00 JST and published it. That is the
collapse. Post-patch52 the two produce different bytes and different `record_sha256`.

## 2. Vectors (HS side, mirrors Federico's three, plus one that is HS's own finding)

| id | relation | oracle | mode | expected backend |
|---|---|---|---|---|
| hs-pre-patch52-self-held | signed_decision_commitment (HS variant, see 4) | VIOLATED | pre_patch52 | FAIL (the real collapse, reproduced from the pre-patch52 derivation) |
| hs-post-patch52-adversarial | same | VIOLATED | post_patch52 | PASS (reachable null vs false: distinct records, distinct hashes) |
| hs-post-patch52-clean | same | PRESERVED | post_patch52_clean | PASS (two genuine target outages: same shape, same hash) |
| hs-status-label-determinism | same relation, scope = the `status` label alone | VIOLATED | status_label | FAIL, and this one is CURRENT, not historical: determinism `measured:false` and determinism `pass:false, measured:true` both yield `status: pending`. The record preimage keeps them apart (record scope PASS); the summary label and the ring's `instants_by_status` count do not. The ring carries the unmeasured count only as prose in `limits`. This is the mismatch to file, not to hide: the fix is a fourth status or a counted field (`instants_determinism_unmeasured`) in ring v2. |

The fourth row is what the adapter reply to Federico promised ("that mismatch is the finding and I will file it").
It is also the p001 row in Table 1 of the paper (pending 26, all for want of consent).

## 3. Manifest declarations (draft; one authority class each; disclaimers are sentences already anchored)

Component `horizon-shield` (author: Toshikatsu Oga, The HORIZ音s株式会社). Six declarations:

1. `gate./check on a third-party endpoint`
   consumes: an MCP endpoint URL, the origin's /.well-known/mcp-conduct.json (consent), the gate-derived coordinate (day, tool)
   establishes: INDEPENDENT_JUDGMENT, claim_type "conformance verdict over 7 conditions (verified / pending / held)",
   scope "one endpoint, one checked_at, one vantage (probed_via); the judge is not the endpoint's operator"
   does_not_establish: SEMANTIC_VERIFICATION (the /check scope_note: it does NOT verify that any price or figure is
   correct), INDEPENDENT_RECOMPUTATION, NOT_BACKDATED (until the record is in a stamped JIDEC entry), ECONOMIC_SETTLEMENT
   issued_at: checked_at

2. `gate./check on the operator's own endpoints (Layer 4, self-application)`
   same consumes and claim; establishes: INFRASTRUCTURE_ATTESTATION (the judge and the target share an operator, so
   this is the operator's statement about its own endpoint, measured with the same instrument)
   does_not_establish: INDEPENDENT_JUDGMENT (this is exactly why witnesses exist), plus the four above
   issued_at: checked_at

3. `gate.verify_verdict / recompute_url`
   consumes: a stored verdict record
   establishes: CRYPTOGRAPHIC_VERIFICATION, claim_type "the record's bytes hash to its record_sha256, so it was not altered
   after issue", scope "one record"
   does_not_establish: INDEPENDENT_JUDGMENT (the tool's own text: "a finding about the record, not an error"; valid means
   real, not right; same trap as invinoveritas /verify-proof)
   verification_time: when the recompute ran

4. `ledger POST /witness (Layer 1, a2a-conduct-walk / jidec-path-v1 with a witness field)`
   consumes: an endpoint, walked from the witness's own vantage
   establishes: INDEPENDENT_JUDGMENT, claim_type "walk verdict ok / not ok with per-node body hashes", scope "one endpoint,
   one walked_at, one witness name and vantage"
   does_not_establish: NOT_BACKDATED (until batched and stamped), SEMANTIC_VERIFICATION
   issued_at: walked_at

5. `NENRIN ring verify mode (make_ring.py --verify, make_ring.js)`
   consumes: a ring file, the endpoint's committed history export, the previous ring
   establishes: INDEPENDENT_RECOMPUTATION, claim_type "the ring is byte for byte the function of this history export",
   scope "one endpoint, one calendar month, one ring file"
   does_not_establish: INDEPENDENT_JUDGMENT and SEMANTIC_VERIFICATION (the ring's own limits sentence: one witness only,
   a single witness can be wrong and nobody was positioned to say so; unmeasured is not failed; counts only, never a rate,
   a score or a rank; and the paper's Section 7: determinism is not truth)
   verification_time: when the verify ran

6. `JIDEC ledger entry + OpenTimestamps`
   consumes: claim bytes (sha256 of a record, a ring list, a spec)
   establishes: NOT_BACKDATED, claim_type "these bytes existed no later than Bitcoin block N", scope "one entry"
   does_not_establish: everything about the content (the ledger's own sentence: it proves the claim and its date, not
   its truth; a 鑑定書 hash proves the file existed, not that the estimate was fair): INDEPENDENT_JUDGMENT,
   SEMANTIC_VERIFICATION, CRYPTOGRAPHIC_VERIFICATION of anything but the bytes, ECONOMIC_SETTLEMENT
   issued_at: the anchor block time (same class and same field as Federico's freshness_beacon; vocabulary already aligned)

No new authority class is needed for 1 to 6. One is worth proposing for 4 if the group wants "observation" separated from
"judgment": a witness walk observes, it does not judge. Leave it as INDEPENDENT_JUDGMENT unless they ask.

## 4. Two questions for the group (file them, do not guess)

1. Relation 1 is written "(signed layer)". HS has no signature on a verdict: the commitment is content-addressed
   (record_sha256) and later Bitcoin-anchored. Either the relation admits a hash commitment, or HS declares the signed
   relation CANNOT_CHECK and registers `content_addressed_decision_commitment` as its own relation. Their call.
2. Canonical bytes of the record: the gate's /spec names JSON.stringify(record) with the two fields removed, i.e. key
   insertion order, not sorted keys. The Python equivalent is json.dumps(obj, separators=(",",":"), ensure_ascii=False)
   with keys in the same order. This is the same class of seam as ledger entry 34 and should be stated in the manifest,
   not discovered by the third reimplementer.

## 5. Files to produce in trustless-ai/semantic-abi (PR from TOshi's fork, authored by TOshi)

adapters/horizon-shield/README.md (owner, status, flagship, the four vectors, provenance: public commits by URL, the
status-label finding), manifest.json (section 3, validated against manifest.schema.json), adapter.mjs (observe() shells
out to vendor/hs_gate_record_commitment.py with mode; returns PAIR.VIOLATED if the two record_sha256 differ, PRESERVED if
equal; null for any other relation), vectors.mjs (section 2), demo.mjs (mirrors his), vendor/hs_gate_record_commitment.py
(stdlib only: builds two records for the same endpoint and checked_at under the pre-patch52 and post-patch52 derivations,
canonicalises exactly as the gate's /spec states, prints {"distinct": bool, "sha_a", "sha_b"}; header cites
a87fa8bc, 3077a482, 522d4208, 0dcf1668 by URL and the /spec text sha).
No import from Federico's adapter or vendor. The only shared code is the runner's PAIR/BACKEND/run(), which is the rule.

## 6. Order of work

1. TOshi fetches runner/README.md, runner/demo.mjs, runner/src/*, runner/vectors/* (commands in chat).
2. 番人 writes manifest.json + validates against the schema (python jsonschema, or a hand check if not installed).
3. 番人 writes vendor/hs_gate_record_commitment.py and tests it on the Mac (four modes, expected distinct values).
4. 番人 writes adapter.mjs / vectors.mjs / demo.mjs; TOshi runs `node adapters/horizon-shield/demo.mjs` in a clone of
   semantic-abi; expected pattern: pre-patch52 FAIL, post-patch52 PASS, clean PASS, status-label FAIL (declared, not hidden).
5. TOshi opens the PR. Deadline: ETHOnline ends 2026-09-16; aim for the PR by 09-10 so the group can link it.
