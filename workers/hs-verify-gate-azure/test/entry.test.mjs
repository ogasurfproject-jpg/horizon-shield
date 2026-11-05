// entry.test.mjs  入口(src/main.mjs、src/bridge.mjs、src/env.mjs)を、Functions の host 無しで、関数を直に呼んで試す。
// 要求は @azure/functions の HttpRequest(試験のための constructor)で作り、置き場は手元の Azurite。
// 外への fetch は偽物が答え、表に無い host は例外で落とす(網に出ない)。時計は固定する。
// 最後に、esbuild で束ねた dist/main.cjs でも同じ関数が答える事を見る。
// 使い方: node test/entry.test.mjs     1 つでも落ちたら exit 1(先に node build.mjs)

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import functions from "@azure/functions";   // CommonJS の package なので default で読む
import { newClients } from "./azurite.mjs";
import { clientIp, toWebRequest, runHttp, runTimer, scheduledEventFor } from "../src/bridge.mjs";
import { GATE_VARS, GATE_NOT_PASSED, pickVars } from "../src/env.mjs";
const { HttpRequest, InvocationContext } = functions;

let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || detail == null ? "" : "  <- " + String(detail).slice(0, 400))); };
const sha256 = (s) => createHash("sha256").update(typeof s === "string" ? Buffer.from(s, "utf8") : s).digest("hex");
const td = new TextDecoder();
const bodyText = (r) => (r.body == null ? "" : typeof r.body === "string" ? r.body : td.decode(r.body));

// ---- 時計 ----
const RealDate = Date;
const NOW = { v: RealDate.parse("2026-11-05T18:00:05.000Z") };
class FixedDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW.v); else super(...a); }
  static now() { return NOW.v; }
}
FixedDate.parse = RealDate.parse; FixedDate.UTC = RealDate.UTC;
globalThis.Date = FixedDate;

// ---- 外の世界(parity_run.mjs の客と同じ形を小さく)----
const EP = "https://mcp.customer-b.invalid/mcp";
const HOOK = "https://hooks.customer-b.invalid/hs";
const HOOKS = [];
let PHASE = 1;
const HASH_A = "ab".repeat(32);
const jres = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
const realFetch = globalThis.fetch;
const FETCHED = [];
globalThis.fetch = async (url, init) => {
  const u = new URL(typeof url === "string" ? url : url.url);
  FETCHED.push(u.hostname);
  if (["mempool.space", "blockstream.info", "mempool.emzy.de"].includes(u.hostname)) {
    if (u.pathname === "/api/blocks/tip/height") return new Response("900006");
    if (u.pathname === "/api/block-height/900000") return new Response(HASH_A);
    if (u.pathname === "/api/block/" + HASH_A) return jres({ id: HASH_A, height: 900000, timestamp: Math.floor(RealDate.parse("2026-11-05T18:30:00Z") / 1000) });
    return new Response("", { status: 404 });
  }
  if (u.hostname === "ledger.horizonshield.dev") return jres({ ok: true, accepted: true }, 201);
  if (u.hostname === "raw.githubusercontent.com") return new Response("404: Not Found", { status: 404 });
  if (u.origin + u.pathname === HOOK) { HOOKS.push(String(init && init.body)); return new Response("ok"); }
  if (u.hostname === "mcp.customer-b.invalid") {
    if (u.pathname === "/.well-known/agent-card.json") return jres(PHASE === 1
      ? { name: "Customer B", description: "x", url: "", compensation: { paid_by: "public", referral_fee: false, listing_fee: false, success_fee_pct: 0, disclosure_url: "https://customer-b.invalid/d" } }
      : { name: "Customer B", description: "x", url: "" });
    if (u.pathname === "/mcp" && init && init.method === "POST") {
      const b = JSON.parse(init.body);
      if (b.method === "initialize") return jres({ jsonrpc: "2.0", id: b.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "b", version: "1" }, capabilities: { tools: {} } } });
      if (b.method === "tools/list") return jres({ jsonrpc: "2.0", id: b.id, result: { tools: [{ name: "alpha", description: "a", inputSchema: { type: "object", properties: {} } }] } });
      if (b.method === "tools/call") return jres({ jsonrpc: "2.0", id: b.id, result: { content: [{ type: "text", text: "c" }] } });
      return jres({ jsonrpc: "2.0", id: b.id, error: { code: -32601, message: "nope" } });
    }
    return new Response("not found", { status: 404 });
  }
  throw new Error("entry test: network blocked for " + u.hostname);
};
void realFetch;

// ---- 1. bridge の小さい部品 ----
t("clientIp: IPv4 with port (the form Functions puts in X-Forwarded-For)", clientIp("203.0.113.7:51234") === "203.0.113.7", clientIp("203.0.113.7:51234"));
t("clientIp: the last entry wins over one the client sent", clientIp("198.51.100.1, 203.0.113.7:443") === "203.0.113.7", "");
t("clientIp: [IPv6]:port and bare IPv6", clientIp("[2001:db8::1]:443") === "2001:db8::1" && clientIp("2001:db8::2") === "2001:db8::2", "");
t("clientIp: garbage gives null", clientIp("not an ip") === null && clientIp("") === null && clientIp(null) === null, "");
{
  const req = new HttpRequest({ method: "POST", url: "https://gate-az.example.invalid/watch?x=1", headers: { "x-forwarded-for": "198.51.100.9, 203.0.113.7:1", "cf-connecting-ip": "6.6.6.6", "content-type": "application/json" }, body: { string: '{"a":"日本"}' } });
  const w = await toWebRequest(req);
  t("toWebRequest: method, url, body bytes kept", w.method === "POST" && w.url === "https://gate-az.example.invalid/watch?x=1" && (await w.text()) === '{"a":"日本"}', w.url);
  t("toWebRequest: a cf-connecting-ip the client sent is replaced by the forwarded IP", w.headers.get("cf-connecting-ip") === "203.0.113.7", w.headers.get("cf-connecting-ip"));
}
{
  let late = false;
  const fake = { async fetch(_r, _e, ctx) { ctx.waitUntil(new Promise((res) => setTimeout(() => { late = true; res(); }, 80))); ctx.waitUntil(Promise.reject(new Error("x"))); return new Response(new Uint8Array([0, 255, 1]), { status: 201, headers: { "x-a": "1" } }); } };
  const r = await runHttp(fake, {}, new HttpRequest({ method: "GET", url: "https://h.invalid/" }), new InvocationContext());
  t("runHttp: waits for every waitUntil before it returns (a rejected one does not fail the response)", late === true && r.status === 201, JSON.stringify({ late, status: r.status }));
  t("runHttp: body bytes and headers kept", r.body instanceof Uint8Array && [...r.body].join(",") === "0,255,1" && r.headers["x-a"] === "1", "");
  const h = await runHttp({ fetch: async () => new Response("abc") }, {}, new HttpRequest({ method: "HEAD", url: "https://h.invalid/" }), new InvocationContext());
  const n = await runHttp({ fetch: async () => new Response(null, { status: 204 }) }, {}, new HttpRequest({ method: "GET", url: "https://h.invalid/" }), new InvocationContext());
  t("runHttp: HEAD and 204 have no body", h.body === undefined && n.status === 204 && n.body === undefined, "");
  const e = await runHttp({ fetch: async () => { throw new Error("boom secret-ish"); } }, {}, new HttpRequest({ method: "GET", url: "https://h.invalid/" }), new InvocationContext());
  t("runHttp: a thrown worker gives 500 without the message", e.status === 500 && !bodyText(e).includes("boom"), bodyText(e));
  let ranLate = false, ev = null;
  const fs = { async scheduled(event, _e, ctx) { ev = event; ctx.waitUntil(new Promise((res) => setTimeout(() => { ranLate = true; res(); }, 80))); } };
  const tr = await runTimer(fs, {}, { isPastDue: true }, new InvocationContext(), RealDate.parse("2026-11-05T19:00:03Z"));
  t("runTimer: scheduled gets cron '0 19 * * *' and the hour as scheduledTime, and its waitUntil is awaited", ranLate && ev.cron === "0 19 * * *" && ev.scheduledTime === RealDate.parse("2026-11-05T19:00:00Z") && tr.past_due === true, JSON.stringify(ev));
}

// ---- 2. 予定(NCRONTAB)と Cloudflare の SWEEP_CRONS ----
process.env.GATE_REGISTER = "off";
const main = await import("../src/main.mjs");
const { _sweepStage2 } = await import("../../hs-verify-gate/src/worker.js");
{
  const m = /^0 0 (\d+)-(\d+) \* \* \*$/.exec(main.GATE_TIMER_SCHEDULE);
  const hours = m ? Array.from({ length: Number(m[2]) - Number(m[1]) + 1 }, (_, i) => Number(m[1]) + i) : [];
  const asCron = hours.map((h) => "0 " + h + " * * *");
  t("NCRONTAB " + main.GATE_TIMER_SCHEDULE + " fires at the same UTC hours as SWEEP_CRONS " + JSON.stringify(_sweepStage2.SWEEP_CRONS), JSON.stringify(asCron) === JSON.stringify(_sweepStage2.SWEEP_CRONS), JSON.stringify(asCron));
  t("the timer's event for each hour is spelled exactly as one of SWEEP_CRONS", hours.every((h) => _sweepStage2.SWEEP_CRONS.includes(scheduledEventFor(RealDate.UTC(2026, 10, 5, h, 0, 9)).cron)), "");
  const wrangler = readFileSync(new URL("../../hs-verify-gate/wrangler.jsonc", import.meta.url), "utf8");
  t("... and wrangler.jsonc carries the same four", _sweepStage2.SWEEP_CRONS.every((c) => wrangler.includes('"' + c + '"')), "");
}
{
  const calls = [];
  const fakeApp = { http: (name, o) => calls.push(["http", name, o]), timer: (name, o) => calls.push(["timer", name, o]) };
  const all = main.register(fakeApp, undefined);
  const g = calls.find((c) => c[1] === "gate");
  t("register: gate is HTTP on every path, anonymous, all methods the worker answers", g && g[2].route === "{*path}" && g[2].authLevel === "anonymous" && ["GET", "POST", "DELETE", "OPTIONS", "HEAD"].every((x) => g[2].methods.includes(x)), JSON.stringify(g && { ...g[2], handler: undefined }));
  const s = calls.find((c) => c[1] === "gateSweep");
  t("register: gateSweep is a timer on " + main.GATE_TIMER_SCHEDULE + ", not on startup", s && s[2].schedule === main.GATE_TIMER_SCHEDULE && s[2].runOnStartup === false, "");
  calls.length = 0; const onlyHttp = main.register(fakeApp, "http");
  const c2 = calls.map((c) => c[1]);
  calls.length = 0; const onlyTimer = main.register(fakeApp, "timer");
  t("register: GATE_FUNCTION_ROLE splits HTTP and timer into separate apps", JSON.stringify(all) === '["gate","gateSweep","kvCleanup"]' && JSON.stringify(onlyHttp) === '["gate"]' && JSON.stringify(c2) === '["gate"]' && JSON.stringify(onlyTimer) === '["gateSweep","kvCleanup"]', JSON.stringify([all, onlyHttp, onlyTimer]));
  const host = JSON.parse(readFileSync(new URL("../host.json", import.meta.url), "utf8"));
  t("host.json: no route prefix (paths are the gate's own), function timeout 30 minutes", host.extensions.http.routePrefix === "" && host.functionTimeout === "00:30:00", "");
}

// ---- 3. env ----
{
  // worker が env から読む名は、全部 GATE_VARS か GATE_NOT_PASSED か binding。足された名を見落とさない。
  const dir = new URL("../../hs-verify-gate/src/", import.meta.url);
  const names = new Set();
  for (const f of ["worker.js", "witness.js", "key_history.js", "ae_challenge.js", "nenrin_instant.js", "sweep_lease.js", "recompute.js"]) {
    const src = readFileSync(new URL(f, dir), "utf8");
    for (const m of src.matchAll(/\b(?:env|GATE_ENV)\??\.([A-Z][A-Z0-9_]+)/g)) names.add(m[1]);
    for (const m of src.matchAll(/\b(?:env|GATE_ENV)\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]/g)) names.add(m[1]);
  }
  const known = new Set([...GATE_VARS, ...GATE_NOT_PASSED, "HS_VERIFY_KV", "SWEEP_LEASE_DO"]);
  const unknown = [...names].filter((n) => !known.has(n));
  t("env: every name the gate reads (" + names.size + ") is passed, deliberately not passed, or a binding", unknown.length === 0, JSON.stringify(unknown));
  const p = pickVars({ SWEEP_TOKEN: "@Microsoft.KeyVault(SecretUri=https://kv.invalid/secrets/x/)", GATE_COMMIT: "c", GATE_PUBLIC_ORIGIN: "https://gate-az.example.invalid", RELAY_URL: "https://relay.invalid", AzureWebJobsStorage: "UseDevelopmentStorage=true" });
  t("env: an unresolved Key Vault reference is left out and named (value not echoed), and SWEEP_TOKEN is then missing", p.unresolved.join() === "SWEEP_TOKEN" && p.missing.join() === "SWEEP_TOKEN" && !JSON.stringify(p).includes("kv.invalid"), JSON.stringify(p));
  t("env: only the gate's names are copied (no RELAY_URL, no AzureWebJobsStorage), replica defaults filled", !("RELAY_URL" in p.vars) && !("AzureWebJobsStorage" in p.vars) && p.vars.GATE_PLATFORM === "azure" && p.vars.OWN_ROWS === "off" && p.vars.GATE_PATHS === "replica", JSON.stringify(p.vars));
  const q = pickVars({ GATE_PLATFORM: "azure", OWN_ROWS: "on", GATE_PATHS: "all", SWEEP_TOKEN: "s", GATE_COMMIT: "c", GATE_PUBLIC_ORIGIN: "https://o.invalid" });
  t("env: values that are set are kept as set (OWN_ROWS=on, GATE_PATHS=all)", q.vars.OWN_ROWS === "on" && q.vars.GATE_PATHS === "all" && q.missing.length === 0, JSON.stringify(q));
  // 0.4.23. Marketplace の毎日の一覧の URL と鍵は写しに渡る(URL は app settings で替えられる)。鍵の参照が解けない時は名だけ。
  const m = pickVars({ SWEEP_TOKEN: "s", GATE_COMMIT: "c", GATE_PUBLIC_ORIGIN: "https://o.invalid", MARKETPLACE_DAILY_URL: "https://marketplace-az.example.invalid/admin/daily", MARKETPLACE_DAILY_TOKEN: "daily-read-value", REPLICA_ORIGIN: "https://r.invalid" });
  t("env: MARKETPLACE_DAILY_URL and MARKETPLACE_DAILY_TOKEN reach the replica as set; REPLICA_ORIGIN (the gate role's name) does not", m.vars.MARKETPLACE_DAILY_URL === "https://marketplace-az.example.invalid/admin/daily" && m.vars.MARKETPLACE_DAILY_TOKEN === "daily-read-value" && !("REPLICA_ORIGIN" in m.vars), JSON.stringify(Object.keys(m.vars)));
  const m2 = pickVars({ SWEEP_TOKEN: "s", GATE_COMMIT: "c", GATE_PUBLIC_ORIGIN: "https://o.invalid", MARKETPLACE_DAILY_URL: "https://marketplace.example.invalid/admin/daily", MARKETPLACE_DAILY_TOKEN: "@Microsoft.KeyVault(SecretUri=https://kv.invalid/secrets/MARKETPLACE-DAILY-TOKEN/)" });
  t("env: an unresolved MARKETPLACE_DAILY_TOKEN reference is left out and named, so the replica does not read the list with the reference text", m2.unresolved.join() === "MARKETPLACE_DAILY_TOKEN" && !("MARKETPLACE_DAILY_TOKEN" in m2.vars) && !JSON.stringify(m2).includes("kv.invalid"), JSON.stringify(m2));
}

// 設定の足りない入口: 503 で、測らない
{
  delete process.env.GATE_PUBLIC_ORIGIN;
  main._resetForTest();
  const clients = await newClients("nc");
  await main.gateEnv({ clients });
  const r = await main.gateHttp(new HttpRequest({ method: "GET", url: "https://gate-az.example.invalid/health" }), new InvocationContext());
  t("entry: without GATE_PUBLIC_ORIGIN, GATE_COMMIT and SWEEP_TOKEN every path answers 503 not_configured and names them", r.status === 503 && /GATE_PUBLIC_ORIGIN/.test(bodyText(r)) && /GATE_COMMIT/.test(bodyText(r)), bodyText(r));
  const logs = [];
  const ctx = new InvocationContext({ logHandler: (level, ...a) => logs.push(level + " " + a.join(" ")) });
  await main.gateTimer({ isPastDue: false }, ctx);
  let n = 0; for await (const _e of clients.kvTable.listEntities()) n++;
  t("entry: the timer does not sweep then, and writes nothing", n === 0 && logs.some((l) => /sweep not run/.test(l)), JSON.stringify({ n, logs }));
}

// ---- 4. 入口を通した筋書き(Azurite)----
const OP = "entry-operator-token";
Object.assign(process.env, { GATE_PUBLIC_ORIGIN: "https://gate-az.example.invalid", GATE_COMMIT: "entry-local", SWEEP_TOKEN: OP, SUBREQUEST_BUDGET: "1000" });
main._resetForTest();
const clients = await newClients("en");
await main.gateEnv({ clients });
const O = "https://gate-az.example.invalid";
const call = async (method, p, { body, headers } = {}) => {
  const r = await main.gateHttp(new HttpRequest({ method, url: O + p, headers: { "x-forwarded-for": "203.0.113.5:4000", ...(headers || {}) }, body: body === undefined ? undefined : { string: typeof body === "string" ? body : JSON.stringify(body) } }), new InvocationContext());
  return { status: r.status, text: bodyText(r), raw: r.body, headers: r.headers || {} };
};
{
  const h = await call("GET", "/health");
  t("http GET /health -> 200 through the Functions request", h.status === 200 && /"ok"|ok/.test(h.text), h.status + " " + h.text.slice(0, 200));
  const c = await call("GET", "/check?endpoint=" + encodeURIComponent(EP));
  t("http GET /check -> 404 not_served_here (GATE_PATHS=replica by default on this entry)", c.status === 404 && /not_served_here/.test(c.text), c.status + " " + c.text.slice(0, 120));
  const w0 = await call("POST", "/watch", { body: { endpoint: EP, tier: "paid", webhook: HOOK }, headers: { "content-type": "application/json" } });
  t("http POST /watch without the operator key -> 403", w0.status === 403, w0.status + " " + w0.text.slice(0, 200));
  const w1 = await call("POST", "/watch", { body: { endpoint: EP, tier: "paid", webhook: HOOK }, headers: { "content-type": "application/json", "x-sweep-token": OP } });
  t("http POST /watch with the operator key registers the customer endpoint", w1.status >= 200 && w1.status < 300, w1.status + " " + w1.text.slice(0, 300));
  const s1 = await call("POST", "/sweep", { body: { force: true }, headers: { "content-type": "application/json", "x-sweep-token": OP } });
  let sj = null; try { sj = JSON.parse(s1.text); } catch (_e) {}
  t("http POST /sweep {force:true} sweeps the one customer row (own rows are off)", s1.status === 200 && sj && Array.isArray(sj.results) && sj.results.length === 1, s1.status + " " + s1.text.slice(0, 300));
  const hist = await call("GET", "/history?endpoint=" + encodeURIComponent(EP));
  const entries = JSON.parse(hist.text).entries || [];
  t("http GET /history has the measurement", hist.status === 200 && entries.length === 1, hist.text.slice(0, 300));
  const sha = entries[0] && entries[0].record_sha256;
  const rec = await call("GET", "/record/" + sha);
  t("http GET /record/<sha> -> bytes whose SHA-256 is the sha", rec.status === 200 && sha256(Buffer.from(rec.raw)) === sha, rec.status + " " + (rec.raw ? sha256(Buffer.from(rec.raw)) : "") + " vs " + sha);
  t("... and the record says where it was measured: azure and this origin", rec.text.includes('"measured_from":{"platform":"azure","origin":"https://gate-az.example.invalid"}'), rec.text.slice(0, 200));
  // timer: 翌日 18:00Z、card から compensation が消える。timer の関数で掃引が走り、条件が反転して webhook が 1 本飛ぶ。
  NOW.v = RealDate.parse("2026-11-06T18:00:04.000Z");
  PHASE = 2;
  const logs = [];
  await main.gateTimer({ isPastDue: false, schedule: { adjustForDST: false }, scheduleStatus: {} }, new InvocationContext({ logHandler: (level, ...a) => logs.push(level + " " + a.join(" ")) }));
  const last = JSON.parse((await call("GET", "/sweep/last")).text);
  const hist2 = JSON.parse((await call("GET", "/history?endpoint=" + encodeURIComponent(EP))).text).entries || [];
  t("timer gateSweep at 18:00Z runs the sweep as cron (sweep/last trigger cron, 2 history entries)", hist2.length === 2 && JSON.stringify(last).includes("cron") && logs.some((l) => /sweep 0 18 \* \* \*/.test(l)), JSON.stringify({ n: hist2.length, last: JSON.stringify(last).slice(0, 200), logs }));
  t("... the condition flipped and the customer's webhook got exactly one conformance_change", HOOKS.length === 1 && /conformance_change/.test(HOOKS[0]), JSON.stringify(HOOKS.map((x) => x.slice(0, 80))));
  const lease = []; for await (const e of clients.leaseTable.listEntities()) lease.push(e);
  t("... the lease entity was taken and released (none left)", lease.length === 0, JSON.stringify(lease));
  const l2 = await call("GET", "/register/lookup?endpoint=" + encodeURIComponent(EP));
  t("http GET /register/lookup answers for the row", l2.status === 200, l2.status + " " + l2.text.slice(0, 200));
  const day = await call("GET", "/sweep/day");
  t("http GET /sweep/day answers", day.status === 200, day.status + " " + day.text.slice(0, 200));
  t("only the fake hosts were called", FETCHED.every((h) => /customer-b\.invalid$|^mempool|^blockstream|ledger\.horizonshield\.dev$|raw\.githubusercontent\.com$/.test(h)), JSON.stringify([...new Set(FETCHED)]));
}

// ---- 5. 束ねた dist/main.cjs ----
{
  const p = new URL("../dist/main.cjs", import.meta.url);
  if (!existsSync(p)) t("dist/main.cjs exists (run node build.mjs first)", false, "missing");
  else {
    const require = createRequire(import.meta.url);
    const b = require(p.pathname);
    b._resetForTest();
    await b.gateEnv({ clients: await newClients("bd") });
    const r = await b.gateHttp(new HttpRequest({ method: "GET", url: O + "/health" }), new InvocationContext());
    const c = await b.gateHttp(new HttpRequest({ method: "GET", url: O + "/check" }), new InvocationContext());
    t("bundle dist/main.cjs (" + sha256(readFileSync(p)).slice(0, 8) + "): /health 200, /check 404, same exports", r.status === 200 && c.status === 404 && typeof b.gateTimer === "function" && b.GATE_TIMER_SCHEDULE === main.GATE_TIMER_SCHEDULE, r.status + " " + c.status);
  }
}

console.log("=== entry (functions called directly, not on the Functions host): " + pass + " / " + (pass + fail) + (fail ? "  FAIL" : "  ok") + " ===");
process.exit(fail ? 1 : 0);
