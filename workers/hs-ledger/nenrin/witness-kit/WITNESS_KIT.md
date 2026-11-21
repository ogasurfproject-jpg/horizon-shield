# FURUI witness kit 0.1.0

This kit lets you recompute each FURUI day record yourself and sign what you found.
It runs in your own public GitHub repository, on GitHub Actions, twice a day.

## What it does

- Each day, the operator's two runners (runner-1 and runner-2) publish a signed day record of the checks they made.
- The kit reads the record of yesterday (UTC) from the ledger and every leaf of it from the runner.
- It recomputes five steps of `nenrin-verify furui-day`: envelope shape, leaf hash, audit path, signatures and the runner key.
- It signs an answer in the witness-answer-v0.2 shape with your key, and sends it to the ledger's `POST /witness`.
- The answer says `match`, `mismatch` or `incomplete`. A mismatch is signed and sent like a match.
- Each answer also keeps the ledger head it read, so a later rewrite of the chain would show.
- A copy of every answer you sent is committed to `answers/<day>/<sha>.json` and served by your GitHub Pages site.

## What it does not establish

- The Bitcoin anchor was not checked by this tool.
- It checks the day record and its leaves as the operator serves them, not the checks they describe.
- A leaf the runner no longer serves cannot be checked; the answer then says incomplete.

## What it reads and writes

- It reads only these public URLs: `furui.horizonshield.dev`, `ledger.horizonshield.dev`, and your own key URL.
- It writes only one `POST /witness` per day and runner, and the files the keep job commits in your repository.
- Every call is GET or that one POST, over https, without redirects.
- Limits: 1 MiB per response, 20 seconds per call, 60 calls and 5 minutes per run.
- It names itself in its User-Agent as `furui-witness-kit/0.1.0`.
- No text from any response is copied into what you sign; only hex, integers, dates and the kit's fixed words are.
- It runs no code from the operator and installs nothing. The three actions it uses are pinned by a 40-character commit sha.

## Your key

- `setup.sh` makes an Ed25519 key with openssl on your machine.
- The private key goes into the repository secret `FURUI_WITNESS_KEY`, and the local file is removed.
- The public key is served at `https://<you>.github.io/<repo>/keys/<key id>.json`.
- The job that holds the signing key cannot write to the repository, and the job that writes cannot read the key.

## Set it up

1. Make a new public repository and copy the files of `kit/` into its root.
2. Install gh, git, python3 and openssl 3 or later, then log in with `gh auth login`.
3. In the repository root, run `bash setup.sh "Your Name"`.
4. setup.sh stores the key, commits `keys/` and `status.json`, turns on GitHub Pages, and starts the workflow once.

## status.json

- `status.json` sits one folder above `keys/`, in the shape `furui-witness-status-v0`.
- It names your current key, your earlier keys, and the keys you revoked.
- The operator's daily audit reads it, up to 64 KiB, from the same host as your key.

## Change the key

- Run `bash setup.sh --rotate`. The old key file stays in `keys/`, and `status.json` lists it as previous.
- Answers signed with the old key still verify, because the ledger kept the key with each answer.

## Revoke a key

- If a key may have leaked, add `{"key_id": "ed25519:<16 hex>", "since": "YYYY-MM-DDTHH:MM:SSZ"}` to `revoked` in `status.json`.
- Then run `bash setup.sh --rotate` and push.
- The audit stops counting answers signed by that key, unless a ledger batch made before `since` lists them.
- You choose the time; the operator does not.

## Stop

- Disable the workflow in the Actions tab, or delete the repository.
- Nothing needs to be sent to the operator.

## When a run fails

- A run fails when a day did not end in a sent match. GitHub then notifies you by its usual rules.
- The answer job's log names the day, the runner and the outcome.
- The operator does not chase you. Gaps in answers are visible to anyone in the audit's witness table.

## Updates

- The operator lists each kit version and the sha256 of its files in `VERSIONS.json`.
- To update, replace the files yourself. The operator sends no pull request or issue to your repository.
- An answer from an edited script is shown as `modified` in the audit's witness table.
