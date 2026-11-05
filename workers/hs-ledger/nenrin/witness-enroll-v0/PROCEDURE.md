# The pool of day witnesses and the daily draw

Status: v0, 2026-11-05. The pool file and the draw rule are published here. A draw runs only for a day whose record is listed in a ledger entry that comes after an anchored pool entry (see "When a draw can run"). Everything this page uses is in this folder (`workers/hs-ledger/nenrin/witness-enroll-v0/` in ogasurfproject-jpg/horizon-shield) and in `../witness-answer-v0/`:

* `pool.json`: the pool, version 1.
* `witness_enroll_v0.py`: the helper. Python 3 standard library only. It checks a pool, writes the ledger record that fixes a pool version, computes the draw for a day from public endpoints, and recomputes a recorded draw. It loads `../witness-answer-v0/witness_answer_v0.py` for the key, key_url and canonical JSON rules, so keep the two folders side by side. It only reads (GET); it sends nothing.
* `test_witness_enroll_v0.py`: its tests. They block every socket before they start. Run `python3 -I -B test_witness_enroll_v0.py` (or `python3 -I -B witness_enroll_v0.py selftest`).
* `vectors.json`: draws with their expected witness, leaves and record hash. The tests rebuild it and compare.

## What this is

Each day the FURUI runner closes a day record (`furui-check-day-v0`), and the ledger lists it in a batch entry that is anchored in Bitcoin. The draw names one witness from the pool and the leaves of that day record that the witness is asked to recompute. The witness answers, if they choose, with a signed `witness-answer-v0` as in `../witness-answer-v0/PROCEDURE.md`.

The operator does not pick the witness or the leaves. The pool is fixed in the ledger before the Bitcoin block that seeds the draw exists, and the draw is a fixed computation anyone can repeat.

## The pool file

`pool.json` is one JSON object with exactly these keys:

* `schema`: `"witness-enroll-pool-v0"`
* `version`: 1, 2, ...
* `previous_pool_sha256`: `null` for version 1, then the `pool_sha256` of the version before
* `entries`: a list; each entry has exactly:
  * `name`: the witness's handle
  * `signed_domain`: the identity of `key_url` (its host; for `raw.githubusercontent.com`, `github.com/<owner>`)
  * `key_url`: where the witness serves `{"public_key_ed25519_b64": ...}`, with the same rules as for a signed answer
  * `public_key_ed25519_b64` and `key_id` (`"ed25519:"` plus the first 16 hex characters of the sha256 of the raw key)
  * `kinds`: what the witness takes part in; the draw on this page uses `furui-day`
  * `joined_on`: the first UTC day the entry can be drawn
  * `consent`: `{"on", "form", "enrollment_sha256"}`. `form` is `"email"` (consent in writing to the operator; `enrollment_sha256` is `null`) or `"witness-enroll-v0"` (a signed enrollment statement; `enrollment_sha256` is the sha256 of its canonical JSON)
  * `left_on`: `null`, or the first UTC day the entry is no longer drawn
  * `left_reason`: `null`, or one line

`pool_sha256` is the sha256 of the canonical JSON (RFC 8785 on this closed value set, as in `witness-answer-v0`) of the whole object.

An entry is active on day D when `joined_on <= D` and `left_on` is null or later than D. Two entries with the same `signed_domain` or the same `key_id` are never active on the same day.

## How a pool version is fixed

Each version is written to the ledger as one entry whose text starts with `# witness-enroll-pool-v0`. It carries `pool_sha256`, the version, and the pool itself on its last line (`pool_canonical: ...`). `python3 -I -B witness_enroll_v0.py pool-seed pool.json --out seed.json` writes that text. You can check that the entry and this file agree: the sha256 of `pool.json` in canonical form is the `pool_sha256` of the entry.

## When a draw can run

For day D:

1. The day record of D is accepted by the ledger and listed in a batch entry E (today the runner files it a little after 00:45 UTC on D + 1, and the batch is written at 00:30 UTC on D + 2).
2. E is anchored in Bitcoin block H.
3. The pool in force is the pool entry with the highest number among those that come before E and are anchored at or below H. If a pool entry before E is not anchored yet, the draw waits. If there is none, there is no draw for D.
4. The beacon is the Bitcoin block at height H + 1. The helper reads it from mempool.space and blockstream.info, both must give the same hash, and it waits for 6 confirmations.

## The draw

    seed    = sha256(beacon_hash "|" pool_sha256 "|" day_sha256)
    witness = eligible[int(sha256(seed "|0")[:16], 16) mod len(eligible)]
    leaves  = min(2, n) leaves by a partial Fisher-Yates over 0 .. n - 1:
              step i swaps positions i and i + int(sha256(seed "|leaf|" i)[:16], 16) mod (n - i); listed ascending

`eligible` is the list of pool entries active on D for `furui-day`, ordered by `public_key_ed25519_b64` (code points). `day_sha256` is the sha256 of the day record's canonical bytes as the ledger serves them. The seed and the witness step are those of the TSUGI draw (`../recovery-v0/witness_draw.mjs`) with one witness drawn. With one person in the pool, the draw always names that person.

## The record and the notice

The draw is written to the ledger as one entry whose text starts with `# witness-enroll-draw-v0 <day>`. It lists every input and result (day, `day_sha256`, `n`, `root`, the batch entry, the anchor block, the beacon block and hash, the pool entry and `pool_sha256`, the number eligible, the seed, the witness, the leaves, the helper's sha256), then a notice to the drawn witness in plain words: the day, the leaves, the `nenrin-verify furui-day` commands for them, and where the answer procedure is. The text is computed only from public values, so running the helper again gives the same bytes. There is one draw per day: if the ledger already holds a draw for D, the helper writes nothing new.

## Checking a draw yourself

    python3 -I -B witness_enroll_v0.py verify-draw <entry number>

It reads the entry, recomputes the draw from the runner, the ledger and the two block explorers, and compares each line. `VERDICT draw_ok` means every line matches and this is the first draw entry for that day.

## Joining

1. Serve your key at your `key_url` as for a signed answer (your own domain or `<you>.github.io`).
2. Sign an enrollment statement:

        python3 -I -B ../witness-answer-v0/witness_answer_v0.py enroll --name <your handle> --key-url <your key_url> \
          --kind furui-day --limit "<a line in your words>" --key witness_key.pem --out enroll.json

3. Send `enroll.json` to the operator (or, in v0, say in writing that you agree to be drawn). The operator checks it with `verify enroll.json --fetch`, adds your entry in a new pool version with `joined_on` no earlier than that day, and writes that version to the ledger. You are drawn only for days whose batch entry comes after that pool entry.

## Leaving

Tell the operator. The next pool version sets your `left_on` and `left_reason`; from that day you are not drawn. Draws already recorded stay as they are. If your `key_url` stops serving your key, the operator does the same.

## Changing your key

Serve the new key at your `key_url` and sign a new enrollment statement with it. The next pool version closes the old entry (`left_on`, `left_reason` "key changed") and opens a new one for the new key from the same day. Until that version is in force, a draw that names you still names the old key; the operator checks that `key_url` serves the listed key before writing a draw, and makes a new pool version first when it does not.

## What a draw shows, and what it does not

A recorded draw shows that the operator wrote down a witness and leaves that anyone can recompute from public values: the day record, a pool fixed in the ledger before the beacon block, and that block. It does not show that the witness read the notice or will answer, that an answer is right, or anything about the day record's content. One gap is known: the operator's ledger decides when an entry is submitted for its Bitcoin stamp (the batch entries are stamped on a schedule), so the operator has some say in which block becomes the beacon. With one person in the pool this can change only the leaves, not the witness.
