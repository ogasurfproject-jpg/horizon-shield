# hs-sweep-kicker

A small Worker that asks the verify gate (`workers/hs-verify-gate`, https://gate.horizonshield.dev) for one more
sweep on a day when the gate's own daily sweep could not measure every row that was due. It does not change the
gate. It is a stopgap until the gate covers its whole due list by itself (gate 0.4.21, "stage 2").

**0.2.0 (2026-10-23, deployed after gate 0.4.21).** Gate 0.4.21 sweeps four times a day by itself (18:00, 19:00,
20:00 and 21:00 UTC), leaves out rows already measured that UTC day, and records every run of a day at
`GET /sweep/day?day=YYYY-MM-DD` with `complete` and `missing`. So this Worker has no cron any more
(`triggers.crons` is `[]`). It stays deployed for `/health`, `/log` and `/probe`, and for a run started by hand.
When it calls `POST /sweep` it sends `SWEEP_ONLY_TOKEN`, a key the gate accepts for `POST /sweep` and nothing else
(no `force`, no register change). It no longer reads `SWEEP_TOKEN`, the gate's operator key, and has no fallback to
it: without `SWEEP_ONLY_TOKEN` it records `token_not_configured` and does not call. The sections below describe the
stage 1 behaviour (0.1.x), which a run by hand still follows.

## Why it exists

Until 0.4.20 the gate re-measured its watched endpoints from one cron a day (`0 18 * * *` UTC). One sweep measured at
most `MAX_PER_SWEEP = 8` rows, and stopped earlier when the gate's own fetch budget of 50 ran out. Both numbers were
the gate's own, copied from the Workers Free limits; the account is on Workers Paid (10,000 subrequests per
invocation, https://developers.cloudflare.com/workers/platform/limits/), and gate 0.4.21 sets them anew. The
rows left over are written to `/sweep/last` as `skipped`, with a reason that starts with `over MAX_PER_SWEEP` or
`subrequest budget`. On 2026-10-22 the sweep had 18 rows due and measured 7: all 9 self rows were skipped
`over MAX_PER_SWEEP`, as were one free row (`over MAX_PER_SWEEP`) and another (`subrequest budget`).
`tools/gate_coverage/coverage.mjs --day 2026-10-22` lists the 11.

## What it does

Stage 1 (0.1.x) had three crons, UTC (JST in brackets). 0.2.0 has none; the list is kept in `src/worker.js` as
`STAGE1_CRONS`:

| cron | UTC | JST |
|---|---|---|
| `17 19 * * *` | 19:17 | 04:17 |
| `41 19 * * *` | 19:41 | 04:41 |
| `13 20 * * *` | 20:13 | 05:13 |

On each one it reads `GET /sweep/last` from the gate and calls the gate's own `POST /sweep` (body `{}`, header
`x-sweep-token`; since 0.2.0 the value is `SWEEP_ONLY_TOKEN`) only when all of these hold:

| # | condition | when it does not hold |
|---|---|---|
| 0 | this Worker's own log for today can be read (to know how many calls it has made) | no GET, no POST, nothing written (a failed read is not an empty day) |
| 1 | `/sweep/last` was read: HTTP 200 and JSON | `record_only` / `sweep_last_unreadable`, not retried |
| 2 | the last sweep is from today (UTC day of `at`) | `skip` / `not_today` |
| 3 | it says `ran: true` | `skip` / `not_ran` |
| 4 | a skipped row's reason starts with `over MAX_PER_SWEEP` or `subrequest budget` (the gate's exact words) | `skip` / `no_capacity_skips` |
| 5 | at least one of those rows was not measured today: an `over MAX_PER_SWEEP` row whose reason says `last measured <time>` with a time before today, or `never`; a `subrequest budget` row whose last record in the gate's public `GET /history` is not from today, or could not be read (see below) | `skip` / `all_capacity_skips_measured_today` |
| 6 | this Worker has called `POST /sweep` fewer than 3 times this UTC day | `skip` / `daily_cap_reached` |
| 7 | the secret `SWEEP_ONLY_TOKEN` is set on this Worker (0.1.x: `SWEEP_TOKEN`) | `record_only` / `token_not_configured` |
| | all hold | `kick`: one `POST /sweep`, never retried |

The result of the POST is written down and nothing else happens: 200 (the gate ran the sweep), 403 (the gate did not
accept this Worker's `SWEEP_ONLY_TOKEN`), 409 (another sweep held the gate's lease), 503 (the gate has no sweep key
set, or its sweep lease was unavailable), or 0 (no answer: network error or timeout). Any call that was attempted counts
toward the 3 a day, whatever came back.

Condition 5 is stricter than "a skipped row says over MAX_PER_SWEEP": the gate sorts its due rows by when they were
last measured, so after one kick the rows it just measured sit at the end of the list and are skipped
`over MAX_PER_SWEEP` again with today's time. Without condition 5 every day would use all 3 calls.

A `subrequest budget` reason does not say when the row was last measured. Since 0.1.1, when such rows are the only
ones still counted as pending (every `over MAX_PER_SWEEP` row was measured today, the sweep is from today and ran,
and calls are left today), the Worker reads `GET /history?endpoint=<row>` from the gate for each of them, at most
`MAX_HISTORY_READS = 8` a run, and counts a row as measured today when its last record's `at` is from today. A row
whose history could not be read (non-200, no answer), or that is past the 8, counts as not measured today: the
Worker may then call once more, but it never leaves a row out. Why it mattered: the gate sorts due rows by when they
were last measured and the budget runs out at the end of its 8 seats, so after two kicks the row skipped for budget
is usually one measured earlier that day. On the 2026-10-22 shape (9 self rows over `MAX_PER_SWEEP`, 1 free row
over `MAX_PER_SWEEP`, 1 free row for budget), 0.1.0 called at 19:17, 19:41 and 20:13, and the third call only
re-measured; 0.1.1 calls twice and every one of the 18 rows is measured (test `10/22 shape`).

## The log

Every decision and result is written to the KV namespace `KICK_LOG`, one key per UTC day (`log:YYYY-MM-DD`, kept
400 days), as `{ schema: "hs-sweep-kicker-log-v1", day, entries: [...] }`. Each entry has `at`, `scheduled_at`,
`cron`, `sweep_last` (counts only: `ran`, `at`, `is_today`, `watched_total`, `measured`, `skipped_total`,
`skipped_over_max`, `skipped_over_max_measured_today`, `skipped_budget`, `skipped_budget_measured_today`,
`pending_not_measured_today`), `budget_history` (`null` when not read, else counts only: `rows`, `read`, `today`,
`earlier`, `unknown`, `cap`), `kicks_before`,
`decision`, `reason`, `why`, and `post` (`http`, `ran`, `at`, `measured`, `error`, the same skipped counts of the
sweep it caused, `meaning`, `retried: false`) or `null`.

- `GET /log?day=YYYY-MM-DD`: that day's log. 200 with `entries: []` for a day with none; 503 `log_read_failed` when it
  could not be read (not "nothing happened").
- `GET /` or `GET /health`: what this Worker is, its crons (none since 0.2.0), the name of the token it uses
  (`token_name: "SWEEP_ONLY_TOKEN"`), whether the token and the KV are configured (true/false).
- `GET /probe`: reads `/sweep/last` once and says whether it was readable. No POST, nothing stored. For checking the
  path to the gate right after a deploy.

The token, request headers and response headers are never written and never served. Endpoint URLs are not copied
into the log either; the gate publishes them in `/sweep/last` and `/history`.

## How it reaches the gate, and /usage

`vars.GATE_VIA` is `"url"`: requests go to the public `https://gate.horizonshield.dev`, so the sweep the gate runs for
`POST /sweep` is a request of its own with its own subrequest allowance (the gate counts its own fetch budget from
zero in each run). `"binding"` sends them over the service binding `GATE` instead, the way hs-ledger reads the gate's
records. Whether a service binding call shares the caller's subrequest allowance was not measured; keep `"url"`
unless `GET /probe` cannot read the gate.

Every request carries `User-Agent: hs-sweep-kicker/<version> (+https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/workers/hs-sweep-kicker)`
and `x-hs-requester: operator`. The gate does not count `GET /sweep/last`, `GET /history` or `POST /sweep` in `/usage` at
all (it counts only `POST /check`, `POST /a2a`, MCP `tools/call`, `/spec` and the testbed: its counters `bumpUsage`,
`bumpRequests` and `noteRequesterNetwork` are called from none of those three handlers). A test reads the gate's
`src/worker.js` in this repository and fails if its `/history` handler ever calls one of them.

Outbound requests per run: 1 `GET /sweep/last`, up to 8 `GET /history`, up to 1 `POST /sweep`, so at most 10, plus
up to 3 KV calls for its own log. Cloudflare counts KV calls as subrequests too; 13 is far inside the 10,000 a Workers
Paid invocation allows. (Earlier versions of this README said the KV calls were on a separate allowance; that was a
guess and the limits page says otherwise.) The sweep a kick causes does what the gate's crons do. Until gate 0.4.20,
when it measured the gate's own `/mcp` (a self row with tool-call consent), those `tools/call` requests arrived
through the relay and were counted under `requesters`, class other. Since gate 0.4.21 they carry the gate's own
short-lived mark `x-hs-own-sweep` and are not counted.

## What it does not fix

- **(0.1.x, before gate 0.4.21) It re-measured when fewer than 8 rows were left.** Gate 0.4.20 did not drop rows
  already measured today from its due list. Gate 0.4.21 does, so a run by hand of 0.2.0 measures only rows not yet
  measured that day.
- **It adds requests to the gate.** A run by hand causes at most one sweep more than the gate's own four, plus 1 to
  10 requests from this Worker.
- **A kicked sweep probes the gate's own zone through the relay.** `POST /sweep` runs in the gate's HTTP context, where
  the gate reaches every endpoint of its own zone (the self rows) through `RELAY_URL` instead of directly, as the
  operator's manual `POST /sweep` always has (the cron goes direct to every row but the gate itself). The records
  say so in `probed_via`. If the relay is down, those self rows are not measured by the kick.
- **Free rows skipped on their day still wait a week.** A free row is due on one day of the 7-day window. If no kick
  reaches it that day (the 3 calls are used, or the gate answered 409 or 503), it is next due in the next window.
- It depends on the gate's own sentences (`over MAX_PER_SWEEP`, `subrequest budget`, `last measured <time>, so it
  goes first`). If the gate rewords them, condition 4 stops holding and the kicker stops calling; it does not call
  more.

When gate 0.4.21 has measured every due row itself for a while (`GET /sweep/day` says `complete: true` day after day),
this Worker should be removed (delete the Worker, then this folder).

## Setup (owner only)

The KV namespace, the secret and the deploy are done by the owner, never by CI:

```
cd workers/hs-sweep-kicker
npx wrangler kv namespace create KICK_LOG      # its id goes into wrangler.jsonc in place of the 32 zeros, before the commit
npx wrangler secret put SWEEP_ONLY_TOKEN       # 0.2.0: the same value as the gate's SWEEP_ONLY_TOKEN; never written to a file
npx wrangler secret delete SWEEP_TOKEN         # 0.2.0 no longer reads the operator key; remove it from this Worker
npx wrangler deploy
curl -s https://hs-sweep-kicker.oga-surf-project.workers.dev/health
curl -s https://hs-sweep-kicker.oga-surf-project.workers.dev/probe
```

## Tests

```
node test/run_all.mjs
```

Offline: the gate is a fake `fetch` that records every request, KV is a `Map` that can be made to fail. They cover
each row of the table above, the cap of 3, 403/409/503/no answer recorded without a retry, an unreadable
`/sweep/last` or own log, and that `/log` and `/health` never show the token. Since 0.1.1 also: the `/history` check
of budget rows (today, earlier, 503, no answer, the cap of 8, not read when an `over MAX_PER_SWEEP` row is still
pending), the 2026-10-22 shape run through a fake gate that sorts and seats rows the way the gate does, and the gate
source check that `/history` counts nothing in `/usage`. Since 0.2.0: no cron in `wrangler.jsonc` and in the code,
only `SWEEP_ONLY_TOKEN` is sent (an operator `SWEEP_TOKEN` alone is no token), and `/health` names the token it uses.
