// hs-cron-dispatch core (2026-11-04): which workflow a Cloudflare cron starts, how it is started, and what is written down.
// No Cloudflare import here, so node can test every rule without the network (test/dispatch.test.mjs).
//
// Why: GitHub starts scheduled workflows hours late (2026-10-28 to 11-03: survive-drill 03:17 came at 09:00 to 11:15
// UTC, issuer-keys 03:23 at 09:10 to 11:30, receipt-anchor 01:37 at 06:46 to 09:03, tooshi-daily 04:05 at 11:50,
// seki-heartbeat 21:17 at 00:10 to 02:56 the next day, jidec-stamp hourly came 1 to 6 times a day instead of 24).
// Cloudflare cron triggers fire on time, so this Worker calls GitHub's workflow_dispatch at the times the workflows
// name. The GitHub schedules stay as a late fallback; every workflow here does nothing when its day is already done.
// 0.2.0 (2026-11-04): ots-nightly.yml at 19:10 UTC with mode=nightly (nenrin-verify 0.9.0, v090). Until that workflow is
// on main, GitHub answers its dispatch 404; like any 4xx that is written down as failed and not retried.
//
// Rules this file keeps:
//   - One POST /repos/{repo}/actions/workflows/{file}/dispatches per job and cron slot. A slot is claimed in the log
//     before the call, so a second invocation of the same cron minute (Cloudflare does not promise exactly once) calls
//     nothing and is written down as duplicate_slot.
//   - 204 (or 200) is ok. 4xx is written down and not retried (a wrong token or a missing input does not heal by
//     itself). A network error or 5xx is retried once after RETRY_WAIT_MS; the workflows are idempotent per day, so a
//     dispatch that GitHub took although the answer was lost costs one extra run that does nothing.
//   - The token is never written to the log, never served, and never put in an error text.
//   - Every decision is written to the log, one record per UTC day, served at GET /log?day=YYYY-MM-DD; GET /status
//     says, per job, the last result and whether the last ok dispatch is older than its period plus a grace.

export const VERSION = "0.2.0";
export const REPO = "ogasurfproject-jpg/horizon-shield";
export const REF = "main";
export const USER_AGENT = "hs-cron-dispatch/" + VERSION + " (+https://github.com/" + REPO + "/tree/main/workers/hs-cron-dispatch)";
export const GITHUB_API = "https://api.github.com";
export const API_VERSION = "2022-11-28";
export const RETRY_WAIT_MS = 3000;
export const FETCH_TIMEOUT_MS = 20000;
export const LOG_KEEP_DAYS = 400;
export const SELFCHECK_EVERY_MS = 10 * 60 * 1000;

// The cron lines of wrangler.jsonc, UTC. The test checks that wrangler.jsonc says exactly these.
export const CRONS = ["17 * * * *", "37 1 * * *", "23 3 * * *", "5,35 4 * * *", "10 19 * * *"];

// hour null: every hour at that minute. inputs(ms): the workflow_dispatch inputs; each workflow declares them.
export const JOBS = [
  { id: "jidec-stamp", file: "jidec-stamp.yml", hour: null, minute: 17, period_h: 1, inputs: () => ({}) },
  { id: "receipt-anchor", file: "receipt-anchor.yml", hour: 1, minute: 37, period_h: 24, inputs: (ms) => ({ date: utcDay(ms - 86400000) }) },
  { id: "survive-drill", file: "survive-drill.yml", hour: 3, minute: 17, period_h: 24, inputs: () => ({ slot: "cron" }) },
  { id: "issuer-keys", file: "issuer-keys.yml", hour: 3, minute: 23, period_h: 24, inputs: () => ({ slot: "cron" }) },
  { id: "tooshi-daily", file: "tooshi-daily.yml", hour: 4, minute: 5, period_h: 24, inputs: () => ({ slot: "schedule" }) },
  { id: "tooshi-daily-second", file: "tooshi-daily.yml", hour: 4, minute: 35, period_h: 24, inputs: () => ({ slot: "second" }) },
  { id: "ots-nightly", file: "ots-nightly.yml", hour: 19, minute: 10, period_h: 24, inputs: () => ({ mode: "nightly" }) },
  { id: "seki-heartbeat", file: "seki-heartbeat.yml", hour: 21, minute: 17, period_h: 24, inputs: () => ({}) }
];
// /status calls a job late when its last ok dispatch is older than period_h plus this.
export const GRACE_H = 1;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function utcDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
export function slotMinute(ms) { return new Date(Math.floor(ms / 60000) * 60000).toISOString().slice(0, 16) + "Z"; }

export function jobsAt(ms) {
  const d = new Date(ms);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return JOBS.filter((j) => j.minute === m && (j.hour === null || j.hour === h));
}

// The minutes of a day a cron line fires (only the forms CRONS uses: numbers, lists, *). For the test.
export function cronMinutes(expr) {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5 || f.slice(2).some((x) => x !== "*")) throw new Error("cron form not used here: " + expr);
  const field = (s, max) => (s === "*" ? [...Array(max).keys()] : s.split(",").map((x) => { if (!/^\d+$/.test(x) || +x >= max) throw new Error("bad cron field " + s); return +x; }));
  const out = [];
  for (const h of field(f[1], 24)) for (const m of field(f[0], 60)) out.push(h * 60 + m);
  return out.sort((a, b) => a - b);
}

// ---- the log -------------------------------------------------------------------------------------------------------
// store: { getDay(day) -> {day, slots:[...], entries:[...]} | null, claim(day, slot, entry) -> bool, append(day, entry),
//          getMeta(key) -> any, putMeta(key, value) }. Production: the Durable Object in worker.js. Tests: memoryStore().

export function memoryStore() {
  const days = new Map(), meta = new Map();
  const day0 = (d) => { if (!days.has(d)) days.set(d, { day: d, slots: [], entries: [] }); return days.get(d); };
  return {
    _days: days, _meta: meta,
    async getDay(d) { return days.has(d) ? JSON.parse(JSON.stringify(days.get(d))) : null; },
    async claim(d, slot, entry) { const x = day0(d); if (x.slots.includes(slot)) return false; x.slots.push(slot); x.entries.push(entry); return true; },
    async append(d, entry) { day0(d).entries.push(entry); },
    async getMeta(k) { return meta.has(k) ? JSON.parse(JSON.stringify(meta.get(k))) : null; },
    async putMeta(k, v) { meta.set(k, JSON.parse(JSON.stringify(v))); }
  };
}

function clip(s, n) { return String(s == null ? "" : s).replace(/[\r\n\t]+/g, " ").slice(0, n); }
function scrub(s, token) { let t = String(s == null ? "" : s); if (token) t = t.split(token).join("[token]"); return t; }

// ---- one dispatch --------------------------------------------------------------------------------------------------

export function dispatchRequest(job, ms, token) {
  return {
    url: GITHUB_API + "/repos/" + REPO + "/actions/workflows/" + job.file + "/dispatches",
    init: {
      method: "POST",
      headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json", "x-github-api-version": API_VERSION, "user-agent": USER_AGENT, "content-type": "application/json" },
      body: JSON.stringify({ ref: REF, inputs: job.inputs(ms) })
    }
  };
}

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

async function callOnce(doFetch, req, token) {
  try {
    const res = await doFetch(req.url, { ...req.init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    let body = "";
    if (res.status !== 204) { try { body = await res.text(); } catch (_e) { body = ""; } }
    return { http: res.status, body: clip(scrub(body, token), 200) };
  } catch (e) {
    return { http: 0, body: clip(scrub("fetch_failed: " + ((e && e.message) || e), token), 200) };
  }
}

export async function dispatchJob({ job, ms, token, doFetch, sleep }) {
  const req = dispatchRequest(job, ms, token);
  const tries = [];
  let r = await callOnce(doFetch, req, token);
  tries.push(r);
  if (r.http === 0 || r.http >= 500) {
    await (sleep || sleepReal)(RETRY_WAIT_MS);
    r = await callOnce(doFetch, req, token);
    tries.push(r);
  }
  const ok = r.http === 204 || r.http === 200;
  return { ok, http: r.http, tries: tries.map((t) => ({ http: t.http, body: t.body })), inputs: job.inputs(ms) };
}

// ---- one cron invocation -------------------------------------------------------------------------------------------

export async function runCron({ store, token, cron, scheduledTime, now, doFetch, sleep }) {
  const ms = Number.isFinite(scheduledTime) ? scheduledTime : now;
  const day = utcDay(ms), slot = slotMinute(ms), at = new Date(now).toISOString();
  const jobs = jobsAt(ms);
  const out = [];
  if (!CRONS.includes(cron)) {
    await store.append(day, { at, slot, cron: clip(cron, 40), job: null, result: "unknown_cron", why: "this cron line is not in CRONS; nothing dispatched" });
    return [{ result: "unknown_cron" }];
  }
  if (!jobs.length) {
    await store.append(day, { at, slot, cron, job: null, result: "no_job", why: "no job is due at " + slot.slice(11, 16) + " UTC" });
    return [{ result: "no_job" }];
  }
  for (const job of jobs) {
    const key = job.id + "@" + slot;
    const base = { at, slot, cron, job: job.id, file: job.file };
    const first = await store.claim(day, key, { ...base, result: "claimed" });
    if (!first) {
      await store.append(day, { ...base, result: "duplicate_slot", why: "this job was already claimed for " + slot + "; nothing dispatched" });
      out.push({ job: job.id, result: "duplicate_slot" });
      continue;
    }
    if (!token) {
      await store.append(day, { ...base, result: "token_not_configured", why: "GH_DISPATCH_TOKEN is not set on this Worker; the GitHub schedule is the only start today" });
      out.push({ job: job.id, result: "token_not_configured" });
      continue;
    }
    const d = await dispatchJob({ job, ms, token, doFetch, sleep });
    const e = { ...base, result: d.ok ? "dispatched" : "failed", http: d.http, tries: d.tries, inputs: d.inputs };
    if (!d.ok) e.why = d.http >= 400 && d.http < 500 ? "GitHub refused the dispatch (not retried)" : "no answer or a server error twice";
    await store.append(day, e);
    if (!d.ok) console.error("hs-cron-dispatch: " + job.id + " " + slot + " failed http " + d.http + " " + (d.tries[d.tries.length - 1] || {}).body);
    out.push({ job: job.id, result: e.result, http: d.http });
  }
  return out;
}

// ---- what is served ------------------------------------------------------------------------------------------------

export async function statusView({ store, now, tokenConfigured, lookbackDays = 3 }) {
  const days = [];
  for (let i = lookbackDays - 1; i >= 0; i--) days.push(utcDay(now - i * 86400000));
  const entries = [];
  for (const d of days) { const x = await store.getDay(d); if (x) entries.push(...x.entries); }
  const jobs = JOBS.map((j) => {
    const mine = entries.filter((e) => e.job === j.id && e.result !== "claimed");
    const last = mine[mine.length - 1] || null;
    const lastOk = [...mine].reverse().find((e) => e.result === "dispatched") || null;
    const failures = mine.filter((e) => e.result === "failed").length;
    const late = !lastOk || now - Date.parse(lastOk.slot) > (j.period_h + GRACE_H) * 3600000;
    return { job: j.id, workflow: j.file, at_utc: (j.hour === null ? "every hour" : String(j.hour).padStart(2, "0")) + ":" + String(j.minute).padStart(2, "0"),
      last: last ? { slot: last.slot, result: last.result, http: last.http ?? null } : null, last_ok_slot: lastOk ? lastOk.slot : null,
      failures_in_view: failures, late };
  });
  return { worker: "hs-cron-dispatch", version: VERSION, repo: REPO, now: new Date(now).toISOString(), crons_utc: CRONS,
    token_configured: !!tokenConfigured, days_in_view: days, late_jobs: jobs.filter((j) => j.late).map((j) => j.job),
    failed_in_view: jobs.reduce((a, j) => a + j.failures_in_view, 0), jobs,
    note: "late: no ok dispatch within the job's period plus " + GRACE_H + " h (in the days in view). The GitHub schedules stay as a late fallback; a job here that is late or failed still runs from GitHub's own cron, hours late." };
}

export function validDay(s) { return typeof s === "string" && DAY_RE.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")); }

// A read only call with the token (the workflow file's metadata), at most once per SELFCHECK_EVERY_MS; the answer is
// the HTTP code only. 200 means the token reaches the repository's Actions. A cached answer is used only while the token
// is still there or still missing as it was, so the first look after a secret put calls GitHub.
export async function selfcheck({ store, token, now, doFetch }) {
  const prev = await store.getMeta("selfcheck");
  if (prev && prev.token_configured === !!token && now - Date.parse(prev.at) < SELFCHECK_EVERY_MS) return { ...prev, cached: true };
  let r;
  if (!token) r = { at: new Date(now).toISOString(), token_configured: false, github_http: null };
  else {
    let http = 0;
    try {
      const res = await doFetch(GITHUB_API + "/repos/" + REPO + "/actions/workflows/jidec-stamp.yml", { method: "GET", headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json", "x-github-api-version": API_VERSION, "user-agent": USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      http = res.status;
    } catch (_e) { http = 0; }
    r = { at: new Date(now).toISOString(), token_configured: true, github_http: http };
  }
  await store.putMeta("selfcheck", r);
  return { ...r, cached: false };
}

function json(o, status = 200) {
  return new Response(JSON.stringify(o, null, 1) + "\n", { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
}

export async function handleFetch({ request, store, token, now, doFetch }) {
  const u = new URL(request.url);
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (u.pathname === "/" || u.pathname === "/status") return json(await statusView({ store, now, tokenConfigured: !!token }));
  if (u.pathname === "/log") {
    const d = u.searchParams.get("day") || utcDay(now);
    if (!validDay(d)) return json({ error: "bad_day", want: "YYYY-MM-DD" }, 400);
    const x = await store.getDay(d);
    return json(x ? { day: d, entries: x.entries } : { day: d, entries: [] });
  }
  if (u.pathname === "/selfcheck") return json(await selfcheck({ store, token, now, doFetch }));
  return json({ error: "not_found", paths: ["/status", "/log?day=YYYY-MM-DD", "/selfcheck"] }, 404);
}
