# Checking a day of the content check runner, in one line

`nenrin-verify` has two commands that read only the public ledger (https://ledger.horizonshield.dev) and the content
check runner (https://furui.horizonshield.dev). Every port of them runs the shared vectors in this directory and must
give the same verdicts; CI compares the ports line by line, on the vectors and on seeded mutations of them. That the
ports agree is established on those inputs, not on every input.

The chain these commands sit in has five names: FURUI (篩, the content check runner) → SEKI admission (関の扉, the door that
signs an admission) → MUSUBI settle (結の精算, the settlement of a contract) → NENRIN ledger (年輪の台帳, anchored to
Bitcoin) → Résumé. TOOSHI checks the whole chain every day, and TSUGI (継) calls outside witnesses by a public draw.
`furui-day` checks one FURUI leaf up to the NENRIN ledger and its Bitcoin anchor; `resume-admission` checks one SEKI
admission as the Résumé lists it, back to the ledger.

```sh
pip install nenrin-verify            # Python, then: nenrin-verify furui-day 2026-11-03 --leaf 0
npx nenrin-verify furui-day 2026-11-03 --leaf 0

nenrin-verify furui-day <YYYY-MM-DD> --leaf <i> [--bitcoin-header]
nenrin-verify resume-admission <https endpoint> <record_sha256> [--bitcoin-header]
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

## --bitcoin-header: the block header from two explorers (0.9.0, Python and JavaScript)

Without the flag nothing changes: no other host is asked, and the steps and facts are the ones above. With it, one
more step follows bitcoin_anchor (step 7 of furui-day, step 6 of resume-admission), and the network is two more hosts,
mempool.space and blockstream.info (four GETs: `/api/block-height/<height>` and `/api/block/<hash>/header` on each,
sending only the block height and the block hash).

| step | name | what is checked |
|---|---|---|
| 7 (6) | bitcoin_header | (a) both explorers name the same block hash at the height the proof reaches and serve the same 80 byte header (160 lowercase hex characters, nothing else); (b) the header's merkle root is the one the OpenTimestamps proof commits to; (c) sha256d of the header is that block hash, and the hash meets the target the header's own bits encode |

The step runs only when bitcoin_anchor is ok (otherwise it is `skipped`). Its codes name the first difference, asking
mempool.space first: `mempool_height_http_<status>`, `mempool_hash_shape`, `mempool_header_http_<status>`,
`mempool_header_shape` (the same four for blockstream), `explorers_name_different_blocks`,
`explorers_serve_different_headers`, `header_hash_is_not_the_named_block`, `header_bits_shape`,
`header_hash_above_its_target`, `header_merkle_root_is_not_the_proof`. On ok the facts carry `bitcoin_header`:
the block hash, the header and the two explorers. An explorer that cannot be reached exits 2, as the ledger does.

Python and JavaScript give the same answers on `bitcoin_header_vectors.json` and on mutations of it; the Go and Java
ports take the flag in their next version and do not run that file yet. `make_bitcoin_header_vectors.py` writes it
(`--check` says whether the file is what it writes); it holds the real header of block 970879, the block the real
proof of ledger entry 80 reaches, as both explorers served it on 2026-11-03.

## What these commands do not establish

- Without `--bitcoin-header`, the Bitcoin block header is not fetched (the network is only the two hosts above). The
  facts name the block height and the merkle root the proof commits to; compare them with any copy of the Bitcoin
  chain, or run `ots verify`.
- With `--bitcoin-header`, that the header is in the chain with the most work. The step believes two explorers that
  agree: it does not follow the chain from a checkpoint, does not compare the bits with the difficulty of that height,
  and cannot see the height inside a header (the height is what the explorers say). Two explorers that serve the same
  made up header, with bits easy enough, pass it. A Bitcoin node of your own, or `ots verify` against one, does not
  have this limit.
- Whether a check was right. A signature says the runner signed it, not that the answer is true.
- `revoked` in a Resume line is copied, not recomputed.
- Only sha256, append and prepend are followed in a proof; any other operation is a fail (`ots_parse`), not a guess.

## The vectors

`verify_vectors.json` holds each case as a small world (URL to status and body) and the expected answer. The keys
document of each world lists a test key as runner-1; no production key or record is used, except the real
OpenTimestamps proof of ledger entry 80 for the parser. `make_verify_vectors.py` writes the file (`--check` says
whether the file is what it writes). The repository's CI runs every port on it and on mutations of it, and compares
their answers line by line.

### Closed strings are exact (0.8.1)

A 64 hex value (every sha256, the record and envelope fields, each audit path hash, the day record's root, a Resume
line's `rules_sha256`) is exactly 64 characters of `0-9a-f`, with nothing before or after it. The day, `signed_at`,
the nonce and the signature are held the same way, and their digits are ASCII digits only. Up to 0.8.0 the Python
port read these with `re.match` and a final `$`, which also passes one trailing line feed, and with `\d`, which takes
any Unicode digit; `bytes.fromhex` then skipped the line feed, so an audit path hash with a trailing `"\n"` rebuilt
the root in Python and was a `proof_shape` fail in JavaScript, Go and Java. 0.8.1 uses `fullmatch` and `[0-9]`. The
vectors carry 21 cases for this (a trailing line feed, carriage return, CR LF or space, a leading line feed or space,
uppercase, fullwidth digits; on the audit path, the day record's root and day, the leaf's record sha, five envelope
fields and its signature, and a Resume line), and the mutations give string values the same edges, so a port that
reads them loosely differs from the others in CI. The values are signed where they sit, so only the shape check can
refuse them.
