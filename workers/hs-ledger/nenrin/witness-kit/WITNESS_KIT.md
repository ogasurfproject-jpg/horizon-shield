# FURUI witness kit 0.2.0

This kit lets you recompute each FURUI day record yourself, check that it is anchored in Bitcoin, and sign what you found.
It runs in your own public GitHub repository, on GitHub Actions, twice a day.

## What it does

- Each day, the operator's two runners (runner-1 and runner-2) publish a signed day record of the checks they made.
- The kit reads yesterday's record (UTC) from the ledger and every leaf of it from the runner.
- It recomputes five steps of `nenrin-verify furui-day`: envelope shape, leaf hash, audit path, signatures and the runner key.
- It signs a **day answer** in the witness-answer-v0.2 shape with your key, and sends it to the ledger's `POST /witness`.
- Once the ledger's batch entry that lists the record is confirmed in Bitcoin, it checks the anchor as a sixth step and signs an **anchor answer**.
- An answer says `match`, `mismatch` or `incomplete`. A mismatch is signed and sent like a match.
- Each answer also keeps the ledger head it read, so a later rewrite of the chain would show.
- A copy of every answer you sent is committed to `answers/<day>/<sha>.json` and served by your GitHub Pages site.

## The anchor answer

- A day record is anchored some hours after the day closes, so the anchor has its own answer, sent once per day and runner.
- runner-2 closes a day at 00:14 UTC; its record is in the ledger's 00:30 UTC batch the same night, so its anchor answer usually comes in the 03:50 UTC run of the next day.
- runner-1 closes a day at 00:47 UTC, after that batch; its anchor answer comes in the 03:50 UTC run one day later.
- The sixth step checks that:
  - the batch entry's bytes hash to its claim, and the entry lists the day record;
  - the entry's OpenTimestamps proof commits the entry to the Bitcoin block the ledger names;
  - mempool.space and blockstream.info both name the same block hash at that height and serve the same 80-byte header;
  - the header hashes to the block hash, meets the target of its own bits, and holds the merkle root the proof reaches.
- The record the kit sends names the day, the ledger entry, the block height and the block hash.
- It uses the purpose `furui-anchor-v0: <day>`, beside the day answer's `furui-day-v0: <day>`.
- If a read fails on the network or explorer side, the next run tries again.
- If a day record is still not in a batch confirmed in Bitcoin 4 days after the day, the anchor answer says incomplete.

## What it does not establish

- It checks the day record and its leaves as the operator serves them, not the checks they describe.
- A leaf the runner no longer serves cannot be checked; the answer then says incomplete.
- The block header comes from two public explorers, not from a copy of the Bitcoin chain you keep.
- The header's proof of work is checked against the target of its own bits, not against the chain's difficulty at that height.

## What it reads and writes

- It reads only these public URLs: `furui.horizonshield.dev`, `ledger.horizonshield.dev`, `mempool.space/api`, `blockstream.info/api`, and your own key URL.
- From the two explorers it asks only `/block-height/<height>` and `/block/<hash>/header`.
- It writes at most two `POST /witness` per day and runner, and the files the keep job commits in your repository.
- Every call is GET or one of those POSTs, over https, without redirects.
- Limits: 1 MiB per response, 20 seconds per call, 160 calls and 8 minutes per run.
- Work that does not fit in a run is left for the next run; the kit does not sign it as incomplete. Only a day with more leaves than one run may read is signed incomplete.
- It names itself in its User-Agent as `furui-witness-kit/0.2.0`.
- No text from any response is copied into what you sign; only hex, integers, dates and the kit's fixed words are.
- It runs no code from the operator and installs nothing. The three actions it uses are pinned by a 40-character commit sha.

## Your key

- `setup.sh` makes an Ed25519 key with openssl on your machine, or takes one you already have (`--key-file`).
- The private key goes into the repository secret `FURUI_WITNESS_KEY`, and the local copy is removed.
- By default, the public key is served at `https://<you>.github.io/<repo>/keys/<key id>.json`.
- The job that holds the signing key cannot write to the repository, and the job that writes cannot read the key.

## Set it up

1. Make a new public repository and copy the files of `kit/` into its root, including `.github/` and `.gitattributes`.
2. Install gh, git, curl, Python 3.8 or later and openssl 3 or later, then log in with `gh auth login`.
3. In the repository root, run `bash setup.sh "Your Name"`.
4. setup.sh stores the key, commits `keys/` and `status.json`, turns on GitHub Pages, and starts the workflow once.

## Your key on your own site

If you want your answers to carry your own domain, serve the public key from your site instead of GitHub Pages:

    bash setup.sh "Your Name" --key-url https://your.site/keys/witness.pub

- Add `--key-file <file>` to keep a key you already have: PEM, or an OpenSSH key without a passphrase.
- If your OpenSSH key has a passphrase, make a copy without it (`ssh-keygen -p -N "" -f <copy>`), pass the copy, then delete it.
- Without `--key-file`, a new key is made.
- A key URL that ends in `.pub` serves one OpenSSH line (`ssh-ed25519 ...`); any other serves `{"public_key_ed25519_b64": "..."}`.
- setup.sh publishes nothing of the key on GitHub Pages. It prints the two small files to place on your site, and also writes them to `place_on_your_site/` (not committed):
  - the key file, at your key URL;
  - `status.json`, beside the key file, or one folder above it when the key file sits in `keys/`. That is where the operator's audit reads it. `--status-url` is checked against that place.
- Your answers stay in this repository, and GitHub Pages still serves them. `status.json` names that place as `answers_url`, so the audit can find your copies.
- setup.sh waits up to 20 minutes for both files to be served, then starts the workflow.

## On Windows

- Run setup.sh from Git Bash or WSL: `bash setup.sh "Your Name"`.
- Python may be installed as `python` or `py`; setup.sh finds it.
- If the files picked up CR LF line endings when they were copied, setup.sh still runs, and it turns them back into LF before it commits.
- `.gitattributes` keeps them LF on every later checkout.
- The workflow itself runs on GitHub's Linux runners, not on your machine.

## status.json

- `status.json` names your current key, your earlier keys, and the keys you revoked, in the shape `furui-witness-status-v0`.
- The operator's daily audit reads it, up to 64 KiB, from the same host as your key.
- With the key on GitHub Pages it sits one folder above `keys/` in this repository.
- With the key on your own site, the audit reads the copy on your site; this repository keeps its own copy for the keep job.

## Change the key

- Run `bash setup.sh --rotate` (add `--key-url` and `--key-file` as above when your key is on your own site).
- The old key stays listed in `status.json` as previous.
- Answers signed with the old key still verify, because the ledger kept the key with each answer.

## Revoke a key

- If a key may have leaked, add `{"key_id": "ed25519:<16 hex>", "since": "YYYY-MM-DDTHH:MM:SSZ"}` to `revoked` in the `status.json` the audit reads.
- Then run `bash setup.sh --rotate` and push.
- The audit stops counting answers signed by that key, unless a ledger batch made before `since` lists them.
- You choose the time; the operator does not.

## Stop

- Disable the workflow in the Actions tab, or delete the repository.
- Nothing needs to be sent to the operator.

## When a run fails

- A run fails when a day did not end in a sent match. GitHub then notifies you by its usual rules.
- An anchor that is not confirmed yet is not a failure; the run says it waits.
- The answer job's log names the day, the runner, the kind of answer and the outcome.
- The operator does not chase you. Gaps in answers are visible to anyone in the audit's witness table.

## Updates

- The operator lists each kit version and the sha256 of its files in `VERSIONS.json`.
- To update, replace the files yourself. The operator sends no pull request or issue to your repository.
- An answer from an edited script is shown as `modified` in the audit's witness table.
- From 0.1.0 to 0.2.0: replace `furui_witness.py`, `setup.sh` and `.github/workflows/furui-witness.yml`, and add `.gitattributes`.
  Your key, `status.json` and `answers/` stay as they are; the first runs also send anchor answers for the days you already answered.
