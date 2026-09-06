# adapter: horizon-shield

**Owner:** Toshikatsu Oga (The HORIZONs Co., Ltd.), authored independently. No shared checker with any other adapter;
the only import is the runner's `PAIR` enum.

**Status: wired.** `adapter.mjs` shells out to `vendor/hs_gate_record_commitment.py`, which rebuilds two verdict
records of the MCP Verification Gate under the derivation and commitment rules of cited public commits and prints
their `record_sha256` and `status`. The pair outcome is derived from those values alone, never from the vector's
oracle. Run it standalone: `node adapters/horizon-shield/demo.mjs` (needs `python3` on PATH, stdlib only).

**Relation:** `content_addressed_decision_commitment`, the HORIZON SHIELD analogue of relation 1
(`reject/evidence_against` vs `reject/insufficient_evidence`). The gate's verdicts are not signed. Each one is
content-addressed (`record_sha256` over the record bytes) and later carried into a Bitcoin-anchored ledger entry.
A hash commitment is not a signed commitment, so this adapter does not report under the signed relation's name;
doing so would be a small authority upgrade of exactly the kind this repository exists to catch. Whether the group
folds the two relations or keeps them apart is a decision for the group (open question 1 below).

## Flagship case: an instrument failure is not a statement about the target

The gate records `held` when it could not measure and `pending` when it measured and the endpoint did not pass.
Inside `held` there are two different worlds: the target did not answer (`reachable: false`) and the gate's own
probe path failed (`reachable: null`, `gate_side: true`). The second says nothing about the target. Before
patch52 the gate collapsed them, about itself, every day.

| date | commit (github.com/ogasurfproject-jpg/horizon-shield) | what it says |
|---|---|---|
| 2026-08-15 | a87fa8bc | gate-side failures now read `reachable: null` so the boolean never blames the target (the 522 was found from outside by Federico Blanco Sánchez-Llanos) |
| 2026-08-19 | 8a370fca | patch51, the last commit before the fix (replayed as the "before") |
| 2026-08-19 | 3077a482 | patch52: the gate could not measure itself and recorded that as the target being unreachable; the relay now covers self-probes, and an unmeasured self is recorded as unmeasured |
| 2026-08-19 | 522d4208 | patch53: a relay that throws still blamed the target |
| 2026-08-20 | 0dcf1668 | `reachable` becomes tri-state |

The mechanism: in the daily cron the gate probed itself directly, a Worker cannot fetch its own zone, the edge
answered 522, and 522 is "gatewayish", so the instrument's own path limitation was classified `transport: true`.
The record read `reachable: false, status: held`, byte-identical to a genuine outage. patch52 made a self-probe
with no relay path throw, and the catch classifies it `gate_side: true, measured: false`; the record now reads
`reachable: null` with a `measurement_note`, and its `record_sha256` differs.

## Vectors (six; every vector names its scope)

`record` compares `record_sha256` over the full record bytes. `status_label` compares the one-word `status` field,
which is what the register page, the state enum and the NENRIN ring's `instants_by_status` count consume. The same
pair can be kept apart in the bytes and collapsed in the label; both are reported.

| id | scope | oracle | expected backend | why |
|---|---|---|---|---|
| `hs-pre-patch52-self-held` | record | VIOLATED | FAIL | the real historical collapse, reproduced from 8a370fca's derivation |
| `hs-post-patch52-adversarial` | record | VIOLATED | PASS | after 3077a482 the two records differ; the fix holds |
| `hs-post-patch52-clean` | record | PRESERVED | PASS | control: the same genuine 522 twice; identical hashes |
| `hs-post-patch52-status-label` | status_label | VIOLATED | FAIL | current: both records read `held`; the distinction lives in `reachable`, not in the label |
| `hs-determinism-record-scope` | record | VIOLATED | PASS | determinism unmeasured (no owner consent) vs measured and failed: `measured: false` is inside the commitment |
| `hs-determinism-status-label` | status_label | VIOLATED | FAIL | current: both read `pending`; the ring counts them under one key and keeps the unmeasured count only as prose in `limits` |

Three FAILs are the point, not a defect of the adapter. One is history. Two are open findings about HORIZON
SHIELD's own summary layer, filed here rather than hidden: the fix is a counted field for each collapsed
distinction in the next ring schema (`instants_instrument_failed` beside unreachable; `instants_determinism_unmeasured`
beside pending), and readers of the label should read `reachable` and `measured` instead. The second finding is the
p001 row of the reproducibility paper's Table 1: pending 26, every one for want of consent.

## Provenance

Everything replayed is one public file, `workers/hs-verify-gate/src/worker.js`, at commits anyone can fetch:
`git show <commit>:workers/hs-verify-gate/src/worker.js | shasum -a 256` gives
e624087f... at 8a370fca, 78ed14ad... at 3077a482, c1fcdf47... at 522d4208, 32e7270f... at f8a3f719 (main, 2026-09-06).
Full hashes and the exact lines replayed are in the vendor script's header. The record built there is reduced to the
fields the derivation reads or writes, in the gate's own key order, with the other conditions held constant as an
ASCII-only fixture, so Python's `json.dumps(separators=(",",":"), ensure_ascii=False)` over an insertion-ordered
dict produces the same bytes as JavaScript's `JSON.stringify` for these values. That equivalence is itself a seam of
the class recorded in the reproducibility paper (nested key order, entry 34), and the fixture stays inside it on purpose.

## Manifest

`manifest.json` declares six components, one authority class each, validated against `../../schema/manifest.schema.json`
(sha256 93d8442f...): the gate's `/check` on a third party (INDEPENDENT_JUDGMENT), the gate's `/check` on the
operator's own endpoints (INFRASTRUCTURE_ATTESTATION, explicitly disclaiming INDEPENDENT_JUDGMENT, which is why the
witness path exists), `verify_verdict` (CRYPTOGRAPHIC_VERIFICATION; valid means real, not right), the ledger's
`POST /witness` (INDEPENDENT_JUDGMENT from a second party's vantage), the NENRIN ring verify mode
(INDEPENDENT_RECOMPUTATION; the ring's own `limits` sentence is the disclaimer), and the JIDEC entry with its
OpenTimestamps proof (NOT_BACKDATED, the same class and field as invinoveritas's freshness beacon). Every
`does_not_establish` entry is a sentence that was already anchored in prose before this manifest was written.

## Not yet wired

`authority_separation` and `proof_vs_header_authority`: HORIZON SHIELD makes no on-chain commitment and claims no
ONCHAIN_COMMITMENT; its Bitcoin anchor establishes NOT_BACKDATED and nothing more, so those relations have no
HORIZON SHIELD cell yet. A live mode (fetch a real record from `gate.horizonshield.dev/history`, recompute its
`record_sha256`, and compare) is future work; the replay above is the git-verifiable before/after.

## Open questions for the group

1. Does relation 1 admit a content-addressed, anchored commitment in place of a signature, or should
   `content_addressed_decision_commitment` stay a separate relation? This adapter keeps them apart until told otherwise.
2. The gate's canonical bytes are `JSON.stringify(record)` in key insertion order, not sorted keys. The manifest
   should say so explicitly rather than let a third reimplementer discover it.
