# Become a mirror (nenrin-mirror-v0)

An anchor on Bitcoin proves that bytes with a given digest existed by a given block. It does not keep the bytes. If every copy disappears (this ledger, its intake, this repository, the company behind them), the anchor still proves that something existed, and nobody can say what. Integrity is not availability.

The fix is not a promise by the operator to keep serving. It is copies, held by people who are not the operator, each checkable against the anchors alone. This directory is the tool for holding one.

## Run it

    python3 mirror.py pull --dir ~/nenrin-mirror        # first run fetches everything; later runs resume and re-verify
    python3 mirror.py verify --dir ~/nenrin-mirror      # offline, no network: every digest recomputed from your disk
    python3 mirror.py diff ~/nenrin-mirror /path/to/another-mirror

Standard library only, Python 3.8 or later. Read only against the ledger; nothing is uploaded anywhere. About one request per file, with a pause between requests.

## What lands on your disk

    ledger/<n>.json    the entry as served: claim_sha256, ots_status, bitcoin_block, record_canonical
    ledger/<n>.raw     the claim bytes as served; sha256(raw) must equal claim_sha256, or the pull records it
    ledger/<n>.ots     the OpenTimestamps proof for that entry, verifiable against Bitcoin block headers with any OTS client
    objects/<sha256>   every record a batch entry names by bytes_url (contracts, agreements, executions), stored under its own sha256
    manifest.json      what was fetched, what verified, what did not, with the manifest's own sha256 printed at the end

Every file is named by what it is, so two mirrors made by two strangers can be compared by name and digest with `diff`, and neither needs the other to be honest.

## What a mirror establishes, and what it does not

Establishes: that these bytes, with these digests, were obtainable from the ledger at `mirrored_at`; that anyone holding the directory can recompute every digest without the network; that two mirrors which diff clean are two independent copies.

Does not establish: that any claim in the ledger is true; that an anchor is valid (verify the `.ots` file against Bitcoin headers yourself, `ots verify ledger/<n>.ots` with the OpenTimestamps client, or any independent implementation); that the copy is complete beyond the range and the objects `manifest.json` lists. A `verify` that fails names the exact file. That file is the finding, not a reason to trust the ledger less or more.

## Why this is on the reader's side

As of 2026-09-26 the bytes behind every entry exist in: the ledger itself, the intake that serves records content addressed, this repository (records are committed before their batch is anchored), and the forks of this repository. All of those are one company plus whoever forked. A mirror held by someone else, on a machine the company does not run, is the first copy the company cannot lose. The second mirror is the first one that can be checked against something other than the source.

If you hold a mirror and want it counted, say so in an issue with the manifest sha256 and the range. Nothing is recorded about you beyond what you post. Silence is fine too; a copy nobody knows about is still a copy.

## Self test

    python3 mirror_test.py      # a synthetic ledger on 127.0.0.1: honest pull, resume, tampered copy, lying server, diff, unreachable entry, CLI
