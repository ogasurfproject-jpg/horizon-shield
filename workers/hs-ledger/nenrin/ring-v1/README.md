# nenrin-ring-v1

Layer 3 of `NENRIN_SPEC_v1.md` (sha256 9ccba2e3...), implemented. One ring per endpoint per calendar month, built only from the gate's `/history` export. Counts with denominators, never rates, scores or ranks. Each ring carries the sha256 of the previous ring's file, so eighteen months of rings cannot be produced in an afternoon by anyone, including the operator.

## Why the export must be taken in time

The gate keeps a bounded number of records per endpoint (30 until 2026-09-05, 400 from gate 0.3.1) and drops the oldest beyond that. Entries are never edited, but they do leave the export. A month whose records were pushed out before anyone exported them can never have a complete ring. The durable copy is the daily archive in `mcp-conduct-register/history/`, not the gate's KV.

## Monthly procedure (the operator's hands, first days of each month)

1. Export history for every endpoint in `endpoints.txt`:

       sh fetch_history.sh

2. Make the ring for the month that just closed, chained to the previous one when it exists, and write the sha256 list:

       sh make_month.sh 2026-08

3. Commit `history/`, `rings/<slug>/<month>.json` and `rings/<month>.sha256`. Anchor `rings/<month>.sha256` (JIDEC ledger append + OpenTimestamps). After that a ring is never edited; a correction is a later ring that cites it.

## Third-party verification

Anyone holding the same `/history` export rebuilds the ring byte for byte:

    python3 make_ring.py --verify rings/<slug>/2026-08.json --history history/<slug>.json [--prev rings/<slug>/2026-07.json]

MATCH means the ring is exactly what this history produces. MISMATCH names the fields that differ. The export itself can be checked against the gate through `record_sha256_first` and `record_sha256_last`, which are the gate's own verdict hashes. A ring file is exactly the canonical bytes, so `sha256(file)` is both the hash the ledger anchors and the `prev_ring_sha256` the next ring carries. A previous ring that has been reformatted is refused as `--prev` for that reason.

## Witnesses

The gate is witness 1. Third-party walks submitted to `POST /witness` on the ledger are passed with `--witness file.json` (repeatable) and counted by distinct `witness.name`. With one witness the ring states in `limits` that no discrepancy could have been recorded. That sentence disappears only when a second, independent witness measures the same endpoint in the same month.

## What a ring does not do

It does not measure quality. A shim that answers every instant and an honest server look the same to a ring, and the spec never claimed otherwise. It trusts the history export it is given, which is why the first and last verdict hashes are carried: the export is checkable against the gate, and a tampered export produces a ring that fails that check.

## Where this lives

Development home: this directory. Published record: `mcp-conduct-register` (`history/`, `rings/`, and a copy of `make_ring.py` under `scripts/`), which is the public dataset with the DOI and the daily archive job.

## Record

Ring 001: 2026-08, eight endpoints, made 2026-09-05 from the export taken the same day (the gate then kept 30 records per endpoint; six endpoints were at exactly 30). `rings/2026-08.sha256` (sha256 f3e589ef...) is JIDEC entry 32, https://ledger.horizonshield.dev/ledger/32, appended 2026-09-05T04:18:49Z, OpenTimestamps pending at the time of writing. Eight rings, one witness each. p001 carries 26 pending of 26; the gate carries 9 held of 26 measuring itself. The first ring is not flattering, and that is what a ring is for.

## Red team

    python3 ring_redteam.py

21 vectors: 10 attack (double counting, month padding, null reachability, smuggled hashes, folded unmeasured, score creep, chain forgery, reformatted predecessor, nameless witness, wrong-month witness), 8 control, 1 misclassification, 2 residual.
