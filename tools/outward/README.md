# Outward witness answers (witness-answer-v0.1, outside-record)

Status: v0.1, 2026-11-06. HORIZON SHIELD recomputes a record another project publishes, signs only the steps it recomputed, and files the signed answer in its own ledger. This is the other direction of `workers/hs-ledger/nenrin/witness-answer-v0/` (where others sign our days); the same answer rules apply, with one kind added.

* `outward_witness.py`: the tool. Python 3 standard library only. Only `fetch` and `verify --fetch` use the network.
* `test_outward_witness.py`: its tests. They block every socket before they start. Run `python3 -I -B test_outward_witness.py` (or `python3 -I -B outward_witness.py selftest`).
* `vectors.json`: answers with their expected verdicts, signed with the public test key of RFC 8032 section 7.1 TEST 1. The tests rebuild it and compare.
* `fixtures/invinoveritas_slot_log_world_20261010.json`: what invinoveritas.dev, mempool.space and blockstream.info served on 2026-11-06 for the slot log of 2026-10-10 (the day before, the .ots, block 970851). The day file itself is rebuilt from `workers/hs-ledger/nenrin/slot-witness-v0/fixtures/invinoveritas_slot_log_20261010.json`.

## The key

`https://horizonshield.dev/.well-known/nenrin-witness-key.json` serves

    {"key_id": "ed25519:<16 hex>", "public_key_ed25519_b64": "<base64 of the raw 32 byte key>", "purpose": "...", "since": "YYYY-MM-DD"}

`key_id` is `"ed25519:"` and the first 16 hex characters of the sha256 of the raw key, as in witness-answer-v0. The URL answers 200 without a redirect.

## The answer

witness-answer-v0 has two kinds, `furui-day` and `tooshi-day`. They are unchanged, keep the first line `witness-answer-v0` and are read by `witness_answer_v0.py`. witness-answer-v0.1 adds `outside-record`:

* `schema` `"witness-answer-v0.1"`, `kind` `"outside-record"`
* `subject_domain`: the domain of the project whose record it is (never one of ours)
* `record_url`, `record_sha256`: where the bytes were read and their sha256
* `record_kind`: `invinoveritas-slot-log` or `bytes`
* `recomputed`: the steps that were ok here, in the order below. A step that was not reached (a proof still pending, a day before not served) is left out; a step that failed means nothing is signed
* `anchor`: `{block_height, block_hash}` of the Bitcoin block checked in `ots_anchor`, or null when that step is not listed
* `tool`, `observed_at`, `limits`, `witness`, `signature`: as in witness-answer-v0

The preimage is the UTF-8 bytes of `"witness-answer-v0.1\n"` followed by the canonical JSON (RFC 8785) of the answer without `signature`. The different first line keeps a v0 signature from being read as a v0.1 one and the other way round.

## Steps

`invinoveritas-slot-log` (the daily decision-receipt slot log, `/decision-receipt/slots/log/<date>` and `<date>.ots`):

1. `bytes_sha256`: the day file was read and hashed.
2. `entries_parse`: the header and every line are canonical JSON with the fields of `invinoveritas.decision_receipt.slot_log.v1`, slots strictly sorted, `n_slots` equal to the lines, every slot taken before the cutoff, and the header names the date.
3. `merkle_root`: the lines fold to the header's `merkle_root` (leaf = sha256(line), pair = sha256 of the two hex strings, an odd last node paired with itself), the rule `slot-witness-v0/slot_check.py` reads.
4. `prev_root_chain`: the header's `prev_root` is the `log_root` (sha256 of the header line) of the day before, or 64 zeros for the first day.
5. `ots_anchor`: the .ots stamps this day's `log_root`, its Bitcoin attestation reaches a block, and two block explorers (mempool.space, blockstream.info) serve the same header at that height, whose hash meets its own bits and whose merkle root is the one the proof reaches (the rule of `furui-check-day-v0`'s bitcoin header vectors).

`bytes` (any record until its shape is known): `bytes_sha256`; `ots_anchor` when a .ots URL is given (it must stamp `record_sha256`); `signature` when a signature URL is given (Ed25519 over the record bytes, or BIP-340 over the sha256 of the record bytes, with the key from a key URL or given on the command line).

## Use

    python3 -I -B outward_witness.py fetch invinoveritas-slot-log --date 2026-10-10 --out facts.json
    python3 -I -B outward_witness.py build facts.json --pub <our public key base64> --out answer.json
    python3 -I -B outward_witness.py preimage answer.json --out preimage.bin
    openssl pkeyutl -sign -inkey <key.pem> -rawin -in preimage.bin -out sig.bin
    python3 -I -B outward_witness.py attach-sig answer.json --sig-file sig.bin --out answer.json
    python3 -I -B outward_witness.py verify answer.json --fetch

Anyone can run the last line on an answer. `ledger-body` writes what goes to the ledger: the signed answer itself in canonical JSON, with the work line `NENRIN outward witness: <subject_domain> <record_kind> <date>`. The ledger entry's raw bytes (`/ledger/<n>?format=raw`) are then the answer, byte for byte.

`pick-day` names the day of a month to witness from the ledger's chain: the head before the cutoff (recomputed from `/ledger/export.jsonl`), its first 8 hex as a number, modulo the days of the month before the cutoff's date, plus one. Neither side chooses the day.

## What a verified answer shows, and what it does not

It shows that the holder of the key at `horizonshield.dev` signed these hashes, this list of recomputed steps and these limits. It does not show that the record is complete, that its content is true, or what the URL served to anyone else. The limits are part of what is signed.

These answers go to our ledger as entries of their own. They are not counted as outside witnesses of our own days (TOOSHI check 16 reads only witness batches and leaves out our own domains).
