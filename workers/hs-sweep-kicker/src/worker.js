// hs-sweep-kicker: a stopgap that asks the verify gate for one more sweep on a day when its 18:00 UTC sweep
// could not measure every row that was due (2026-10-23, stage 1).
//
// Why: the gate (workers/hs-verify-gate) re-measured its watched endpoints once a day from one cron. One run
// measured at most MAX_PER_SWEEP = 8 rows and stopped earlier when its own fetch budget of 50 ran out (a copy of the
// Workers Free limit; the account is on Workers Paid, whose limit is 10,000 subrequests per invocation).
// Rows left over are written to /sweep/last as skipped with "over MAX_PER_SWEEP" or "subrequest budget".
// On 2026-10-22 18 rows were due and 7 were measured. This Worker reads /sweep/last a little after the gate's
// cron and, only when the gate itself says rows were left over today, calls the gate's own POST /sweep once.
// It never changes the gate. It is meant to go away when the gate does this itself (gate 0.4.21, stage 2).
//
// 0.2.0 (2026-10-23, after gate 0.4.21): the gate now sweeps four times a day (18:00, 19:00, 20:00, 21:00 UTC), each
// run continuing where the last left off, so this Worker has no cron any more (triggers.crons is []). It stays deployed
// for /health, /log and /probe, and for a run started by hand. It calls POST /sweep with SWEEP_ONLY_TOKEN, a key the
// gate accepts for POST /sweep and nothing else (no force, no register change). It no longer reads SWEEP_TOKEN, the
// operator key, and falls back to nothing: without SWEEP_ONLY_TOKEN it records token_not_configured and does not call.
//
// Rules this file keeps:
//   - POST /sweep only when all hold: the last sweep is from today (UTC) and ran: true; skipped has a row whose
//     reason starts with "over MAX_PER_SWEEP" or "subrequest budget" (the gate's own words, worker.js of the gate);
//     at least one of those rows was not measured today; this Worker has called POST /sweep fewer than 3 times
//     this UTC day. A "subrequest budget" reason does not say when the row was last measured, so for those rows
//     (and only when it decides the call) the Worker reads the gate's public GET /history and looks at the last
//     record's day, at most MAX_HISTORY_READS rows a run (0.1.1).
//   - Never retry. An unreadable /sweep/last, a 403, 409 or 503, a timeout: written down, nothing else.
//   - Every decision is written to KV, one key per UTC day, and served at GET /log?day=YYYY-MM-DD.
//     The token, request headers and response headers are never written and never served.
//   - When this Worker's own log cannot be read, it does not know how many times it has called today, so it does
//     not call and does not write (a failed read is not an empty day; issue #13 of this repository).

export const VERSION = "0.2.0";
export const GATE_ORIGIN = "https://gate.horizonshield.dev";
export const USER_AGENT = "hs-sweep-kicker/" + VERSION + " (+https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/workers/hs-sweep-kicker)";
// 0.2.0: no cron (wrangler.jsonc triggers.crons is []). The stage 1 schedule is kept as a name, for a run by hand and the tests.
export const CRONS = [];
export const STAGE1_CRONS = ["17 19 * * *", "41 19 * * *", "13 20 * * *"];
// The only key this Worker sends. Never SWEEP_TOKEN (the gate's operator key).
export function sweepToken(env) { return env && typeof env.SWEEP_ONLY_TOKEN === "string" && env.SWEEP_ONLY_TOKEN ? env.SWEEP_ONLY_TOKEN : ""; }
export const MAX_KICKS_PER_DAY = 3;
// The gate writes these at the start of a skipped row's reason (hs-verify-gate src/worker.js, runDailySweepUnleased).
export const REASON_OVER_MAX = "over MAX_PER_SWEEP";
export const REASON_BUDGET = "subrequest budget";
// /history reads per run, for subrequest budget rows only. The gate puts at most MAX_PER_SWEEP = 8 rows in a run, and only
// rows of the run can be skipped for budget, so 8 covers them all. With /sweep/last and POST /sweep a run makes at most
// 10 outbound requests, far inside the 10,000 subrequests a Workers Paid invocation allows (and inside Free's 50 too).
export const MAX_HISTORY_READS = 8;
export const LOG_TTL_SECONDS = 60 * 60 * 24 * 400;   // the gate keeps its usage counters 400 days; the same here
const GET_TIMEOUT_MS = 20000;
const POST_TIMEOUT_MS = 10 * 60 * 1000;   // a sweep of 8 rows takes tens of seconds; the cron may run 15 minutes

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function utcDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
function logKey(day) { return "log:" + day; }

class LogReadFailure extends Error {
  constructor(day, cause) { super("the kicker log for " + day + " could not be read"); this.logReadFailure = true; this.cause = cause; }
}

// null when there is no log for the day yet; throws LogReadFailure when the read itself failed.
export async function readDayLog(env, day) {
  if (!env || !env.KICK_LOG) throw new LogReadFailure(day, "KV binding KICK_LOG is missing");
  let raw;
  try { raw = await env.KICK_LOG.get(logKey(day)); }
  catch (e) { throw new LogReadFailure(day, String((e && e.message) || e)); }
  if (raw === null || raw === undefined) return null;
  let v;
  try { v = JSON.parse(raw); }
  catch (e) { throw new LogReadFailure(day, "stored log is not JSON"); }
  if (!v || !Array.isArray(v.entries)) throw new LogReadFailure(day, "stored log has no entries array");
  return v;
}

export function kicksIn(log) {
  if (!log || !Array.isArray(log.entries)) return 0;
  return log.entries.filter((e) => e && e.post && e.post.attempted === true).length;
}

// The gate's over MAX_PER_SWEEP reason names when the row was last measured:
//   "... this endpoint was last measured 2026-10-22T18:00:52.468Z, so it goes first next time)"
// Returns the ISO string, "never", or null when the sentence is not there.
export function lastMeasuredFromReason(reason) {
  const m = /last measured (\S+?), so it goes first/.exec(String(reason || ""));
  return m ? m[1] : null;
}

// What /sweep/last said, in counts. Endpoint URLs are not copied into the log: the gate already publishes them.
// budgetSeen (optional): Map endpoint -> "today" | "earlier" | "unknown", what /history said about a budget row.
// A budget row counts as measured today only when its /history was read and its last record is from today.
export function summarizeSweep(sl, today, budgetSeen) {
  const skipped = Array.isArray(sl && sl.skipped) ? sl.skipped : [];
  let overMax = 0, budget = 0, overMaxMeasuredToday = 0, budgetMeasuredToday = 0, pending = 0;
  for (const s of skipped) {
    const r = String((s && s.reason) || "");
    if (r.startsWith(REASON_OVER_MAX)) {
      overMax++;
      const lm = lastMeasuredFromReason(r);
      if (lm && lm !== "never" && lm.slice(0, 10) === today) overMaxMeasuredToday++;
      else pending++;
    } else if (r.startsWith(REASON_BUDGET)) {
      budget++;
      // The budget reason does not say when the row was last measured. Without a /history reading that says today,
      // the row counts as not measured today (the side that may call once more, never the side that misses a row).
      if (budgetSeen && s && budgetSeen.get(s.endpoint) === "today") budgetMeasuredToday++;
      else pending++;
    }
  }
  const at = sl && typeof sl.at === "string" ? sl.at : null;
  return {
    ran: sl ? (sl.ran === true ? true : sl.ran === false ? false : null) : null,
    at,
    day: at ? at.slice(0, 10) : null,
    is_today: !!(at && at.slice(0, 10) === today),
    watched_total: sl && typeof sl.watched_total === "number" ? sl.watched_total : null,
    measured: sl && typeof sl.measured === "number" ? sl.measured : null,
    skipped_total: skipped.length,
    skipped_over_max: overMax,
    skipped_over_max_measured_today: overMaxMeasuredToday,
    skipped_budget: budget,
    skipped_budget_measured_today: budgetMeasuredToday,
    pending_not_measured_today: pending,
    error: sl && typeof sl.error === "string" ? sl.error.slice(0, 80) : null
  };
}

// The decision table. Pure: no I/O. Order matters only for which reason is written; every row of the table
// that says "skip" or "record_only" means no POST.
export function decide({ readable, http, summary, kicksToday, tokenConfigured }) {
  if (!readable) return { decision: "record_only", reason: "sweep_last_unreadable", why: "GET /sweep/last did not give a readable record (http " + (http || 0) + "). Not retried." };
  if (summary.error === "sweep_last_read_failed") return { decision: "record_only", reason: "sweep_last_read_failed", why: "the gate said its record of the last sweep could not be read. Not retried." };
  if (!summary.is_today) return { decision: "skip", reason: "not_today", why: "the last sweep is from " + (summary.day || "an unknown day") + ", not today (UTC)" };
  if (summary.ran !== true) return { decision: "skip", reason: "not_ran", why: "the last sweep record does not say ran: true" };
  if (summary.skipped_over_max + summary.skipped_budget === 0) return { decision: "skip", reason: "no_capacity_skips", why: "no skipped row says over MAX_PER_SWEEP or subrequest budget" };
  if (summary.pending_not_measured_today === 0) return { decision: "skip", reason: "all_capacity_skips_measured_today", why: "every row skipped for capacity was already measured today, so another sweep would only re-measure" };
  if (kicksToday >= MAX_KICKS_PER_DAY) return { decision: "skip", reason: "daily_cap_reached", why: "this Worker has already called POST /sweep " + kicksToday + " times today (cap " + MAX_KICKS_PER_DAY + ")" };
  if (!tokenConfigured) return { decision: "record_only", reason: "token_not_configured", why: "SWEEP_ONLY_TOKEN is not set on this Worker, so it cannot call POST /sweep" };
  return { decision: "kick", reason: "capacity_skips_today", why: summary.pending_not_measured_today + " row(s) skipped for capacity today and not yet measured today" };
}

function gateFetch(env, path, init) {
  const req = new Request(GATE_ORIGIN + path, init);
  // GATE_VIA "binding" sends the request over the service binding GATE (no public hop). The default is the public URL,
  // so the gate's sweep runs in a request of its own with its own subrequest allowance (see README, "binding or URL").
  if (env && env.GATE_VIA === "binding" && env.GATE && typeof env.GATE.fetch === "function") return env.GATE.fetch(req);
  const f = (env && env.__fetch) || fetch;
  return f(req);
}

function baseHeaders() {
  // x-hs-requester: operator is the gate's own way for its operator to say "this is us" (requesterClass in the gate).
  // The gate does not count /sweep/last or POST /sweep in /usage today; the header keeps it that way if it ever does.
  return { "user-agent": USER_AGENT, accept: "application/json", "x-hs-requester": "operator" };
}

export async function readSweepLast(env) {
  let res;
  try { res = await gateFetch(env, "/sweep/last", { method: "GET", headers: baseHeaders(), signal: AbortSignal.timeout(GET_TIMEOUT_MS) }); }
  catch (e) { return { readable: false, http: 0, body: null, error: "fetch_failed: " + String((e && e.message) || e).slice(0, 120) }; }
  let body = null;
  try { body = await res.json(); } catch (_e) { body = null; }
  if (res.status !== 200 || !body || typeof body !== "object") {
    return { readable: false, http: res.status, body: null, error: body && typeof body.error === "string" ? body.error.slice(0, 80) : "not_json_or_not_200" };
  }
  return { readable: true, http: res.status, body, error: null };
}

// Only the budget rows can need /history, and only when they alone decide the call: the sweep is from today and ran,
// no over MAX_PER_SWEEP row is still pending, a budget row is, and calls are left today.
export function needsHistory(summary, kicksToday) {
  return !!(summary && summary.is_today && summary.ran === true && kicksToday < MAX_KICKS_PER_DAY &&
    summary.skipped_budget > 0 && summary.pending_not_measured_today === summary.skipped_budget);
}

// GET /history?endpoint= for up to MAX_HISTORY_READS budget rows. Public, no token; the gate does not count it in
// /usage (its /history handler calls none of its counters). "today" when the last record's at is from today,
// "earlier" when it is from before (or there is no record), "unknown" when it could not be read or was beyond the cap.
export async function readBudgetHistories(env, sl, today) {
  const rows = (Array.isArray(sl && sl.skipped) ? sl.skipped : [])
    .filter((s) => s && typeof s.endpoint === "string" && String(s.reason || "").startsWith(REASON_BUDGET));
  const seen = new Map();
  const stats = { rows: rows.length, read: 0, today: 0, earlier: 0, unknown: 0, cap: MAX_HISTORY_READS };
  for (const [i, s] of rows.entries()) {
    let v = "unknown";
    if (i < MAX_HISTORY_READS) {
      stats.read++;
      try {
        const res = await gateFetch(env, "/history?endpoint=" + encodeURIComponent(s.endpoint), { method: "GET", headers: baseHeaders(), signal: AbortSignal.timeout(GET_TIMEOUT_MS) });
        let body = null;
        try { body = await res.json(); } catch (_e) { body = null; }
        if (res.status === 200 && body && Array.isArray(body.entries)) {
          const last = body.entries.length ? String((body.entries[body.entries.length - 1] || {}).at || "") : "";
          v = last.slice(0, 10) === today ? "today" : "earlier";
        }
      } catch (_e) { v = "unknown"; }
    }
    seen.set(s.endpoint, v);
    stats[v]++;
  }
  return { seen, stats };
}

export function summarizePost(status, body, today) {
  const out = { attempted: true, http: status, ran: null, at: null, measured: null, error: null, skipped_over_max: null, skipped_budget: null, pending_not_measured_today: null };
  if (body && typeof body === "object") {
    out.ran = body.ran === true ? true : body.ran === false ? false : null;
    out.at = typeof body.at === "string" ? body.at : null;
    out.measured = typeof body.measured === "number" ? body.measured : null;
    out.error = typeof body.error === "string" ? body.error.slice(0, 80) : null;
    if (Array.isArray(body.skipped)) {
      const s = summarizeSweep(body, today);
      out.skipped_over_max = s.skipped_over_max;
      out.skipped_budget = s.skipped_budget;
      out.pending_not_measured_today = s.pending_not_measured_today;
    }
  }
  const meaning = { 200: "the gate ran the sweep", 403: "forbidden: the gate did not accept this Worker's SWEEP_ONLY_TOKEN", 409: "another sweep held the gate's lease", 503: "the gate has no SWEEP_TOKEN or its sweep lease was unavailable" };
  out.meaning = meaning[status] || (status === 0 ? "no answer (network error or timeout)" : "unexpected status");
  out.retried = false;
  return out;
}

export async function postSweep(env, today) {
  let res;
  try {
    res = await gateFetch(env, "/sweep", {
      method: "POST",
      headers: Object.assign(baseHeaders(), { "content-type": "application/json", "x-sweep-token": sweepToken(env) }),
      body: "{}",
      signal: AbortSignal.timeout(POST_TIMEOUT_MS)
    });
  } catch (e) {
    const s = summarizePost(0, null, today);
    s.error = "fetch_failed: " + String((e && e.message) || e).slice(0, 120);
    return s;
  }
  let body = null;
  try { body = await res.json(); } catch (_e) { body = null; }
  return summarizePost(res.status, body, today);
}

// Belt and braces: nothing above copies the token, but if a summary ever did, it is cut out before it is stored or served.
export function redact(text, env) {
  let out = String(text);
  for (const t of [sweepToken(env), env && typeof env.SWEEP_TOKEN === "string" ? env.SWEEP_TOKEN : ""]) if (t.length >= 4) out = out.split(t).join("[redacted]");
  return out;
}

export async function runOnce(env, scheduledTime, cron) {
  const now = Number.isFinite(scheduledTime) ? scheduledTime : Date.now();
  const today = utcDay(now);
  let log;
  try { log = await readDayLog(env, today); }
  catch (e) {
    console.error("hs-sweep-kicker: " + e.message + " (" + String(e.cause || "") + "); no call, nothing written");
    return { decision: "record_only", reason: "kicker_log_unreadable", wrote: false };
  }
  const kicksToday = kicksIn(log);
  const sl = await readSweepLast(env);
  let summary = sl.readable ? summarizeSweep(sl.body, today) : null;
  let budgetHistory = null;
  if (sl.readable && needsHistory(summary, kicksToday)) {
    const h = await readBudgetHistories(env, sl.body, today);
    budgetHistory = h.stats;
    summary = summarizeSweep(sl.body, today, h.seen);
  }
  const d = decide({ readable: sl.readable, http: sl.http, summary: summary || {}, kicksToday, tokenConfigured: !!sweepToken(env) });
  const entry = {
    at: new Date().toISOString(),
    scheduled_at: new Date(now).toISOString(),
    cron: cron || null,
    sweep_last: sl.readable ? Object.assign({ http: sl.http }, summary) : { http: sl.http, readable: false, error: sl.error },
    budget_history: budgetHistory,   // counts only (rows, read, today, earlier, unknown, cap); null when not needed
    kicks_before: kicksToday,
    decision: d.decision,
    reason: d.reason,
    why: d.why,
    post: null
  };
  if (d.decision === "kick") entry.post = await postSweep(env, today);
  // Read again just before writing, so an entry written meanwhile is kept. A failed re-read writes nothing.
  let cur;
  try { cur = await readDayLog(env, today); }
  catch (e) {
    console.error("hs-sweep-kicker: log re-read failed, entry not stored: " + redact(JSON.stringify(entry), env));
    return Object.assign({ wrote: false }, entry);
  }
  const next = cur || { schema: "hs-sweep-kicker-log-v1", day: today, entries: [] };
  next.entries.push(entry);
  try { await env.KICK_LOG.put(logKey(today), redact(JSON.stringify(next), env), { expirationTtl: LOG_TTL_SECONDS }); }
  catch (e) { console.error("hs-sweep-kicker: log write failed: " + redact(JSON.stringify(entry), env)); return Object.assign({ wrote: false }, entry); }
  console.log("hs-sweep-kicker: " + d.decision + " " + d.reason + (entry.post ? " http " + entry.post.http : ""));
  return Object.assign({ wrote: true }, entry);
}

function json(obj, status, env) {
  return new Response(redact(JSON.stringify(obj, null, 2), env), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" }
  });
}

export function describe(env) {
  return {
    name: "hs-sweep-kicker",
    version: VERSION,
    what: "Reads the verify gate's /sweep/last after its daily 18:00 UTC sweep and, only when that sweep is from today and left rows skipped for capacity (over MAX_PER_SWEEP or subrequest budget) that were not measured today, calls the gate's POST /sweep, at most " + MAX_KICKS_PER_DAY + " times a UTC day. Never retries. Since 0.2.0 it has no cron: gate 0.4.21 sweeps four times a day itself. It calls only with SWEEP_ONLY_TOKEN.",
    gate: GATE_ORIGIN,
    crons_utc: CRONS,
    log: "/log?day=YYYY-MM-DD (UTC day; every decision and result of that day, without the token or any header)",
    user_agent: USER_AGENT,
    token_configured: !!sweepToken(env),
    token_name: "SWEEP_ONLY_TOKEN",
    log_bound: !!(env && env.KICK_LOG),
    gate_via: env && env.GATE_VIA === "binding" ? "service binding GATE" : "public URL",
    source: "https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/workers/hs-sweep-kicker"
  };
}

export default {
  async scheduled(event, env, ctx) {
    const p = runOnce(env, event && event.scheduledTime, event && event.cron).catch((e) => console.error("hs-sweep-kicker: run failed: " + String((e && e.message) || e)));
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p); else await p;
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method_not_allowed", allowed: ["GET"] }, 405, env);
    if (url.pathname === "/" || url.pathname === "/health") return json(describe(env), 200, env);
    if (url.pathname === "/log") {
      const day = url.searchParams.get("day") || utcDay(Date.now());
      if (!DAY_RE.test(day)) return json({ error: "bad_day", usage: "/log?day=YYYY-MM-DD" }, 400, env);
      let log;
      try { log = await readDayLog(env, day); }
      catch (e) { return json({ error: "log_read_failed", day, note: "The log for this day could not be read (storage error). This is NOT a statement that nothing happened that day." }, 503, env); }
      if (!log) return json({ schema: "hs-sweep-kicker-log-v1", day, entries: [], note: "No entry for this day: no cron of this Worker ran that day, or the day is outside the 400 days kept." }, 200, env);
      return json(log, 200, env);
    }
    if (url.pathname === "/probe") {
      // Reads /sweep/last once over the configured path and says whether it was readable. No POST, nothing stored.
      // Used right after a deploy to confirm the gate can be reached from here.
      const sl = await readSweepLast(env);
      const today = utcDay(Date.now());
      return json({ probe: true, wrote_nothing: true, gate_via: describe(env).gate_via, readable: sl.readable, http: sl.http, error: sl.error, sweep_last: sl.readable ? summarizeSweep(sl.body, today) : null }, 200, env);
    }
    return json({ error: "not_found", endpoints: ["/", "/health", "/log?day=YYYY-MM-DD", "/probe"] }, 404, env);
  }
};
