# ops/status

Two small watches, run by GitHub Actions, written here so anyone can read them.

| File | Written by | How often |
|---|---|---|
| `STATUS.md` | `.github/workflows/status-probe.yml` | probe every hour, committed at most every 6 hours |
| `status.json` | same | same |
| `history.jsonl` | same | same |
| `BOTS.md` | `.github/workflows/bot-watch.yml` | once a day |

The tools and their offline tests are in `tools/status/`. The endpoints probed, and the one tool called on each, are in
`tools/status/endpoints.json`, with the file in this repository that shows each URL is ours.

## Endpoint status (STATUS.md, status.json, history.jsonl)

What is measured, once an hour, from one GitHub Actions hosted runner:

- MCP endpoints (`hs-mcp`, `ccdb`, `gate`, `jidec`, `yakumo-contractors`): `initialize` with protocol 2025-06-18, the
  `notifications/initialized` notification, `tools/list`, and one read only `tools/call`. JSON and SSE framed answers
  are both read, and an `mcp-session-id` is sent back when the server issues one.
- HTTP endpoints (`ledger`): one GET of a documented JSON path, checked for an expected field.
- Each step records ok, HTTP status, milliseconds until the whole answer was read, and for MCP the server name and
  version, tool count, and whether the call result had `isError`. Every request has a 20 second timeout.

How the numbers are made:

- Reach: the first step answered correctly. Call success: the `tools/call` (or the GET) returned a result without
  `isError`; a run where the endpoint was not reached counts as a failed call.
- P50 and P95 are nearest rank over the last 7 days of call latencies. A timeout counts as 20000 ms, so slow failures
  raise the percentile instead of disappearing; a connection error has no latency.
- `history.jsonl` keeps one line per run for 30 days. `status.json` carries `status_sha256`, the SHA-256 of its own
  canonical JSON (keys sorted, no spaces, the hash field left out), the same recipe as `ops/tsunagi/board.json`:

```
python3 -c "import json,hashlib;b=json.load(open('ops/status/status.json'));c=json.dumps({k:v for k,v in b.items() if k!='status_sha256'},ensure_ascii=False,sort_keys=True,separators=(',',':'));print(hashlib.sha256(c.encode()).hexdigest()==b['status_sha256'])"
```

Why commits are every 6 hours and not every hour: no other workflow here commits on every hourly run, and 24 commits a
day of numbers would bury the real history. The hourly rows are carried from run to run in a workflow artifact (kept
3 days) and committed when the committed `status.json` is 5.5 hours old or more. If that chain breaks, the rows of the
missing hours are absent, not invented.

What it does not establish:

- One vantage point. GitHub picks the runner and does not say where it is; it is usually in the United States. Users in
  Japan or elsewhere may see very different times. Outside indexes that probe from
  other places will not match these numbers.
- One sample per endpoint per hour. Outages shorter than an hour can be missed, and a single slow sample moves the
  24 hour figures a lot.
- It is not a user experience measure and does not check that answers are correct. Only the one tool named per
  endpoint is called.
- Scheduled runs can start late or be skipped by GitHub; a missing hour is a gap in the data, not an outage.
- The probe's calls show up in the servers' own usage counters where those exist (for example hs-mcp's
  `/.well-known/usage-stats.json` and the gate's request counts). The probe sends the user agent
  `horizon-shield-status-probe/0`.

## Scheduled workflows (BOTS.md)

Once a day, `tools/status/bot_watch.mjs` reads every workflow file with a `schedule`, works out the expected interval
from its cron lines (the longest gap between two scheduled times), and reads the 20 most recent runs of each workflow
through the GitHub REST API (all events, and scheduled runs only).

- OVERDUE: the last successful scheduled run is older than 2 expected intervals plus 3 hours.
- FAILING: the last 2 finished scheduled runs both failed. Cancelled and skipped runs are not counted.
- For the workflows `workers/hs-cron-dispatch` starts with `workflow_dispatch`, the dispatch runs count with the
  scheduled runs in both rules (2026-11-05). For those, a day (UTC, yesterday and today) with no successful run opens
  one issue (label `bot-watch`): when the day's last dispatch run and last scheduled run both failed, or when the
  Worker's public `GET /log?day=` says its last dispatch of the job failed (a dispatch that fails makes no run, so
  GitHub sends no mail). A later failure of the same day adds a comment. The Worker dispatches bot-watch at 06:17 UTC.
- UNKNOWN: the API could not be read for that workflow, or its cron could not be parsed.
- DISABLED: the workflow is turned off in GitHub. Listed, not counted as a problem.

The bot watch job commits `BOTS.md` first and then turns red when anything is OVERDUE, FAILING or UNKNOWN, so GitHub
notifies the owner.

The last column of `BOTS.md` is a hint: for workflows whose file sets `git config user.name` and runs `git add` on a
readable path, it shows the last commit by that bot to those paths. "quiet" there is not a failure, because many bots
commit only when something changed.

What it does not establish: a successful run means the job exited 0, not that it did useful work. Only the 20 most
recent runs are read. Workflows without a schedule are not listed.
