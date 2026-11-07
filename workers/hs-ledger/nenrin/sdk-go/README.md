# nenrin-verify-go: the NENRIN provenance verifier in Go

A Go port of the provenance verifier in npm and PyPI `nenrin-verify` (verifier_version 0.1.7). Standard library
only, no network, no clock. It reads a NENRIN provenance bundle and returns the verdict signature the reference
returns: the verdict, the set of refusal codes and the set of finding codes, with each refusal's reason.

```sh
go install github.com/ogasurfproject-jpg/horizon-shield/workers/hs-ledger/nenrin/sdk-go/cmd/nenrin-verify-go@latest

nenrin-verify-go bundle.json                      # report; exit 0 accepted, 1 refused, 2 input error
nenrin-verify-go --corpus ../interop-v0           # reproduce a frozen corpus
```

As a library:

```go
import nv "github.com/ogasurfproject-jpg/horizon-shield/workers/hs-ledger/nenrin/sdk-go/nenrinverify"

v, err := nv.ParseJSON(raw)        // JSON.parse semantics: every number a double, duplicate keys last-wins
rep, err := nv.VerifyBundle(v)     // did:key identities resolve offline; err means the reference throws here
sig := rep.Signature()             // {verdict, refusals, findings}
```

## How it is held to the reference

| check | result |
|---|---|
| interop-v0, interop-v0.1, interop-v0.2/edge, interop-v0.2/action-presence, interop-v0.3/survivors, interop-v0.3/own-proto (`go test ./...`, `--corpus`) | 5/5, 13/13, 36/36, 9/9, 9/9, 7/7 |
| musubi-canonical-v0 shared vectors (`../musubi-v0/canonical_vectors.json`) | 9/9, byte for byte |
| `parity/parity.py`: the 31 frozen parity bundles and their mutations (the same set the Python port is held to), the five interop corpora and 40 signed edge bundles from `../conformance-v0/gen_edge_bundles.mjs`, each parsed by JavaScript and Go from the same text | 27,174 inputs, 0 differences (2,352 on which both throw) against `../sdk/nenrin_verify.mjs` on Node 22 (0.2.1; 27,156 with three corpora at 0.2.0) |
| TSUNAGI, every night from this repository (`ops/tsunagi/BOARD.md`) | one row: the five provenance corpora above and the three TRACE corpora |

The pass condition in `parity.py` is strict: both throw, or the same verdict signature and the same refusals as
(code, reason) in the same order.

```sh
go build -o nenrin-verify-go ./cmd/nenrin-verify-go
node ../conformance-v0/gen_edge_bundles.mjs /tmp/edge.json
python3 parity/parity.py ./nenrin-verify-go --edge /tmp/edge.json
```

## Where the claim stops

- **Same author.** This is a second language written from the reference, not an independent implementation. The
  independent ones are listed in `../interop-v0/INTEROP.md`.
- **Verdict signature only.** The reference report also carries `layers`, `establishes`, `does_not_establish`,
  `rules` and `signers`. This port does not reproduce those texts. The verdict and the codes are what
  `../provenance-v0/VERIFIER.md` section 4 defines as the verdict signature.
- **JavaScript semantics are copied, including the odd ones**, because the reference is the contract: a record
  with an own `__proto__` key loses it from its preimage (Object.assign), `hop.seq` keys that are not numbers are
  ordered the way V8's sort orders them, and an input on which the reference throws returns an error here. Fewer
  than 64 non-numeric `hop.seq` keys are reproduced; 64 or more return `ErrNotReproduced` instead of a guess.
- **Ed25519** is Go's `crypto/ed25519` (RFC 8032, cofactorless, S < L), behind the key rule of VERIFIER.md
  section 5 (canonical encoding of a point of the prime-order subgroup). Within that rule it agrees with OpenSSL
  on every corpus and parity input.
- Raw input bytes that are not valid UTF-8 are decoded per maximal subpart, as Node's `readFileSync(path, "utf8")`
  does.

Cite what it was checked against: Oga, T. (2026). NENRIN provenance verifier: normative procedure (VERIFIER.md),
interoperability vectors and reference verifiers. Zenodo. https://doi.org/10.5281/zenodo.23136978

## TRACE (2026-10-09)

`nenrinverify/trace.go` ports the TRACE intake rule, the `nenrin-trace-bind-v0` verifier and the span check of
`../sdk/trace_verify.mjs` (normative text `../trace-bind-v0/SPEC.md`): `CheckTraceRecord`, `VerifyTraceIntake`,
`VerifyTraceBind`, `SpanAttributes`, `CheckSpanAttributes`. `nenrin-verify-go --trace-batch intake|bind|span in out`
is the TSUNAGI batch form. `go test ./...` runs the three corpora (28, 28, 16); the board referees them nightly.

## nenrin-verify furui-day --runner (0.6.0)

```sh
nenrin-verify furui-day 2026-11-10 --leaf 0 --runner 2
```

`furui-day` takes `--runner 1|2` (1 when left out): runner 2 reads runner-2's day tree at `https://furui.horizonshield.dev/furui2/day/`, and wants key_id runner-2 on the day record and on the envelope and runner_id runner-2 on the day record (a runner-1 record may name runner_id runner-1 or leave it out; a record that names another runner is refused at step 5). Without the flag the answers are those of the version before, except that a runner-1 day record that names runner_id runner-1 is now read instead of refused for its shape.
`FuruiOpts.Runner` is the flag in the library. The same answers as the other three ports on
`../furui-check-day-v0/verify_vectors.json`. `PortVersion` is 0.6.0.

## nenrin-verify --bitcoin-header (0.5.0)

```sh
nenrin-verify furui-day 2026-11-03 --leaf 0 --bitcoin-header
nenrin-verify resume-admission https://shield.the-horizons-innovation.com/ <record_sha256> --bitcoin-header
nenrin-verify furui-vectors ../furui-check-day-v0/bitcoin_header_vectors.json
```

`furui-day` and `resume-admission` take `--bitcoin-header`, as npm 0.9.0 and PyPI `nenrin-verify` do: after the
anchor, the block header at the proof's height from mempool.space and blockstream.info (the same block hash and the
same 80 byte header from both, sha256d to that hash, the hash under the target of the header's own bits, the merkle
root the proof commits to). Without the flag nothing changes and no explorer is asked. `FuruiDayWith` and
`ResumeAdmissionWith` take the flag as `FuruiOpts`; `FuruiBitcoinHeader` is the step alone. The same answers as the
Python and JavaScript ports on `bitcoin_header_vectors.json` (`go test ./...` runs them, CI compares the four ports
line by line). `PortVersion` is 0.5.0; the provenance verifier is unchanged. Details: `../furui-check-day-v0/VERIFY.md`.

## nenrin-verify furui-day and resume-admission (0.4.0)

```sh
go install github.com/ogasurfproject-jpg/horizon-shield/workers/hs-ledger/nenrin/sdk-go/cmd/nenrin-verify@latest

nenrin-verify furui-day 2026-11-03 --leaf 0
nenrin-verify resume-admission https://shield.the-horizons-innovation.com/ <record_sha256>
nenrin-verify furui-vectors ../furui-check-day-v0/verify_vectors.json
```

A new command, `cmd/nenrin-verify`, with `nenrinverify/furui.go`: check one leaf of the content check runner's day
(six checks: the envelope's closed shape, the leaf sha256, the RFC 6962 audit path to the day record the ledger
serves, runner-1's Ed25519 signatures, the key in the ledger's keys document inside `from_height`, the ledger batch
entry with its OpenTimestamps proof), or one admissions[] line of a Resume against the ledger. Unlike the provenance
verifier this command reads the network: GET only, only ledger.horizonshield.dev and furui.horizonshield.dev. The
same verdicts as npm and PyPI `nenrin-verify` on the shared vectors (`go test ./...` runs them).
`PortVersion` is 0.4.0; the provenance verifier is unchanged. Details: `../furui-check-day-v0/VERIFY.md`.

The chain these commands sit in has five names: FURUI (篩, the content check runner) → SEKI admission (関の扉, the door that
signs an admission) → MUSUBI settle (結の精算, the settlement of a contract) → NENRIN ledger (年輪の台帳, anchored to
Bitcoin) → Résumé. TOOSHI checks the whole chain every day, and TSUGI (継) calls outside witnesses by a public draw.
`furui-day` checks one FURUI leaf up to the NENRIN ledger and its Bitcoin anchor; `resume-admission` checks one SEKI
admission as the Résumé lists it, back to the ledger.

## 0.2.2 (2026-10-15)

Verifier change (VerifierVersion 0.1.7, with npm 0.5.3 and PyPI 0.5.5): `without` (the preimage copy) keeps every
own key of the record minus the derived ones, an own `__proto__` key included. It used `assign`, the port of
`Object.assign`, which drops that one key, so a signed grant, receipt or intent with `"__proto__": {...}` added
after signing was accepted (pipavlo82, #29). `go test ./...` and the CI loop also read interop-v0.3/own-proto (7/7).

## 0.2.1 (2026-10-13)

`go test ./...` and the CI's `--corpus` loop now also read interop-v0.2/action-presence (9/9) and
interop-v0.3/survivors (9/9). The second is new: nine vectors frozen from the adequacy-v0 measurement
(`../conformance-v0/adequacy-v0/REPORT.md`), each killing a declared verifier fault the older corpora let survive.
The verifier code is unchanged; only `PortVersion` moved.
