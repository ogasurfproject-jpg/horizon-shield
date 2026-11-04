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
- 0.3.0: if the 3 s retry also gets no answer or a `5xx`, the slot is called again at +5 min and, if needed, at +15 min
  from the slot time (not from the failure), one call each, by the Durable Object alarm. No cron line is added (the
  account's 5 Free Cron Triggers are all used). A `4xx` on a retry ends it. The retry claims nothing: it belongs to the
  slot's first claim, so the same cron minute arriving again during the wait is still `duplicate_slot`, and a queued
  retry is taken off the queue before its call, so an alarm that runs twice calls once. Why: on 2026-11-04 the
  jidec-stamp slot 11:17 UTC met GitHub answering `500` from 11:16 to 11:18 and was failed after both calls.
- The log keeps every record: the first `failed` stays, and each retry writes its own record with `via: "alarm"`,
  `retry: 1` or `2`, `after_failed_slot: true`, and `retry_next` while another call is still due.
- The token is never written to the log, never served, and is replaced by `[token]` in any error text.
- Nothing can be started from outside: the Worker answers `GET` only.

## Reading it

- `GET /status`: per job the last result, the last ok slot and the time that dispatch was made, failures in the last
  3 days, and `late` (no ok dispatch made within its period plus 1 h, counted from the time of the dispatch, so a slot
  ok on its +15 min retry is late 15 min later). `late_jobs`, `failed_in_view` and `retrying_in_view` at the top.
  `failed_in_view` counts slots that got no ok dispatch at the slot nor on a retry; a slot ok on a retry is not a
  failure, although its first `failed` record stays in `/log`. A slot whose retry is still due is in
  `retrying_in_view`, and moves to `failed_in_view` if its retry record has not come 30 min after the due time.
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
