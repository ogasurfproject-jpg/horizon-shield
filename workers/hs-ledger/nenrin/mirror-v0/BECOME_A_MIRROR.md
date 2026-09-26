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
    objects/<sha256>   every record a batch entry names by bytes_url, stored under the digest the batch names it by: sha256 of the
                       bytes for agreements and executions; for a contract, contract_sha256 (sha256 over "a2a-contract-v0" plus a
                       newline plus the canonical record without its signatures, the digest both parties sign), the same address
                       whether one or both signatures are present. verify applies each rule and says which one matched.
    manifest.json      what was fetched, what verified, what did not, with the manifest sha256 (this copy) and content_sha256 (the evidence) printed at the end

Every file is named by what it is, so two mirrors made by two strangers can be compared by name and digest with `diff`, and neither needs the other to be honest.

## What a mirror establishes, and what it does not

Establishes: that these bytes, with these digests, were obtainable from the ledger at `mirrored_at`; that anyone holding the directory can recompute every digest without the network; that two mirrors which diff clean are two independent copies.

Does not establish: that any claim in the ledger is true; that an anchor is valid (verify the `.ots` file against Bitcoin headers yourself, `ots verify ledger/<n>.ots` with the OpenTimestamps client, or any independent implementation); that the copy is complete beyond the range and the objects `manifest.json` lists. A `verify` that fails names the exact file. That file is the finding, not a reason to trust the ledger less or more.

## Why this is on the reader's side

As of 2026-09-26 the bytes behind every entry exist in: the ledger itself, the intake that serves records content addressed, this repository (records are committed before their batch is anchored), and the forks of this repository. All of those are one company plus whoever forked. A mirror held by someone else, on a machine the company does not run, is the first copy the company cannot lose. The second mirror is the first one that can be checked against something other than the source.

If you hold a mirror and want it counted, say so in an issue with the `content_sha256` and the range. The manifest's own sha256 includes `mirrored_at`, so two honest mirrors never share it, by construction; `content_sha256` (the canonical manifest without `mirrored_at` and the two digest fields) and `entries_sha256` (the entries list alone) are what two mirrors of the same evidence share exactly. `verify` recomputes both and `diff` prints both for A and B. This was found by the second mirror holder on 2026-09-26. Nothing is recorded about you beyond what you post. Silence is fine too; a copy nobody knows about is still a copy.

## Self test

    python3 mirror_test.py      # a synthetic ledger on 127.0.0.1: honest pull, resume, tampered copy, lying server, diff, unreachable entry, CLI, contract address rule

## First real run (2026-09-26)

The first pull of the live ledger (56 entries, 4 records under entry 55) found one problem, in the mirror, not the ledger: the contract e15c0188 is served under its contract_sha256, the digest both parties sign, which is not the sha256 of the served bytes, and the first version of this tool only knew the plain rule. Fixed the same morning (the contract rule above, check 8). The finding is kept here because it is the kind of thing a mirror is for: the address of a record must be recomputable by a stranger from the bytes alone, and the rule for each kind is now written down where the stranger will look.
