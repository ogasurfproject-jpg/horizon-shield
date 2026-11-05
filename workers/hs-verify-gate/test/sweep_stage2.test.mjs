// sweep_stage2 (0.4.21, 2026-10-23): the sweep measures the whole due list of a day by itself.
//
// Why. Until 0.4.20 the gate swept once a day (18:00Z) with MAX_PER_SWEEP 8 and a fetch budget of 50, copies of the
// Workers Free limits. On 2026-10-22 18 rows were due and 7 were measured; all 9 self rows were "over MAX_PER_SWEEP".
// 0.4.21: a row measured this UTC day is left out of due (except force); due rows go paid, then self, then free, least
// recently measured first within a tier; four crons a day (each continues where the last left off); every run of a day
// is appended to sweep:day:<day> and GET /sweep/day says whether the day is complete; a paid row beyond what can be
// measured daily is refused with 409; a sweep-only key (SWEEP_ONLY_TOKEN) can ask for a sweep and nothing else; the
// gate's own sweeps measuring its own /mcp are not counted in /usage. The seats, budget and wall cap live in one place.
//
// Offline: *.redteam.invalid never resolves, explorers and the ledger are stubbed to fail (legacy coordinate rule).
// The last section measures CPU, subrequests and KV calls per measured row on this machine and prints them (the
// numbers in REPORT.md come from here); it asserts only loose bounds, because Node on a laptop is not workerd.
// Run: node test/sweep_stage2.test.mjs   (in workers/hs-verify-gate)
import worker, { _sweepStage2 as S } from "../src/worker.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OP = "op-token-stage2";
const SWO = "sweep-only-token-stage2";
const O = "https://gate.horizonshield.dev";
const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const jres = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
const TOOL = { name: "alpha", description: "redteam tool alpha", inputSchema: { type: "object", properties: {} } };
const CARD = { name: "Redteam Agent", description: "an adversarial mock", url: "",
  compensation: { paid_by: "public", referral_fee: false, listing_fee: false, success_fee_pct: 0, disclosure_url: "https://example.invalid/disclosure" } };

function kv() {
  const store = new Map();
  const k = {
    store, ops: { get: 0, put: 0, list: 0, delete: 0 }, failGet: [], failPut: [],
    get: async (key, type) => {
      k.ops.get++;
      if (k.failGet.some((p) => key.startsWith(p))) throw new Error("KV get failed (simulated)");
      const v = store.has(key) ? store.get(key) : null;
      return ((type === "json" || (type && type.type === "json")) && v !== null) ? JSON.parse(v) : v;
    },
    put: async (key, v) => {
      k.ops.put++;
      if (k.failPut.some((p) => key.startsWith(p))) throw new Error("KV put failed (simulated)");
      store.set(key, typeof v === "string" ? v : JSON.stringify(v));
    },
    delete: async (key) => { k.ops.delete++; store.delete(key); },
    list: async (o) => { k.ops.list++; return { keys: [...store.keys()].filter((x) => x.startsWith((o && o.prefix) || "")).sort().map((name) => ({ name })), list_complete: true }; },
  };
  return k;
}

// The outside world. Every fetch is logged with the headers it carried.
const FETCH_LOG = [];
const RELAYED = [];            // what the relay was asked to fetch, with the headers it would forward
let RELAY_ENV = null;          // the env the relay forwards gate calls into (the gate's own env)
let onMcp = null;              // hook: called with (hostname, method) on every MCP call to a redteam host
const relayAnswer = async (init) => {
  const b = JSON.parse(init.body);
  const u = new URL(b.url);
  RELAYED.push({ host: u.hostname, path: u.pathname, headers: Object.assign({}, b.headers || {}) });
  let res;
  if (u.hostname === "gate.horizonshield.dev") {
    // The public edge in front of the gate: the call arrives as an HTTP request with a client IP and the forwarded headers.
    res = await worker.fetch(new Request(b.url, { method: b.method, headers: { ...(b.headers || {}), "cf-connecting-ip": "198.51.100.7" }, body: b.method === "POST" ? b.body : undefined }), RELAY_ENV, CTX);
  } else {
    res = await outside(b.url, { method: b.method, headers: b.headers, body: b.body });
  }
  return jres({ relayed: true, status: res.status, headers: { "content-type": res.headers.get("content-type") || "" }, body: await res.text() });
};
async function outside(url, init) {
  const u = new URL(url);
  if (/\.redteam\.invalid$/.test(u.hostname) || /\.horizonshield\.dev$/.test(u.hostname)) {
    if (u.pathname === "/.well-known/mcp-conduct.json") return jres(/^declined\./.test(u.hostname) ? { allow_tool_call: true, listing: "decline" } : { allow_tool_call: true });
    if (u.pathname === "/.well-known/agent-card.json") return jres(CARD);
    if (u.pathname === "/mcp" && (init && init.method) === "POST") {
      const body = JSON.parse(init.body); const id = body.id;
      if (onMcp) onMcp(u.hostname, body.method);
      if (body.method === "initialize") return jres({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "rt", version: "0" }, capabilities: { tools: {} } } });
      if (body.method === "tools/list") return jres({ jsonrpc: "2.0", id, result: { tools: [TOOL] } });
      if (body.method === "tools/call") return jres({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "constant answer" }] } });
      return jres({ jsonrpc: "2.0", id, error: { code: -32601, message: "nope" } });
    }
    return new Response("not found", { status: 404 });
  }
  return new Response("no", { status: 500 });   // explorers, ledger, raw github: fail closed
}
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  FETCH_LOG.push({ host: u.hostname, path: u.pathname, headers: Object.assign({}, (init && init.headers) || {}) });
  if (u.hostname === "relay.redteam.invalid") return relayAnswer(init);
  return outside(url, init);
};

function freshEnv(extra) {
  const env = Object.assign({ HS_VERIFY_KV: kv(), SWEEP_TOKEN: OP, SWEEP_ONLY_TOKEN: SWO, GATE_COMMIT: "stage2-local" }, extra || {});
  const call = (p, init) => worker.fetch(new Request(O + p, init), env, CTX);
  const post = (p, body, headers) => call(p, { method: "POST", headers: { "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) });
  const sweep = (body, token) => post("/sweep", body || {}, { "x-sweep-token": token || OP }).then(async (r) => ({ status: r.status, j: await r.json() }));
  const cron = async () => { const ps = []; await worker.scheduled({ cron: "0 19 * * *" }, env, { waitUntil(p) { ps.push(Promise.resolve(p).catch(() => null)); } }); await Promise.all(ps); };
  const day = (d) => call("/sweep/day" + (d ? "?day=" + d : "")).then(async (r) => ({ status: r.status, j: await r.json() }));
  return { env, call, post, sweep, cron, day };
}
const TODAY = new Date().toISOString().slice(0, 10);
const SELF = ["mcp", "hearing", "web", "jidec", "p001", "p002", "gate", "femtech", "ccdb"].map((h) => "https://" + h + ".horizonshield.dev/mcp");

const R = [];
const t = (kind, name, ok, detail = "") => R.push({ kind, name, ok: !!ok, detail: String(detail).slice(0, 400) });

// ---- 1. one named place for the numbers, and the crons match wrangler.jsonc ---------------------------------
{
  const src = readFileSync(path.join(HERE, "..", "wrangler.jsonc"), "utf8");
  const m = /"crons"\s*:\s*(\[[^\]]*\])/.exec(src);
  const crons = m ? JSON.parse(m[1]) : null;
  t("control", "1 wrangler.jsonc triggers.crons is exactly SWEEP_CRONS (one place decides the schedule)", JSON.stringify(crons) === JSON.stringify(S.SWEEP_CRONS), JSON.stringify([crons, S.SWEEP_CRONS]));
  const mins = S.SWEEP_CRONS.map((c) => { const [mi, h] = c.split(" ").map(Number); return h * 60 + mi; });
  const gaps = mins.slice(1).map((x, i) => x - mins[i]);
  t("control", "1 four runs a day, the first at 18:00 UTC, every gap at least 60 minutes (Workers Paid: a Cron of interval 1 hour or more gets 15 min CPU)",
    S.SWEEP_RUNS_PER_DAY === 4 && S.SWEEP_CRONS[0] === "0 18 * * *" && gaps.every((g) => g >= 60) && S.SWEEP_CRONS.every((c) => / \* \* \*$/.test(c)), JSON.stringify(gaps));
  const worst = S.MAX_PER_SWEEP * 7 + S.SUBREQUEST_WINDOW_OVERHEAD;
  t("control", "1 a full run at the measured 7 fetches a row stays under a third of the fetch budget (" + worst + " of " + S.SUBREQUEST_BUDGET_DEFAULT + "), and the budget is a tenth of the Paid 10,000",
    worst * 3 <= S.SUBREQUEST_BUDGET_DEFAULT && S.SUBREQUEST_BUDGET_DEFAULT <= 1000, worst);
  t("control", "1 the wall cap leaves at least 5 minutes of the 15 minute Cron wall time for the last row and the writes", S.SWEEP_WALL_BUDGET_MS <= 10 * 60 * 1000, S.SWEEP_WALL_BUDGET_MS);
  t("control", "1 seats per run are MAX_PER_SWEEP when the budget allows it", S.sweepSeatsPerRun({}) === S.MAX_PER_SWEEP && S.sweepSeatsPerRun({ SUBREQUEST_BUDGET: 50 }) === 6, [S.sweepSeatsPerRun({}), S.sweepSeatsPerRun({ SUBREQUEST_BUDGET: 50 })]);
  const wsrc = readFileSync(path.join(HERE, "..", "src", "worker.js"), "utf8");
  t("attack", "1 the old Free numbers are gone from the code paths (no '= 50' budget default, no 'Workers Free allows 50' note)", !/SUBREQUEST_BUDGET_DEFAULT = 50/.test(wsrc) && !/Workers Free allows 50 fetches/.test(wsrc), "");
}

// ---- 2. a row measured today is left alone; force re-measures -----------------------------------------------
{
  const { env, post, sweep } = freshEnv();
  const EP = "https://a.redteam.invalid/mcp";
  await post("/watch", { endpoint: EP, tier: "paid" }, { "x-sweep-token": OP });   // paid: due every day (a free row is due on its HMAC day only)
  const s1 = await sweep({ force: true });
  const m1 = s1.j.results.map((r) => r.endpoint);
  t("control", "2 a forced sweep measures every row (force ignores the day rule)", s1.status === 200 && m1.includes(EP) && s1.j.results.length === 10, JSON.stringify([s1.status, m1.length]));
  const s2 = await sweep({});
  const left = s2.j.skipped.filter((x) => /^already measured today/.test(x.reason)).map((x) => x.endpoint);
  t("attack", "2 the next normal run the same UTC day measures none of them again (courtesy: once a day)", s2.j.results.length === 0 && SELF.every((e) => left.includes(e)), JSON.stringify([s2.j.results.length, left.length]));
  t("control", "2 the skip says why and that it is not a capacity skip (kicker 0.1.1 and coverage.mjs read reasons by their first words)", left.length && s2.j.skipped.filter((x) => /^already measured today/.test(x.reason)).every((x) => /Not a capacity skip/.test(x.reason) && !/^over MAX_PER_SWEEP|^subrequest budget/.test(x.reason)), "");
  t("control", "2 sweep:last says how many were already measured today", s2.j.already_measured_today === 10, s2.j.already_measured_today);
  const s3 = await sweep({ force: true });
  t("control", "2 an operator's force still re-measures (the old behaviour, kept for the operator)", s3.j.results.length === 10, s3.j.results.length);
  // A history that cannot be read: the row is measured (unknown is not 'already measured') and the record says so.
  env.HS_VERIFY_KV.failGet = ["hist:"];
  const s4 = await sweep({});
  env.HS_VERIFY_KV.failGet = [];
  t("control", "2 when a row's history cannot be read, the run does not assume it was measured today; it is listed in history_unreadable", Array.isArray(s4.j.history_unreadable) && s4.j.history_unreadable.length === 10 && s4.j.results.length === 10, JSON.stringify([s4.j.history_unreadable && s4.j.history_unreadable.length, s4.j.results.length]));
}

// ---- 3. order: paid, then self, then free; least recently measured first within a tier ----------------------
{
  const { env, post, sweep } = freshEnv();
  const FREE = ["https://f1.redteam.invalid/mcp", "https://f2.redteam.invalid/mcp"];
  const PAID = ["https://p1.redteam.invalid/mcp", "https://p2.redteam.invalid/mcp"];
  for (const e of FREE) await post("/watch", { endpoint: e });
  for (const e of PAID) await post("/watch", { endpoint: e, tier: "paid" }, { "x-sweep-token": OP });
  // Older history for f2, p2 and ccdb, newer for the rest, so within a tier the older goes first.
  const hk = async (e) => "hist:" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(e)))].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
  const put = async (e, at) => env.HS_VERIFY_KV.store.set(await hk(e), JSON.stringify({ endpoint: e, entries: [{ at, status: "pending" }] }));
  for (const e of [...FREE, ...PAID, ...SELF]) await put(e, "2026-10-20T18:00:00.000Z");
  for (const e of [FREE[1], PAID[1], SELF[8]]) await put(e, "2026-10-01T18:00:00.000Z");
  const s = await sweep({ force: true });
  const order = s.j.results.map((r) => r.endpoint);
  const tiers = s.j.results.map((r) => r.tier);
  t("control", "3 results come paid, then self, then free", tiers.join(",") === ["paid", "paid", ...SELF.map(() => "self"), "free", "free"].join(","), tiers.join(","));
  t("control", "3 within each tier the least recently measured goes first (p2 before p1, ccdb first of self, f2 before f1)", order[0] === PAID[1] && order[1] === PAID[0] && order[2] === SELF[8] && order[order.length - 2] === FREE[1] && order[order.length - 1] === FREE[0], JSON.stringify(order));
  // With a budget for 3 rows: the paid rows take their seats first, the free rows wait, and the reason names the order.
  const { env: e2, post: p2, sweep: sw2 } = freshEnv();
  for (const e of FREE) await p2("/watch", { endpoint: e });
  for (const e of PAID) await p2("/watch", { endpoint: e, tier: "paid" }, { "x-sweep-token": OP });
  e2.SUBREQUEST_BUDGET = 9 + 6 * 3;   // narrowed after the paid rows were admitted (with 3 seats a run they would be refused, section 5)
  const b = await sw2({ force: true });
  const measuredTiers = b.j.results.map((r) => r.tier);
  t("attack", "3 when seats run short, paid rows are measured before self and free (a paid row is never pushed out by a free one)", measuredTiers.slice(0, 2).every((x) => x === "paid") && !b.j.results.some((r) => r.tier === "free"), JSON.stringify(measuredTiers));
  const over = b.j.skipped.filter((x) => /^over MAX_PER_SWEEP|^subrequest budget/.test(x.reason));
  t("control", "3 every row that did not get a seat is in skipped with a capacity reason", over.length >= 1 && FREE.every((f) => over.some((x) => x.endpoint === f)), JSON.stringify(over.map((x) => [x.endpoint, x.reason.slice(0, 20)])));
}

// ---- 4. four runs continue where the last left off; sweep:day and GET /sweep/day ----------------------------
{
  // 12 rows due every day (9 self, 3 paid; a free row is due on its HMAC day only) and a budget of 4 rows a run, so the
  // day needs several runs. The budget is narrowed after the paid rows are admitted (section 5 would refuse them).
  const { env, post, sweep, cron, day } = freshEnv();
  const PAID = ["https://q1.redteam.invalid/mcp", "https://q2.redteam.invalid/mcp", "https://q3.redteam.invalid/mcp"];
  for (const e of PAID) await post("/watch", { endpoint: e, tier: "paid" }, { "x-sweep-token": OP });
  env.SUBREQUEST_BUDGET = 9 + 6 * 4 + 5;
  const d0 = await day();
  t("control", "4 before any run the day reads recorded false and complete false (nothing says the rows were measured)", d0.status === 200 && d0.j.recorded === false && d0.j.complete === false, JSON.stringify(d0.j).slice(0, 160));
  await cron();
  const d1 = await day();
  t("control", "4 after the first cron the day holds one run, trigger cron, key class cron, and is not complete", d1.j.run_count === 1 && d1.j.runs[0].trigger === "cron" && d1.j.runs[0].key_class === "cron" && d1.j.complete === false && d1.j.missing.length > 0, JSON.stringify([d1.j.run_count, d1.j.complete, d1.j.missing && d1.j.missing.length]));
  const firstMeasured = new Set(d1.j.runs[0].measured.map((m) => m.endpoint));
  await cron();
  const d2 = await day();
  const secondMeasured = d2.j.runs[1].measured.map((m) => m.endpoint);
  t("attack", "4 the second cron measures rows the first did not, and none of the first run's rows again", secondMeasured.length > 0 && secondMeasured.every((e) => !firstMeasured.has(e)), JSON.stringify(secondMeasured));
  const s3 = await sweep({}, SWO);
  await cron();
  const d4 = await day();
  t("control", "4 after enough runs every due row of the day is measured: complete true, missing empty", d4.j.complete === true && d4.j.missing.length === 0 && d4.j.due_count === 12 && d4.j.measured_count === 12, JSON.stringify([d4.j.complete, d4.j.missing, d4.j.due_count, d4.j.measured_count]));
  t("control", "4 every run of the day is appended in order, with its trigger and key class (cron, cron, post sweep_only, cron)", d4.j.runs.map((r) => r.trigger + "/" + r.key_class).join(",") === "cron/cron,cron/cron,post/sweep_only,cron/cron", d4.j.runs.map((r) => r.trigger + "/" + r.key_class).join(","));
  t("attack", "4 no key value is written in sweep:day or sweep:last (only the class)", ![...env.HS_VERIFY_KV.store.values()].some((v) => v.includes(OP) || v.includes(SWO)), "");
  const raw = JSON.parse(env.HS_VERIFY_KV.store.get(S.SWEEP_DAY_PREFIX + TODAY));
  t("control", "4 the record is sweep:day:<UTC day> with schema hs-sweep-day-v1", raw && raw.schema === "hs-sweep-day-v1" && raw.day === TODAY && raw.runs.length === 4, JSON.stringify(Object.keys(raw || {})));
  t("control", "4 a sweep that measured something says so in sweep:last day_record (written, runs n)", s3.j.day_record && s3.j.day_record.written === true && s3.j.day_record.runs === 3, JSON.stringify(s3.j.day_record));
  // read failure of the day: 503 read_failed, never an empty day
  env.HS_VERIFY_KV.failGet = [S.SWEEP_DAY_PREFIX];
  const df = await day();
  t("attack", "4 a failed read of the day answers 503 read_failed with complete null, not recorded false", df.status === 503 && df.j.read_failed === true && df.j.complete === null && df.j.runs === null, JSON.stringify(df.j).slice(0, 200));
  // and a run that cannot read the day does not overwrite it with itself
  const before = env.HS_VERIFY_KV.store.get(S.SWEEP_DAY_PREFIX + TODAY);
  const sf = await sweep({ force: true });
  env.HS_VERIFY_KV.failGet = [];
  t("attack", "4 a run that cannot read the day's record writes nothing to it (the earlier runs are not replaced by this one) and says so", env.HS_VERIFY_KV.store.get(S.SWEEP_DAY_PREFIX + TODAY) === before && sf.j.day_record && sf.j.day_record.written === false && sf.j.day_record.reason === "read_failed", JSON.stringify(sf.j.day_record));
  const bad = await day("2026-13-40");
  t("control", "4 a day that is not YYYY-MM-DD is 400", bad.status === 400, bad.status);
  const old = await day("2026-01-01");
  t("control", "4 a day with no record answers recorded false (200), not complete", old.status === 200 && old.j.recorded === false && old.j.complete === false, JSON.stringify(old.j).slice(0, 120));
}

// ---- 4b. complete: excused rows and a register that could not be read ---------------------------------------
{
  const sum = S.summarizeSweepDay("2026-10-28", { schema: "hs-sweep-day-v1", runs: [
    { at: "a", due: [{ endpoint: "x", tier: "self" }, { endpoint: "y", tier: "free" }], measured: [{ endpoint: "x" }], excused: [{ endpoint: "y", reason_code: "owner_declined" }], already_measured_today: [] } ] });
  t("control", "4b a row excused (owner declined) does not make the day incomplete", sum.complete === true && sum.missing.length === 0 && sum.excused.length === 1, JSON.stringify(sum.missing));
  const sum2 = S.summarizeSweepDay("2026-10-28", { runs: [ { at: "a", registry_read_failed: true, due: [], measured: [], excused: [], already_measured_today: [] } ] });
  t("attack", "4b a day whose run could not read the register is never complete (its due list is unknown)", sum2.complete === false && sum2.registry_read_failed_in_a_run === true, JSON.stringify(sum2).slice(0, 160));
  const sum3 = S.summarizeSweepDay("2026-10-28", { runs: [ { at: "a", due: [{ endpoint: "z", tier: "self" }], measured: [], errors: [{ endpoint: "z", error: "relay unavailable" }], excused: [], already_measured_today: [] } ] });
  t("attack", "4b a row whose measurement threw is missing, with its error (an error is not a measurement)", sum3.complete === false && sum3.missing.length === 1 && /relay/.test(sum3.missing[0].last_error), JSON.stringify(sum3.missing));
}

// ---- 4c. an owner who declines is excused, and the day can still be complete -------------------------------
{
  const { post, sweep, day } = freshEnv();
  await post("/watch", { endpoint: "https://declined.redteam.invalid/mcp", tier: "paid" }, { "x-sweep-token": OP });
  await sweep({});
  const d = await day();
  t("control", "4c a due row whose owner declines measurement is listed as excused (owner_declined), not missing, and the day is complete", d.j.complete === true && d.j.excused.some((e) => e.endpoint === "https://declined.redteam.invalid/mcp" && e.reason_code === "owner_declined") && d.j.missing.length === 0, JSON.stringify([d.j.complete, d.j.excused, d.j.missing]));
}

// ---- 5. paid capacity: 409 when another paid row could not be measured daily -------------------------------
{
  const cap0 = S.paidCapacity({}, 9, 33);
  t("control", "5 the formula with the default numbers and 2026-10-22's register (self 9, free 33): (4 - 1) x 40 - 9 - ceil(33 x 2 / 7) = 101", cap0.capacity === 101 && cap0.seats_per_day === 120 && cap0.free_reserve === 10, JSON.stringify(cap0));
  // A budget of 3 seats a run: (4 - 1) x 3 = 9 seats a day, minus 9 self rows = 0 paid rows.
  const { post } = freshEnv({ SUBREQUEST_BUDGET: 9 + 6 * 3 });
  const r = await post("/watch", { endpoint: "https://full.redteam.invalid/mcp", tier: "paid" }, { "x-sweep-token": OP });
  const j = await r.json();
  t("attack", "5 a paid row beyond the daily capacity is refused with 409 paid_capacity_full and the formula", r.status === 409 && j.error === "paid_capacity_full" && j.capacity === 0 && /capacity = /.test(j.formula), JSON.stringify([r.status, j.error, j.capacity]));
  // A budget of 4 seats a run: 12 seats a day - 9 self = 3 paid rows. Free rows reserve ceil(n x 2 / 7).
  const env4 = freshEnv({ SUBREQUEST_BUDGET: 9 + 6 * 4 });
  const codes = [];
  for (const n of [1, 2, 3, 4]) codes.push((await env4.post("/watch", { endpoint: "https://pp" + n + ".redteam.invalid/mcp", tier: "paid" }, { "x-sweep-token": OP })).status);
  t("control", "5 with 3 paid seats, three paid rows are accepted and the fourth is 409", codes.join(",") === "200,200,200,409", codes.join(","));
  const upd = await env4.post("/watch", { endpoint: "https://pp1.redteam.invalid/mcp", tier: "paid", webhook: null }, { "x-sweep-token": OP });
  t("control", "5 updating an existing paid row is not refused (it already holds its seat)", upd.status === 200, upd.status);
  const free = await env4.post("/watch", { endpoint: "https://free9.redteam.invalid/mcp" });
  t("control", "5 a free row is still accepted when paid seats are full", free.status === 200 && (await free.json()).tier === "free", free.status);
  const { env: e5, post: p5 } = freshEnv();
  e5.HS_VERIFY_KV.failGet = ["watch:"];
  const rf = await p5("/watch", { endpoint: "https://rf.redteam.invalid/mcp", tier: "paid" }, { "x-sweep-token": OP });
  t("attack", "5 when the register cannot be read the paid registration is 503, not admitted", rf.status === 503, rf.status);
}

// ---- 6. SWEEP_ONLY_TOKEN asks for a sweep and nothing else --------------------------------------------------
{
  const { env, call, post, sweep } = freshEnv();
  const a = await sweep({}, SWO);
  t("control", "6 POST /sweep with the sweep-only key runs (200) and the run is recorded as key_class sweep_only", a.status === 200 && a.j.ran === true && a.j.key_class === "sweep_only" && a.j.trigger === "post", JSON.stringify([a.status, a.j.key_class]));
  const b = await sweep({}, OP);
  t("control", "6 POST /sweep with the operator key runs and is recorded as key_class operator", b.status === 200 && b.j.key_class === "operator", JSON.stringify([b.status, b.j.key_class]));
  const f = await sweep({ force: true }, SWO);
  t("attack", "6 the sweep-only key cannot force (403 force_needs_operator_key, nothing ran)", f.status === 403 && f.j.error === "force_needs_operator_key", JSON.stringify([f.status, f.j.error]));
  const w = await sweep({}, "wrong");
  t("attack", "6 a wrong key is 403", w.status === 403, w.status);
  const H = { "x-sweep-token": SWO };
  const paid = await (await post("/watch", { endpoint: "https://swo.redteam.invalid/mcp", tier: "paid" }, H)).json();
  t("attack", "6 the sweep-only key is not the operator on /watch (tier paid is ignored, requested_by anonymous)", paid.tier === "free" && paid.requested_by === "anonymous", JSON.stringify([paid.tier, paid.requested_by]));
  const q = await post("/register/quarantine", { endpoint: "https://swo.redteam.invalid/mcp", proposal_sha256: "00".repeat(32), reason: "x" }, H);
  t("attack", "6 the sweep-only key cannot quarantine (403)", q.status === 403, q.status);
  const del = await call("/watch", { method: "DELETE", headers: { "content-type": "application/json", ...H }, body: JSON.stringify({ endpoint: "https://swo.redteam.invalid/mcp", reason: "x" }) });
  t("attack", "6 the sweep-only key cannot remove a row (403)", del.status === 403, del.status);
  const mo = await post("/mould", { x: 1 }, H);
  t("attack", "6 the sweep-only key cannot write a mould record (403)", mo.status === 403, mo.status);
  const np = await call("/nenrin/probe", { headers: H });
  t("attack", "6 the sweep-only key cannot use the beacon probe (403)", np.status === 403, np.status);
  // only the sweep-only key configured
  const only = freshEnv({ SWEEP_TOKEN: undefined });
  const o1 = await only.sweep({}, SWO);
  t("control", "6 with only SWEEP_ONLY_TOKEN set, POST /sweep still runs with it", o1.status === 200 && o1.j.key_class === "sweep_only", JSON.stringify([o1.status, o1.j.key_class]));
  const o2 = await only.sweep({}, "");
  t("attack", "6 with only SWEEP_ONLY_TOKEN set, an empty key is 403 (an unset key never matches)", o2.status === 403, o2.status);
  const none = freshEnv({ SWEEP_TOKEN: undefined, SWEEP_ONLY_TOKEN: undefined });
  const n1 = await none.sweep({}, "");
  t("control", "6 with neither key set POST /sweep is 503 sweep_token_not_configured", n1.status === 503 && n1.j.error === "sweep_token_not_configured", JSON.stringify([n1.status, n1.j.error]));
  t("attack", "6 no key value is stored anywhere", ![...env.HS_VERIFY_KV.store.values()].some((v) => v.includes(OP) || v.includes(SWO)), "");
}

// ---- 7. own sweeps are not counted in /usage ----------------------------------------------------------------
{
  const reqCounts = (env) => { const k = "usage:req:" + TODAY; const v = env.HS_VERIFY_KV.store.get(k); return v ? JSON.parse(v).counts : {}; };
  const mark = await S.ownSweepMark({ SWEEP_TOKEN: OP }, Date.now());
  const req = (h) => new Request(O + "/mcp", { method: "POST", headers: h });
  t("control", "7 a fresh mark made with the gate's key is accepted", await S.isOwnSweepRequest(req({ [S.OWN_SWEEP_HEADER]: mark }), { SWEEP_TOKEN: OP }, Date.now()), mark.slice(0, 20));
  t("attack", "7 a mark made with another key is refused", !(await S.isOwnSweepRequest(req({ [S.OWN_SWEEP_HEADER]: mark }), { SWEEP_TOKEN: "other" }, Date.now())), "");
  t("attack", "7 a mark older than 15 minutes is refused", !(await S.isOwnSweepRequest(req({ [S.OWN_SWEEP_HEADER]: mark }), { SWEEP_TOKEN: OP }, Date.now() + 16 * 60 * 1000)), "");
  t("attack", "7 a malformed mark is refused", !(await S.isOwnSweepRequest(req({ [S.OWN_SWEEP_HEADER]: "v1.123.abc" }), { SWEEP_TOKEN: OP }, Date.now())), "");
  t("attack", "7 the mark does not contain the key", !mark.includes(OP), "");
  // A sweep in HTTP context (POST /sweep, as the kicker calls it) measures the gate's own /mcp through the relay.
  const { env, sweep, call, post } = freshEnv({ RELAY_URL: "https://relay.redteam.invalid/relay", RELAY_TOKEN: "relay-token" });
  RELAY_ENV = env;
  await post("/watch", { endpoint: "https://outside7.redteam.invalid/mcp", tier: "paid" }, { "x-sweep-token": OP });
  FETCH_LOG.length = 0; RELAYED.length = 0;
  const s = await sweep({ force: true });
  const gateRow = s.j.results.find((r) => r.endpoint === "https://gate.horizonshield.dev/mcp");
  await new Promise((r) => setTimeout(r, 50));
  const counts = reqCounts(env);
  const mcpCalls = Object.entries(counts).filter(([k]) => k.startsWith("mcp|")).reduce((a, [, v]) => a + v, 0);
  t("control", "7 the sweep measured the gate's own /mcp through the relay (tools/call reached the gate)", gateRow && !gateRow.error && FETCH_LOG.some((f) => f.host === "relay.redteam.invalid"), JSON.stringify(gateRow));
  t("attack", "7 the gate's own sweep left no mcp tools/call in usage:req (0.4.20 counted them as class other)", mcpCalls === 0, JSON.stringify(counts));
  const marked = FETCH_LOG.filter((f) => f.host !== "relay.redteam.invalid" && f.headers && f.headers[S.OWN_SWEEP_HEADER])
    .concat(RELAYED.filter((f) => f.host !== "gate.horizonshield.dev" && f.headers && f.headers[S.OWN_SWEEP_HEADER]));
  const sawOthers = FETCH_LOG.some((f) => f.host === "outside7.redteam.invalid") && RELAYED.some((f) => f.host === "mcp.horizonshield.dev");
  t("attack", "7 the mark is never sent to anyone but the gate itself (not to an outside row fetched directly, not to another own-zone worker through the relay)", sawOthers && marked.length === 0 && RELAYED.some((f) => f.host === "gate.horizonshield.dev" && f.headers[S.OWN_SWEEP_HEADER]), JSON.stringify([sawOthers, marked.map((m) => m.host)]));
  // Control: the same tools/call from outside (no mark, or a forged mark) is counted.
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_conditions", arguments: {} } });
  await call("/mcp", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.50" }, body });
  await call("/mcp", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.51", [S.OWN_SWEEP_HEADER]: "v1." + Math.floor(Date.now() / 1000) + "." + "ab".repeat(32) }, body });
  await new Promise((r) => setTimeout(r, 50));
  const after = reqCounts(env);
  t("control", "7 an outside tools/call, and one with a forged mark, are both counted (2)", (after["mcp|get_conditions|other|none"] || 0) === 2, JSON.stringify(after));
  const u = await (await call("/usage")).json();
  t("control", "7 /usage says own sweeps are not counted and how", /not counted/.test(u.requesters.own_sweeps_not_counted || "") && u.requesters.own_sweeps_not_counted.includes(S.OWN_SWEEP_HEADER), String(u.requesters.own_sweeps_not_counted).slice(0, 80));
  RELAY_ENV = null;
}

// ---- 8. the wall cap: after SWEEP_WALL_BUDGET_MS no new row starts -----------------------------------------
{
  const { env, post, sweep, day } = freshEnv();
  for (const n of [1, 2, 3]) await post("/watch", { endpoint: "https://w" + n + ".redteam.invalid/mcp", tier: "paid" }, { "x-sweep-token": OP });
  const realNow = Date.now;
  let offset = 0, seen = 0;
  onMcp = (host, method) => { if (method === "initialize" && ++seen === 2) offset = S.SWEEP_WALL_BUDGET_MS + 60 * 1000; };
  Date.now = () => realNow() + offset;
  let s;
  try { s = await sweep({}); } finally { Date.now = realNow; onMcp = null; }
  const wall = s.j.skipped.filter((x) => /^sweep wall time/.test(x.reason));
  t("attack", "8 once the wall cap has passed, the remaining rows are not started, each is in skipped with the reason, and the run says stopped_by wall_time", s.j.results.length === 2 && wall.length === 10 && s.j.stopped_by === "wall_time", JSON.stringify([s.j.results.length, wall.length, s.j.stopped_by]));
  const d = await day();
  t("control", "8 the day lists those rows as missing with reason code wall_time in the run", d.j.complete === false && d.j.missing.length === 10 && d.j.runs[0].capacity_skipped.filter((c) => c.reason_code === "wall_time").length === 10, JSON.stringify([d.j.complete, d.j.missing.length]));
}

// ---- 9. measurement: CPU, fetches and KV calls per measured row (printed; loose bounds) ----------------------
let BENCH = null;
{
  const { env, post, sweep } = freshEnv();
  const N = S.MAX_PER_SWEEP - SELF.length;
  for (let i = 0; i < N; i++) await post("/watch", { endpoint: "https://b" + i + ".redteam.invalid/mcp", tier: "paid" }, { "x-sweep-token": OP });
  await sweep({ force: true });   // first sweep of the window: salts, then every row once
  // Grow every history to about 70 entries (the self rows' real histories are 200 to 300 KB), like production.
  for (const [k, v] of env.HS_VERIFY_KV.store) {
    if (!k.startsWith("hist:")) continue;
    const h = JSON.parse(v); const e = h.entries[h.entries.length - 1];
    const more = []; for (let i = 0; i < 70; i++) more.push(Object.assign({}, e, { at: new Date(Date.parse(e.at) - (70 - i) * 86400000).toISOString() }));
    h.entries = more.concat(h.entries);
    env.HS_VERIFY_KV.store.set(k, JSON.stringify(h));
  }
  const histBytes = [...env.HS_VERIFY_KV.store].filter(([k]) => k.startsWith("hist:")).map(([, v]) => v.length);
  const ops0 = Object.assign({}, env.HS_VERIFY_KV.ops);
  const c0 = process.cpuUsage(); const w0 = Date.now();
  const s = await sweep({ force: true });
  const c1 = process.cpuUsage(c0); const w1 = Date.now() - w0;
  const rows = s.j.results.filter((r) => !r.error).length;
  const kvCalls = Object.keys(ops0).reduce((a, k) => a + (env.HS_VERIFY_KV.ops[k] - ops0[k]), 0);
  BENCH = {
    rows, history_kb_median: Math.round(histBytes.sort((a, b) => a - b)[Math.floor(histBytes.length / 2)] / 1024),
    cpu_ms_per_row: +(((c1.user + c1.system) / 1000) / rows).toFixed(1),
    wall_ms_per_row_mock: Math.round(w1 / rows),
    fetches_per_row: +(s.j.subrequests.used / rows).toFixed(2),
    kv_calls_per_row: +(kvCalls / rows).toFixed(2),
    kv_gets: env.HS_VERIFY_KV.ops.get - ops0.get, kv_puts: env.HS_VERIFY_KV.ops.put - ops0.put, kv_lists: env.HS_VERIFY_KV.ops.list - ops0.list,
  };
  console.log("BENCH " + JSON.stringify(BENCH));
  t("control", "9 a full run of MAX_PER_SWEEP rows is measured in one run with the default limits", rows === S.MAX_PER_SWEEP, rows);
  t("control", "9 CPU per measured row on this machine is under 200 ms (40 rows under 8 s, inside the 30 s HTTP CPU of a POST /sweep and far inside the 15 min Cron CPU)", BENCH.cpu_ms_per_row < 200, BENCH.cpu_ms_per_row);
  t("control", "9 fetches + KV calls of a full run stay under a tenth of the Paid 10,000 subrequests", s.j.subrequests.used + kvCalls < 1000, s.j.subrequests.used + kvCalls);
}

// ---- report ------------------------------------------------------------------------------------------------
const kinds = {};
for (const r of R) { const k = kinds[r.kind] || [0, 0]; kinds[r.kind] = [k[0] + (r.ok ? 1 : 0), k[1] + 1]; }
console.log("--- 種別 ---");
for (const k of ["attack", "control"]) if (kinds[k]) console.log("  " + k.padEnd(10) + " " + kinds[k][0] + " / " + kinds[k][1]);
for (const r of R) console.log((r.ok ? "  ok   " : "  NG   ") + "[" + r.kind + "] " + r.name + (r.ok ? "" : "\n      " + r.detail));
const passed = R.filter((r) => r.ok).length;
console.log("=== " + passed + " / " + R.length + " 合格 (sweep stage 2、扉 0.4.21) ===");
process.exit(passed === R.length ? 0 : 1);
