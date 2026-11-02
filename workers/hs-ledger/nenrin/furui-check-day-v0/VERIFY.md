# Checking a day of the content check runner, in one line

`nenrin-verify` has two commands that read only the public ledger (https://ledger.horizonshield.dev) and the content
check runner (https://furui.horizonshield.dev). Every port of them runs the shared vectors in this directory and must
give the same verdicts; CI compares the ports line by line.

The chain these commands sit in has five names: FURUI (篩, the content check runner) → SEKI admission (関の扉, the door that
signs an admission) → MUSUBI settle (結の精算, the settlement of a contract) → NENRIN ledger (年輪の台帳, anchored to
Bitcoin) → Résumé. TOOSHI checks the whole chain every day, and TSUGI (継) calls outside witnesses by a public draw.
`furui-day` checks one FURUI leaf up to the NENRIN ledger and its Bitcoin anchor; `resume-admission` checks one SEKI
admission as the Résumé lists it, back to the ledger.

```sh
pip install nenrin-verify            # Python, then: nenrin-verify furui-day 2026-11-03 --leaf 0
npx nenrin-verify furui-day 2026-11-03 --leaf 0

nenrin-verify furui-day <YYYY-MM-DD> --leaf <i>
nenrin-verify resume-admission <https endpoint> <record_sha256>
nenrin-verify furui-vectors verify_vectors.json
```

Exit codes: 0 ok, 1 fail, 3 not_yet, 2 usage or network error. The answer is one JSON object: the verdict, each step
with its state (`ok`, `fail`, `not_yet`, `skipped`) and code, and the facts (record sha256, root, ledger entry,
Bitcoin block height and merkle root).

## furui-day: six checks on one leaf

| step | name | what is checked |
|---|---|---|
| 1 | envelope_shape | `GET /furui/day/<day>/leaf/<i>` answers an envelope with the closed shape `furui-check-signed-v1`: the fifteen fields of the check, hex digests, closed words, no text field |
| 2 | leaf_sha256 | sha256(0x00 \|\| musubi-canonical-v0(envelope)) is the leaf the runner names, and envelope_sha256 is sha256 of the canonical bytes |
| 3 | audit_path | the day record the ledger serves at `/furui-check-day/<sha>` hashes to its sha, is canonical, has the closed shape of `furui-check-day-v0`, names the same day, n and root, and the RFC 6962 audit path rebuilds that root from the leaf |
| 4 | signature | runner-1's Ed25519 signature on the day record (`furui-check-day-v0\n` + canonical record without signatures) and on the envelope (`furui-check-signed-v1\n` + canonical {schema, check, signer}) |
| 5 | runner_key | the record's signer is the ledger's keys document, the key is `runner-1` as listed in `/.well-known/furui-check-keys.json`, and the heights of the record and of the envelope are at or above `from_height` and below `revoked_height` |
| 6 | bitcoin_anchor | the ledger answers the record as anchored in entry n; `/ledger/<n>?format=json` hashes to its claim and lists the record as `furui-check-day-v0`; the OpenTimestamps proof at `/ledger/<n>/ots` starts from that claim and reaches a Bitcoin attestation at the entry's block height |

`not_yet`: the day is still open (the runner answers a day after it closes, from 00:47 UTC the next day), the record
waits for the ledger's daily batch (00:30 UTC), or the batch's proof is not in Bitcoin yet. A day that closed with no
check is a fail with `day_closed_empty`: there is no leaf to check.

## resume-admission: one admissions[] line against the ledger

| step | name | what is checked |
|---|---|---|
| 1 | resume | `GET /resume?endpoint=<endpoint>` is a `nenrin-resume-v1` of that endpoint and resume_sha256 recomputes over the resume without its envelope fields |
| 2 | admission_line | the record is listed once in admissions[] with the closed fields (`not_yet` while not_counted names it as not anchored) |
| 3 | admission_record | the stored bytes at `/admission/<sha>` hash to the sha; an `a2a-admission-v0` whose relying party is the endpoint's host or its parent; the same decision; the same closed part of a 0.4 content block |
| 4 | ledger_batch | the entry ledger_n hashes to its claim and lists the record as `a2a-admission-v0` |
| 5 | bitcoin_anchor | the entry is anchored, and its OpenTimestamps proof reaches a Bitcoin attestation at the entry's block height |

## What these commands do not establish

- The Bitcoin block header is not fetched (the network is only the two hosts above). The facts name the block height
  and the merkle root the proof commits to; compare them with any copy of the Bitcoin chain, or run `ots verify`.
- Whether a check was right. A signature says the runner signed it, not that the answer is true.
- `revoked` in a Resume line is copied, not recomputed.
- Only sha256, append and prepend are followed in a proof; any other operation is a fail (`ots_parse`), not a guess.

## The vectors

`verify_vectors.json` holds each case as a small world (URL to status and body) and the expected answer. The keys
document of each world lists a test key as runner-1; no production key or record is used, except the real
OpenTimestamps proof of ledger entry 80 for the parser. `make_verify_vectors.py` writes the file (`--check` says
whether the file is what it writes). The repository's CI runs every port on it and on mutations of it, and compares
their answers line by line.
