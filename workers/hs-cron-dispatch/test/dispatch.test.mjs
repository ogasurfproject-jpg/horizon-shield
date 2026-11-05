// test/dispatch.test.mjs: the rules of src/core.mjs, with a fake GitHub and an in-memory log. No network:
// globalThis.fetch throws for the whole run. Run: node test/dispatch.test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CRONS, JOBS, REPO, VERSION, jobsAt, cronMinutes, slotMinute, utcDay, memoryStore, dispatchRequest, runCron,
  statusView, handleFetch, selfcheck, validDay, SELFCHECK_EVERY_MS, runRetries, retryDue, RETRY_AFTER_MIN, RETRY_STALE_MS
} from "../src/core.mjs";

globalThis.fetch = () => { throw new Error("the network is not used in this test"); };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const REPO_ROOT = path.join(ROOT, "..", "..");
const TOKEN = "test-token-not-a-real-one-7f3a";

let n = 0, bad = 0;
function t(label, cond, extra) { n++; if (cond) { console.log("  ok   " + label); } else { bad++; console.log("  NG   " + label + (extra === undefined ? "" : " " + JSON.stringify(extra))); } }
const T = (s) => Date.parse(s);
const noSleep = async () => {};

function fakeGitHub(answers) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const a = answers.length ? answers.shift() : 204;
    if (a === "throw") throw new Error("connection reset (" + init.headers.authorization + ")");
    return new Response(a === 204 ? null : JSON.stringify({ message: "answer " + a + " for " + init.headers.authorization }), { status: a });
  };
  f.calls = calls;
  return f;
}

// ---- the table and the crons
{
  const fired = new Set();
  for (const c of CRONS) for (const m of cronMinutes(c)) fired.add(m);
  const due = new Set();
  for (const j of JOBS) for (let h = 0; h < 24; h++) if (j.hour === null || j.hour === h) due.add(h * 60 + j.minute);
  t("every job time is a minute some cron fires", [...due].every((m) => fired.has(m)), [...due].filter((m) => !fired.has(m)));
  t("every cron minute has a job (no empty invocations)", [...fired].every((m) => due.has(m)), [...fired].filter((m) => !due.has(m)));
  t("32 dispatches a day (24 jidec-stamp, 8 daily)", JOBS.reduce((a, j) => a + (j.hour === null ? 24 : 1), 0) === 32);
  const want = { "01:37": ["receipt-anchor"], "03:17": ["jidec-stamp", "survive-drill"], "03:23": ["issuer-keys"], "04:05": ["tooshi-daily"], "04:35": ["tooshi-daily-second"], "21:17": ["jidec-stamp", "seki-heartbeat"], "19:10": ["ots-nightly"], "19:17": ["jidec-stamp"], "12:17": ["jidec-stamp"], "06:17": ["jidec-stamp", "bot-watch"], "05:17": ["jidec-stamp"], "07:17": ["jidec-stamp"], "04:36": [] };
  for (const [hm, ids] of Object.entries(want)) t("jobs at " + hm + " UTC: " + (ids.join(", ") || "none"), JSON.stringify(jobsAt(T("2026-11-05T" + hm + ":00Z")).map((j) => j.id)) === JSON.stringify(ids));
  const wr = readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const cfg = JSON.parse(wr);
  t("wrangler.jsonc crons equal CRONS", JSON.stringify(cfg.triggers.crons) === JSON.stringify(CRONS), cfg.triggers.crons);
  t("wrangler.jsonc: one SQLite Durable Object LOG of class DispatchLog", cfg.durable_objects.bindings[0].name === "LOG" && cfg.durable_objects.bindings[0].class_name === "DispatchLog" && cfg.migrations[0].new_sqlite_classes[0] === "DispatchLog");
  t("wrangler.jsonc names no secret value", !/github_pat_|ghp_|GH_DISPATCH_TOKEN"\s*:/.test(wr));
  t("slot minute drops seconds", slotMinute(T("2026-11-05T04:05:59.900Z")) === "2026-11-05T04:05Z");
}

// ---- the request
{
  const at = T("2026-11-01T01:37:00Z");
  const ra = dispatchRequest(JOBS.find((j) => j.id === "receipt-anchor"), at, TOKEN);
  t("receipt-anchor: the day before, across a month edge", JSON.parse(ra.init.body).inputs.date === "2026-10-31");
  t("receipt-anchor: across a year edge", JSON.parse(dispatchRequest(JOBS.find((j) => j.id === "receipt-anchor"), T("2027-01-01T01:37:00Z"), TOKEN).init.body).inputs.date === "2026-12-31");
  t("url is the workflow's dispatches", ra.url === "https://api.github.com/repos/" + REPO + "/actions/workflows/receipt-anchor.yml/dispatches");
  t("POST, ref main, bearer token, API version", ra.init.method === "POST" && JSON.parse(ra.init.body).ref === "main" && ra.init.headers.authorization === "Bearer " + TOKEN && ra.init.headers["x-github-api-version"] === "2022-11-28");
  const ins = Object.fromEntries(JOBS.map((j) => [j.id, j.inputs(at)]));
  t("inputs: tooshi schedule and second, survive and issuer cron, jidec and seki none", ins["tooshi-daily"].slot === "schedule" && ins["tooshi-daily-second"].slot === "second" && ins["survive-drill"].slot === "cron" && ins["issuer-keys"].slot === "cron" && Object.keys(ins["jidec-stamp"]).length === 0 && Object.keys(ins["seki-heartbeat"]).length === 0);
  t("bot-watch: 06:17 UTC on the hourly line, inputs {}, no new cron line (5)", JOBS.find((j) => j.id === "bot-watch").file === "bot-watch.yml" && JSON.stringify(ins["bot-watch"]) === "{}" && CRONS.length === 5);
  const on = dispatchRequest(JOBS.find((j) => j.id === "ots-nightly"), T("2026-11-05T19:10:00Z"), TOKEN);
  t("ots-nightly: 19:10, ref main, inputs exactly {mode: nightly}", on.url.endsWith("/actions/workflows/ots-nightly.yml/dispatches") && JSON.parse(on.init.body).ref === "main" && JSON.stringify(JSON.parse(on.init.body).inputs) === '{"mode":"nightly"}');
}

// ---- the workflows declare the inputs the Worker sends (GitHub answers 422 to an undeclared input)
{
  for (const j of JOBS) {
    let y;
    try { y = readFileSync(path.join(REPO_ROOT, ".github", "workflows", j.file), "utf8"); } catch (_e) { y = null; }
    if (y === null) { t(j.file + " is in the tree", false); continue; }
    const wd = /^  workflow_dispatch:(.*)$/m.exec(y);
    t(j.file + " has workflow_dispatch", !!wd);
    t(j.file + " has a concurrency group", /^concurrency:\n  group: /m.test(y));
    for (const k of Object.keys(j.inputs(T("2026-11-05T00:00:00Z")))) {
      const i = y.indexOf("  workflow_dispatch:");
      const block = y.slice(i, y.indexOf("\n\n", i) > 0 ? y.indexOf("\n\n", i) : undefined);
      t(j.file + " declares the input " + k, new RegExp("^      " + k + ":$", "m").test(block));
    }
  }
}

// ---- one cron invocation
{
  const s = memoryStore(), gh = fakeGitHub([204, 204]);
  const r = await runCron({ store: s, token: TOKEN, cron: "17 * * * *", scheduledTime: T("2026-11-05T03:17:00Z"), now: T("2026-11-05T03:17:01Z"), doFetch: gh, sleep: noSleep });
  t("03:17: two dispatches, both ok", r.length === 2 && r.every((x) => x.result === "dispatched") && gh.calls.length === 2, r);
  const again = await runCron({ store: s, token: TOKEN, cron: "17 * * * *", scheduledTime: T("2026-11-05T03:17:00Z"), now: T("2026-11-05T03:17:09Z"), doFetch: gh, sleep: noSleep });
  t("the same cron minute again: duplicate_slot, no call", again.every((x) => x.result === "duplicate_slot") && gh.calls.length === 2, again);
  const next = await runCron({ store: s, token: TOKEN, cron: "17 * * * *", scheduledTime: T("2026-11-05T04:17:00Z"), now: T("2026-11-05T04:17:00Z"), doFetch: gh, sleep: noSleep });
  t("the next hour is a new slot", next.length === 1 && next[0].result === "dispatched" && gh.calls.length === 3);
  const day = await s.getDay("2026-11-05");
  t("the log names every claim and result", day.slots.length === 3 && day.entries.filter((e) => e.result === "dispatched").length === 3 && day.entries.filter((e) => e.result === "duplicate_slot").length === 2);
}
{
  const s = memoryStore(), gh = fakeGitHub([500, 204]);
  const r = await runCron({ store: s, token: TOKEN, cron: "23 3 * * *", scheduledTime: T("2026-11-05T03:23:00Z"), now: T("2026-11-05T03:23:00Z"), doFetch: gh, sleep: noSleep });
  t("500 then 204: one retry, ok", r[0].result === "dispatched" && gh.calls.length === 2);
}
{
  const s = memoryStore(), gh = fakeGitHub(["throw", "throw"]);
  const r = await runCron({ store: s, token: TOKEN, cron: "37 1 * * *", scheduledTime: T("2026-11-05T01:37:00Z"), now: T("2026-11-05T01:37:00Z"), doFetch: gh, sleep: noSleep });
  const e = (await s.getDay("2026-11-05")).entries.find((x) => x.result === "failed");
  t("network error twice: failed after one retry", r[0].result === "failed" && gh.calls.length === 2 && e.tries.length === 2 && e.http === 0);
  t("the token is not in the error text (the error carried it)", !JSON.stringify(s._days.get("2026-11-05")).includes(TOKEN) && JSON.stringify(e).includes("[token]"));
}
for (const code of [401, 403, 404, 422]) {
  const s = memoryStore(), gh = fakeGitHub([code]);
  const r = await runCron({ store: s, token: TOKEN, cron: "5,35 4 * * *", scheduledTime: T("2026-11-05T04:05:00Z"), now: T("2026-11-05T04:05:00Z"), doFetch: gh, sleep: noSleep });
  t(code + ": failed, not retried, token not in the log", r[0].result === "failed" && r[0].http === code && gh.calls.length === 1 && !JSON.stringify(s._days.get("2026-11-05")).includes(TOKEN));
}
{
  const s = memoryStore(), gh = fakeGitHub([404, 204]);
  const r = await runCron({ store: s, token: TOKEN, cron: "10 19 * * *", scheduledTime: T("2026-11-05T19:10:00Z"), now: T("2026-11-05T19:10:00Z"), doFetch: gh, sleep: noSleep });
  const e = (await s.getDay("2026-11-05")).entries.find((x) => x.job === "ots-nightly" && x.result === "failed");
  t("ots-nightly before its workflow is on main: 404 is failed, one call, not retried, written down", r.length === 1 && r[0].result === "failed" && r[0].http === 404 && gh.calls.length === 1 && e && e.tries.length === 1 && /not retried/.test(e.why));
  const st = await statusView({ store: s, now: T("2026-11-05T19:30:00Z"), tokenConfigured: true });
  t("status: the 404 shows as a failure of ots-nightly and ots-nightly is late", st.failed_in_view === 1 && st.late_jobs.includes("ots-nightly") && st.jobs.find((j) => j.job === "ots-nightly").last.http === 404);
}
{
  const s = memoryStore(), gh = fakeGitHub([200]);
  const r = await runCron({ store: s, token: TOKEN, cron: "5,35 4 * * *", scheduledTime: T("2026-11-05T04:35:00Z"), now: T("2026-11-05T04:35:00Z"), doFetch: gh, sleep: noSleep });
  t("200 (dispatch with run details) is ok too", r[0].result === "dispatched" && r[0].job === "tooshi-daily-second");
}
{
  const s = memoryStore(), gh = fakeGitHub([]);
  const r = await runCron({ store: s, token: "", cron: "17 * * * *", scheduledTime: T("2026-11-05T21:17:00Z"), now: T("2026-11-05T21:17:00Z"), doFetch: gh, sleep: noSleep });
  t("no token: token_not_configured, no call", r.every((x) => x.result === "token_not_configured") && gh.calls.length === 0 && r.length === 2);
  const u = await runCron({ store: s, token: TOKEN, cron: "0 0 * * *", scheduledTime: T("2026-11-05T00:00:00Z"), now: T("2026-11-05T00:00:00Z"), doFetch: gh, sleep: noSleep });
  t("a cron line not in CRONS: written down, no call", u[0].result === "unknown_cron" && gh.calls.length === 0);
  const nj = await runCron({ store: s, token: TOKEN, cron: "17 * * * *", scheduledTime: T("2026-11-05T05:18:00Z"), now: T("2026-11-05T05:18:00Z"), doFetch: gh, sleep: noSleep });
  t("a known cron at a minute with no job: no_job, no call", nj[0].result === "no_job" && gh.calls.length === 0);
}

{
  // 0.3.1: 06:17 dispatches jidec-stamp and bot-watch, one call each, on the hourly line
  const s = memoryStore(), gh = fakeGitHub([204, 204]);
  const r = await runCron({ store: s, token: TOKEN, cron: "17 * * * *", scheduledTime: T("2026-11-05T06:17:00Z"), now: T("2026-11-05T06:17:01Z"), doFetch: gh, sleep: noSleep });
  t("06:17: jidec-stamp and bot-watch dispatched, 2 calls", JSON.stringify(r.map((x) => x.job + ":" + x.result)) === '["jidec-stamp:dispatched","bot-watch:dispatched"]' && gh.calls.length === 2, r);
  t("06:17: bot-watch.yml dispatches, ref main, inputs {}", gh.calls[1].url.endsWith("/actions/workflows/bot-watch.yml/dispatches") && gh.calls[1].init.body === '{"ref":"main","inputs":{}}');
  const st = await statusView({ store: s, now: T("2026-11-05T06:30:00Z"), tokenConfigured: true });
  const bw = st.jobs.find((j) => j.job === "bot-watch");
  t("status: bot-watch has its row, at 06:17, last ok slot 06:17, version 0.3.1", bw && bw.at_utc === "06:17" && bw.last_ok_slot === "2026-11-05T06:17Z" && st.version === "0.3.1", bw);
}

// ---- the delayed retries at +5 and +15 min from the slot (0.3.0)
const jidec = (s, gh, at, now) => runCron({ store: s, token: TOKEN, cron: "17 * * * *", scheduledTime: T(at), now: T(now || at), doFetch: gh, sleep: noSleep });
{
  t("retry steps are +5 and +15 min", JSON.stringify(RETRY_AFTER_MIN) === "[5,15]");
  t("retryDue counts from the slot", retryDue(T("2026-11-04T11:17:00Z"), 1) === T("2026-11-04T11:22:00Z") && retryDue(T("2026-11-04T11:17:00Z"), 2) === T("2026-11-04T11:32:00Z"));
}
{
  // 2026-11-04 11:17 UTC: GitHub answered 500 from 11:16 to 11:18.
  const s = memoryStore(), gh = fakeGitHub([500, 500, 204]);
  const r = await jidec(s, gh, "2026-11-04T11:17:00Z", "2026-11-04T11:17:40Z");
  t("500, 500 at the slot: failed, queued for +5 min from the slot (not from the failure)", r[0].result === "failed" && r[0].retry_next === "2026-11-04T11:22:00.000Z" && gh.calls.length === 2 && s._alarm === T("2026-11-04T11:22:00Z"), r);
  const st0 = await statusView({ store: s, now: T("2026-11-04T11:20:00Z"), tokenConfigured: true });
  t("status while the retry waits: retrying 1, failed 0", st0.retrying_in_view === 1 && st0.failed_in_view === 0, [st0.retrying_in_view, st0.failed_in_view]);
  const early = await runRetries({ store: s, token: TOKEN, now: T("2026-11-04T11:21:59Z"), doFetch: gh });
  t("before +5 min: nothing due, no call", early.length === 0 && gh.calls.length === 2 && s._retries.size === 1);
  const dup = await jidec(s, gh, "2026-11-04T11:17:00Z", "2026-11-04T11:19:00Z");
  t("the same cron minute again during the wait: duplicate_slot, no call", dup[0].result === "duplicate_slot" && gh.calls.length === 2);
  const r1 = await runRetries({ store: s, token: TOKEN, now: T("2026-11-04T11:22:01Z"), doFetch: gh });
  t("+5 min: one call, 204, dispatched with retry 1", r1.length === 1 && r1[0].result === "dispatched" && r1[0].retry === 1 && gh.calls.length === 3, r1);
  t("the retry calls with the slot's request (same url and inputs)", gh.calls[2].url === gh.calls[0].url && gh.calls[2].init.body === gh.calls[0].init.body);
  t("after it: the queue is empty, no alarm", s._retries.size === 0 && s._alarm === null);
  const again = await runRetries({ store: s, token: TOKEN, now: T("2026-11-04T11:22:02Z"), doFetch: gh });
  t("the alarm running again: no call", again.length === 0 && gh.calls.length === 3);
  const day = await s.getDay("2026-11-04");
  const mine = day.entries.filter((e) => e.slot === "2026-11-04T11:17Z");
  t("the log keeps the first failed and adds the retry record", JSON.stringify(mine.map((e) => e.result)) === '["claimed","failed","duplicate_slot","dispatched"]', mine.map((e) => e.result));
  const ok = mine.find((e) => e.result === "dispatched");
  t("the retry record: retry 1, after_failed_slot, via alarm, the slot of the claim, made at 11:22:01", ok.retry === 1 && ok.after_failed_slot === true && ok.via === "alarm" && ok.slot === "2026-11-04T11:17Z" && ok.at === "2026-11-04T11:22:01.000Z" && ok.tries.length === 1);
  t("one claim for the slot", day.slots.filter((k) => k === "jidec-stamp@2026-11-04T11:17Z").length === 1 && day.slots.length === 1);
  t("one dispatched record for the slot", mine.filter((e) => e.result === "dispatched").length === 1);
  const st = await statusView({ store: s, now: T("2026-11-04T11:40:00Z"), tokenConfigured: true });
  const js = st.jobs.find((j) => j.job === "jidec-stamp");
  t("status: a slot ok on a retry is not counted failed, nothing retrying, not late", st.failed_in_view === 0 && st.retrying_in_view === 0 && js.failures_in_view === 0 && !js.late, js);
  t("status: last ok slot 11:17, made at 11:22:01", js.last_ok_slot === "2026-11-04T11:17Z" && js.last_ok_at === "2026-11-04T11:22:01.000Z" && js.last.retry === 1);
  const stL = await statusView({ store: s, now: T("2026-11-04T13:20:00Z"), tokenConfigured: true });
  const stL2 = await statusView({ store: s, now: T("2026-11-04T13:23:00Z"), tokenConfigured: true });
  t("late counts from the time of the ok dispatch (11:22:01 + 2 h), not from the slot", !stL.late_jobs.includes("jidec-stamp") && stL2.late_jobs.includes("jidec-stamp"));
}
{
  const s = memoryStore(), gh = fakeGitHub([500, 500, 500, "throw"]);
  await jidec(s, gh, "2026-11-04T11:17:00Z");
  // the alarm comes late (11:24); the next step is still due at slot + 15 min
  const r1 = await runRetries({ store: s, token: TOKEN, now: T("2026-11-04T11:24:30Z"), doFetch: gh });
  t("+5 min retry 500: failed, queued for +15 min from the slot even when the alarm came late", r1[0].result === "failed" && r1[0].retry === 1 && r1[0].retry_next === "2026-11-04T11:32:00.000Z" && s._alarm === T("2026-11-04T11:32:00Z") && gh.calls.length === 3, r1);
  const st1 = await statusView({ store: s, now: T("2026-11-04T11:30:00Z"), tokenConfigured: true });
  t("status between the retries: retrying 1, failed 0", st1.retrying_in_view === 1 && st1.failed_in_view === 0);
  const r2 = await runRetries({ store: s, token: TOKEN, now: T("2026-11-04T11:32:00Z"), doFetch: gh });
  t("+15 min retry fails too (4 calls): final failed, nothing queued, no alarm", r2[0].result === "failed" && r2[0].retry === 2 && !r2[0].retry_next && gh.calls.length === 4 && s._retries.size === 0 && s._alarm === null, r2);
  const e = (await s.getDay("2026-11-04")).entries.filter((x) => x.result === "failed");
  t("the log: three failed records (slot, +5, +15), the last one says final", e.length === 3 && /final/.test(e[2].why) && e[2].retry === 2 && e[2].http === 0);
  t("the token is not in the log (the network error carried it)", !JSON.stringify(s._days.get("2026-11-04")).includes(TOKEN) && JSON.stringify(e[2]).includes("[token]"));
  const st = await statusView({ store: s, now: T("2026-11-04T11:40:00Z"), tokenConfigured: true });
  t("status: the slot counts as one failure (not three), jidec-stamp late", st.failed_in_view === 1 && st.retrying_in_view === 0 && st.late_jobs.includes("jidec-stamp"), [st.failed_in_view, st.retrying_in_view]);
}
for (const code of [404, 401]) {
  const s = memoryStore(), gh = fakeGitHub([code]);
  const r = await jidec(s, gh, "2026-11-04T11:17:00Z");
  t(code + " at the slot: failed, no delayed retry queued", r[0].result === "failed" && !r[0].retry_next && gh.calls.length === 1 && s._retries.size === 0 && s._alarm === null);
}
{
  const s = memoryStore(), gh = fakeGitHub([502, 503, 404]);
  await jidec(s, gh, "2026-11-04T11:17:00Z");
  const r1 = await runRetries({ store: s, token: TOKEN, now: T("2026-11-04T11:22:00Z"), doFetch: gh });
  t("a 404 on the +5 min retry: failed, not retried again", r1[0].result === "failed" && r1[0].http === 404 && !r1[0].retry_next && s._retries.size === 0 && /not retried/.test((await s.getDay("2026-11-04")).entries.pop().why));
}
{
  const s = memoryStore(), gh = fakeGitHub(["throw", "throw"]);
  await jidec(s, gh, "2026-11-04T23:17:00Z");
  const r1 = await runRetries({ store: s, token: TOKEN, now: T("2026-11-04T23:22:00Z"), doFetch: gh });
  t("no answer twice then 204 at +5 min: dispatched; the record goes to the slot's day", r1[0].result === "dispatched" && (await s.getDay("2026-11-04")).entries.some((e) => e.retry === 1 && e.result === "dispatched"));
}
{
  // two slots waiting at once: the alarm is at the earliest, each is called once at its own time
  const s = memoryStore(), gh = fakeGitHub([500, 500, 500, 500, 500, 500, 204, 204, 204]);
  await runCron({ store: s, token: TOKEN, cron: "17 * * * *", scheduledTime: T("2026-11-04T03:17:00Z"), now: T("2026-11-04T03:17:00Z"), doFetch: gh, sleep: noSleep });
  t("03:17 both jobs fail: two items queued, alarm at 03:22", s._retries.size === 2 && s._alarm === T("2026-11-04T03:22:00Z") && gh.calls.length === 4);
  await runCron({ store: s, token: TOKEN, cron: "23 3 * * *", scheduledTime: T("2026-11-04T03:23:00Z"), now: T("2026-11-04T03:23:00Z"), doFetch: gh, sleep: noSleep });
  t("03:23 fails too: three items, alarm still 03:22", s._retries.size === 3 && s._alarm === T("2026-11-04T03:22:00Z"));
  const a = await runRetries({ store: s, token: TOKEN, now: T("2026-11-04T03:22:00Z"), doFetch: gh });
  t("03:22: the two 03:17 items, the 03:23 one waits, alarm at 03:28", a.length === 2 && s._retries.size === 1 && s._alarm === T("2026-11-04T03:28:00Z"));
  const b = await runRetries({ store: s, token: TOKEN, now: T("2026-11-04T03:28:00Z"), doFetch: gh });
  t("03:28: the 03:23 item, all dispatched, 9 calls", b.length === 1 && b[0].job === "issuer-keys" && [...a, ...b].every((x) => x.result === "dispatched") && gh.calls.length === 9);
}
{
  // a queued retry whose record never came (the alarm lost): counted failed after RETRY_STALE_MS
  const s = memoryStore(), gh = fakeGitHub([500, 500]);
  await jidec(s, gh, "2026-11-04T11:17:00Z");
  const a = await statusView({ store: s, now: T("2026-11-04T11:22:00Z") + RETRY_STALE_MS, tokenConfigured: true });
  const b = await statusView({ store: s, now: T("2026-11-04T11:22:00Z") + RETRY_STALE_MS + 1, tokenConfigured: true });
  t("a retry that never wrote its record: retrying until due + 30 min, then failed", a.retrying_in_view === 1 && a.failed_in_view === 0 && b.retrying_in_view === 0 && b.failed_in_view === 1);
}
{
  const s = memoryStore(), gh = fakeGitHub([500, 500]);
  await jidec(s, gh, "2026-11-04T11:17:00Z");
  const r = await runRetries({ store: s, token: "", now: T("2026-11-04T11:22:00Z"), doFetch: gh });
  t("the token gone before the retry: failed, no call, nothing queued", r[0].result === "failed" && gh.calls.length === 2 && s._retries.size === 0);
  t("a retry item holds no token", ![...s._retries.values()].some((x) => JSON.stringify(x).includes(TOKEN)));
}
{
  const s = memoryStore(), gh = fakeGitHub([500, 500]);
  await jidec(s, gh, "2026-11-04T11:17:00Z");
  t("a queued retry item holds no token, only job, slot, day, ms, step, due", JSON.stringify(Object.keys([...s._retries.values()][0]).sort()) === '["day","due","job","key","ms","slot","step"]' && !JSON.stringify([...s._retries.values()]).includes(TOKEN));
}

// ---- status, log, selfcheck
{
  const s = memoryStore(), gh = fakeGitHub(Array(40).fill(204));
  const start = T("2026-11-05T00:00:00Z");
  for (let m = 0; m < 24 * 60; m++) {
    const ms = start + m * 60000;
    if (!jobsAt(ms).length) continue;
    const cron = CRONS.find((c) => cronMinutes(c).includes(m));
    await runCron({ store: s, token: TOKEN, cron, scheduledTime: ms, now: ms, doFetch: gh, sleep: noSleep });
  }
  t("a whole day: 32 calls", gh.calls.length === 32, gh.calls.length);
  const st = await statusView({ store: s, now: T("2026-11-05T23:30:00Z"), tokenConfigured: true });
  t("status after a whole day: nothing late, nothing failed", st.late_jobs.length === 0 && st.failed_in_view === 0 && st.version === VERSION, st.late_jobs);
  const st2 = await statusView({ store: s, now: T("2026-11-06T02:40:00Z"), tokenConfigured: true });
  t("status at 02:40 the next day with no calls since: jidec-stamp (2 h) and receipt-anchor (01:37 + 25 h) late, the rest not yet", JSON.stringify(st2.late_jobs) === JSON.stringify(["jidec-stamp", "receipt-anchor"]), st2.late_jobs);
  const res = await handleFetch({ request: new Request("https://x/status"), store: s, token: TOKEN, now: T("2026-11-05T23:30:00Z"), doFetch: gh });
  const body = await res.text();
  t("GET /status: 200 JSON, token_configured true, the token not in it", res.status === 200 && JSON.parse(body).token_configured === true && !body.includes(TOKEN));
  const lg = await handleFetch({ request: new Request("https://x/log?day=2026-11-05"), store: s, token: TOKEN, now: T("2026-11-05T23:30:00Z"), doFetch: gh });
  const lb = await lg.text();
  t("GET /log?day: the day's entries, no token", lg.status === 200 && JSON.parse(lb).entries.length >= 32 && !lb.includes(TOKEN));
  const b1 = await handleFetch({ request: new Request("https://x/log?day=2026-13-45"), store: s, token: TOKEN, now: 0, doFetch: gh });
  const b2 = await handleFetch({ request: new Request("https://x/log?day=../x"), store: s, token: TOKEN, now: 0, doFetch: gh });
  t("GET /log with a bad day: 400", b1.status === 400 && b2.status === 400 && !validDay("2026-02-30x"));
  const po = await handleFetch({ request: new Request("https://x/status", { method: "POST" }), store: s, token: TOKEN, now: 0, doFetch: gh });
  t("POST: 405 (nothing can be started from outside)", po.status === 405);
  const nf = await handleFetch({ request: new Request("https://x/dispatch"), store: s, token: TOKEN, now: 0, doFetch: gh });
  t("an unknown path: 404", nf.status === 404);
}
{
  const s = memoryStore(), gh = fakeGitHub([200, 401]);
  const a = await selfcheck({ store: s, token: TOKEN, now: T("2026-11-05T10:00:00Z"), doFetch: gh });
  const b = await selfcheck({ store: s, token: TOKEN, now: T("2026-11-05T10:05:00Z"), doFetch: gh });
  const nb = gh.calls.length;
  const c = await selfcheck({ store: s, token: TOKEN, now: T("2026-11-05T10:00:00Z") + SELFCHECK_EVERY_MS, doFetch: gh });
  t("selfcheck: GET with the token, 200", a.github_http === 200 && gh.calls[0].init.method === "GET" && gh.calls[0].url.endsWith("/actions/workflows/jidec-stamp.yml"));
  t("selfcheck: within 10 minutes the cached answer, no call", b.cached === true && nb === 1);
  t("selfcheck: after 10 minutes a new call", c.cached === false && c.github_http === 401 && gh.calls.length === 2);
  t("selfcheck: no token, no call", (await selfcheck({ store: memoryStore(), token: "", now: 0, doFetch: gh })).token_configured === false && gh.calls.length === 2);
  t("selfcheck answer holds no token", !JSON.stringify(s._meta.get("selfcheck")).includes(TOKEN));
  const s2 = memoryStore(), g2 = fakeGitHub([200]);
  const x0 = await selfcheck({ store: s2, token: "", now: T("2026-11-05T10:00:00Z"), doFetch: g2 });
  const x1 = await selfcheck({ store: s2, token: TOKEN, now: T("2026-11-05T10:01:00Z"), doFetch: g2 });
  t("selfcheck: the first look after the token is put calls GitHub (no cached 'missing')", x0.token_configured === false && x1.cached === false && x1.github_http === 200 && g2.calls.length === 1);
}
{
  const src = readFileSync(path.join(ROOT, "src", "worker.js"), "utf8") + readFileSync(path.join(ROOT, "src", "core.mjs"), "utf8");
  t("the sources write no token to console", !/console\.(log|error)\([^)]*(token|TOKEN)/.test(src.replace(/GH_DISPATCH_TOKEN is not set/g, "")));
  t("utcDay", utcDay(T("2026-11-05T23:59:59Z")) === "2026-11-05");
}

console.log("hs-cron-dispatch " + VERSION + " test: " + (n - bad) + " / " + n + (bad ? " NG" : " all green"));
if (bad) process.exit(1);
