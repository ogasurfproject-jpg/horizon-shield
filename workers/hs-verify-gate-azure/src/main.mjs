// main.mjs  Azure Functions の入口。hs-verify-gate の src/worker.js を書き換えずに、Flex Consumption(Node 24)で動かす。
//   gate       HTTP(全部の path)。worker.fetch へ。出す path は worker が GATE_PATHS=replica で絞る
//   gateSweep  timer(NCRONTAB "0 0 18-21 * * *"、UTC)。worker.scheduled へ。Cloudflare の SWEEP_CRONS の 4 回と同じ時刻
//   kvCleanup  timer(毎日 22:30 UTC)。期限の切れた entity と、指されていない blob を消す
// GATE_FUNCTION_ROLE が "http" なら gate だけ、"timer" なら 2 つの timer だけを登録する(既定は全部)。
// build.mjs が esbuild でこの file と worker.js を dist/main.cjs に束ねる(package は外のまま)。

import functions from "@azure/functions";   // CommonJS の package。ES modules からは default で読む(名前の import は Node が断る)
import worker from "../../hs-verify-gate/src/worker.js";
import { buildEnv } from "./env.mjs";
import { runHttp, runTimer } from "./bridge.mjs";
import { cleanupExpired } from "./kv_table.mjs";

export const GATE_TIMER_SCHEDULE = "0 0 18-21 * * *";
export const KV_CLEANUP_SCHEDULE = "0 30 22 * * *";
export const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

let built = null;
// env は process ごとに 1 回だけ作る(client と Key Vault 参照の値を使い回す)。作れなかった時は次の呼びで作り直す。
export function gateEnv(opts) {
  if (!built) built = buildEnv(process.env, opts).catch((e) => { built = null; throw e; });
  return built;
}
export function _resetForTest() { built = null; }

function notReady(b) {
  return { status: 503, headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: "not_configured", missing: b.missing, unresolved: b.unresolved }) };
}

export async function gateHttp(request, context) {
  let b;
  try { b = await gateEnv(); }
  catch (e) { context.error("env: " + String((e && e.message) || e).slice(0, 300)); return { status: 503, headers: { "content-type": "application/json" }, body: '{"error":"storage_unavailable"}' }; }
  if (b.missing.length || b.unresolved.length) { context.error("env not ready: missing " + b.missing.join(",") + " unresolved " + b.unresolved.join(",")); return notReady(b); }
  return runHttp(worker, b.env, request, context);
}

export async function gateTimer(timer, context) {
  const b = await gateEnv();
  if (b.missing.length || b.unresolved.length) {
    // 掃引しない。記録に既定の origin や "unpinned" を焼き込むより、測らない方を取る。
    context.error("sweep not run, env not ready: missing " + b.missing.join(",") + " unresolved " + b.unresolved.join(","));
    return;
  }
  const r = await runTimer(worker, b.env, timer, context);
  context.log("sweep " + r.event.cron + (r.past_due ? " (past due)" : ""));
}

export async function kvCleanup(_timer, context) {
  const b = await gateEnv();
  const r = await cleanupExpired({ table: b.clients.kvTable, blobs: b.blobs, partition: "kv" });
  context.log("kv cleanup " + JSON.stringify(r));
}

export function register(a = functions.app, role = process.env.GATE_FUNCTION_ROLE) {
  const r = String(role || "all").toLowerCase();
  const out = [];
  if (r === "all" || r === "http") {
    a.http("gate", { route: "{*path}", methods: HTTP_METHODS, authLevel: "anonymous", handler: gateHttp });
    out.push("gate");
  }
  if (r === "all" || r === "timer") {
    a.timer("gateSweep", { schedule: GATE_TIMER_SCHEDULE, runOnStartup: false, useMonitor: true, handler: gateTimer });
    a.timer("kvCleanup", { schedule: KV_CLEANUP_SCHEDULE, runOnStartup: false, useMonitor: true, handler: kvCleanup });
    out.push("gateSweep", "kvCleanup");
  }
  return out;
}

if (process.env.GATE_REGISTER !== "off") register();
