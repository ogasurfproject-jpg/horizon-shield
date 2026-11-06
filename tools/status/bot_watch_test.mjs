#!/usr/bin/env node
// Offline tests for bot_watch.mjs: canned GitHub API answers and cron strings, no network.
//   node tools/status/bot_watch_test.mjs
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseField, parseCron, fireTimes, expectedIntervalMs, scheduledCrons, writerOf, judge, watch, renderBots, problems, span,
  WORKER_JOBS, DISPATCHED_FILES, dayAlerts, readWorkerLogs, fileIssues, issueTitle, issueText, SELF_FILE } from "./bot_watch.mjs";
import { JOBS as WORKER_CORE_JOBS } from "../../workers/hs-cron-dispatch/src/core.mjs";

// no network in this test
globalThis.fetch = () => { throw new Error("the network is not used in this test"); };

let failed = 0, passed = 0;
function chk(name, cond, detail) {
  if (cond) { passed++; console.log("ok   " + name); }
  else { failed++; console.log("FAIL " + name + (detail !== undefined ? "  :: " + JSON.stringify(detail).slice(0, 300) : "")); }
}
const H = 3600000, D = 86400000;
const NOW = Date.parse("2026-10-09T12:00:00Z");
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

// ---- cron fields and intervals --------------------------------------------------------------------------------
chk("field: list, range, step, star step", JSON.stringify(parseField("1,5-7", 0, 59)) === "[1,5,6,7]" && JSON.stringify(parseField("*/6", 0, 23)) === "[0,6,12,18]" && JSON.stringify(parseField("10-20/5", 0, 59)) === "[10,15,20]");
chk("field: 7 means Sunday in day of week, also inside a range", JSON.stringify(parseCron("0 0 * * 7").dows) === "[0]" && JSON.stringify(parseCron("0 0 * * 5-7").dows) === "[0,5,6]");
let threw = false; try { parseCron("0 0 * *"); } catch { threw = true; }
chk("cron: four fields is an error", threw);
threw = false; try { parseCron("61 * * * *"); } catch { threw = true; }
chk("cron: minute 61 is an error", threw);
threw = false; try { parseCron("0 0 * * MON"); } catch { threw = true; }
chk("cron: names are refused, not guessed", threw);
const iv = (c) => expectedIntervalMs([].concat(c), NOW);
chk("interval: hourly 23 * * * * is 1 h", iv("23 * * * *") === H);
chk("interval: daily 0 0 * * * is 1 d", iv("0 0 * * *") === D);
chk("interval: every 6 h 23 */6 * * *", iv("23 */6 * * *") === 6 * H);
chk("interval: weekly Sunday 23 21 * * 0 is 7 d", iv("23 21 * * 0") === 7 * D);
chk("interval: monthly 23 3 1 * * is the longest month, 31 d", iv("23 3 1 * *") === 31 * D);
chk("interval: quarterly 41 2 1 2,5,8,11 * is 92 d (Aug to Nov, Nov to Feb)", iv("41 2 1 2,5,8,11 *") === 92 * D);
chk("interval: weekdays 0 9 * * 1-5 is 3 d (Friday to Monday)", iv("0 9 * * 1-5") === 3 * D);
chk("interval: two cron lines are merged (00:00 and 12:00 is 12 h)", iv(["0 0 * * *", "0 12 * * *"]) === 12 * H);
{
  // day of month and day of week both restricted: fires when either matches (standard cron)
  const t = fireTimes([parseCron("0 0 13 * 5")], Date.parse("2026-11-01T00:00:00Z"), Date.parse("2026-11-30T23:59:00Z"));
  const days = t.map((x) => new Date(x).getUTCDate());
  chk("fire times: 13th or a Friday in November 2026", JSON.stringify(days) === "[6,13,20,27]", days);
}

// ---- reading workflow text ------------------------------------------------------------------------------------
const WF_BLOG = `name: Auto Blog Post
on:
  workflow_dispatch:
  schedule:
    - cron: '0 0 * * *'
jobs:
  post:
    steps:
      - run: |
          git config user.name "KIRA Bot"
          git add blog/
`;
const WF_VARS = `on:
  schedule:
    - cron: "23 * * * *"   # hourly at :23
#    - cron: "0 0 * * *"   commented out, must not count
env:
  SV: workers/x/survive-v0
jobs:
  a:
    steps:
      - run: |
          git config user.name  "hs-mirror"
          D=workers/x/pending-v0
          git add "$D/snapshots" "$D/log.jsonl" 2>/dev/null || true
          git add "\${SV}/kept"
          git add "$UNKNOWN/thing" -A .
`;
chk("crons: quoted with single or double quotes, comments ignored", JSON.stringify(scheduledCrons(WF_BLOG)) === '["0 0 * * *"]' && JSON.stringify(scheduledCrons(WF_VARS)) === '["23 * * * *"]');
chk("crons: no schedule block means not scheduled", scheduledCrons("on:\n  push:\n").length === 0);
{
  const w = writerOf(WF_BLOG), v = writerOf(WF_VARS);
  chk("writer: KIRA Bot writes blog", w.bot === "KIRA Bot" && JSON.stringify(w.paths) === '["blog"]', w);
  chk("writer: plain variables substituted, unknown variables, flags, redirects and . skipped", v.bot === "hs-mirror" &&
    JSON.stringify(v.paths.sort()) === '["workers/x/pending-v0/log.jsonl","workers/x/pending-v0/snapshots","workers/x/survive-v0/kept"]', v);
  chk("writer: nothing to infer gives no bot", writerOf("jobs: {}\n").bot === null);
}

// ---- judging runs -----------------------------------------------------------------------------------------------
const run = (msAgo, conclusion, event = "schedule", status = "completed") =>
  ({ created_at: iso(msAgo), run_started_at: iso(msAgo), status, conclusion: status === "completed" ? conclusion : null, event, html_url: "u" });
const active = { state: "active", created_at: "2026-01-01T00:00:00Z" };
{
  const j = judge({ workflow: active, allRuns: [run(12 * H, "success")], schedRuns: [run(12 * H, "success")], intervalMs: D, nowMs: NOW });
  chk("judge: daily job that succeeded 12 h ago is ok", j.flags.length === 0 && j.consecutive_failures === 0, j);
}
{
  // the blog case: still runs daily, but the last success is 19 days old
  const sched = [1, 2, 3].map((d) => run(d * D, "failure")).concat([run(19 * D, "success")]);
  const j = judge({ workflow: active, allRuns: sched, schedRuns: sched, intervalMs: D, nowMs: NOW });
  chk("judge: failing for days is FAILING and OVERDUE, 3 in a row", j.flags.includes("FAILING") && j.flags.includes("OVERDUE") && j.consecutive_failures === 3, j);
}
{
  const sched = [run(1 * D, "failure"), run(2 * D, "success")];
  const j = judge({ workflow: active, allRuns: sched, schedRuns: sched, intervalMs: D, nowMs: NOW });
  chk("judge: one failure is not FAILING, and 2 d is not past 2 d + 3 h", j.flags.length === 0 && j.consecutive_failures === 1, j);
}
{
  const sched = [run(H, "cancelled"), run(2 * H, "failure"), run(3 * H, "skipped"), run(4 * H, "timed_out"), run(5 * H, "success")];
  const j = judge({ workflow: active, allRuns: sched, schedRuns: sched, intervalMs: H, nowMs: NOW });
  chk("judge: cancelled and skipped are not counted; failure + timed_out is FAILING", j.flags.includes("FAILING") && j.consecutive_failures === 2 && !j.flags.includes("OVERDUE"), j);
}
{
  // the law-watch case: weekly, the last scheduled run never happened; a manual success does not hide it
  const sched = [run(17 * D, "success")];
  const all = [run(2 * H, "success", "workflow_dispatch"), ...sched];
  const j = judge({ workflow: active, allRuns: all, schedRuns: sched, intervalMs: 7 * D, nowMs: NOW });
  chk("judge: weekly job with last scheduled success 17 d ago is OVERDUE even after a manual success", j.flags.join() === "OVERDUE" && j.last_success_any_event === iso(2 * H) && j.last_run.event === "workflow_dispatch", j);
}
{
  const j = judge({ workflow: { state: "active", created_at: iso(5 * H) }, allRuns: [], schedRuns: [], intervalMs: D, nowMs: NOW });
  chk("judge: a workflow added 5 h ago with no runs yet is not OVERDUE", j.flags.length === 0, j);
  const k = judge({ workflow: { state: "active", created_at: iso(3 * D) }, allRuns: [], schedRuns: [], intervalMs: D, nowMs: NOW });
  chk("judge: never ran in 3 d on a daily schedule is OVERDUE", k.flags.join() === "OVERDUE", k);
}
{
  // the jidec-stamp case (bot-watch #4, 2026-10-11): hourly, GitHub ran it 5.8 h ago; that is GitHub's lateness, not a stop
  const j = judge({ workflow: active, allRuns: [run(5.8 * H, "success")], schedRuns: [run(5.8 * H, "success")], intervalMs: H, nowMs: NOW });
  chk("judge: hourly job last run 5.8 h ago is ok (never OVERDUE before 12 h)", j.flags.length === 0 && j.overdue_after_ms === 12 * H, j);
  const k = judge({ workflow: active, allRuns: [run(13 * H, "success")], schedRuns: [run(13 * H, "success")], intervalMs: H, nowMs: NOW });
  chk("judge: hourly job with no success for 13 h is OVERDUE", k.flags.join() === "OVERDUE", k);
  const w = judge({ workflow: active, allRuns: [], schedRuns: [run(8 * D, "success")], intervalMs: 7 * D, nowMs: NOW });
  chk("judge: the 12 h floor does not change a weekly limit (14 d + 3 h)", w.overdue_after_ms === 14 * D + 3 * H && w.flags.length === 0, w);
}
{
  const j = judge({ workflow: { state: "disabled_manually", created_at: "2026-01-01T00:00:00Z" }, allRuns: [], schedRuns: [run(40 * D, "failure"), run(41 * D, "failure")], intervalMs: D, nowMs: NOW });
  chk("judge: disabled is DISABLED only", j.flags.join() === "DISABLED", j);
}
{
  const sched = [run(10 * 60000, "", "schedule", "in_progress"), run(H, "success")];
  const j = judge({ workflow: active, allRuns: sched, schedRuns: sched, intervalMs: H, nowMs: NOW });
  chk("judge: a run in progress is the last run but not a result", j.flags.length === 0 && j.last_run.status === "in_progress", j);
}

// ---- whole watch with a canned API ----------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), "bot-watch-"));
  writeFileSync(join(dir, "blog-post.yml"), WF_BLOG);
  writeFileSync(join(dir, "mirror.yml"), WF_VARS);
  writeFileSync(join(dir, "push-only.yml"), "on:\n  push:\n");
  writeFileSync(join(dir, "broken.yaml"), "on:\n  schedule:\n    - cron: \"0 0 * * MON\"\n");
  const calls = [];
  const canned = {
    "/repos/o/r/actions/workflows/blog-post.yml": active,
    "/repos/o/r/actions/workflows/blog-post.yml/runs?per_page=20": { workflow_runs: [run(12 * H, "failure"), run(36 * H, "failure"), run(20 * D, "success")] },
    "/repos/o/r/actions/workflows/blog-post.yml/runs?per_page=20&event=schedule": { workflow_runs: [run(12 * H, "failure"), run(36 * H, "failure"), run(20 * D, "success")] },
    "/repos/o/r/commits?per_page=30&path=blog": [
      { commit: { author: { name: "Horizon", date: iso(2 * D) }, committer: { name: "Horizon", date: iso(2 * D) } } },
      { commit: { author: { name: "KIRA Bot", date: iso(19 * D) }, committer: { name: "KIRA Bot", date: iso(19 * D) } } }
    ],
    "/repos/o/r/actions/workflows/mirror.yml/runs?per_page=20": { workflow_runs: [run(H, "success")] },
    "/repos/o/r/actions/workflows/mirror.yml/runs?per_page=20&event=schedule": { workflow_runs: [run(H, "success")] }
    // mirror.yml workflow object missing: the API answers 404 for it
  };
  const api = async (p) => { calls.push(p); if (!(p in canned)) throw new Error("GitHub API 404 for " + p.split("?")[0]); return canned[p]; };
  const rows = await watch({ dir, repo: "o/r", api, nowMs: NOW });
  const by = Object.fromEntries(rows.map((r) => [r.file, r]));
  chk("watch: only scheduled workflows are listed", rows.length === 3 && !by["push-only.yml"], rows.map((r) => r.file));
  chk("watch: blog is FAILING and OVERDUE, last bot commit 19 d ago, quiet", by["blog-post.yml"].flags.join() === "FAILING,OVERDUE" &&
    by["blog-post.yml"].bot_commit.at === iso(19 * D) && by["blog-post.yml"].bot_commit.quiet === true, by["blog-post.yml"]);
  chk("watch: an API error is UNKNOWN, not ok", by["mirror.yml"].flags.join() === "UNKNOWN" && /404/.test(by["mirror.yml"].error), by["mirror.yml"]);
  chk("watch: a cron it cannot read is UNKNOWN", by["broken.yaml"].flags.join() === "UNKNOWN", by["broken.yaml"]);
  chk("watch: problems are the three non disabled flags", problems(rows).length === 3);
  const md = renderBots(rows, NOW);
  chk("render: table row per workflow, red summary line", md.includes("| `blog-post.yml` |") && md.includes("need attention") && md.includes("FAILING, OVERDUE"));
  chk("render: no dash characters", !/[\u2012-\u2015\u2212\uFF0D]/.test(md));
  const okRows = [{ file: "a.yml", crons: ["0 0 * * *"], interval_ms: D, flags: [], last_run: null, consecutive_failures: 0 }];
  chk("render: all good says so", renderBots(okRows, NOW).includes("none needs attention"));
}
// ---- the workflows workers/hs-cron-dispatch starts (2026-11-05) -----------------------------------------------
chk("WORKER_JOBS equals JOBS of workers/hs-cron-dispatch/src/core.mjs (id and workflow)",
  JSON.stringify(Object.entries(WORKER_JOBS).sort()) === JSON.stringify(WORKER_CORE_JOBS.map((j) => [j.id, j.file]).sort()), WORKER_JOBS);
chk("bot-watch.yml is one of them (06:17 UTC)", DISPATCHED_FILES.has("bot-watch.yml") && WORKER_CORE_JOBS.find((j) => j.id === "bot-watch").hour === 6);
const runI = (id, at, conclusion, event, status = "completed") => ({ id, created_at: at, run_started_at: at, status, conclusion: status === "completed" ? conclusion : null, event, html_url: "u" + id });
{
  const dir = mkdtempSync(join(tmpdir(), "bot-watch-d-"));
  writeFileSync(join(dir, "tooshi-daily.yml"), "on:\n  schedule:\n    - cron: \"5 4 * * *\"\n  workflow_dispatch: {}\n");
  writeFileSync(join(dir, "law.yml"), "on:\n  schedule:\n    - cron: \"0 0 * * 0\"\n  workflow_dispatch: {}\n");
  const canned = {
    "/repos/o/r/actions/workflows/tooshi-daily.yml": active,
    "/repos/o/r/actions/workflows/tooshi-daily.yml/runs?per_page=20": { workflow_runs: [] },
    "/repos/o/r/actions/workflows/tooshi-daily.yml/runs?per_page=20&event=schedule": { workflow_runs: [run(3 * D, "success")] },
    "/repos/o/r/actions/workflows/tooshi-daily.yml/runs?per_page=100&event=workflow_dispatch": { workflow_runs: [run(2 * H, "failure", "workflow_dispatch"), run(26 * H, "failure", "workflow_dispatch"), run(2 * D, "success", "workflow_dispatch")] },
    "/repos/o/r/actions/workflows/law.yml": active,
    "/repos/o/r/actions/workflows/law.yml/runs?per_page=20": { workflow_runs: [run(H, "success", "workflow_dispatch")] },
    "/repos/o/r/actions/workflows/law.yml/runs?per_page=20&event=schedule": { workflow_runs: [run(17 * D, "success")] }
  };
  const calls = [];
  const api = async (p) => { calls.push(p); if (!(p in canned)) throw new Error("GitHub API 404 for " + p); return canned[p]; };
  const rows = await watch({ dir, repo: "o/r", api, nowMs: NOW });
  const by = Object.fromEntries(rows.map((r) => [r.file, r]));
  chk("watch: a Worker workflow counts its dispatch runs: 2 dispatch failures in a row is FAILING, the dispatch success 2 d ago keeps it from OVERDUE",
    by["tooshi-daily.yml"].flags.join() === "FAILING" && by["tooshi-daily.yml"].consecutive_failures === 2 && by["tooshi-daily.yml"].last_scheduled_success === iso(2 * D), by["tooshi-daily.yml"]);
  chk("watch: a workflow the Worker does not start reads no dispatch runs, and a run by hand still does not hide OVERDUE",
    by["law.yml"].flags.join() === "OVERDUE" && !calls.some((c) => c.startsWith("/repos/o/r/actions/workflows/law.yml/runs?per_page=100")), by["law.yml"]);
  chk("watch: the Worker workflow keeps its runs for the day alerts", by["tooshi-daily.yml"].runs.workflow_dispatch.length === 3 && !by["law.yml"].runs);
  const md = renderBots(rows, NOW, undefined, { days: ["2026-10-08", "2026-10-09"], errors: [], alerts: [] });
  chk("render: counted success says schedule or Worker dispatch, and the day section is there", md.includes("(schedule or Worker dispatch)") && md.includes("## Days with no successful run") && md.includes("None."));
}
{
  // day alerts. NOW is 2026-10-09T12:00Z; days judged 10-08 and 10-09
  const days = ["2026-10-08", "2026-10-09"];
  const row = (file, sched, disp) => ({ file, runs: { schedule: sched, workflow_dispatch: disp } });
  const A = (rows, logs) => dayAlerts({ rows, logs, days, nowMs: NOW });
  const both = A([row("survive-drill.yml", [runI(2, "2026-10-08T09:10:00Z", "failure", "schedule")], [runI(1, "2026-10-08T03:17:05Z", "failure", "workflow_dispatch")])], {});
  chk("both: the dispatch run and the late scheduled run of 10-08 failed: one alert, reason both, both runs named",
    both.length === 1 && both[0].day === "2026-10-08" && both[0].reasons.join() === "both" && both[0].evidence.join() === "run:1,run:2", both);
  const rescued = A([row("survive-drill.yml", [runI(2, "2026-10-08T09:10:00Z", "success", "schedule")], [runI(1, "2026-10-08T03:17:05Z", "failure", "workflow_dispatch")])], {});
  chk("the dispatch run failed but the scheduled run succeeded: no alert", rescued.length === 0, rescued);
  const handOk = A([row("survive-drill.yml", [runI(2, "2026-10-08T09:10:00Z", "failure", "schedule")], [runI(3, "2026-10-08T10:00:00Z", "success", "workflow_dispatch"), runI(1, "2026-10-08T03:17:05Z", "failure", "workflow_dispatch")])], {});
  chk("a later run by hand succeeded: no alert", handOk.length === 0, handOk);
  const onlyDisp = A([row("survive-drill.yml", [], [runI(1, "2026-10-09T03:17:05Z", "failure", "workflow_dispatch")])], {});
  chk("today the dispatch run failed and the schedule has not come: no alert yet", onlyDisp.length === 0, onlyDisp);
  const wlog = (entries) => ({ "2026-10-09": { day: "2026-10-09", entries } });
  const wf = (job, slot, extra = {}) => ({ at: slot, slot, job, result: "failed", http: 500, why: "no answer", ...extra });
  const w1 = A([row("issuer-keys.yml", [], [])], wlog([{ job: "issuer-keys", slot: "2026-10-09T03:23Z", result: "claimed" }, wf("issuer-keys", "2026-10-09T03:23Z"), wf("issuer-keys", "2026-10-09T03:23Z", { retry: 2, why: "final" })]));
  chk("worker: the last dispatch of issuer-keys failed (final) and no run that day: one alert, reason worker",
    w1.length === 1 && w1[0].day === "2026-10-09" && w1[0].reasons.join() === "worker" && w1[0].evidence.join() === "worker:issuer-keys@2026-10-09T03:23Z#2", w1);
  const w2 = A([row("issuer-keys.yml", [runI(5, "2026-10-09T10:00:00Z", "success", "schedule")], [])], wlog([wf("issuer-keys", "2026-10-09T03:23Z", { retry: 2 })]));
  chk("worker failed but the late scheduled run succeeded that day: no alert", w2.length === 0, w2);
  const w3 = A([row("jidec-stamp.yml", [], [])], wlog([wf("jidec-stamp", "2026-10-09T11:17Z", { retry_next: "2026-10-09T11:32:00.000Z" })]));
  chk("worker: a failed slot whose retry is still waiting (due 11:32, now 12:00, within 30 min): no alert", w3.length === 0, w3);
  const w4 = A([row("jidec-stamp.yml", [], [])], wlog([wf("jidec-stamp", "2026-10-09T10:17Z", { retry_next: "2026-10-09T10:22:00.000Z" })]));
  chk("worker: a retry that never came (due 10:22, more than 30 min ago): alert", w4.length === 1 && w4[0].reasons.join() === "worker", w4);
  const w5 = A([row("jidec-stamp.yml", [], [])], wlog([wf("jidec-stamp", "2026-10-09T10:17Z"), { job: "jidec-stamp", slot: "2026-10-09T11:17Z", result: "dispatched", http: 204 }]));
  chk("worker: a later slot of the job was dispatched: no alert", w5.length === 0, w5);
  const w6 = A([row("tooshi-daily.yml", [], [])], wlog([{ job: "tooshi-daily", slot: "2026-10-09T04:05Z", result: "dispatched" }, wf("tooshi-daily-second", "2026-10-09T04:35Z", { http: 422, why: "GitHub refused the dispatch (not retried)" })]));
  chk("worker: tooshi-daily-second failed with 422, no run that day: alert for tooshi-daily.yml naming the second job", w6.length === 1 && w6[0].file === "tooshi-daily.yml" && w6[0].evidence.join() === "worker:tooshi-daily-second@2026-10-09T04:35Z#0", w6);
  const w7 = A([row("issuer-keys.yml", [], [])], { "2026-10-09": null });
  chk("the Worker log not read: only the runs are judged (no alert from the log)", w7.length === 0);
  const w8 = A([row("issuer-keys.yml", [runI(2, "2026-10-09T09:10:00Z", "failure", "schedule")], [runI(1, "2026-10-09T03:23:05Z", "failure", "workflow_dispatch")])], wlog([wf("issuer-keys", "2026-10-09T03:23Z", { retry: 2 })]));
  chk("both and worker on the same day: one alert with both reasons", w8.length === 1 && w8[0].reasons.join() === "both,worker" && w8[0].evidence.length === 3, w8);
  const w9 = A([row("law.yml", [runI(2, "2026-10-09T09:10:00Z", "failure", "schedule")], [runI(1, "2026-10-09T03:23:05Z", "failure", "workflow_dispatch")])], {});
  chk("a workflow the Worker does not start is not judged by day", w9.length === 0);
  const got = [];
  const rl = await readWorkerLogs({ days, get: async (p) => { got.push(p); if (p.endsWith("10-08")) throw new Error("Worker 503 for /log"); return { day: "2026-10-09", entries: [] }; } });
  chk("readWorkerLogs: GET /log?day= per day, a failed read is null and named", JSON.stringify(got) === '["/log?day=2026-10-08","/log?day=2026-10-09"]' && rl.logs["2026-10-08"] === null && rl.errors.length === 1 && rl.logs["2026-10-09"].entries.length === 0, rl);

  // the issues
  const a1 = w8[0];
  const fake = (issues, comments = {}, labelErr = null) => {
    const sent = [];
    const api = async (p) => { if (p.startsWith("/repos/o/r/issues?labels=bot-watch&state=all")) return issues; const m = p.match(/^\/repos\/o\/r\/issues\/(\d+)\/comments/); if (m) return comments[m[1]] || []; throw new Error("unexpected " + p); };
    const send = async (method, p, body) => { sent.push({ method, p, body }); if (p.endsWith("/labels") && labelErr) throw new Error(labelErr); if (p === "/repos/o/r/issues") return { number: 77 }; return {}; };
    return { api, send, sent };
  };
  {
    const f = fake([]);
    const d = await fileIssues({ alerts: [a1], repo: "o/r", api: f.api, send: f.send });
    const post = f.sent.find((x) => x.p === "/repos/o/r/issues");
    chk("issues: none for the day: one issue opened, labelled bot-watch, title names workflow and day, evidence marked",
      d[0].action === "opened" && d[0].number === 77 && post.body.title === "bot-watch: issuer-keys.yml 2026-10-09 has no successful run" && post.body.labels.join() === "bot-watch" && post.body.body.includes("<!-- bot-watch-evidence: run:1 run:2 worker:issuer-keys@2026-10-09T03:23Z#2 -->"), f.sent);
  }
  {
    const f = fake([{ number: 9, title: issueTitle(a1), body: issueText(a1) }]);
    const d = await fileIssues({ alerts: [a1], repo: "o/r", api: f.api, send: f.send });
    chk("issues: the same facts judged again (05:47 and 06:17): nothing written", d[0].action === "already_told" && f.sent.filter((x) => x.p !== "/repos/o/r/labels").length === 0, f.sent);
  }
  {
    const old = { ...a1, evidence: ["run:1"] };
    const f = fake([{ number: 9, title: issueTitle(a1), body: issueText(old) }], { 9: [{ body: "unrelated" }] });
    const d = await fileIssues({ alerts: [a1], repo: "o/r", api: f.api, send: f.send });
    const c = f.sent.find((x) => x.p === "/repos/o/r/issues/9/comments");
    chk("issues: a second failure the same day: a comment on the day's issue, no second issue", d[0].action === "commented" && c && !f.sent.some((x) => x.p === "/repos/o/r/issues"), f.sent);
    const f2 = fake([{ number: 9, title: issueTitle(a1), body: issueText(old) }], { 9: [{ body: c.body.body }] });
    const d2 = await fileIssues({ alerts: [a1], repo: "o/r", api: f2.api, send: f2.send });
    chk("issues: after that comment, the same facts again: nothing written", d2[0].action === "already_told");
  }
  {
    const f = fake([{ number: 3, title: issueTitle(a1), body: "x", pull_request: {} }], {}, "GitHub API POST 422 for /repos/o/r/labels");
    const d = await fileIssues({ alerts: [a1], repo: "o/r", api: f.api, send: f.send });
    chk("issues: the label exists already (422) is fine; a pull request with the same title is not the issue", d[0].action === "opened");
    const g = fake([], {}, "GitHub API POST 403 for /repos/o/r/labels");
    let thrown = false; try { await fileIssues({ alerts: [a1], repo: "o/r", api: g.api, send: g.send }); } catch { thrown = true; }
    chk("issues: a refused label write (403) fails the step", thrown);
    const h = fake([]);
    chk("issues: no alert, no call", (await fileIssues({ alerts: [], repo: "o/r", api: h.api, send: h.send })).length === 0 && h.sent.length === 0);
  }
  chk("issue text: no dash characters", !/[\u2012-\u2015\u2212\uFF0D]/.test(issueText(a1)));
}

// ---- 2026-11-06: the watcher judging itself must not loop ---------------------------------------------------
{
  const two = [run(1 * H, "failure", "workflow_dispatch"), run(8 * H, "failure")];
  chk("self: two failed runs of the watcher are reports, not FAILING", !judge({ workflow: active, allRuns: two, schedRuns: two, intervalMs: D, nowMs: NOW, self: true }).flags.includes("FAILING"));
  chk("self: the same runs on any other workflow are FAILING", judge({ workflow: active, allRuns: two, schedRuns: two, intervalMs: D, nowMs: NOW }).flags.includes("FAILING"));
  const redWeek = [1, 2, 3, 4, 5].map((d) => run(d * D - 2 * H, "failure"));
  chk("self: red for five days but still running is not OVERDUE", judge({ workflow: active, allRuns: redWeek, schedRuns: redWeek, intervalMs: D, nowMs: NOW, self: true }).flags.length === 0);
  const stopped = [run(4 * D, "success")];
  chk("self: a watcher that stopped running is OVERDUE", judge({ workflow: active, allRuns: stopped, schedRuns: stopped, intervalMs: D, nowMs: NOW, self: true }).flags.includes("OVERDUE"));
  const rows = [{ file: SELF_FILE, runs: { schedule: [run(2 * H, "failure")].map((r) => ({ ...r, id: 1 })), workflow_dispatch: [run(1 * H, "failure", "workflow_dispatch")].map((r) => ({ ...r, id: 2 })) } }];
  chk("self: no day issue for the watcher's own red runs", dayAlerts({ rows, logs: null, days: [new Date(NOW).toISOString().slice(0, 10)], nowMs: NOW }).length === 0);
}

chk("span: hours and days", span(H) === "1 h" && span(6 * H) === "6 h" && span(D) === "1 d" && span(92 * D) === "92 d" && span(null) === "n/a");

// ---- every scheduled workflow in this repository parses ------------------------------------------------------
{
  const dir = new URL("../../.github/workflows/", import.meta.url).pathname;
  const bad = [];
  for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
    const c = scheduledCrons(readFileSync(join(dir, f), "utf8"));
    if (c.length && !(expectedIntervalMs(c, NOW) > 0)) bad.push(f);
  }
  chk("repo: every scheduled workflow here has a readable cron and an interval", bad.length === 0, bad);
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
