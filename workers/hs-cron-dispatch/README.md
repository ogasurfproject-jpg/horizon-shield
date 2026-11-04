# hs-cron-dispatch

A small Worker whose Cloudflare cron triggers start the time-bound workflows of this repository with
`workflow_dispatch`, because GitHub starts scheduled workflows hours late (2026-10-26 to 11-03, measured with the
GitHub API: survive-drill 03:17 UTC started 08:59 to 11:15, issuer-keys 03:23 started 09:10 to 11:28, receipt-anchor
01:37 started 06:46 to 09:03, tooshi-daily 04:05 started 11:50, seki-heartbeat 21:17 started 00:10 to 02:56 the next
day; jidec-stamp, hourly, came 1 to 6 times a day). The GitHub schedules stay in the workflow files as a late fallback.

## What it starts

| UTC | JST | workflow | inputs | when the day is already done |
|---|---|---|---|---|
| every hour at :17 | every hour at :17 | `jidec-stamp.yml` | none | nothing to guard: stamping is idempotent, runs queue in the concurrency group |
| 01:37 | 10:37 | `receipt-anchor.yml` | `date` = the day before | the ledger answers the same claim with the same entry (dedup); copy and index do not change |
| 03:17 | 12:17 | `survive-drill.yml` | `slot=cron` | job `decide`: nothing when `drills/latest-github.json` on main has today's `drill_at` |
| 03:23 | 12:23 | `issuer-keys.yml` | `slot=cron` | step `decide`: nothing when today's observation and its `.ots` are on main |
| 04:05 | 13:05 | `tooshi-daily.yml` | `slot=schedule` | decided like the 04:05 cron: nothing when `tooshi/days/<day>.json` is on main, nothing before 03:47 |
| 04:35 | 13:35 | `tooshi-daily.yml` | `slot=second` | decided like the 04:35 cron |
| 19:10 | 04:10 | `ots-nightly.yml` | `mode=nightly` | decide: nothing when `ots-nightly/nights/<night>.json` is on main (0.2.0; until the workflow is on main GitHub answers 404, written down as failed, not retried) |
| 21:17 | 06:17 | `seki-heartbeat.yml` | none | `heartbeat.py run` and `check_loop.py file` write a day once ("already ran") |

A run by hand (`workflow_dispatch` with `slot` empty) runs as before.

## Rules

- One call per job and cron minute. The slot is claimed in the log (a SQLite backed Durable Object) before the call,
  so a second invocation of the same minute calls nothing and is written down as `duplicate_slot`.
- `204` (or `200`) is ok. A `4xx` is written down and not retried. A network error or `5xx` is retried once after 3 s.
- The token is never written to the log, never served, and is replaced by `[token]` in any error text.
- Nothing can be started from outside: the Worker answers `GET` only.

## Reading it

- `GET /status`: per job the last result, the last ok slot, failures in the last 3 days, and `late` (no ok dispatch
  within its period plus 1 h). `late_jobs` and `failed_in_view` at the top.
- `GET /log?day=YYYY-MM-DD`: every decision of that UTC day.
- `GET /selfcheck`: one read only GitHub call with the token (the metadata of `jidec-stamp.yml`), at most once per 10
  minutes; `github_http: 200` means the token reaches the repository's Actions.
- Workers Logs (observability is on): one line per invocation, and one error line per failed dispatch.

## Secret

`GH_DISPATCH_TOKEN`: a fine-grained personal access token, resource owner `ogasurfproject-jpg`, repository access
"Only select repositories" with `horizon-shield` only, repository permission **Actions: Read and write** and nothing
else (Metadata: read is added by GitHub). The owner puts it with `wrangler secret put`; it is never in this repository.
Without it the Worker fires, writes `token_not_configured`, and calls nothing.

## Tests

`node test/run_all.mjs` (no network: `fetch` throws in the tests).
