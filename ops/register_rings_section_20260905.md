
## Rings

Monthly rings (`nenrin-ring-v1`) live in `rings/`, one file per endpoint per month, built from `history/` by `scripts/make_ring.py`. A ring holds counts with denominators, never a rate, score or rank, and carries the sha256 of the previous ring's file. `history/` is an append-only archive of every endpoint's `/history` export, taken daily by `scripts/archive_history.py`; the gate itself keeps a bounded number of records per endpoint, this directory keeps all of them.

Ring 001 covers 2026-08 for eight endpoints. Its sha256 list `rings/2026-08.sha256` is JIDEC entry 32: <https://ledger.horizonshield.dev/ledger/32>.

Rebuild any ring from the same history and compare bytes:

    python3 scripts/make_ring.py --verify rings/<slug>/2026-08.json --history history/<slug>.json
