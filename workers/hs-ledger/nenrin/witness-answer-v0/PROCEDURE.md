# Signed witness answers for a TOOSHI day and a FURUI day record

Status: v0, 2026-11-04. Everything this page uses is in this folder (`workers/hs-ledger/nenrin/witness-answer-v0/` in ogasurfproject-jpg/horizon-shield):

* `witness_answer_v0.py`: the helper. Python 3 standard library only. It builds, signs and verifies an answer, compares a TOOSHI day, and writes the body for the ledger's witness intake. It sends nothing; only `verify --fetch` reads your `key_url`.
* `test_witness_answer_v0.py`: its tests. They block every socket before they start. Run `python3 -I -B test_witness_answer_v0.py` (or `python3 -I -B witness_answer_v0.py selftest`).
* `vectors.json`: answers and an enrollment with their expected verdicts, signed with the public test key of RFC 8032 section 7.1 TEST 1. The tests rebuild it and compare.
* `fixtures/`: `tooshi_day_2026-11-04.json` is a byte copy of `tooshi/days/2026-11-04.json` in this repository; `pipavlo82_witness_json_20261104.json` is the key document `https://pipavlo82.github.io/keys/witness.json` served on 2026-11-04 (a public key).

To take the helper by itself:

    curl -sSfo witness_answer_v0.py https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/workers/hs-ledger/nenrin/witness-answer-v0/witness_answer_v0.py
    shasum -a 256 witness_answer_v0.py

## What this is

You recompute one day yourself, from public endpoints, and sign what you got with a key you serve from your own domain. The answer has one shape for both kinds of day:

* `tooshi-day`: you run `tools/tooshi/tooshi_daily.py` and get the same `day_sha256` as the published day file.
* `furui-day`: you run `nenrin-verify furui-day` on the leaves of one day record and get the same record hash and root.

Only signed answers that verify are counted as outside witnesses. Unsigned records (the plain `tooshi_daily.py --witness`) stay where they are today: they are counted as networks that sent a record, not as witnesses.

## The answer, exactly

A JSON object with these keys and no others:

* `schema`: `"witness-answer-v0"`
* `kind`: `"furui-day"` or `"tooshi-day"`
* `day`: `YYYY-MM-DD` (UTC)
* `day_sha256`: for furui-day, the sha256 of the day record's canonical bytes as the ledger serves them (`facts.record_sha256` in the nenrin-verify output); for tooshi-day, the sha256 of the day view as `tooshi_daily.py` computes it
* `n`: number of leaves in the day record (furui-day); `null` (tooshi-day)
* `root`: the RFC 6962 root the day record names (furui-day); `null` (tooshi-day)
* `leaf_index`: the leaves you checked, ascending, each below `n` (furui-day); `[]` (tooshi-day)
* `recomputed`: only what you recomputed yourself. furui-day: the nenrin-verify step names that were ok for every leaf you list, in the tool's order (`envelope_shape`, `leaf_sha256`, `audit_path`, `signature`, `runner_key`, `bitcoin_anchor`). tooshi-day: `"day_view"`, then the ids of the checks your run actually made (state ok, red or notice), sorted
* `tool`: one line, for example `nenrin-verify 0.8.1 furui-day` or `tools/tooshi/tooshi_daily.py sha256:<hex>`
* `observed_at`: `YYYY-MM-DDTHH:MM:SSZ`
* `limits`: one line each, in your own words, saying what this answer does not establish
* `witness`: `{"name", "key_id", "key_url"}`
* `signature`: `{"alg": "ed25519", "key_id", "sig"}` with `sig` the base64 of the 64 byte signature

`key_id` is `"ed25519:"` followed by the first 16 hex characters of the sha256 of your raw 32 byte public key. Anyone can compute it from the key, so your key file needs nothing new.

What is signed (the preimage): the UTF-8 bytes of `"witness-answer-v0\n"` followed by the canonical JSON of the answer without `signature`. Canonical JSON is RFC 8785 (JCS). The answer has no floating point numbers, its integers are within plus or minus 2^53 - 1 and its keys are ASCII, so `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)` in Python gives the same bytes.

## Your key (once)

Your `key_url` must be an https URL on your own domain or on your own `<you>.github.io`. If you already serve `{"public_key_ed25519_b64": "<base64 of the raw 32 byte key>"}` there, use it as `key_url`. Nothing needs to change in that file.

Do not use `raw.githubusercontent.com` for the key. The ledger's witness intake today refuses a signed record whose key is served from the host the record walked (`self_witness`), and the base of a TOOSHI day record is the day file on `raw.githubusercontent.com`, so a key there is refused for every TOOSHI day, whoever owns it. The helper still accepts such a `key_url` inside an answer; the intake is what refuses it. Gist, github.com, package registries and other hosts that serve many people's files are refused by the helper as well, and so are this project's own domains and GitHub account.

Otherwise:

    openssl genpkey -algorithm ed25519 -out witness_key.pem
    openssl pkey -in witness_key.pem -pubout -outform DER | tail -c 32 | base64

Publish the second line's output as `{"public_key_ed25519_b64": "..."}` at your `key_url` (your domain or `<you>.github.io`). The URL must answer directly with 200 (no redirect).

## A TOOSHI day

The commands use 2026-11-06 as the day; put your day in its place.

1. After 03:47 UTC on the day, fetch the script and note its sha256:

        curl -sSfo tooshi_daily.py https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/tools/tooshi/tooshi_daily.py
        shasum -a 256 tooshi_daily.py

2. Run the checks. It only reads public endpoints and sends nothing:

        python3 -I -B tooshi_daily.py --out mine.json

   The last line prints `day_sha256`.

3. Compare with the published day once it is there (`tooshi/days/2026-11-06.json` in the repository):

        curl -sSfo day.json https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/tooshi/days/2026-11-06.json
        python3 -I -B witness_answer_v0.py compare-tooshi --result mine.json --published day.json

   `same` means your day view matches byte for byte. If it differs, the tool names the checks that differ. A check can change during the day when a Bitcoin confirmation arrives between two runs; running soon after the published run keeps that small. Report a difference as it is; do not adjust anything.

4. Build and sign the answer. Either sign with the helper:

        python3 -I -B witness_answer_v0.py build-tooshi --result mine.json --tool-file tooshi_daily.py \
          --name <your handle> --key-url <your key_url> --key witness_key.pem \
          --limit "<a line in your words>" --limit "<another line>" --out answer.json

   or sign with your own tool (the helper's Ed25519 is plain Python, not constant time):

        python3 -I -B witness_answer_v0.py build-tooshi ... --pub <your public key base64> --out answer.json
        python3 -I -B witness_answer_v0.py preimage answer.json --out preimage.bin
        openssl pkeyutl -sign -inkey witness_key.pem -rawin -in preimage.bin -out sig.bin
        python3 -I -B witness_answer_v0.py attach-sig answer.json --sig-file sig.bin --out answer.json

5. Check it as anyone else would:

        python3 -I -B witness_answer_v0.py verify answer.json --fetch

   This fetches your `key_url` and prints `VERDICT signed_answer_ok identity <your domain>`.

6. File it at the ledger's existing witness intake (optional, but it gives the answer a time anchored in Bitcoin). The helper wraps the answer in a commitment record and signs the record bytes with the same key, which is what the intake checks today:

        python3 -I -B witness_answer_v0.py intake-body answer.json --vantage "<where you ran it from>" --key witness_key.pem --out body.json
        curl -sS -X POST https://ledger.horizonshield.dev/witness -H 'content-type: application/json' --data-binary @body.json

   The reply carries `sha`, `signed: true` and `signed_domain`. Anyone can read it back at `https://ledger.horizonshield.dev/witness/<sha>`. Records are bundled into a ledger entry daily at 00:30 UTC; the Bitcoin stamp follows. Signing elsewhere works here too: without `--key` the helper writes the record bytes to `body.json.record`; sign that file and run again with `--record-sig-file` and `--pub`.

## A FURUI day record

1. Install the reader and check every leaf of the day (it reads only the ledger and the runner):

        python3 -m pip install nenrin-verify==0.8.1
        nenrin-verify furui-day 2026-11-03 --leaf 0 > leaf0.json
        nenrin-verify furui-day 2026-11-03 --leaf 1 > leaf1.json

   `facts.n` in the output is the number of leaves. Exit 0 is ok, 3 is not yet (for example the Bitcoin anchor), 1 is a failure.

2. Build, sign, verify and file as in steps 4 to 6 above, with `build-furui`:

        python3 -I -B witness_answer_v0.py build-furui --check leaf0.json --check leaf1.json \
          --name <your handle> --key-url <your key_url> --key witness_key.pem --limit "<a line>" --out answer.json

   Steps that were not ok for every leaf are left out of `recomputed`. If the anchor is not yet there, `bitcoin_anchor` is not in the answer, and you can sign a second answer after it lands.

## What a verified answer shows, and what it does not

It shows that the holder of the key served at `key_url` signed these hashes, this list of recomputed steps and these limits. It does not show that the holder ran the steps, that the content checked was right, that the day's log is complete, or who the holder is beyond the domain that serves the key. The limits you write are part of what is signed and travel with the answer.

## Joining the draw (proposal, not running yet)

A separate pool for day witnesses is proposed. You would join by signing one enrollment statement, `witness-enroll-v0` (`kinds`, `enrolled_at`, `limits`, `witness`, `signature`; preimage `"witness-enroll-v0\n"` plus canonical JSON), built with `witness_answer_v0.py enroll`. Every statement that verifies, from a domain that is not the operator's, would be listed; one entry per domain. The pool file would be public in the repository, and each draw would record the pool's hash, so you can check that you are in it and that the draw used that pool. This page will say when it is running.
