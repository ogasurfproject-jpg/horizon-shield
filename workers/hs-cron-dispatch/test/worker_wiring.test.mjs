// test/worker_wiring.test.mjs: src/worker.js as Cloudflare would call it, with "cloudflare:workers" replaced by a stub,
// the Durable Object over an in-memory storage, and a fake GitHub. No network. Run: node test/worker_wiring.test.mjs
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

globalThis.fetch = () => { throw new Error("the network is not used in this test"); };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "src");
let n = 0, bad = 0;
function t(label, cond, extra) { n++; if (cond) console.log("  ok   " + label); else { bad++; console.log("  NG   " + label + (extra === undefined ? "" : " " + JSON.stringify(extra))); } }

const tmp = mkdtempSync(path.join(tmpdir(), "hs-cron-dispatch-wiring-"));
try {
  const w = readFileSync(path.join(SRC, "worker.js"), "utf8");
  t("worker.js imports DurableObject from cloudflare:workers once", (w.match(/from "cloudflare:workers"/g) || []).length === 1);
  writeFileSync(path.join(tmp, "stub.mjs"), "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }\n");
  writeFileSync(path.join(tmp, "worker.mjs"), w.replace('from "cloudflare:workers"', 'from "./stub.mjs"'));
  copyFileSync(path.join(SRC, "core.mjs"), path.join(tmp, "core.mjs"));
  const mod = await import(pathToFileURL(path.join(tmp, "worker.mjs")).href);

  // ctx.storage with the calls the class uses: get, put, delete([...]), list({prefix, end, limit}) -> Map in key order,
  // and the one alarm of the object: setAlarm(ms), deleteAlarm(), getAlarm()
  const mem = new Map();
  let alarmAt = null;
  const storage = {
    async setAlarm(ms) { alarmAt = ms; }, async deleteAlarm() { alarmAt = null; }, async getAlarm() { return alarmAt; },
    async get(k) { return mem.has(k) ? structuredClone(mem.get(k)) : undefined; },
    async put(k, v) { mem.set(k, structuredClone(v)); },
    async delete(ks) { for (const k of ks) mem.delete(k); return ks.length; },
    async list({ prefix = "", end, limit = Infinity } = {}) { const ks = [...mem.keys()].filter((k) => k.startsWith(prefix) && (end === undefined || k < end)).sort().slice(0, limit); return new Map(ks.map((k) => [k, mem.get(k)])); }
  };
  const env = { GH_DISPATCH_TOKEN: " tok-for-test \n", LOG: { idFromName: (x) => "id:" + x, get: (id) => (id === "id:log" ? obj : null) } };
  const obj = new mod.DispatchLog({ storage }, env);
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 204 }); };
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  mem.set("day:2025-01-01", { day: "2025-01-01", slots: [], entries: [] });   // older than 400 days: pruned on the next claim
  await mod.default.scheduled({ cron: "17 * * * *", scheduledTime: Date.parse("2026-11-05T21:17:00Z") }, env, ctx);
  await Promise.all(waits);
  t("scheduled 21:17: two dispatches through fetch", calls.length === 2 && calls.every((c) => c.init.headers.authorization === "Bearer tok-for-test"), calls.map((c) => c.url));
  t("the token is trimmed", calls[0].init.headers.authorization === "Bearer tok-for-test");
  const day = mem.get("day:2026-11-05");
  t("the Durable Object keeps the day with 2 slots", day && day.slots.length === 2 && day.entries.filter((e) => e.result === "dispatched").length === 2);
  t("a day older than 400 days is pruned", !mem.has("day:2025-01-01"));
  t("the stored log holds no token", !JSON.stringify([...mem.values()]).includes("tok-for-test"));
  waits.length = 0;
  await mod.default.scheduled({ cron: "17 * * * *", scheduledTime: Date.parse("2026-11-05T21:17:00Z") }, env, ctx);
  await Promise.all(waits);
  t("the same minute again: no call", calls.length === 2);
  const st = await mod.default.fetch(new Request("https://hs-cron-dispatch.example/status"), env);
  const sj = await st.json();
  t("GET /status through the default export", st.status === 200 && sj.worker === "hs-cron-dispatch" && sj.token_configured === true);
  const lg = await (await mod.default.fetch(new Request("https://hs-cron-dispatch.example/log?day=2026-11-05"), env)).json();
  t("GET /log through the default export", lg.entries.length === 6, lg.entries.length);

  // 0.3.0: the delayed retry through the Durable Object alarm (the 3 s wait inside scheduled is real here)
  const realNow = Date.now;
  let answers = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); const a = answers.length ? answers.shift() : 204; return new Response(a === 204 ? null : '{"message":"Server Error"}', { status: a }); };
  try {
    calls.length = 0; waits.length = 0; answers = [500, 500, 204];
    Date.now = () => Date.parse("2026-11-05T11:17:02Z");
    await mod.default.scheduled({ cron: "17 * * * *", scheduledTime: Date.parse("2026-11-05T11:17:00Z") }, env, ctx);
    await Promise.all(waits);
    t("scheduled 11:17 with 500, 500: two calls, alarm set to the slot + 5 min", calls.length === 2 && alarmAt === Date.parse("2026-11-05T11:22:00Z"), alarmAt);
    t("the retry item is in the Durable Object, without the token", mem.has("retry:jidec-stamp@2026-11-05T11:17Z") && !JSON.stringify(mem.get("retry:jidec-stamp@2026-11-05T11:17Z")).includes("tok-for-test"));
    waits.length = 0;
    await mod.default.scheduled({ cron: "17 * * * *", scheduledTime: Date.parse("2026-11-05T11:17:00Z") }, env, ctx);
    await Promise.all(waits);
    t("the same minute again during the wait: no call", calls.length === 2);
    const sw = await (await mod.default.fetch(new Request("https://hs-cron-dispatch.example/status"), env)).json();
    t("GET /status during the wait: retrying_in_view 1, failed_in_view 0", sw.retrying_in_view === 1 && sw.failed_in_view === 0 && sw.version === "0.3.0", [sw.retrying_in_view, sw.failed_in_view]);
    Date.now = () => Date.parse("2026-11-05T11:22:00Z");
    await obj.alarm();
    t("alarm at 11:22: one call with the trimmed token, the queue empty, the alarm deleted", calls.length === 3 && calls[2].init.headers.authorization === "Bearer tok-for-test" && !mem.has("retry:jidec-stamp@2026-11-05T11:17Z") && alarmAt === null);
    await obj.alarm();
    t("the alarm running again: no call", calls.length === 3);
    const ent = mem.get("day:2026-11-05").entries.filter((e) => e.slot === "2026-11-05T11:17Z");
    t("the log of the slot: claimed, failed, duplicate_slot, dispatched (retry 1, after_failed_slot)", JSON.stringify(ent.map((e) => e.result)) === '["claimed","failed","duplicate_slot","dispatched"]' && ent[3].retry === 1 && ent[3].after_failed_slot === true, ent.map((e) => e.result));
    const so = await (await mod.default.fetch(new Request("https://hs-cron-dispatch.example/status"), env)).json();
    t("GET /status after: failed_in_view 0, retrying 0, jidec-stamp not late", so.failed_in_view === 0 && so.retrying_in_view === 0 && !so.late_jobs.includes("jidec-stamp"));

    calls.length = 0; waits.length = 0; answers = [500, 503, 502, 500];
    Date.now = () => Date.parse("2026-11-05T12:17:01Z");
    await mod.default.scheduled({ cron: "17 * * * *", scheduledTime: Date.parse("2026-11-05T12:17:00Z") }, env, ctx);
    await Promise.all(waits);
    Date.now = () => Date.parse("2026-11-05T12:23:10Z");
    await obj.alarm();
    t("+5 min retry 502: alarm moved to the slot + 15 min", calls.length === 3 && alarmAt === Date.parse("2026-11-05T12:32:00Z"), alarmAt);
    Date.now = () => Date.parse("2026-11-05T12:32:00Z");
    await obj.alarm();
    const last = mem.get("day:2026-11-05").entries.pop();
    t("+15 min retry 500: final failed, 4 calls, no alarm, nothing queued", calls.length === 4 && last.result === "failed" && last.retry === 2 && /final/.test(last.why) && alarmAt === null && ![...mem.keys()].some((k) => k.startsWith("retry:")));
    mem.get("day:2026-11-05").entries.push(last);
    const sf = await (await mod.default.fetch(new Request("https://hs-cron-dispatch.example/status"), env)).json();
    t("GET /status: failed_in_view 1 (the 12:17 slot once)", sf.failed_in_view === 1 && sf.retrying_in_view === 0, sf.failed_in_view);
    t("the stored log and queue hold no token", !JSON.stringify([...mem.values()]).includes("tok-for-test"));
  } finally {
    Date.now = realNow;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log("hs-cron-dispatch wiring test: " + (n - bad) + " / " + n + (bad ? " NG" : " all green"));
if (bad) process.exit(1);
