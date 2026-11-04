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

  // ctx.storage with the calls the class uses: get, put, delete([...]), list({prefix, end, limit}) -> Map in key order
  const mem = new Map();
  const storage = {
    async get(k) { return mem.has(k) ? structuredClone(mem.get(k)) : undefined; },
    async put(k, v) { mem.set(k, structuredClone(v)); },
    async delete(ks) { for (const k of ks) mem.delete(k); return ks.length; },
    async list({ prefix = "", end, limit = Infinity } = {}) { const ks = [...mem.keys()].filter((k) => k.startsWith(prefix) && (end === undefined || k < end)).sort().slice(0, limit); return new Map(ks.map((k) => [k, mem.get(k)])); }
  };
  const obj = new mod.DispatchLog({ storage }, {});
  const env = { GH_DISPATCH_TOKEN: " tok-for-test \n", LOG: { idFromName: (x) => "id:" + x, get: (id) => (id === "id:log" ? obj : null) } };
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
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log("hs-cron-dispatch wiring test: " + (n - bad) + " / " + n + (bad ? " NG" : " all green"));
if (bad) process.exit(1);
