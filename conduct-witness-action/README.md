# conduct-witness

A GitHub Action that turns your repository into a standing witness. On a schedule you control, your own runner walks one or more A2A / MCP agents and files conduct records the agent did not write. Optionally signed with an Ed25519 key under your domain, so your records are counted apart from unsigned names.

No account, no API key, no payment. Nothing here needs the operator of the ledger to trust you, and nothing here needs you to trust the operator: every record is bytes you produced, with a sha256 you can recompute from the artifact this action keeps in your own run.

The same walk, without this action, is one command (Python 3.8+ and uv):

```
uvx --from "git+https://github.com/ogasurfproject-jpg/horizon-shield#subdirectory=workers/hs-ledger/nenrin/a2a-conduct-walk" \
  a2a-conduct-walk --origin https://mcp.horizonshield.dev --mode a2a --submit \
  --witness-name "Your name or project" --vantage "where this runs"
```

This action adds three things: it runs that on a schedule from a vantage that is not the operator's, it keeps every record as a 90 day artifact in your repository so your receipt does not depend on anybody's server, and it lets you sign.

## Use it

```yaml
name: conduct witness
on:
  schedule:
    - cron: "23 4 * * *"   # once a day, your clock, your runner
  workflow_dispatch:
jobs:
  witness:
    runs-on: ubuntu-latest
    steps:
      - uses: ogasurfproject-jpg/horizon-shield/conduct-witness-action@main
        with:
          witness_name: "your-project"
          origins: |
            https://mcp.horizonshield.dev a2a
            https://gate.horizonshield.dev mcp
```

That is the whole file. The word after each origin is the mode for that agent (`mcp` or `a2a`); leave it off to use the job wide `mode`. Each run walks each origin, prints a table in the job summary (origin, outcome, pass count, record sha256, intake answer) and uploads the record files as an artifact.

## Sign your records (optional, one time)

```
openssl genpkey -algorithm ed25519 -out witness.pem
curl -sSLO https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/workers/hs-ledger/nenrin/a2a-conduct-walk/a2a_conduct_walk.py
python3 a2a_conduct_walk.py --print-public-key witness.pem
```

Serve the printed JSON at an https URL under your own domain (for example `https://your-domain/.well-known/conduct-witness-key.json`), store `witness.pem` as the repository secret `CONDUCT_WITNESS_KEY`, and add:

```yaml
          key_pem: ${{ secrets.CONDUCT_WITNESS_KEY }}
          key_url: https://your-domain/.well-known/conduct-witness-key.json
```

The private key is written to the runner's temp directory with mode 600 for the length of the step and never printed.

## Inputs

| input | default | what it does |
|---|---|---|
| `origins` | required | agent origins to walk, one per line or comma separated. A line may end with its own mode, `https://gate.example mcp`, when the job wide `mode` does not fit that agent |
| `witness_name` | required | who you are; never invented for you |
| `vantage` | the hosted runner and this repo | where the walk is taken from; set the real place on a self hosted runner |
| `mode` | `mcp` | `mcp` or `a2a` for node 3, for every origin that does not name its own. Walk an MCP endpoint in mcp mode and an A2A endpoint in a2a mode; an A2A message sent to an MCP endpoint records a truthful FAIL that describes your mode, not the agent |
| `submit` | `true` | `false` walks and keeps records without filing |
| `privacy` | `full` | `full`, `hash-only`, or `commitment` (conduct-v1.1 record modes) |
| `key_pem`, `key_url` | empty | Ed25519 signing under your domain; both or neither |
| `intake` | from the card | override the witness intake URL |
| `transport` | `urllib` | `curl` when an edge answers 403 to Python |
| `walker_ref` | `main` | git ref to fetch the reference walker from |
| `walker_sha256` | empty | pin the walker; the job stops before walking if the download does not match |
| `per_origin_pause_s` | `3` | pause between origins; this is traffic to somebody else's server |

Reference walker at the time of writing: commit `64edb870` (2026-09-11), sha256 `6d770be6abb56da9f49738ee0a7e359f4073d57e5772b4b0084e4a1a6f407ba6`. Pin it with `walker_sha256` if you want every run to use exactly that tool.

## Outputs

`records` (JSON array of origin, outcome, n_pass, n_total, record_sha256, submitted_http, file), `walked`, `submitted`.

## What a run establishes, and what it does not

A record establishes what your runner saw, from where it stood, at the time it walked. It does not establish that the agent is good, honest, or safe; the record's own `does_not_establish` field says so and the intake refuses a record without it. A FAIL outcome is a record, not an error: this action never fails your job on a verdict. Two witnesses who disagree about the same agent are kept as a discrepancy on the monthly ring, never resolved by anyone.

The ledger operator's own servers are on the register and are walked the same way. Your walk of them is welcome and counts.

## Why a witness from CI matters

Most of the register today is written by one gate run by one operator. A witness is anyone else. A GitHub hosted runner is a vantage the operator does not control; a self hosted runner in your own network is a better one. The monthly ring counts witnesses by name and, when signed, by domain. Time anchored records from many independent vantages are the one thing nobody can fabricate this afternoon.

License: Apache-2.0, as conduct-v1.
