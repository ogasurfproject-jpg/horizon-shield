# refund-door-v0: the admission door of the bounded refund sandbox

The admission side of [aeoess/agent-governance-vocabulary#193](https://github.com/aeoess/agent-governance-vocabulary/issues/193)
(contract revision `review-2026-10-23`, profile `hs-refund-admission-profile/0.1`), hosted at
`https://ledger.horizonshield.dev/sandbox/refund`. It runs the public [aps-receipt adapter](../musubi-v0/adapters/aps_receipt)
(steps 0 to 8), then step 9 and the single-use state, and signs what it decided.

| file | what it is |
|---|---|
| `refund_door_v0.mjs` | the decision, without Cloudflare: adapter, step 9 (grant limit, admission window), single-use state, the three records |
| `refund_door_worker.mjs` | the routes under `/sandbox/refund`, the sandbox key, the Bitcoin view, the Durable Object `RefundDoorDO` |
| `sdk_subset.mjs` | the five functions of `agent-passport-system` 8.0.1 the adapter calls, from the adapter's pinned install |
| `sandbox_contract.mjs`, `make_sandbox_contract.mjs` | the a2a-contract-v0 contract of the sandbox (test parties, refund up to 5000 minor units of EUR) and its maker |
| `door_key.mjs` | the door's public key (role `admission-door`); the seed is the Worker secret `REFUND_DOOR_KEY` |
| `verify_answer.mjs` | what a reader repeats on an answer, without the door |
| `refund_door_v0.test.mjs`, `test_inputs.mjs` | the tests (no network, test keys from fixed labels) |
| `published_run_pins.json` | the published connected run the test can also replay, by commit and sha256 of every file |

## Routes

    GET  /sandbox/refund                            what the door is, whether it is ready, its key, contract and pins
    GET  /sandbox/refund/keys/admission-door.json   the door's public key
    GET  /sandbox/refund/contract                   the sandbox contract, canonical text
    POST /sandbox/refund/admit    x-hs-sandbox-key  {run_id, inputs: {<the eleven files as strings>}}   (or inputs_b64)
    POST /sandbox/refund/replay   x-hs-sandbox-key  {requests: [{run_id, inputs, consumed_at}, ...]}

`x-hs-sandbox-key` is a test key handed to the runner owner out of band. It authenticates the runner's channel, which
is how the runner's PIC result reaches the door. `/admit` uses the door host's clock and the live single-use state.
`/replay` runs up to 16 requests in order against a fresh state in memory at instants the caller gives: it never reads
or writes the live state, its mapping schema is `hs-refund-admission-replay-v0`, its admission record carries no
`publication` and its `admission_id` starts with `replay-`. It puts a published run with its recorded instants through
the door, so that its records can be recomputed, before fresh inputs exist.

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
    node refund_door_v0.test.mjs --published <dir>    # also the published run, read from <dir> (see published_run_pins.json)

## Checking an answer

    node verify_answer.mjs answer.json admission-door.json
