/* hs-kira-line v27: LINE の月の通数を見張る。ネットワークには出ない。

   なぜ要るか (2026-11-06): 無料プランは月 200 通。11/6 の時点で 54 通、1 日 9 通前後のペースで、
   20 日前後に上限に達する。上限に達すると push(ヒアリングの問い、大賀さんへの知らせ、拾い直し、
   夜のまとめ)が月末まで止まり、その知らせ自体も届かない。TOshi「2度と止まんな」。
   確かめること:
     ・80% と 95% の手前で一度ずつ、大賀さんへ知らせる(月ごと)。同じ月に二度は知らせない
     ・80% 未満、上限の無いプランでは知らせない
     ・通数を読めなかったら何もしない(印も書かない)
     ・知らせが送れなかったら印を付けず、次の巡回でもう一度送る
     ・/health に最後に読んだ通数を出す

   node workers/hs-kira-line/quota_test.mjs
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.KL_WORKER ? path.resolve(HERE, process.env.KL_WORKER) : path.join(HERE, "src", "worker.js");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hskl-q-"));
fs.copyFileSync(SRC, path.join(TMP, "worker.mjs"));
const W = (await import(path.join(TMP, "worker.mjs"))).default;
console.log("試す対象: " + SRC);

let fail = 0, checks = 0;
function check(label, cond, detail) { checks++; console.log((cond ? "  ok   " : "  NG   ") + label + (detail ? "  " + detail : "")); if (!cond) fail++; }

const OWNER = "U" + "c".repeat(32);
function makeEnv() {
  const kv = new Map();
  return {
    LINE_CHANNEL_SECRET: "s", LINE_CHANNEL_TOKEN: "tok", LINE_USER_ID: OWNER, KIRA_BRIDGE_KEY: "bk", ANTHROPIC_API_KEY: "test-not-a-key",
    SEEN_STORE: {
      get: async (k) => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => { kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
      list: async (o) => ({ keys: [...kv.keys()].filter((k) => k.startsWith((o && o.prefix) || "")).map((name) => ({ name })) }),
    },
  };
}
async function freshEnv() { const e = makeEnv(); await e.SEEN_STORE.put("kira_global_swept:v20", "1"); return e; }
let calls = [];
let quota = { type: "limited", value: 200 }, used = 54, quotaStatus = 200, pushStatus = 200;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  let body = null; try { body = JSON.parse((init && init.body) || "null"); } catch (_e) {}
  calls.push({ url: u, body });
  if (u.endsWith("/v2/bot/message/quota")) return quotaStatus === 200 ? new Response(JSON.stringify(quota), { status: 200 }) : new Response("{}", { status: quotaStatus });
  if (u.endsWith("/v2/bot/message/quota/consumption")) return quotaStatus === 200 ? new Response(JSON.stringify({ totalUsage: used }), { status: 200 }) : new Response("{}", { status: quotaStatus });
  if (u.includes("/v2/bot/message/push")) return new Response(JSON.stringify(pushStatus === 200 ? {} : { message: "You have reached your monthly limit." }), { status: pushStatus });
  return new Response("{}", { status: 200 });
};
const runCron = async (env) => { const w = []; await W.scheduled({}, env, { waitUntil: (p) => w.push(p) }); await Promise.all(w); };
const warns = () => calls.filter((c) => c.url.includes("/push") && c.body && c.body.to === OWNER && String(c.body.messages[0].text).includes("月の通数"));
const health = async (env) => (await W.fetch(new Request("https://x/health"), env, { waitUntil: () => {} })).json();

console.log("\n1) 54 / 200(11/6 の実数): 知らせない。/health に通数を出す");
{
  const env = await freshEnv(); calls = []; quota = { type: "limited", value: 200 }; used = 54; quotaStatus = 200; pushStatus = 200;
  await runCron(env);
  check("知らせない", warns().length === 0);
  const h = await health(env);
  check("/health line_quota に 54 / 200", h.line_quota && h.line_quota.used === 54 && h.line_quota.limit === 200 && h.line_quota.type === "limited", JSON.stringify(h.line_quota));
}

console.log("\n2) 160 / 200(80%): 一度だけ知らせる");
{
  const env = await freshEnv(); calls = []; used = 160;
  await runCron(env);
  check("知らせた", warns().length === 1);
  const t = warns()[0] ? warns()[0].body.messages[0].text : "";
  check("知らせに 80%、通数、残り、上げ方", t.includes("80%") && t.includes("160 / 200") && t.includes("残り 40") && t.includes("利用と請求"), t.slice(0, 60));
  calls = []; await runCron(env);
  check("同じ月に二度は知らせない", warns().length === 0);

  console.log("\n3) 同じ月に 190 / 200(95%): 95% をもう一度だけ知らせる");
  calls = []; used = 190; await runCron(env);
  check("95% を知らせた", warns().length === 1 && warns()[0].body.messages[0].text.includes("95%"));
  calls = []; await runCron(env);
  check("二度目は無し", warns().length === 0);
}

console.log("\n4) 一気に 195 / 200 なら、95% の知らせ 1 通だけ(80% と 2 通にしない)");
{
  const env = await freshEnv(); calls = []; used = 195;
  await runCron(env);
  check("1 通", warns().length === 1 && warns()[0].body.messages[0].text.includes("95%"), String(warns().length));
}

console.log("\n5) 上限の無いプランでは知らせない");
{
  const env = await freshEnv(); calls = []; quota = { type: "none" }; used = 99999;
  await runCron(env);
  check("知らせない", warns().length === 0);
  quota = { type: "limited", value: 200 };
}

console.log("\n6) 通数を読めなかったら、何もしない(印も記録も書かない)");
{
  const env = await freshEnv(); calls = []; used = 199; quotaStatus = 500;
  await runCron(env);
  check("知らせない", warns().length === 0);
  check("/health の line_quota は無いまま", (await health(env)).line_quota === null);
  quotaStatus = 200;
  calls = []; await runCron(env);
  check("読めるようになったら知らせる", warns().length === 1);
}

console.log("\n7) 知らせが送れなかったら(上限など)印を付けず、次の巡回でもう一度送る");
{
  const env = await freshEnv(); calls = []; used = 170; pushStatus = 429;
  await runCron(env);
  check("送ろうとした", warns().length === 1);
  const h = await health(env);
  check("/health line_last_fail に push 429 を残した", h.line_last_fail && h.line_last_fail.status === 429 && h.line_last_fail.where === "通数の知らせ", JSON.stringify(h.line_last_fail));
  pushStatus = 200; calls = []; await runCron(env);
  check("次の巡回で送り直した", warns().length === 1);
}

console.log("\n8) 月が変われば、また知らせる");
{
  const env = await freshEnv(); calls = []; used = 165;
  const next = Date.UTC(2026, 11, 2, 0, 0, 0);
  await env.SEEN_STORE.put("kira_quota_warn:2026-11:80", "1");
  const realNow = Date.now; Date.now = () => next;
  try { await runCron(env); } finally { Date.now = realNow; }
  check("12 月の 80% を知らせた", warns().length === 1);
  check("12 月の印が付いた", (await env.SEEN_STORE.get("kira_quota_warn:2026-12:80")) === "1");
}

console.log("\n9) /health の版");
{
  const h = await health(await freshEnv());
  check("version は v27-quota-20261106", h.version === "v27-quota-20261106", h.version);
}

const EXPECT = 18;
console.log("\n確かめた数: " + checks + " (最低 " + EXPECT + ")");
if (checks < EXPECT) { console.log("  NG   試験がまるごと走っていません。"); fail++; }
console.log(fail ? fail + " 件 失敗" : "通数の見張り すべて通過");
process.exit(fail ? 1 : 0);
