# refund-door-v0: the admission door of the bounded refund sandbox

The admission side of [aeoess/agent-governance-vocabulary#193](https://github.com/aeoess/agent-governance-vocabulary/issues/193)
(contract revision `review-2026-10-23`, profile `hs-refund-admission-profile/0.1`), hosted at
`https://ledger.horizonshield.dev/sandbox/refund`. It runs the public [aps-receipt adapter](../musubi-v0/adapters/aps_receipt)
(steps 0 to 8), then step 9 and the single-use state, and signs what it decided.

| file | what it is |
|---|---|
| `refund_door_v0.mjs` | the decision, without Cloudflare: adapter, step 9 (grant limit, admission window), single-use state, the three records |
| `refund_door_worker.mjs` | the routes under `/sandbox/refund`, the sandbox key, the Bitcoin view, the Durable Object `RefundDoorDO` |
| `refund_door_log.mjs` | the door's record of every keyed `/admit` request and answer, with their bytes, chained per run |
| `sdk_subset.mjs` | the five functions of `agent-passport-system` 8.0.1 the adapter calls, from the adapter's pinned install |
| `sandbox_contract.mjs`, `make_sandbox_contract.mjs` | the a2a-contract-v0 contract of the sandbox (test parties, refund up to 5000 minor units of EUR) and its maker |
| `door_key.mjs` | the door's public key (role `admission-door`); the seed is the Worker secret `REFUND_DOOR_KEY` |
| `verify_answer.mjs` | what a reader repeats on an answer, without the door |
| `refund_door_v0.test.mjs`, `test_inputs.mjs` | the tests (no network, test keys from fixed labels) |
| `refund_door_log.test.mjs`, `test_do.mjs` | the record's tests, through the routes and a stand-in Durable Object over `node:sqlite` |
| `published_run_pins.json` | the published connected run the test can also replay, by commit and sha256 of every file |

## Routes

    GET  /sandbox/refund                            what the door is, whether it is ready, its key, contract and pins
    GET  /sandbox/refund/keys/admission-door.json   the door's public key
    GET  /sandbox/refund/contract                   the sandbox contract, canonical text
    POST /sandbox/refund/admit    x-hs-sandbox-key  {run_id, inputs: {<the eleven files as strings>}}   (or inputs_b64)
    POST /sandbox/refund/replay   x-hs-sandbox-key  {requests: [{run_id, inputs, consumed_at}, ...]}
    GET  /sandbox/refund/log?after=&limit=          the runs with their record count and head, 1000 at a time; refusals counted
    GET  /sandbox/refund/log/run?run_id=&after=&limit=   one run's records, JSON Lines, no bytes, 1000 at a time
    GET  /sandbox/refund/log/bytes/<seq>  x-hs-log-key   the bytes of one record

`x-hs-sandbox-key` is a test key handed to the runner owner out of band. It authenticates the runner's channel, which
is how the runner's PIC result reaches the door. `/admit` uses the door host's clock and the live single-use state.
`/replay` runs up to 16 requests in order against a fresh state in memory at instants the caller gives: it never reads
or writes the live state, its mapping schema is `hs-refund-admission-replay-v0`, its admission record carries no
`publication` and its `admission_id` starts with `replay-`. It puts a published run with its recorded instants through
the door, so that its records can be recomputed, before fresh inputs exist.

## The record of requests and answers

Every `/admit` with the sandbox key is recorded in the Durable Object, beside the single-use table:

- a `request` record before the door decides: `run_id`, `seq`, the door clock, the sha256 and length of the body, and the
  body bytes in parts of at most 1 MiB;
- an `answer` record after: the HTTP status, the sha256 and length of the answer body and its bytes, and the mapping
  verdict (`disposition`, `step`, `code`, `error`, `mapping_sha256`, `admission_sha256`).

This covers `committed`, `resolved_existing`, `refused`, and the 400, 413 and 503 answers. A commit writes its single-use
row and its answer record in one transaction. When a record cannot be written the door answers
`503 log_unavailable` and consumes nothing. A request without the right sandbox key is counted per UTC day, status and
reason, and its body is not kept. `/replay` is not recorded.

Each record carries `prev_record_sha256`, the record before it in the same run (64 zeros for the first). Its
`record_sha256` is the sha256 of the musubi-canonical-v0 bytes of the record without `record_sha256`. The last one is the
run's head, shown by `GET /sandbox/refund/log`. `checkRun()` in `refund_door_log.mjs` repeats the check on a run's lines.

Two limits. The parts of all records together stay under 256 MiB. A keyed request that would pass that is refused before
the door decides, with `507 log_full`, and nothing is consumed; it is only counted, like a 401. `GET /sandbox/refund/log`
shows the cap and the bytes used. The readers return at most 1000 lines or runs at a time. A run's next page starts after
the seq in the header `x-hs-log-next`; the runs' next page starts after `next_after`. `checkRun(lines, prev)` checks a page
from the last record of the page before.

The list and the runs are public. The bytes need `x-hs-log-key`, whose sha256 is the Worker secret
`REFUND_LOG_KEY_SHA256`. This key is separate from the sandbox key: the inputs belong to the runner and its parties, and
the sandbox key may be handed to the runner. `GET /sandbox/refund` names the record in its `log` field, with what it does
not establish.

## Records

- `refund-sandbox-admission/0.1` (contract section 5), on a commit only: exactly its 22 fields.
  `admission_ref = "sha256:" + sha256(JCS(record))`.
- `a2a-admission-v0`, version 0.1, admit or refuse, signed by the door. Signed bytes: `a2a-admission-v0`, a newline, the
  musubi-canonical-v0 bytes of the record without `signatures`; `admission_sha256` is their sha256. It verifies with
  [`admission_verify_v0.mjs`](../musubi-v0/admission_verify_v0.mjs) and `.py` under the door's key and the sandbox contract.
- `hs-refund-admission-mapping-v0`, one per request, signed by the door the same way under its own schema line:
  `committed`, `resolved_existing` or `refused`, with `consumed_at` (UTC milliseconds), `clock_source`, `run_id` and both
  hashes of every input file.

The door's key has the role `admission-door`. It is not the `admission-signer` key of the handoff: a signer verifies the
mapping record under the door's key before it signs a handoff or a resolution.

## Cases admission claims

| case | where | answer |
|---|---|---|
| J01 (the admission half) | adapter 0 to 8, step 9, state | `committed`, the three records |
| J02 to J06 | adapter | `refused` before consumption, the step and code in the mapping |
| J07 same decision and inputs | state | the existing admission again, nothing new consumed |
| J08 same decision, other refund | state | `refused`, `nonce_reused` |
| J09 new decision, identical refund | state | `committed`, a distinct `operation_id` |
| J10 reissue with new matching PIC evidence | adapter on the new set, state | `resolved_existing` (the verdict only; resolution signing is the signer's) |
| J11 new APS receipt, old PIC proposal | adapter step 7 | `refused`, `PIC_APPROVAL_REF` |
| J14 approval signer revoked before consumption | adapter step 3 | `refused`, `key_revoked` |

## What it does not establish

That a refund moved or that the merchant is legitimate; revocation beyond the presented `trust/aps-consumption.json`; that
`pic-verification.json` was produced by PIC (it is the runner's result on the runner's channel, bound here to the retained
bytes); restart safety, durable admission or atomic admission-to-effect delivery (the state is one Durable Object's
storage); a trusted time source (the door host's clock, or the caller's in a replay).

## Tests

    cd ../musubi-v0/adapters/aps_receipt && npm ci --ignore-scripts && cd ../../../refund-door-v0
    node refund_door_v0.test.mjs
    node refund_door_log.test.mjs                      # the record (Node 22.13 or later, for node:sqlite)
    node refund_door_v0.test.mjs --published <dir>    # also the published run, read from <dir> (see published_run_pins.json)

## Checking an answer

    node verify_answer.mjs answer.json admission-door.json
