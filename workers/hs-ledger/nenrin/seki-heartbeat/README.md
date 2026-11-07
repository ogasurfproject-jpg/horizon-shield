# SEKI heartbeat

The first SEKI door stands in front of HORIZON SHIELD's own paid tool, hs-gateway `/report`, for the store
`hs-seki-demo`, under the demonstration contract `../musubi-v0/run0003/contract.json`. Principal, agent and door are all
The HORIZONs Co., Ltd., and the contract says so. A door exercised only on the day it was built proves little, so it is
exercised every day, and every day is settled.

| file | what it is |
|---|---|
| `heartbeat.py` | `run`: the agent's three calls of the day (report admitted, audit over its limit refused, compare prohibited refused), each with a fresh nonce; every record checked under the key `keys/seki-door.json` publishes and found on the ledger. `settle`: every earlier day whose ledger batch Bitcoin has confirmed, settled with settle v1.15 (v1.12 must agree on the verdict). `--selftest` runs offline |
| `runs/<day>/` (the UTC day the run is for: six hours before it started; until 2026-10-24 it was the date it started, see heartbeat.py responsible_day) | `RUN.json`, the signed requests, the door's records, the execution record; once settled, the anchored records, `settlement.json` and `SETTLED.json` (verdict, view, ledger entries, how to recompute) |
| `runs/README.md` | one line per day |
| `view-chunks/` | final Bitcoin headers from the contract's checkpoint, 1000 per file, written once and never rewritten; the whole view is checked under the contract's rules on every run |

The workflow is `.github/workflows/seki-heartbeat.yml`, daily at 21:17 UTC (GitHub starts scheduled runs hours late on
some days), so the records usually reach the ledger before its 00:30 UTC batch. It uses only the agent's key (an Actions secret) and the store's gateway token. The door's key
stays in Cloudflare. The pilot's tickets carry no monetary value.

Since 2026-11-07 every call also carries its payload as `seki.content`. Where the door's policy requires the content
check (FURUI) for `hs-seki-demo`, the door sends that content to its runner itself and the admission carries the
content block built from the runner's signed envelope; a caller cannot bring its own envelope. `heartbeat.py run` reads
the door's policy once from `GET /seki` before the calls and makes no call when it cannot. While the check is not
required the reasons must match exactly, as before. When it is required, the report must be admitted with
`within_grant` (and may add `content_off_topic`) and its record must name a checked content block
(`content.checked`, a 64 hex `content.check_sha256`); audit and compare must be refused with their own reason, and may
add only `content_` reasons. `RUN.json` says `door_furui_required` for the run and each call, and each call's
`content_check_sha256` when its record names one.

## The door's daily check call, through the whole chain (since 2026-11-03)

The chain has five names: the content check (FURUI) reads a request, the door (SEKI) admits it with a signed admission,
the contract and its settlement (MUSUBI) say whether what ran was within the grant, the public ledger (NENRIN) holds every
record and anchors it in Bitcoin, and the endpoint's Resume lists what is anchored. TOOSHI checks the chain every day, and
TSUGI draws outside witnesses by lot.

Once a day at 03:47 UTC the door sends one fixed request to its check store under the check contract
(`check-contract.json`, contract_sha256 `d8f28e81288f45d2fcc07f00532f19b67aeeb9b2873ee5a496cc88adb8e50580`): one action,
check, with an amount of 0. Its two keys are made from public labels (`keys/seki-check-principal.json`,
`keys/seki-check-agent.json`), so anyone can recompute them. `check_loop.py` carries that call through MUSUBI:

| step | where | by |
|---|---|---|
| the content check of the request | the runner's signed envelope, in the day's root on the ledger | the runner, at the call |
| the admission (version 0.4, admit, within_grant) | `https://ledger.horizonshield.dev/admission/<sha>` and the door's `/seki/record/<sha>` | the door, at the call |
| the contract on file | `https://agreement.horizonshield.dev/contract/d8f28e81...` | `check_loop.py file`, once |
| the execution record naming the admission | `https://agreement.horizonshield.dev/execution/<sha>` | `check_loop.py file`, the same day at 21:17 UTC |
| the settlement (settle v1.19, within_grant, final) | `check-runs/<day>/settlement.json` and `SETTLED.json` | `check_loop.py settle`, once Bitcoin has confirmed both records |

`check-runs/index.json` lists every day; TOOSHI reads it. A day filed and still unsettled 72 hours later fails the run.
Recompute a settled day from `check-runs/<day>/` as `SETTLED.json` says (`recompute`).

## The deviations of 2026-10-19 and 2026-10-20

2026-10-19 settled as `deviation` under the clause `admission_after_execution`, final, and 2026-10-20 will settle the
same way once entry 129 is confirmed (it cannot reach a block at or below 972237). The verdicts stand. The door did sign
each admission before the call ran (the admission names chain height 972086 on 10/19 and 972233 on 10/20, and the
execution record names the admission's sha256), but the settlement has to show the order through Bitcoin, and it
cannot: on both days the execution's batch reached Bitcoin before the admission's.

The two records go to two pools cut at two times. The ledger batches admissions at 00:30 UTC; the MUSUBI intake batches
executions at 00:45 UTC.

| day | calls | admission batch | execution batch | why |
|---|---|---|---|---|
| 2026-10-19 | 01:14 UTC (the 21:17 run started four hours late) | entry 123, 10/20 00:30, block 972237 | entry 120, 10/19 11:38, block 972141 | the intake was cut by hand at 11:38 UTC to settle 10/13 to 10/18 sooner, while this day's admission still waited for 00:30 |
| 2026-10-20 | 00:30:1x UTC (three hours late) | entry 129, 10/21 00:30 | entry 126, 10/20 00:45, block 972237 | the calls landed between the two cuts |

Since 2026-10-21 a run that starts between 00:20 and 00:55 UTC waits until 00:55 before the calls (`window_wait`,
self test [10]), and the intake is not cut by hand while an admission of the same day waits for the ledger's batch: cut
the ledger's pool first, or not at all.

## Recompute a settled day

From `runs/<date>/`, with Python 3 and `cryptography`:

    python3 ../../../musubi-v0/header_view_fetch.py --contract ../../../musubi-v0/run0003/contract.json --out view.json --to <view.to in SETTLED.json>
    python3 ../../../musubi-v0/settle_v1_15.py --settle ../../../musubi-v0/run0003/contract.json \
      --event execution_report.anchored.json \
      --admission admission_report.anchored.json --admission admission_audit.anchored.json --admission admission_compare.anchored.json \
      --relying-key shield.the-horizons-innovation.com=<public_key_ed25519_b64 from keys/seki-door.json> \
      --view view.json --out /tmp/settlement.json
    shasum -a 256 /tmp/settlement.json

The hash must equal `settlement_sha256` in `SETTLED.json`. Each anchored record's anchor can be checked on its own with
`../../../musubi-v0/anchor_compose.py` against the ledger entry named in `SETTLED.json` (`/ledger/<n>?format=raw` and
`/ledger/<n>/ots`).

## What this does not establish

That anyone outside uses the door. It is our own door, our own agent and our own contract, exercised on a schedule.
What it does establish is narrower and checkable: on each day listed, the door gave these answers to these signed
requests, the answers were on the public ledger before Bitcoin confirmed them, and the settlement recomputes.
