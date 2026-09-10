# hs-watchtower — the 番人's missing instrument

## What problem this solves
The daily guardian runs in an unattended cloud session where, most days:
- **WebFetch** is refused with `PROVENANCE_REQUIRED` (no approver present), and
- **cloud-side curl** to `*.workers.dev` is 403'd by the proxy, and
- there is **no Mac bridge** attached.

So points **⑧ (outreach /status)**, **⑩ (ledger /health)**, **⑭ (billboards)** and **⑯ (/verify)**
could only ever be marked *"未確認 (unconfirmed)"*. hs-watchtower moves the measurement onto
**Cloudflare's own edge** — where a GET to the billboards just works — on a **Cron Trigger every
30 min**, and writes the verdict to **D1**. The guardian reads the latest verdict with the
Cloudflare MCP `d1_database_query`, a channel that is alive in scheduled sessions **even when both
WebFetch and Apify are down** (the 2026-08-15 double-outage case).

Two independent read channels now exist, so the guardian is never blind again:
1. **Apify `web-fetch`** (proven working this run) — live external GET, no deploy needed.
2. **hs-watchtower → D1** (this package) — survives Apify/WebFetch outage, and is the only safe
   home for the **⑧ /status** probe because it needs the admin token (held as a Worker secret,
   never stored, never echoed).

## Laws it keeps
- **Read-only against production.** Every probe is a GET. The worker writes only its own D1.
- **No secret ever leaves the worker.** `OUTREACH_ADMIN_TOKEN` is a Worker secret used only to
  call `/status`; only non-secret numbers are stored (`sentTotal`, `sent_today`, `dry_run`,
  `paused`, `cap_today`, `bounces`). Every public body is scanned to assert the token never
  appears in it (`SECRET_LEAK:true` flags it as a first-class fault).
- **Honest instrument (第二の掟).** Each probe stores the raw `http_status` + the exact facts it
  checked + `measured_at`. An unreachable target is recorded `UNREACHABLE`, never silently green.
  The reader re-derives the verdict and rejects stale data (`stale:true` when >90 min old).
- **Cache-busted (第三の掟).** Internal fetches use `no-store` + `cf.cacheTtl:0` + a `cb` param.
- **go-live stays TOshi's call (T1).** The outreach probe records `dry_run` but never treats
  `dry_run=true` as a fault and never flips it.

## Deploy (run on TOshi's Mac — this session cannot deploy; Cloudflare MCP is read-only)
Put these files under `workers/hs-watchtower/` in the repo, then:

```sh
cd workers/hs-watchtower

# 1) create the D1 database, then paste the printed database_id into wrangler.jsonc
npx wrangler d1 create hs-watchtower

# 2) apply the schema to the REMOTE db
npx wrangler d1 execute hs-watchtower --remote --file=./schema.sql

# 3) (optional but recommended) secrets
npx wrangler secret put OUTREACH_ADMIN_TOKEN   # enables point ⑧; paste the hs-outreach ADMIN_TOKEN
npx wrangler secret put RUN_NOW_TOKEN          # optional; gates the /run-now test route

# 4) deploy (cron starts automatically)
npx wrangler deploy

# 5) seed one run now instead of waiting up to 30 min for cron
curl -s -H "X-Run-Now-Token: YOUR_RUN_NOW_TOKEN" "https://hs-watchtower.<your-subdomain>.workers.dev/run-now"
#   (omit ?token if you did not set RUN_NOW_TOKEN)

# 6) confirm
curl -s "https://hs-watchtower.<your-subdomain>.workers.dev/latest" | jq
```

Optionally bind a custom route (e.g. `watch.horizonshield.dev`) so `/latest` is reachable
by Apify/browser too.

## How the guardian reads it (add to the guardian's instrument list — v5.5)
Whenever the **Cloudflare Developer Platform** connector is connected, run:

```sql
SELECT run_id, measured_iso, overall, n_pass, n_total, summary
FROM runs ORDER BY measured_at DESC LIMIT 1;
```
via `mcp__Cloudflare_Developer_Platform__d1_database_query`
(`database` = the hs-watchtower D1 id, `sql` = the query above).

Then:
- Compute age from `measured_iso`. **If older than ~90 min, report "watchtower stale" — do NOT
  report the old verdict as current** (第二の掟).
- `overall=GREEN` with a fresh `measured_iso` ⇒ ⑧⑩⑭⑯ are **実測 (measured), green**.
- `overall=RED`/`DEGRADED` ⇒ read `summary.anomalies[]` and `summary.per_target` for which
  billboard failed and its `http_status`, and report it (T2; investigate before claiming a fault).
- For point ⑧, read `summary.outreach` (`dry_run`, `sentTotal`, `sent_today`, `paused`).

If the Cloudflare connector is NOT connected that run, fall back to **Apify `web-fetch`** against
the same URLs (see the guardian prompt v5.5 instrument note). Only if BOTH are unavailable is the
item written "未確認".
