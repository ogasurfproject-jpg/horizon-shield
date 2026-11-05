#!/usr/bin/env node
// Bot watch: which scheduled workflows of this repository stopped running or keep failing.
//
//   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/name node tools/status/bot_watch.mjs --out ops/status/BOTS.md
//        [--workflows .github/workflows] [--grace-hours 3] [--now ISO] [--alerts alerts.json] [--worker URL]
//   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/name node tools/status/bot_watch.mjs --issues alerts.json
//
// Reads every workflow file with a schedule, works out from its cron lines how far apart its runs are meant to be
// (the longest gap between two scheduled times), asks the GitHub REST API for its recent runs, and writes BOTS.md.
//   OVERDUE  the last successful scheduled run is older than 2 expected intervals plus the grace period, and at least 12 h
//   FAILING  the last 2 scheduled runs that finished (cancelled and skipped runs are not counted) both failed
//   UNKNOWN  the API could not be read for this workflow
//   DISABLED the workflow is turned off in GitHub; listed, not counted as a problem
// Exit code: 1 when any workflow is OVERDUE, FAILING or UNKNOWN (so GitHub tells the owner), 2 when this tool crashes.
//
// 2026-11-05: workers/hs-cron-dispatch starts some workflows with workflow_dispatch at the times their crons name, and
// GitHub's own schedule comes hours later as a fallback. For those workflows (WORKER_JOBS) the dispatch runs count
// with the scheduled runs for OVERDUE and FAILING. A dispatch the Worker could not make leaves no run, so GitHub sends
// no mail; for that the Worker's public GET /log?day= (no token) is read for yesterday and today (UTC), and a day of
// such a workflow is an alert when
//   both    its last finished dispatch run and its last finished scheduled run of that day failed, and so did the
//           day's last finished run of any event, or
//   worker  the Worker's last dispatch of one of its jobs that day failed (a retry still waiting is not counted) and
//           the workflow has no successful run that day.
// --alerts writes them; --issues opens one issue per workflow and day (label bot-watch) and, when the same day fails
// again with a run or a Worker record not named in the issue yet, adds a comment instead of a second issue.
//
// Zero dependencies. Node 22 or later.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
export const GRACE_HOURS = 3;
// GitHub does not run sub-daily schedules on time: jidec-stamp.yml ("17 * * * *") had 100 successful scheduled runs from
// 2026-09-20 to 2026-10-11 with a median gap of 5.2 h and a longest gap of 9.0 h, so "2 intervals + 3 h" (5 h) went red
// on a healthy hourly job (bot-watch #4, 2026-10-11). No workflow is judged OVERDUE before this long without a success.
export const MIN_OVERDUE_HOURS = 12;
const FAILED = new Set(["failure", "timed_out", "startup_failure", "action_required"]);
// workers/hs-cron-dispatch: its job ids and the workflow each dispatches (equal to JOBS in its src/core.mjs; the test
// checks it). Its GET /log and /status are public and need no token.
export const WORKER_URL = "https://hs-cron-dispatch.oga-surf-project.workers.dev";
export const WORKER_JOBS = {
  "jidec-stamp": "jidec-stamp.yml", "receipt-anchor": "receipt-anchor.yml", "survive-drill": "survive-drill.yml",
  "issuer-keys": "issuer-keys.yml", "tooshi-daily": "tooshi-daily.yml", "tooshi-daily-second": "tooshi-daily.yml",
  "ots-nightly": "ots-nightly.yml", "seki-heartbeat": "seki-heartbeat.yml", "bot-watch": "bot-watch.yml"
};
export const DISPATCHED_FILES = new Set(Object.values(WORKER_JOBS));
// The Worker counts a failed slot whose retry is due as waiting until this long after the due time (RETRY_STALE_MS).
const WORKER_RETRY_STALE_MS = 30 * MIN;
export const ISSUE_LABEL = "bot-watch";
const NOT_COUNTED = new Set(["cancelled", "skipped", "neutral", "stale"]);

// ---- cron --------------------------------------------------------------------------------------------------------
// The five field form GitHub uses, in UTC: numbers, *, lists, ranges and steps. No names (MON, JAN), no @ forms.
export function parseField(field, min, max) {
  const out = new Set();
  for (const part of String(field).split(",")) {
    const m = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/);
    if (!m) throw new Error("cron field not understood: " + field);
    let lo, hi;
    if (m[1] === "*") { lo = min; hi = max; }
    else { lo = Number(m[1]); hi = m[2] !== undefined ? Number(m[2]) : (m[3] !== undefined ? max : lo); }
    const step = m[3] !== undefined ? Number(m[3]) : 1;
    if (lo < min || hi > max || lo > hi || step < 1) throw new Error("cron field out of range: " + field);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

export function parseCron(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) throw new Error("cron needs 5 fields: " + expr);
  const dows = [...new Set(parseField(f[4], 0, 7).map((v) => v % 7))].sort((a, b) => a - b);   // 7 is Sunday too
  return {
    expr, minutes: parseField(f[0], 0, 59), hours: parseField(f[1], 0, 23), doms: parseField(f[2], 1, 31),
    months: parseField(f[3], 1, 12), dows, domStar: f[2] === "*", dowStar: f[4] === "*"
  };
}

function dayMatches(c, d) {
  if (!c.months.includes(d.getUTCMonth() + 1)) return false;
  const dom = c.doms.includes(d.getUTCDate()), dow = c.dows.includes(d.getUTCDay());
  if (c.domStar && c.dowStar) return true;
  if (c.domStar) return dow;
  if (c.dowStar) return dom;
  return dom || dow;   // both restricted: cron fires when either matches
}

export function fireTimes(crons, fromMs, toMs) {
  const out = [];
  const start = Math.floor(fromMs / DAY) * DAY;
  for (let day = start; day <= toMs; day += DAY) {
    const d = new Date(day);
    for (const c of crons) {
      if (!dayMatches(c, d)) continue;
      for (const h of c.hours) for (const m of c.minutes) {
        const t = day + h * HOUR + m * MIN;
        if (t >= fromMs && t <= toMs) out.push(t);
      }
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

// The longest gap between two scheduled times over the last 400 days: for a monthly or quarterly job this is the
// worst case, not the average, so a job is never called overdue just because this month is a long one.
export function expectedIntervalMs(cronExprs, refMs) {
  const crons = cronExprs.map(parseCron);
  const t = fireTimes(crons, refMs - 400 * DAY, refMs);
  let gap = 0;
  for (let i = 1; i < t.length; i++) gap = Math.max(gap, t[i] - t[i - 1]);
  return gap || null;
}

// ---- reading workflow files ----------------------------------------------------------------------------------------
export function scheduledCrons(text) {
  if (!/^\s*schedule:/m.test(text)) return [];
  const out = [];
  for (const m of text.matchAll(/^\s*-?\s*cron:\s*(["'])(.+?)\1/gm)) out.push(m[2].trim());
  return out;
}

// Who commits and where, read from the workflow text: the git user.name it sets and the literal paths of git add.
// A variable set once to a plain path (shell D=path or a YAML env line D: path) is substituted; any other variable,
// flags, "." and globs are skipped. Returns a null bot and no paths when it cannot tell.
export function writerOf(text) {
  const nm = text.match(/git config (?:--global )?user\.name\s+["']([^"']+)["']/);
  const vars = {};
  for (const m of text.matchAll(/^\s*([A-Z_][A-Z0-9_]*)(?:=|:\s+)["']?([\w./-]+)["']?\s*$/gm)) vars[m[1]] = m[2];
  const paths = new Set();
  for (const m of text.matchAll(/git add\s+([^\n;&|#]+)/g)) {
    for (let tok of m[1].trim().split(/\s+/)) {
      tok = tok.replace(/^["']|["']$/g, "").replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (all, v) => (v in vars ? vars[v] : all));
      if (!tok || tok.startsWith("-") || tok.includes("$") || /^\d?>/.test(tok) || tok === "." || tok.includes("*")) continue;
      paths.add(tok.replace(/\/$/, ""));
    }
  }
  return { bot: nm ? nm[1] : null, paths: [...paths] };
}

// ---- judging one workflow --------------------------------------------------------------------------------------
const when = (r) => Date.parse(r.run_started_at || r.created_at);

export function judge({ workflow, allRuns, schedRuns, intervalMs, nowMs, graceMs = GRACE_HOURS * HOUR }) {
  const all = [...(allRuns || [])].sort((a, b) => when(b) - when(a));
  const done = [...(schedRuns || [])].filter((r) => r.status === "completed" && !NOT_COUNTED.has(r.conclusion)).sort((a, b) => when(b) - when(a));
  let consecutive = 0;
  for (const r of done) { if (FAILED.has(r.conclusion)) consecutive++; else break; }
  const lastSchedOk = done.find((r) => r.conclusion === "success") || null;
  const lastAnyOk = all.find((r) => r.status === "completed" && r.conclusion === "success") || null;
  const limit = Math.max(2 * intervalMs + graceMs, MIN_OVERDUE_HOURS * HOUR);
  const since = lastSchedOk ? when(lastSchedOk) : Date.parse(workflow && workflow.created_at);
  const flags = [];
  if (workflow && workflow.state && workflow.state !== "active") flags.push("DISABLED");
  else {
    if (done.length >= 2 && FAILED.has(done[0].conclusion) && FAILED.has(done[1].conclusion)) flags.push("FAILING");
    if (!Number.isFinite(since) || nowMs - since > limit) flags.push("OVERDUE");
  }
  const last = all[0] || null;
  return {
    flags, consecutive_failures: consecutive, overdue_after_ms: limit,
    last_run: last ? { at: new Date(when(last)).toISOString(), event: last.event, status: last.status, conclusion: last.conclusion, url: last.html_url } : null,
    last_scheduled_success: lastSchedOk ? new Date(when(lastSchedOk)).toISOString() : null,
    last_success_any_event: lastAnyOk ? new Date(when(lastAnyOk)).toISOString() : null
  };
}

const slim = (runs) => (runs || []).map((r) => ({ id: r.id, event: r.event, status: r.status, conclusion: r.conclusion, created_at: r.created_at, run_started_at: r.run_started_at, html_url: r.html_url }));

// ---- days with no successful run (the Worker's dispatch and GitHub's schedule) ----------------------------------------
export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayOf = (r) => String(r.created_at || r.run_started_at || "").slice(0, 10);
const doneRuns = (runs) => (runs || []).filter((r) => r.status === "completed" && !NOT_COUNTED.has(r.conclusion)).sort((a, b) => when(b) - when(a));

// logs: { day: {entries:[...]} | null } from the Worker's GET /log. Returns one alert per workflow and day.
export function dayAlerts({ rows, logs, days, nowMs }) {
  const out = [];
  for (const row of rows) {
    if (!row.runs || !DISPATCHED_FILES.has(row.file)) continue;
    for (const day of days) {
      const sch = doneRuns(row.runs.schedule).filter((r) => dayOf(r) === day);
      const dsp = doneRuns(row.runs.workflow_dispatch).filter((r) => dayOf(r) === day);
      const any = doneRuns([...row.runs.schedule, ...row.runs.workflow_dispatch]).filter((r) => dayOf(r) === day);
      const okDay = any.some((r) => r.conclusion === "success");
      const reasons = [], evidence = [], lines = [];
      if (dsp.length && sch.length && FAILED.has(dsp[0].conclusion) && FAILED.has(sch[0].conclusion) && FAILED.has(any[0].conclusion)) {
        reasons.push("both");
        for (const r of [dsp[0], sch[0]]) { evidence.push("run:" + r.id); lines.push("- " + r.event + " run " + r.id + " " + r.conclusion + " (" + new Date(when(r)).toISOString() + ") " + (r.html_url || "")); }
      }
      const log = logs ? logs[day] : null;
      if (log && Array.isArray(log.entries) && !okDay) {
        for (const [id, file] of Object.entries(WORKER_JOBS)) {
          if (file !== row.file) continue;
          const mine = log.entries.filter((e) => e && e.job === id && (e.result === "dispatched" || e.result === "failed"));
          const last = mine[mine.length - 1];
          if (!last || last.result !== "failed") continue;
          if (last.retry_next && nowMs <= Date.parse(last.retry_next) + WORKER_RETRY_STALE_MS) continue;
          if (!reasons.includes("worker")) reasons.push("worker");
          evidence.push("worker:" + id + "@" + last.slot + "#" + (last.retry || 0));
          lines.push("- the Worker's dispatch of " + id + " for " + last.slot + " failed (http " + (last.http ?? "none") + (last.retry ? ", retry " + last.retry : "") + "): " + String(last.why || "").slice(0, 160));
        }
      }
      if (reasons.length) out.push({ file: row.file, day, reasons, evidence, lines, judged_at: new Date(nowMs).toISOString(), success_that_day: okDay });
    }
  }
  return out;
}

export async function readWorkerLogs({ days, get }) {
  const logs = {}, errors = [];
  for (const d of days) {
    try { logs[d] = await get("/log?day=" + d); }
    catch (e) { logs[d] = null; errors.push(d + ": " + String(e.message || e).slice(0, 160)); }
  }
  return { logs, errors };
}

export function workerGet(base) {
  return async (path) => {
    const res = await fetch(base + path, { headers: { accept: "application/json", "user-agent": "horizon-shield-bot-watch" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error("Worker " + res.status + " for " + path.split("?")[0]);
    return res.json();
  };
}

// ---- the issues (one per workflow and day) -----------------------------------------------------------------------
export const issueTitle = (a) => "bot-watch: " + a.file + " " + a.day + " has no successful run";
const MARK = /<!-- bot-watch-evidence: ([^>]*) -->/g;
const marked = (texts) => { const s = new Set(); for (const t of texts) for (const m of String(t || "").matchAll(MARK)) for (const k of m[1].trim().split(/\s+/)) if (k) s.add(k); return s; };
export function issueText(a) {
  const why = { both: "the dispatch run and the scheduled run of the day both failed", worker: "the Worker's dispatch failed (no run was made) and no run of the workflow succeeded that day" };
  return [a.file + ", " + a.day + " (UTC): " + a.reasons.map((r) => why[r] || r).join("; ") + ".", "", ...a.lines, "",
    "Judged at " + a.judged_at + " by tools/status/bot_watch.mjs. Worker log: " + WORKER_URL + "/log?day=" + a.day,
    "<!-- bot-watch-evidence: " + a.evidence.join(" ") + " -->"].join("\n");
}

// api(path) reads, send(method, path, body) writes (GitHub REST). Returns what was done per alert.
export async function fileIssues({ alerts, repo, api, send, label = ISSUE_LABEL }) {
  const done = [];
  if (!alerts.length) return done;
  try { await send("POST", "/repos/" + repo + "/labels", { name: label, color: "b60205", description: "bot-watch: a day of a dispatched workflow with no successful run" }); }
  catch (e) { if (!/ 422 /.test(String(e.message || e))) throw e; }
  const list = (await api("/repos/" + repo + "/issues?labels=" + encodeURIComponent(label) + "&state=all&per_page=100")) || [];
  for (const a of alerts) {
    const title = issueTitle(a);
    const it = list.find((i) => i && !i.pull_request && i.title === title);
    if (!it) {
      const made = await send("POST", "/repos/" + repo + "/issues", { title, body: issueText(a), labels: [label] });
      done.push({ title, action: "opened", number: made && made.number });
      continue;
    }
    const comments = (await api("/repos/" + repo + "/issues/" + it.number + "/comments?per_page=100")) || [];
    const seen = marked([it.body, ...comments.map((c) => c.body)]);
    const fresh = a.evidence.filter((k) => !seen.has(k));
    if (!fresh.length) { done.push({ title, action: "already_told", number: it.number }); continue; }
    await send("POST", "/repos/" + repo + "/issues/" + it.number + "/comments", { body: "The same day failed again.\n\n" + issueText(a) });
    done.push({ title, action: "commented", number: it.number });
  }
  return done;
}

// ---- the API ---------------------------------------------------------------------------------------------------------
export function githubSend(token) {
  return async (method, path, body) => {
    const res = await fetch("https://api.github.com" + path, {
      method, body: JSON.stringify(body),
      headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "horizon-shield-bot-watch", "content-type": "application/json" },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) throw new Error("GitHub API " + method + " " + res.status + " for " + path.split("?")[0]);
    return res.json();
  };
}

export function githubApi(token) {
  return async (path) => {
    const res = await fetch("https://api.github.com" + path, {
      headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "horizon-shield-bot-watch" },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) throw new Error("GitHub API " + res.status + " for " + path.split("?")[0]);
    return res.json();
  };
}

async function lastBotCommit(api, repo, writer) {
  if (!writer.bot || !writer.paths.length) return { inferred: false };
  let best = null;
  for (const p of writer.paths) {
    const list = await api("/repos/" + repo + "/commits?per_page=30&path=" + encodeURIComponent(p));
    for (const c of list || []) {
      const a = c.commit && c.commit.author, k = c.commit && c.commit.committer;
      const mine = (a && a.name === writer.bot) || (k && k.name === writer.bot);
      const t = Date.parse((a && a.date) || (k && k.date));
      if (mine && Number.isFinite(t) && (best === null || t > best)) best = t;
    }
  }
  return { inferred: true, bot: writer.bot, paths: writer.paths, at: best === null ? null : new Date(best).toISOString() };
}

export async function watch({ dir, repo, api, nowMs, graceMs = GRACE_HOURS * HOUR }) {
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();
  const rows = [];
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    const crons = scheduledCrons(text);
    if (!crons.length) continue;
    const row = { file: f, crons, interval_ms: null, flags: [] };
    try { row.interval_ms = expectedIntervalMs(crons, nowMs); }
    catch (e) { row.flags = ["UNKNOWN"]; row.error = String(e.message || e); rows.push(row); continue; }
    try {
      const base = "/repos/" + repo + "/actions/workflows/" + encodeURIComponent(f);
      const workflow = await api(base);
      const allRuns = (await api(base + "/runs?per_page=20")).workflow_runs;
      const schedRuns = (await api(base + "/runs?per_page=20&event=schedule")).workflow_runs;
      // a workflow the Worker dispatches: its dispatch runs count too (100, so an hourly job keeps more than a day)
      const dispRuns = DISPATCHED_FILES.has(f) ? (await api(base + "/runs?per_page=100&event=workflow_dispatch")).workflow_runs || [] : [];
      row.counted_events = DISPATCHED_FILES.has(f) ? ["schedule", "workflow_dispatch"] : ["schedule"];
      if (DISPATCHED_FILES.has(f)) row.runs = { schedule: slim(schedRuns), workflow_dispatch: slim(dispRuns) };
      Object.assign(row, { name: workflow.name, state: workflow.state }, judge({ workflow, allRuns, schedRuns: [...(schedRuns || []), ...dispRuns], intervalMs: row.interval_ms, nowMs, graceMs }));
    } catch (e) {
      row.flags = ["UNKNOWN"]; row.error = String(e.message || e).slice(0, 200);
      rows.push(row); continue;
    }
    try {
      row.bot_commit = await lastBotCommit(api, repo, writerOf(text));
      if (row.bot_commit.inferred) {
        const t = row.bot_commit.at ? Date.parse(row.bot_commit.at) : NaN;
        row.bot_commit.quiet = !Number.isFinite(t) || nowMs - t > row.overdue_after_ms;
      }
    } catch (e) {
      row.bot_commit = { inferred: true, error: String(e.message || e).slice(0, 200) };
    }
    rows.push(row);
  }
  return rows;
}

// ---- BOTS.md -----------------------------------------------------------------------------------------------------
export function span(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "n/a";
  if (ms % DAY === 0 || ms >= 2 * DAY) return Math.round(ms / DAY * 10) / 10 + " d";
  if (ms >= HOUR) return Math.round(ms / HOUR * 10) / 10 + " h";
  return Math.round(ms / MIN) + " min";
}
const NO_DASH = /[\u2012-\u2015\u2212\uFF0D]/g;
const cell = (v) => String(v ?? "n/a").replace(/\|/g, "/").replace(/\s+/g, " ").replace(NO_DASH, "-");

export function problems(rows) { return rows.filter((r) => r.flags.some((f) => f !== "DISABLED")); }

export function renderBots(rows, nowMs, graceMs = GRACE_HOURS * HOUR, days = null) {
  const bad = problems(rows);
  const L = ["# Scheduled workflows", ""];
  L.push("Written by `tools/status/bot_watch.mjs` at " + new Date(nowMs).toISOString() + ". " + rows.length + " scheduled workflows, " +
    (bad.length ? bad.length + " need attention: " + bad.map((r) => r.file + " (" + r.flags.join(", ") + ")").join("; ") + "." : "none needs attention."), "");
  L.push("| Workflow | Schedule (UTC) | Expected every | Last run | Last counted success | Failures in a row | Status | Last bot commit to its paths |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const last = r.last_run ? r.last_run.at + " " + r.last_run.event + " " + (r.last_run.conclusion || r.last_run.status) : (r.error ? "API: " + r.error : "none");
    const status = r.flags.length ? r.flags.join(", ") : "ok";
    const bc = !r.bot_commit ? "n/a" : !r.bot_commit.inferred ? "not inferred" : r.bot_commit.error ? "API: " + r.bot_commit.error :
      (r.bot_commit.at || "none in the last 30 commits") + " by " + r.bot_commit.bot + (r.bot_commit.quiet ? " (quiet)" : "");
    const counted = r.counted_events && r.counted_events.length > 1 ? " (schedule or Worker dispatch)" : "";
    L.push("| " + ["`" + r.file + "`", r.crons.map((c) => "`" + c + "`").join(" "), span(r.interval_ms), last, (r.last_scheduled_success || "none in the last 20") + counted,
      r.consecutive_failures ?? "n/a", status, bc].map((x, i) => (i <= 1 ? x : cell(x))).join(" | ") + " |");
  }
  if (days) {
    L.push("", "## Days with no successful run (workflows the Worker dispatches)", "");
    L.push("Days judged (UTC): " + days.days.join(", ") + ". Worker log: " + (days.errors.length ? "not read for " + days.errors.join("; ") : "read") + ".");
    L.push("");
    if (!days.alerts.length) L.push("None.");
    for (const a of days.alerts) L.push("- `" + a.file + "` " + a.day + ": " + a.reasons.join(", ") + " (" + a.evidence.join(" ") + ")");
  }
  L.push("", "## Rules", "");
  L.push("- Expected every: the longest gap between two times the cron lines name, over the last 400 days.");
  L.push("- OVERDUE: the last successful scheduled run is older than 2 expected intervals plus " + span(graceMs) + ", and never less than " + MIN_OVERDUE_HOURS + " h, because GitHub runs hourly schedules hours late (for a workflow with no successful scheduled run in the last 20, counted from when GitHub first saw the file).");
  L.push("- FAILING: the last 2 scheduled runs that finished both failed (failure, timed out, startup failure or waiting for approval). Cancelled and skipped runs are not counted either way.");
  L.push("- For a workflow that workers/hs-cron-dispatch starts (" + [...DISPATCHED_FILES].sort().join(", ") + "), its workflow_dispatch runs count with the scheduled runs for OVERDUE and FAILING; a run by hand is a workflow_dispatch run too.");
  L.push("- A day (UTC, yesterday and today) of such a workflow opens one issue (label " + ISSUE_LABEL + ") when its last finished dispatch run and its last finished scheduled run both failed and so did its last run of the day, or when the Worker's last dispatch of its job that day failed (in the Worker's public /log) and no run of the workflow succeeded that day. A later failure of the same day not named in the issue adds a comment.");
  L.push("- UNKNOWN: the GitHub API could not be read for this workflow. DISABLED: the workflow is turned off in GitHub; listed here, not counted as a problem.");
  L.push("- The job that writes this page fails (and GitHub notifies the owner) when any workflow is OVERDUE, FAILING or UNKNOWN.");
  L.push("", "## What it does not establish", "");
  L.push("- A successful run means the job exited 0, not that it did useful work. A bot that has nothing to commit still succeeds.");
  L.push("- The last column is a hint, not a rule: the bot name and paths are read from the workflow text (`git config user.name` and `git add` paths, with a variable substituted only when the file sets it once to a plain path), and only the last 30 commits per path are read. \"quiet\" means no commit by that bot within the overdue window; many bots commit only when something changed, so quiet is not a failure and does not turn this job red.");
  L.push("- Only the 20 most recent runs of each workflow are read. Workflows without a schedule are not listed.");
  L.push("");
  return L.join("\n");
}

// ---- CLI ---------------------------------------------------------------------------------------------------------
async function main() {
  const a = { dir: ".github/workflows", out: null, grace: GRACE_HOURS, now: null, alerts: null, worker: WORKER_URL, issues: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--workflows") a.dir = v; else if (k === "--out") a.out = v;
    else if (k === "--grace-hours") a.grace = Number(v); else if (k === "--now") a.now = v;
    else if (k === "--alerts") a.alerts = v; else if (k === "--worker") a.worker = v; else if (k === "--issues") a.issues = v;
    else throw new Error("unknown argument " + k);
  }
  const repo = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN;
  if (a.issues) {
    if (!repo || !token) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required");
    const alerts = JSON.parse(readFileSync(a.issues, "utf8")).alerts || [];
    const done = await fileIssues({ alerts, repo, api: githubApi(token), send: githubSend(token) });
    console.log(done.length ? done.map((d) => d.action + " #" + d.number + " " + d.title).join("\n") : "no day to tell");
    process.exit(0);
  }
  if (!a.out || !repo || !token) throw new Error("--out, GITHUB_REPOSITORY and GITHUB_TOKEN are required");
  const nowMs = a.now ? Date.parse(a.now) : Date.now();
  const graceMs = a.grace * HOUR;
  const rows = await watch({ dir: a.dir, repo, api: githubApi(token), nowMs, graceMs });
  const days = [utcDay(nowMs - DAY), utcDay(nowMs)];
  const { logs, errors } = await readWorkerLogs({ days, get: workerGet(a.worker) });
  const alerts = dayAlerts({ rows, logs, days, nowMs });
  if (a.alerts) writeFileSync(a.alerts, JSON.stringify({ judged_at: new Date(nowMs).toISOString(), days, worker_errors: errors, alerts }, null, 1) + "\n");
  for (const e of errors) console.log("::warning::the Worker log could not be read for " + e);
  const md = renderBots(rows, nowMs, graceMs, { days, errors, alerts });
  mkdirSync(dirname(a.out), { recursive: true });
  writeFileSync(a.out, md);
  console.log(md);
  const bad = problems(rows);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "problems=" + bad.length + "\n");
  process.exit(bad.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e && e.stack || e); process.exit(2); });
}

