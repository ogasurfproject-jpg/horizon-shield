# trace-chain: one TRACE record through the whole chain, offline

A TRACE v0.2 Trust Record answers what ran, where and under which policy. This page follows one such record through every layer this repository already has, and fixes the input and output bytes of each step as vectors anyone can recompute without a network connection:

    TRACE v0.2 record  ->  trace-bind  ->  SEKI admission  ->  MUSUBI settlement  ->  NENRIN ledger entries  ->  nenrin-verify

Nothing new is defined here. Every verdict comes from code that is already in this repository, unchanged; `gen_vectors.py` only feeds it inputs and writes what it answers.

## Run it

    cd docs/trace-chain
    python3 -I -B gen_vectors.py --check     # rebuilds every vector and compares it byte for byte; exit 0 when all agree

Python 3.9 or later with `cryptography`, and Node 18 or later. The script closes outbound sockets in its own process and in every child it starts, so a step that tried to reach the network would fail rather than pass. `python3 -I -B gen_vectors.py` (without `--check`) writes `vectors/` again.

## The path

The material is real wherever it can be. The TRACE record is the summit demo record from [agentrust-io/trace-registry](https://github.com/agentrust-io/trace-registry) (commit `58850e9d`, CC BY 4.0, copied unchanged into `workers/hs-ledger/nenrin/trace-bind-v0/sources/`). The act is the SEKI heartbeat's paid `/report` call of 2026-10-22 (`workers/hs-ledger/nenrin/seki-heartbeat/runs/2026-10-22/`), made under the demonstration contract `musubi-v0/run0003/contract.json`, admitted by the door, settled, and listed in ledger entries 134 and 137. Principal, agent and door of that contract are all The HORIZONs Co., Ltd., and the contract says so.

| step | what is checked | code | vectors |
|---|---|---|---|
| 1 TRACE intake | the record's Ed25519 signature over its RFC 8785 form, profile, required members, canonical form, at the time of the act; its pin sha256; its key thumbprint against the producer key trace-registry lists | `sdk/trace_verify.mjs`, `trace-pin-v0/trace_pin_v0.mjs` | TC01 to TC02 |
| 2 trace-bind | a `nenrin-trace-bind-v0` record naming the TRACE record and the execution record by sha256, checked under a relying party policy; the OpenTelemetry span attributes for it | `sdk/trace_verify.mjs` | TC03 to TC09 |
| 3 SEKI admission | the door's signed admission under the door key in `keys/seki-door.json`, for this contract; the agent's signed request; the execution naming the admission | `musubi-v0/admission_verify_v0.py` | TC10 to TC14 |
| 4 MUSUBI settlement | the anchors recomposed from the ledger's own batch bytes and `.ots` proofs against kept Bitcoin headers, then settle v1.15 over the execution and the day's three admissions | `seki-heartbeat/heartbeat.py`, `musubi-v0/anchor_compose.py`, `musubi-v0/settle_v1_15.py` | TC15 to TC18 |
| 5 NENRIN entries | entries 134 and 137: claim digests, the listing of each record, jidec-chain-v1 recomputed from entry 1, the heads stamped inside the ledger's own batches, the export rows | `survive-v0/survive.py`, `survive-v0/verify_chain.py` | TC19 to TC22 |
| 6 nenrin-verify | steps 1 to 4 again with the nenrin-verify Python package in `sdk-python/src`: its TRACE port and its vendored MUSUBI files | `nenrin_verify.trace`, `nenrin_verify.musubi` | TC23 to TC24 |

24 vectors: 8 that must be accepted, 16 that must be refused. The refused ones cover a tampered receipt (TC02, TC06, TC24), a wrong binding (TC05, TC09, TC13, TC14), a binder or a record age the relying party did not accept (TC04, TC07), an edited admission or execution (TC12, TC16, TC17), and a broken chain (TC18, TC20, TC21, TC22).

The links between the steps are checked, not assumed: the bind's `trace_sha256` is the pin sha of step 1 (TC03), its `record_sha256` is the sha256 of the execution file (TC03) and is listed in ledger entry 137 (TC19), the execution names the admission by `admission_sha256` (TC10), and the admission and execution settle from entries 134 and 137 to the settlement committed in `runs/2026-10-22/settlement.json` (TC15, sha256 `39c5ade2...`).

## Check your own receipt with the same code

The bind bundles in `vectors/inputs/` are ordinary inputs to the published CLI:

    npx -p nenrin-verify nenrin-trace-verify bind vectors/inputs/TC03_bundle.json
    pip install nenrin-verify && nenrin-trace-verify bind vectors/inputs/TC03_bundle.json

To put another TRACE record through steps 1 and 2, replace the `trace` member of a bundle, sign a new bind with `npx -p nenrin-verify nenrin-trace-verify sign-bind`, and pin your key thumbprint in `policy.trace_key_thumbprints`.

## What is not shown, and why

- **The bind is made with test keys.** The binder keys are Ed25519 seeds derived from the public phrases `nenrin-trace-chain-v0 test binder A` and `... B`. Anyone can derive them and they stand for no party. The real contractor key of the run0003 contract is held by its agent and is not used here. So TC03 shows that the mechanics hold over these exact bytes. It is not a statement by anyone that the act of 2026-10-22 ran under the summit demo runtime.
- **The relying party's policy accepts a record up to 365 days old.** The summit demo record was issued on 2026-08-20, 62 days before the act. Under TRACE's default record age (86400 seconds) the bind is refused (TC04). A relying party that wants a fresh record needs a TRACE record issued at the act.
- **Neither the TRACE record nor the bind is on the ledger.** The ledger pins TRACE records (`POST /evidence/trace`, trace-pin-v0), and this record has not been submitted. There is no ledger intake for bind records today. So nothing here bounds by Bitcoin when the TRACE record or the bind existed; the anchors of step 4 bound the admission and the execution only.
- **The Bitcoin headers are a kept copy.** Step 4 reads headers 970715 to 972674 from `seki-heartbeat/view-chunks/`, written once from two block explorers. Offline, settlement checks that they are contiguous and linked, that the contract's checkpoint hash is among them, that each header's proof of work holds and its difficulty is no easier than the contract's floor, and that each proof reaches a header's merkle root. It cannot check, offline, that these headers are the chain your own node holds; compare them with your node for that.
- **The ledger copy is the operator's.** Step 5 reads `survive-v0/kept/`, the copy this repository commits daily. Its stamped heads are checked against the recomputation (TC19), and the stamps themselves can be checked against Bitcoin with `survive.py drill`, which needs a network connection.
- **settle v1.15 is the settle the heartbeat runs.** Given an execution edited after signing, it sets the record aside and settles over no act, `within_grant`; settle v1.16 rejects the same record and says `nothing_to_settle` (TC17). Both are recorded as they are.
- **trace-terms-v0 is not on this path.** It reads TRACE authorizations (pic-trace-bridge) under a contract with a signed terms annex, and imports `agentrust-trace` 0.11.0, which is not installed here and needs a network connection to install. The run0003 contract has no terms annex.
- **registry-witness-v0 is not on this path.** It witnesses the registry's checkpoint chain over the network. Here the producer key file is the copy at commit `58850e9d`; whether that file is in a checkpoint the witness signed is not checked offline.

## What a passing run establishes

That these exact input bytes produce these exact output bytes under the named code, that the tampered and mismatched inputs are refused, and that the package a relying party installs (`nenrin-verify`) answers the same as the repository's reference. It does not establish that any claim inside the TRACE record is true, that the parties are separate (they are not), or that the act was lawful or wise. Each record's own `does_not_establish` says the rest.

## Files

| file | what |
|---|---|
| `gen_vectors.py` | builds `vectors/` and, with `--check`, compares it byte for byte and holds every answer to its expectation |
| `trace_step.mjs` | runs the TRACE steps with the JavaScript reference; called by `gen_vectors.py` |
| `vectors/vectors.json` | every vector: step, kind, inputs (path and sha256), output (path and sha256), expectation |
| `vectors/inputs/` | inputs made here: bind bundles, span attributes, and the edited records |
| `vectors/outputs/` | the answer of each vector, as written by `gen_vectors.py` |
