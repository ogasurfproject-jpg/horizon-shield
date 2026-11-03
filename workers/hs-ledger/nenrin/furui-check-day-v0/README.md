# furui-check-day-v0: the content check runner's day record, and the chain it belongs to

This directory holds the ledger side of furui-check-day-v0: the intake (`furui_check_day_intake.mjs`) and the runner's
keys as the ledger serves them (`furui_check_keys.mjs`). This page says what the record is, which public endpoints serve
it and the records around it, and how they connect. Every endpoint below is a plain GET. None needs a key or an account.

## The chain

An agent's action passes five steps. Each step leaves a record that the next one names by sha256.

    篩 (FURUI)  →  関の扉 (SEKI admission)  →  結の精算 (MUSUBI settle)  →  年輪の台帳 (NENRIN)  →  Résumé

TOOSHI checks the links every day. 継 (TSUGI) calls outside witnesses by draw.

1. 篩 (FURUI), the content check. A runner reads a content against the scope a contract names and returns a decision
   (pass or stop) with closed marks. It signs one envelope per check. The envelope keeps no text: every value is a
   64 hex digest, a number, a boolean, null or a fixed word. The content is committed as `input_commit`, the sha256 of a
   32 byte salt and the content; the door draws the salt, hands it to the requester alone and does not keep it, so the
   content cannot be guessed from the record.
   Once a day the runner signs the RFC 6962 root of the day's envelopes. That signed root is furui-check-day-v0.
2. 関の扉 (SEKI admission), the door. Before an action runs, the door asks the runner and writes an admission record
   (a2a-admission-v0). Version 0.4 carries the check as a content block of fields only: `input_commit`, the digest of
   the check, the rule set, the decision, the marks, and whether it was read, answered and checked.
3. 結の精算 (MUSUBI settle), the settlement. A contract (musubi-v0) can require an admission for each action and name
   the rule set of the content check. Settle v1.19 reads each executed action with the admission it names and returns
   `within_grant` when the action stayed inside the grant, or a deviation with its reason. Anyone can recompute it from
   the records with `../musubi-v0/settle_v1_19.py` in this repository.
4. 年輪の台帳 (NENRIN), the ledger. The day record, the admissions and the agreements go to the ledger's public pool,
   are served by sha256 at once, and are anchored to Bitcoin in the daily batch at 00:30 UTC (OpenTimestamps).
5. Résumé. `GET /resume?endpoint=<url>` lists what is anchored for an endpoint. `agreements[]` lists its anchored
   agreements. `admissions[]` lists the anchored admissions whose relying party is on that endpoint's host: the record's
   sha256, its ledger entry, the decision, the closed part of a 0.4 content block, and whether it was revoked. No text.

TOOSHI (`tools/tooshi/tooshi_daily.py`) reads these public endpoints once a day, holds no secret and writes nothing.
Each check ends `ok`, `red`, `notice` or `not_yet`; a check that cannot be made yet is named and is never reported `ok`.
The list of checks is in the file's opening comment.

継 (TSUGI) is the recovery layer. When a repaired agent is re-verified, TSUGI draws witnesses from a pool. The draw is computed
from a Bitcoin block nobody can predict, the pool and the record, so the operator cannot choose who is asked. See
`../recovery-v0/BECOME_A_WITNESS.md`.

## The day record (furui-check-day-v0)

One record per runner per UTC day, and none for a day without checks. Its fields: `schema`, `day`, `signer`
(`domain`, `key_url`), `n` (the number of envelopes), `tree` (`rfc6962-sha256`), `leaf`
(`sha256(0x00 || musubi-canonical-v0(envelope))`), `root`, `first_height`, `last_height`, `late`, `clock_skew`,
`publication` (`public`) and one Ed25519 signature over `furui-check-day-v0\n` followed by the canonical bytes of the
record without `signatures`.

The ledger accepts a record only when its bytes are canonical (musubi-canonical-v0), its shape is closed, its
`key_url` is the ledger's own keys path, its key is listed there for `furui-check` and valid for the record's heights,
and the signature verifies. A second record for a day that already holds one with the same root is answered with the
first record's sha and not stored. Another root for the same day is refused (`day_already_recorded`).

## Public endpoints

The ledger, https://ledger.horizonshield.dev

| GET | What it returns |
|---|---|
| `/furui-check-day` | the format, the intake rules and the caps |
| `/furui-check-day/{canonical_sha256}` | the stored bytes of a day record, its status (`pending_anchor` or `anchored`) and its ledger entry |
| `/.well-known/furui-check-keys.json` | the runner's keys: `key_id`, the Ed25519 public half, `from_height`, `revoked_height` |
| `/admission/{canonical_sha256}` | the stored bytes of an admission record and its status |
| `/agreement/{canonical_sha256}` | the stored bytes of an agreement record and its status |
| `/resume?endpoint={url}` | the Résumé of an endpoint, with `agreements[]` and `admissions[]` |

The runner, https://furui.horizonshield.dev (GET only; no content, scope, question or answer text and no key value)

| GET | What it returns |
|---|---|
| `/health` | the runner's version, `key_id`, public key, the `key_url` it signs for, its rule set digest, its spending caps and its keeping period |
| `/furui/day/{YYYY-MM-DD}/status` | the day's count of checks, spending, whether a cap was hit, and the state of its day record at the ledger (`record_sha256`, `ledger_canonical_sha256`) |
| `/furui/day/{YYYY-MM-DD}/leaf/{i}` | envelope `i` of a closed day, its leaf hash, and its RFC 6962 audit path to the day's root |
| `/furui/heartbeat` | the last run of the daily heartbeat scene (a fixed public text at 03:17 UTC): time, decision, marks |

A day closes in the hour after it ends (cron 47 every hour), so its day record and its leaves answer from about
00:47 UTC the next day. Envelopes are kept 7 days after their day and then deleted; after that the leaf read answers 410. The day
record, its root and its status stay, so the root stays checkable on the ledger after the envelopes are gone.

The door, https://hs-gateway.oga-surf-project.workers.dev/seki

| GET | What it returns |
|---|---|
| `/seki` | the door's policy. Its `furui` block names the runner's rule set and, once the door's daily check call has run (03:47 UTC), `check_call`: the day, the time, `ok`, the admission's `record_sha256`, its decision, reasons and version, a summary of the content block, and whether the ledger accepted it. `check_call_prev` keeps the call before it, so the envelope of yesterday's call can be found among the runner's leaves |
| `/seki/record/{sha256}` | the admission bytes as the door holds them; they must equal the ledger's |

## Checking a day by hand

    D=2026-11-03
    curl -s https://furui.horizonshield.dev/furui/day/$D/status
    curl -s https://ledger.horizonshield.dev/furui-check-day/<ledger_canonical_sha256 from the status>
    curl -s https://ledger.horizonshield.dev/.well-known/furui-check-keys.json
    curl -s https://furui.horizonshield.dev/furui/day/$D/leaf/0

Then: the record's signature verifies under the listed key; the leaf hash is `sha256(0x00 || canonical(envelope))`;
the audit path rebuilds the record's `root`; and once the record is `anchored`, its ledger entry carries a Bitcoin
timestamp.

## What these records do not show

- Whether a check was right. The records show that a check was made, under which rule set, with which decision, and
  that nothing was changed afterwards.
- The content, the scope text or the answer. None of them is kept or served.
- Envelopes older than 7 days. Only their root remains.
