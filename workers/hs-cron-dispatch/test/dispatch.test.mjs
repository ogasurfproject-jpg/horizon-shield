// test/dispatch.test.mjs: the rules of src/core.mjs, with a fake GitHub and an in-memory log. No network:
// globalThis.fetch throws for the whole run. Run: node test/dispatch.test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CRONS, JOBS, REPO, VERSION, jobsAt, cronMinutes, slotMinute, utcDay, memoryStore, dispatchRequest, runCron,
  statusView, handleFetch, selfcheck, validDay, SELFCHECK_EVERY_MS
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
  t("30 dispatches a day (24 jidec-stamp, 6 daily)", JOBS.reduce((a, j) => a + (j.hour === null ? 24 : 1), 0) === 30);
  const want = { "01:37": ["receipt-anchor"], "03:17": ["jidec-stamp", "survive-drill"], "03:23": ["issuer-keys"], "04:05": ["tooshi-daily"], "04:35": ["tooshi-daily-second"], "21:17": ["jidec-stamp", "seki-heartbeat"], "12:17": ["jidec-stamp"], "04:36": [] };
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
  t("a whole day: 30 calls", gh.calls.length === 30, gh.calls.length);
  const st = await statusView({ store: s, now: T("2026-11-05T23:30:00Z"), tokenConfigured: true });
  t("status after a whole day: nothing late, nothing failed", st.late_jobs.length === 0 && st.failed_in_view === 0 && st.version === VERSION, st.late_jobs);
  const st2 = await statusView({ store: s, now: T("2026-11-06T02:40:00Z"), tokenConfigured: true });
  t("status at 02:40 the next day with no calls since: jidec-stamp (2 h) and receipt-anchor (01:37 + 25 h) late, the rest not yet", JSON.stringify(st2.late_jobs) === JSON.stringify(["jidec-stamp", "receipt-anchor"]), st2.late_jobs);
  const res = await handleFetch({ request: new Request("https://x/status"), store: s, token: TOKEN, now: T("2026-11-05T23:30:00Z"), doFetch: gh });
  const body = await res.text();
  t("GET /status: 200 JSON, token_configured true, the token not in it", res.status === 200 && JSON.parse(body).token_configured === true && !body.includes(TOKEN));
  const lg = await handleFetch({ request: new Request("https://x/log?day=2026-11-05"), store: s, token: TOKEN, now: T("2026-11-05T23:30:00Z"), doFetch: gh });
  const lb = await lg.text();
  t("GET /log?day: the day's entries, no token", lg.status === 200 && JSON.parse(lb).entries.length >= 30 && !lb.includes(TOKEN));
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
