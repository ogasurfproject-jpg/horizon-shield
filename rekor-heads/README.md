# rekor-heads

`rekor-heads.jsonl` records, one line a day, the head of the HORIZON SHIELD ledger
(`https://ledger.horizonshield.dev/ledger/head`) as it was logged in the public Rekor log at `https://rekor.sigstore.dev`.

What is logged is the sha256 of the ledger's end marker in canonical JSON,
`{"head":<head>,"n":<n>,"prev_entry_sha256":<head>,"schema":"jidec-head-v1"}`, which is the `entry_sha256` that
`/ledger/head` and the last line of `/ledger/export.jsonl` carry. It goes in as a `hashedrekord` entry signed with an
ECDSA P-256 key. Only that sha256, the signature over it and the public key are sent to Rekor; no ledger content.

The public key is at `https://horizonshield.dev/.well-known/rekor-head-key.json`:
`{public_key_pem, key_sha256, purpose, since}`, where `key_sha256` is the sha256 of the DER SubjectPublicKeyInfo
(`390856f65b708cbf2f181e732726939f622eff65a9ffedd2e1c141038ff29507`). The same key is inside every entry.

## One line

Canonical JSON (keys sorted, no spaces), exactly these five keys:

| key | form |
|---|---|
| `day` | `YYYY-MM-DD`, the UTC day of `integrated_time` |
| `head_sha256` | 64 lowercase hex, the hashedrekord digest = the end marker sha256 |
| `integrated_time` | integer, the `integratedTime` Rekor gave the entry |
| `rekor_log_index` | integer, the global `logIndex` of the entry |
| `rekor_uuid` | 80 lowercase hex, the entry UUID as Rekor returns it (tree id and leaf hash) |

`day`, `rekor_log_index` and `integrated_time` rise strictly from line to line, and a day has at most one line.
Lines are added by hand for now, after the ledger's daily batch at 00:30 UTC, so a day can be missing.

## Checking a line

1. Rekor: `GET https://rekor.sigstore.dev/api/v1/log/entries?logIndex=<rekor_log_index>`. The entry's UUID,
   `integratedTime` and digest equal the line; the signature verifies with the key above; the inclusion proof, the
   signed checkpoint and the signed entry timestamp verify with the Rekor key
   (logID `c0d23d6ad406973f9559f3ba2d1ca01f84147d8ffc5b8445c224f98b9591801d`).
2. Ledger: take `/ledger/export.jsonl` today, recompute every `entry_sha256` along `prev_entry_sha256`, and find the
   n whose end marker has `head_sha256` as its sha256. The n of later lines does not go back, and today's
   `/ledger/head` is the end marker of the export. A head that the ledger served on that day and that is no longer in
   today's chain shows here.
3. This file: every line has the form above and the order above.
