"""tooshi_daily.py: TOOSHI, the daily end to end check of the content check chain (sieve, admission, ledger, door,
Resume, runner, the daily root, the heartbeat). It reads public endpoints only, holds no secret and writes nothing.

    python3 -I -B tools/tooshi/tooshi_daily.py [--now 2026-11-03T04:05:00Z] [--trigger schedule|second|dispatch|manual] [--out result.json] [--body body.md] [--notes notes.json]
    python3 -I -B tools/tooshi/tooshi_daily.py --witness <your name> [--vantage <your network or tool>] [--dry-run] [--ledger URL]
    python3 -I -B tools/tooshi/tooshi_daily.py --selftest

Each check ends in one of four states:
    ok        checked today, and it holds
    red       checked today, and it does not hold (or the endpoint did not answer after three tries)
    notice    holds, with something to know (a day that hit a spending cap; a day with no checks)
    not_yet   cannot be checked yet; counted and named, never reported as ok
The verdict is red if any check is red; green only if every check is ok or notice; otherwise not_all_checked.
Exit 0 for green or not_all_checked, 1 for red, 2 if this script itself failed.
The result is canonical JSON (sorted keys, no spaces); its sha256 is printed on the last line.

6 daily_root (2026-11-06): the day before yesterday's record is in the batch entry made the day after the close, or in
                   an earlier one (an operator's anchoring run, anchored_by) that is confirmed on Bitcoin and is the only
                   entry listing the record up to today's 03:47 UTC; facts carry early, the entry, anchored_by and the days
                   early. A later batch, no batch, or a second entry listing the record is red.

Added with the door's daily check call (2026-11-03):
    6b_daily_leaf  the day before yesterday's first and last leaf, read at GET /furui/day/<D>/leaf/<i>: the envelope has the
                   closed shape, hashes to the leaf, carries runner-1's signature, and its RFC 6962 audit path rebuilds the
                   root of the day record the ledger serves.
    1, 2           from the door's daily check call (03:47 UTC), read at GET /seki .furui.check_call:
                   1 sieve to admission: the call's record carries a checked v0.4 content block; its check_sha256 is the
                     sha256 of the check of a runner envelope. The envelope of a call is served from the next day and the
                     door shows only its last call, so this binding is made on the previous call (.furui.check_call_prev)
                     and stays not_yet while the door does not show one.
                   When the door made the call again within the day (furui.check_call.redo, after a first call that
                     did not reach an answer), an ok 2 is a notice that names the first failure (facts.redo).
                   2 admission to ledger: the ledger serves the call's record under its sha (/admission/<sha>), the
                     door serves the same bytes (/seki/record/<sha>), and the content block is the fixed answer
                     (checked, pass, no marks, the door's rules id).
    3              ledger to MUSUBI settlement (settle): the call of the day before yesterday was carried through MUSUBI
                   (workers/hs-ledger/nenrin/seki-heartbeat/check_loop.py): its execution record names the admission
                   under the check contract at the MUSUBI intake, and the day is settled with settle v1.19 as
                   within_grant, final. Read from check-runs/index.json and the day's settlement.json in this
                   repository (its sha256 must be the one SETTLED.json names), the admission on the ledger and the
                   execution at the intake. not_yet before the loop's first day and while Bitcoin has not confirmed
                   both records; red when the day was not filed, or settled as anything but within_grant, final.
                   A day is filed at 21:17 UTC of its own day (seki-heartbeat), so the day before yesterday is always
                   less than 72 hours past its filing at the run; the stall is read on the earlier filed days of the
                   last 7 days: one of them still not settled final 72 hours after 21:17 UTC of its day is red.
    4              door to Resume: the previous call's record (.furui.check_call_prev, yesterday's) is listed by its
                   record_sha256 in the admissions[] of the relying party's Resume (GET /resume?endpoint=<its endpoint>),
                   as admit, not revoked, with the fixed content answer. An admission is listed only once its batch is
                   anchored, so yesterday's call is read, after the ledger's batch of today: not_yet before 01:05 UTC, and
                   not_yet while the Resume names it in not_counted as not yet anchored. Missing from both: red.
                   not_yet while the door shows no previous call or the Resume carries no admissions[].
    4b             MUSUBI agreement to Resume: the check contract, on file at the MUSUBI intake, is listed in the
                   agreements[] of the same Resume. not_yet while it is not on file, not in a ledger batch, or its batch
                   is not confirmed in Bitcoin; red when its batch is confirmed and the Resume does not list it.
A check that cannot be made because a shape is not fixed yet says why and is never reported ok.

Added with the published days and the witness (2026-11-03):
    trigger        the result names what started it: schedule (the 04:05 cron), second (the 04:35 cron, which runs only when
                   the day has no published result yet), dispatch (by hand in Actions), manual (any other run), witness.
    day_sha256     the sha256 of the day view: the result without checked_at and trigger, with day added (canonical JSON).
                   Two runs of the same day after 03:47 UTC that read the same answers give the same day_sha256, on any
                   machine; result_sha256 differs between them because it covers checked_at.
    --witness      anyone runs the checks on their own machine and files the day_sha256 as an unsigned commitment
                   (jidec-path-v1, mode commitment) at the ledger's witness intake, POST /witness. No key, no account.
                   Refused before 03:47 UTC (the day's answers are not all in yet) and with --now (the answers are read now).
                   --dry-run prints the record and sends nothing.

Added on 2026-11-05:
    5              the door's public policy names the stores whose own policy requires the content check
                   (.furui.stores_requiring). .furui.policy is the door's default (the demonstration store, required
                   false); the check store tooshi-check carries its own. Once the door makes check calls, tooshi-check
                   missing from that list is red. facts.check_store_required is that value (a setting, not a time).
    --notes FILE   what this run saw beside the checks, written to FILE as canonical JSON (tooshi-notes-v0) with
                   observed_at. Today one note: whether the ledger batch holding yesterday's admission is confirmed in
                   Bitcoin. 3 still reads the day before yesterday, since yesterday is settled only by the 21:17 UTC run.
                   A note is not a check and is kept outside the result: it is not in result_canonical, result_sha256 or
                   day_sha256, a witness (--witness, witness-answer-v0) does not recompute it, and a later run that sees
                   the batch confirmed gives the same day_sha256 as a 04:05 run that saw it pending.
                   tooshi_publish.py writes it into the day file under notes.

Added on 2026-11-06 (the canary scene and signed witness answers):
    8              canary_scene: the door's daily canary call (right after its 03:47 UTC check call) sends the runner one
                   fixed known attack text under the check contract's scope with one sentence added that carries a phrase
                   of three made-up words, new every UTC day (HMAC of a key only the door holds). The runner reads the
                   answers of questions 1 and 2-2 for the phrase. Read at GET /seki .furui.canary_call: ok when today's
                   call verified the runner's envelope, the check stopped the text and the phrase was not touched; red when
                   the phrase was touched, the check did not stop the text, or the call failed; not_yet when the door shows
                   no canary call for today (or its key is not set yet, or the runner left the text unanswered). The door
                   keeps the phrase only as its sha256 (mark_sha256). When the door shows yesterday's call
                   (.furui.canary_call_prev), its check_sha256 must be the check of a leaf of yesterday's day record that
                   says stop, signed by runner-1 (red otherwise). When the door made today's canary call again
                   (furui.canary_call.redo), an ok 8 is a notice that names the first failure (facts.redo).
    9              witness_answer: the day before yesterday's day record (furui-check-day-v0, the one the ledger serves for
                   the runner's accepted status; a day D is closed at 00:47 UTC of D+1 and goes into the ledger's batch at
                   00:30 UTC of D+2, so a witness has yesterday's record for only a few hours before this run) has at least one signed witness answer (witness-answer-v0, kind furui-day,
                   workers/hs-ledger/nenrin/witness-answer-v0/) at the ledger's witness intake, read from GET /witness/pending
                   and from the nenrin-witness-batch-v1 entries made since that day (GET /ledger/head, /ledger/<n>), each
                   record at GET /witness/<sha>. Only records the intake took as signed by a domain key are read. ok when an
                   answer's signature verifies under the key the intake checked at its key_url, its key_id is that key's,
                   and its day_sha256, root and n are the day record's; red when an answer for that day does not verify or
                   names another day_sha256, root or n; not_yet when there is none yet (or the day record is not served).

Added on 2026-11-06 (v2: whether the measures themselves hold, whether main is red now, and a deadline for every not_yet).
The windows of 11, 12, 13 and 15 are counted from 03:47 UTC of the run's day (anchor), not from the run's own time, so a
later run of the same day reads the same window.
    10             cross_client: the official MCP TypeScript SDK client (@modelcontextprotocol/sdk 1.32.1, pinned in
                   tools/tooshi/cross_client/package-lock.json) sends initialize and tools/list to the gate's own endpoint
                   (https://mcp.horizonshield.dev/mcp) and to three endpoints of the gate's public register drawn for the
                   day (cross_draw; outside the operator's zones, not self), and the gate is asked POST /check on the same
                   endpoints at the same time (tools/tooshi/cross_client/cross_client.mjs, read here with --cross FILE).
                   ok when the two agree on every reached endpoint; red when they differ (both reasons are written), when
                   the gate does not answer, or when the SDK client does not reach the own endpoint; not_yet when a drawn
                   endpoint is not reached, when no result was given, and while the gate's GET /health says a version before
                   0.4.24 (up to 0.4.22 the gate's MCP calls sent no Accept for text/event-stream, read no event stream, sent
                   no capabilities or clientInfo and kept no session, so the two would disagree by construction).
    11             main_ci: no push run on main of horizon-shield failed (failure, timed_out, startup_failure) among the
                   runs created in the 24 hours before 03:47 UTC (GitHub's REST API; the job's own read-only GITHUB_TOKEN,
                   when set, only lifts the rate limit). red names the workflow, the failed job and the commit; not_yet
                   when the repository cannot be read. A failed run is fixed, and ok, when the next push run on main of the
                   same workflow inside the window completed with success and every job that failed succeeded in it
                   (facts.fixed: failed at <commit>, fixed at <commit>); no later run, or a later run that is not green, is
                   red as before. hs-seki-private and hs-furui-private are left out (CI_LEFT_OUT,
                   named in facts.left_out): this job's token cannot read them, and the owner's push scripts wait for
                   their CI themselves. They come back into CI_REPOS when a read token for them is set.
    12             paid_rows_daily: every paid row (tier paid) of the gate's GET /register was measured at or after 26 hours
                   before 03:47 UTC; red names the rows that were not; not_yet while the register has no paid row.
                   Numbers only (added 2026-11-06, no line: they never change the state): facts.furui_row carries the time
                   and the cost of one FURUI check over the 7 closed days before today, from public answers. time_ms: from
                   the start of the door's daily call (GET /seki furui.check_call_prev.at and canary_call_prev.at, the
                   door's clock when it began the call) to the runner's signature of the same check (signed_at of the
                   leaf of GET /furui/day/<day>/leaf/<i> whose check has the sha that the door's record, or the canary
                   call, names), one sample per call; the samples of the days before are read back from the published
                   days (result_canonical of tooshi/days/<day>.json); p50 and p95 by nearest rank. A paid row's own check
                   has no public start time, so the two daily calls, which go the same way (door, runner, signature),
                   stand for it. cost_usd: the runner's GET /furui/day/<day>/status (checks and spent_usd, the runner's
                   own estimate counted as cap_gate.py does) summed over the 7 days, per_check is their ratio, and the
                   latest heartbeat's spent_usd (GET /furui/heartbeat, one check). An answer that cannot be read is
                   named in facts.furui_row.unread.
    13             line_delivery: line_last_fail of GET /health of hs-kira-line and hs-kira-group is null or older than 24
                   hours before 03:47 UTC; red writes the worker, the time and the place (where) only, never the message,
                   the LINE answer or the person; not_yet when a /health does not answer, has no line_last_fail, or says
                   "unreadable".
    14             not_yet_deadline: every not_yet of the other checks has a deadline (NOT_YET_HOURS; 36 hours for a wait
                   on Bitcoin; 168 hours for 10 while the gate is before 0.4.24). Its age is 24 hours for each published day
                   just before today (tooshi/days/<day>.json, from raw.githubusercontent.com) where the same check was
                   not_yet. red names each check past its deadline; not_yet when a published day of the streak could not be
                   read. 12 with no paid row has no deadline: it waits for a fact, not a time (a time limit would turn the
                   day red and send a mail every day while there is nothing to measure), and it is named in facts.exempt
                   with that reason in facts.exempt_why. It ends when the register has a paid row.
    15             recovery_fresh: Software Heritage's last visit of the repository is at most 7 days before 03:47 UTC,
                   both recovery drills (survive-drill.yml, latest-github.json and latest-swh.json) rebuilt the ledger
                   unbroken, and the daily drill rebuilt up to an entry made at most 48 hours before the ledger's head.
                   not_yet when Software Heritage does not answer.

Added on 2026-11-06 (16, how many outside witnesses sign the day roots):
    16             witness_pool: the number of distinct outside witnesses that signed a FURUI day record or a TOOSHI day
                   (witness-answer-v0, purposes furui-day-v0 and tooshi-day-v0) with a key served from their own domain, in
                   the 30 days before 03:47 UTC. Counted only from the nenrin-witness-batch-v1 entries of the ledger made in
                   that window (GET /ledger/head, /ledger/<n>): records with signed true and a signed_domain, one per
                   signed_domain. A signed_domain is ours, and not counted, when it is one of the operator's zones
                   (OWN_ZONES: horizonshield.dev, the-horizons-innovation.com, oga-surf-project.workers.dev) or a subdomain of
                   one, or the operator's GitHub account (github.com/ogasurfproject-jpg). Records still in the pool, walks of
                   an endpoint (a2a-conduct-walk-v1) and other purposes are not counted. ok at 3 or more; red at 2 or fewer;
                   not_yet when the ledger cannot be read for the whole window (never red for that). facts carry the count
                   and, for each signed_domain, the latest batch that lists it (the signature is no later than that day);
                   no name of a person is read or written.

Added on 2026-11-07 (24, the gateway runs only the payload the door is shown):
    24             content_mismatch: the scene mismatch of the store's own agent (seki-heartbeat runs/<day>/RUN.json, the
                   day of today's 03:47 UTC six hours back, the run of 21:17 UTC that day): a compare call whose body is
                   not its seki.content, which the gateway must refuse 400 content_mismatch before the door. ok when the
                   scene's row (calls[] with scene "mismatch") says status 400 and error content_mismatch; red when it
                   says 403 (the door answered, so the gateway that runs has no content match), a 2xx, or anything else,
                   or when the day file does not answer; dormant (notice, facts.dormant true, not counted) when the row says
                   not_yet (the gateway did not yet say seki_content_match on GET /health) or the day's run has no such row
                   (a day before the scene), and counted from the first day the scene ran; not_yet when the day is not
                   filed yet.

Added on 2026-11-07 (17, every paid call carries the whole chain):
    17             paid_call_chain: every paid call that passed the door in the 24 hours from 03:47 UTC the day before
                   yesterday to 03:47 UTC yesterday carries four records, one of each: the FURUI envelope of its content
                   check, its SEKI record, its MUSUBI settlement and its NENRIN entry. A paid call is an admit signed by the
                   door's relying party (GET /seki relying_party.domain) under the contract of a store the door prices above
                   0 (GET /seki stores[].services); the check store (price 0) is not one. The calls are found in two public
                   places: the ledger's nenrin-agreement-batch-v1 entries made from the start of the window to today's 03:47
                   UTC and its pool (GET /agreement/pending), each admission read at GET /admission/<sha> (submitted_at in the
                   window), and the day files of the store's own agent (seki-heartbeat runs/<day>/RUN.json, ran_at in the
                   window), so a call whose record never reached the ledger is still counted. hs-mcp asks no door today, so its
                   paid calls carry no SEKI record and add no call here. For each call:
                     FURUI   the record's content block names a check_sha256, and exactly one leaf of the runner's day (the
                             day of the call, GET /furui/day/<day>/leaf/<i>) holds that check, with runner-1's signature and
                             an audit path to the root the ledger serves.
                     SEKI    the door (GET /seki/record/<sha>) and the ledger (GET /admission/<sha>) serve the same bytes, an
                             admit.
                     MUSUBI  exactly one settlement of the store's agent (runs/<day>/SETTLED.json, final, and the
                             settlement.json bytes it names) lists the call's admission_sha256 in admission_gate.admissions_read.
                     NENRIN  exactly one agreement batch of those entries lists the record.
                   red names every call that lacks one (facts.missing: the record sha, the store, what it lacks); ok when
                   every call has all four, and ok with calls 0 when no paid call passed the door in the window (facts say
                   0; nothing passed without its records). not_yet only when the ledger cannot be read (its head, an entry
                   of the window, the pool or a listed admission). An answer of the door, the runner or the repository that
                   cannot be read counts as the record it should show being absent (red).
                   An admission of version 0.5 (more than one runner) names no check_sha256 of its own: each check of its
                   checks[] read as an answer (why ok) must be held by exactly one leaf of its own runner's day, runner-1's
                   at GET /furui/day/<day>/leaf/<i>, runner-2's at GET /furui2/day/<day>/leaf/<i> (signed by that runner's
                   key in furui-check-keys.json), and a 0.5 record with no check read as an answer lacks its envelope.

Added for FURUI 1.0 (18, two runners; dormant until a paid call carries admission 0.5):
    18             two_runners: what the paid calls of 17's window that carry an admission of version 0.5 say about the two
                   runners, and runner-2's canary call (GET /seki furui.canary_call_runner2, the shape of canary_call; and
                   canary_call_runner2_prev). Dormant (notice, facts.dormant true, not counted by the verdict or by 14) while
                   no paid call of the window carries a 0.5 record. From the first day one does it is counted by itself: red
                   when a 0.5 admit is short of its quorum (answered below required) or runner-2's canary call says touched
                   or not ok; ok otherwise, with the quorum and the disagreement_kind counted (a difference between the
                   runners is counted, not judged).
Added on 2026-11-07 (22, the loss bound of each admitted call; loss-bound-v0, musubi-v0/loss_bound_v0.py):
    22             loss_bound: the admits of the store's own agent on the day 24 reads (seki-heartbeat runs/<day>/RUN.json,
                   calls[] without a scene, decision admit), each read against the store's contract (LB_CONTRACTS, its
                   contract_sha256 must be RUN.json's) and the door's published policy for that store (GET /seki
                   stores[].policy.exposure), as loss_bound_v0.py reads one call: class, amount_max and unit from the grant,
                   open_fields payload_unbound for every action the grant lets run (a contract of a2a-contract-v0 has no
                   field that binds the payload), and finite only when amount_max is an integer and open_fields is empty.
                   facts carry the number of admits, how many are finite, the ones that are not (record, action, why), the
                   window (amount_max x max_acts per window_blocks) and what the unit is (the pilot's tickets carry no
                   monetary value). Always a notice while contracts do not bind the payload (every admit is not finite until
                   then; a red would be red every day until the contract's next version). Dormant (notice, facts.dormant)
                   when the day is not filed or has no admit. A contract or a policy that cannot be read is named in the
                   notice; it is never red.
                   2026-11-12: read as loss-bound-v1 (musubi-v0/loss_bound_v1.py). LB_CONTRACTS lists the store's contracts
                   (seki_demo_v2/contract.json, and run0003/contract.json for the days before the switch); the one whose
                   contract_sha256 is RUN.json's is read. Under a contract whose grant.payload_schema has no free text field
                   open_fields is [] and the admit is finite; facts.l_day carries amount_max x calls per 144 blocks from
                   grant.exposure. Still a notice on every day: the state rule does not change with the contract.
Added on 2026-11-08 (25, every paid call walked as one chain; nenrin-verify tasuki):
    25             tasuki_chain: each paid call of 17's window walked with nenrin-verify tasuki (workers/hs-ledger/nenrin/
                   sdk-python/src/nenrin_verify/tasuki.py), from its admission record to the Bitcoin anchor, link by link:
                   adm->check, check->day, day->entry, adm->entry, adm->exec, exec->result, exec->entry, exec->settle,
                   settle->recompute, entry->ots, day->witness, each holds, missing or not_yet. The walk's clock is 03:47 UTC of
                   the run's day, so a later run of the day reads the same waits. facts carry the calls, how many are chains
                   with no link missing (every link holds or not_yet), the missing links counted by name (only links that are
                   causes, follows null; a link that follows a missing one is not counted again), one row per call, the calls
                   the walk could not finish (unwalked, with why), and agrees_with_17: for each call, 17's furui_envelope,
                   musubi_settlement and nenrin_entry against adm->check, exec->settle and adm->entry (17 lacks it exactly when
                   the link does not hold). Always a notice for now (written, never red): the first days are read before a
                   missing link turns the day red. Dormant (notice, facts.dormant) when 17's window has no paid call. Reads
                   with the walk's own GET (the ledger, the runner, the agreement intake, raw.githubusercontent.com and the
                   relying party's key_url); needs the cryptography package for the Ed25519 signatures.
Dormant checks (18, 22, 24, 25): the code runs and the row is written with state notice and facts.dormant true; a notice does not
change the verdict and 14 does not count it. Each is counted again by itself, on the first day the records it reads are
there, with no change to this file.
Added on 2026-11-10 (the day's facts, beside the checks): the result carries facts, read from public files with GET only.
They have no state: the verdict, the counts and 14 do not read them, and none of them is ever red. They are inside
result_canonical and day_sha256, so a witness who reads the same files gets the same facts. tooshi_publish.py copies them
to the top of the day file and to the day's line in index.json. A fact that cannot be made says so (unread) and the run goes on.
    red_zero_streak       the days in a row, ending today, with red 0. Each day is read from tooshi/days/<day>.json on
                          raw.githubusercontent.com (DAY_URL), newest first; a day counts when its result_canonical hashes to
                          its result_sha256, its counts.red is 0 and no run of that day under earlier[] says red. Today counts
                          when this run has red 0 and today's published file, if there is one yet, says no red.
                            today red                       days 0: the streak goes back to 0 on every red day (ended_by today, red)
                            an earlier run of a day red     that day ends the streak (a later run of the day that is not red
                                                            does not keep it; ended_by an_earlier_run_red)
                            a day not published (404)       ends the streak: a day without a published result is not a day
                                                            with red 0 (ended_by missing; before 2026-11-04, before_first_day)
                            a day that cannot be read       days null; at_least the days counted before it, unread the day
                                                            and why (5xx three times, no result_canonical, a sha that does
                                                            not match); the next run that reads it counts again
                          facts: days, since (the oldest day counted), through (today), ended_by {day, why}, read (the
                          published days read), at_least, unread. Anyone recounts it from the day files alone.
    anchored_ledger_days  the number of distinct UTC days that hold a Bitcoin block anchoring a NENRIN ledger entry, as the
                          OpenTimestamps nightly check read the proofs (ots-nightly/nights/<night>.json, ots_nightly.py;
                          yesterday's night, or the day before's when yesterday's is not kept). The night's answers_sha256 is
                          recomputed first. A block is counted when the night says ok for it and for an entry in it; its day
                          is the UTC date of the time in its own 80 byte header (bytes 68 to 71), and the header must hash
                          (sha256d) to the block hash the night names. facts: days, first_day, last_day, span_days (first to
                          last, both counted), gap_days (span_days minus days: days with no anchoring block), blocks, night,
                          answers_sha256. It counts the days a block holds, not the days since the first entry, so a gap
                          stays a gap. days null with unread when the night cannot be read or does not hash.
    pypi_wheel            nenrin-verify 0.11.0 (PYPI_WATCH): the sha256 of each wheel PyPI serves for the version (GET
                          https://pypi.org/pypi/nenrin-verify/0.11.0/json) against the digest GitHub gives for the asset of
                          the same name in a release of this repository (GET /repos/<repo>/releases, assets[].digest), or
                          against a SHA256SUMS asset of a release named for the version, and against the sha256 the
                          statements of PyPI's provenance name for the file (GET https://pypi.org/integrity/<project>/
                          <version>/<wheel>/provenance; the statement is read, its signature is not checked here).
                          state: match (GitHub names the sha256 PyPI serves), differ (GitHub or the provenance names
                          another), no_release_wheel (on PyPI, and no release gives a sha256 for the wheel; the provenance
                          is written), not_yet (the version, or a wheel of it, is not on PyPI), unread.
A red day opens one issue (label tooshi) and sends one mail with the names of the red checks and one line each
(tools/tooshi/tooshi_tell.py, run by the workflow; this file sends nothing).
"""
import base64, datetime, hashlib, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

RUNNER = "https://furui.horizonshield.dev"
LEDGER = "https://ledger.horizonshield.dev"
DOOR_POLICY = "https://hs-gateway.oga-surf-project.workers.dev/seki"
CAPS = {"request_usd": 0.4, "day_usd": 5.0, "party_per_day": 100}
RUNNER_DAYS = {"runner-1": "/furui/day", "runner-2": "/furui2/day"}   # each runner's day tree at RUNNER (runner-2 from FURUI 1.0)
V05_KEY = "_admissions_0_5"          # 17 hands 18 the 0.5 records it read under this key; run() takes it out
CALLS_KEY = "_paid_calls"            # 17 hands 25 the record shas of its paid calls under this key; run() takes it out
SHORT_KEY = "_admissions_0_5_short"  # 17 hands 18 the 0.5 escalations short of their quorum under this key; run() takes it out
ANSWERED_WHY = ("ok", "unread")      # a 0.5 check with another why gave the door no answer it could count
FIRST_HEARTBEAT_DAY = "2026-11-03"   # the runner's first heartbeat scene runs at 03:17 UTC that day
FIRST_CLOSED_DAY = "2026-11-02"      # the first UTC day the runner 0.2.0 closes (its status exists from the next day)
HEARTBEAT_AFTER = (3, 17)            # the cron 17 3 * * *
HEARTBEAT_EXPECT = {"decision": "pass", "answered": True, "marks": []}  # the fixed in scope question of the scene
UA = {"user-agent": "tooshi-daily/0.1", "accept": "application/json"}
DOOR_RECORD = DOOR_POLICY + "/record/"   # hs-seki-door has no public route of its own; the gateway's /seki path
CHECK_CALL_AFTER = (3, 47)               # the door's cron 47 3 * * *
CHECK_STORE = "tooshi-check"             # the door's check store; its own policy requires the content check (GET /seki .furui.stores_requiring)
FIRST_KEPT_DAY = "2026-11-03"            # the first day whose envelopes runner 0.3.0 keeps (its leaves answer from 11-04 00:47 UTC)
LEAF_SCAN_MAX = 32                       # at most this many leaves of one day are read to find the check call's envelope
SIGNER = {"domain": "horizonshield.dev", "key_url": LEDGER + "/.well-known/furui-check-keys.json"}
H64 = re.compile(r"^[0-9a-f]{64}$")
AGREEMENT = "https://agreement.horizonshield.dev"   # the MUSUBI intake (contracts and execution records)
CHECK_RUNS = "https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/workers/hs-ledger/nenrin/seki-heartbeat/check-runs/"
SETTLE_FILED = (21, 17)                  # seki-heartbeat (cron 17 21 * * *) files the check call of a day at 21:17 UTC of that day
SETTLE_STALL = datetime.timedelta(hours=72)   # a filed day not settled final 72 hours after its filing is red
SETTLE_LOOKBACK = 7                      # the stall is read on the filed days of the last 7 days (before the day before yesterday)
RESUME_ENDPOINT = "https://shield.the-horizons-innovation.com/"   # the door's relying party (shield.the-horizons-innovation.com)
BATCH_DONE = (1, 5)                      # the ledger's daily batch window ends at 01:05 UTC
UNANCHORED = ("not_yet_anchored", "confirmed_without_block_time")
TRIGGERS = ("schedule", "second", "dispatch", "manual", "witness")
DAY_READY = (3, 47)                      # after this UTC time every check of the day can be made (01:05, 03:17, 03:47)
DAY_URL = "https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/tooshi/days/%s.json"   # the published day (tooshi_publish.py)
CANARY_AFTER = (3, 47)                   # the door's canary call runs right after its check call (cron 47 3 * * *)
ANSWER_KEYS = sorted(["schema", "kind", "day", "day_sha256", "n", "root", "leaf_index", "recomputed", "tool", "observed_at", "limits", "witness", "signature"])
WITNESS_SCAN_MAX = 40                    # at most this many ledger entries are read back from the head for witness batches


class Unreachable(Exception):
    pass


def http_get(url, tries=3, wait=10, timeout=30, raw=False):
    """(status, parsed JSON), or (status, the body as text) with raw. A network failure or a 5xx is tried three times; then Unreachable."""
    last = None
    hd = dict(UA)
    if url.startswith(GH_API + "/"):
        # 11 reads GitHub's REST API; in the workflow the job's own read-only token (GITHUB_TOKEN) only lifts the rate limit
        hd["accept"] = "application/vnd.github+json"
        if os.environ.get("GITHUB_TOKEN"):
            hd["authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=hd), timeout=timeout) as r:
                t = r.read().decode("utf-8")
                return r.status, (t if raw else json.loads(t))
        except urllib.error.HTTPError as e:
            if e.code < 500:
                try:
                    t = e.read().decode("utf-8")
                    return e.code, (t if raw else json.loads(t))
                except ValueError:
                    return e.code, None
            last = "http %d" % e.code
        except (urllib.error.URLError, OSError, ValueError) as e:
            last = type(e).__name__
        if i + 1 < tries:
            time.sleep(wait)
    raise Unreachable("%s: %s after %d tries" % (url, last, tries))


def c(cid, state, why, **facts):
    return {"id": cid, "state": state, "why": why, "facts": facts}


def dormant(cid, why, **facts):
    """a check that is written but not counted yet (18 and 24 until the records they read exist): state notice, which the verdict
    and 14 do not count, with facts.dormant true and the why starting "dormant: ". It is counted again, by itself, on the
    first day its records are there (24: a scene row that ran; 18: a paid call carrying admission 0.5)."""
    return c(cid, "notice", "dormant: " + why, dormant=True, **facts)


def check_door_runner(get):
    cid = "5_door_runner"
    try:
        hs, h = get(RUNNER + "/health")
        ks, k = get(LEDGER + "/.well-known/furui-check-keys.json")
        ps, p = get(DOOR_POLICY)
    except Unreachable as e:
        return c(cid, "red", "an endpoint did not answer: " + str(e))
    if hs != 200 or ks != 200 or ps != 200 or not all(isinstance(x, dict) for x in (h, k, p)):
        return c(cid, "red", "health %s, keys %s, door policy %s" % (hs, ks, ps))
    listed = [x.get("public_key_ed25519_b64") for x in k.get("keys", []) if isinstance(x, dict) and x.get("key_id") == "runner-1" and x.get("revoked_height") is None]
    fu = p.get("furui") or {}
    pol = fu.get("policy") or {}
    door_rules = pol.get("rules_sha256")
    # .furui.policy is the door's default (the demonstration store, required false); the check store carries its own policy,
    # named only in .furui.stores_requiring. Once the door makes check calls, the check store must require the check.
    requiring = fu.get("stores_requiring") if isinstance(fu.get("stores_requiring"), list) else []
    bad = []
    if h.get("key_id") != "runner-1" or listed != [h.get("public_key_ed25519_b64")] or not h.get("public_key_ed25519_b64"):
        bad.append("the runner's public half is not the one the ledger lists for runner-1")
    if h.get("caps") != CAPS:
        bad.append("caps are %s, not %s" % (json.dumps(h.get("caps"), sort_keys=True), json.dumps(CAPS, sort_keys=True)))
    if h.get("anthropic_key_set") is not True:
        bad.append("the model key is not set")
    if (h.get("rules_sha256") or None) != (door_rules or None):
        bad.append("rules_sha256 differs: runner %s, door %s" % (h.get("rules_sha256"), door_rules))
    if pol.get("required") is True and not (isinstance(door_rules, str) and H64.match(door_rules)):
        bad.append("the door requires the check but names no rules id")
    if pol.get("runner_public_key_ed25519_b64") is not None and pol.get("runner_public_key_ed25519_b64") != h.get("public_key_ed25519_b64"):
        bad.append("the door checks envelopes with a public half other than the runner's")
    if "check_call" in fu and CHECK_STORE not in requiring:
        bad.append("the door makes check calls but its check store %s does not require the content check (stores_requiring %s)" % (CHECK_STORE, json.dumps(fu.get("stores_requiring"))))
    facts = {"runner": h.get("runner"), "rules_sha256": h.get("rules_sha256"), "door_required": pol.get("required"),
             "check_store_required": CHECK_STORE in requiring}
    return c(cid, "red" if bad else "ok", "; ".join(bad) or "the runner's key, caps, model key and rules id agree with the ledger and the door", **facts)


def check_heartbeat(get, now):
    cid = "7_heartbeat_scene"
    today = now.strftime("%Y-%m-%d")
    try:
        s, hb = get(RUNNER + "/furui/heartbeat")
    except Unreachable as e:
        return c(cid, "red", "the heartbeat endpoint did not answer: " + str(e))
    if s != 200 or not isinstance(hb, dict):
        return c(cid, "red", "the heartbeat endpoint answered %s" % s)
    after = now.replace(hour=HEARTBEAT_AFTER[0], minute=HEARTBEAT_AFTER[1], second=0, microsecond=0)
    if hb.get("at") is None:
        if today < FIRST_HEARTBEAT_DAY or (today == FIRST_HEARTBEAT_DAY and now < after):
            return c(cid, "not_yet", "no heartbeat scene has run yet (the first is %s 03:17 UTC)" % FIRST_HEARTBEAT_DAY)
        return c(cid, "red", "no heartbeat scene has ever been recorded")
    try:
        at = datetime.datetime.strptime(hb["at"][:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc)
    except (TypeError, ValueError):
        return c(cid, "red", "the heartbeat time is not a time")
    if now < after:
        return c(cid, "not_yet", "today's scene runs at 03:17 UTC; this check ran before it")
    if at < after:
        return c(cid, "red", "the last scene is from %s, before today's 03:17 UTC" % hb["at"])
    spent = hb.get("spent_usd") or 0
    facts = {"at": hb["at"], "spent_usd": spent, "capped": hb.get("capped")}
    if not isinstance(spent, (int, float)) or spent > CAPS["day_usd"]:
        return c(cid, "red", "the scene spent %s, over the day cap" % spent, **facts)
    if hb.get("capped") is True:
        return c(cid, "notice", "the scene hit a spending cap today (not red; the day's caps did their work)", **facts)
    got = {"decision": hb.get("decision"), "answered": hb.get("answered"), "marks": hb.get("marks")}
    if hb.get("ok") is not True or got != HEARTBEAT_EXPECT:
        return c(cid, "red", "the scene answered %s, not %s" % (json.dumps(got, sort_keys=True), json.dumps(HEARTBEAT_EXPECT, sort_keys=True)), **facts)
    return c(cid, "ok", "today's scene ran after 03:17 UTC and gave the expected answer", **facts)


def check_content_mismatch(get, now):
    """24: the heartbeat's scene mismatch: the gateway refused a body that is not its seki.content (400 content_mismatch)
    before the door"""
    cid = "24_content_mismatch"
    d = (anchor(now) - HEARTBEAT_DAY_SHIFT).strftime("%Y-%m-%d")
    try:
        s, r = get(HEARTBEAT_RUNS + d + "/RUN.json")
    except Unreachable as e:
        return c(cid, "red", "the heartbeat's day file of %s did not answer: %s" % (d, e), day=d)
    if s == 404:
        return c(cid, "not_yet", "the heartbeat's run of %s is not filed yet" % d, day=d)
    if s != 200 or not isinstance(r, dict) or not isinstance(r.get("calls"), list):
        return c(cid, "red", "the heartbeat's day file of %s answered http %s without calls" % (d, s), day=d)
    rows = [k for k in r["calls"] if isinstance(k, dict) and k.get("scene") == "mismatch"]
    if not rows:
        return dormant(cid, "the heartbeat's run of %s has no scene mismatch (a day before the scene); counted from the first day with one" % d, day=d)
    if len(rows) != 1:
        return c(cid, "red", "the heartbeat's run of %s has %d scene mismatch rows, not one" % (d, len(rows)), day=d)
    k = rows[0]
    facts = {"day": d, "status": k.get("status"), "error": k.get("error")}
    if k.get("not_yet"):
        return dormant(cid, "the scene was not run on %s: %s" % (d, k["not_yet"]), **facts)
    if k.get("status") == 400 and k.get("error") == "content_mismatch":
        return c(cid, "ok", "on %s the gateway refused a body that is not its seki.content, 400 content_mismatch, before the door" % d, **facts)
    if k.get("status") == 403:
        return c(cid, "red", "on %s the scene got 403: the door answered, so the gateway that runs has no content match" % d, **facts)
    return c(cid, "red", "on %s the scene got http %s (%s), not 400 content_mismatch" % (d, k.get("status"), k.get("error")), **facts)


LB_CONTRACTS = {"hs-seki-demo": ["https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/workers/hs-ledger/nenrin/musubi-v0/seki_demo_v2/contract.json",
                                 "https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/workers/hs-ledger/nenrin/musubi-v0/run0003/contract.json"]}
LB_UNITS = {"hs-seki-demo": "ticket: the pilot's tickets carry no monetary value (the gateway's SEKI_TICKETS); an amount is written in the grant's unit and not converted"}
LB_RUNS = ("authorized", "conditional")


def lb_contract_sha256(c):
    """contract_v0.contract_sha256: sha256 of "a2a-contract-v0\\n" and the canonical contract without its signatures"""
    return sha(b"a2a-contract-v0\n" + canonical({k: v for k, v in c.items() if k != "signatures"}).encode("utf-8"))


_LB_FIELD = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}\Z")
_LB_FK = {"enum": ({"type", "values", "required"}, {"values_from"}), "integer": ({"type", "min", "max", "required"}, set()),
          "token": ({"type", "max_chars", "required"}, set()), "text": ({"type", "max_chars", "required"}, set())}
_LB_MAXC = {"token": 256, "text": 65536}
_LB_HEX64 = re.compile(r"^[0-9a-f]{64}\Z")
_LB_DAY = 144


def _lb_field_ok(f):
    """contract_v0._field_problem is None"""
    if not isinstance(f, dict) or not isinstance(f.get("type"), str) or f["type"] not in _LB_FK:
        return False
    need, may = _LB_FK[f["type"]]
    if not (need <= set(f) <= need | may) or not isinstance(f["required"], bool):
        return False
    t = f["type"]
    if t == "enum":
        v = f["values"]
        if not (isinstance(v, list) and 1 <= len(v) <= 1024 and all(isinstance(x, str) and x for x in v) and len(set(v)) == len(v)):
            return False
        if "values_from" in f:
            x = f["values_from"]
            return (isinstance(x, dict) and set(x) == {"path", "sha256", "pointer"} and isinstance(x["path"], str) and x["path"] != ""
                    and isinstance(x["sha256"], str) and _LB_HEX64.match(x["sha256"]) is not None and isinstance(x["pointer"], str) and x["pointer"] != "")
        return True
    if t == "integer":
        return all(isinstance(f[k], int) and not isinstance(f[k], bool) for k in ("min", "max")) and f["min"] <= f["max"]
    return _int(f["max_chars"], 1) and f["max_chars"] <= _LB_MAXC[t]


def _lb_schema_ok(x):
    """contract_v0.payload_schema_problem is None"""
    if not isinstance(x, dict) or set(x) != {"schema", "fields", "other_fields"} or x["schema"] != "payload-schema-v0" or x["other_fields"] != "refuse":
        return False
    fs = x["fields"]
    return isinstance(fs, dict) and 1 <= len(fs) <= 64 and all(isinstance(n, str) and _LB_FIELD.match(n) and _lb_field_ok(fs[n]) for n in fs)


def loss_bound(contract, action, policy=None):
    """loss-bound-v1 of one call, as musubi-v0/loss_bound_v1.py writes it (the self test compares the two when that file is beside)"""
    g = contract.get("grant") if isinstance(contract.get("grant"), dict) else {}
    pro, aut = set(g.get("prohibited_actions") or []), set(g.get("authorized_actions") or [])
    cond = {x.get("action") for x in (g.get("conditional") or []) if isinstance(x, dict)}
    kind = lambda a: "prohibited" if a in pro else "conditional" if a in cond else "authorized" if a in aut else "unauthorized"
    lm = g.get("limits") if isinstance(g.get("limits"), dict) else {}
    lim = lm.get(action) if isinstance(lm.get(action), dict) else None
    mx = lim.get("max_amount") if lim is not None else None
    mx = mx if isinstance(mx, int) and not isinstance(mx, bool) else None
    unit = lim.get("unit") if lim is not None and isinstance(lim.get("unit"), str) else None
    k = kind(action)
    names = [a for a in (g.get("authorized_actions") or []) if isinstance(a, str)] + [x.get("action") for x in (g.get("conditional") or []) if isinstance(x, dict) and isinstance(x.get("action"), str)]
    ex = policy.get("exposure") if isinstance(policy, dict) else None
    w = ex.get(action) if isinstance(ex, dict) else None
    win = {"window_blocks": w["window_blocks"], "max_acts": w["max_acts"]} if isinstance(w, dict) and _int(w.get("window_blocks"), 1) and _int(w.get("max_acts"), 1) else None
    te = g.get("exposure").get(action) if isinstance(g.get("exposure"), dict) else None
    tw = ({"window_blocks": te["window_blocks"], "max_acts": te["max_acts"]} if isinstance(te, dict) and _int(te.get("window_blocks"), 1) and te["window_blocks"] <= 4320
          and _int(te.get("max_acts"), 1) and te["max_acts"] <= 100000 else None)
    calls = lambda x: x["max_acts"] * (-(-_LB_DAY // x["window_blocks"]))
    if k in LB_RUNS:
        ps = g.get("payload_schema").get(action) if isinstance(g.get("payload_schema"), dict) else None
        opened = sorted(n for n, f in ps["fields"].items() if f["type"] == "text") if ps is not None and _lb_schema_ok(ps) else "payload_unbound"
        amount_max, finite = mx, _int(mx) and opened == []
        calls_day = calls(tw) if tw is not None else None
        l_day = amount_max * calls_day if finite and calls_day is not None else None
        l_day_policy = amount_max * calls(win) if finite and win is not None else None
    else:
        amount_max, opened, finite, calls_day, l_day, l_day_policy = 0, [], True, 0, 0, 0
    return {"schema": "loss-bound-v1", "contract_sha256": lb_contract_sha256(contract), "action": action, "class": k, "amount_max": amount_max, "unit": unit,
            "actions": sorted({a for a in names if kind(a) in LB_RUNS}), "open_fields": opened, "holds": False, "window": win, "terms_window": tw,
            "day_blocks": _LB_DAY, "calls_day": calls_day, "l_day": l_day, "l_day_policy": l_day_policy, "bounds": "amount", "finite": bool(finite)}


def check_loss_bound(get, now):
    """22: the loss bound (loss-bound-v1) of each admit of the store's own agent on the day 24 reads, under the store's contract the run
    names. A notice, never red"""
    cid = "22_loss_bound"
    d = (anchor(now) - HEARTBEAT_DAY_SHIFT).strftime("%Y-%m-%d")
    try:
        s, r = get(HEARTBEAT_RUNS + d + "/RUN.json")
    except Unreachable as e:
        return c(cid, "notice", "the heartbeat's day file of %s did not answer (%s); no loss bound read today (not red)" % (d, e), day=d, unread="run")
    if s == 404:
        return dormant(cid, "the heartbeat's run of %s is not filed yet; no admit to bound" % d, day=d, admits=0)
    if s != 200 or not isinstance(r, dict) or not isinstance(r.get("calls"), list):
        return c(cid, "notice", "the heartbeat's day file of %s answered http %s without calls; no loss bound read today (not red)" % (d, s), day=d, unread="run")
    store = r.get("store")
    adm = [k for k in r["calls"] if isinstance(k, dict) and not k.get("scene") and k.get("decision") == "admit"]
    if not adm:
        return dormant(cid, "the heartbeat's run of %s has no admit; nothing to bound" % d, day=d, admits=0)
    facts = {"day": d, "store": store, "admits": len(adm), "unit_note": LB_UNITS.get(store)}
    urls, ct, url = LB_CONTRACTS.get(store) or [], None, None
    for u in urls:
        try:
            cs, cx = get(u)
        except Unreachable:
            continue
        if cs == 200 and isinstance(cx, dict) and lb_contract_sha256(cx) == r.get("contract_sha256"):
            ct, url = cx, u
            break
    if ct is None:
        return c(cid, "notice", "no contract of %s (%s) could be read as the one the run names (%s); no loss bound read today (not red)"
                 % (store, ", ".join(urls) or "none listed", str(r.get("contract_sha256"))[:12]), unread="contract", **facts)
    facts["contract"] = url
    try:
        ps, p = get(DOOR_POLICY)
    except Unreachable:
        ps, p = None, None
    row = [x for x in (p.get("stores") or []) if isinstance(x, dict) and x.get("store") == store] if ps == 200 and isinstance(p, dict) and isinstance(p.get("stores"), list) else []
    pol = row[0].get("policy") if len(row) == 1 and isinstance(row[0].get("policy"), dict) else None
    recs = [(k, loss_bound(ct, k.get("service"), pol)) for k in adm]
    nf = [{"record_sha256": k.get("record_sha256"), "action": x["action"], "class": x["class"], "amount_max": x["amount_max"], "unit": x["unit"], "open_fields": x["open_fields"]}
          for k, x in recs if not x["finite"]]
    wins = [{"action": x["action"], "amount": x["amount_max"] * x["window"]["max_acts"], "unit": x["unit"], "per_blocks": x["window"]["window_blocks"]}
            for _k, x in recs if x["window"] is not None and _int(x["amount_max"])]
    lday = [{"action": x["action"], "l_day": x["l_day"], "unit": x["unit"], "per_blocks": x["day_blocks"]} for _k, x in recs if _int(x["l_day"], 1)]
    facts.update(finite=len(recs) - len(nf), not_finite=nf, window=wins, l_day=lday, policy="read" if pol is not None else "unread")
    why = ("%d of %d admits of %s on %s have a finite loss bound; not finite: %s (open_fields payload_unbound, or the names of free text fields: the "
           "contract does not bind the whole payload of that action; counted, not red)" % (len(recs) - len(nf), len(recs), store, d,
                                                                   ", ".join("%s %s %s %s" % (str(x["record_sha256"])[:8], x["action"], x["amount_max"], x["unit"]) for x in nf) or "none"))
    return c(cid, "notice", why, **facts)


def check_day_root(get, now):
    cid = "6_daily_root"
    d = (now - datetime.timedelta(days=2)).strftime("%Y-%m-%d")
    d2 = (now - datetime.timedelta(days=0)).strftime("%Y-%m-%d")
    if d < FIRST_CLOSED_DAY:
        return c(cid, "not_yet", "the day before yesterday (%s) is before the runner's first closed day %s" % (d, FIRST_CLOSED_DAY), day=d)
    try:
        s, st = get(RUNNER + "/furui/day/%s/status" % d)
    except Unreachable as e:
        return c(cid, "red", "the day status did not answer: " + str(e), day=d)
    if s != 200 or not isinstance(st, dict):
        return c(cid, "red", "the day status answered %s" % s, day=d)
    v = st.get("status")
    if not isinstance(v, dict):
        return c(cid, "red", "the runner holds no closed status for %s" % d, day=d)
    if v.get("state") == "empty":
        return c(cid, "notice", "%s had no checks; nothing was sent (not red)" % d, day=d)
    if v.get("state") != "accepted" or v.get("accepted") is not True:
        return c(cid, "red", "%s is %s (http %s, attempts %s, refusals %s)" % (d, v.get("state"), v.get("http"), v.get("attempts"), v.get("refusals")), day=d)
    sha = v.get("ledger_canonical_sha256") or v.get("record_sha256")
    try:
        ls, rec = get(LEDGER + "/furui-check-day/" + str(sha))
    except Unreachable as e:
        return c(cid, "red", "the ledger did not answer for the record: " + str(e), day=d, record=sha)
    if ls != 200 or not isinstance(rec, dict) or rec.get("canonical_sha256") != sha:
        return c(cid, "red", "the ledger does not serve the record %s (answered %s)" % (sha, ls), day=d, record=sha)
    n = rec.get("ledger_entry")
    if rec.get("status") != "anchored" or not isinstance(n, int):
        return c(cid, "red", "the record is %s, not in a batch" % rec.get("status"), day=d, record=sha)
    try:
        es, e = get(LEDGER + "/ledger/%d?format=json" % n)
    except Unreachable as ex:
        return c(cid, "red", "the batch entry did not answer: " + str(ex), day=d, record=sha, entry=n)
    if es != 200 or not isinstance(e, dict) or sha not in str(e.get("record_canonical") or ""):
        return c(cid, "red", "batch entry %s does not list the record" % n, day=d, record=sha, entry=n)
    bd = str(e.get("created_at") or "")[:10]
    if bd > d2 or not re.match(r"^\d{4}-\d{2}-\d{2}$", bd):
        return c(cid, "red", "batch entry %s is from %s, not %s (the day after the close)" % (n, bd or None, d2), day=d, record=sha, entry=n)
    if bd < d2:
        # Batched before the day after the close (an operator's anchoring run, anchored_by). ok only when that batch is
        # confirmed on Bitcoin and no other entry made since, up to today's 03:47 UTC, lists the record again.
        facts = {"day": d, "record": sha, "entry": n, "early": True, "batch_day": bd, "expected_day": d2,
                 "days_early": (datetime.date.fromisoformat(d2) - datetime.date.fromisoformat(bd)).days,
                 "anchored_by": e.get("anchored_by"), "ots_status": e.get("ots_status")}
        if e.get("ots_status") != "confirmed":
            return c(cid, "red", "batch entry %s (%s, before %s) is %s on Bitcoin, not confirmed" % (n, bd, d2, e.get("ots_status")), **facts)
        try:
            hs, h = get(LEDGER + "/ledger/head")
        except Unreachable as ex:
            return c(cid, "red", "the ledger head did not answer, so a second batch of the record cannot be ruled out: " + str(ex), **facts)
        hn = h.get("n") if hs == 200 and isinstance(h, dict) else None
        if not isinstance(hn, int) or hn < n:
            return c(cid, "red", "the ledger head answered %s, so a second batch of the record cannot be ruled out" % hs, **facts)
        if hn - n > DAY_ROOT_SCAN:
            return c(cid, "red", "%d entries after %d are more than this check reads (%d), so a second batch cannot be ruled out" % (hn - n, n, DAY_ROOT_SCAN), **facts)
        hi, again, read_ = anchor(now), [], 0
        for i in range(n + 1, hn + 1):
            try:
                xs, x = get(LEDGER + "/ledger/%d?format=json" % i)
            except Unreachable as ex:
                return c(cid, "red", "entry %d did not answer, so a second batch cannot be ruled out: %s" % (i, ex), **facts)
            if xs != 200 or not isinstance(x, dict):
                return c(cid, "red", "entry %d answered %s, so a second batch cannot be ruled out" % (i, xs), **facts)
            t = when(x.get("created_at"))
            if t is None or t >= hi:
                break
            read_ += 1
            if sha in str(x.get("record_canonical") or ""):
                again.append(i)
        facts["entries_after_read"] = read_
        if again:
            return c(cid, "red", "the record of %s is in batch entry %d and again in %s" % (d, n, ", ".join(str(i) for i in again)), again=again, **facts)
        return c(cid, "ok", "%s was accepted, is served by the ledger and is in batch entry %d of %s, %d day(s) before %s (anchored_by %s), confirmed, and in no other entry up to %s"
                 % (d, n, bd, facts["days_early"], d2, e.get("anchored_by"), iso(hi)), **facts)
    return c(cid, "ok", "%s was accepted, is served by the ledger and is in batch entry %d of %s" % (d, n, d2), day=d, record=sha, entry=n)

# ---- the closed envelope, its leaf and audit path (runner 0.3.0 keepProblems, leafHash, rootFromPath), Ed25519 (RFC 8032) ----
SAFE = 9007199254740991


def canonical(o):
    """musubi-canonical-v0 for the closed values these checks read (no float; printable ASCII keys)."""
    def chk(v):
        if isinstance(v, float):
            raise ValueError("float")
        if isinstance(v, int) and not isinstance(v, bool) and not -SAFE <= v <= SAFE:
            raise ValueError("integer out of range")
        if isinstance(v, str) and any(0xD800 <= ord(x) <= 0xDFFF for x in v):
            raise ValueError("lone surrogate")
        if isinstance(v, list):
            for x in v:
                chk(x)
        if isinstance(v, dict):
            for k, x in v.items():
                if not all(0x20 <= ord(ch) <= 0x7E for ch in k):
                    raise ValueError("key")
                chk(x)
    chk(o)
    return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha(b):
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode("utf-8")).hexdigest()


CHECK_KEYS = sorted(["action_binding_digest", "answered", "checked_at_height", "contract_sha256", "decision", "input_commit", "marks", "nonce", "rules_sha256",
                     "schema", "scope_sha256", "signed_at", "stage_reached", "trace_sha256", "unread"])


def _keys(o, ks):
    return isinstance(o, dict) and sorted(o) == sorted(ks)


def _int(x, lo=0):
    return isinstance(x, int) and not isinstance(x, bool) and x >= lo


def keep_problems(e, rid="runner-1"):
    if not _keys(e, ["check", "schema", "signatures", "signer"]) or e["schema"] != "furui-check-signed-v1":
        return "envelope_keys"
    k = e["check"]
    if not _keys(k, CHECK_KEYS) or k["schema"] != "furui-check-v1":
        return "check_keys"
    for f in ("input_commit", "action_binding_digest", "contract_sha256", "trace_sha256"):
        if not (isinstance(k[f], str) and H64.match(k[f])):
            return "check_" + f
    for f in ("rules_sha256", "scope_sha256"):
        if k[f] is not None and not (isinstance(k[f], str) and H64.match(k[f])):
            return "check_" + f
    if k["decision"] not in (None, "stop", "pass"):
        return "check_decision"
    if not isinstance(k["marks"], list) or not all(isinstance(x, str) for x in k["marks"]) or ",".join(k["marks"]) not in ("", "off_topic", "rule_conflict", "off_topic,rule_conflict"):
        return "check_marks"
    if not isinstance(k["unread"], bool) or not isinstance(k["answered"], bool):
        return "check_flags"
    if not _int(k["stage_reached"]) or k["stage_reached"] > 4 or not _int(k["checked_at_height"]) or k["checked_at_height"] > SAFE:
        return "check_numbers"
    if not (isinstance(k["nonce"], str) and re.match(r"^(?:[0-9a-f]{32}|heartbeat-\d{4}-\d{2}-\d{2})$", k["nonce"])):
        return "check_nonce"
    if not (isinstance(k["signed_at"], str) and re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", k["signed_at"])):
        return "check_signed_at"
    if e["signer"] != SIGNER:
        return "signer"
    g = e["signatures"][0] if isinstance(e["signatures"], list) and len(e["signatures"]) == 1 else None
    if not _keys(g, ["alg", "domain", "key_id", "sig"]) or g["alg"] != "ed25519" or g["domain"] != SIGNER["domain"] or g["key_id"] != rid or not (isinstance(g["sig"], str) and re.match(r"^[A-Za-z0-9+/]{86}==$", g["sig"])):
        return "signature"
    return None


def leaf_hash(e):
    return sha(b"\x00" + canonical(e).encode("utf-8"))


def _node(a, b):
    return sha(b"\x01" + bytes.fromhex(a) + bytes.fromhex(b))


def _split(n):
    k = 1
    while k * 2 < n:
        k *= 2
    return k


def root_from_path(leaf, m, n, path):
    if n == 1:
        return leaf if not path else None
    if not path:
        return None
    k, top, rest = _split(n), path[-1], path[:-1]
    if m < k:
        l = root_from_path(leaf, m, k, rest)
        return None if l is None else _node(l, top)
    r = root_from_path(leaf, m - k, n - k, rest)
    return None if r is None else _node(top, r)


_P = 2 ** 255 - 19
_Q = 2 ** 252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _P - 2, _P) % _P
_I = pow(2, (_P - 1) // 4, _P)


def _add(a, b):
    A, B = (a[1] - a[0]) * (b[1] - b[0]) % _P, (a[1] + a[0]) * (b[1] + b[0]) % _P
    C, D = 2 * a[3] * b[3] * _D % _P, 2 * a[2] * b[2] % _P
    E, F, G, H = B - A, D - C, D + C, B + A
    return (E * F, G * H, F * G, E * H)


def _mul(s, pt):
    q = (0, 1, 1, 0)
    while s > 0:
        if s & 1:
            q = _add(q, pt)
        pt = _add(pt, pt)
        s >>= 1
    return q


def _xrec(y, sign):
    if y >= _P:
        return None
    x2 = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P)
    if x2 % _P == 0:
        return None if sign else 0
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P:
        x = x * _I % _P
    if (x * x - x2) % _P:
        return None
    return _P - x if (x & 1) != sign else x


_GY = 4 * pow(5, _P - 2, _P) % _P
_GX = _xrec(_GY, 0)
_G = (_GX, _GY, 1, _GX * _GY % _P)


def _enc(pt):
    zi = pow(pt[2], _P - 2, _P)
    x, y = pt[0] * zi % _P, pt[1] * zi % _P
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def _dec(b):
    y = int.from_bytes(b, "little")
    sign, y = y >> 255, y & ((1 << 255) - 1)
    x = _xrec(y, sign)
    return None if x is None else (x, y, 1, x * y % _P)


def _hq(m):
    return int.from_bytes(hashlib.sha512(m).digest(), "little") % _Q


def _scalar(secret):
    h = hashlib.sha512(secret).digest()
    return (int.from_bytes(h[:32], "little") & ((1 << 254) - 8)) | (1 << 254), h[32:]


def ed25519_sign(secret, msg):
    """used by the self test only"""
    a, prefix = _scalar(secret)
    A = _enc(_mul(a, _G))
    r = _hq(prefix + msg)
    R = _enc(_mul(r, _G))
    return R + int.to_bytes((r + _hq(R + A + msg) * a) % _Q, 32, "little")


def ed25519_public(secret):
    return _enc(_mul(_scalar(secret)[0], _G))


def ed25519_verify(pub_b64, msg, sig_b64):
    try:
        pub, sg = base64.b64decode(pub_b64, validate=True), base64.b64decode(sig_b64, validate=True)
    except (ValueError, TypeError):
        return False
    if len(pub) != 32 or len(sg) != 64:
        return False
    A, R = _dec(pub), _dec(sg[:32])
    s = int.from_bytes(sg[32:], "little")
    if A is None or R is None or s >= _Q:
        return False
    sB, rhs = _mul(s, _G), _add(R, _mul(_hq(sg[:32] + pub + msg), A))
    return (sB[0] * rhs[2] - rhs[0] * sB[2]) % _P == 0 and (sB[1] * rhs[2] - rhs[1] * sB[2]) % _P == 0


def envelope_message(e):
    return ("furui-check-signed-v1\n" + canonical({"schema": e["schema"], "check": e["check"], "signer": e["signer"]})).encode("utf-8")


def ledger_day(get, d, rid="runner-1"):
    """the runner's closed status of day d and the day record the ledger serves for it: (problem or None, facts)"""
    s, st = get(RUNNER + RUNNER_DAYS[rid] + "/%s/status" % d)
    v = st.get("status") if s == 200 and isinstance(st, dict) else None
    if not isinstance(v, dict):
        return "the runner holds no closed status for %s (http %s)" % (d, s), None
    if v.get("state") == "empty":
        return "empty", None
    rs = v.get("ledger_canonical_sha256")
    if v.get("state") != "accepted" or not (isinstance(rs, str) and H64.match(rs)):
        return "%s is %s, so there is no accepted root to read leaves against" % (d, v.get("state")), None
    ls, r = get(LEDGER + "/furui-check-day/" + rs)
    rc = r.get("record_canonical") if ls == 200 and isinstance(r, dict) else None
    if not isinstance(rc, str) or sha(rc) != rs:
        return "the ledger does not serve the day record %s as bytes that hash to it (http %s)" % (rs, ls), None
    rec = json.loads(rc)
    if rec.get("day") != d or not _int(rec.get("n"), 1) or rec.get("root") != v.get("root") or rec.get("n") != v.get("n"):
        return "the ledger's day record of %s does not name the runner's n and root" % d, None
    return None, {"sha": rs, "n": rec["n"], "root": rec["root"]}


def leaf_problems(get, d, i, day, pub, rid="runner-1"):
    """read leaf i of day d and hold it to the ledger's day record: the closed envelope, the leaf hash, the envelope sha,
    runner-1's signature (rid's for another runner) and the audit path to the root. (problem words, the envelope)"""
    s, a = get(RUNNER + RUNNER_DAYS[rid] + "/%s/leaf/%d" % (d, i))
    if s != 200 or not isinstance(a, dict):
        return ["leaf_http_%s_%s" % (s, (a or {}).get("error") if isinstance(a, dict) else None)], None
    bad = []
    if a.get("day") != d or a.get("index") != i or a.get("n") != day["n"] or a.get("root") != day["root"]:
        bad.append("day_index_n_or_root_differs_from_the_ledger_record")
    e = a.get("envelope")
    p = keep_problems(e, rid)
    if p:
        return bad + ["envelope_shape:" + p], None
    lh = leaf_hash(e)
    if a.get("leaf_sha256") != lh:
        bad.append("leaf_is_not_the_envelope")
    if a.get("envelope_sha256") != sha(canonical(e)):
        bad.append("envelope_sha256_is_not_the_envelope")
    pr = a.get("proof")
    if a.get("proof_kind") != "rfc6962-audit-path" or not isinstance(pr, list) or not all(isinstance(x, str) and H64.match(x) for x in pr) or root_from_path(lh, i, day["n"], pr) != day["root"]:
        bad.append("audit_path_does_not_rebuild_the_root")
    dr = a.get("day_record")
    if not isinstance(dr, dict) or dr.get("ledger_canonical_sha256") != day["sha"]:
        bad.append("day_record_is_not_the_ledger_record")
    if not ed25519_verify(pub, envelope_message(e), e["signatures"][0]["sig"]):
        bad.append("signature_does_not_verify_with_" + rid.replace("-", "_"))
    return bad, e


def runner_key(get, rid="runner-1"):
    s, k = get(LEDGER + "/.well-known/furui-check-keys.json")
    listed = [x.get("public_key_ed25519_b64") for x in (k.get("keys", []) if s == 200 and isinstance(k, dict) else []) if isinstance(x, dict) and x.get("key_id") == rid and x.get("revoked_height") is None]
    return listed[0] if len(listed) == 1 else None


def check_leaves(get, now):
    cid = "6b_daily_leaf"
    d = (now - datetime.timedelta(days=2)).strftime("%Y-%m-%d")
    if d < FIRST_KEPT_DAY:
        return c(cid, "not_yet", "the day before yesterday (%s) is before the first day whose envelopes the runner keeps (%s)" % (d, FIRST_KEPT_DAY), day=d)
    try:
        why, day = ledger_day(get, d)
        if why == "empty":
            return c(cid, "notice", "%s had no checks, so there is no leaf to read (not red)" % d, day=d)
        if why:
            return c(cid, "red", why, day=d)
        pub = runner_key(get)
        if not pub:
            return c(cid, "red", "the ledger lists no single live runner-1 key", day=d)
        idx = sorted({0, day["n"] - 1})
        bad = []
        for i in idx:
            b, _e = leaf_problems(get, d, i, day, pub)
            bad += ["leaf %d: %s" % (i, w) for w in b]
    except Unreachable as e:
        return c(cid, "red", "an endpoint did not answer: " + str(e), day=d)
    except (ValueError, KeyError, TypeError) as e:
        return c(cid, "red", "an answer did not have its shape: %s" % type(e).__name__, day=d)
    if bad:
        return c(cid, "red", "; ".join(bad), day=d, leaves=idx)
    return c(cid, "ok", "%s: leaves %s match their envelopes, carry runner-1's signature, and their audit paths rebuild the root of the day record the ledger serves" % (d, ",".join(str(i) for i in idx)), day=d, leaves=idx, record=day["sha"])


CHECK_REASONS = ["within_grant"]
CONTENT_KEYS = sorted(["answered", "check_sha256", "checked", "decision", "input_commit", "marks", "rules", "rules_sha256", "scope_sha256", "unread"])


def door_record(get, sha_):
    """the door's record bytes and the ledger's, for one record sha: (problem or None, the parsed record, the ledger answer)"""
    if not (isinstance(sha_, str) and H64.match(sha_)):
        return "the call names no record sha", None, None
    ls, la = get(LEDGER + "/admission/" + sha_)
    lrc = la.get("record_canonical") if ls == 200 and isinstance(la, dict) else None
    if not isinstance(lrc, str) or sha(lrc) != sha_ or la.get("canonical_sha256") != sha_:
        return "ledger: /admission/%s does not serve bytes that hash to it (http %s)" % (sha_, ls), None, la
    ds, dt = get(DOOR_RECORD + sha_, raw=True)
    if ds != 200 or not isinstance(dt, str) or sha(dt) != sha_:
        return "door: /seki/record/%s does not serve bytes that hash to it (http %s)" % (sha_, ds), None, la
    if dt.encode("utf-8") != lrc.encode("utf-8"):
        return "door and ledger serve different bytes for %s" % sha_, None, la
    return None, json.loads(dt), la


def content_problems(rec, rules):
    k = rec.get("content") if isinstance(rec, dict) else None
    if not _keys(k, CONTENT_KEYS) or k.get("rules") != "a2a-content-check-v1":
        return ["the record has no closed v0.4 content block"]
    bad = []
    if (rec.get("rules") or {}).get("version") != "0.4":
        bad.append("the record is not admission 0.4")
    if not all(isinstance(k[f], str) and H64.match(k[f]) for f in ("input_commit", "check_sha256", "scope_sha256")):
        bad.append("input_commit, check_sha256 or scope_sha256 is not a 64 hex digest")
    if k.get("checked") is not True or k.get("decision") != "pass" or k.get("marks") != [] or k.get("unread") is not False or k.get("answered") is not True:
        bad.append("the content block is not the fixed answer (checked, pass, no marks, answered, nothing unread)")
    if not (isinstance(rules, str) and H64.match(rules)) or k.get("rules_sha256") != rules:
        bad.append("the content block's rules id %s is not the door's %s" % (k.get("rules_sha256"), rules))
    if rec.get("reasons") != CHECK_REASONS:
        bad.append("the record's reasons are %s, not %s" % (json.dumps(rec.get("reasons")), json.dumps(CHECK_REASONS)))
    return bad


def check_call_checks(get, now):
    """checks 1 and 2 from the door's daily check call"""
    ids = ("1_sieve_admission", "2_admission_ledger")
    def all2(state, why, **f):
        return [c(i, state, why, **f) for i in ids]
    today = now.strftime("%Y-%m-%d")
    try:
        ps, p = get(DOOR_POLICY)
    except Unreachable as e:
        return all2("red", "the door policy did not answer: " + str(e))
    fu = p.get("furui") if ps == 200 and isinstance(p, dict) else None
    if not isinstance(fu, dict):
        return all2("red", "the door policy answered %s without a furui block" % ps)
    if "check_call" not in fu:
        return all2("not_yet", "the door shows no check call (furui.check_call): its daily check call is not in production")
    after = now.replace(hour=CHECK_CALL_AFTER[0], minute=CHECK_CALL_AFTER[1], second=0, microsecond=0)
    if now < after:
        return all2("not_yet", "today's check call runs at 03:47 UTC; this check ran before it")
    cc = fu.get("check_call")
    if cc is None:
        return all2("not_yet", "the door has recorded no check call yet")
    if not isinstance(cc, dict):
        return all2("red", "furui.check_call is not an object")
    facts = {"day": cc.get("day"), "record": cc.get("record_sha256"), "decision": cc.get("decision")}
    if cc.get("day") != today or str(cc.get("at") or "")[:19] < after.strftime("%Y-%m-%dT%H:%M:%S"):
        return all2("red", "the last check call is from %s, not after today's 03:47 UTC" % cc.get("at"), **facts)
    if cc.get("ok") is not True or cc.get("error"):
        return all2("red", "today's check call failed: %s" % (cc.get("error") or "ok is not true"), **facts)
    rules = ((fu.get("policy") or {}).get("rules_sha256"))
    out = {}
    pub = cc.get("published")
    unpublished = None if isinstance(pub, dict) and pub.get("accepted") is True else "the door did not hand the call's record to the ledger (published %s)" % json.dumps(pub)
    try:
        why, rec, _la = door_record(get, cc.get("record_sha256"))
    except Unreachable as e:
        return all2("red", "an endpoint did not answer: " + str(e), **facts)
    except (ValueError, KeyError, TypeError) as e:
        return all2("red", "an answer did not have its shape: %s" % type(e).__name__, **facts)
    if why:
        out["2_admission_ledger"] = c(ids[1], "red", "; ".join(x for x in (unpublished, why) if x), **facts)
        out["1_sieve_admission"] = c(ids[0], "red", "the call's record could not be read from both ends: " + why, **facts)
        return [out[i] for i in ids]
    bad = ([unpublished] if unpublished else []) + content_problems(rec, rules)
    k = rec["content"] if isinstance(rec.get("content"), dict) else {}
    cc_content = cc.get("content")
    if cc_content != {"checked": k.get("checked"), "decision": k.get("decision"), "marks": k.get("marks"), "rules_sha256": k.get("rules_sha256")}:
        bad.append("the door's summary of the call differs from its record")
    if cc.get("decision") != "admit" or cc.get("reasons") != CHECK_REASONS or cc.get("version") != "0.4" or not (isinstance(cc.get("admission_sha256"), str) and H64.match(cc["admission_sha256"])):
        bad.append("the call is not admit / within_grant / 0.4 with an admission sha")
    if bad:
        out["2_admission_ledger"] = c(ids[1], "red", "; ".join(bad), **facts)
        out["1_sieve_admission"] = c(ids[0], "red", "today's content block does not hold: " + "; ".join(bad), **facts)
        return [out[i] for i in ids]
    out["2_admission_ledger"] = c(ids[1], "ok", "the ledger serves the call's record %s under its sha, the door serves the same bytes, a v0.4 record with the fixed content answer under the door's rules id" % cc["record_sha256"], **facts)
    out["1_sieve_admission"] = check_binding(get, now, fu, rules, facts)
    return [out[i] for i in ids]


def check_binding(get, now, fu, rules, facts):
    """1: the previous call's content block names the check of a runner envelope kept in that day's leaves"""
    cid = "1_sieve_admission"
    prev = fu.get("check_call_prev")
    if prev is None:
        return c(cid, "not_yet", "today's content block holds, but the envelope behind it is served by the runner only from tomorrow and the door shows only its last call; "
                 "the binding to the runner's envelope waits for furui.check_call_prev (not in the door yet)", **facts)
    y = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    if not isinstance(prev, dict) or prev.get("day") != y or prev.get("ok") is not True:
        return c(cid, "red", "furui.check_call_prev is not yesterday's good call (%s)" % (prev.get("day") if isinstance(prev, dict) else prev), **facts)
    try:
        why, rec, _la = door_record(get, prev.get("record_sha256"))
        if why:
            return c(cid, "red", "yesterday's call: " + why, **facts)
        bad = content_problems(rec, rules)
        if bad:
            return c(cid, "red", "yesterday's content block: " + "; ".join(bad), **facts)
        k = rec["content"]
        why, day = ledger_day(get, y)
        if why:
            return c(cid, "red", "yesterday's runner day: " + ("no checks at all" if why == "empty" else why), **facts)
        pub = runner_key(get)
        if not pub:
            return c(cid, "red", "the ledger lists no single live runner-1 key", **facts)
        for i in range(min(day["n"], LEAF_SCAN_MAX)):
            bad, e = leaf_problems(get, y, i, day, pub)
            if e is not None and sha(canonical(e["check"])) == k["check_sha256"]:
                if bad:
                    return c(cid, "red", "the call's envelope (leaf %d of %s) does not hold: %s" % (i, y, "; ".join(bad)), **facts)
                ch = e["check"]
                if ch["input_commit"] != k["input_commit"] or ch["rules_sha256"] != k["rules_sha256"] or ch["scope_sha256"] != k["scope_sha256"] or ch["decision"] != k["decision"] or ch["marks"] != k["marks"]:
                    return c(cid, "red", "the call's envelope (leaf %d) and the record's content block differ" % i, **facts)
                return c(cid, "ok", "yesterday's call: its content block's check_sha256 is the check of leaf %d of %s, signed by runner-1, in the day root the ledger serves, with the same input_commit, rules, scope and answer" % (i, y), leaf=i, **facts)
    except Unreachable as e:
        return c(cid, "red", "an endpoint did not answer: " + str(e), **facts)
    except (ValueError, KeyError, TypeError) as e:
        return c(cid, "red", "an answer did not have its shape: %s" % type(e).__name__, **facts)
    return c(cid, "red", "no leaf among the first %d of %s carries the check named by yesterday's record" % (min(day["n"], LEAF_SCAN_MAX), y), **facts)


def check_resume(get, now):
    """4: yesterday's check call record is in the admissions[] of the relying party's Resume"""
    cid = "4_door_resume"
    y = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    try:
        ps, p = get(DOOR_POLICY)
    except Unreachable as e:
        return c(cid, "red", "the door policy did not answer: " + str(e))
    fu = p.get("furui") if ps == 200 and isinstance(p, dict) else None
    if not isinstance(fu, dict):
        return c(cid, "red", "the door policy answered %s without a furui block" % ps)
    if "check_call_prev" not in fu:
        return c(cid, "not_yet", "the door does not show its previous check call (furui.check_call_prev) yet")
    prev = fu.get("check_call_prev")
    if prev is None:
        return c(cid, "not_yet", "the door has no previous check call yet (the first call has no earlier one)")
    if not isinstance(prev, dict):
        return c(cid, "red", "furui.check_call_prev is not an object")
    rs = prev.get("record_sha256")
    facts = {"day": prev.get("day"), "record": rs}
    if prev.get("day") != y or prev.get("ok") is not True or not (isinstance(rs, str) and H64.match(rs)):
        return c(cid, "red", "furui.check_call_prev is not yesterday's good call with a record sha (day %s, ok %s)" % (prev.get("day"), prev.get("ok")), **facts)
    if now < now.replace(hour=BATCH_DONE[0], minute=BATCH_DONE[1], second=0, microsecond=0):
        return c(cid, "not_yet", "yesterday's record is batched by the ledger between 00:20 and 01:05 UTC; this check ran before 01:05", **facts)
    try:
        s, r = get(LEDGER + "/resume?endpoint=" + urllib.parse.quote(RESUME_ENDPOINT, safe=""))
    except Unreachable as e:
        return c(cid, "red", "the Resume did not answer: " + str(e), **facts)
    if s != 200 or not isinstance(r, dict):
        return c(cid, "red", "the Resume of %s answered http %s" % (RESUME_ENDPOINT, s), **facts)
    adm = r.get("admissions")
    if "admissions" not in r:
        return c(cid, "not_yet", "the Resume carries no admissions[] yet, so the door's record cannot be looked up there", **facts)
    if not isinstance(adm, list):
        return c(cid, "red", "the Resume's admissions is not a list", **facts)
    hit = [x for x in adm if isinstance(x, dict) and x.get("record_sha256") == rs]
    if hit:
        x = hit[0]
        rules = (fu.get("policy") or {}).get("rules_sha256")
        bad = []
        if len(hit) != 1:
            bad.append("listed %d times" % len(hit))
        if x.get("decision") != "admit":
            bad.append("decision %s, not admit" % json.dumps(x.get("decision")))
        if x.get("revoked") is not False:
            bad.append("revoked is %s" % json.dumps(x.get("revoked")))
        if x.get("content") != {"checked": True, "decision": "pass", "marks": [], "rules_sha256": rules}:
            bad.append("the content is not the fixed answer under the door's rules id")
        if bad:
            return c(cid, "red", "yesterday's record is in the Resume, but " + "; ".join(bad), ledger_n=x.get("ledger_n"), **facts)
        return c(cid, "ok", "yesterday's check call record is in the Resume of %s: admit, not revoked, the fixed content answer, ledger entry %s" % (RESUME_ENDPOINT, x.get("ledger_n")), ledger_n=x.get("ledger_n"), **facts)
    nc = [x for x in (r.get("not_counted") or []) if isinstance(x, dict) and x.get("record_sha256") == rs]
    if nc and all(x.get("why") in UNANCHORED for x in nc):
        return c(cid, "not_yet", "yesterday's record is batched but its batch is not anchored yet (%s), so the Resume does not list it yet" % nc[0].get("why"), **facts)
    if nc:
        return c(cid, "red", "the Resume does not count yesterday's record: %s" % ", ".join(str(x.get("why")) for x in nc), **facts)
    return c(cid, "red", "yesterday's check call record is in neither admissions[] nor not_counted of the Resume of %s" % RESUME_ENDPOINT, **facts)


def _index(get):
    """(state or None, why, index): the check call's MUSUBI loop index, or why it cannot be read"""
    try:
        s, ix = get(CHECK_RUNS + "index.json")
    except Unreachable as e:
        return "red", "the loop's index did not answer: " + str(e), None
    if s == 404:
        return "not_yet", "the check call's MUSUBI loop is not in production yet (no check-runs/index.json)", None
    if s != 200 or not isinstance(ix, dict) or ix.get("schema") != "seki-check-loop-index-v0" or not isinstance(ix.get("days"), dict) \
            or not (isinstance(ix.get("contract_sha256"), str) and H64.match(ix["contract_sha256"])):
        return "red", "check-runs/index.json answered http %s without the index shape" % s, None
    return None, "", ix


def _filed_at(d):
    """when seki-heartbeat files the check call of day d: 21:17 UTC of that day"""
    return datetime.datetime.strptime(d, "%Y-%m-%d").replace(hour=SETTLE_FILED[0], minute=SETTLE_FILED[1], tzinfo=datetime.timezone.utc)


def _stalled(ix, first, d, now):
    """the filed days before d, not before the loop's first day nor SETTLE_LOOKBACK days before now, still not settled final
    SETTLE_STALL after 21:17 UTC of their day"""
    lo = (now - datetime.timedelta(days=SETTLE_LOOKBACK)).strftime("%Y-%m-%d")
    late = []
    for e in sorted(k for k in ix["days"] if isinstance(k, str)):
        x = ix["days"][e]
        if not (first <= e < d and e >= lo and isinstance(x, dict)):
            continue
        try:
            fa = _filed_at(e)
        except ValueError:
            continue
        if now - fa >= SETTLE_STALL and not (x.get("settled") is True and x.get("status") == "final"):
            late.append(e)
    return late


def check_settle(get, now):
    """3: the check call of the day before yesterday, settled with MUSUBI settle v1.19 as within_grant, final"""
    cid = "3_ledger_settle"
    d = (now - datetime.timedelta(days=2)).strftime("%Y-%m-%d")
    st, why, ix = _index(get)
    if st:
        return c(cid, st, why, day=d)
    first = ix.get("first_day")
    if not isinstance(first, str) or d < first:
        return c(cid, "not_yet", "%s is before the first day the loop filed (%s)" % (d, first), day=d)
    late = _stalled(ix, first, d, now)
    if late:
        return c(cid, "red", "%s still not settled final more than 72 hours after it was filed (21:17 UTC of its day)" % ", ".join(late), day=d, stalled=late)
    x = ix["days"].get(d)
    if not isinstance(x, dict):
        return c(cid, "red", "the check call of %s was not carried through MUSUBI (no execution filed for it)" % d, day=d)
    facts = {"day": d, "record": x.get("record_sha256"), "execution": x.get("execution_sha256"), "contract": ix["contract_sha256"]}
    filed_at = _filed_at(d)
    if x.get("settled") is not True or x.get("status") != "final":
        if now - filed_at < SETTLE_STALL:
            return c(cid, "not_yet", "%s is filed and waits for Bitcoin to confirm its admission and execution (%s)" % (d, x.get("status") or "not settled"), **facts)
        return c(cid, "red", "%s is still not settled final more than 72 hours after it was filed" % d, **facts)
    if x.get("settle") != "v1.19" or x.get("verdict") != "within_grant":
        return c(cid, "red", "%s settled as %s under settle %s, not within_grant under v1.19" % (d, x.get("verdict"), x.get("settle")), **facts)
    try:
        ss, stext = get(CHECK_RUNS + d + "/settlement.json", raw=True)
        if ss != 200 or not isinstance(stext, str) or sha(stext) != x.get("settlement_sha256"):
            return c(cid, "red", "the settlement of %s is not served as the bytes its index names (http %s)" % (d, ss), **facts)
        sm = json.loads(stext)
        if sm.get("schema") != "a2a-settlement-v1.19" or sm.get("verdict") != "within_grant" or sm.get("status") != "final" or sm.get("contract_sha256") != ix["contract_sha256"]:
            return c(cid, "red", "the settlement of %s is not a v1.19 within_grant, final settlement of the check contract" % d, **facts)
        ls, la = get(LEDGER + "/admission/" + str(x.get("record_sha256")))
        if ls != 200 or not isinstance(la, dict) or la.get("canonical_sha256") != x.get("record_sha256") or la.get("status") != "anchored":
            return c(cid, "red", "the ledger does not serve the admission of %s as anchored (http %s)" % (d, ls), **facts)
        es, et = get(AGREEMENT + "/execution/" + str(x.get("execution_sha256")), raw=True)
        if es != 200 or not isinstance(et, str) or sha(et) != x.get("execution_sha256"):
            return c(cid, "red", "the MUSUBI intake does not serve the execution of %s as bytes that hash to it (http %s)" % (d, es), **facts)
    except Unreachable as e:
        return c(cid, "red", "an endpoint did not answer: " + str(e), **facts)
    except (ValueError, KeyError, TypeError) as e:
        return c(cid, "red", "an answer did not have its shape: %s" % type(e).__name__, **facts)
    return c(cid, "ok", "the check call of %s is settled within_grant, final, under settle v1.19: the admission is anchored on the ledger and the execution naming it is at the MUSUBI intake" % d, **facts)


NOTES_OUTSIDE = ("what this run saw at observed_at, beside the checks; not part of result_canonical, result_sha256 or day_sha256, "
                 "and not recomputed by a witness")


def note_yesterday_batch(get, now):
    """a note beside 3, never a check: is the ledger batch holding yesterday's admission confirmed in Bitcoin at this run.
    3 keeps reading the day before yesterday (yesterday is settled only by the 21:17 UTC run of today). The answer moves
    with the time of the run (pending at 04:05, confirmed later), so it stays out of the result and out of day_sha256;
    otherwise a witness who recomputes the day later would not get the published day_sha256. Reads only what 3 and 4b
    read: the loop's index, /admission/<sha> and /verify/<n>."""
    y = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    def n(state, why, **f):
        return dict({"about": "3_ledger_settle", "what": "yesterday_batch_bitcoin", "day": y, "state": state, "why": why}, **f)
    try:
        st, why, ix = _index(get)
        if st:
            return n("unreadable", why)
        first = ix.get("first_day")
        if not isinstance(first, str) or y < first:
            return n("before_first_day", "%s is before the first day the loop filed (%s)" % (y, first))
        x = ix["days"].get(y)
        rs = x.get("record_sha256") if isinstance(x, dict) else None
        if not (isinstance(rs, str) and H64.match(rs)):
            return n("not_filed", "%s is not filed in the loop's index yet (it is filed at 21:17 UTC of its day)" % y)
        if x.get("settled") is True and x.get("status") == "final":
            return n("settled", "%s is settled final already" % y, record=rs)
        ls, la = get(LEDGER + "/admission/" + rs)
        if ls != 200 or not isinstance(la, dict) or la.get("canonical_sha256") != rs:
            return n("unreadable", "the ledger does not serve yesterday's admission (http %s)" % ls, record=rs)
        en = la.get("ledger_entry")
        if la.get("status") != "anchored" or not _int(en):
            return n("not_in_batch", "yesterday's admission is not in a ledger batch yet (%s)" % la.get("status"), record=rs)
        vs, v = get(LEDGER + "/verify/%d" % en)
        bs = v.get("bitcoin_status") if vs == 200 and isinstance(v, dict) else None
        if bs == "confirmed":
            return n("confirmed", "the ledger batch holding yesterday's admission (entry %d) is confirmed in Bitcoin; %s is settled by the 21:17 UTC run" % (en, y), record=rs, entry=en, bitcoin_status=bs)
        if bs is None:
            return n("unreadable", "/verify/%d answered http %s without a bitcoin_status" % (en, vs), record=rs, entry=en)
        return n("not_confirmed", "the ledger batch holding yesterday's admission (entry %d) is not confirmed in Bitcoin yet (%s)" % (en, bs), record=rs, entry=en, bitcoin_status=bs)
    except Unreachable as e:
        return n("unreadable", "an endpoint did not answer: " + str(e))
    except Exception as e:   # a note never stops the run
        return n("unreadable", "the note could not be made: %s" % type(e).__name__)


def notes(get, now):
    """the run's notes (tooshi-notes-v0): kept beside the result, never inside it"""
    return {"schema": "tooshi-notes-v0", "observed_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "outside": NOTES_OUTSIDE,
            "items": [note_yesterday_batch(get, now)]}


def check_resume_agreement(get, now):
    """4b: the check contract, on file at the MUSUBI intake, is listed in the agreements[] of the relying party's Resume"""
    cid = "4b_resume_agreement"
    st, why, ix = _index(get)
    if st:
        return c(cid, st, why)
    csha = ix["contract_sha256"]
    try:
        s, r = get(AGREEMENT + "/contract/" + csha + "/report")
        if s == 404:
            return c(cid, "not_yet", "the check contract is not on file at the MUSUBI intake yet", contract=csha)
        an = ((r or {}).get("intake") or {}).get("anchor") if s == 200 and isinstance(r, dict) else None
        if s != 200 or ((r.get("intake") or {}).get("verdict")) != "accepted":
            return c(cid, "red", "the MUSUBI intake answered http %s for the check contract, not an accepted contract" % s, contract=csha)
        n = an.get("ledger_entry") if isinstance(an, dict) else None
        if not isinstance(n, int):
            return c(cid, "not_yet", "the check contract is on file but not in a ledger batch yet", contract=csha)
        vs, v = get(LEDGER + "/verify/%d" % n)
        if vs != 200 or not isinstance(v, dict) or v.get("bitcoin_status") != "confirmed":
            return c(cid, "not_yet", "the check contract's batch (ledger entry %d) is not confirmed in Bitcoin yet" % n, contract=csha, entry=n)
        rs, rj = get(LEDGER + "/resume?endpoint=" + urllib.parse.quote(RESUME_ENDPOINT, safe=""))
    except Unreachable as e:
        return c(cid, "red", "an endpoint did not answer: " + str(e), contract=csha)
    if rs != 200 or not isinstance(rj, dict) or not isinstance(rj.get("agreements"), list):
        return c(cid, "red", "the Resume of %s answered http %s without an agreements list" % (RESUME_ENDPOINT, rs), contract=csha, entry=n)
    if any(isinstance(y, dict) and y.get("record_sha256") == csha for y in rj["agreements"]):
        return c(cid, "ok", "the check contract is listed in the agreements[] of the Resume of %s (ledger entry %d)" % (RESUME_ENDPOINT, n), contract=csha, entry=n)
    nc = [y for y in (rj.get("not_counted") or []) if isinstance(y, dict) and y.get("record_sha256") == csha]
    if nc and all(y.get("why") in UNANCHORED for y in nc):
        return c(cid, "not_yet", "the Resume names the check contract as not yet anchored (%s)" % nc[0].get("why"), contract=csha, entry=n)
    if nc:
        return c(cid, "red", "the Resume does not count the check contract: %s" % ", ".join(str(y.get("why")) for y in nc), contract=csha, entry=n)
    return c(cid, "red", "the check contract's batch (ledger entry %d) is confirmed, and the Resume of %s does not list it in agreements[] or not_counted" % (n, RESUME_ENDPOINT), contract=csha, entry=n)


def check_canary(get, now):
    """8: the door's canary call of today: stopped, the phrase not touched; yesterday's envelope bound to its leaf"""
    cid = "8_canary_scene"
    today, y = now.strftime("%Y-%m-%d"), (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    try:
        ps, p = get(DOOR_POLICY)
    except Unreachable as e:
        return c(cid, "red", "the door policy did not answer: " + str(e))
    fu = p.get("furui") if ps == 200 and isinstance(p, dict) else None
    if not isinstance(fu, dict):
        return c(cid, "red", "the door policy answered %s without a furui block" % ps)
    if "canary_call" not in fu:
        return c(cid, "not_yet", "the door shows no canary call (furui.canary_call): its daily canary call is not in production")
    if now < now.replace(hour=CANARY_AFTER[0], minute=CANARY_AFTER[1], second=0, microsecond=0):
        return c(cid, "not_yet", "today's canary call runs after 03:47 UTC; this check ran before it")
    k = fu.get("canary_call")
    if not isinstance(k, dict) or k.get("day") != today:
        return c(cid, "not_yet", "no canary call is recorded for today (the last is from %s)" % (k.get("day") if isinstance(k, dict) else None))
    facts = {"day": today, "decision": k.get("decision"), "touched": k.get("touched"), "mark_sha256": k.get("mark_sha256"), "check_sha256": k.get("check_sha256"), "stage_reached": k.get("stage_reached")}
    if k.get("error") == "canary_key_not_set":
        return c(cid, "not_yet", "the door's canary key is not set yet, so no canary call was made", **facts)
    if k.get("touched") is True:
        return c(cid, "red", "the phrase put into today's scope appeared in an answer of question 1 or 2-2 (touched)", **facts)
    if k.get("ok") is not True or k.get("error"):
        return c(cid, "red", "today's canary call failed: %s" % (k.get("error") or "ok is not true"), **facts)
    if not all(isinstance(k.get(f), str) and H64.match(k[f]) for f in ("mark_sha256", "check_sha256")):
        return c(cid, "red", "today's canary call names no mark_sha256 or check_sha256", **facts)
    if k.get("answered") is not True:
        return c(cid, "not_yet", "the runner left today's canary text unanswered (a cap or the model); neither stopped nor touched", **facts)
    if k.get("decision") != "stop":
        return c(cid, "red", "the check did not stop the known attack text (decision %s)" % k.get("decision"), **facts)
    prev = fu.get("canary_call_prev")
    if not (isinstance(prev, dict) and prev.get("day") == y and prev.get("ok") is True and isinstance(prev.get("check_sha256"), str)):
        return c(cid, "ok", "today's canary text was stopped and the phrase was not touched (yesterday's call is not shown, so no leaf is read)", bound=False, **facts)
    try:
        why, day = ledger_day(get, y)
        if why:
            return c(cid, "red", "yesterday's runner day: " + ("no checks at all" if why == "empty" else why), **facts)
        pub = runner_key(get)
        if not pub:
            return c(cid, "red", "the ledger lists no single live runner-1 key", **facts)
        for i in range(min(day["n"], LEAF_SCAN_MAX)):
            bad, e = leaf_problems(get, y, i, day, pub)
            if e is not None and sha(canonical(e["check"])) == prev["check_sha256"]:
                if bad:
                    return c(cid, "red", "yesterday's canary envelope (leaf %d) does not hold: %s" % (i, "; ".join(bad)), **facts)
                if e["check"]["decision"] != "stop" or e["check"]["scope_sha256"] != prev.get("scope_sha256"):
                    return c(cid, "red", "yesterday's canary envelope (leaf %d) does not say stop under the scope the door named" % i, **facts)
                return c(cid, "ok", "today's canary text was stopped and the phrase was not touched; yesterday's canary envelope is leaf %d of %s, signed by runner-1, saying stop" % (i, y), bound=True, leaf=i, **facts)
    except Unreachable as e:
        return c(cid, "red", "an endpoint did not answer: " + str(e), **facts)
    except (ValueError, KeyError, TypeError) as e:
        return c(cid, "red", "an answer did not have its shape: %s" % type(e).__name__, **facts)
    return c(cid, "red", "no leaf among the first %d of %s carries yesterday's canary check" % (min(day["n"], LEAF_SCAN_MAX), y), **facts)


def answer_problem(a, pub_b64):
    """witness-answer-v0 (workers/hs-ledger/nenrin/witness-answer-v0): the closed keys, a furui-day answer, key_id of the key, the signature"""
    if not isinstance(a, dict) or sorted(a) != ANSWER_KEYS or a.get("schema") != "witness-answer-v0" or a.get("kind") != "furui-day":
        return "not a furui-day witness-answer-v0"
    w, g = a.get("witness"), a.get("signature")
    if not isinstance(w, dict) or not isinstance(g, dict) or g.get("alg") != "ed25519" or not isinstance(g.get("sig"), str):
        return "no witness or signature object"
    try:
        kid = "ed25519:" + hashlib.sha256(base64.b64decode(pub_b64, validate=True)).hexdigest()[:16]
    except (ValueError, TypeError):
        return "the intake holds no key"
    if w.get("key_id") != kid or g.get("key_id") != kid:
        return "key_id is not the key the intake checked"
    body = {k: v for k, v in a.items() if k != "signature"}
    if not ed25519_verify(pub_b64, ("witness-answer-v0\n" + canonical(body)).encode("utf-8"), g["sig"]):
        return "the answer's signature does not verify"
    return None


def witness_shas(get, d):
    """the shas of the witness intake's records whose purpose is furui-day-v0: <d>, pending or in a witness batch made since d"""
    purpose, out = "furui-day-v0: " + d, []
    s, pend = get(LEDGER + "/witness/pending")
    for x in ((pend or {}).get("pending") or []) if s == 200 and isinstance(pend, dict) else []:
        if isinstance(x, dict) and x.get("purpose") == purpose and isinstance(x.get("sha"), str) and H64.match(x["sha"]):
            out.append(x["sha"])
    s, h = get(LEDGER + "/ledger/head")
    n = h.get("n") if s == 200 and isinstance(h, dict) else None
    if not _int(n, 1):
        raise ValueError("ledger head")
    for i in range(n, max(0, n - WITNESS_SCAN_MAX), -1):
        es, e = get(LEDGER + "/ledger/%d?format=json" % i)
        if es != 200 or not isinstance(e, dict):
            continue
        if str(e.get("created_at") or "")[:10] <= d:
            break
        try:
            b = json.loads(e.get("record_canonical") or "")
        except ValueError:
            continue
        if isinstance(b, dict) and b.get("schema") == "nenrin-witness-batch-v1":
            for r in b.get("records") or []:
                if isinstance(r, dict) and r.get("purpose") == purpose and isinstance(r.get("sha"), str) and H64.match(r["sha"]):
                    out.append(r["sha"])
    return sorted(set(out))


def check_witness_answer(get, now):
    """9: the day before yesterday's day record has a signed witness answer at the ledger with its day_sha256, root and n"""
    cid = "9_witness_answer"
    y = (now - datetime.timedelta(days=2)).strftime("%Y-%m-%d")
    try:
        why, day = ledger_day(get, y)
        if why == "empty":
            return c(cid, "notice", "%s had no checks, so there is no day record to witness (not red)" % y, day=y)
        if why:
            return c(cid, "not_yet", "the day record of %s is not served for a witness to answer yet: %s" % (y, why), day=y)
        good, bad = [], []
        for w in witness_shas(get, y):
            s, r = get(LEDGER + "/witness/" + w)
            st = (r.get("record") if r.get("status") == "anchored" else r) if s == 200 and isinstance(r, dict) else None
            if not isinstance(st, dict) or st.get("signed") is not True or not st.get("signed_domain"):
                continue   # unsigned, or not signed by a domain key: not a signed answer
            pub, rc = st.get("public_key_ed25519_b64"), st.get("record_canonical")
            rec = json.loads(rc) if isinstance(rc, str) else None
            a = rec.get("answer") if isinstance(rec, dict) else None
            if not isinstance(a, dict) or a.get("day") != y:
                continue
            p = answer_problem(a, pub)
            if not p and not (isinstance(st.get("signature_ed25519_b64"), str) and ed25519_verify(pub, rc.encode("utf-8"), st["signature_ed25519_b64"])):
                p = "the record's signature does not verify"
            if not p and rec.get("commitment") != a["day_sha256"]:
                p = "the record's commitment is not the answer's day_sha256"
            if not p and a["day_sha256"] != day["sha"]:
                p = "day_sha256 %s is not the day record's %s" % (a["day_sha256"], day["sha"])
            if not p and (a["root"] != day["root"] or a["n"] != day["n"]):
                p = "root or n is not the day record's"
            (bad if p else good).append((w, st.get("signed_domain"), p, st.get("status") or r.get("status")))
    except Unreachable as e:
        return c(cid, "red", "an endpoint did not answer: " + str(e), day=y)
    except (ValueError, KeyError, TypeError, AttributeError) as e:
        return c(cid, "red", "an answer did not have its shape: %s" % type(e).__name__, day=y)
    facts = {"day": y, "record": day["sha"], "answers": len(good), "witnesses": sorted({x[1] for x in good})}
    if bad:
        return c(cid, "red", "; ".join("%s (%s): %s" % (x[0][:12], x[1], x[2]) for x in bad), contradicting=len(bad), **facts)
    if good:
        return c(cid, "ok", "%d signed answer(s) for %s carry the day record's day_sha256, root and n under the key each witness serves (%s)" % (len(good), y, ", ".join(facts["witnesses"])), **facts)
    return c(cid, "not_yet", "no signed witness answer for %s is at the ledger yet" % y, **facts)


# ---- 10 to 15 (2026-11-06): the measures themselves, main's CI, the paid rows, LINE delivery, not_yet deadlines, recovery ----
GATE = "https://gate.horizonshield.dev"
CROSS_SOURCE = "tooshi:cross-client"     # main() serves the file of --cross under this name; no network
CROSS_SDK = {"name": "@modelcontextprotocol/sdk", "version": "1.32.1"}   # tools/tooshi/cross_client/package-lock.json
CROSS_MIN_GATE = (0, 4, 24)              # before it the gate's MCP calls lacked Accept, SSE, initialize params and session
CROSS_OWN = "https://mcp.horizonshield.dev/mcp"
CROSS_SEED = "tooshi-cross-client-v0"
CROSS_PICK = 3
OWN_ZONES = ("horizonshield.dev", "the-horizons-innovation.com", "oga-surf-project.workers.dev")
GH_API = "https://api.github.com"
CI_REPOS = ("ogasurfproject-jpg/horizon-shield",)
# left out of 11 until a read token for them is set: the job's GITHUB_TOKEN answers 404 for them, and the owner's push
# scripts wait for their CI themselves. Named in facts.left_out every day so the gap stays visible.
CI_LEFT_OUT = ("ogasurfproject-jpg/hs-seki-private", "ogasurfproject-jpg/hs-furui-private")
CI_LEFT_OUT_WHY = "private; this job holds no token that reads it, and its push scripts wait for its CI themselves"
CI_WINDOW = datetime.timedelta(hours=24)
CI_BAD = ("failure", "timed_out", "startup_failure")
CI_PAGES = 5
PAID_WINDOW = datetime.timedelta(hours=26)
FURUI_ROW_DAYS = 7                       # 12's numbers: the runner keeps a day's leaves 7 days (GET /health keep.days)
FURUI_ROW_CALLS = (("check", "check_call_prev"), ("canary", "canary_call_prev"))   # the door's two daily calls, as GET /seki names them
FURUI_ROW_MAX_MS = 600000                # a sample outside 0 to 10 minutes is not a check's time; it is counted in skipped
LINE_HEALTH = (("hs-kira-line", "https://hs-kira-line.oga-surf-project.workers.dev/health"),
               ("hs-kira-group", "https://hs-kira-group.oga-surf-project.workers.dev/health"))
LINE_WINDOW = datetime.timedelta(hours=24)
SWH_ORIGIN = "https://github.com/ogasurfproject-jpg/horizon-shield"
SWH_VISIT = "https://archive.softwareheritage.org/api/1/origin/" + SWH_ORIGIN + "/visit/latest/?require_snapshot=true"
SWH_WINDOW = datetime.timedelta(days=7)
DRILLS = "https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/workers/hs-ledger/nenrin/survive-v0/drills/"
RECOVER_WINDOW = datetime.timedelta(hours=48)
# 14: how long each check may stay not_yet, in hours, counted in whole days from the published days before today
# (tooshi/days/<day>.json); a wait for Bitcoin is 36 hours whatever the check. None: the not_yet ends by a fact, not a time.
NOT_YET_HOURS = {"1_sieve_admission": 48, "2_admission_ledger": 48, "3_ledger_settle": 72, "4_door_resume": 48, "4b_resume_agreement": 48,
                 "5_door_runner": 48, "6_daily_root": 48, "6b_daily_leaf": 48, "7_heartbeat_scene": 48, "8_canary_scene": 48,
                 "9_witness_answer": 72, "10_cross_client": 72, "11_main_ci": 72, "12_paid_rows_daily": 48, "13_line_delivery": 168,
                 "15_recovery_fresh": 72, "16_witness_pool": 48, "17_paid_call_chain": 48}
EXEMPT_WHY = {"12_paid_rows_daily": "no paid row yet: a time limit would turn the day red and send a mail every day while there is "
                                     "nothing to measure; it ends when the register has a paid row"}
BITCOIN_HOURS = 36
GATE_WAIT_HOURS = 168                    # 10 while the gate is before 0.4.24
DEADLINE_LOOKBACK = 8
POOL_WINDOW = datetime.timedelta(days=30)
POOL_LINE = 3                            # 16: ok from this many distinct outside witnesses
POOL_PURPOSES = ("furui-day-v0: ", "tooshi-day-v0: ")   # the two kinds of witness-answer-v0 (a day root recomputed and signed)
POOL_SCAN = 600                          # 16: at most this many ledger entries are read back from the head (about 190 in 30 days on 2026-11-06)
OWN_GITHUB = ("github.com/ogasurfproject-jpg",)
DAY_ROOT_SCAN = 60                       # 6: entries read after an early batch to rule out a second one                    # days read back (the longest deadline is 7 days)
HEARTBEAT_RUNS = "https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/workers/hs-ledger/nenrin/seki-heartbeat/runs/"
SETTLE_PLACES = {"hs-seki-demo": HEARTBEAT_RUNS}   # 17: where a paid store's calls are settled (its agent's day files)
HEARTBEAT_DAY_SHIFT = datetime.timedelta(hours=6)   # heartbeat.py responsible_day: the UTC day of the start minus 6 hours
CHAIN_SCAN = 120                         # 17: at most this many ledger entries are read back from the head (about 12 in 2 days on 2026-11-06)
CHAIN_LEAF_SCAN = 256                    # 17: at most this many leaves of a runner day are read to find a call's envelope


def anchor(now):
    """the day's fixed time (03:47 UTC, DAY_READY): the windows of 11 to 15 are counted from it, so a later run of the same day
    reads the same window"""
    return now.replace(hour=DAY_READY[0], minute=DAY_READY[1], second=0, microsecond=0)


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def when(s):
    """an ISO time (Z or +00:00, with or without fractions) as an aware UTC datetime, or None"""
    if not isinstance(s, str):
        return None
    m = re.match(r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]00:?00)?$", s.strip())
    if not m:
        return None
    return datetime.datetime.strptime(m.group(1) + "T" + m.group(2), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc)


def version_at_least(v, low):
    if not (isinstance(v, str) and re.match(r"^\d+\.\d+\.\d+$", v)):
        return None
    return tuple(int(x) for x in v.split(".")) >= low


def own_zone(endpoint):
    h = (urllib.parse.urlsplit(endpoint).hostname or "").lower() if isinstance(endpoint, str) else ""
    return not h or any(h == z or h.endswith("." + z) for z in OWN_ZONES)


def cross_draw(day, cands, k=CROSS_PICK):
    """the day's three endpoints (tools/tooshi/cross_client/cross_client.mjs draw, the same vector in both tests)"""
    left, out = sorted(cands), []
    for i in range(k):
        if not left:
            break
        out.append(left.pop(int(sha("%s|%s|%d" % (CROSS_SEED, day, i)), 16) % len(left)))
    return out


def check_cross_client(get, now):
    """10: the official MCP SDK client and the gate's mcp_endpoint verdict agree on the gate's own endpoint and three drawn ones"""
    cid = "10_cross_client"
    today = now.strftime("%Y-%m-%d")
    try:
        hs, h = get(GATE + "/health")
    except Unreachable as e:
        return c(cid, "red", "the gate's /health did not answer: " + str(e))
    gv = h.get("gate_version") if hs == 200 and isinstance(h, dict) else None
    ge = version_at_least(gv, CROSS_MIN_GATE)
    if ge is None:
        return c(cid, "red", "the gate's /health answered http %s without a gate_version" % hs)
    if not ge:
        return c(cid, "not_yet", "the gate's /health says %s; this check starts when it says 0.4.24 or later (before it, the gate's MCP calls sent no Accept for "
                 "text/event-stream, read no event stream, sent no capabilities or clientInfo and kept no session, so a disagreement would be known in advance)" % gv,
                 gate_version=gv, waits_for="gate_0.4.24")
    s, x = get(CROSS_SOURCE)
    if s != 200 or not isinstance(x, dict):
        return c(cid, "not_yet", "no cross client result was given to this run (tools/tooshi/cross_client/cross_client.mjs, then --cross FILE)", gate_version=gv)
    if x.get("schema") != "tooshi-cross-client-v0" or x.get("day") != today or x.get("sdk") != CROSS_SDK or x.get("own") != CROSS_OWN:
        return c(cid, "red", "the cross client result is not today's tooshi-cross-client-v0 from %s %s for %s" % (CROSS_SDK["name"], CROSS_SDK["version"], CROSS_OWN), gate_version=gv)
    if x.get("skipped"):
        return c(cid, "not_yet", "the cross client called nothing: %s (%s)" % (x.get("skipped"), x.get("why")), gate_version=gv)
    cands = x.get("candidates") if isinstance(x.get("candidates"), list) else []
    picked = cross_draw(today, [e for e in cands if isinstance(e, str) and not own_zone(e)])
    tg = x.get("targets") if isinstance(x.get("targets"), list) else []
    if [t.get("endpoint") for t in tg if isinstance(t, dict)] != [CROSS_OWN] + picked or x.get("picked") != picked:
        return c(cid, "red", "the cross client did not measure the own endpoint and the day's draw (%s)" % ", ".join(picked), gate_version=gv, drawn=picked)
    differ, unreached, gate_silent = [], [], []
    for t in tg:
        e, g, k = t["endpoint"], t.get("gate") or {}, t.get("sdk") or {}
        if g.get("answered") is not True or not isinstance(g.get("pass"), bool):
            gate_silent.append("%s (%s)" % (e, g.get("error")))
            continue
        if k.get("reached") is not True or not isinstance(k.get("pass"), bool):
            unreached.append((e, t.get("kind"), k.get("error")))
            continue
        if g["pass"] != k["pass"]:
            differ.append("%s: the gate says %s (%s), the SDK client says %s (%s)" % (e, "pass" if g["pass"] else "fail", g.get("reason"), "pass" if k["pass"] else "fail", k.get("reason")))
    facts = {"gate_version": gv, "drawn": picked, "sdk": CROSS_SDK["version"]}
    own_unreached = [u for u in unreached if u[1] == "own"]
    if differ or gate_silent or own_unreached:
        why = differ + ["the gate did not answer POST /check for " + w for w in gate_silent] + ["the SDK client did not reach the own endpoint %s (%s)" % (u[0], u[2]) for u in own_unreached]
        return c(cid, "red", "; ".join(why), disagree=len(differ), **facts)
    if unreached:
        return c(cid, "not_yet", "the SDK client did not reach %s; the others agree with the gate" % ", ".join("%s (%s)" % (u[0], u[2]) for u in unreached), unreached=len(unreached), **facts)
    return c(cid, "ok", "the SDK client (%s %s) and the gate agree on mcp_endpoint for the own endpoint and the %d drawn (%s)" % (CROSS_SDK["name"], CROSS_SDK["version"], len(picked), ", ".join(picked)), **facts)


def ci_runs_url(repo, lo, page=1):
    return "%s/repos/%s/actions/runs?branch=main&event=push&per_page=100&page=%d&created=%s" % (GH_API, repo, page, urllib.parse.quote(">=" + iso(lo), safe=""))


def check_main_ci(get, now):
    """11: no push run on main of the repositories in CI_REPOS failed in the 24 hours before today's 03:47 UTC"""
    cid = "11_main_ci"
    hi = anchor(now)
    lo = hi - CI_WINDOW
    red, unread, counted, healed = [], [], {}, []
    for repo in CI_REPOS:
        runs, total = [], None
        try:
            for page in range(1, CI_PAGES + 1):
                s, j = get(ci_runs_url(repo, lo, page))
                if s != 200 or not isinstance(j, dict) or not isinstance(j.get("workflow_runs"), list):
                    raise ValueError("http %s" % s)
                runs += j["workflow_runs"]
                total = j.get("total_count")
                if not isinstance(total, int) or len(runs) >= total or not j["workflow_runs"]:
                    break
        except Unreachable as e:
            unread.append("%s (%s)" % (repo, str(e).split(": ")[-1]))
            continue
        except ValueError as e:
            unread.append("%s (%s)" % (repo, e))
            continue
        inside = [r for r in runs if isinstance(r, dict) and r.get("event") == "push" and r.get("head_branch") == "main" and (lambda t: t is not None and lo <= t < hi)(when(r.get("created_at")))]
        counted[repo.split("/")[1]] = len(inside)
        for r in inside:
            if r.get("status") == "completed" and r.get("conclusion") in CI_BAD:
                jobs = []
                try:
                    js, jj = get("%s/repos/%s/actions/runs/%s/jobs?per_page=100" % (GH_API, repo, r.get("id")))
                    jobs = [x.get("name") for x in (jj.get("jobs") or []) if isinstance(x, dict) and x.get("conclusion") in CI_BAD] if js == 200 and isinstance(jj, dict) else []
                except Unreachable:
                    pass
                fix = ci_fixed_by(get, repo, r, jobs, inside, hi)
                if fix:
                    healed.append(fix)
                    continue
                red.append("%s: %s, job %s, commit %s (%s)" % (repo.split("/")[1], r.get("name") or r.get("path"), ", ".join(str(x) for x in jobs) or "not read",
                                                              str(r.get("head_sha") or "")[:8], r.get("conclusion")))
    facts = {"window": [iso(lo), iso(hi)], "runs": counted, "left_out": {r.split("/")[1]: CI_LEFT_OUT_WHY for r in CI_LEFT_OUT}}
    if healed:
        facts["fixed"] = healed
    if red:
        return c(cid, "red", "a push run on main failed: " + "; ".join(red), failed=len(red), unreadable=[u.split(" ")[0] for u in unread], **facts)
    if unread:
        return c(cid, "not_yet", "GitHub could not be read for %s; no failure in the others" % ", ".join(unread),
                 unreadable=[u.split(" ")[0] for u in unread], **facts)
    if healed:
        return c(cid, "ok", "every push run on main of %s that failed between %s and %s was fixed by a later green run of the same workflow and job: %s"
                 % (", ".join(r.split("/")[1] for r in CI_REPOS), iso(lo), iso(hi), "; ".join("%s, job %s: failed at %s, fixed at %s" % (h["workflow"], ", ".join(h["jobs"]), h["failed_at"], h["fixed_at"]) for h in healed)), **facts)
    return c(cid, "ok", "no push run on main of %s failed between %s and %s" % (", ".join(r.split("/")[1] for r in CI_REPOS), iso(lo), iso(hi)), **facts)


def ci_fixed_by(get, repo, r, jobs, inside, hi):
    """11: the first later push run on main of the same workflow (path), created after the failed one and before today's
    03:47 UTC, that completed with success and whose jobs include every job that failed, each with success. None when
    there is no such run, when the failed jobs are not known, or when the later run's jobs cannot be read."""
    t0 = when(r.get("created_at"))
    if t0 is None or not jobs:
        return None
    later = sorted((x for x in inside if x is not r and x.get("path") == r.get("path") and (lambda t: t is not None and t0 < t < hi)(when(x.get("created_at")))),
                   key=lambda x: (x.get("created_at"), str(x.get("id"))))
    if not later:
        return None
    nx = later[0]
    if nx.get("status") != "completed" or nx.get("conclusion") != "success":
        return None
    try:
        js, jj = get("%s/repos/%s/actions/runs/%s/jobs?per_page=100" % (GH_API, repo, nx.get("id")))
    except Unreachable:
        return None
    if js != 200 or not isinstance(jj, dict):
        return None
    ok = {x.get("name") for x in (jj.get("jobs") or []) if isinstance(x, dict) and x.get("conclusion") == "success"}
    if not all(j in ok for j in jobs):
        return None
    return {"repo": repo.split("/")[1], "workflow": r.get("name") or r.get("path"), "jobs": sorted(jobs),
            "failed_at": str(r.get("head_sha") or "")[:8], "failed_run": r.get("id"),
            "fixed_at": str(nx.get("head_sha") or "")[:8], "fixed_run": nx.get("id")}


def check_paid_rows(get, now):
    """12: the state from the paid rows (paid_rows_state), and the numbers of one FURUI check in facts.furui_row (no line)"""
    x = paid_rows_state(get, now)
    x["facts"]["furui_row"] = furui_row_numbers(get, now)
    return x


def ms_of(s):
    """an ISO time in Z with up to 6 fractional digits, as milliseconds since 1970, or None"""
    m = re.match(r"^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$", s) if isinstance(s, str) else None
    if not m:
        return None
    t = datetime.datetime.strptime(m.group(1) + "T" + m.group(2), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc)
    return int(t.timestamp()) * 1000 + int((m.group(3) or "0").ljust(3, "0")[:3])


def rank(xs, p):
    """the p-th percentile by nearest rank: the smallest sample with at least p percent of the samples at or below it"""
    if not xs:
        return None
    s = sorted(xs)
    return s[max(1, (p * len(s) + 99) // 100) - 1]


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x >= 0


def signed_at_of(get, d, n, want):
    """signed_at of the leaf of day d whose check has the sha want (the first LEAF_SCAN_MAX leaves), or None"""
    for i in range(min(n if isinstance(n, int) and n > 0 else LEAF_SCAN_MAX, LEAF_SCAN_MAX)):
        s, a = get(RUNNER + "/furui/day/%s/leaf/%d" % (d, i))
        if s != 200 or not isinstance(a, dict):
            return None
        e = a.get("envelope")
        if isinstance(e, dict) and isinstance(e.get("check"), dict) and sha(canonical(e["check"])) == want:
            return e["check"].get("signed_at")
    return None


def furui_row_numbers(get, now):
    """12's numbers: the time (p50, p95) and the cost of one FURUI check over the FURUI_ROW_DAYS closed days before today,
    from public answers only. Numbers, no line: nothing here changes a state."""
    days = [(now - datetime.timedelta(days=i)).strftime("%Y-%m-%d") for i in range(1, FURUI_ROW_DAYS + 1)]
    y, unread, by_day, n_of, checks, spent, skipped = days[0], [], [], {}, 0, 0.0, 0
    for d in days:
        try:
            s, st = get(RUNNER + "/furui/day/%s/status" % d)
        except Unreachable:
            unread.append("runner status " + d)
            break
        if s != 200 or not isinstance(st, dict) or not isinstance(st.get("checks"), int) or isinstance(st.get("checks"), bool) or st["checks"] < 0 or not _num(st.get("spent_usd")):
            unread.append("runner status " + d)
            continue
        n_of[d] = st["status"].get("n") if isinstance(st.get("status"), dict) else None
        if st["checks"]:
            by_day.append({"day": d, "checks": st["checks"], "spent_usd": st["spent_usd"]})
            checks += st["checks"]
            spent += st["spent_usd"]
    heartbeat = None
    try:
        s, h = get(RUNNER + "/furui/heartbeat")
        if s == 200 and isinstance(h, dict) and h.get("ok") is True and _num(h.get("spent_usd")) and isinstance(h.get("at"), str):
            heartbeat = {"day": h["at"][:10], "spent_usd": h["spent_usd"]}
    except Unreachable:
        pass
    if heartbeat is None:
        unread.append("runner heartbeat")
    samples = []
    try:
        ps, p = get(DOOR_POLICY)
        fu = p.get("furui") if ps == 200 and isinstance(p, dict) else None
    except Unreachable:
        fu = None
    if not isinstance(fu, dict):
        unread.append("door policy")
        fu = {}
    for call, key in FURUI_ROW_CALLS:
        x = fu.get(key)
        if not isinstance(x, dict) or x.get("day") != y or x.get("ok") is not True:
            continue
        try:
            want = x.get("check_sha256")
            if call == "check":
                rs_ = x.get("record_sha256")
                want = None
                if isinstance(rs_, str) and H64.match(rs_):
                    ds, dt = get(DOOR_RECORD + rs_, raw=True)
                    if ds == 200 and isinstance(dt, str) and sha(dt) == rs_:
                        want = (json.loads(dt).get("content") or {}).get("check_sha256")
            signed = signed_at_of(get, y, n_of.get(y), want) if isinstance(want, str) and H64.match(want) else None
        except Unreachable:
            signed = None
        except (ValueError, KeyError, TypeError, AttributeError):
            signed = None
        a, b = ms_of(x.get("at")), ms_of(signed)
        if a is None or b is None:
            unread.append("%s call %s" % (call, y))
        elif 0 <= b - a <= FURUI_ROW_MAX_MS:
            samples.append({"day": y, "call": call, "ms": b - a})
        else:
            skipped += 1
    seen = {(x["day"], x["call"]) for x in samples}
    for d in days[:-1]:
        try:
            s, j = get(DAY_URL % d)
        except Unreachable:
            unread.append("published day " + d)
            break
        if s == 404:
            continue
        try:
            rc = json.loads(j["result_canonical"])
            f = [x for x in rc["checks"] if x.get("id") == "12_paid_rows_daily"]
            old = (((f[0].get("facts") or {}).get("furui_row") or {}).get("time_ms") or {}).get("samples") or [] if f else []
        except (ValueError, KeyError, TypeError, AttributeError):
            unread.append("published day " + d)
            continue
        for x in old if isinstance(old, list) else []:
            if not isinstance(x, dict) or x.get("day") not in days or x.get("day") >= d or x.get("call") not in ("check", "canary"):
                continue
            ms = x.get("ms")
            if not isinstance(ms, int) or isinstance(ms, bool) or not 0 <= ms <= FURUI_ROW_MAX_MS or (x["day"], x["call"]) in seen:
                continue
            seen.add((x["day"], x["call"]))
            samples.append({"day": x["day"], "call": x["call"], "ms": ms})
    samples.sort(key=lambda x: (x["day"], x["call"]), reverse=True)
    ms = [x["ms"] for x in samples]
    return {"window": [days[-1], y], "unread": unread,
            "time_ms": {"n": len(ms), "p50": rank(ms, 50), "p95": rank(ms, 95), "samples": samples, "skipped": skipped},
            "cost_usd": {"checks": checks, "spent": round(spent, 7), "per_check": round(spent / checks, 7) if checks else None, "by_day": by_day, "heartbeat": heartbeat}}


def paid_rows_state(get, now):
    """12: every paid row of the gate's public register was measured in the 26 hours before today's 03:47 UTC (or after it)"""
    cid = "12_paid_rows_daily"
    lo = anchor(now) - PAID_WINDOW
    try:
        s, reg = get(GATE + "/register")
    except Unreachable as e:
        return c(cid, "red", "the gate's /register did not answer: " + str(e))
    rows = reg.get("rows") if s == 200 and isinstance(reg, dict) else None
    if not isinstance(rows, list):
        return c(cid, "red", "the gate's /register answered http %s without rows" % s)
    paid = sorted({r.get("endpoint") for r in rows if isinstance(r, dict) and r.get("tier") == "paid" and isinstance(r.get("endpoint"), str)})
    if not paid:
        return c(cid, "not_yet", "the register has no paid row (PayPal or Marketplace) yet; there is nothing to hold to the daily cadence", paid=0, waits_for="a_paid_row")
    late = []
    for e in paid:
        r = [x for x in rows if isinstance(x, dict) and x.get("endpoint") == e][0]
        at = when((r.get("latest") or {}).get("at") if isinstance(r.get("latest"), dict) else None)
        if at is None or at < lo:
            late.append(e)
    if late:
        return c(cid, "red", "%d of %d paid rows were not measured since %s: %s" % (len(late), len(paid), iso(lo), ", ".join(late)), paid=len(paid), late=late)
    return c(cid, "ok", "all %d paid rows were measured since %s" % (len(paid), iso(lo)), paid=len(paid))


def check_line_delivery(get, now):
    """13: neither LINE worker shows a failed send (line_last_fail) in the 24 hours before today's 03:47 UTC or since. Only the
    time and the place of a failure are read; the message, its text and the person are never read or written."""
    cid = "13_line_delivery"
    lo = anchor(now) - LINE_WINDOW
    fails, unread = [], []
    for name, url in LINE_HEALTH:
        try:
            s, h = get(url)
        except Unreachable as e:
            unread.append("%s (did not answer)" % name)
            continue
        if s != 200 or not isinstance(h, dict):
            unread.append("%s (http %s)" % (name, s))
            continue
        if "line_last_fail" not in h:
            unread.append("%s (its /health has no line_last_fail)" % name)
            continue
        f = h["line_last_fail"]
        if f is None:
            continue
        if not isinstance(f, dict):
            unread.append("%s (line_last_fail is %s)" % (name, json.dumps(f) if isinstance(f, str) else type(f).__name__))
            continue
        at = when(f.get("at"))
        if at is None:
            unread.append("%s (line_last_fail has no time)" % name)
        elif at >= lo:
            where_ = f.get("where") if isinstance(f.get("where"), str) else ""
            fails.append({"worker": name, "at": iso(at), "where": re.sub(r"[^A-Za-z0-9_:./-]", "", where_)[:40]})
    if fails:
        return c(cid, "red", "a LINE send failed: " + "; ".join("%s at %s in %s" % (x["worker"], x["at"], x["where"] or "(no place)") for x in fails), fails=fails)
    if unread:
        return c(cid, "not_yet", "line_last_fail could not be read: " + "; ".join(unread), unreadable=[u.split(" ")[0] for u in unread])
    return c(cid, "ok", "no failed LINE send since %s in %s" % (iso(lo), " or ".join(n for n, _ in LINE_HEALTH)))


def check_deadlines(get, now, checks):
    """14: a check's not_yet has a deadline (NOT_YET_HOURS; 36 hours for a wait on Bitcoin). The hours are the whole days the same
    check was not_yet in the published days just before today (tooshi/days/<day>.json, read like a witness reads them)."""
    cid = "14_not_yet_deadline"
    waiting = [x for x in checks if x["state"] == "not_yet" and x["id"] != cid]
    if not waiting:
        return c(cid, "ok", "no check is not_yet today", waiting=0)
    days, unread = {}, []
    for i in range(1, DEADLINE_LOOKBACK + 1):
        d = (now - datetime.timedelta(days=i)).strftime("%Y-%m-%d")
        try:
            s, j = get(DAY_URL % d)
        except Unreachable:
            unread.append(d)
            days[d] = None
            continue
        if s == 404:
            days[d] = {}
        elif s == 200 and isinstance(j, dict) and isinstance(j.get("checks"), list):
            days[d] = {x.get("id"): x.get("state") for x in j["checks"] if isinstance(x, dict)}
        else:
            unread.append(d)
            days[d] = None
    over, exempt, open_ = [], [], []
    for x in waiting:
        why = x.get("why") or ""
        f = x.get("facts") or {}
        if x["id"] == "12_paid_rows_daily" and f.get("waits_for") == "a_paid_row":
            exempt.append(x["id"])
            continue
        limit = BITCOIN_HOURS if re.search(r"Bitcoin|not yet anchored|not_yet_anchored", why) else (GATE_WAIT_HOURS if f.get("waits_for") == "gate_0.4.24" else NOT_YET_HOURS.get(x["id"], 48))
        streak, blind = 0, False
        for i in range(1, DEADLINE_LOOKBACK + 1):
            st = days[(now - datetime.timedelta(days=i)).strftime("%Y-%m-%d")]
            if st is None:
                blind = True
                break
            if st.get(x["id"]) != "not_yet":
                break
            streak += 1
        hours = 24 * streak
        if hours > limit:
            over.append("%s not_yet for %d hours (deadline %d)" % (x["id"], hours, limit))
        else:
            open_.append({"id": x["id"], "hours": hours, "deadline": limit, "history": "unread" if blind else "read"})
    facts = {"waiting": len(waiting), "open": open_, "exempt": exempt, "exempt_why": {e: EXEMPT_WHY[e] for e in exempt}}
    if over:
        return c(cid, "red", "past the deadline: " + "; ".join(over), overdue=len(over), **facts)
    if any(o["history"] == "unread" for o in open_):
        return c(cid, "not_yet", "the published days %s could not be read, so how long %s have been not_yet is not known" % (", ".join(unread), ", ".join(o["id"] for o in open_ if o["history"] == "unread")), **facts)
    return c(cid, "ok", "every not_yet is within its deadline%s" % ((" (" + ", ".join(exempt) + " waits for a fact, not a time)") if exempt else ""), **facts)


def check_recovery(get, now):
    """15: Software Heritage's last visit of the repository is at most 7 days old, and the daily recovery drill
    (survive-drill.yml) rebuilt the ledger, unbroken, up to an entry made at most 48 hours before the ledger's head"""
    cid = "15_recovery_fresh"
    lo = anchor(now) - SWH_WINDOW
    try:
        s, v = get(SWH_VISIT)
    except Unreachable as e:
        return c(cid, "not_yet", "Software Heritage did not answer: " + str(e))
    vt = when(v.get("date")) if s == 200 and isinstance(v, dict) else None
    if vt is None:
        return c(cid, "not_yet", "Software Heritage answered http %s without a visit date for %s" % (s, SWH_ORIGIN))
    bad = []
    if vt < lo:
        bad.append("Software Heritage's last visit is %s, more than 7 days before %s" % (iso(vt), iso(anchor(now))))
    try:
        hs, h = get(LEDGER + "/ledger/head")
        hn = h.get("n") if hs == 200 and isinstance(h, dict) else None
        if not _int(hn, 1):
            return c(cid, "red", "the ledger's head answered http %s without n" % hs)
        es, he = get(LEDGER + "/ledger/%d?format=json" % hn)
        ht = when(he.get("created_at")) if es == 200 and isinstance(he, dict) else None
        drills = {}
        for src in ("github", "swh"):
            ds, dj = get(DRILLS + "latest-%s.json" % src)
            drills[src] = dj if ds == 200 and isinstance(dj, dict) else None
        g = drills["github"]
        if g is None:
            return c(cid, "red", "the recovery drill's latest-github.json is not served")
        for src, dj in drills.items():
            if dj is None:
                bad.append("latest-%s.json is not served" % src)
                continue
            ch, dg = dj.get("chain") or {}, dj.get("digests") or {}
            if dj.get("outcome") != "rebuilt" or ch.get("broken_at") is not None or dg.get("failed"):
                bad.append("the %s drill did not rebuild the ledger unbroken (outcome %s, broken_at %s, failed digests %s)" % (src, dj.get("outcome"), ch.get("broken_at"), len(dg.get("failed") or [])))
        rt = ch_n = None
        ch_n = (g.get("chain") or {}).get("rebuilt_through")
        if _int(ch_n, 1):
            rs, re_ = get(LEDGER + "/ledger/%d?format=json" % ch_n)
            rt = when(re_.get("created_at")) if rs == 200 and isinstance(re_, dict) else None
        if ht is None or rt is None:
            bad.append("the time of the head (%s) or of the rebuilt entry (%s) could not be read" % (hn, ch_n))
        elif ht - rt > RECOVER_WINDOW:
            bad.append("the drill rebuilt up to entry %s (%s), more than 48 hours before the head %s (%s)" % (ch_n, iso(rt), hn, iso(ht)))
    except Unreachable as e:
        return c(cid, "red", "an endpoint did not answer: " + str(e))
    except (ValueError, KeyError, TypeError, AttributeError) as e:
        return c(cid, "red", "an answer did not have its shape: %s" % type(e).__name__)
    facts = {"swh_visit_within_7_days": vt >= lo, "rebuilt_through": ch_n, "head": hn,
             "swh_rebuilt_through": ((drills.get("swh") or {}).get("chain") or {}).get("rebuilt_through")}
    if bad:
        return c(cid, "red", "; ".join(bad), **facts)
    return c(cid, "ok", "Software Heritage visited the repository within 7 days, and the drill rebuilt the ledger unbroken up to entry %s, within 48 hours of the head %s" % (ch_n, hn), **facts)


def own_witness(d):
    """16: a signed_domain of the operator: one of its zones or a subdomain of one, or its GitHub account (the intake's
    identity for a key on raw.githubusercontent.com is github.com/<owner>)"""
    d = d.strip().lower()
    if d.startswith("github.com/"):
        return d in OWN_GITHUB
    return any(d == z or d.endswith("." + z) for z in OWN_ZONES)


def check_witness_pool(get, now):
    """16: at least 3 distinct outside witnesses signed a FURUI or TOOSHI day in the 30 days before today's 03:47 UTC, counted
    from the ledger's witness batches only"""
    cid = "16_witness_pool"
    hi = anchor(now)
    lo = hi - POOL_WINDOW
    win = [iso(lo), iso(hi)]
    last, other, read = {}, set(), 0
    try:
        s, h = get(LEDGER + "/ledger/head")
        n = h.get("n") if s == 200 and isinstance(h, dict) else None
        if not _int(n, 1):
            return c(cid, "not_yet", "the ledger's head answered http %s without n, so the witness batches of the 30 days before %s cannot be read" % (s, iso(hi)), window=win)
        i, done = n, False
        while i >= 1:
            if read >= POOL_SCAN:
                return c(cid, "not_yet", "the 30 days before %s hold more than %d ledger entries; not all were read" % (iso(hi), POOL_SCAN), window=win, entries_read=read)
            es, e = get(LEDGER + "/ledger/%d?format=json" % i)
            read += 1
            t = when(e.get("created_at")) if es == 200 and isinstance(e, dict) else None
            if t is None:
                return c(cid, "not_yet", "ledger entry %d answered http %s without created_at, so the window cannot be read whole" % (i, es), window=win, entries_read=read)
            if t < lo:
                done = True
                break
            i -= 1
            if t >= hi:
                continue   # made after today's 03:47 UTC: a later run of the day reads the same window
            try:
                b = json.loads(e.get("record_canonical") or "")
            except (ValueError, TypeError):
                continue
            if not (isinstance(b, dict) and b.get("schema") == "nenrin-witness-batch-v1" and isinstance(b.get("records"), list)):
                continue
            day = str(b.get("anchored_at") or e.get("created_at"))[:10]
            for r in b["records"]:
                if not isinstance(r, dict) or r.get("signed") is not True:
                    continue
                d = r.get("signed_domain")
                if not isinstance(d, str) or not d.strip() or own_witness(d):
                    continue
                d = d.strip().lower()
                if not (isinstance(r.get("purpose"), str) and r["purpose"].startswith(POOL_PURPOSES)):
                    other.add(d)
                    continue
                if d not in last:   # entries are read from the newest, so the first seen is the latest
                    last[d] = {"signed_domain": d, "last_entry": e.get("n", i + 1), "last_signed": day}
        if not done and i < 1:
            done = True   # the whole ledger is inside the window
    except Unreachable as e:
        return c(cid, "not_yet", "the ledger did not answer, so the witness batches of the 30 days before %s cannot be read: %s" % (iso(hi), e), window=win, entries_read=read)
    doms = sorted(last.values(), key=lambda x: x["signed_domain"])
    facts = {"window": win, "line": POOL_LINE, "distinct": len(doms), "domains": doms, "entries_read": read,
             "other_purposes_only": len(other - set(last))}
    names = ", ".join("%s (latest batch %s, entry %s)" % (x["signed_domain"], x["last_signed"], x["last_entry"]) for x in doms) or "none"
    if len(doms) < POOL_LINE:
        return c(cid, "red", "%d outside witness(es) signed a FURUI or TOOSHI day with a key of their own domain in the 30 days before %s (the line is %d): %s" % (len(doms), iso(hi), POOL_LINE, names), **facts)
    return c(cid, "ok", "%d outside witnesses signed a FURUI or TOOSHI day with a key of their own domain in the 30 days before %s: %s" % (len(doms), iso(hi), names), **facts)


class LedgerUnread(Exception):
    pass


def _days(a, b):
    """the UTC days from the day of a to the day of b, as YYYY-MM-DD"""
    out, d = [], a.date()
    while d <= b.date():
        out.append(d.strftime("%Y-%m-%d"))
        d += datetime.timedelta(days=1)
    return out


def chain_leaves(get, d, pub, rid="runner-1"):
    """17: the leaves of runner day d that hold (the closed envelope, the leaf hash, runner-1's signature, the audit path to the
    root the ledger serves), as {check sha: [leaf index]}; (problem or None, the map). rid: another runner's day and key."""
    try:
        why, day = ledger_day(get, d, rid)
        if why == "empty":
            return None, {}
        if why:
            return why, {}
        if not pub:
            return "the ledger lists no single live %s key" % rid, {}
        m = {}
        for i in range(min(day["n"], CHAIN_LEAF_SCAN)):
            bad, e = leaf_problems(get, d, i, day, pub, rid)
            if not bad and e is not None:
                m.setdefault(sha(canonical(e["check"])), []).append(i)
        return ("only the first %d of %d leaves were read" % (CHAIN_LEAF_SCAN, day["n"]) if day["n"] > CHAIN_LEAF_SCAN else None), m
    except Unreachable as e:
        return "the runner or the ledger did not answer: " + str(e), {}
    except (ValueError, KeyError, TypeError) as e:
        return "an answer did not have its shape: %s" % type(e).__name__, {}


def chain_settled(get, place, d):
    """17: the admission_sha256 listed as admit in the final settlement of day d at place (runs/<d>/SETTLED.json and the
    settlement.json bytes it names); (problem or None, the set)"""
    try:
        s, x = get(place + d + "/SETTLED.json")
        if s == 404:
            return None, set()
        if s != 200 or not isinstance(x, dict):
            return "%s/SETTLED.json answered http %s" % (d, s), set()
        if x.get("status") != "final":
            return None, set()
        ts, t = get(place + d + "/settlement.json", raw=True)
        if ts != 200 or not isinstance(t, str) or sha(t) != x.get("settlement_sha256"):
            return "%s/settlement.json is not served as the bytes SETTLED.json names (http %s)" % (d, ts), set()
        rd = (json.loads(t).get("admission_gate") or {}).get("admissions_read")
        return None, {a["admission_sha256"] for a in (rd if isinstance(rd, list) else []) if isinstance(a, dict) and a.get("decision") == "admit" and isinstance(a.get("admission_sha256"), str)}
    except Unreachable as e:
        return "%s: the repository did not answer: %s" % (d, e), set()
    except (ValueError, AttributeError, TypeError) as e:
        return "%s: an answer did not have its shape: %s" % (d, type(e).__name__), set()


def unanswered_05(rec):
    """18: for an admission of version 0.5 whose content block is short of its quorum (quorum.answered < quorum.required), its
    quorum and, per runner, the why of each check that gave no answer the door could count (why other than ok and unread);
    else None."""
    if not isinstance(rec, dict) or not isinstance(rec.get("rules"), dict) or rec["rules"].get("version") != "0.5":
        return None
    cb = rec.get("content") if isinstance(rec.get("content"), dict) else {}
    q = cb.get("quorum") if isinstance(cb.get("quorum"), dict) else {}
    if not (_int(q.get("required"), 1) and _int(q.get("answered")) and q["answered"] < q["required"]):
        return None
    why = {str(k.get("runner_id")): str(k.get("why")) for k in (cb.get("checks") or []) if isinstance(k, dict) and k.get("why") not in ANSWERED_WHY}
    return {"quorum": {"required": q["required"], "answered": q["answered"]}, "why": why}


def chain_calls(get, lo, hi, hi_a, rp, paid, short=None):
    """17: the paid calls of [lo, hi) the ledger shows: admits of rp under a paid contract, submitted in the window, listed in an
    agreement batch made from lo to today's 03:47 UTC or still in the pool. ({record sha: call}, {record sha: [entry n]}, entries
    read). LedgerUnread when the ledger cannot be read for the whole window. With a list as short, the escalations of the same
    window, rp and paid contracts that are admission 0.5 short of their quorum (unanswered_05) are appended to it, for 18."""
    s, h = get(LEDGER + "/ledger/head")
    n = h.get("n") if s == 200 and isinstance(h, dict) else None
    if not _int(n, 1):
        raise LedgerUnread("the ledger's head answered http %s without n" % s)
    listed, read, i = {}, 0, n
    while i >= 1:
        if read >= CHAIN_SCAN:
            raise LedgerUnread("more than %d ledger entries were made since %s; not all were read" % (CHAIN_SCAN, iso(lo)))
        es, e = get(LEDGER + "/ledger/%d?format=json" % i)
        read += 1
        t = when(e.get("created_at")) if es == 200 and isinstance(e, dict) else None
        if t is None:
            raise LedgerUnread("ledger entry %d answered http %s without created_at" % (i, es))
        if t < lo:
            break
        i -= 1
        if t >= hi_a:
            continue   # made after today's 03:47 UTC: a later run of the day reads the same batches
        try:
            b = json.loads(e.get("record_canonical") or "")
        except (ValueError, TypeError):
            continue
        if not (isinstance(b, dict) and b.get("schema") == "nenrin-agreement-batch-v1" and isinstance(b.get("records"), list)):
            continue
        for r in b["records"]:
            x = r.get("canonical_sha256") if isinstance(r, dict) else None
            if isinstance(x, str) and H64.match(x) and r.get("record_schema") == "a2a-admission-v0":
                listed.setdefault(x, []).append(e.get("n", i + 1))
    qs, q = get(LEDGER + "/agreement/pending")
    pend = q.get("pending") if qs == 200 and isinstance(q, dict) else None
    if not isinstance(pend, list):
        raise LedgerUnread("the ledger's pool (/agreement/pending) answered http %s without a list" % qs)
    pooled = {r["canonical_sha256"] for r in pend if isinstance(r, dict) and r.get("record_schema") == "a2a-admission-v0" and isinstance(r.get("canonical_sha256"), str) and H64.match(r["canonical_sha256"])}
    calls = {}
    for x in sorted(set(listed) | pooled):
        a_s, a = get(LEDGER + "/admission/" + x)
        rc = a.get("record_canonical") if a_s == 200 and isinstance(a, dict) else None
        if not isinstance(rc, str) or sha(rc) != x:
            raise LedgerUnread("the ledger lists admission %s but does not serve it as bytes that hash to it (http %s)" % (x, a_s))
        try:
            rec = json.loads(rc)
        except ValueError:
            raise LedgerUnread("admission %s is not JSON" % x)
        t = when(a.get("submitted_at"))
        if short is not None and isinstance(rec, dict) and rec.get("decision") == "escalate" and (rec.get("relying_party") or {}).get("domain") == rp \
                and t is not None and lo <= t < hi and (rec.get("contract_ref") or {}).get("contract_sha256") in paid:
            u = unanswered_05(rec)
            if u is not None:
                short.append(dict(u, call=x, store=paid[rec["contract_ref"]["contract_sha256"]]))
        if not isinstance(rec, dict) or rec.get("decision") != "admit" or (rec.get("relying_party") or {}).get("domain") != rp or t is None or not lo <= t < hi:
            continue
        cs = (rec.get("contract_ref") or {}).get("contract_sha256")
        if cs in paid:
            calls[x] = {"store": paid[cs], "at": t, "admission_sha256": (a.get("report") or {}).get("admission_sha256")}
    return calls, listed, read


def check_paid_chain(get, now):
    """17: every paid call that passed the door in the 24 hours from 03:47 UTC the day before yesterday carries its FURUI
    envelope, its SEKI record, its MUSUBI settlement and its NENRIN entry, one of each"""
    cid = "17_paid_call_chain"
    hi_a = anchor(now)
    lo, hi = hi_a - datetime.timedelta(hours=48), hi_a - datetime.timedelta(hours=24)
    win = [iso(lo), iso(hi)]
    try:
        ps, p = get(DOOR_POLICY)
    except Unreachable as e:
        return c(cid, "red", "the door policy did not answer, so its paid stores and its records cannot be read: " + str(e), window=win)
    stores = p.get("stores", []) if ps == 200 and isinstance(p, dict) else None
    if not isinstance(stores, list):
        return c(cid, "red", "the door policy answered http %s without a list of stores" % ps, window=win)
    paid = {}
    for s in stores:
        sv = s.get("services") if isinstance(s, dict) else None
        if isinstance(sv, dict) and any(_num(v) and v > 0 for v in sv.values()) and isinstance(s.get("store"), str) and isinstance(s.get("contract_sha256"), str) and H64.match(s["contract_sha256"]):
            paid[s["contract_sha256"]] = s["store"]
    if not paid:
        return c(cid, "ok", "the door prices no store above 0, so no paid call passed it", window=win, stores=[], calls=0, complete=0, missing=[])
    facts = {"window": win, "stores": sorted(set(paid.values()))}
    rp = p["relying_party"].get("domain") if isinstance(p.get("relying_party"), dict) else None
    if not (isinstance(rp, str) and rp):
        return c(cid, "red", "the door policy names no relying party domain, so its records cannot be told from others", **facts)
    try:
        short = []
        calls, listed, read = chain_calls(get, lo, hi, hi_a, rp, paid, short)
    except LedgerUnread as e:
        return c(cid, "not_yet", "the ledger cannot be read for the window, so the paid calls are not known: %s" % e, **facts)
    except Unreachable as e:
        return c(cid, "not_yet", "the ledger did not answer, so the paid calls of the window are not known: %s" % e, **facts)
    facts["entries_read"] = read
    # the store's own agent files its calls by day (heartbeat.py), so a call whose record never reached the ledger is counted too
    bad = []
    for st in sorted(set(paid.values())):
        place = SETTLE_PLACES.get(st)
        for d in (_days(lo - HEARTBEAT_DAY_SHIFT, hi - HEARTBEAT_DAY_SHIFT) if place else []):
            try:
                rs, rj = get(place + d + "/RUN.json")
            except Unreachable as e:
                bad.append("the day file %s/RUN.json of %s did not answer: %s" % (d, st, e))
                continue
            if rs == 404:
                continue
            if rs != 200 or not isinstance(rj, dict) or not isinstance(rj.get("calls"), list):
                bad.append("the day file %s/RUN.json of %s answered http %s without calls" % (d, st, rs))
                continue
            t = when(rj.get("ran_at"))
            if rj.get("store") != st or t is None or not lo <= t < hi:
                continue
            for k in rj["calls"]:
                x = k.get("record_sha256") if isinstance(k, dict) and k.get("decision") == "admit" else None
                if isinstance(x, str) and H64.match(x) and x not in calls:
                    calls[x] = {"store": st, "at": t, "admission_sha256": k.get("admission_sha256")}
    missing, leaves, settled, pubs, v05 = [], {}, {}, {}, []

    def held(rid, ck, at):
        """the leaves of rid's day of the call (and of the day before when the call is within 10 minutes of midnight) that hold ck,
        and what could not be read"""
        hits, un = 0, []
        for d in sorted({at.strftime("%Y-%m-%d"), (at - datetime.timedelta(minutes=10)).strftime("%Y-%m-%d")}):
            if (rid, d) not in leaves:
                if rid not in pubs:
                    try:
                        pubs[rid] = runner_key(get, rid) or ""
                    except Unreachable:
                        pubs[rid] = ""
                leaves[(rid, d)] = chain_leaves(get, d, pubs[rid], rid)
            if leaves[(rid, d)][0]:
                un.append("%s: %s" % (d, leaves[(rid, d)][0]))
            hits += len(leaves[(rid, d)][1].get(ck, []))
        return hits, un
    for x in sorted(calls):
        k, lacks, said = calls[x], [], []
        try:
            w, rec, la = door_record(get, x)
            if w is None and rec.get("decision") != "admit":
                w = "the record is not an admit"
        except Unreachable as e:
            if str(e).startswith(LEDGER):
                return c(cid, "not_yet", "the ledger did not answer for admission %s: %s" % (x, e), **facts)
            w, rec, la = "did not answer: " + str(e), None, None
            try:
                la = get(LEDGER + "/admission/" + x)[1]   # the door is down; the ledger's bytes still name the content check
            except Unreachable as e2:
                return c(cid, "not_yet", "the ledger did not answer for admission %s: %s" % (x, e2), **facts)
        except (ValueError, AttributeError) as e:
            w, rec, la = "the record did not have its shape: %s" % type(e).__name__, None, None
        if w:
            lacks.append("seki_record")
            said.append("SEKI: " + w)
        if rec is None and isinstance(la, dict) and isinstance(la.get("record_canonical"), str):
            try:
                rec = json.loads(la["record_canonical"])   # the ledger's bytes still name the content check
            except ValueError:
                rec = None
        rep = la.get("report") if isinstance(la, dict) and isinstance(la.get("report"), dict) else {}
        am = k.get("admission_sha256") or rep.get("admission_sha256")
        cb = rec.get("content") if isinstance(rec, dict) else None
        ck = cb.get("check_sha256") if isinstance(cb, dict) else None
        v5 = isinstance(cb, dict) and isinstance(rec.get("rules"), dict) and rec["rules"].get("version") == "0.5" and isinstance(cb.get("checks"), list)
        if v5:
            # admission 0.5: every check read as an answer, in its own runner's day
            v05.append({"call": x, "quorum": cb.get("quorum"), "disagreement_kind": cb.get("disagreement_kind")})
            ks = [q for q in cb["checks"] if isinstance(q, dict) and q.get("why") == "ok"]
            fs = []
            for q in ks:
                rid, qk = q.get("key_id"), q.get("check_sha256")
                if rid not in RUNNER_DAYS or not (isinstance(qk, str) and H64.match(qk)):
                    fs.append("FURUI: a check of %s that no runner day can hold" % rid)
                    continue
                hits, un = held(rid, qk, k["at"])
                if hits != 1:
                    fs.append("FURUI: %d leaves of %s hold the check %s%s" % (hits, rid, qk[:8], (" (" + "; ".join(un) + ")") if un else ""))
            if not ks:
                fs.append("FURUI: the v0.5 record names no check read as an answer")
            if fs:
                lacks.append("furui_envelope")
                said.extend(fs)
        elif not (isinstance(ck, str) and H64.match(ck)):
            lacks.append("furui_envelope")
            said.append("FURUI: the record carries no content check (no content.check_sha256)")
        else:
            hits, un = held("runner-1", ck, k["at"])
            if hits != 1:
                lacks.append("furui_envelope")
                said.append("FURUI: %d leaves hold the check %s%s" % (hits, ck[:8], (" (" + "; ".join(un) + ")") if un else ""))
        place = SETTLE_PLACES.get(k["store"])
        if not place:
            lacks.append("musubi_settlement")
            said.append("MUSUBI: no public place keeps the settlements of %s" % k["store"])
        elif not (isinstance(am, str) and H64.match(am)):
            lacks.append("musubi_settlement")
            said.append("MUSUBI: the call's admission_sha256 is not known")
        else:
            hits, un = [], []
            for d in sorted({(k["at"] - HEARTBEAT_DAY_SHIFT).strftime("%Y-%m-%d"), k["at"].strftime("%Y-%m-%d")}):
                if (place, d) not in settled:
                    settled[(place, d)] = chain_settled(get, place, d)
                if settled[(place, d)][0]:
                    un.append(settled[(place, d)][0])
                if am in settled[(place, d)][1]:
                    hits.append(d)
            if len(hits) != 1:
                lacks.append("musubi_settlement")
                said.append("MUSUBI: %d final settlements list the admission %s%s" % (len(hits), am[:8], (" (" + "; ".join(un) + ")") if un else ""))
        ns = listed.get(x, [])
        if len(ns) != 1:
            lacks.append("nenrin_entry")
            said.append("NENRIN: %s" % ("in no agreement batch made by today's 03:47 UTC" if not ns else "in %d agreement batches (%s)" % (len(ns), ", ".join(str(v) for v in ns))))
        if lacks:
            missing.append({"call": x, "store": k["store"], "lacks": lacks})
            bad.append("%s (%s): %s" % (x[:8], k["store"], "; ".join(said)))
    # complete_calls: the calls of the window that carry all four records, named (tooshi_follow reads them to tell whether a
    # later day answered a red day: only a call named here closes the red day that named it in missing)
    gone = {m["call"] for m in missing}
    facts.update(calls=len(calls), complete=len(calls) - len(missing), missing=missing, complete_calls=sorted(x for x in calls if x not in gone))
    if bad:
        out = c(cid, "red", "%d of %d paid calls from %s to %s lack a record: %s" % (len(missing), len(calls), win[0], win[1], " | ".join(bad)), **facts)
    elif not calls:
        out = c(cid, "ok", "no paid call passed the door from %s to %s (0 calls; none passed without its records)" % tuple(win), **facts)
    else:
        out = c(cid, "ok", "every one of the %d paid calls from %s to %s carries its FURUI envelope, SEKI record, MUSUBI settlement and NENRIN entry, one of each" % (len(calls), win[0], win[1]), **facts)
    if v05:
        out[V05_KEY] = v05          # for 18, taken out by run() before the result is written
    out[CALLS_KEY] = sorted(calls)  # for 25, taken out by run() before the result is written
    if short:
        out[SHORT_KEY] = sorted(short, key=lambda r: r["call"])   # for 18, taken out by run() before the result is written
    return out


def check_two_runners(get, now, v05, short=()):
    """18: the paid calls of 17's window that carry admission 0.5 (quorum and disagreement_kind), and runner-2's canary call in the
    door's policy. Dormant while no paid call carries 0.5 and runner-2's canary has not failed; counted from the first day one
    does. Red when a 0.5 admit is short of its quorum, or runner-2's canary touched the phrase or says ok false (also before the
    first 0.5 record). short: the 0.5 escalations of the window short of their quorum (17 hands them over); they are counted in
    the facts (unanswered_escalate, unanswered_by runner and why), never red."""
    cid = "18_two_runners"
    try:
        ps, p = get(DOOR_POLICY)
    except Unreachable:
        ps, p = None, None
    fu = p.get("furui") if ps == 200 and isinstance(p, dict) and isinstance(p.get("furui"), dict) else {}
    k2 = fu.get("canary_call_runner2") if isinstance(fu.get("canary_call_runner2"), dict) else None
    facts = {"canary_runner2": k2 is not None, "canary_runner2_prev": isinstance(fu.get("canary_call_runner2_prev"), dict)}
    if k2 is not None:
        facts.update(canary_runner2_day=k2.get("day"), canary_runner2_decision=k2.get("decision"), canary_runner2_ok=k2.get("ok"))
    short = [r for r in (short or []) if isinstance(r, dict)]
    by = {}
    for r in short:
        for rid, w in sorted((r.get("why") or {}).items()):
            by["%s:%s" % (rid, w)] = by.get("%s:%s" % (rid, w), 0) + 1
    facts.update(unanswered_escalate=len(short), unanswered_by=by)
    canary_red = None
    if k2 is not None and (k2.get("touched") is True or k2.get("ok") is False):
        canary_red = "runner-2's canary call of %s %s" % (k2.get("day"), "touched the phrase" if k2.get("touched") is True else "failed: %s" % k2.get("error"))
    if not v05 and not short:
        if canary_red:
            return c(cid, "red", canary_red + " (no paid call of 17's window carries admission 0.5 yet)", records=0, **facts)
        return dormant(cid, "no paid call of 17's window carries an admission of version 0.5 (the door writes 0.4 until it calls two runners)",
                       waits_for="an_admission_0_5", records=0, **facts)
    kinds, short_admits = {}, []
    for r in v05:
        q = r.get("quorum") if isinstance(r.get("quorum"), dict) else {}
        if not (_int(q.get("required"), 1) and _int(q.get("answered")) and q["answered"] >= q["required"]):
            short_admits.append(r.get("call"))
        kinds[str(r.get("disagreement_kind"))] = kinds.get(str(r.get("disagreement_kind")), 0) + 1
    facts.update(records=len(v05), quorum_short=len(short_admits), disagreement_kind=kinds)
    if short_admits:
        return c(cid, "red", "%d of %d paid calls of admission 0.5 are admits short of their quorum: %s" % (len(short_admits), len(v05), ", ".join(str(x)[:8] for x in short_admits)), **facts)
    if canary_red:
        return c(cid, "red", canary_red, **facts)
    return c(cid, "ok", "%d paid call(s) of 17's window carry admission 0.5, each with its quorum (disagreement_kind %s, counted, not judged); "
             "%d escalated for want of answers (%s, counted, not red)"
             % (len(v05), ", ".join("%s %d" % kv for kv in sorted(kinds.items())) or "none", len(short), ", ".join("%s %d" % kv for kv in sorted(by.items())) or "none"), **facts)

TASUKI_SRC = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "workers", "hs-ledger", "nenrin", "sdk-python", "src"))
TASUKI_17 = (("furui_envelope", "adm->check"), ("musubi_settlement", "exec->settle"), ("nenrin_entry", "adm->entry"))


def tasuki_module():
    """nenrin-verify's tasuki.py from this repository (not an installed copy)"""
    if TASUKI_SRC not in sys.path:
        sys.path.insert(0, TASUKI_SRC)
    from nenrin_verify import tasuki
    return tasuki


def tasuki_get(get):
    """the walk's GET, (status, bytes), over this file's get (the self test's worlds read here)"""
    def g(url):
        try:
            s, v = get(url, raw=True)
        except Unreachable as e:
            raise OSError(str(e))
        if isinstance(v, bytes):
            return s, v
        if isinstance(v, str):
            return s, v.encode("utf-8")
        return s, (b"" if v is None else json.dumps(v, ensure_ascii=False).encode("utf-8"))
    return g


def check_tasuki(now, calls, pc, walk_get, walk=None):
    """25: each paid call of 17's window walked as one chain (nenrin-verify tasuki). A notice: counted, never red for now"""
    cid = "25_tasuki_chain"
    if calls is None and (pc.get("facts") or {}).get("calls") == 0:
        calls = []
    if calls is None:
        return c(cid, "notice", "17 did not list the paid calls of its window (17 is %s), so no chain was walked today (not red)" % pc.get("state"), calls=None)
    if not calls:
        return dormant(cid, "17's window has no paid call; no chain to walk", calls=0)
    at = anchor(now)
    if walk is None:
        try:
            walk = tasuki_module().walk
        except Exception as e:
            return c(cid, "notice", "the walk (nenrin-verify tasuki) could not be loaded: %s: %s; no chain was walked today (not red)" % (type(e).__name__, e), calls=len(calls))
    lacks17 = {m.get("call"): set(m.get("lacks") or []) for m in ((pc.get("facts") or {}).get("missing") or []) if isinstance(m, dict)}
    rows, held, by_link, unwalked, differ, compared = [], 0, {}, [], [], 0
    for x in sorted(calls):
        try:
            r = walk(x, walk_get, at)
        except Exception as e:
            unwalked.append({"call": x, "why": "%s: %s" % (type(e).__name__, str(e)[:200])})
            continue
        st = {l["link"]: l for l in r["links"]}
        causes = [l["link"] for l in r["links"] if l["state"] == "missing" and l["follows"] is None]
        for k in causes:
            by_link[k] = by_link.get(k, 0) + 1
        held += not any(l["state"] == "missing" for l in r["links"])
        rows.append({"call": x, "verdict": r["verdict"], "missing": causes, "not_yet": [l["link"] for l in r["links"] if l["state"] == "not_yet" and l["follows"] is None]})
        for k17, link in TASUKI_17:
            compared += 1
            a, b = k17 in lacks17.get(x, set()), st[link]["state"] != "holds"
            if a != b:
                differ.append({"call": x, "record_17": k17, "lacks_17": a, "link": link, "state": st[link]["state"]})
    facts = {"walked_at": iso(at), "calls": len(calls), "walked": len(rows), "no_link_missing": held, "missing_by_link": by_link, "rows": rows,
             "unwalked": unwalked, "agrees_with_17": {"compared": compared, "differ": differ}}
    why = ("%d of %d paid calls of 17's window are chains with no link missing (every link holds or not_yet)%s; missing links by name: %s; "
           "17 and 25 agree on %d of %d records (counted, not red)" % (held, len(calls), (", %d not walked" % len(unwalked)) if unwalked else "",
                                                                     ", ".join("%s %d" % kv for kv in sorted(by_link.items())) or "none", compared - len(differ), compared))
    return c(cid, "notice", why, **facts)


# ---- the day's facts (2026-11-10): beside the checks, never a check; the verdict, the counts and 14 do not read them ----
FIRST_DAY = "2026-11-04"                 # the first published day (tooshi/days/2026-11-04.json)
STREAK_SCAN = 4000                       # published days read back at most for red_zero_streak (about eleven years)
OTS_NIGHT_URL = "https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/ots-nightly/nights/%s.json"   # ots_nightly.py write
PYPI_WATCH = ("nenrin-verify", "0.11.0")
PYPI_URL = "https://pypi.org/pypi/%s/%s/json"
PYPI_PROVENANCE = "https://pypi.org/integrity/%s/%s/%s/provenance"
RELEASES_URL = GH_API + "/repos/ogasurfproject-jpg/horizon-shield/releases?per_page=100"
SUMS_NAME = re.compile(r"(?i)sha256sums")
VERDICTS = ("green", "not_all_checked", "red")


def published_result(get, d):
    """a published day read as a witness reads it: (state, verdicts, why). state is read (its result_canonical hashes to
    result_sha256 and is the result of day d), missing (404) or unread. verdicts: the kept result's (red when counts.red is
    above 0), then each earlier run's of the same day."""
    try:
        s, j = get(DAY_URL % d)
    except Unreachable as e:
        return "unread", [], str(e)
    if s == 404:
        return "missing", [], "no published day"
    if s != 200 or not isinstance(j, dict) or not isinstance(j.get("result_canonical"), str):
        return "unread", [], "http %s without result_canonical" % s
    t = j["result_canonical"]
    if sha(t) != j.get("result_sha256"):
        return "unread", [], "result_canonical does not hash to result_sha256"
    try:
        r = json.loads(t)
    except ValueError:
        return "unread", [], "result_canonical is not JSON"
    cn = r.get("counts") if isinstance(r, dict) else None
    if not (isinstance(cn, dict) and _int(cn.get("red")) and str(r.get("checked_at"))[:10] == d and r.get("verdict") in VERDICTS):
        return "unread", [], "the result is not a result of %s with a red count" % d
    ea = j.get("earlier") or []
    if not isinstance(ea, list) or any(not isinstance(e, dict) or e.get("verdict") not in VERDICTS for e in ea):
        return "unread", [], "an earlier run of %s has no verdict" % d
    return "read", ["red" if cn["red"] else r["verdict"]] + [e["verdict"] for e in ea], ""


def red_zero_streak(get, now, counts):
    """the days in a row, ending today, with red 0 (docstring: red_zero_streak). Recounted from the day files alone."""
    d0 = now.strftime("%Y-%m-%d")
    f = {"days": None, "since": None, "through": d0, "ended_by": None, "read": 0, "at_least": None, "unread": None}
    if counts["red"]:
        return dict(f, days=0, ended_by={"day": d0, "why": "red"})
    st, vs, why = published_result(get, d0)
    if st == "unread":
        return dict(f, at_least=0, unread={"day": d0, "why": why})
    if "red" in vs:
        return dict(f, days=0, ended_by={"day": d0, "why": "an_earlier_run_red"})
    n = 0
    for i in range(1, STREAK_SCAN + 1):
        d = (now - datetime.timedelta(days=i)).strftime("%Y-%m-%d")
        st, vs, why = published_result(get, d)
        if st == "unread":
            return dict(f, read=i - 1, at_least=1 + n, unread={"day": d, "why": why})
        if st == "missing" or "red" in vs:
            w = ("before_first_day" if d < FIRST_DAY else "missing") if st == "missing" else ("red" if vs[0] == "red" else "an_earlier_run_red")
            return dict(f, days=1 + n, since=(now - datetime.timedelta(days=n)).strftime("%Y-%m-%d"), ended_by={"day": d, "why": w}, read=i - 1 if st == "missing" else i)
        n += 1
    return dict(f, read=STREAK_SCAN, at_least=1 + n, unread={"day": None, "why": "more than %d days back" % STREAK_SCAN})


def anchored_ledger_days(get, now):
    """the distinct UTC days of the Bitcoin blocks that anchor ledger entries, as the OpenTimestamps nightly check read the
    proofs (docstring: anchored_ledger_days)"""
    f = {"days": None, "first_day": None, "last_day": None, "span_days": None, "gap_days": None, "blocks": None, "night": None, "answers_sha256": None, "unread": None}
    tried = []
    for back in (1, 2):
        night = (now - datetime.timedelta(days=back)).strftime("%Y-%m-%d")
        tried.append(night)
        try:
            s, j = get(OTS_NIGHT_URL % night)
        except Unreachable as e:
            return dict(f, night=night, unread=str(e))
        if s != 404:
            break
    else:
        return dict(f, unread="no OTS nightly result is kept for %s" % " or ".join(tried))
    f["night"] = night
    if s != 200 or not isinstance(j, dict) or j.get("schema") != "nenrin-ots-nightly-v1" or j.get("night") != night:
        return dict(f, unread="the night answered http %s, not a nenrin-ots-nightly-v1 result of %s" % (s, night))
    ans = {k: j.get(k) for k in ("entries", "blocks", "counts", "verdict")}
    if sha(json.dumps(ans, sort_keys=True, separators=(",", ":"), ensure_ascii=False)) != j.get("answers_sha256"):
        return dict(f, unread="the night's entries, blocks, counts and verdict do not hash to its answers_sha256")
    if not isinstance(j["blocks"], dict) or not isinstance(j["entries"], list):
        return dict(f, unread="the night has no blocks or entries")
    f["answers_sha256"] = j["answers_sha256"]
    held = {e.get("bitcoin_block") for e in j["entries"] if isinstance(e, dict) and e.get("state") == "ok" and _int(e.get("bitcoin_block"))}
    days, blocks, bad = set(), 0, []
    for h in sorted(j["blocks"], key=lambda x: (len(x), x)):
        b = j["blocks"][h]
        if not (isinstance(b, dict) and b.get("state") == "ok" and h.isdigit() and int(h) in held):
            continue
        try:
            hd = bytes.fromhex(b.get("header"))
        except (TypeError, ValueError):
            hd = b""
        if len(hd) != 80 or hashlib.sha256(hashlib.sha256(hd).digest()).digest()[::-1].hex() != b.get("block_hash"):
            bad.append(h)
            continue
        days.add(datetime.datetime.fromtimestamp(int.from_bytes(hd[68:72], "little"), datetime.timezone.utc).strftime("%Y-%m-%d"))
        blocks += 1
    if bad:
        return dict(f, unread="the header of block %s does not hash to the block hash the night names" % ", ".join(bad))
    if not days:
        return dict(f, days=0, blocks=0)
    lo, hi = min(days), max(days)
    span = (datetime.date.fromisoformat(hi) - datetime.date.fromisoformat(lo)).days + 1
    return dict(f, days=len(days), first_day=lo, last_day=hi, span_days=span, gap_days=span - len(days), blocks=blocks)


def wheel_provenance(get, proj, ver, fn):
    """PyPI's provenance of one file (PEP 740): the publishers and the sha256 the statements name for the file. The
    statement is read; its signature is not checked here."""
    try:
        s, p = get(PYPI_PROVENANCE % (proj, ver, fn))
    except Unreachable as e:
        return {"state": "unread", "why": str(e)}
    if s == 404:
        return {"state": "none"}
    if s != 200 or not isinstance(p, dict) or not isinstance(p.get("attestation_bundles"), list):
        return {"state": "unread", "why": "http %s without attestation_bundles" % s}
    pubs, subj = [], set()
    for b in p["attestation_bundles"]:
        if not isinstance(b, dict):
            continue
        pb = b.get("publisher") if isinstance(b.get("publisher"), dict) else {}
        pubs.append({k: pb.get(k) for k in ("kind", "repository", "workflow", "environment")})
        for a in b.get("attestations") or []:
            try:
                stj = json.loads(base64.b64decode(a["envelope"]["statement"]).decode("utf-8"))
                for x in stj["subject"]:
                    if x.get("name") == fn and H64.match(str(x["digest"]["sha256"])):
                        subj.add(x["digest"]["sha256"])
            except (KeyError, TypeError, ValueError, AttributeError):
                continue
    return {"state": "read", "publishers": pubs, "subject_sha256": sorted(subj), "signature_checked": False}


def pypi_wheel(get):
    """the wheels of PYPI_WATCH on PyPI against GitHub's release assets and PyPI's provenance (docstring: pypi_wheel)"""
    proj, ver = PYPI_WATCH
    f = {"project": proj, "version": ver, "state": None, "why": None, "wheels": [], "releases": None}
    try:
        s, j = get(PYPI_URL % (proj, ver))
    except Unreachable as e:
        return dict(f, state="unread", why="PyPI did not answer: " + str(e))
    if s == 404:
        return dict(f, state="not_yet", why="%s %s is not on PyPI" % (proj, ver))
    if s != 200 or not isinstance(j, dict) or not isinstance(j.get("urls"), list):
        return dict(f, state="unread", why="PyPI answered http %s without urls" % s)
    ws = []
    for u in j["urls"]:
        if isinstance(u, dict) and u.get("packagetype") == "bdist_wheel":
            fn, dg = u.get("filename"), (u.get("digests") or {}).get("sha256") if isinstance(u.get("digests"), dict) else None
            if not (isinstance(fn, str) and fn.endswith(".whl") and isinstance(dg, str) and H64.match(dg)):
                return dict(f, state="unread", why="a wheel of %s %s on PyPI has no filename or sha256" % (proj, ver))
            ws.append({"filename": fn, "pypi_sha256": dg, "uploaded": u.get("upload_time_iso_8601"), "yanked": bool(u.get("yanked")),
                       "github": None, "github_same": None, "provenance": None, "provenance_same": None})
    if not ws:
        return dict(f, state="not_yet", why="%s %s is on PyPI without a wheel" % (proj, ver))
    names = {w["filename"]: w for w in ws}
    try:
        rs, rel = get(RELEASES_URL)
    except Unreachable as e:
        rs, rel = None, str(e)
    if rs == 200 and isinstance(rel, list):
        f["releases"] = "read"
        for r in rel:
            for a in (r.get("assets") or []) if isinstance(r, dict) else []:
                w = names.get(a.get("name")) if isinstance(a, dict) else None
                if w is None or (w["github"] or {}).get("sha256"):
                    continue
                dg = a.get("digest")
                ok = isinstance(dg, str) and dg.startswith("sha256:") and bool(H64.match(dg[7:]))
                w["github"] = {"release": r.get("tag_name"), "asset": a.get("name"), "sha256": dg[7:] if ok else None, "via": "asset_digest" if ok else "asset_without_digest"}
        for r in rel:
            if not (isinstance(r, dict) and ver in (str(r.get("tag_name")) + " " + str(r.get("name")))):
                continue
            for a in r.get("assets") or []:
                if not (isinstance(a, dict) and SUMS_NAME.search(str(a.get("name"))) and isinstance(a.get("browser_download_url"), str)):
                    continue
                try:
                    ss, txt = get(a["browser_download_url"], raw=True)
                except Unreachable:
                    continue
                for line in (txt.splitlines() if ss == 200 and isinstance(txt, str) else []):
                    m = re.match(r"^([0-9a-f]{64}) [ *]?(\S+)$", line.strip())
                    w = names.get(m.group(2)) if m else None
                    if w is not None and not (w["github"] or {}).get("sha256"):
                        w["github"] = {"release": r.get("tag_name"), "asset": a["name"], "sha256": m.group(1), "via": "sha256sums"}
    else:
        f["releases"] = "unread: " + (rel if isinstance(rel, str) else "http %s" % rs)
    for w in ws:
        g = (w["github"] or {}).get("sha256")
        w["github_same"] = None if g is None else g == w["pypi_sha256"]
        w["provenance"] = wheel_provenance(get, proj, ver, w["filename"])
        ps = w["provenance"].get("subject_sha256") or []
        w["provenance_same"] = None if not ps else ps == [w["pypi_sha256"]]
    f["wheels"] = ws
    differ = [w["filename"] for w in ws if w["github_same"] is False or w["provenance_same"] is False]
    if differ:
        return dict(f, state="differ", why="a GitHub release or PyPI's provenance names another sha256 for %s" % ", ".join(differ))
    if all(w["github_same"] for w in ws):
        return dict(f, state="match", why="GitHub names the sha256 PyPI serves for %s" % ", ".join(sorted(names)))
    if f["releases"] != "read":
        return dict(f, state="unread", why="the releases of this repository could not be read (%s)" % f["releases"])
    return dict(f, state="no_release_wheel", why="no release of this repository gives a sha256 for %s; PyPI's provenance %s" % (
        ", ".join(w["filename"] for w in ws if not w["github_same"]),
        "names the same sha256" if all(w["provenance_same"] for w in ws) else "was not read or names none"))


def day_facts(get, now, counts):
    """the result's facts: numbers read from public files, beside the checks. A fact that cannot be made says so and never
    stops the run."""
    out = {}
    for k, fn in (("red_zero_streak", lambda: red_zero_streak(get, now, counts)), ("anchored_ledger_days", lambda: anchored_ledger_days(get, now)),
                  ("pypi_wheel", lambda: pypi_wheel(get))):
        try:
            out[k] = fn()
        except Exception as e:
            out[k] = {"unread": "the fact could not be made: %s" % type(e).__name__}
    return out


REDO_CHECKS = {"check_call": "2_admission_ledger", "canary_call": "8_canary_scene"}   # the door's call (GET /seki furui) and the check it shows


def with_redo(get, now, checks):
    """the door calls again within the same day when a call did not reach an answer (cv2, furui.<call>.redo {n, first_at,
    first_error}). The day's call then reads ok, and the first failure would be told nowhere. A check that reads ok on a call
    the door made again becomes a notice naming the first failure, with facts.redo; a red or not_yet check keeps its state and
    gains facts.redo. Today's calls only. Nothing changes when the door does not answer here (the checks already said so)."""
    try:
        ps, p = get(DOOR_POLICY)
    except Unreachable:
        return checks
    fu = p.get("furui") if ps == 200 and isinstance(p, dict) and isinstance(p.get("furui"), dict) else {}
    today = now.strftime("%Y-%m-%d")
    for call, cid in REDO_CHECKS.items():
        k = fu.get(call)
        rd = k.get("redo") if isinstance(k, dict) and k.get("day") == today else None
        if not isinstance(rd, dict):
            continue
        for r in checks:
            if r.get("id") != cid:
                continue
            r.setdefault("facts", {})["redo"] = {"n": rd.get("n"), "first_at": rd.get("first_at"), "first_error": rd.get("first_error")}
            if r.get("state") == "ok":
                r["state"] = "notice"
                r["why"] = "today's %s failed first (%s, at %s) and the door made it again (%s time(s)); the call made again: %s" % (
                    call.replace("_", " "), rd.get("first_error"), rd.get("first_at"), rd.get("n"), r.get("why"))
    return checks


def run(get, now, trigger="manual", walk_get=None):
    if trigger not in TRIGGERS:
        raise ValueError("trigger must be one of " + ", ".join(TRIGGERS))
    checks = check_call_checks(get, now)
    checks.append(check_settle(get, now))
    checks.append(check_resume(get, now))
    checks.append(check_resume_agreement(get, now))
    checks.append(check_content_mismatch(get, now))
    checks.append(check_loss_bound(get, now))
    checks += [check_door_runner(get), check_day_root(get, now), check_leaves(get, now), check_heartbeat(get, now)]
    checks += [check_canary(get, now), check_witness_answer(get, now)]
    checks += [check_cross_client(get, now), check_main_ci(get, now), check_paid_rows(get, now), check_line_delivery(get, now), check_recovery(get, now)]
    checks.append(check_witness_pool(get, now))
    pc = check_paid_chain(get, now)
    checks.append(pc)
    checks.append(check_two_runners(get, now, pc.pop(V05_KEY, []), pc.pop(SHORT_KEY, [])))
    checks.append(check_tasuki(now, pc.pop(CALLS_KEY, None), pc, walk_get or tasuki_get(get)))
    checks = with_redo(get, now, checks)
    checks.append(check_deadlines(get, now, checks))
    checks.sort(key=lambda x: x["id"])
    counts = {k: sum(1 for x in checks if x["state"] == k) for k in ("ok", "red", "notice", "not_yet")}
    verdict = "red" if counts["red"] else ("green" if counts["not_yet"] == 0 else "not_all_checked")
    res = {"schema": "tooshi-daily-v0", "checked_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "trigger": trigger, "verdict": verdict, "counts": counts, "checks": checks}
    res["facts"] = day_facts(get, now, counts)   # after the verdict: the facts read it (red_zero_streak) and change nothing in it
    text = json.dumps(res, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return res, text, hashlib.sha256(text.encode("utf-8")).hexdigest()


def day_view(res):
    """the result without the run's own time and trigger: what every run of the same day after 03:47 UTC should agree on.
    The run's notes (notes(), --notes) are never in res, so they are not in the view either."""
    v = {k: x for k, x in res.items() if k not in ("checked_at", "trigger")}
    v["schema"] = "tooshi-day-view-v0"
    v["day"] = res["checked_at"][:10]
    return v


def day_sha256(res):
    return hashlib.sha256(json.dumps(day_view(res), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()


def tool_sha256():
    with open(__file__, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def witness_record(res, name, vantage, now, tool):
    """an unsigned jidec-path-v1 commitment record for POST /witness: the witness's own day_sha256 of day D"""
    d = res["checked_at"][:10]
    ds = day_sha256(res)
    rec = {
        "schema": "jidec-path-v1", "purpose": "tooshi-day-v0: " + d, "walked_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "base": DAY_URL % d,
        "mode": "commitment", "commitment": ds,
        "witness": {"name": name, "vantage": vantage},
        "establishes": ["the witness ran tools/tooshi/tooshi_daily.py (sha256 %s) on its own machine on %s after 03:47 UTC and read the public endpoints itself" % (tool, d),
                        "commitment is the sha256 of the canonical day view it got (the result without checked_at and trigger, with day); salt is empty"],
        "does_not_establish": ["that the witness is independent of the operator (the record is unsigned; the name is what the witness typed)",
                               "that every reader got the same answers from the endpoints",
                               "anything beyond what the checks read"],
        "tooshi": {"schema": "tooshi-witness-v0", "day": d, "day_sha256": ds, "verdict": res["verdict"], "counts": res["counts"], "tool_sha256": tool},
    }
    return json.dumps(rec, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def http_post(url, obj, timeout=30):
    data = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers=dict(UA, **{"content-type": "application/json"}))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except ValueError:
            return e.code, None


def facts_line(res):
    f = res.get("facts") or {}
    rz, an, pw = f.get("red_zero_streak") or {}, f.get("anchored_ledger_days") or {}, f.get("pypi_wheel") or {}
    return "facts    red_zero_streak %s (since %s)%s anchored_ledger_days %s (%s to %s, gap %s, night %s)%s pypi_wheel %s %s %s" % (
        rz.get("days"), rz.get("since"), (" at_least %s unread %s" % (rz.get("at_least"), rz.get("unread"))) if rz.get("unread") else "",
        an.get("days"), an.get("first_day"), an.get("last_day"), an.get("gap_days"), an.get("night"), (" unread " + str(an["unread"])) if an.get("unread") else "",
        pw.get("version"), pw.get("state"), pw.get("why") or pw.get("unread") or "")


def body(res, sha):
    lines = ["TOOSHI %s: %s" % (res["checked_at"][:10], res["verdict"]), "",
             "ok %(ok)d, red %(red)d, notice %(notice)d, not yet %(not_yet)d" % res["counts"], ""]
    for x in res["checks"]:
        lines.append("- %s: %s. %s" % (x["id"], x["state"], x["why"]))
    lines += ["", "trigger " + res.get("trigger", "manual"), "result sha256 " + sha, "day sha256 " + day_sha256(res)]
    return "\n".join(lines) + "\n"


def selftest():
    now = datetime.datetime(2026, 11, 5, 4, 5, tzinfo=datetime.timezone.utc)
    hsh = globals()["sha"]
    SK, SK2 = b"\x05" * 32, b"\x06" * 32
    PUB = base64.b64encode(ed25519_public(SK)).decode()
    RULES = "2c5a1089a90265717175dd1056be7075472aed44fab5581e6be6e73b1746f195"

    def tree(l):
        if len(l) == 1:
            return l[0]
        k = _split(len(l))
        return _node(tree(l[:k]), tree(l[k:]))

    def path(m, l):
        if len(l) <= 1:
            return []
        k = _split(len(l))
        return path(m, l[:k]) + [tree(l[k:])] if m < k else path(m - k, l[k:]) + [tree(l[:k])]

    def envelope(d, i, key=SK, **chk):
        k = {"schema": "furui-check-v1", "input_commit": hsh("ic%s%d" % (d, i)), "rules_sha256": RULES, "scope_sha256": hsh("scope"), "action_binding_digest": "3" * 64,
             "contract_sha256": "4" * 64, "trace_sha256": "5" * 64, "decision": "pass", "marks": [], "unread": False, "answered": True, "stage_reached": 4,
             "checked_at_height": 100 + i, "nonce": "%032x" % (i + 1), "signed_at": d + "T03:47:1%d.000Z" % i}
        k.update(chk)
        e = {"schema": "furui-check-signed-v1", "check": k, "signer": dict(SIGNER), "signatures": []}
        e["signatures"] = [{"alg": "ed25519", "domain": "horizonshield.dev", "key_id": "runner-1", "sig": base64.b64encode(ed25519_sign(key, envelope_message(e))).decode()}]
        return e

    def day_world(d, envs, entry, batch_day):
        lv = [leaf_hash(e) for e in envs]
        root = tree(lv)
        rc = canonical({"schema": "furui-check-day-v0", "day": d, "signer": SIGNER, "n": len(lv), "tree": "rfc6962-sha256", "root": root})
        s_ = hsh(rc)
        w = {RUNNER + "/furui/day/%s/status" % d: (200, {"day": d, "status": {"state": "accepted", "accepted": True, "refused": False, "http": 201, "attempts": 1, "n": len(lv), "root": root, "ledger_canonical_sha256": s_}}),
             LEDGER + "/furui-check-day/" + s_: (200, {"canonical_sha256": s_, "record_canonical": rc, "status": "anchored", "ledger_entry": entry}),
             LEDGER + "/ledger/%d?format=json" % entry: (200, {"n": entry, "created_at": batch_day + "T00:30:40.000Z", "record_canonical": '{"records":[{"canonical_sha256":"%s"}]}' % s_})}
        for i, e in enumerate(envs):
            w[RUNNER + "/furui/day/%s/leaf/%d" % (d, i)] = (200, {"day": d, "index": i, "n": len(lv), "root": root, "leaf_sha256": lv[i], "envelope_sha256": hsh(canonical(e)), "envelope": e,
                                                                 "proof": path(i, lv), "proof_kind": "rfc6962-audit-path", "day_record": {"state": "accepted", "ledger_canonical_sha256": s_}, "kept_until": "2026-11-11"})
        return w, s_

    def admission(e, **content):
        k = e["check"]
        b = {"rules": "a2a-content-check-v1", "input_commit": k["input_commit"], "check_sha256": hsh(canonical(k)), "rules_sha256": k["rules_sha256"], "scope_sha256": k["scope_sha256"],
             "decision": k["decision"], "marks": k["marks"], "unread": k["unread"], "answered": k["answered"], "checked": True}
        b.update(content)
        t = canonical({"schema": "a2a-admission-v0", "rules": {"version": "0.4"}, "decision": "admit", "reasons": ["within_grant"], "content": b})
        return t, hsh(t)

    RESUME_URL = LEDGER + "/resume?endpoint=https%3A%2F%2Fshield.the-horizons-innovation.com%2F"
    D3 = [envelope("2026-11-03", 0, nonce="heartbeat-2026-11-03"), envelope("2026-11-03", 1), envelope("2026-11-03", 2)]
    W3, sha = day_world("2026-11-03", D3, 250, "2026-11-05")

    CSHA = hsh("the check contract")
    REC3 = hsh("the admission of 11-03")
    EXE3 = canonical({"schema": "a2a-execution-v0", "admission_ref": [{"admission_sha256": hsh("adm3")}]})
    SET3 = canonical({"schema": "a2a-settlement-v1.19", "verdict": "within_grant", "status": "final", "contract_sha256": CSHA})
    DAY3 = {"record_sha256": REC3, "admission_sha256": hsh("adm3"), "execution_sha256": hsh(EXE3), "settled": True, "settle": "v1.19",
            "verdict": "within_grant", "status": "final", "settlement_sha256": hsh(SET3)}
    INDEX = {"schema": "seki-check-loop-index-v0", "contract_sha256": CSHA, "first_day": "2026-11-03", "days": {"2026-11-03": DAY3}}

    def loop_world():
        return {CHECK_RUNS + "index.json": (200, json.loads(json.dumps(INDEX))), CHECK_RUNS + "2026-11-03/settlement.json": (200, SET3),
                LEDGER + "/admission/" + REC3: (200, {"canonical_sha256": REC3, "status": "anchored", "ledger_entry": 300}),
                AGREEMENT + "/execution/" + hsh(EXE3): (200, EXE3),
                AGREEMENT + "/contract/" + CSHA + "/report": (200, {"intake": {"verdict": "accepted", "anchor": {"status": "batched", "ledger_entry": 300}}}),
                LEDGER + "/verify/300": (200, {"bitcoin_status": "confirmed"})}

    SKW, SKW2 = b"\x07" * 32, b"\x08" * 32   # a witness's key (served at its key_url), another key
    PUBW = base64.b64encode(ed25519_public(SKW)).decode()

    def answer(d, ds, root, n, key=SKW, **chg):
        a = {"schema": "witness-answer-v0", "kind": "furui-day", "day": d, "day_sha256": ds, "n": n, "root": root, "leaf_index": [0], "recomputed": ["envelope_shape", "leaf_sha256"],
             "tool": "nenrin-verify 0.8.1 furui-day", "observed_at": "2026-11-05T02:00:00Z", "limits": ["a line"],
             "witness": {"name": "w", "key_id": "ed25519:" + hashlib.sha256(ed25519_public(SKW)).hexdigest()[:16], "key_url": "https://w.example/keys/witness.json"}}
        a.update(chg)
        a["signature"] = {"alg": "ed25519", "key_id": a["witness"]["key_id"], "sig": base64.b64encode(ed25519_sign(key, ("witness-answer-v0\n" + canonical(a)).encode("utf-8"))).decode()}
        return a

    def witness_world(d, ds, root, n, answers, anchored=(), unsigned=False):
        """the intake as /witness/pending, /witness/<sha>, the head and one witness batch made the day after d show it"""
        w, pend, batch = {}, [], []
        for i, a in enumerate(list(answers) + list(anchored)):
            rc = canonical({"schema": "jidec-path-v1", "purpose": "furui-day-v0: " + d, "mode": "commitment", "commitment": a["day_sha256"], "answer": a})
            s_ = hsh(rc)
            st = {"sha": s_, "record_canonical": rc, "signed": not unsigned, "public_key_ed25519_b64": PUBW, "signed_domain": None if unsigned else "w.example",
                  "signature_ed25519_b64": base64.b64encode(ed25519_sign(SKW, rc.encode("utf-8"))).decode(), "purpose": "furui-day-v0: " + d}
            if i < len(answers):
                pend.append({"sha": s_, "purpose": st["purpose"]}); w[LEDGER + "/witness/" + s_] = (200, dict(st, status="pending"))
            else:
                batch.append({"sha": s_, "purpose": st["purpose"], "signed": True}); w[LEDGER + "/witness/" + s_] = (200, {"status": "anchored", "sha": s_, "ledger_entry": 280, "record": st})
        w[LEDGER + "/witness/pending"] = (200, {"count": len(pend), "pending": pend + [{"sha": hsh("other"), "purpose": "tooshi-day-v0: " + d}]})
        w[LEDGER + "/ledger/head"] = (200, {"n": 280})
        w[LEDGER + "/ledger/280?format=json"] = (200, {"n": 280, "created_at": "2026-11-05T00:30:41.000Z", "record_canonical": canonical({"schema": "nenrin-witness-batch-v1", "records": batch})})
        w[LEDGER + "/ledger/279?format=json"] = (200, {"n": 279, "created_at": "2026-11-04T23:00:00.000Z", "record_canonical": "{}"})
        w[LEDGER + "/ledger/278?format=json"] = (200, {"n": 278, "created_at": d + "T23:00:00.000Z", "record_canonical": "{}"})
        return w

    # 10 to 15: the default answers hold (every new check ok on 11-05 at 04:05); the cases below change one answer each
    LO11 = anchor(now) - CI_WINDOW
    CANDS = ["https://%s.example/mcp" % x for x in "abcde"]
    DRAWN = cross_draw("2026-11-05", CANDS)

    def cross(**chg):
        x = {"schema": "tooshi-cross-client-v0", "day": "2026-11-05", "sdk": dict(CROSS_SDK), "gate": {"origin": GATE, "version": "0.4.24", "commit": "abc"}, "skipped": None,
             "own": CROSS_OWN, "candidates": list(CANDS), "picked": list(DRAWN),
             "targets": [{"endpoint": e, "kind": "own" if e == CROSS_OWN else "drawn", "gate": {"answered": True, "pass": True, "reason": "MCP endpoint responds to initialize and tools/list", "record_sha256": "f" * 64},
                          "sdk": {"reached": True, "pass": True, "reason": "initialize and tools/list answered; 2 well-formed tool(s)", "tools": 2}} for e in [CROSS_OWN] + DRAWN]}
        x.update(chg)
        return (200, x)

    def target(i, gate=None, sdk=None):
        x = json.loads(json.dumps(cross()[1]))
        x["targets"][i]["gate"].update(gate or {})
        x["targets"][i]["sdk"].update(sdk or {})
        return (200, x)

    def ci_run(i, conclusion="success", at="2026-11-04T12:00:00Z", name="public-boundary", **f):
        return dict({"id": i, "name": name, "path": ".github/workflows/%s.yml" % name, "event": "push", "head_branch": "main", "status": "completed", "conclusion": conclusion,
                     "created_at": at, "head_sha": "%040x" % i}, **f)

    def ci(runs):
        return (200, {"total_count": len(runs), "workflow_runs": runs})

    def drill(src, n, **f):
        x = {"schema": "nenrin-survive-drill-v0", "outcome": "rebuilt", "chain": {"broken_at": None, "rebuilt_through": n}, "digests": {"ok": n, "failed": []}, "source": {"custodian": src}}
        x.update(f)
        return (200, x)

    def v2_world():
        return {GATE + "/health": (200, {"ok": True, "gate_version": "0.4.24", "gate_commit": "abc"}),
                CROSS_SOURCE: cross(),
                ci_runs_url(CI_REPOS[0], LO11): ci([ci_run(1), ci_run(2, name="gitleaks")]),
                GATE + "/register": (200, {"count": 3, "rows": [{"endpoint": CROSS_OWN, "tier": "self", "latest": {"at": "2026-11-04T18:00:49.660Z", "status": "verified"}},
                                                                 {"endpoint": "https://a.example/mcp", "tier": "free", "latest": {"at": "2026-10-30T18:00:00.000Z"}},
                                                                 {"endpoint": "https://paid.example/mcp", "tier": "paid", "latest": {"at": "2026-11-04T18:00:12.000Z", "status": "verified"}}]}),
                LINE_HEALTH[0][1]: (200, {"status": "ok", "service": "hs-kira-line", "version": "v26", "line_last_fail": None}),
                LINE_HEALTH[1][1]: (200, {"status": "ok", "service": "hs-kira-group", "version": "group-7", "line_last_fail": None}),
                SWH_VISIT: (200, {"origin": SWH_ORIGIN, "date": "2026-11-04T10:57:22.815000+00:00", "status": "full", "visit": 99}),
                DRILLS + "latest-github.json": drill("github", 279),
                DRILLS + "latest-swh.json": drill("software-heritage", 270)}
    # 16: below the entries 278 to 280 of witness_world, one witness batch of 2026-10-20 with three outside witnesses of a
    # furui-day, and entry 276 made before the window (2026-10-06T03:47 UTC at the 11-05 run), where the read stops
    def pool_rec(dom, purpose="furui-day-v0: 2026-10-18", signed=True, name="A Person"):
        r = {"sha": hsh("%s|%s" % (dom, purpose)), "purpose": purpose, "witness_name": name, "vantage": "a laptop", "signed": signed, "mode": "commitment"}
        if dom:
            r["signed_domain"] = dom
        return r

    def pool_batch(n, at, recs, **f):
        return (200, dict({"n": n, "created_at": at, "record_canonical": canonical({"schema": "nenrin-witness-batch-v1", "anchored_at": at, "count": len(recs), "records": recs})}, **f))
    POOL3 = [pool_rec("a.example"), pool_rec("b.example"), pool_rec("github.com/someone", purpose="tooshi-day-v0: 2026-10-19")]

    def pool_world(recs=None, n277="2026-10-20T00:30:30.000Z"):
        return {LEDGER + "/ledger/277?format=json": pool_batch(277, n277, POOL3 if recs is None else recs),
                LEDGER + "/ledger/276?format=json": (200, {"n": 276, "created_at": "2026-10-06T03:46:59.000Z", "record_canonical": "{}"})}

    MM_ROW = {"service": "compare", "scene": "mismatch", "tickets": 50, "status": 400, "error": "content_mismatch", "nonce": "ab" * 16}

    def world(cc=False, prev=True, d4key=SK, adm_today=None, adm_prev=None, canary=None, canary_prev=True, wit=None, **over):
        w = {
            RUNNER + "/health": (200, {"runner": "hs-furui-runner 0.4.0", "key_id": "runner-1", "public_key_ed25519_b64": PUB, "rules_sha256": RULES if cc else None, "caps": dict(CAPS), "anthropic_key_set": True}),
            LEDGER + "/.well-known/furui-check-keys.json": (200, {"use": "furui-check", "keys": [{"key_id": "runner-1", "public_key_ed25519_b64": PUB, "from_height": 0, "revoked_height": None}]}),
            DOOR_POLICY: (200, {"furui": {"policy": {"required": False}}}),
            RUNNER + "/furui/heartbeat": (200, {"at": "2026-11-05T03:17:09.000Z", "ok": True, "decision": "pass", "answered": True, "marks": [], "capped": False, "spent_usd": 0.03}),
        }
        w.update(W3)
        w[HEARTBEAT_RUNS + "2026-11-04/RUN.json"] = (200, {"store": "hs-seki-demo", "ran_at": "2026-11-04T21:18:40Z", "calls": [MM_ROW]})   # 24 reads 11-04
        st3 = W3[RUNNER + "/furui/day/2026-11-03/status"][1]["status"]   # 9 reads the day before yesterday (11-03)
        w.update(witness_world("2026-11-03", sha, st3["root"], st3["n"], *(wit(sha, st3["root"], st3["n"]) if wit else ([answer("2026-11-03", sha, st3["root"], st3["n"])],))))
        w.update(v2_world())
        w.update(pool_world())
        if cc:
            e5 = envelope("2026-11-05", 0)
            t5, r5 = adm_today or admission(e5)
            D4 = [envelope("2026-11-04", 0, key=d4key, nonce="heartbeat-2026-11-04"), envelope("2026-11-04", 1, key=d4key),
                  envelope("2026-11-04", 2, key=d4key, decision="stop", scope_sha256=hsh("the canary scope of 11-04"), stage_reached=3)]
            W4, _s4 = day_world("2026-11-04", D4, 260, "2026-11-06")
            w.update(W4)
            t4, r4 = adm_prev or admission(D4[1])
            call = {"at": "2026-11-05T03:47:12.345Z", "day": "2026-11-05", "ok": True, "decision": "admit", "reasons": ["within_grant"], "admission_sha256": hsh("adm5"),
                    "record_sha256": r5, "version": "0.4", "content": {"checked": True, "decision": "pass", "marks": [], "rules_sha256": RULES}, "published": {"status": 201, "accepted": True}}
            fu = {"policy": {"required": False, "rules_sha256": RULES, "runner_wait_ms": 25000, "runner_public_key_ed25519_b64": PUB}, "check_call": call,
                  "stores_requiring": [CHECK_STORE]}
            if prev:
                fu["check_call_prev"] = dict(call, at="2026-11-04T03:47:12.345Z", day="2026-11-04", record_sha256=r4, admission_sha256=hsh("adm4"))
            kc = {"at": "2026-11-05T03:47:31.000Z", "day": "2026-11-05", "ok": True, "error": None, "touched": False, "answers_read": 2, "decision": "stop", "answered": True,
                  "stage_reached": 3, "marks": [], "mark_sha256": hsh("mark 11-05"), "check_sha256": hsh("canary check 11-05"), "scope_sha256": hsh("the canary scope of 11-05"), "rules_sha256": RULES}
            kc.update(canary or {})
            fu["canary_call"] = kc
            if canary_prev:
                fu["canary_call_prev"] = dict(kc, at="2026-11-04T03:47:31.000Z", day="2026-11-04", touched=False, decision="stop", ok=True, error=None,
                                              check_sha256=hsh(canonical(D4[2]["check"])), scope_sha256=hsh("the canary scope of 11-04"), mark_sha256=hsh("mark 11-04"))
            w[DOOR_POLICY] = (200, {"furui": fu})
            w.update(loop_world())
            w[RESUME_URL] = (200, {"schema": "nenrin-resume-v1", "agreements": [{"record_sha256": CSHA, "source_ledger_n": 300}], "not_counted": [{"n": 271, "record_sha256": r5, "why": "not_yet_anchored", "kind": "admission"}],
                                   "admissions": [{"record_sha256": r4, "ledger_n": 261, "decision": "admit", "revoked": False,
                                                   "content": {"checked": True, "decision": "pass", "marks": [], "rules_sha256": RULES}}]})
            for t, r in ((t5, r5), (t4, r4)):
                w[LEDGER + "/admission/" + r] = (200, {"canonical_sha256": r, "record_canonical": t, "status": "pending_anchor", "ledger_entry": None})
                w[DOOR_RECORD + r] = (200, t)
        w.update(over)

        def get(url, raw=False):
            v = w.get(url, (404, {"error": "not_found"}))
            if v == "down":
                raise Unreachable(url + ": http 503 after 3 tries")
            if callable(v):
                return v(w)
            return v
        return get

    def states(get, when=now):
        res, _, _ = run(get, when)
        return res["verdict"], {x["id"]: x["state"] for x in res["checks"]}

    cases = []
    v, s = states(world())
    cases.append(("a whole day that holds: the three checkable checks ok, the four others not_yet, verdict not_all_checked", (v, s["5_door_runner"], s["6_daily_root"], s["7_heartbeat_scene"], s["1_sieve_admission"]), ("not_all_checked", "ok", "ok", "ok", "not_yet")))
    v, s = states(world(**{LEDGER + "/.well-known/furui-check-keys.json": (200, {"keys": [{"key_id": "runner-1", "public_key_ed25519_b64": "B" * 43 + "=", "revoked_height": None}]})}))
    cases.append(("the runner's public half differs from the ledger's: red", (v, s["5_door_runner"]), ("red", "red")))
    v, s = states(world(**{DOOR_POLICY: (200, {"furui": {"policy": {"required": True, "rules_sha256": "cd" * 32}}})}))
    cases.append(("the door names a rules id the runner does not carry: red", (v, s["5_door_runner"]), ("red", "red")))
    v, s = states(world(**{RUNNER + "/health": (200, {"key_id": "runner-1", "public_key_ed25519_b64": PUB, "rules_sha256": None, "caps": {"request_usd": 0.4, "day_usd": 50, "party_per_day": 100}, "anthropic_key_set": True})}))
    cases.append(("caps other than 0.40 / 5.00 / 100: red", s["5_door_runner"], "red"))
    v, s = states(world(**{RUNNER + "/furui/heartbeat": (200, {"at": "2026-11-04T03:17:09.000Z", "ok": True, "decision": "pass", "answered": True, "marks": [], "capped": False, "spent_usd": 0.03})}))
    cases.append(("the heartbeat is from yesterday (old): red", (v, s["7_heartbeat_scene"]), ("red", "red")))
    v, s = states(world(**{RUNNER + "/furui/heartbeat": (200, {"at": "2026-11-05T03:17:09.000Z", "ok": True, "decision": "stop", "answered": True, "marks": ["off_topic"], "capped": False, "spent_usd": 0.03})}))
    cases.append(("the heartbeat answered other than pass with no marks: red", s["7_heartbeat_scene"], "red"))
    v, s = states(world(**{RUNNER + "/furui/heartbeat": (200, {"at": "2026-11-05T03:17:09.000Z", "ok": True, "decision": None, "answered": False, "marks": [], "capped": True, "spent_usd": 0.4})}))
    cases.append(("the heartbeat hit a cap: notice, not red", (v, s["7_heartbeat_scene"]), ("not_all_checked", "notice")))
    v, s = states(world(**{RUNNER + "/furui/heartbeat": (200, {"at": None})}), datetime.datetime(2026, 11, 2, 9, 0, tzinfo=datetime.timezone.utc))
    cases.append(("before the first scene (11-02): the heartbeat is not_yet, the day root is not_yet", (s["7_heartbeat_scene"], s["6_daily_root"]), ("not_yet", "not_yet")))
    v, s = states(world(**{RUNNER + "/furui/heartbeat": (200, {"at": None})}))
    cases.append(("no scene ever, after the first day: red", s["7_heartbeat_scene"], "red"))
    v, s = states(world(**{RUNNER + "/furui/day/2026-11-03/status": (200, {"status": {"state": "retrying", "accepted": False, "refused": True, "http": 422, "attempts": 5, "refusals": ["key_not_listed"]}})}))
    cases.append(("the day status says refused (retrying): red", (v, s["6_daily_root"]), ("red", "red")))
    v, s = states(world(**{RUNNER + "/furui/day/2026-11-03/status": (200, {"status": {"state": "empty", "accepted": False, "refused": False, "attempts": 0}})}))
    cases.append(("an empty day: notice, not red", s["6_daily_root"], "notice"))
    v, s = states(world(**{RUNNER + "/furui/day/2026-11-03/status": (200, {"status": None})}))
    cases.append(("no closed status for the day: red", s["6_daily_root"], "red"))
    v, s = states(world(**{LEDGER + "/furui-check-day/" + sha: (200, {"canonical_sha256": sha, "status": "pending_anchor", "ledger_entry": None})}))
    cases.append(("accepted but not in a batch: red", s["6_daily_root"], "red"))
    v, s = states(world(**{LEDGER + "/ledger/250?format=json": (200, {"n": 250, "created_at": "2026-11-06T00:30:40.000Z", "record_canonical": sha})}))
    cases.append(("in a batch of another day: red", s["6_daily_root"], "red"))
    v, s = states(world(**{RUNNER + "/health": "down"}))
    cases.append(("the runner's health answers 5xx three times: red", (v, s["5_door_runner"]), ("red", "red")))
    v, s = states(world(**{RUNNER + "/furui/day/2026-11-03/status": "down", RUNNER + "/furui/heartbeat": "down"}))
    cases.append(("the day status and the heartbeat answer 5xx: both red", (s["6_daily_root"], s["7_heartbeat_scene"]), ("red", "red")))
    # the leaves (6b) and the door's check call (1 to 3); 4 stays not_yet; nothing here is ever green while 4 is not_yet
    v, s = states(world())
    cases.append(("before the door stage and the loop: 1 to 4 and 4b not_yet (no furui.check_call, no check-runs index), the leaves of 11-03 ok", (s["1_sieve_admission"], s["2_admission_ledger"], s["3_ledger_settle"], s["4_door_resume"], s["4b_resume_agreement"], s["6b_daily_leaf"]), ("not_yet", "not_yet", "not_yet", "not_yet", "not_yet", "ok")))
    v, s = states(world(cc=True))
    cases.append(("the door's check call and its MUSUBI loop, everything holds: 1 to 7, 4b and 6b ok, the verdict green", (v, s["1_sieve_admission"], s["2_admission_ledger"], s["3_ledger_settle"], s["4_door_resume"], s["4b_resume_agreement"], s["5_door_runner"], s["6_daily_root"], s["6b_daily_leaf"], s["7_heartbeat_scene"]), ("green", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok")))
    v, s = states(world(cc=True, prev=False))
    cases.append(("no check_call_prev in the door yet: 1 and 4 stay not_yet (never ok), 2 and 3 ok, the verdict not green", (v, s["1_sieve_admission"], s["2_admission_ledger"], s["3_ledger_settle"], s["4_door_resume"]), ("not_all_checked", "not_yet", "ok", "ok", "not_yet")))
    v, s = states(world(**{DOOR_POLICY: (200, {"furui": {"policy": {"required": False}, "check_call": None}})}))
    cases.append(("the door shows check_call null (no call yet): 1 and 2 not_yet, never ok", (s["1_sieve_admission"], s["2_admission_ledger"]), ("not_yet", "not_yet")))
    v, s = states(world(cc=True), datetime.datetime(2026, 11, 5, 3, 40, tzinfo=datetime.timezone.utc))
    cases.append(("a run before 03:47 UTC: 1 and 2 not_yet (3 reads the day before yesterday and does not wait)", (s["1_sieve_admission"], s["2_admission_ledger"], s["3_ledger_settle"]), ("not_yet", "not_yet", "ok")))
    g = world(cc=True)
    pol = json.loads(json.dumps(g(DOOR_POLICY)[1]))
    def door_with(**ccf):
        p2 = json.loads(json.dumps(pol)); p2["furui"]["check_call"].update(ccf); return (200, p2)
    v, s = states(world(cc=True, **{DOOR_POLICY: door_with(day="2026-11-04", at="2026-11-04T03:47:12.345Z")}))
    cases.append(("red: the last call is yesterday's (the cron did not run today)", (v, s["1_sieve_admission"], s["2_admission_ledger"]), ("red", "red", "red")))
    v, s = states(world(cc=True, **{DOOR_POLICY: door_with(ok=False, error="chain_view_unavailable")}))
    cases.append(("red: today's call failed", (v, s["2_admission_ledger"]), ("red", "red")))
    v, s = states(world(cc=True, **{DOOR_POLICY: door_with(published={"status": 503, "accepted": False})}))
    cases.append(("red: the door did not hand the record to the ledger", (v, s["2_admission_ledger"]), ("red", "red")))
    r5 = pol["furui"]["check_call"]["record_sha256"]
    v, s = states(world(cc=True, **{LEDGER + "/admission/" + r5: (404, {"error": "not_found"})}))
    cases.append(("red: the ledger does not serve the record (1 and 2 red)", (v, s["1_sieve_admission"], s["2_admission_ledger"]), ("red", "red", "red")))
    t5 = g(DOOR_RECORD + r5)[1]
    v, s = states(world(cc=True, **{DOOR_RECORD + r5: (200, t5 + " ")}))
    cases.append(("red: the door serves other bytes than the ledger", (v, s["2_admission_ledger"]), ("red", "red")))
    e5 = envelope("2026-11-05", 0, marks=["off_topic"])
    v, s = states(world(cc=True, adm_today=admission(e5)))
    cases.append(("red: today's record says off_topic (not the fixed answer)", (v, s["1_sieve_admission"], s["2_admission_ledger"]), ("red", "red", "red")))
    v, s = states(world(cc=True, adm_today=admission(envelope("2026-11-05", 0, rules_sha256="77" * 32))))
    cases.append(("red: the record's rules id is not the door's", (v, s["2_admission_ledger"]), ("red", "red")))
    v, s = states(world(cc=True, adm_today=admission(envelope("2026-11-05", 0), note="free text in the block")))
    cases.append(("red: the content block carries a field outside the closed list", (v, s["2_admission_ledger"]), ("red", "red")))
    v, s = states(world(cc=True, adm_prev=admission(envelope("2026-11-04", 7))))
    cases.append(("red: yesterday's record names a check no leaf of that day carries", (v, s["1_sieve_admission"]), ("red", "red")))
    v, s = states(world(cc=True, d4key=SK2))
    cases.append(("red: yesterday's envelope is not signed by runner-1", (v, s["1_sieve_admission"]), ("red", "red")))
    v, s = states(world(**{RUNNER + "/furui/day/2026-11-03/leaf/2": (410, {"error": "gone"})}))
    cases.append(("red: a leaf of the day before yesterday is gone (410) inside the 7 days", (v, s["6b_daily_leaf"]), ("red", "red")))
    lf = json.loads(json.dumps(W3[RUNNER + "/furui/day/2026-11-03/leaf/0"][1])); lf["proof"] = list(reversed(lf["proof"]))
    v, s = states(world(**{RUNNER + "/furui/day/2026-11-03/leaf/0": (200, lf)}))
    cases.append(("red: a leaf's audit path does not rebuild the root", (v, s["6b_daily_leaf"]), ("red", "red")))
    lf = json.loads(json.dumps(W3[RUNNER + "/furui/day/2026-11-03/leaf/2"][1])); lf["envelope"]["check"]["decision"] = "stop"
    v, s = states(world(**{RUNNER + "/furui/day/2026-11-03/leaf/2": (200, lf)}))
    cases.append(("red: a leaf's envelope was changed after it was hashed", (v, s["6b_daily_leaf"]), ("red", "red")))
    lf = json.loads(json.dumps(W3[RUNNER + "/furui/day/2026-11-03/leaf/1"][1])); lf["envelope"]["check"]["note"] = "LEAK"
    cases.append(("a leaf that is not read (1 of 0..2) is not checked; 0 and n-1 are", states(world(**{RUNNER + "/furui/day/2026-11-03/leaf/1": (200, lf)}))[1]["6b_daily_leaf"], "ok"))
    v, s = states(world(), datetime.datetime(2026, 11, 4, 4, 5, tzinfo=datetime.timezone.utc))
    cases.append(("before the first kept day (11-02 is read on 11-04): the leaves are not_yet", s["6b_daily_leaf"], "not_yet"))
    v, s = states(world(**{RUNNER + "/furui/day/2026-11-03/status": (200, {"status": {"state": "empty", "accepted": False}})}))
    cases.append(("an empty day: the leaves are a notice, not red", s["6b_daily_leaf"], "notice"))
    v, s = states(world(cc=True, **{DOOR_POLICY: (200, dict(pol, furui=dict(pol["furui"], policy={"required": True})))}))
    cases.append(("red: the door requires the check but names no rules id", s["5_door_runner"], "red"))
    v, s = states(world(cc=True, **{DOOR_POLICY: (200, dict(pol, furui=dict(pol["furui"], policy=dict(pol["furui"]["policy"], runner_public_key_ed25519_b64="B" * 43 + "="))))}))
    cases.append(("red: the door checks envelopes with another public half than the runner's", s["5_door_runner"], "red"))
    v, s = states(world(cc=True, **{DOOR_POLICY: (200, dict(pol, furui=dict(pol["furui"], stores_requiring=[])))}))
    cases.append(("red: the door makes check calls and its check store no longer requires the content check", (v, s["5_door_runner"]), ("red", "red")))
    v, s = states(world(cc=True, **{DOOR_POLICY: (200, dict(pol, furui={k: x for k, x in pol["furui"].items() if k != "stores_requiring"}))}))
    cases.append(("red: the door makes check calls and names no stores_requiring", s["5_door_runner"], "red"))
    # 4: yesterday's record in the relying party's Resume
    rj = json.loads(json.dumps(g(RESUME_URL)[1]))
    r4 = pol["furui"]["check_call_prev"]["record_sha256"]
    def resume_with(**f):
        x = json.loads(json.dumps(rj)); x.update(f); return (200, x)
    cases.append(("4 ok: the Resume of shield.the-horizons-innovation.com lists yesterday's record (admit, not revoked, the fixed content)", states(world(cc=True))[1]["4_door_resume"], "ok"))
    v, s = states(world(cc=True, **{RESUME_URL: resume_with(admissions=[])}))
    cases.append(("4 red: yesterday's record is in neither admissions[] nor not_counted", (v, s["4_door_resume"]), ("red", "red")))
    v, s = states(world(cc=True, **{RESUME_URL: resume_with(admissions=[], not_counted=[{"n": 261, "record_sha256": r4, "why": "not_yet_anchored", "kind": "admission"}])}))
    cases.append(("4 not_yet: batched, not anchored yet (not_counted not_yet_anchored); the verdict is not green", (v, s["4_door_resume"]), ("not_all_checked", "not_yet")))
    v, s = states(world(cc=True, **{RESUME_URL: resume_with(admissions=[], not_counted=[{"n": 261, "record_sha256": r4, "why": "admission_fields_not_closed", "kind": "admission"}])}))
    cases.append(("4 red: the Resume refuses to count yesterday's record (not closed)", (v, s["4_door_resume"]), ("red", "red")))
    v, s = states(world(cc=True), datetime.datetime(2026, 11, 5, 0, 50, tzinfo=datetime.timezone.utc))
    cases.append(("4 not_yet: before the ledger's batch window ends (00:50 UTC), the Resume is not read", s["4_door_resume"], "not_yet"))
    v, s = states(world(cc=True, **{RESUME_URL: "down"}))
    cases.append(("4 red: the Resume answers 5xx three times", (v, s["4_door_resume"]), ("red", "red")))
    v, s = states(world(cc=True, **{RESUME_URL: (200, {"schema": "nenrin-resume-v1", "agreements": [{"record_sha256": CSHA, "source_ledger_n": 300}]})}))
    cases.append(("4 not_yet: the Resume carries no admissions[] (never ok)", (v, s["4_door_resume"]), ("not_all_checked", "not_yet")))
    a4 = rj["admissions"][0]
    v, s = states(world(cc=True, **{RESUME_URL: resume_with(admissions=[dict(a4, revoked=True)])}))
    cases.append(("4 red: listed but revoked", s["4_door_resume"], "red"))
    v, s = states(world(cc=True, **{RESUME_URL: resume_with(admissions=[dict(a4, content=dict(a4["content"], marks=["off_topic"], decision="stop"))])}))
    cases.append(("4 red: listed with another content answer than the fixed one", s["4_door_resume"], "red"))
    v, s = states(world(cc=True, **{DOOR_POLICY: (200, dict(pol, furui=dict(pol["furui"], check_call_prev=None)))}))
    cases.append(("4 not_yet: the door's previous call is null (its first day)", s["4_door_resume"], "not_yet"))
    v, s = states(world(cc=True, **{DOOR_POLICY: (200, dict(pol, furui=dict(pol["furui"], check_call_prev=dict(pol["furui"]["check_call_prev"], day="2026-11-03"))))}))
    cases.append(("4 red: the door's previous call is not yesterday's", s["4_door_resume"], "red"))
    v, s = states(world())
    cases.append(("4 not_yet: the door shows no check call at all", s["4_door_resume"], "not_yet"))
    # 3: the check call's MUSUBI settlement; 4b: the check contract in the Resume's agreements[]
    def loop_with(day=None, **f):
        ix = json.loads(json.dumps(INDEX)); ix["days"]["2026-11-03"].update(day or {}); ix.update(f); return (200, ix)
    cases.append(("3 ok: the call of 11-03 settled within_grant, final under v1.19, admission anchored, execution served", states(world(cc=True))[1]["3_ledger_settle"], "ok"))
    v, s = states(world(cc=True, **{CHECK_RUNS + "index.json": (404, None)}))
    cases.append(("3 and 4b not_yet: the loop is not in production (no index), never ok, the verdict not green", (v, s["3_ledger_settle"], s["4b_resume_agreement"]), ("not_all_checked", "not_yet", "not_yet")))
    v, s = states(world(cc=True, **{CHECK_RUNS + "index.json": loop_with(first_day="2026-11-04")}))
    cases.append(("3 not_yet: the day before yesterday is before the loop's first day", s["3_ledger_settle"], "not_yet"))
    v, s = states(world(cc=True, **{CHECK_RUNS + "index.json": (200, dict(INDEX, days={}))}))
    cases.append(("3 red: the day is not filed after the loop's first day", (v, s["3_ledger_settle"]), ("red", "red")))
    v, s = states(world(cc=True, **{CHECK_RUNS + "index.json": loop_with(day={"settled": False, "status": None, "verdict": None})}))
    cases.append(("3 not_yet: filed, waiting for Bitcoin (within 72 hours of filing)", (v, s["3_ledger_settle"]), ("not_all_checked", "not_yet")))
    UNS = {"settled": False, "status": None, "verdict": None}

    def settle_at(when, days):
        ix = json.loads(json.dumps(INDEX))
        for k, f in days.items():
            ix["days"][k] = dict(DAY3, **f)
        r = check_settle(world(cc=True, **{CHECK_RUNS + "index.json": (200, ix)}), when)
        return r["state"], r["facts"].get("stalled")
    at = lambda d, h, m: datetime.datetime.strptime(d, "%Y-%m-%d").replace(hour=h, minute=m, tzinfo=datetime.timezone.utc)
    cases.append(("3 not_yet: 11-03 unsettled at 11-06 21:16, one minute before 72 hours after its filing at 11-03 21:17 (11-04 the day before yesterday, unsettled)",
                  settle_at(at("2026-11-06", 21, 16), {"2026-11-03": UNS, "2026-11-04": UNS}), ("not_yet", None)))
    cases.append(("3 red: 11-03 unsettled at 11-06 21:17, 72 hours after its filing at 11-03 21:17",
                  settle_at(at("2026-11-06", 21, 17), {"2026-11-03": UNS, "2026-11-04": UNS}), ("red", ["2026-11-03"])))
    cases.append(("3 red: at the 04:05 run of 11-07, 11-03 still unsettled (the day before yesterday 11-05 filed and waiting)",
                  settle_at(at("2026-11-07", 4, 5), {"2026-11-03": UNS, "2026-11-05": UNS}), ("red", ["2026-11-03"])))
    cases.append(("3 not_yet: at the 04:05 run of 11-07, 11-03 settled final, 11-04 unsettled but within 72 hours of 11-04 21:17, 11-05 waiting",
                  settle_at(at("2026-11-07", 4, 5), {"2026-11-04": UNS, "2026-11-05": UNS}), ("not_yet", None)))
    cases.append(("3 not_yet: at the 04:05 run of 11-11, 11-03 is unsettled but more than 7 days back, 11-09 waiting",
                  settle_at(at("2026-11-11", 4, 5), {"2026-11-03": UNS, "2026-11-09": UNS}), ("not_yet", None)))
    cases.append(("3 red: at the 04:05 run of 11-11, 11-04 to 11-07 unsettled are named, 11-08 is within 72 hours",
                  settle_at(at("2026-11-11", 4, 5), {d_: UNS for d_ in ("2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09")}), ("red", ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"])))
    v, s = states(world(cc=True, **{CHECK_RUNS + "index.json": loop_with(day={"verdict": "deviation"})}))
    cases.append(("3 red: settled as a deviation", (v, s["3_ledger_settle"]), ("red", "red")))
    v, s = states(world(cc=True, **{CHECK_RUNS + "index.json": loop_with(day={"settle": "v1.15"})}))
    cases.append(("3 red: settled under another settle than v1.19", s["3_ledger_settle"], "red"))
    v, s = states(world(cc=True, **{CHECK_RUNS + "2026-11-03/settlement.json": (200, SET3 + " ")}))
    cases.append(("3 red: the settlement's bytes are not the ones its index names", s["3_ledger_settle"], "red"))
    v, s = states(world(cc=True, **{LEDGER + "/admission/" + REC3: (200, {"canonical_sha256": REC3, "status": "pending_anchor"})}))
    cases.append(("3 red: the settled admission is not anchored on the ledger", s["3_ledger_settle"], "red"))
    v, s = states(world(cc=True, **{AGREEMENT + "/execution/" + hsh(EXE3): (404, "{}")}))
    cases.append(("3 red: the MUSUBI intake does not serve the execution", s["3_ledger_settle"], "red"))
    v, s = states(world(cc=True, **{CHECK_RUNS + "index.json": "down"}))
    cases.append(("3 and 4b red: the index answers 5xx three times", (v, s["3_ledger_settle"], s["4b_resume_agreement"]), ("red", "red", "red")))
    cases.append(("4b ok: the check contract is in the Resume's agreements[] after its batch is confirmed", states(world(cc=True))[1]["4b_resume_agreement"], "ok"))
    v, s = states(world(cc=True, **{AGREEMENT + "/contract/" + CSHA + "/report": (404, {"error": "not_found"})}))
    cases.append(("4b not_yet: the check contract is not on file at the MUSUBI intake", (v, s["4b_resume_agreement"]), ("not_all_checked", "not_yet")))
    v, s = states(world(cc=True, **{AGREEMENT + "/contract/" + CSHA + "/report": (200, {"intake": {"verdict": "accepted", "anchor": {"status": "pending"}}})}))
    cases.append(("4b not_yet: on file, not in a ledger batch yet", s["4b_resume_agreement"], "not_yet"))
    v, s = states(world(cc=True, **{LEDGER + "/verify/300": (200, {"bitcoin_status": "pending"})}))
    cases.append(("4b not_yet: its batch is not confirmed in Bitcoin yet", s["4b_resume_agreement"], "not_yet"))
    rj4 = json.loads(json.dumps(g(RESUME_URL)[1]))
    v, s = states(world(cc=True, **{RESUME_URL: (200, dict(rj4, agreements=[]))}))
    cases.append(("4b red: the batch is confirmed and the Resume lists the contract nowhere", (v, s["4b_resume_agreement"]), ("red", "red")))
    v, s = states(world(cc=True, **{RESUME_URL: (200, dict(rj4, agreements=[], not_counted=[{"record_sha256": CSHA, "why": "not_yet_anchored", "kind": "agreement"}]))}))
    cases.append(("4b not_yet: the Resume names the contract as not yet anchored", s["4b_resume_agreement"], "not_yet"))
    v, s = states(world(cc=True, **{RESUME_URL: (200, dict(rj4, agreements=[], not_counted=[{"record_sha256": CSHA, "why": "agreement_bytes_do_not_hash_to_the_listed_sha"}]))}))
    cases.append(("4b red: the Resume refuses to count the contract", s["4b_resume_agreement"], "red"))
    v, s = states(world(cc=True, **{AGREEMENT + "/contract/" + CSHA + "/report": "down"}))
    cases.append(("4b red: the MUSUBI intake answers 5xx three times", s["4b_resume_agreement"], "red"))
    sk = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
    cases.append(("Ed25519: RFC 8032 test 1 (public half, signature, a changed message fails)", (ed25519_public(sk).hex(), ed25519_verify(base64.b64encode(ed25519_public(sk)).decode(), b"", base64.b64encode(ed25519_sign(sk, b"")).decode()),
                  ed25519_verify(base64.b64encode(ed25519_public(sk)).decode(), b"x", base64.b64encode(ed25519_sign(sk, b"")).decode())), ("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", True, False)))
    cases.append(("the leaf hash of a fixed envelope is the runner's (node canonical_v0.mjs, a fixed vector)", leaf_hash(json.loads(VEC_ENVELOPE)), "56054ab73249bca2d4b7af50788fffe5e0309a628dff691d6b380f3bb06198b4"))
    r1 = run(world(), now)[2]; r2 = run(world(), now)[2]
    cases.append(("the result sha is the same for the same day and answers", r1 == r2 and len(r1) == 64, True))
    ra, ta, sa = run(world(cc=True), now, "schedule")
    rb, tb, sb = run(world(cc=True), now.replace(hour=11, minute=50, second=32), "dispatch")
    cases.append(("the result names its trigger", (ra["trigger"], rb["trigger"]), ("schedule", "dispatch")))
    cases.append(("two runs of one day: result_sha256 differs (checked_at, trigger), day_sha256 is the same", (sa != sb, day_sha256(ra) == day_sha256(rb), len(day_sha256(ra))), (True, True, 64)))
    rc_, _, _ = run(world(cc=True, prev=False), now)
    cases.append(("a day whose answers differ has another day_sha256", day_sha256(ra) != day_sha256(rc_), True))
    rd, _, _ = run(world(cc=True), now + datetime.timedelta(days=1))
    cases.append(("the same answers on another day have another day_sha256 (the day is in the view)", day_sha256(ra) != day_sha256(rd), True))
    try:
        run(world(), now, "nightly"); t_ok = False
    except ValueError:
        t_ok = True
    cases.append(("an unknown trigger is refused", t_ok, True))
    w = json.loads(witness_record(ra, "anonymous", "test", now, "ab" * 32))
    cases.append(("the witness record: an unsigned jidec-path-v1 commitment of the day_sha256, for the published day's URL",
                  (w["schema"], w["mode"], w["commitment"], w["purpose"], w["base"], w["tooshi"]["day_sha256"], sorted(w["witness"]), bool(w["establishes"]) and bool(w["does_not_establish"])),
                  ("jidec-path-v1", "commitment", day_sha256(ra), "tooshi-day-v0: 2026-11-05", DAY_URL % "2026-11-05", day_sha256(ra), ["name", "vantage"], True)))
    cases.append(("the witness record carries no key, no signature and no answer text beyond the counts", any(k in w for k in ("signature_ed25519_b64", "public_key_ed25519_b64", "checks", "nodes")) or "key_url" in w["witness"], False))
    cases.append(("witness: refused before 03:47 UTC, with --now, and without a name", (main(["--witness", "x", "--now", "2026-11-05T04:05:00Z"]), witness_refusal(datetime.datetime(2026, 11, 5, 3, 46, tzinfo=datetime.timezone.utc), "x"), witness_refusal(now, "")), (2, "too_early", "no_name")))
    # 5: check_store_required is a setting; a witness who runs later reads the same value and gets the same day_sha256
    rs_, _, _ = run(world(cc=True), now, "schedule")
    rw_, _, _ = run(world(cc=True), now.replace(hour=11, minute=20), "witness")
    f5 = lambda r: [x["facts"].get("check_store_required") for x in r["checks"] if x["id"] == "5_door_runner"][0]
    ww = json.loads(witness_record(rw_, "anonymous", "test", now.replace(hour=11, minute=20), "ab" * 32))
    cases.append(("5: the 04:05 run and a witness at 11:20 read check_store_required true and get the same day_sha256, which the witness record commits to",
                  (f5(rs_), f5(rw_), day_sha256(rs_) == day_sha256(rw_), ww["commitment"] == day_sha256(rs_)), (True, True, True, True)))
    rx_, _, _ = run(world(cc=True, **{DOOR_POLICY: (200, dict(pol, furui=dict(pol["furui"], stores_requiring=[])))}), now, "schedule")
    cases.append(("5: a door whose check store no longer requires the check gives another day_sha256 (false is in the facts)", (f5(rx_), day_sha256(rx_) != day_sha256(rs_)), (False, True)))
    # the note beside 3 (--notes): is yesterday's batch confirmed in Bitcoin; 3 still reads the day before yesterday
    REC4 = hsh("the admission of 11-04")
    A4 = (200, {"canonical_sha256": REC4, "status": "anchored", "ledger_entry": 310})

    def note_world(bs="confirmed", adm=A4, ix4=None, first=None, **over):
        ix = json.loads(json.dumps(INDEX))
        ix["days"]["2026-11-04"] = dict({"record_sha256": REC4, "admission_sha256": hsh("adm4"), "execution_sha256": hsh("exe4"), "settled": False, "status": None, "verdict": None}, **(ix4 or {}))
        if first:
            ix["first_day"] = first
        o = {CHECK_RUNS + "index.json": (200, ix), LEDGER + "/admission/" + REC4: adm, LEDGER + "/verify/310": (200, {"bitcoin_status": bs})}
        o.update(over)
        return world(cc=True, **o)
    nst = lambda get, when=now: (lambda x: (x["state"], x["day"], x.get("entry")))(notes(get, when)["items"][0])
    rc3, _, _ = run(note_world("confirmed"), now)
    c3 = [x for x in rc3["checks"] if x["id"] == "3_ledger_settle"][0]
    cases.append(("note: yesterday's batch is confirmed; the note says so, and 3 still reads the day before yesterday (11-03, ok), the verdict green",
                  (nst(note_world("confirmed")), c3["state"], c3["facts"]["day"], rc3["verdict"]), (("confirmed", "2026-11-04", 310), "ok", "2026-11-03", "green")))
    cases.append(("note: yesterday's batch is pending in Bitcoin: not_confirmed", nst(note_world("pending")), ("not_confirmed", "2026-11-04", 310)))
    cases.append(("note: yesterday's admission is not in a ledger batch yet: not_in_batch",
                  nst(note_world(adm=(200, {"canonical_sha256": REC4, "status": "pending_anchor", "ledger_entry": None}))), ("not_in_batch", "2026-11-04", None)))
    cases.append(("note: yesterday is not filed in the loop's index yet: not_filed", nst(world(cc=True)), ("not_filed", "2026-11-04", None)))
    cases.append(("note: yesterday is settled final already: settled", nst(note_world(ix4={"settled": True, "status": "final"})), ("settled", "2026-11-04", None)))
    cases.append(("note: yesterday is before the loop's first day: before_first_day", nst(note_world(first="2026-11-05")), ("before_first_day", "2026-11-04", None)))
    rd3, _, _ = run(note_world(**{LEDGER + "/verify/310": "down"}), now)
    cases.append(("note: /verify answers 5xx three times: unreadable, and the run is not touched (green)", (nst(note_world(**{LEDGER + "/verify/310": "down"}))[0], rd3["verdict"]), ("unreadable", "green")))
    cases.append(("note: an index without its shape gives unreadable, never an exception", nst(note_world(**{CHECK_RUNS + "index.json": (200, [1])}))[0], "unreadable"))
    ra3, ta3, _ = run(note_world("pending"), now, "schedule")
    rb3, tb3, _ = run(note_world("confirmed"), now.replace(hour=11, minute=20), "witness")
    cases.append(("note: the 04:05 run that saw pending and a witness at 11:20 that saw confirmed have the same day_sha256; only the notes differ",
                  (day_sha256(ra3) == day_sha256(rb3), nst(note_world("pending"))[0], nst(note_world("confirmed"))[0]), (True, "not_confirmed", "confirmed")))
    cases.append(("note: the result text is the same whatever the note says (the note is not in the result)", ta3 == run(note_world("confirmed"), now, "schedule")[1] and "notes" not in ra3, True))
    nt3 = notes(note_world(), now)
    cases.append(("note: the notes carry observed_at (the run's time) and say they are outside the day sha", (nt3["schema"], nt3["observed_at"], "day_sha256" in nt3["outside"], sorted(nt3)),
                  ("tooshi-notes-v0", "2026-11-05T04:05:00Z", True, ["items", "observed_at", "outside", "schema"])))
    # 8 canary_scene and 9 witness_answer (2026-11-06)
    st8 = lambda get, when=now: [x for x in run(get, when)[0]["checks"] if x["id"] == "8_canary_scene"][0]
    st9 = lambda get, when=now: [x for x in run(get, when)[0]["checks"] if x["id"] == "9_witness_answer"][0]
    x8 = st8(world(cc=True))
    cases.append(("8 ok: today's canary text stopped, the phrase not touched, yesterday's canary envelope is a signed leaf that says stop", (x8["state"], x8["facts"].get("bound"), x8["facts"].get("leaf")), ("ok", True, 2)))
    cases.append(("8 ok without yesterday's call shown (nothing to bind yet)", (st8(world(cc=True, canary_prev=False))["state"], st8(world(cc=True, canary_prev=False))["facts"]["bound"]), ("ok", False)))
    cases.append(("8 red: the phrase was touched", st8(world(cc=True, canary={"touched": True}))["state"], "red"))
    cases.append(("8 red: the check did not stop the known attack (pass)", st8(world(cc=True, canary={"decision": "pass"}))["state"], "red"))
    cases.append(("8 red: the canary call failed (envelope signature)", st8(world(cc=True, canary={"ok": False, "error": "envelope_signature", "touched": None}))["state"], "red"))
    cases.append(("8 not_yet: no canary call recorded for today (the last is yesterday's)", st8(world(cc=True, canary={"day": "2026-11-04", "at": "2026-11-04T03:47:31.000Z"}))["state"], "not_yet"))
    cases.append(("8 not_yet: the door's canary key is not set", st8(world(cc=True, canary={"ok": False, "error": "canary_key_not_set", "touched": None}))["state"], "not_yet"))
    cases.append(("8 not_yet: the door shows no canary call at all, and before 03:47 UTC", (st8(world())["state"], st8(world(cc=True), datetime.datetime(2026, 11, 5, 3, 40, tzinfo=datetime.timezone.utc))["state"]), ("not_yet", "not_yet")))
    cases.append(("8 not_yet: the runner left the canary text unanswered", st8(world(cc=True, canary={"answered": False, "decision": None}))["state"], "not_yet"))
    p8 = json.loads(json.dumps(world(cc=True)(DOOR_POLICY)[1]))
    p8["furui"]["canary_call_prev"]["check_sha256"] = hsh("no such check")
    cases.append(("8 red: yesterday's canary check is not a leaf of yesterday's day record", st8(world(cc=True, **{DOOR_POLICY: (200, p8)}))["state"], "red"))
    cases.append(("8: no phrase in the result, only its sha256", "mark_sha256" in x8["facts"] and "mark" not in x8["facts"], True))
    x9 = st9(world(cc=True))
    cases.append(("9 ok: a signed answer (pending at the intake) carries the day before yesterday's day_sha256, root and n", (x9["state"], x9["facts"]["answers"], x9["facts"]["witnesses"]), ("ok", 1, ["w.example"])))
    cases.append(("9 ok: the answer is read from a witness batch on the ledger", st9(world(cc=True, wit=lambda ds, rt, n: ([], [answer("2026-11-03", ds, rt, n)])))["state"], "ok"))
    cases.append(("9 not_yet: no answer for the day before yesterday at the intake", st9(world(cc=True, wit=lambda ds, rt, n: ([],)))["state"], "not_yet"))
    cases.append(("9 not_yet: an unsigned record is not a signed answer", st9(world(cc=True, wit=lambda ds, rt, n: ([answer("2026-11-03", ds, rt, n)], (), True)))["state"], "not_yet"))
    cases.append(("9 red: an answer names another day_sha256", st9(world(cc=True, wit=lambda ds, rt, n: ([answer("2026-11-03", hsh("x"), rt, n)],)))["state"], "red"))
    cases.append(("9 red: an answer names another root", st9(world(cc=True, wit=lambda ds, rt, n: ([answer("2026-11-03", ds, hsh("y"), n)],)))["state"], "red"))
    cases.append(("9 red: an answer's signature does not verify (signed with another key)", st9(world(cc=True, wit=lambda ds, rt, n: ([answer("2026-11-03", ds, rt, n, key=SKW2)],)))["state"], "red"))
    cases.append(("9 red beside a good one: one contradicting answer is enough", st9(world(cc=True, wit=lambda ds, rt, n: ([answer("2026-11-03", ds, rt, n), answer("2026-11-03", ds, rt, n + 1)],)))["state"], "red"))
    cases.append(("9 not_yet: the day record of the day before yesterday is not served yet", st9(world(**{RUNNER + "/furui/day/2026-11-03/status": (200, {"status": None})}))["state"], "not_yet"))
    cases.append(("9 reads the day before yesterday (11-03 at the 11-05 run), not yesterday", (x9["facts"]["day"], st9(world(cc=True), now + datetime.timedelta(days=1))["facts"]["day"]), ("2026-11-03", "2026-11-04")))
    cases.append(("9 red: the ledger head does not answer", st9(world(cc=True, **{LEDGER + "/ledger/head": "down"}))["state"], "red"))
    # 10 to 15 (2026-11-06)
    def st(get, cid, when=now):
        return [x for x in run(get, when)[0]["checks"] if x["id"] == cid][0]
    S10, S11, S12, S13, S14, S15 = "10_cross_client", "11_main_ci", "12_paid_rows_daily", "13_line_delivery", "14_not_yet_deadline", "15_recovery_fresh"
    cases.append(("v2: the whole day holds with the six new checks, 16 and 24: every check ok, the verdict green, 22 checks besides 17 (18, 22 and 25 dormant, notices)", (lambda r: (r["verdict"], len([x for x in r["checks"] if x["id"] != "17_paid_call_chain"]), r["counts"]["ok"] - 1))(run(world(cc=True), now)[0]), ("green", 22, 19)))
    cases.append(("10: the draw of 2026-11-07 from five endpoints is the cross client's (cross_client_test.mjs has the same vector)", cross_draw("2026-11-07", list(reversed(CANDS))),
                  ["https://c.example/mcp", "https://d.example/mcp", "https://e.example/mcp"]))
    x10 = st(world(cc=True), S10)
    cases.append(("10 ok: the SDK client and the gate agree on the own endpoint and the three drawn", (x10["state"], x10["facts"]["drawn"], x10["facts"]["sdk"]), ("ok", DRAWN, "1.32.1")))
    cases.append(("10 not_yet: the gate's /health says 0.4.22 (the check waits for 0.4.24)", (lambda x: (x["state"], x["facts"]["waits_for"]))(st(world(cc=True, **{GATE + "/health": (200, {"gate_version": "0.4.22"})}), S10)), ("not_yet", "gate_0.4.24")))
    cases.append(("10 not_yet: no cross client result was given (--cross)", st(world(cc=True, **{CROSS_SOURCE: (404, None)}), S10)["state"], "not_yet"))
    cases.append(("10 not_yet: the cross client called nothing (it saw the gate before 0.4.24)", st(world(cc=True, **{CROSS_SOURCE: cross(skipped="gate_before_0_4_24", targets=[], picked=[])}), S10)["state"], "not_yet"))
    cases.append(("10 not_yet: a drawn endpoint is not reached by the SDK client, the others agree", st(world(cc=True, **{CROSS_SOURCE: target(2, sdk={"reached": False, "pass": None, "error": "not reached: ENOTFOUND"})}), S10)["state"], "not_yet"))
    x10r = st(world(cc=True, **{CROSS_SOURCE: target(1, gate={"pass": False, "reason": "initialize failed: http 406"})}), S10)
    cases.append(("10 red: the gate fails a drawn endpoint that the SDK client passes; both reasons are named", (x10r["state"], "http 406" in x10r["why"] and "SDK client says pass" in x10r["why"], x10r["facts"]["disagree"]), ("red", True, 1)))
    cases.append(("10 red: the SDK client fails an endpoint that the gate passes", st(world(cc=True, **{CROSS_SOURCE: target(3, sdk={"pass": False, "reason": "http 406"})}), S10)["state"], "red"))
    cases.append(("10 red: the SDK client does not reach the own endpoint", st(world(cc=True, **{CROSS_SOURCE: target(0, sdk={"reached": False, "pass": None, "error": "not reached: ECONNREFUSED"})}), S10)["state"], "red"))
    cases.append(("10 red: the cross client measured other endpoints than the day's draw", st(world(cc=True, **{CROSS_SOURCE: cross(picked=list(reversed(DRAWN)))}), S10)["state"], "red"))
    cases.append(("10 red: the cross client result is yesterday's", st(world(cc=True, **{CROSS_SOURCE: cross(day="2026-11-04")}), S10)["state"], "red"))
    cases.append(("10 red: the gate's /health answers 5xx three times", st(world(cc=True, **{GATE + "/health": "down"}), S10)["state"], "red"))
    gw = with_cross(lambda u, raw=False: (404, None), None)
    cases.append(("10: without --cross the run's getter answers 404 for the cross client result (no network)", gw(CROSS_SOURCE), (404, None)))
    x11 = st(world(cc=True), S11)
    cases.append(("11 ok: no push run on main failed in the 24 hours before 03:47 UTC", (x11["state"], x11["facts"]["runs"], x11["facts"]["window"]), ("ok", {"horizon-shield": 2}, ["2026-11-04T03:47:00Z", "2026-11-05T03:47:00Z"])))
    JOBS7 = "%s/repos/%s/actions/runs/7/jobs?per_page=100" % (GH_API, CI_REPOS[0])
    x11r = st(world(cc=True, **{ci_runs_url(CI_REPOS[0], LO11): ci([ci_run(1), ci_run(7, "failure", name="public-boundary", at="2026-11-05T01:00:00Z")]),
                                JOBS7: (200, {"jobs": [{"name": "boundary", "conclusion": "failure"}, {"name": "other", "conclusion": "success"}]})}), S11)
    cases.append(("11 red: a push run failed; the workflow, the job and the commit are named", (x11r["state"], "public-boundary, job boundary, commit 00000000" in x11r["why"]), ("red", True)))
    cases.append(("11 ok: a failure created before the window (the day before) is not counted",
                  st(world(cc=True, **{ci_runs_url(CI_REPOS[0], LO11): ci([ci_run(8, "failure", at="2026-11-04T03:46:59Z")])}), S11)["state"], "ok"))
    cases.append(("11 ok: a cancelled run and a run still in progress are not failures",
                  st(world(cc=True, **{ci_runs_url(CI_REPOS[0], LO11): ci([ci_run(9, "cancelled"), ci_run(10, None, status="in_progress")])}), S11)["state"], "ok"))
    cases.append(("11 not_yet: the repository answers 404",
                  (lambda x: (x["state"], x["facts"]["unreadable"]))(st(world(cc=True, **{ci_runs_url(CI_REPOS[0], LO11): (404, {"message": "Not Found"})}), S11)), ("not_yet", [CI_REPOS[0]])))
    seen11, g11 = [], world(cc=True)
    st(lambda u, *a, **k: (seen11.append(u), g11(u, *a, **k))[1], S11)
    cases.append(("11: hs-seki-private and hs-furui-private are left out, not read, and named with the reason every day",
                  (CI_REPOS, sorted(x11["facts"]["left_out"]), all(x11["facts"]["left_out"].values()), len(seen11) > 0, any("hs-seki-private" in u or "hs-furui-private" in u for u in seen11)),
                  (("ogasurfproject-jpg/horizon-shield",), ["hs-furui-private", "hs-seki-private"], True, True, False)))
    P2 = ci_runs_url(CI_REPOS[0], LO11, 2)
    cases.append(("11 red: a failure on the second page of runs is read", st(world(cc=True, **{ci_runs_url(CI_REPOS[0], LO11): (200, {"total_count": 101, "workflow_runs": [ci_run(i) for i in range(100, 200)]}),
                                                                                          P2: ci([ci_run(12, "failure")])}), S11)["state"], "red"))
    cases.append(("12 ok: the paid row was measured within 26 hours of 03:47 UTC", (lambda x: (x["state"], x["facts"]["paid"]))(st(world(cc=True), S12)), ("ok", 1)))
    REG = world(cc=True)(GATE + "/register")[1]
    def reg_with(*rows):
        return (200, dict(REG, rows=list(rows)))
    cases.append(("12 not_yet: no paid row (today's register)", st(world(cc=True, **{GATE + "/register": reg_with(*REG["rows"][:2])}), S12)["state"], "not_yet"))
    x12 = st(world(cc=True, **{GATE + "/register": reg_with(REG["rows"][0], dict(REG["rows"][2], latest={"at": "2026-11-04T01:46:00.000Z"}))}), S12)
    cases.append(("12 red: a paid row last measured 26 hours and 1 minute before 03:47 UTC is named", (x12["state"], x12["facts"]["late"]), ("red", ["https://paid.example/mcp"])))
    cases.append(("12 red: a paid row never measured", st(world(cc=True, **{GATE + "/register": reg_with(dict(REG["rows"][2], latest=None))}), S12)["state"], "red"))
    cases.append(("12 red: the register answers 5xx three times", st(world(cc=True, **{GATE + "/register": "down"}), S12)["state"], "red"))
    # 12's numbers (no line), on 2026-11-06's real answers (tooshi_real_furui_20261106.json)
    RF = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tooshi_real_furui_20261106.json"), encoding="utf-8"))
    NF = datetime.datetime(2026, 11, 6, 4, 5, tzinfo=datetime.timezone.utc)

    def wf(**over):
        w = {DOOR_POLICY: (200, RF["door_policy"]), RUNNER + "/furui/heartbeat": (200, RF["runner_heartbeat"])}
        for d, v in RF["runner_status"].items():
            w[RUNNER + "/furui/day/%s/status" % d] = (200, v)
        for k, v in RF["runner_leaves"].items():
            w[RUNNER + "/furui/day/%s/leaf/%s" % tuple(k.split("/"))] = (200, v)
        for k, v in RF["door_record"].items():
            w[DOOR_RECORD + k] = (200, v)
        for d, v in RF["published_days"].items():
            w[DAY_URL % d] = (200, v)
        w.update(over)

        def g(u, raw=False):
            v = w.get(u, (404, None))
            if v == "down":
                raise Unreachable(u + ": http 503 after 3 tries")
            return v
        return g

    def pd(*samples):
        return (200, {"result_canonical": canonical({"checks": [{"id": S12, "state": "not_yet", "why": "", "facts": {"furui_row": {"time_ms": {"samples": list(samples)}}}}]})})
    fr = furui_row_numbers(wf(), NF)
    cases.append(("12 numbers on 2026-11-06's real answers: the check call of 11-05 took 5214 ms from the door's start to the runner's signature (the only sample; no canary call before 11-06)",
                  (fr["time_ms"], fr["window"], fr["unread"]), ({"n": 1, "p50": 5214, "p95": 5214, "samples": [{"day": "2026-11-05", "call": "check", "ms": 5214}], "skipped": 0}, ["2026-10-30", "2026-11-05"], [])))
    cases.append(("12 numbers on the real answers: 6 checks in the 7 days for 0.018953 USD (0.0031588 per check), the heartbeat of 11-06 0.0003064 USD",
                  (fr["cost_usd"]["checks"], fr["cost_usd"]["spent"], fr["cost_usd"]["per_check"], [x["day"] for x in fr["cost_usd"]["by_day"]], fr["cost_usd"]["heartbeat"]),
                  (6, 0.018953, 0.0031588, ["2026-11-05", "2026-11-04", "2026-11-03"], {"day": "2026-11-06", "spent_usd": 0.0003064})))
    cases.append(("12 numbers: the 04:05 and 11:50 runs of the same day read the same numbers", furui_row_numbers(wf(), NF.replace(hour=11, minute=50)) == fr, True))
    cases.append(("12 numbers have no line: the state and the other facts are paid_rows_state's in ok, not_yet and both reds",
                  all((lambda g: (lambda x, y: x["facts"].pop("furui_row") is not None and x == y)(check_paid_rows(g, now), paid_rows_state(g, now)))(g) for g in (
                      world(cc=True), world(cc=True, **{GATE + "/register": reg_with(*REG["rows"][:2])}), world(cc=True, **{GATE + "/register": reg_with(dict(REG["rows"][2], latest=None))}),
                      world(cc=True, **{GATE + "/register": "down"}))), True))
    def without_numbers(get):
        keep = globals()["furui_row_numbers"]
        globals()["furui_row_numbers"] = lambda g, n: None
        try:
            return run(get, now)[0]
        finally:
            globals()["furui_row_numbers"] = keep
    cases.append(("12 numbers: the verdict and every state and why are the same with the numbers and without them (a red day and a green day)",
                  all((lambda a, b: (a["verdict"], [(x["id"], x["state"], x["why"]) for x in a["checks"]]) == (b["verdict"], [(x["id"], x["state"], x["why"]) for x in b["checks"]]))(run(world(cc=True, **o), now)[0], without_numbers(world(cc=True, **o)))
                      for o in ({}, {GATE + "/register": reg_with(dict(REG["rows"][2], latest=None))})), True))
    frp = furui_row_numbers(wf(**{DAY_URL % "2026-11-05": pd({"day": "2026-11-04", "call": "check", "ms": 4000}, {"day": "2026-11-04", "call": "canary", "ms": 9000},
                                                          {"day": "2026-11-05", "call": "canary", "ms": 1}, {"day": "2026-10-29", "call": "check", "ms": 1}, {"day": "2026-11-03", "call": "check", "ms": 6000},
                                                          {"day": "2026-11-03", "call": "check", "ms": -5}, {"day": "2026-11-03", "call": "check", "ms": True},
                                                          {"day": "2026-11-03", "call": "other", "ms": 7}, "x"),
                                  DAY_URL % "2026-11-04": pd({"day": "2026-11-04", "call": "check", "ms": 99999}, {"day": "2026-11-03", "call": "check", "ms": 7777})}), NF)
    cases.append(("12 numbers: the samples of the days before come from the published days (the newer day wins, its own day, outside the window, negative, bool and other calls are not read); p50 5214, p95 9000 of 4",
                  (frp["time_ms"]["n"], frp["time_ms"]["p50"], frp["time_ms"]["p95"], [(x["day"], x["call"], x["ms"]) for x in frp["time_ms"]["samples"]]),
                  (4, 5214, 9000, [("2026-11-05", "check", 5214), ("2026-11-04", "check", 4000), ("2026-11-04", "canary", 9000), ("2026-11-03", "check", 6000)])))
    cases.append(("12 numbers: p50 and p95 by nearest rank (1 to 20: 10 and 19; none: null)", (rank(list(range(20, 0, -1)), 50), rank(list(range(1, 21)), 95), rank([], 50)), (10, 19, None)))
    DPK = json.loads(json.dumps(RF["door_policy"]))
    DPK["furui"]["canary_call_prev"] = dict(DPK["furui"]["canary_call"], day="2026-11-05", at="2026-11-05T03:17:50.000Z", check_sha256=hsh(canonical(RF["runner_leaves"]["2026-11-05/0"]["envelope"]["check"])))
    cases.append(("12 numbers: yesterday's canary call is a second sample (its check_sha256 names leaf 0 of the day; 2719 ms)",
                  [(x["call"], x["ms"]) for x in furui_row_numbers(wf(**{DOOR_POLICY: (200, DPK)}), NF)["time_ms"]["samples"]], [("check", 5214), ("canary", 2719)]))
    DPL = json.loads(json.dumps(RF["door_policy"]))
    DPL["furui"]["check_call_prev"]["at"] = "2026-11-05T03:47:16.000Z"
    DPM = json.loads(json.dumps(RF["door_policy"]))
    DPM["furui"]["check_call_prev"]["at"] = "2026-11-05T03:30:00.000Z"
    cases.append(("12 numbers: a signature before the call's start, or more than 10 minutes after it, is skipped, not a sample",
                  [(lambda t: (t["n"], t["skipped"]))(furui_row_numbers(wf(**{DOOR_POLICY: (200, D)}), NF)["time_ms"]) for D in (DPL, DPM)], [(0, 1), (0, 1)]))
    DPN = json.loads(json.dumps(RF["door_policy"]))
    DPN["furui"]["check_call_prev"]["ok"] = False
    DPD = json.loads(json.dumps(RF["door_policy"]))
    DPD["furui"]["check_call_prev"]["day"] = "2026-11-04"
    cases.append(("12 numbers: a call that is not yesterday's good call (ok false, or another day) gives no sample and is not unread",
                  [(lambda r: (r["time_ms"]["n"], r["unread"]))(furui_row_numbers(wf(**{DOOR_POLICY: (200, D)}), NF)) for D in (DPN, DPD)], [(0, []), (0, [])]))
    RD = dict(RF["door_record"])
    cases.append(("12 numbers: door record bytes that do not hash to the record sha, or a door that does not answer, are named in unread",
                  (furui_row_numbers(wf(**{DOOR_RECORD + list(RD)[0]: (200, list(RD.values())[0] + " ")}), NF)["unread"], furui_row_numbers(wf(**{DOOR_POLICY: "down"}), NF)["unread"]),
                  (["check call 2026-11-05"], ["door policy"])))
    xr = furui_row_numbers(wf(**{RUNNER + "/furui/day/2026-11-04/status": "down", RUNNER + "/furui/heartbeat": (200, {"at": "2026-11-06T03:17:51.856Z", "ok": False, "spent_usd": 0.4}), DAY_URL % "2026-11-04": "down"}), NF)
    cases.append(("12 numbers: a runner day that does not answer stops the cost walk there, and a heartbeat that did not run well, and an unread published day are named",
                  (xr["unread"], xr["cost_usd"]["checks"], xr["cost_usd"]["per_check"], xr["time_ms"]["n"]),
                  (["runner status 2026-11-04", "runner heartbeat", "published day 2026-11-04"], 2, 0.0003005, 1)))
    cases.append(("13 ok: no line_last_fail in either worker", st(world(cc=True), S13)["state"], "ok"))
    FAIL = {"at": "2026-11-05T01:12:13.000Z", "api": "push", "status": 429, "msg": "SECRET-BODY-TEXT for U1234567890abcdef", "where": "followup_touch"}
    x13 = st(world(cc=True, **{LINE_HEALTH[0][1]: (200, {"status": "ok", "line_last_fail": FAIL})}), S13)
    cases.append(("13 red: a failed send in the 24 hours: the worker, the time and the place only", (x13["state"], x13["facts"]["fails"]), ("red", [{"worker": "hs-kira-line", "at": "2026-11-05T01:12:13Z", "where": "followup_touch"}])))
    cases.append(("13: neither the message, the LINE answer, its status nor the person is in the result", any(w in json.dumps(run(world(cc=True, **{LINE_HEALTH[0][1]: (200, {"line_last_fail": FAIL})}), now)[1]) for w in ("SECRET-BODY", "U1234567890", "429", '"push"')), False))
    cases.append(("13 ok: the last failed send is older than 24 hours before 03:47 UTC", st(world(cc=True, **{LINE_HEALTH[1][1]: (200, {"line_last_fail": dict(FAIL, at="2026-11-04T03:46:00.000Z")})}), S13)["state"], "ok"))
    cases.append(("13 not_yet: hs-kira-group's /health has no line_last_fail (its version on main today)", (lambda x: (x["state"], x["facts"]["unreadable"]))(st(world(cc=True, **{LINE_HEALTH[1][1]: (200, {"status": "ok", "service": "hs-kira-group"})}), S13)), ("not_yet", ["hs-kira-group"])))
    cases.append(("13 not_yet: line_last_fail says unreadable", st(world(cc=True, **{LINE_HEALTH[0][1]: (200, {"line_last_fail": "unreadable"})}), S13)["state"], "not_yet"))
    cases.append(("13 not_yet: a /health does not answer", st(world(cc=True, **{LINE_HEALTH[0][1]: "down"}), S13)["state"], "not_yet"))
    # 14: the published days before today, as a witness reads them
    def pub_day(d, **states):
        return (200, {"schema": "tooshi-day-v0", "day": d, "checks": [{"id": k, "state": v, "why": ""} for k, v in states.items()]})
    NY3 = loop_with(day={"settled": False, "status": None, "verdict": None})
    cases.append(("14 ok: nothing is not_yet today", (lambda x: (x["state"], x["facts"]["waiting"]))(st(world(cc=True), S14)), ("ok", 0)))
    x14 = st(world(cc=True, **{CHECK_RUNS + "index.json": NY3, DAY_URL % "2026-11-04": pub_day("2026-11-04", **{"3_ledger_settle": "not_yet"})}), S14)
    cases.append(("14 ok: 3 waits for Bitcoin and was not_yet yesterday too (24 hours, deadline 36)", (x14["state"], x14["facts"]["open"]), ("ok", [{"id": "3_ledger_settle", "hours": 24, "deadline": 36, "history": "read"}])))
    x14r = st(world(cc=True, **{CHECK_RUNS + "index.json": NY3, DAY_URL % "2026-11-04": pub_day("2026-11-04", **{"3_ledger_settle": "not_yet"}), DAY_URL % "2026-11-03": pub_day("2026-11-03", **{"3_ledger_settle": "not_yet"})}), S14)
    cases.append(("14 red: 3 waits for Bitcoin and was not_yet the two days before (48 hours, deadline 36)", (x14r["state"], "3_ledger_settle not_yet for 48 hours (deadline 36)" in x14r["why"]), ("red", True)))
    cases.append(("14 ok: a not_yet streak broken by an ok day starts again", st(world(cc=True, **{CHECK_RUNS + "index.json": NY3, DAY_URL % "2026-11-04": pub_day("2026-11-04", **{"3_ledger_settle": "ok"}),
                                                                                                   DAY_URL % "2026-11-03": pub_day("2026-11-03", **{"3_ledger_settle": "not_yet"})}), S14)["state"], "ok"))
    cases.append(("14 not_yet: yesterday's published day could not be read (5xx three times)", st(world(cc=True, **{CHECK_RUNS + "index.json": NY3, DAY_URL % "2026-11-04": "down"}), S14)["state"], "not_yet"))
    G22 = {GATE + "/health": (200, {"gate_version": "0.4.22"})}
    six = {DAY_URL % ("2026-11-0%d" % d): pub_day("x", **{"10_cross_client": "not_yet"}) for d in range(1, 5)}
    cases.append(("14 ok: 10 waits for the gate 0.4.24 four days (96 hours, deadline 168)", st(world(cc=True, **dict(G22, **six)), S14)["state"], "ok"))
    seven = {DAY_URL % (now - datetime.timedelta(days=i)).strftime("%Y-%m-%d"): pub_day("x", **{"10_cross_client": "not_yet"}) for i in range(1, 9)}
    cases.append(("14 red: 10 waits for the gate 0.4.24 eight days (192 hours, deadline 168)", st(world(cc=True, **dict(G22, **seven)), S14)["state"], "red"))
    x14e = st(world(cc=True, **{GATE + "/register": reg_with(REG["rows"][0]), **{DAY_URL % (now - datetime.timedelta(days=i)).strftime("%Y-%m-%d"): pub_day("x", **{"12_paid_rows_daily": "not_yet"}) for i in range(1, 9)}}), S14)
    cases.append(("14 ok: 12 with no paid row waits for a fact, not a time, and is named as such with the reason", (x14e["state"], x14e["facts"]["exempt"], "a time limit would turn the day red" in x14e["facts"]["exempt_why"]["12_paid_rows_daily"]), ("ok", ["12_paid_rows_daily"], True)))
    cases.append(("14: a not_yet of 1 to 9 is held to its deadline too (1 not_yet three days, 72 hours, deadline 48)",
                  st(world(cc=True, prev=False, **{DAY_URL % (now - datetime.timedelta(days=i)).strftime("%Y-%m-%d"): pub_day("x", **{"1_sieve_admission": "not_yet"}) for i in (1, 2, 3)}), S14)["state"], "red"))
    cases.append(("14 does not change the states of 1 to 9 (the same run with a red 14 and without its history)",
                  (lambda a, b: {k: v for k, v in a.items() if k[0].isdigit() and int(re.match(r"\d+", k).group()) < 10} == {k: v for k, v in b.items() if k[0].isdigit() and int(re.match(r"\d+", k).group()) < 10})(
                      states(world(cc=True, **{CHECK_RUNS + "index.json": NY3}))[1], states(world(cc=True, **{CHECK_RUNS + "index.json": NY3, DAY_URL % "2026-11-04": pub_day("a", **{"3_ledger_settle": "not_yet"}), DAY_URL % "2026-11-03": pub_day("b", **{"3_ledger_settle": "not_yet"})}))[1]), True))
    x15 = st(world(cc=True), S15)
    cases.append(("15 ok: Software Heritage visited within 7 days, the drill rebuilt up to 279, 5.5 hours before the head 280", (x15["state"], x15["facts"]["rebuilt_through"], x15["facts"]["head"]), ("ok", 279, 280)))
    cases.append(("15 not_yet: Software Heritage does not answer", st(world(cc=True, **{SWH_VISIT: "down"}), S15)["state"], "not_yet"))
    cases.append(("15 red: Software Heritage's last visit is more than 7 days before 03:47 UTC", st(world(cc=True, **{SWH_VISIT: (200, {"date": "2026-10-29T03:46:00+00:00"})}), S15)["state"], "red"))
    cases.append(("15 red: the drill rebuilt only up to an entry more than 48 hours before the head", st(world(cc=True, **{DRILLS + "latest-github.json": drill("github", 278), LEDGER + "/ledger/278?format=json": (200, {"n": 278, "created_at": "2026-11-03T00:30:00.000Z"})}), S15)["state"], "red"))
    cases.append(("15 red: the drill's chain is broken", st(world(cc=True, **{DRILLS + "latest-swh.json": drill("software-heritage", 270, chain={"broken_at": 133, "rebuilt_through": 132})}), S15)["state"], "red"))
    cases.append(("15 red: the drill did not rebuild (outcome failed)", st(world(cc=True, **{DRILLS + "latest-github.json": drill("github", 279, outcome="failed")}), S15)["state"], "red"))
    rv1, _, _ = run(world(cc=True), now, "schedule")
    rv2, _, _ = run(world(cc=True), now.replace(hour=11, minute=50), "dispatch")
    cases.append(("v2: the 04:05 run and an 11:50 run of the same day read the same windows (from 03:47 UTC) and get the same day_sha256", day_sha256(rv1) == day_sha256(rv2), True))
    # ---- 2026-11-06: the first v2 day's two reds, from today's public answers (tooshi_real_20261106.json) ----
    REAL = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tooshi_real_20261106.json"), encoding="utf-8"))
    N6 = datetime.datetime(2026, 11, 6, 4, 5, tzinfo=datetime.timezone.utc)
    LO6 = anchor(N6) - CI_WINDOW
    JOBS = lambda i: "%s/repos/%s/actions/runs/%s/jobs?per_page=100" % (GH_API, CI_REPOS[0], i)

    def w11(runs=None, jobs=None):
        rr = REAL["runs"] if runs is None else runs
        w = {ci_runs_url(CI_REPOS[0], LO6): (200, {"total_count": len(rr), "workflow_runs": rr})}
        for k, v in (REAL["jobs"] if jobs is None else jobs).items():
            w[JOBS(k)] = (200, {"jobs": v})
        return lambda u, raw=False: w.get(u, (404, None))
    r11 = check_main_ci(w11(), N6)
    cases.append(("11 ok on 2026-11-06's real runs: public boundary failed at 6a65cef5 (job swallowed-read) and was fixed at b3a86ddb",
                  (r11["state"], [(h["workflow"], h["jobs"], h["failed_at"], h["fixed_at"]) for h in r11["facts"].get("fixed", [])], r11["facts"]["runs"]),
                  ("ok", [("public boundary", ["swallowed-read"], "6a65cef5", "b3a86ddb")], {"horizon-shield": 62})))
    J2 = dict(REAL["jobs"]); J2["42118676487"] = [dict(x, conclusion="failure") if x["name"] == "swallowed-read" else x for x in J2["42118676487"]]
    cases.append(("11 red on the real runs when the later run's swallowed-read job is not green", check_main_ci(w11(jobs=J2), N6)["state"], "red"))
    R3 = [dict(x, conclusion="failure") if x["id"] == 42118676487 else x for x in REAL["runs"]]
    cases.append(("11 red on the real runs when the next public boundary run after the failure is red too", check_main_ci(w11(runs=R3), N6)["state"], "red"))
    J4 = {k: v for k, v in REAL["jobs"].items() if k != "42118676487"}
    cases.append(("11 red on the real runs when the later run's jobs cannot be read (fixed is not assumed)", check_main_ci(w11(jobs=J4), N6)["state"], "red"))
    R5 = [x for x in REAL["runs"] if x["created_at"] <= "2026-11-05T21:38:54Z"]
    cases.append(("11 red on the real runs cut at the failure: no later run of the workflow yet", check_main_ci(w11(runs=R5), N6)["state"], "red"))
    R6 = [x for x in REAL["runs"] if not (x["path"] == ".github/workflows/public-boundary.yml" and x["created_at"] > "2026-11-05T21:38:54Z")] + \
         [dict(x, id=99, created_at="2026-11-06T03:47:00Z") for x in REAL["runs"] if x["id"] == 42118676487]
    cases.append(("11 red when the only green run after the failure is created at 03:47 UTC, outside the window", check_main_ci(w11(runs=R6), N6)["state"], "red"))

    SHA6 = REAL["status_1104"]["status"]["ledger_canonical_sha256"]

    def w6(**over):
        w = {RUNNER + "/furui/day/2026-11-04/status": (200, REAL["status_1104"]),
             LEDGER + "/furui-check-day/" + SHA6: (200, REAL["rec_1104"]),
             LEDGER + "/ledger/254?format=json": (200, REAL["entry_254"]),
             LEDGER + "/ledger/head": (200, {"n": REAL["ledger_head_n"]})}
        for k, v in REAL["entries_after"].items():
            w[LEDGER + "/ledger/%s?format=json" % k] = (200, v)
        w.update(over)
        return lambda u, raw=False: w[u] if u in w else (404, None)
    r6 = check_day_root(w6(), N6)
    cases.append(("6 ok on 2026-11-06's real answers: 11-04 is in entry 254 of 11-05, one day early, anchored_by operator, confirmed, in no other entry",
                  (r6["state"], r6["facts"].get("early"), r6["facts"].get("entry"), r6["facts"].get("anchored_by"), r6["facts"].get("days_early"), r6["facts"].get("entries_after_read")),
                  ("ok", True, 254, "operator", 1, 6)))
    E257 = dict(REAL["entries_after"]["257"]); E257["record_canonical"] = E257["record_canonical"][:-1] + ',"again":"%s"}' % SHA6
    x6 = check_day_root(w6(**{LEDGER + "/ledger/257?format=json": (200, E257)}), N6)
    cases.append(("6 red on the real answers when entry 257 lists the record again", (x6["state"], x6["facts"].get("again")), ("red", [257])))
    cases.append(("6 red on the real answers when the early batch is not confirmed on Bitcoin",
                  check_day_root(w6(**{LEDGER + "/ledger/254?format=json": (200, dict(REAL["entry_254"], ots_status="pending"))}), N6)["state"], "red"))
    cases.append(("6 red on the real answers when the batch is later than the day after the close",
                  check_day_root(w6(**{LEDGER + "/ledger/254?format=json": (200, dict(REAL["entry_254"], created_at="2026-11-07T00:30:00.000Z"))}), N6)["state"], "red"))
    cases.append(("6 red on the real answers when the ledger head does not answer (a second batch cannot be ruled out)",
                  check_day_root(w6(**{LEDGER + "/ledger/head": (503, None)}), N6)["state"], "red"))
    cases.append(("6 red on the real answers when the record is in no batch", check_day_root(w6(**{LEDGER + "/furui-check-day/" + SHA6: (200, dict(REAL["rec_1104"], status="pending_anchor", ledger_entry=None))}), N6)["state"], "red"))

    # ---- 16 witness_pool (2026-11-06) ----
    S16 = "16_witness_pool"
    x16 = st(world(cc=True), S16)
    cases.append(("16 ok: three outside witnesses (a furui-day from two domains, a tooshi-day from a GitHub account) in the 30 days before 03:47 UTC",
                  (x16["state"], x16["facts"]["distinct"], [(d["signed_domain"], d["last_signed"], d["last_entry"]) for d in x16["facts"]["domains"]], x16["facts"]["window"]),
                  ("ok", 3, [("a.example", "2026-10-20", 277), ("b.example", "2026-10-20", 277), ("github.com/someone", "2026-10-20", 277)], ["2026-10-06T03:47:00Z", "2026-11-05T03:47:00Z"])))
    p16 = lambda recs, n277="2026-10-20T00:30:30.000Z", **o: st(world(cc=True, **dict(pool_world(recs, n277), **o)), S16)
    x16r = p16(POOL3[:2])
    cases.append(("16 red: two outside witnesses (the line is 3); the day is red", (x16r["state"], x16r["facts"]["distinct"], run(world(cc=True, **pool_world(POOL3[:2])), now)[0]["verdict"]), ("red", 2, "red")))
    cases.append(("16 red: no outside witness at all", (lambda x: (x["state"], x["facts"]["distinct"], x["facts"]["domains"]))(p16([])), ("red", 0, [])))
    OURS = [pool_rec(d) for d in ("horizonshield.dev", "gate.horizonshield.dev", "the-horizons-innovation.com", "Shield.The-Horizons-Innovation.com",
                                  "hs-kira-line.oga-surf-project.workers.dev", "github.com/ogasurfproject-jpg", "GitHub.com/OgaSurfProject-JPG")]
    cases.append(("16 red: our zones, their subdomains (any case) and our GitHub account are not outside witnesses", (lambda x: (x["state"], x["facts"]["distinct"]))(p16(OURS + POOL3[:2])), ("red", 2)))
    LOOK = [pool_rec("horizonshield.dev.example"), pool_rec("nothorizonshield.dev"), pool_rec("github.com/ogasurfproject-jpg-x")]
    cases.append(("16 ok: names that only look like ours (a suffix without the dot, a longer GitHub account) are outside witnesses",
                  (lambda x: (x["state"], [d["signed_domain"] for d in x["facts"]["domains"]]))(p16(LOOK)), ("ok", ["github.com/ogasurfproject-jpg-x", "horizonshield.dev.example", "nothorizonshield.dev"])))
    WALK = [pool_rec("c.example", purpose="a2a-conduct-walk-v1: https://mcp.horizonshield.dev/mcp"), pool_rec("d.example", purpose="nenrin-instant-commitment-v1: w1"),
            pool_rec("e.example", purpose="furui-day-v0 2026-10-18"), pool_rec("f.example", purpose=None)]
    x16w = p16(POOL3[:2] + WALK)
    cases.append(("16 red: a walk of an endpoint, other purposes and a purpose without the day's prefix are not signatures over a day root (named as a number only)",
                  (x16w["state"], x16w["facts"]["distinct"], x16w["facts"]["other_purposes_only"]), ("red", 2, 4)))
    UNS = [pool_rec("c.example", signed=False), pool_rec(None), pool_rec("", signed=True), pool_rec("  ", signed=True), dict(pool_rec("d.example"), signed="true"), "x", None]
    cases.append(("16 red: unsigned records, records without a signed_domain and records of another shape are not counted", (lambda x: (x["state"], x["facts"]["distinct"]))(p16(POOL3[:2] + UNS)), ("red", 2)))
    x16d = st(world(cc=True, **dict(pool_world(POOL3[:2] + [pool_rec("A.Example", purpose="tooshi-day-v0: 2026-10-19")]),
                                    **{LEDGER + "/ledger/279?format=json": pool_batch(279, "2026-11-04T23:00:00.000Z", [pool_rec("a.example", purpose="furui-day-v0: 2026-11-02")])})), S16)
    cases.append(("16: one domain in several records and batches is one witness, and its latest batch is named", (x16d["state"], x16d["facts"]["distinct"], x16d["facts"]["domains"][0]),
                  ("red", 2, {"signed_domain": "a.example", "last_entry": 279, "last_signed": "2026-11-04"})))
    cases.append(("16 red: a batch made 1 second before the window (2026-10-06T03:46:59Z) is not read; at 03:47:00 it is",
                  (p16(POOL3, n277="2026-10-06T03:46:59.000Z")["state"], p16(POOL3, n277="2026-10-06T03:47:00.000Z")["state"]), ("red", "ok")))
    LATE = {LEDGER + "/ledger/head": (200, {"n": 281}), LEDGER + "/ledger/281?format=json": pool_batch(281, "2026-11-05T05:00:00.000Z", [pool_rec("z.example")])}
    r16a, r16b = run(world(cc=True, **dict(pool_world(POOL3[:2]), **LATE)), now)[0], run(world(cc=True, **dict(pool_world(POOL3[:2]), **LATE)), now.replace(hour=11, minute=50))[0]
    cases.append(("16: a batch made after 03:47 UTC of the day is not counted, so the 04:05 and 11:50 runs give the same 16",
                  ([x for x in r16a["checks"] if x["id"] == S16] == [x for x in r16b["checks"] if x["id"] == S16], [x for x in r16a["checks"] if x["id"] == S16][0]["facts"]["distinct"]), (True, 2)))
    PEND = {LEDGER + "/witness/pending": (200, {"count": 3, "pending": [dict(pool_rec(d), submitted_at="2026-11-05T01:00:00Z") for d in ("x.example", "y.example", "z.example")]})}
    cases.append(("16 red: signed records still in the pool are not counted (only the ledger's batches)", (lambda x: (x["state"], x["facts"]["distinct"]))(p16(POOL3[:2], **PEND)), ("red", 2)))
    x16n = st(world(cc=True, **{LEDGER + "/ledger/head": "down"}), S16)
    cases.append(("16 not_yet, not red: the ledger's head does not answer", (x16n["state"], "did not answer" in x16n["why"]), ("not_yet", True)))
    cases.append(("16 not_yet, not red: an entry inside the window does not answer (5xx three times) or answers 404",
                  (st(world(cc=True, **{LEDGER + "/ledger/278?format=json": "down"}), S16)["state"], st(world(cc=True, **{LEDGER + "/ledger/277?format=json": (404, {"error": "not found"})}), S16)["state"]), ("not_yet", "not_yet")))
    cases.append(("16 not_yet: the head answers without n", st(world(cc=True, **{LEDGER + "/ledger/head": (200, {"schema": "jidec-head-v1"})}), S16)["state"], "not_yet"))
    MANY = lambda u, raw=False: (200, {"n": 5000}) if u == LEDGER + "/ledger/head" else ((200, {"n": 1, "created_at": "2026-11-01T00:00:00.000Z", "record_canonical": "{}"}) if "/ledger/" in u else (404, None))
    x16m = check_witness_pool(MANY, now)
    cases.append(("16 not_yet: the window holds more entries than the scan reads (600)", (x16m["state"], x16m["facts"]["entries_read"]), ("not_yet", POOL_SCAN)))
    SHORT = {LEDGER + "/ledger/head": (200, {"n": 2}), LEDGER + "/ledger/2?format=json": pool_batch(2, "2026-10-30T00:30:00.000Z", POOL3), LEDGER + "/ledger/1?format=json": (200, {"n": 1, "created_at": "2026-10-29T00:00:00.000Z"})}
    cases.append(("16 ok: a ledger that starts inside the window is read to entry 1", (lambda x: (x["state"], x["facts"]["entries_read"]))(check_witness_pool(world(**SHORT), now)), ("ok", 2)))
    NY16 = {LEDGER + "/ledger/head": "down"}
    cases.append(("14: 16 not_yet has a deadline of 48 hours: one day before is within it, three days before is past it",
                  (st(world(cc=True, **dict(NY16, **{DAY_URL % "2026-11-04": pub_day("x", **{S16: "not_yet"})})), S14)["state"],
                   st(world(cc=True, **dict(NY16, **{DAY_URL % (now - datetime.timedelta(days=i)).strftime("%Y-%m-%d"): pub_day("x", **{S16: "not_yet"}) for i in (1, 2, 3)})), S14)["state"]), ("ok", "red")))
    cases.append(("16: no name of a person is in the result (witness_name and vantage of the batch records are never read)",
                  any(w in json.dumps(run(world(cc=True), now)[0]) for w in ("A Person", "a laptop")), False))
    cases.append(("16 does not change the states of 1 to 15 (the same run with 16 ok and 16 red)",
                  (lambda a, b: {k: v for k, v in a.items() if k != S16} == {k: v for k, v in b.items() if k != S16})(states(world(cc=True))[1], states(world(cc=True, **pool_world([])))[1]), True))
    # 16 on 2026-11-06's real answers (tooshi_real_pool_20261106.json: the ledger's entries 260 down to 72, names taken out)
    RP = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tooshi_real_pool_20261106.json"), encoding="utf-8"))

    def wp(add=None, **over):
        w = {LEDGER + "/ledger/head": (200, {"n": RP["ledger_head_n"]})}
        for k, v in RP["entries"].items():
            w[LEDGER + "/ledger/%s?format=json" % k] = (200, v)
        if add:
            e = dict(RP["entries"]["256"]); b = json.loads(e["record_canonical"]); b["records"] = b["records"] + add; e["record_canonical"] = canonical(b)
            w[LEDGER + "/ledger/256?format=json"] = (200, e)
        w.update(over)
        return lambda u, raw=False: w[u] if u in w else (404, None)
    r16 = check_witness_pool(wp(), N6)
    cases.append(("16 red on 2026-11-06's real answers: one outside witness signed a day root in the 30 days (pipavlo82.github.io, furui-day of 11-03, entry 256)",
                  (r16["state"], r16["facts"]["distinct"], r16["facts"]["domains"], r16["facts"]["entries_read"], r16["facts"]["window"]),
                  ("red", 1, [{"signed_domain": "pipavlo82.github.io", "last_entry": 256, "last_signed": "2026-11-06"}], 189, ["2026-10-07T03:47:00Z", "2026-11-06T03:47:00Z"])))
    cases.append(("16 on the real answers: the outside domains that only walked an endpoint (two) are a number in facts, not witnesses", r16["facts"]["other_purposes_only"], 2))
    cases.append(("16 red on the real answers with a second outside witness of the same day (2 of 3)", check_witness_pool(wp([pool_rec("w2.example", purpose="furui-day-v0: 2026-11-03")]), N6)["facts"]["distinct"], 2))
    cases.append(("16 ok on the real answers with two more outside witnesses of the same day (3)",
                  check_witness_pool(wp([pool_rec("w2.example", purpose="furui-day-v0: 2026-11-03"), pool_rec("w3.example", purpose="furui-day-v0: 2026-11-03")]), N6)["state"], "ok"))
    cases.append(("16 not_yet on the real answers when entry 150 inside the window does not answer", check_witness_pool(wp(**{LEDGER + "/ledger/150?format=json": (503, None)}), N6)["state"], "not_yet"))
    # our outward answers (tools/outward/outward_witness.py: horizonshield.dev recomputes another project's record and signs it)
    # go to the ledger as entries of their own; they are not outside witnesses of our days
    OUTW = canonical({"schema": "witness-answer-v0.1", "kind": "outside-record", "subject_domain": "invinoveritas.dev", "record_kind": "invinoveritas-slot-log",
                      "record_url": "https://invinoveritas.dev/decision-receipt/slots/log/2026-10-10", "record_sha256": hsh("day file"),
                      "recomputed": ["bytes_sha256", "entries_parse", "merkle_root", "prev_root_chain", "ots_anchor"], "anchor": {"block_height": 970851, "block_hash": hsh("block")},
                      "tool": "tools/outward/outward_witness.py sha256:" + hsh("tool"), "observed_at": "2026-11-05T12:00:00Z", "limits": ["only the steps listed"],
                      "witness": {"name": "horizonshield.dev", "key_id": "ed25519:0000000000000000", "key_url": "https://horizonshield.dev/.well-known/nenrin-witness-key.json"},
                      "signature": {"alg": "ed25519", "key_id": "ed25519:0000000000000000", "sig": "A" * 86 + "=="}})
    NO = RP["ledger_head_n"] + 1
    r16o = check_witness_pool(wp(**{LEDGER + "/ledger/head": (200, {"n": NO}), LEDGER + "/ledger/%d?format=json" % NO: (200, {"n": NO, "created_at": "2026-11-05T12:00:01.000Z",
                                    "claim_sha256": hashlib.sha256(OUTW.encode("utf-8")).hexdigest(), "record_canonical": OUTW, "schema": "v0",
                                    "work": "NENRIN outward witness: invinoveritas.dev invinoveritas-slot-log 2026-10-10"})}), N6)
    r16s = check_witness_pool(wp([pool_rec("horizonshield.dev", purpose="furui-day-v0: 2026-11-03"), pool_rec("outward.horizonshield.dev", purpose="tooshi-day-v0: 2026-11-04")]), N6)
    cases.append(("16 red on the real answers with our outward answer in the ledger (an entry of its own) or signed records from horizonshield.dev in a batch: distinct stays 1",
                  (r16o["state"], r16o["facts"]["distinct"], r16o["facts"]["entries_read"], r16s["state"], r16s["facts"]["distinct"]), ("red", 1, 190, "red", 1)))

    # ---- 17 paid_call_chain (2026-11-07) ----
    # one paid call of the window (11-03 03:47 to 11-04 03:47 UTC at the 11-05 run): an admit of the door's relying party under
    # the paid store's contract, submitted at 21:18:51; its envelope is leaf 1 of 11-03 (W3); entry 279 is the agreement batch of
    # 11-04 00:30; the agent's day file and the final settlement of 11-03 name it
    S17 = "17_paid_call_chain"
    RP17 = "shield.the-horizons-innovation.com"
    PC = hsh("the paid store's contract")
    STORES = [{"store": "hs-seki-demo", "contract_sha256": PC, "services": {"report": 20, "audit": 30, "compare": 50}},
              {"store": CHECK_STORE, "contract_sha256": CSHA, "services": {"check": 0}}]

    def paid_rec(e=D3[1], contract=PC, decision="admit", domain=RP17, tag="call 1"):
        r = {"schema": "a2a-admission-v0", "admission_id": tag, "decision": decision, "reasons": ["within_grant"] if decision == "admit" else ["outside_grant"],
             "rules": {"version": "0.4"}, "relying_party": {"domain": domain}, "contract_ref": {"contract_sha256": contract}}
        if e is not None:
            k = e["check"]
            r["content"] = {"rules": "a2a-content-check-v1", "input_commit": k["input_commit"], "check_sha256": hsh(canonical(k)), "rules_sha256": k["rules_sha256"],
                            "scope_sha256": k["scope_sha256"], "decision": k["decision"], "marks": k["marks"], "unread": k["unread"], "answered": k["answered"], "checked": True}
        t = canonical(r)
        return t, hsh(t)
    T17, R17 = paid_rec()
    AM17 = hsh("the admission of call 1")
    SETT17 = canonical({"schema": "a2a-settlement-v1.15", "verdict": "within_grant", "status": "final", "admission_gate": {"admissions_read": [{"admission_sha256": AM17, "decision": "admit"}]}})

    def batch(n, at, shas):
        return (200, {"n": n, "created_at": at, "record_canonical": canonical({"schema": "nenrin-agreement-batch-v1", "anchored_at": at, "count": len(shas),
                                                                                 "records": [{"canonical_sha256": x, "record_schema": "a2a-admission-v0", "verdict": "accepted"} for x in shas]})})

    def adm(t, r, at="2026-11-03T21:18:51.019Z", entry=279, am=AM17):
        return (200, {"canonical_sha256": r, "record_canonical": t, "status": "anchored" if entry else "pending_anchor", "ledger_entry": entry, "submitted_at": at, "report": {"admission_sha256": am}})

    def chain_world(recs=((T17, R17),), listed=None, pool=(), run_calls=None, sett=SETT17, **over):
        w = {DOOR_POLICY: (200, dict(world(cc=True)(DOOR_POLICY)[1], relying_party={"domain": RP17}, stores=STORES)),
             LEDGER + "/ledger/279?format=json": batch(279, "2026-11-04T00:30:38.000Z", [r for _t, r in recs] if listed is None else listed),
             LEDGER + "/agreement/pending": (200, {"count": len(pool), "pending": [{"canonical_sha256": r, "record_schema": "a2a-admission-v0", "verdict": "accepted"} for r in pool]}),
             HEARTBEAT_RUNS + "2026-11-03/RUN.json": (200, {"store": "hs-seki-demo", "ran_at": "2026-11-03T21:18:45Z",
                                                          "calls": [{"decision": "admit", "record_sha256": R17, "admission_sha256": AM17}, {"decision": "refuse", "record_sha256": hsh("a refusal")}] if run_calls is None else run_calls}),
             HEARTBEAT_RUNS + "2026-11-03/SETTLED.json": (200, {"status": "final", "verdict": "within_grant", "settlement_sha256": hsh(sett)}),
             HEARTBEAT_RUNS + "2026-11-03/settlement.json": (200, sett)}
        for t, r in recs:
            w[LEDGER + "/admission/" + r] = adm(t, r)
            w[DOOR_RECORD + r] = (200, t)
        w.update(over)
        return w
    c17 = lambda **o: check_paid_chain(world(cc=True, **chain_world(**o)), now)
    m17 = lambda x: (x["state"], [(m["call"], m["lacks"]) for m in x["facts"].get("missing", [])])
    x17 = c17()
    cases.append(("17 ok: the one paid call of the window carries its FURUI envelope (leaf 1 of 11-03), SEKI record, MUSUBI settlement and NENRIN entry (279)",
                  (x17["state"], x17["facts"]["window"], x17["facts"]["stores"], x17["facts"]["calls"], x17["facts"]["complete"], x17["facts"]["missing"]),
                  ("ok", ["2026-11-03T03:47:00Z", "2026-11-04T03:47:00Z"], ["hs-seki-demo"], 1, 1, [])))
    cases.append(("17 ok names its complete calls (complete_calls, read by tooshi_follow); a red day names none of its missing calls there",
                  (len(x17["facts"]["complete_calls"]) == 1 and all(H64.match(v) for v in x17["facts"]["complete_calls"]),
                   (lambda r: r["facts"]["complete_calls"])(c17(recs=(paid_rec(e=None),), run_calls=[]))), (True, [])), )
    TN, RN = paid_rec(e=None)
    cases.append(("17 red: a paid call whose record carries no content check (the door did not call the runner); its id and furui_envelope are named",
                  m17(c17(recs=((TN, RN),), run_calls=[])), ("red", [(RN, ["furui_envelope"])])))
    TO, RO = paid_rec(e=envelope("2026-11-03", 7))
    cases.append(("17 red: the record names a check that no leaf of the runner's day holds", m17(c17(recs=((TO, RO),), run_calls=[])), ("red", [(RO, ["furui_envelope"])])))
    TB, RB = paid_rec(e=D3[1], tag="call 1 with a bad leaf")
    cases.append(("17 red: the leaf that holds the check does not verify (runner-1's signature)",
                  m17(c17(recs=((TB, RB),), run_calls=[], **{RUNNER + "/furui/day/2026-11-03/leaf/1": (200, dict(W3[RUNNER + "/furui/day/2026-11-03/leaf/1"][1], envelope=envelope("2026-11-03", 1, key=SK2)))})),
                  ("red", [(RB, ["furui_envelope"])])))
    cases.append(("17 red: the door serves other bytes for the record, or none, or does not answer (seki_record)",
                  (m17(c17(**{DOOR_RECORD + R17: (200, T17 + " ")})), m17(c17(**{DOOR_RECORD + R17: (404, {"error": "not_found"})})), m17(c17(**{DOOR_RECORD + R17: "down"}))),
                  (("red", [(R17, ["seki_record"])]),) * 3))
    cases.append(("17 red: no final settlement names the admission: none filed, not final, bytes other than SETTLED.json names, another admission listed",
                  (m17(c17(**{HEARTBEAT_RUNS + "2026-11-03/SETTLED.json": (404, None)})), m17(c17(**{HEARTBEAT_RUNS + "2026-11-03/SETTLED.json": (200, {"status": "pending", "settlement_sha256": hsh(SETT17)})})),
                   m17(c17(**{HEARTBEAT_RUNS + "2026-11-03/settlement.json": (200, SETT17 + " ")})), m17(c17(sett=SETT17.replace(AM17, hsh("another admission"))))),
                  (("red", [(R17, ["musubi_settlement"])]),) * 4))
    cases.append(("17 red: a paid store with no public place for its settlements", m17(check_paid_chain(world(cc=True, **chain_world(**{DOOR_POLICY: (200, {"relying_party": {"domain": RP17},
                  "stores": [dict(STORES[0], store="another-paid-store")]})})), now)), ("red", [(R17, ["musubi_settlement"])])))
    x17n = c17(**{LEDGER + "/ledger/280?format=json": batch(280, "2026-11-05T00:30:41.000Z", [R17])})
    cases.append(("17 red: the record is listed by two agreement batches (one of each)", (m17(x17n), "in 2 agreement batches (280, 279)" in x17n["why"]), (("red", [(R17, ["nenrin_entry"])]), True)))
    cases.append(("17 red: the record is still in the ledger's pool, in no batch made by 03:47 UTC", m17(c17(listed=[], pool=[R17])), ("red", [(R17, ["nenrin_entry"])])))
    cases.append(("17 red: a call in the agent's day file that never reached the ledger (no SEKI record on the ledger, so no content block, no batch)",
                  m17(c17(recs=(), **{LEDGER + "/admission/" + R17: (404, {"error": "not_found"}), DOOR_RECORD + R17: (200, T17)})), ("red", [(R17, ["seki_record", "furui_envelope", "nenrin_entry"])])))
    cases.append(("17 red: the agent's day file does not answer, answers 403, or has no list of calls (a call might be missed)",
                  tuple(c17(**{HEARTBEAT_RUNS + "2026-11-03/RUN.json": v})["state"] for v in ("down", (403, None), (200, {"store": "hs-seki-demo", "ran_at": "2026-11-03T21:18:45Z"}))), ("red",) * 3))
    W4b, _s4b = day_world("2026-11-04", [D3[1], envelope("2026-11-04", 5)], 262, "2026-11-05")
    x17t = c17(**dict(W4b, **{LEDGER + "/admission/" + R17: adm(T17, R17, at="2026-11-04T00:05:00.000Z")}))
    cases.append(("17 red: a call 5 minutes after midnight whose check is held by a leaf of each of the two days it is read in (one of each)",
                  (m17(x17t), "FURUI: 2 leaves hold the check" in x17t["why"]), (("red", [(R17, ["furui_envelope"])]), True)))
    TR, RR = paid_rec(decision="refuse", tag="a refusal the day file calls an admit")
    cases.append(("17 red: a call the agent's day file names as admit whose record is a refusal, in no batch",
                  m17(c17(recs=(), run_calls=[{"decision": "admit", "record_sha256": RR, "admission_sha256": AM17}], **{LEDGER + "/admission/" + RR: adm(TR, RR, at="2026-11-04T05:00:00.000Z"), DOOR_RECORD + RR: (200, TR)})),
                  ("red", [(RR, ["seki_record", "nenrin_entry"])])))
    OTHER = [paid_rec(decision="refuse", tag="a refusal"), paid_rec(contract=CSHA, tag="the check call"), paid_rec(domain="other.example", tag="another door"),
             paid_rec(contract=hsh("another contract"), tag="another contract")]
    EARLY, LATE = paid_rec(tag="before the window"), paid_rec(tag="after the window")
    x17z = c17(recs=tuple(OTHER) + (EARLY, LATE), run_calls=[], **{LEDGER + "/admission/" + EARLY[1]: adm(*EARLY, at="2026-11-03T03:46:59.000Z"), LEDGER + "/admission/" + LATE[1]: adm(*LATE, at="2026-11-04T03:47:00.000Z")})
    cases.append(("17 ok with 0 calls: a refusal, an admit of the check store (price 0), another relying party, another contract, and paid admits submitted 1 second before or at the end of the window are not paid calls of the window",
                  (x17z["state"], x17z["facts"]["calls"], x17z["facts"]["missing"], "0 calls" in x17z["why"]), ("ok", 0, [], True)))
    cases.append(("17 ok with 0 calls: the door prices no store above 0 (the ledger is not read; its head is down)",
                  (lambda x: (x["state"], x["facts"]["calls"]))(check_paid_chain(world(cc=True, **chain_world(**{DOOR_POLICY: (200, {"relying_party": {"domain": RP17}, "stores": STORES[1:]}), LEDGER + "/ledger/head": "down"})), now)), ("ok", 0)))
    cases.append(("17 not_yet, not red: the ledger's head does not answer; an entry of the window answers 5xx; the pool answers 5xx; a listed admission is not served",
                  tuple(c17(**o)["state"] for o in ({LEDGER + "/ledger/head": "down"}, {LEDGER + "/ledger/278?format=json": "down"}, {LEDGER + "/agreement/pending": (503, None)}, {LEDGER + "/admission/" + R17: (404, {"error": "not_found"})})),
                  ("not_yet",) * 4))
    cases.append(("17 red: the door policy does not answer, or names a paid store without a relying party",
                  (c17(**{DOOR_POLICY: "down"})["state"], c17(**{DOOR_POLICY: (200, {"stores": STORES})})["state"]), ("red", "red")))
    L17 = {LEDGER + "/ledger/head": (200, {"n": 281}), LEDGER + "/ledger/281?format=json": batch(281, "2026-11-05T05:00:00.000Z", [R17])}
    cases.append(("17: a batch made after 03:47 UTC of the day is not read, so the 04:05 and 11:50 runs give the same 17",
                  (lambda a, b: (a == b, a["state"]))(check_paid_chain(world(cc=True, **chain_world(**L17)), now), check_paid_chain(world(cc=True, **chain_world(**L17)), now.replace(hour=11, minute=50))), (True, "ok")))
    r17 = run(world(cc=True, **chain_world()), now)[0]
    cases.append(("17: the whole day holds with 17 (one paid call, all four records): every check ok, the verdict green, 23 checks (18 and 22 dormant, 25 a notice)",
                  (r17["verdict"], len(r17["checks"]), r17["counts"]["ok"], [x["state"] for x in r17["checks"] if x["id"] == S17]), ("green", 23, 20, ["ok"])))
    cases.append(("17 does not change the states of 1 to 16 (the same run with 17 ok and 17 red)",
                  (lambda a, b: {k: v for k, v in a.items() if k not in (S17, S14)} == {k: v for k, v in b.items() if k not in (S17, S14)})(states(world(cc=True, **chain_world()))[1], states(world(cc=True, **chain_world(recs=((TN, RN),), run_calls=[])))[1]), True))
    # ---- 17 with admission 0.5 (two runners) and 18 (FURUI 1.0) ----
    # the paid call's record names two checks: runner-1's is leaf 1 of 11-03 (W3), runner-2's is leaf 0 of runner-2's 11-03, at
    # /furui2/day, signed with runner-2's key (SK2) listed beside runner-1's in furui-check-keys.json
    def envelope2(d, i, **chk):
        e = envelope(d, i, **chk)
        e["signatures"] = [{"alg": "ed25519", "domain": "horizonshield.dev", "key_id": "runner-2", "sig": base64.b64encode(ed25519_sign(SK2, envelope_message(e))).decode()}]
        return e
    E2 = [envelope2("2026-11-03", 0, nonce="%032x" % 77)]
    W2 = {k.replace("/furui/day/", "/furui2/day/"): v for k, v in day_world("2026-11-03", E2, 9001, "2026-11-04")[0].items()}
    for k_, v_ in list(W2.items()):
        if "/furui2/day/" in k_ and "/leaf/" in k_:
            W2[k_] = (200, dict(v_[1]))
    KEYS2 = {LEDGER + "/.well-known/furui-check-keys.json": (200, {"use": "furui-check", "keys": [
        {"key_id": "runner-1", "public_key_ed25519_b64": PUB, "from_height": 0, "revoked_height": None},
        {"key_id": "runner-2", "public_key_ed25519_b64": base64.b64encode(ed25519_public(SK2)).decode(), "from_height": 0, "revoked_height": None}]})}

    def paid_rec5(checks, tag="call 1 of two runners", kind="none"):
        r = {"schema": "a2a-admission-v0", "admission_id": tag, "decision": "admit", "reasons": ["within_grant"], "rules": {"version": "0.5"},
             "relying_party": {"domain": RP17}, "contract_ref": {"contract_sha256": PC},
             "content": {"rules": "a2a-content-check-v2", "checked": True, "decision": "pass", "quorum": {"required": 2, "answered": sum(1 for q in checks if q["why"] == "ok")},
                         "disagreement_kind": kind, "marks": [], "checks": checks}}
        t = canonical(r)
        return t, hsh(t)
    q5 = lambda rid, e, why="ok": {"runner_id": rid, "key_id": rid, "check_sha256": hsh(canonical(e["check"])) if e is not None else None, "why": why}
    T5, R5 = paid_rec5([q5("runner-1", D3[1]), q5("runner-2", E2[0])])
    c5 = lambda recs, **o: check_paid_chain(world(cc=True, **dict(chain_world(recs=recs, run_calls=[], **o), **W2, **KEYS2)), now)
    x5 = c5(((T5, R5),))
    cases.append(("17 ok with admission 0.5: each of the two checks is held by one leaf of its own runner's day (runner-1 at /furui/day, runner-2 at /furui2/day); "
                  "17 hands 18 the record's quorum and disagreement_kind",
                  (x5["state"], x5["facts"]["calls"], x5["facts"]["missing"], x5.get(V05_KEY)), ("ok", 1, [], [{"call": R5, "quorum": {"required": 2, "answered": 2}, "disagreement_kind": "none"}])))
    T5b, R5b = paid_rec5([q5("runner-1", D3[1]), q5("runner-2", envelope2("2026-11-03", 5))], tag="runner-2's check in no leaf")
    x5b = c5(((T5b, R5b),))
    cases.append(("17 red with admission 0.5: runner-2's check is in no leaf of runner-2's day (furui_envelope, runner-2 named)",
                  (m17(x5b), "leaves of runner-2 hold the check" in x5b["why"]), (("red", [(R5b, ["furui_envelope"])]), True)))
    T5c, R5c = paid_rec5([q5("runner-1", D3[1]), q5("runner-3", E2[0])], tag="a third runner")
    T5d, R5d = paid_rec5([q5("runner-1", None, "no_envelope"), q5("runner-2", None, "timeout")], tag="no answer")
    T5e, R5e = paid_rec5([q5("runner-1", D3[1]), q5("runner-2", D3[2])], tag="runner-2's check in runner-1's day")
    cases.append(("17 red with admission 0.5: a check of a runner with no day tree, no check read as an answer, or runner-2's check held only by runner-1's day",
                  (m17(c5(((T5c, R5c),))), m17(c5(((T5d, R5d),))), m17(c5(((T5e, R5e),)))),
                  (("red", [(R5c, ["furui_envelope"])]), ("red", [(R5d, ["furui_envelope"])]), ("red", [(R5e, ["furui_envelope"])]))))
    cases.append(("17 with admission 0.4 reads as before beside a 0.5 world: the same answer with runner-2's day and key present",
                  (lambda a, b: (a == b, a["state"]))(c17(), check_paid_chain(world(cc=True, **dict(chain_world(), **W2, **KEYS2)), now)), (True, "ok")))
    x18 = check_two_runners(world(cc=True), now, [])
    cases.append(("18 dormant while no paid call carries admission 0.5 (notice, facts.dormant, waits_for an_admission_0_5); the door shows no runner-2 canary yet",
                  (x18["state"], x18["facts"]["dormant"], x18["why"].startswith("dormant: "), x18["facts"]["waits_for"], x18["facts"]["records"], x18["facts"]["canary_runner2"]),
                  ("notice", True, True, "an_admission_0_5", 0, False)))
    K2 = {"day": "2026-11-05", "decision": "stop", "ok": True, "touched": False, "check_sha256": hsh("canary 2")}
    DP2 = {DOOR_POLICY: (200, dict(world(cc=True)(DOOR_POLICY)[1], furui=dict(world(cc=True)(DOOR_POLICY)[1].get("furui", {}), canary_call_runner2=K2, canary_call_runner2_prev=dict(K2, day="2026-11-04"))))}
    V5OK = [{"call": R5, "quorum": {"required": 2, "answered": 2}, "disagreement_kind": "none"}, {"call": R5e, "quorum": {"required": 2, "answered": 2}, "disagreement_kind": "marks"}]
    x18b = check_two_runners(world(cc=True, **DP2), now, V5OK)
    cases.append(("18 counted from the first paid call with admission 0.5: ok with each quorum met, the disagreement_kind counted (none 1, marks 1), runner-2's canary read",
                  (x18b["state"], x18b["facts"].get("dormant"), x18b["facts"]["records"], x18b["facts"]["quorum_short"], x18b["facts"]["disagreement_kind"], x18b["facts"]["canary_runner2"],
                   x18b["facts"]["canary_runner2_prev"], x18b["facts"]["canary_runner2_decision"]), ("ok", None, 2, 0, {"marks": 1, "none": 1}, True, True, "stop")))
    DPT = {DOOR_POLICY: (200, dict(world(cc=True)(DOOR_POLICY)[1], furui=dict(world(cc=True)(DOOR_POLICY)[1].get("furui", {}), canary_call_runner2=dict(K2, touched=True))))}
    cases.append(("18 red: a 0.5 admit short of its quorum, or runner-2's canary call touched the phrase; ok without runner-2's canary (it is read, not required)",
                  (check_two_runners(world(cc=True, **DP2), now, V5OK + [{"call": R5b, "quorum": {"required": 2, "answered": 1}, "disagreement_kind": "n/a"}])["state"],
                   check_two_runners(world(cc=True, **DPT), now, V5OK)["state"], check_two_runners(world(cc=True), now, V5OK)["state"]), ("red", "red", "ok")))
    KF = dict(K2, ok=False, error="runner_no_envelope", decision=None)
    DPF = {DOOR_POLICY: (200, dict(world(cc=True)(DOOR_POLICY)[1], furui=dict(world(cc=True)(DOOR_POLICY)[1].get("furui", {}), canary_call_runner2=KF)))}
    x18f, x18t = check_two_runners(world(cc=True, **DPF), now, []), check_two_runners(world(cc=True, **DPT), now, [])
    cases.append(("18 red before the first 0.5 record when runner-2's canary says ok false or touched the phrase (not dormant then); dormant with a canary that held",
                  (x18f["state"], "failed: runner_no_envelope" in x18f["why"], x18f["facts"].get("dormant"), x18t["state"], check_two_runners(world(cc=True, **DP2), now, [])["state"]),
                  ("red", True, None, "red", "notice")))
    SH = [{"call": hsh("short 1"), "store": "hs-seki-demo", "quorum": {"required": 2, "answered": 1}, "why": {"runner-2": "timeout"}},
          {"call": hsh("short 2"), "store": "hs-seki-demo", "quorum": {"required": 2, "answered": 0}, "why": {"runner-1": "no_envelope", "runner-2": "capped"}}]
    x18s, x18o = check_two_runners(world(cc=True, **DP2), now, V5OK, SH), check_two_runners(world(cc=True, **DP2), now, [], SH)
    cases.append(("18 counts the 0.5 escalations short of their quorum in its facts (unanswered_escalate, unanswered_by runner:why), never red; with only such escalations it is counted, not dormant",
                  (x18s["state"], x18s["facts"]["unanswered_escalate"], x18s["facts"]["unanswered_by"], x18o["state"], x18o["facts"].get("dormant"), x18o["facts"]["records"],
                   check_two_runners(world(cc=True, **DPF), now, V5OK, SH)["state"]),
                  ("ok", 2, {"runner-1:no_envelope": 1, "runner-2:capped": 1, "runner-2:timeout": 1}, "ok", None, 0, "red")))

    def esc_rec5(checks, tag, version="0.5"):
        r = {"schema": "a2a-admission-v0", "admission_id": tag, "decision": "escalate", "reasons": ["content_unchecked"], "rules": {"version": version},
             "relying_party": {"domain": RP17}, "contract_ref": {"contract_sha256": PC},
             "content": {"rules": "a2a-content-check-v2", "checked": False, "decision": None, "quorum": {"required": 2, "answered": sum(1 for q in checks if q["why"] == "ok")},
                         "disagreement_kind": "n/a", "marks": [], "checks": checks}}
        t = canonical(r)
        return t, hsh(t)
    TS1, RS1 = esc_rec5([q5("runner-1", D3[1]), q5("runner-2", None, "timeout")], "runner-2 timed out")
    TS2, RS2 = esc_rec5([q5("runner-1", D3[1]), q5("runner-2", E2[0])], "a rule conflict, both answered")
    TS3, RS3 = esc_rec5([q5("runner-1", None, "no_envelope")], "a 0.4 escalation", version="0.4")
    x5s = c5(((T5, R5), (TS1, RS1), (TS2, RS2), (TS3, RS3)))
    sh5 = x5s.get(SHORT_KEY) or [{}]
    cases.append(("17 hands 18 the 0.5 escalations of its window short of their quorum (runner-2 timed out), not one whose quorum was met nor a 0.4 one; the admit is read as before",
                  (x5s["state"], x5s["facts"]["calls"], len(x5s.get(SHORT_KEY) or []), sh5[0].get("call"), sh5[0].get("quorum"), sh5[0].get("why"), sh5[0].get("store") in x5s["facts"]["stores"]),
                  ("ok", 1, 1, RS1, {"required": 2, "answered": 1}, {"runner-2": "timeout"}, True)))
    r5s = run(world(cc=True, **dict(chain_world(recs=((T5, R5), (TS1, RS1)), run_calls=[]), **W2, **KEYS2)), now)
    s5s = {x["id"]: x for x in r5s[0]["checks"]}
    cases.append(("run: 18 counts the escalation 17 handed over (unanswered_escalate 1, runner-2:timeout 1) and stays ok; the hand-over key is not in the written result",
                  (s5s["18_two_runners"]["state"], s5s["18_two_runners"]["facts"]["unanswered_escalate"], s5s["18_two_runners"]["facts"]["unanswered_by"], SHORT_KEY in r5s[1]),
                  ("ok", 1, {"runner-2:timeout": 1}, False)))
    r5 = run(world(cc=True, **dict(chain_world(recs=((T5, R5),), run_calls=[]), **W2, **KEYS2)), now)
    s5 = {x["id"]: x for x in r5[0]["checks"]}
    cases.append(("run: 17 ok with the 0.5 record, 18 counted (ok) with it; the hand-over key is not in the written result",
                  (s5[S17]["state"], s5["18_two_runners"]["state"], s5["18_two_runners"]["facts"]["records"], V05_KEY in r5[1], len(r5[0]["checks"])), ("ok", "ok", 1, False, 23)))
    rg = run(world(cc=True, **chain_world()), now)[0]
    sg = {x["id"]: x for x in rg["checks"]}
    cases.append(("a day with no red is green while 18 and 24 are dormant (both notice with facts.dormant; the verdict and 14 do not count them)",
                  (rg["verdict"], sg["18_two_runners"]["state"], sg["18_two_runners"]["facts"].get("dormant"), sg["14_not_yet_deadline"]["state"], rg["counts"]["not_yet"]),
                  ("green", "notice", True, "ok", 0)))
    NY17 = {LEDGER + "/ledger/head": "down", DOOR_POLICY: (200, dict(world(cc=True)(DOOR_POLICY)[1], relying_party={"domain": RP17}, stores=STORES))}
    cases.append(("14: 17 not_yet has a deadline of 48 hours: one day before is within it, three days before is past it",
                  (st(world(cc=True, **dict(NY17, **{DAY_URL % "2026-11-04": pub_day("x", **{S17: "not_yet"})})), S14)["state"],
                   st(world(cc=True, **dict(NY17, **{DAY_URL % (now - datetime.timedelta(days=i)).strftime("%Y-%m-%d"): pub_day("x", **{S17: "not_yet"}) for i in (1, 2, 3)})), S14)["state"]), ("ok", "red")))
    # 17 on 2026-11-06's real answers (tooshi_real_chain_20261106.json): the window 11-04 03:47 to 11-05 03:47 UTC
    RC = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tooshi_real_chain_20261106.json"), encoding="utf-8"))["answers"]

    def wc(**over):
        w = {u: tuple(v) for u, v in RC.items()}
        w.update(over)

        def g(u, raw=False):
            v = w.get(u, (404, None))
            if v == "down":
                raise Unreachable(u + ": http 503 after 3 tries")
            return v
        return g
    REAL17 = "0723f41140ba829b4577eff41a25776ede0d16156ae5a7445a0a307a8102e669"
    xr = check_paid_chain(wc(), N6)
    cases.append(("17 red on 2026-11-06's real answers: the one paid call of the window (hs-seki-demo report, 11-04 21:18) has its SEKI record, MUSUBI settlement and NENRIN entry (250) and no FURUI envelope",
                  (xr["state"], xr["facts"]["window"], xr["facts"]["calls"], xr["facts"]["complete"], m17(xr)[1], xr["facts"]["entries_read"]),
                  ("red", ["2026-11-04T03:47:00Z", "2026-11-05T03:47:00Z"], 1, 0, [(REAL17, ["furui_envelope"])], 14)))
    cases.append(("17 red on the real answers: the call named in missing is not in complete_calls", (REAL17 in xr["facts"]["complete_calls"], xr["facts"]["complete_calls"]), (False, [])))
    cases.append(("17 on the real answers: 27 admissions read, and the two refusals of 11-04, the check calls (price 0) and the admits of another contract are not paid calls",
                  (len([u for u in RC if u.startswith(LEDGER + "/admission/")]), xr["facts"]["calls"]), (27, 1)))
    cases.append(("17 red on the real answers without the settlement of 11-04, or with the door down: each lack is named",
                  (m17(check_paid_chain(wc(**{HEARTBEAT_RUNS + "2026-11-04/SETTLED.json": (404, None)}), N6))[1], m17(check_paid_chain(wc(**{DOOR_RECORD + REAL17: "down"}), N6))[1]),
                  ([(REAL17, ["furui_envelope", "musubi_settlement"])], [(REAL17, ["seki_record", "furui_envelope"])])))
    cases.append(("17 on the real answers: the 11:50 run reads the same 17 as the 04:05 run, and the ledger's head down makes it not_yet",
                  (check_paid_chain(wc(), N6.replace(hour=11, minute=50)) == xr, check_paid_chain(wc(**{LEDGER + "/ledger/head": "down"}), N6)["state"]), (True, "not_yet")))

    # ---- 24 content_mismatch (2026-11-07): the heartbeat's scene mismatch, read from the run of the day of 03:47 UTC six hours back ----
    S24 = "24_content_mismatch"
    RUN4 = HEARTBEAT_RUNS + "2026-11-04/RUN.json"
    three = [{"service": "report", "decision": "admit", "record_sha256": hsh("r")}, {"service": "audit", "decision": "refuse"}, {"service": "compare", "decision": "refuse"}]
    run4 = lambda *rows: (200, {"store": "hs-seki-demo", "ran_at": "2026-11-04T21:18:40Z", "calls": three + list(rows)})
    s24 = lambda when=now, **o: (lambda x: (x["state"], x["facts"].get("day"), x["facts"].get("status"), x["facts"].get("error")))(st(world(cc=True, **o), S24, when))
    cases.append(("24 ok: the run of 11-04 (read at the 11-05 04:05 run) has the scene mismatch at 400 content_mismatch", s24(**{RUN4: run4(MM_ROW)}), ("ok", "2026-11-04", 400, "content_mismatch")))
    cases.append(("24 reads the same day at 03:40 and 11:50 UTC, and the next day at the next day's run",
                  (s24(datetime.datetime(2026, 11, 5, 3, 40, tzinfo=datetime.timezone.utc))[1], s24(now.replace(hour=11, minute=50))[1], s24(now + datetime.timedelta(days=1))[:2]),
                  ("2026-11-04", "2026-11-04", ("not_yet", "2026-11-05"))))
    cases.append(("24 red: the scene got 403 (the door answered: the gateway that runs has no content match), and the why says so",
                  (s24(**{RUN4: run4(dict(MM_ROW, status=403, error=None))})[0], "the gateway that runs has no content match" in st(world(cc=True, **{RUN4: run4(dict(MM_ROW, status=403, error=None))}), S24)["why"]), ("red", True)))
    cases.append(("24 red: a 2xx, another 400, a 402, no status (the gateway did not answer)",
                  tuple(s24(**{RUN4: run4(dict(MM_ROW, **v))})[0] for v in ({"status": 200, "error": None}, {"status": 400, "error": "bad_payload"}, {"status": 402, "error": "insufficient_tickets"}, {"status": None, "error": None})), ("red",) * 4))
    cases.append(("24 red: two scene rows, the day file answers 403 or without calls, or does not answer",
                  tuple(s24(**{RUN4: v})[0] for v in (run4(MM_ROW, MM_ROW), (403, None), (200, {"store": "hs-seki-demo"}), "down")), ("red",) * 4))
    cases.append(("24 dormant (notice, facts.dormant): the scene was not run (the gateway did not say seki_content_match), the run has no scene (a day before it); not_yet: the day is not filed",
                  tuple((x["state"], x["facts"].get("dormant")) for x in (st(world(cc=True, **{RUN4: v}), S24) for v in (run4(dict(MM_ROW, status=None, error=None, not_yet="GET /health answered http 200 without seki_content_match true")), run4(), (404, None)))),
                  (("notice", True), ("notice", True), ("not_yet", None))))
    rd24 = run(world(cc=True, **{RUN4: run4()}), now)[0]
    cases.append(("a day with no red is green while 24 is dormant (its run has no scene), and 24 is counted from the first day the scene ran",
                  (rd24["verdict"], [x["state"] for x in rd24["checks"] if x["id"] == S24], st(world(cc=True, **{RUN4: run4(dict(MM_ROW, status=403, error=None))}), S24)["state"]),
                  ("green", ["notice"], "red")))
    cases.append(("24's row does not change 17 (the scene row has no decision, so it is not a paid call) and 17's days do not change 24",
                  (m17(c17(run_calls=[{"decision": "admit", "record_sha256": R17, "admission_sha256": AM17}, dict(MM_ROW)])) == m17(x17), st(world(cc=True, **chain_world()), S24)["state"]), (True, "ok")))
    cases.append(("24 does not change the states of the other checks (the same run with 24 ok and 24 red)",
                  (lambda a, b: {k: v for k, v in a.items() if k not in (S24, S14)} == {k: v for k, v in b.items() if k not in (S24, S14)})(states(world(cc=True))[1], states(world(cc=True, **{RUN4: run4(dict(MM_ROW, status=403))}))[1]), True))

    # ---- 22 loss_bound (2026-11-07; loss-bound-v1 from 2026-11-12): each admit of the day 24 reads under the contract the run names; a notice, never red ----
    S22 = "22_loss_bound"
    LBC = {"contract_id": "11" * 16, "grant": {"authorized_actions": ["report", "audit"], "prohibited_actions": ["compare"], "conditional": [],
                                               "limits": {"report": {"max_amount": 20, "unit": "ticket"}, "audit": {"max_amount": 25, "unit": "ticket"}}},
           "signatures": [{"domain": "x.invalid", "sig_b64": "AA=="}]}
    LBS = lb_contract_sha256(LBC)
    LBP = (200, {"stores": [{"store": "hs-seki-demo", "policy": {"exposure": {"report": {"window_blocks": 6, "max_acts": 1}}}}]})
    run22 = lambda *rows, csha=LBS: (200, {"store": "hs-seki-demo", "contract_sha256": csha, "ran_at": "2026-11-04T21:18:40Z", "calls": list(rows)})
    A22 = {"service": "report", "decision": "admit", "record_sha256": hsh("r22")}
    LBC2 = {"contract_id": "22" * 16, "grant": {"authorized_actions": ["report"], "prohibited_actions": ["audit", "compare"], "conditional": [],
                                                "limits": {"report": {"max_amount": 20, "unit": "ticket"}}, "exposure": {"report": {"window_blocks": 144, "max_acts": 4}},
                                                "payload_schema": {"report": {"schema": "payload-schema-v0", "other_fields": "refuse", "fields": {
                                                    "koji_type": {"type": "enum", "values": ["gaiheki_30tsubo"], "required": True},
                                                    "teiji_kingaku": {"type": "integer", "min": 1, "max": 1000000000, "required": True}}}}}}
    LBS2 = lb_contract_sha256(LBC2)
    U22, U22OLD = LB_CONTRACTS["hs-seki-demo"]
    w22 = lambda run_=None, **o: world(cc=True, **dict({RUN4: run_ or run22(A22, {"service": "audit", "decision": "refuse"}, MM_ROW), U22: (200, LBC2), U22OLD: (200, LBC), DOOR_POLICY: LBP}, **o))
    x22 = st(w22(), S22)
    x22n = st(w22(run22(A22, {"service": "audit", "decision": "refuse"}, MM_ROW, csha=LBS2)), S22)
    cases.append(("22 notice: under the contract that binds the payload (the first in LB_CONTRACTS) the admit of report is finite, L 20 ticket, l_day 80 per 144 blocks",
                  (x22n["state"], x22n["facts"]["finite"], x22n["facts"]["not_finite"], x22n["facts"]["l_day"], x22n["facts"]["contract"], "1 of 1 admits" in x22n["why"]),
                  ("notice", 1, [], [{"action": "report", "l_day": 80, "unit": "ticket", "per_blocks": 144}], U22, True)))
    cases.append(("22 notice: a run under the earlier contract (the second in LB_CONTRACTS): the admit of report under limits 20 ticket is not finite (payload_unbound); the window of the door's policy is 20 ticket per 6 blocks",
                  (x22["state"], x22["facts"]["admits"], x22["facts"]["finite"], x22["facts"]["not_finite"], x22["facts"]["window"], x22["facts"].get("dormant")),
                  ("notice", 1, 0, [{"record_sha256": hsh("r22"), "action": "report", "class": "authorized", "amount_max": 20, "unit": "ticket", "open_fields": "payload_unbound"}],
                   [{"action": "report", "amount": 20, "unit": "ticket", "per_blocks": 6}], None)))
    cases.append(("22: the why names the call that is not finite, says why, and the facts say what a ticket is",
                  ("0 of 1 admits" in x22["why"] and hsh("r22")[:8] in x22["why"] and "payload_unbound" in x22["why"], "no monetary value" in x22["facts"]["unit_note"]), (True, True)))
    x22p = st(w22(run22(dict(A22, service="compare"), A22)), S22)
    cases.append(("22: an admit of a prohibited action has L 0 and is finite; the other is named", (x22p["facts"]["finite"], [x["action"] for x in x22p["facts"]["not_finite"]]), (1, ["report"])))
    cases.append(("22 dormant (notice, facts.dormant): the day's run has no admit (only the scene), or is not filed",
                  tuple((x["state"], x["facts"].get("dormant")) for x in (st(world(cc=True), S22), st(w22(run_=(404, None)), S22))), (("notice", True), ("notice", True))))
    cases.append(("22 never red: the day file down, the contract not the run's, the contract down, the policy down (window empty)",
                  (st(w22(run_="down"), S22)["state"], st(w22(run_=run22(A22, csha="00" * 32)), S22)["facts"].get("unread"),
                   st(w22(**{U22OLD: "down"}), S22)["facts"].get("unread"), (lambda x: (x["state"], x["facts"]["window"], x["facts"]["policy"]))(st(w22(**{DOOR_POLICY: "down"}), S22))),
                  ("notice", "contract", "contract", ("notice", [], "unread"))))
    vnot = lambda r: (lambda xs: "red" if any(x["state"] == "red" for x in xs) else ("green" if not any(x["state"] == "not_yet" for x in xs) else "not_all_checked"))([x for x in r["checks"] if x["id"] != S22])
    r22s = [run(g, now)[0] for g in (w22(), w22(run_=run22(dict(A22, service="compare"), A22)), w22(run_="down"), world(cc=True))]
    cases.append(("22 is a notice on every day above and the verdict is what the other checks give without it",
                  ([[x["state"] for x in r["checks"] if x["id"] == S22] for r in r22s], all(r["verdict"] == vnot(r) for r in r22s)), ([["notice"]] * 4, True)))
    lbpy = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "workers", "hs-ledger", "nenrin", "musubi-v0", "loss_bound_v1.py")
    if os.path.isfile(lbpy):
        import subprocess, tempfile
        real = os.path.join(os.path.dirname(lbpy), "run0003", "contract.json")
        same = []
        with tempfile.TemporaryDirectory() as td:
            pp = os.path.join(td, "policy.json")
            open(pp, "w").write(json.dumps(LBP[1]["stores"][0]["policy"]))
            for cf, cobj in ((os.path.join(td, "c.json"), LBC), (os.path.join(td, "c2.json"), LBC2), (real, None), (os.path.join(os.path.dirname(lbpy), "seki_demo_v2", "contract_unsigned.json"), None)):
                if cobj is not None:
                    open(cf, "w").write(json.dumps(cobj))
                co = cobj if cobj is not None else json.load(open(cf, encoding="utf-8"))
                for a in ("report", "audit", "compare", "ship"):
                    o = subprocess.run([sys.executable, "-I", "-B", lbpy, "--contract", cf, "--action", a, "--policy", pp], capture_output=True, text=True, timeout=120)
                    same.append(o.returncode == 0 and o.stdout.strip() == canonical(loss_bound(co, a, LBP[1]["stores"][0]["policy"])))
        cases.append(("22's loss_bound gives the bytes of musubi-v0/loss_bound_v1.py (two test contracts, run0003/contract.json and seki_demo_v2/contract_unsigned.json, four actions each)", (len(same), all(same)), (16, True)))

    # ---- 25 tasuki_chain (2026-11-08): each paid call of 17's window walked as one chain; a notice, never red for now ----
    S25 = "25_tasuki_chain"
    def lk(link, state, follows=None):
        return {"link": link, "state": state, "why": "", "digests": {}, "follows": follows}
    T_LINKS = ["adm->check", "check->day", "day->entry", "adm->entry", "adm->exec", "exec->result", "exec->entry", "exec->settle", "settle->recompute", "entry->ots", "day->witness"]
    def walked(**states):
        ls = [lk(k, states.get(k, "holds")) for k in T_LINKS]
        for l in ls:
            if l["link"] in ("check->day", "day->entry", "day->witness") and states.get("adm->check") == "missing":
                l.update(state="missing", follows="adm->check")
        v = "missing" if any(l["state"] == "missing" for l in ls) else ("not_yet" if any(l["state"] == "not_yet" for l in ls) else "holds")
        return {"verdict": v, "links": ls}
    WALKS = {hsh("c1"): walked(), hsh("c2"): walked(**{"adm->check": "missing"}), hsh("c3"): walked(**{"exec->settle": "not_yet", "settle->recompute": "not_yet"})}
    def fake_walk(x, g, at):
        if x == hsh("boom"):
            raise OSError("the ledger did not answer")
        assert at == anchor(now)
        return WALKS[x]
    PC = {"state": "red", "facts": {"calls": 3, "missing": [{"call": hsh("c2"), "lacks": ["furui_envelope"]}, {"call": hsh("c3"), "lacks": ["musubi_settlement"]}]}}
    x25 = check_tasuki(now, sorted(WALKS), PC, None, walk=fake_walk)
    cases.append(("25 notice: 2 of 3 chains have no link missing; missing counted by the cause only (adm->check 1, not the three links that follow it); 17 agrees on all 9 records",
                  (x25["state"], x25["facts"]["no_link_missing"], x25["facts"]["missing_by_link"], x25["facts"]["agrees_with_17"], [r["not_yet"] for r in x25["facts"]["rows"] if r["call"] == hsh("c3")]),
                  ("notice", 2, {"adm->check": 1}, {"compared": 9, "differ": []}, [["exec->settle", "settle->recompute"]])))
    x25d = check_tasuki(now, sorted(WALKS), {"state": "ok", "facts": {"calls": 3, "missing": []}}, None, walk=fake_walk)
    cases.append(("25: where 17 says complete and the walk finds adm->check missing and exec->settle not_yet, the two differ and both are named",
                  sorted((d["call"] == hsh("c2"), d["link"], d["state"]) for d in x25d["facts"]["agrees_with_17"]["differ"]), [(False, "exec->settle", "not_yet"), (True, "adm->check", "missing")]))
    x25u = check_tasuki(now, [hsh("c1"), hsh("boom")], {"state": "ok", "facts": {"calls": 2, "missing": []}}, None, walk=fake_walk)
    cases.append(("25: a walk that cannot finish is named in unwalked and is not counted as a chain (notice)", (x25u["state"], x25u["facts"]["walked"], len(x25u["facts"]["unwalked"]), x25u["facts"]["no_link_missing"]), ("notice", 1, 1, 1)))
    cases.append(("25 dormant with 0 calls (17 ok with 0 calls, or the door prices no store); a notice when 17 could not list its calls",
                  ((lambda x: (x["state"], x["facts"].get("dormant")))(check_tasuki(now, [], {"state": "ok", "facts": {"calls": 0}}, None, walk=fake_walk)),
                   (lambda x: (x["state"], x["facts"].get("dormant")))(check_tasuki(now, None, {"state": "ok", "facts": {"calls": 0}}, None, walk=fake_walk)),
                   check_tasuki(now, None, {"state": "not_yet", "facts": {}}, None, walk=fake_walk)["state"]), (("notice", True), ("notice", True), "notice")))
    try:
        T = tasuki_module()
    except Exception:
        T = None
    if T is not None:
        wt = check_tasuki(now, [R17], {"state": "ok", "facts": {"calls": 1, "missing": []}}, tasuki_get(world(cc=True, **{LEDGER + "/admission/" + R17: (404, {"error": "not_found"})})))
        cases.append(("25 with the repository's own walk over this file's get: an admission the ledger does not serve is missing at adm->check, adm->entry and adm->exec (the causes), the rest follow",
                      (wt["state"], wt["facts"]["missing_by_link"], wt["facts"]["walked"]), ("notice", {"adm->check": 1, "adm->entry": 1, "adm->exec": 1}, 1)))
    r25 = run(world(cc=True, **chain_world()), now)[0]
    cases.append(("25 in a run: a notice that names 17's paid call, and the verdict is the one the other checks give (25 is never red)",
                  ([x["state"] for x in r25["checks"] if x["id"] == S25], [x["facts"]["calls"] for x in r25["checks"] if x["id"] == S25], r25["verdict"], CALLS_KEY in json.dumps(r25)), (["notice"], [1], "green", False)))

    # ---- the day's facts (2026-11-10): red_zero_streak, anchored_ledger_days, pypi_wheel; GET only, never a check ----
    def fg(wd):
        def g(url, raw=False):
            v = wd.get(url, (404, None))
            if v == "down":
                raise Unreachable(url + ": http 503 after 3 tries")
            return v
        return g
    def pubr(d, red=0, earlier=(), bad_sha=False, verdict=None):
        r = {"schema": "tooshi-daily-v0", "checked_at": d + "T04:05:00Z", "trigger": "schedule", "verdict": verdict or ("red" if red else "not_all_checked"),
             "counts": {"ok": 5, "red": red, "notice": 0, "not_yet": 1}, "checks": []}
        t = json.dumps(r, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return (200, {"schema": "tooshi-day-v0", "day": d, "result_canonical": t, "result_sha256": "0" * 64 if bad_sha else hsh(t),
                      "earlier": [{"trigger": "schedule", "verdict": v} for v in earlier]})
    N20 = datetime.datetime(2026, 11, 20, 4, 5, tzinfo=datetime.timezone.utc)
    dd = lambda i: (N20 - datetime.timedelta(days=i)).strftime("%Y-%m-%d")
    G0 = {"ok": 18, "red": 0, "notice": 3, "not_yet": 2}
    SW = {DAY_URL % dd(i): pubr(dd(i)) for i in range(1, 6)}
    SW[DAY_URL % dd(6)] = pubr(dd(6), red=2)
    rz = red_zero_streak(fg(SW), N20, G0)
    cases.append(("facts red_zero_streak: today and the 5 days before have red 0, the 6th day before is red: 6 days since 11-15, ended by 11-14 red",
                  (rz["days"], rz["since"], rz["through"], rz["ended_by"], rz["read"], rz["unread"]), (6, "2026-11-15", "2026-11-20", {"day": "2026-11-14", "why": "red"}, 6, None)))
    rr = red_zero_streak(fg(SW), N20, dict(G0, red=1))
    cases.append(("facts red_zero_streak: a red today goes back to 0, and no day is read", (rr["days"], rr["ended_by"], rr["read"]), (0, {"day": "2026-11-20", "why": "red"}, 0)))
    re_ = red_zero_streak(fg(dict(SW, **{DAY_URL % dd(3): pubr(dd(3), earlier=("red",))})), N20, G0)
    cases.append(("facts red_zero_streak: a day whose kept run is not red but whose earlier run was red ends the streak (3 days)", (re_["days"], re_["ended_by"]), (3, {"day": "2026-11-17", "why": "an_earlier_run_red"})))
    rt = red_zero_streak(fg(dict(SW, **{DAY_URL % dd(0): pubr(dd(0), red=1)})), N20, G0)
    cases.append(("facts red_zero_streak: today's published run was red and this run is not: 0 (the second run of a red day)", (rt["days"], rt["ended_by"]), (0, {"day": "2026-11-20", "why": "an_earlier_run_red"})))
    rm = red_zero_streak(fg({k: v for k, v in SW.items() if k != DAY_URL % dd(3)}), N20, G0)
    cases.append(("facts red_zero_streak: a day not published ends the streak (3 days, ended by 11-17 missing)", (rm["days"], rm["since"], rm["ended_by"]), (3, "2026-11-18", {"day": "2026-11-17", "why": "missing"})))
    ru = red_zero_streak(fg(dict(SW, **{DAY_URL % dd(3): "down"})), N20, G0)
    cases.append(("facts red_zero_streak: a day that cannot be read (5xx three times): days null, at least 3, the day named",
                  (ru["days"], ru["at_least"], ru["unread"]["day"], ru["ended_by"]), (None, 3, "2026-11-17", None)))
    rb = red_zero_streak(fg(dict(SW, **{DAY_URL % dd(2): pubr(dd(2), bad_sha=True)})), N20, G0)
    cases.append(("facts red_zero_streak: a day whose result_canonical does not hash to its result_sha256 is not read (days null, at least 2)",
                  (rb["days"], rb["at_least"], rb["unread"]["why"]), (None, 2, "result_canonical does not hash to result_sha256")))
    N05 = datetime.datetime(2026, 11, 5, 4, 5, tzinfo=datetime.timezone.utc)
    rf = red_zero_streak(fg({DAY_URL % "2026-11-04": pubr("2026-11-04")}), N05, G0)
    cases.append(("facts red_zero_streak: the first published day reached: 2 days, ended by 11-03 before_first_day", (rf["days"], rf["ended_by"]), (2, {"day": "2026-11-03", "why": "before_first_day"})))
    cases.append(("facts red_zero_streak: the same files give the same streak (recounted twice)", red_zero_streak(fg(SW), N20, G0) == rz, True))

    def hdr(t, salt=0):
        return (b"\x00" * 4 + bytes([salt]) * 32 + b"\x11" * 32 + int(t).to_bytes(4, "little") + b"\x00" * 8).hex()
    def bhash(hx):
        return hashlib.sha256(hashlib.sha256(bytes.fromhex(hx)).digest()).digest()[::-1].hex()
    def night(d, blocks, entries):
        bl = {}
        for h, (ts, salt, st) in blocks.items():
            hx = hdr(ts, salt)
            bl[str(h)] = {"block_hash": bhash(hx), "header": hx, "state": st, "entries": [], "code": None, "merkle_root": "", "sources": None}
        en = [{"n": i + 1, "bitcoin_block": h, "state": st, "ots_status": "confirmed"} for i, (h, st) in enumerate(entries)]
        cn = {"entries": len(en)}
        ans = {"entries": en, "blocks": bl, "counts": cn, "verdict": "green"}
        return {"schema": "nenrin-ots-nightly-v1", "night": d, "entries": en, "blocks": bl, "counts": cn, "verdict": "green",
                "answers_sha256": hsh(json.dumps(ans, sort_keys=True, separators=(",", ":"), ensure_ascii=False))}
    T22, T24 = 1784721600, 1784721600 + 2 * 86400   # 2026-07-22T12:00Z and 2026-07-24T12:00Z
    NT = night("2026-11-19", {100: (T22, 1, "ok"), 101: (T22 + 3600, 2, "ok"), 102: (T24, 3, "ok"), 103: (T24 + 86400, 4, "ok"), 104: (T24 + 2 * 86400, 5, "pending")},
               [(100, "ok"), (101, "ok"), (102, "ok"), (103, "too_recent"), (104, "ok")])
    an = anchored_ledger_days(fg({OTS_NIGHT_URL % "2026-11-19": (200, NT)}), N20)
    cases.append(("facts anchored_ledger_days: blocks on 07-22 (two) and 07-24 with ok entries: 2 days, span 3, gap 1; a block whose entry is too_recent and a pending block are not counted",
                  (an["days"], an["first_day"], an["last_day"], an["span_days"], an["gap_days"], an["blocks"], an["night"], an["unread"]), (2, "2026-07-22", "2026-07-24", 3, 1, 3, "2026-11-19", None)))
    an2 = anchored_ledger_days(fg({OTS_NIGHT_URL % "2026-11-18": (200, dict(NT, night="2026-11-18"))}), N20)
    cases.append(("facts anchored_ledger_days: yesterday's night not kept: the night before is read and named", (an2["night"], an2["days"], an2["unread"]), ("2026-11-18", 2, None)))
    NT18 = night("2026-11-18", {100: (T22, 1, "ok")}, [(100, "ok")])
    an3 = anchored_ledger_days(fg({OTS_NIGHT_URL % "2026-11-18": (200, NT18)}), N20)
    cases.append(("facts anchored_ledger_days: the night before's own result: 1 day", (an3["night"], an3["days"], an3["gap_days"]), ("2026-11-18", 1, 0)))
    NTb = json.loads(json.dumps(NT))
    NTb["blocks"]["100"]["header"] = hdr(T22 - 86400, 1)
    NTb["answers_sha256"] = hsh(json.dumps({k: NTb[k] for k in ("entries", "blocks", "counts", "verdict")}, sort_keys=True, separators=(",", ":"), ensure_ascii=False))
    cases.append(("facts anchored_ledger_days: a header moved a day back no longer hashes to its block hash: unread, not counted",
                  (lambda x: (x["days"], "block 100" in str(x["unread"])))(anchored_ledger_days(fg({OTS_NIGHT_URL % "2026-11-19": (200, NTb)}), N20)), (None, True)))
    cases.append(("facts anchored_ledger_days: no night kept for the two days, or the night down: days null with unread",
                  tuple(anchored_ledger_days(fg(w_), N20)["days"] for w_ in ({}, {OTS_NIGHT_URL % "2026-11-19": "down"})), (None, None)))

    PV = PYPI_WATCH
    WHL = "nenrin_verify-0.11.0-py3-none-any.whl"
    WS = hsh("the wheel bytes")
    PJ = (200, {"urls": [{"packagetype": "sdist", "filename": "nenrin_verify-0.11.0.tar.gz", "digests": {"sha256": hsh("sdist")}},
                         {"packagetype": "bdist_wheel", "filename": WHL, "digests": {"sha256": WS}, "upload_time_iso_8601": "2026-11-10T01:00:00.000000Z", "yanked": False}]})
    def rel(tag, *assets):
        return {"tag_name": tag, "name": tag, "assets": list(assets)}
    def prov(dg, repo="ogasurfproject-jpg/horizon-shield"):
        stm = base64.b64encode(json.dumps({"_type": "https://in-toto.io/Statement/v1", "subject": [{"name": WHL, "digest": {"sha256": dg}}]}).encode()).decode()
        return (200, {"version": 1, "attestation_bundles": [{"publisher": {"kind": "GitHub", "repository": repo, "workflow": "pypi-publish-nenrin-verify.yml", "environment": "pypi"},
                                                             "attestations": [{"version": 1, "envelope": {"statement": stm, "signature": "AA=="}}]}]})
    PVU = PYPI_PROVENANCE % (PV[0], PV[1], WHL)
    pw = lambda **o: pypi_wheel(fg(dict({PYPI_URL % PV: PJ, RELEASES_URL: (200, []), PVU: prov(WS)}, **o)))
    x = pw(**{PYPI_URL % PV: (404, {"message": "Not Found"})})
    cases.append(("facts pypi_wheel: 0.11.0 not on PyPI yet: not_yet", (x["state"], x["wheels"]), ("not_yet", [])))
    x = pw(**{PYPI_URL % PV: (200, {"urls": [PJ[1]["urls"][0]]})})
    cases.append(("facts pypi_wheel: 0.11.0 on PyPI with an sdist only: not_yet", x["state"], "not_yet"))
    x = pw(**{RELEASES_URL: (200, [rel("nenrin-verify-v0.11.0", {"name": WHL, "digest": "sha256:" + WS})])})
    cases.append(("facts pypi_wheel: the release asset's digest is the sha256 PyPI serves, and the provenance names it too: match",
                  (x["state"], x["wheels"][0]["github"], x["wheels"][0]["github_same"], x["wheels"][0]["provenance_same"]),
                  ("match", {"release": "nenrin-verify-v0.11.0", "asset": WHL, "sha256": WS, "via": "asset_digest"}, True, True)))
    x = pw(**{RELEASES_URL: (200, [rel("nenrin-verify-v0.11.0", {"name": WHL, "digest": "sha256:" + hsh("other bytes")})])})
    cases.append(("facts pypi_wheel: the release asset's digest differs from PyPI's: differ, the wheel named", (x["state"], WHL in x["why"], x["wheels"][0]["github_same"]), ("differ", True, False)))
    x = pw()
    cases.append(("facts pypi_wheel: no release carries the wheel: no_release_wheel, with the provenance's publisher and the same sha256",
                  (x["state"], x["wheels"][0]["github"], x["wheels"][0]["provenance"]["publishers"][0]["repository"], x["wheels"][0]["provenance_same"], x["wheels"][0]["provenance"]["signature_checked"]),
                  ("no_release_wheel", None, "ogasurfproject-jpg/horizon-shield", True, False)))
    x = pw(**{PVU: prov(hsh("other bytes"))})
    cases.append(("facts pypi_wheel: no release, and the provenance names another sha256: differ", (x["state"], x["wheels"][0]["provenance_same"]), ("differ", False)))
    SUMS = "https://github.com/ogasurfproject-jpg/horizon-shield/releases/download/nenrin-verify-v0.11.0/SHA256SUMS"
    x = pw(**{RELEASES_URL: (200, [rel("nenrin-verify-v0.11.0", {"name": "SHA256SUMS", "browser_download_url": SUMS})]), SUMS: (200, "%s  %s\n%s  other.whl\n" % (WS, WHL, hsh("o")))})
    cases.append(("facts pypi_wheel: a SHA256SUMS asset of the version's release names the same sha256: match via sha256sums", (x["state"], x["wheels"][0]["github"]["via"]), ("match", "sha256sums")))
    x = pw(**{RELEASES_URL: (200, [rel("nenrin-verify-v0.11.0", {"name": WHL})])})
    cases.append(("facts pypi_wheel: the asset is there without a digest: no_release_wheel, and the asset is named", (x["state"], x["wheels"][0]["github"]["via"]), ("no_release_wheel", "asset_without_digest")))
    cases.append(("facts pypi_wheel: PyPI down, or the releases down: unread",
                  (pw(**{PYPI_URL % PV: "down"})["state"], pw(**{RELEASES_URL: "down"})["state"]), ("unread", "unread")))

    # in a run (the world of 11-05): the facts are in the result and in day_sha256, and change no state, no count and no verdict
    FW0 = {DAY_URL % "2026-11-04": pubr("2026-11-04")}
    FW = dict(FW0, **{OTS_NIGHT_URL % "2026-11-04": (200, dict(NT, night="2026-11-04")), PYPI_URL % PV: PJ,
                      RELEASES_URL: (200, [rel("nenrin-verify-v0.11.0", {"name": WHL, "digest": "sha256:" + hsh("x")})]), PVU: prov(WS)})
    def wf2(**over):
        g0 = world(cc=True)
        def g(url, raw=False):
            if url in over:
                v = over[url]
                if v == "down":
                    raise Unreachable(url)
                return v
            return g0(url)
        return g
    ra, _, _ = run(wf2(**FW0), now)
    rb_, _, _ = run(wf2(**FW), now)
    cases.append(("facts in a run: the same states, counts and verdict with and without the facts' files; red_zero_streak 2 (11-05 and 11-04), anchored days 2, pypi differ",
                  ({x["id"]: x["state"] for x in ra["checks"]} == {x["id"]: x["state"] for x in rb_["checks"]}, ra["counts"] == rb_["counts"], ra["verdict"], rb_["verdict"],
                   rb_["facts"]["red_zero_streak"]["days"], rb_["facts"]["anchored_ledger_days"]["days"], rb_["facts"]["pypi_wheel"]["state"], sum(rb_["counts"].values()) == len(rb_["checks"])),
                  (True, True, "green", "green", 2, 2, "differ", True)))
    cases.append(("facts in a run: inside the day view, so day_sha256 moves with them; the checks 9 and 14 are as before",
                  (day_sha256(ra) != day_sha256(rb_), "facts" in day_view(rb_), [x for x in ra["checks"] if x["id"] in ("9_witness_answer", "14_not_yet_deadline")] == [x for x in rb_["checks"] if x["id"] in ("9_witness_answer", "14_not_yet_deadline")]),
                  (True, True, True)))
    rr_ = run(wf2(**dict(FW, **{RUNNER + "/health": (200, {"key_id": "runner-1", "public_key_ed25519_b64": "B" * 43 + "=", "rules_sha256": None, "caps": dict(CAPS), "anthropic_key_set": True})})), now)[0]
    cases.append(("facts in a run: a red day has red_zero_streak 0 (ended by today, red)", (rr_["verdict"], rr_["facts"]["red_zero_streak"]["days"], rr_["facts"]["red_zero_streak"]["ended_by"]), ("red", 0, {"day": "2026-11-05", "why": "red"})))
    xf = run(wf2(**{RELEASES_URL: (200, "not a list"), PYPI_URL % PV: PJ}), now)[0]
    cases.append(("facts in a run: a fact that cannot be made is written as such and the run goes on", (xf["facts"]["pypi_wheel"]["state"], xf["facts"]["anchored_ledger_days"]["days"], xf["verdict"]), ("unread", None, "green")))

    # cv2: a call the door made again the same day becomes a notice that names the first failure (with_redo)
    RD = {"n": 2, "first_at": "2026-11-05T03:47:20.000Z", "first_error": "canary_call_failed: runner did not answer"}
    def rg(fu):
        return lambda url, raw=False: (200, {"furui": fu}) if url == DOOR_POLICY else (404, None)
    def base():
        return [c("2_admission_ledger", "ok", "the ledger serves"), c("8_canary_scene", "ok", "stopped"), c("1_sieve_admission", "ok", "bound")]
    r1 = {x["id"]: x for x in with_redo(rg({"check_call": {"day": "2026-11-05", "redo": RD}, "canary_call": {"day": "2026-11-05"}}), now, base())}
    cases.append(("redo: today's check call made again: 2 is a notice naming the first error and first_at, facts.redo; 8 and 1 stay ok",
                  r1["2_admission_ledger"]["state"] == "notice" and "canary_call_failed" in r1["2_admission_ledger"]["why"] and "2026-11-05T03:47:20" in r1["2_admission_ledger"]["why"]
                  and r1["2_admission_ledger"]["facts"]["redo"]["n"] == 2 and r1["8_canary_scene"]["state"] == "ok" and r1["1_sieve_admission"]["state"] == "ok", True))
    r2 = {x["id"]: x for x in with_redo(rg({"canary_call": {"day": "2026-11-05", "redo": RD}}), now, base())}
    cases.append(("redo: today's canary call made again: 8 is a notice, 2 stays ok", r2["8_canary_scene"]["state"] == "notice" and r2["2_admission_ledger"]["state"] == "ok", True))
    r3 = {x["id"]: x for x in with_redo(rg({"check_call": {"day": "2026-11-04", "redo": RD}}), now, base())}
    cases.append(("redo: a redo of another day changes nothing", all(x["state"] == "ok" and "redo" not in x["facts"] for x in r3.values()), True))
    rr_ = base(); rr_[0] = c("2_admission_ledger", "red", "today's check call failed")
    r4 = {x["id"]: x for x in with_redo(rg({"check_call": {"day": "2026-11-05", "redo": RD}}), now, rr_)}
    cases.append(("redo: a red check stays red and gains facts.redo", r4["2_admission_ledger"]["state"] == "red" and r4["2_admission_ledger"]["facts"]["redo"]["first_error"] == RD["first_error"], True))
    def down(url, raw=False):
        raise Unreachable("down")
    r5 = with_redo(down, now, base())
    cases.append(("redo: the door not answering here changes nothing", [x["state"] for x in r5] == ["ok", "ok", "ok"], True))
    r6 = {x["id"]: x for x in with_redo(rg({"check_call": {"day": "2026-11-05", "redo": "yes"}}), now, base())}
    cases.append(("redo: a redo that is not an object is not read", r6["2_admission_ledger"]["state"] == "ok", True))

    bad = [n for n, got, want in cases if got != want]
    for n, got, want in cases:
        print(("  ok   " if got == want else "  NG   ") + n + ("" if got == want else " (got %r, want %r)" % (got, want)))
    print("tooshi selftest %d / %d %s" % (len(cases) - len(bad), len(cases), "all green" if not bad else "NG"))
    return 1 if bad else 0


# a fixed envelope (no signature that verifies); its leaf hash was computed with the runner's canonical_v0.mjs in node
VEC_ENVELOPE = '{"check":{"action_binding_digest":"3333333333333333333333333333333333333333333333333333333333333333","answered":true,"checked_at_height":100,"contract_sha256":"4444444444444444444444444444444444444444444444444444444444444444","decision":"pass","input_commit":"1111111111111111111111111111111111111111111111111111111111111111","marks":[],"nonce":"heartbeat-2026-11-03","rules_sha256":null,"schema":"furui-check-v1","scope_sha256":"2222222222222222222222222222222222222222222222222222222222222222","signed_at":"2026-11-03T03:17:09.123Z","stage_reached":4,"trace_sha256":"5555555555555555555555555555555555555555555555555555555555555555","unread":false},"schema":"furui-check-signed-v1","signatures":[{"alg":"ed25519","domain":"horizonshield.dev","key_id":"runner-1","sig":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="}],"signer":{"domain":"horizonshield.dev","key_url":"https://ledger.horizonshield.dev/.well-known/furui-check-keys.json"}}'


def witness_refusal(now, name):
    if not name or not name.strip():
        return "no_name"
    if (now.hour, now.minute) < DAY_READY:
        return "too_early"
    return None


def with_cross(get, path):
    """the getter of a run: CROSS_SOURCE is the file of --cross (tools/tooshi/cross_client/cross_client.mjs), read once; 404 without it"""
    x = None
    if path:
        try:
            with open(path, encoding="utf-8") as f:
                x = json.load(f)
        except (OSError, ValueError):
            x = "unreadable"
    def g(url, raw=False):
        if url == CROSS_SOURCE:
            return (200, x) if isinstance(x, dict) else ((422, None) if x == "unreadable" else (404, None))
        return get(url, raw=raw) if raw else get(url)
    return g


def tasuki_fetcher():
    """25 reads with the walk's own GET (bytes, so an OpenTimestamps proof reads too); None when the walk cannot be loaded"""
    try:
        return tasuki_module().Fetcher()
    except Exception:
        return None


def witness_main(now, name, vantage, ledger, dry, cross=None):
    why = witness_refusal(now, name)
    if why == "no_name":
        print("witness: give a name (anonymous is allowed)")
        return 2
    if why == "too_early":
        print("witness: the day's checks are not all in before 03:47 UTC (01:05 batch, 03:17 heartbeat, 03:47 door call); run after it")
        return 2
    res, text, sha = run(with_cross(http_get, cross), now, "witness", walk_get=tasuki_fetcher())
    for x in res["checks"]:
        print("%-8s %s: %s" % (x["state"], x["id"], x["why"]))
    rc = witness_record(res, name.strip(), vantage, now, tool_sha256())
    print("TOOSHI witness %s %s ok %d red %d notice %d not_yet %d day_sha256 %s (published day: %s)" % (res["checked_at"][:10], res["verdict"], res["counts"]["ok"], res["counts"]["red"], res["counts"]["notice"], res["counts"]["not_yet"], day_sha256(res), DAY_URL % res["checked_at"][:10]))
    if dry:
        print("record_canonical " + rc)
        print("dry run: nothing sent")
        return 0
    try:
        s, a = http_post(ledger.rstrip("/") + "/witness", {"record_canonical": rc})
    except (urllib.error.URLError, OSError, ValueError) as e:
        print("witness: the ledger did not answer: %s" % type(e).__name__)
        return 2
    a = a if isinstance(a, dict) else {}
    if s in (200, 201) and isinstance(a.get("sha"), str):
        print("WITNESS_FILED http %d sha %s status %s counted %s url %s" % (s, a["sha"], a.get("status"), a.get("counted"), a.get("url")))
        return 0
    print("WITNESS_REFUSED http %s %s %s" % (s, a.get("error"), a.get("why") or a.get("note") or ""))
    return 3


def main(argv):
    if argv == ["--selftest"]:
        return selftest()
    now, out, bodyf, notesf, trigger, fixed = datetime.datetime.now(datetime.timezone.utc), None, None, None, "manual", False
    wname, vantage, ledger, dry, cross = None, "unspecified", LEDGER, False, None
    usage = "usage: tooshi_daily.py [--now T] [--trigger %s] [--out file] [--body file] [--notes file] [--cross file] | --witness NAME [--vantage V] [--dry-run] [--ledger URL] [--cross file] | --selftest" % "|".join(TRIGGERS[:4])
    it = iter(argv)
    try:
        for a in it:
            if a == "--now":
                now, fixed = datetime.datetime.strptime(next(it), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc), True
            elif a == "--out":
                out = next(it)
            elif a == "--body":
                bodyf = next(it)
            elif a == "--notes":
                notesf = next(it)
            elif a == "--cross":
                cross = next(it)
            elif a == "--trigger":
                trigger = next(it)
                if trigger not in TRIGGERS[:4]:
                    print(usage)
                    return 2
            elif a == "--witness":
                wname = next(it)
            elif a == "--vantage":
                vantage = next(it)
            elif a == "--ledger":
                ledger = next(it)
            elif a == "--dry-run":
                dry = True
            else:
                print(usage)
                return 2
    except StopIteration:
        print(usage)
        return 2
    if wname is not None:
        if fixed or out or bodyf or notesf or trigger != "manual":
            print("witness: --now, --out, --body, --notes and --trigger do not go with --witness (the answers are read now, by you)")
            return 2
        return witness_main(now, wname, vantage, ledger, dry, cross)
    res, text, sha = run(with_cross(http_get, cross), now, trigger, walk_get=tasuki_fetcher())
    if out:
        open(out, "w", encoding="utf-8").write(text + "\n")
    if bodyf:
        open(bodyf, "w", encoding="utf-8").write(body(res, sha))
    for x in res["checks"]:
        print("%-8s %s: %s" % (x["state"], x["id"], x["why"]))
    if notesf:
        nt = notes(http_get, now)
        open(notesf, "w", encoding="utf-8").write(json.dumps(nt, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n")
        for x in nt["items"]:
            print("note     %s %s %s: %s (outside day_sha256)" % (x["about"], x["day"], x["state"], x["why"]))
    print(facts_line(res))
    print("TOOSHI %s %s ok %d red %d notice %d not_yet %d result_sha256 %s day_sha256 %s trigger %s" % (res["checked_at"], res["verdict"], res["counts"]["ok"], res["counts"]["red"], res["counts"]["notice"], res["counts"]["not_yet"], sha, day_sha256(res), trigger))
    return 1 if res["verdict"] == "red" else 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except Exception as e:
        print("tooshi_daily failed: %s: %s" % (type(e).__name__, e))
        sys.exit(2)
