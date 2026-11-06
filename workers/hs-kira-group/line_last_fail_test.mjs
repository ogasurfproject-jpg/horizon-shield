/* hs-kira-group: a reply LINE refused is kept and shown on /health as line_last_fail (2026-11-06, the same shape as hs-kira-line v26).
   Offline, no network: the real worker, with KV and fetch mocked.

   replyToLine reads LINE's answer and returns { ok, status, msg, api } (a network error does not throw). When LINE refuses,
   the last failure is kept in KV (kira_group_last_fail, 30 days) as { at, api, status, msg, where } without the text or the
   person, and GET /health returns it as line_last_fail. No failure: null. KV unreadable or not bound: "unreadable".
   Every "fix" check fails on 8a2ab8de and passes after the change. The "guard" checks pass on both.

   node workers/hs-kira-group/line_last_fail_test.mjs
*/
import crypto from "node:crypto";
import W from "./src/worker.js";

let fail = 0, checks = 0, guards = 0;
function check(label, cond, detail) {
  checks++;
  console.log((cond ? "  ok   " : "  NG   ") + label + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}
function guard(label, cond, detail) {
  guards++;
  console.log((cond ? "  ok   " : "  NG   ") + "[guard] " + label + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}

const SECRET = "test-channel-secret";
const GID = "C" + "a".repeat(32);
const UID = "U" + "b".repeat(32);
const KEY = "kira_group_last_fail";
function makeEnv(opts) {
  const o = opts || {};
  const kv = new Map();
  const puts = [];
  const env = {
    LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_TOKEN: "tok", ANTHROPIC_API_KEY: "test-not-a-key", OWNER_USER_ID: UID,
    _kv: kv, _puts: puts,
  };
  if (!o.noKv) env.HS_KIRA_GROUP_KV = {
    get: async (k) => { if (o.failGet && o.failGet(k)) throw new Error("KV get failed (test)"); return kv.has(k) ? kv.get(k) : null; },
    put: async (k, v, p) => { if (o.failPut && o.failPut(k)) throw new Error("KV put failed (test)"); puts.push({ k, p }); kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
  };
  return env;
}
function sign(body) { return crypto.createHmac("sha256", SECRET).update(body).digest("base64"); }
async function send(env, events) {
  const body = JSON.stringify({ events });
  const waits = [];
  const res = await W.fetch(new Request("https://x/webhook", { method: "POST", headers: { "content-type": "application/json", "x-line-signature": sign(body) }, body }), env, { waitUntil: (p) => waits.push(p) });
  let threw = false;
  await Promise.all(waits).catch(() => { threw = true; });
  return { res, threw };
}
async function health(env) {
  const r = await W.fetch(new Request("https://x/health"), env, { waitUntil: () => {} });
  return { status: r.status, j: await r.json() };
}
let calls = [];
let replyAnswer = () => new Response("{}", { status: 200 });
globalThis.fetch = async (url, init) => {
  const u = String(url);
  let body = null; try { body = JSON.parse((init && init.body) || "null"); } catch (_e) { body = null; }
  calls.push({ url: u, body });
  if (u.includes("api.anthropic.com")) return new Response(JSON.stringify({ content: [{ type: "text", text: "はい、承知しました。" }] }), { status: 200 });
  if (u.includes("/message/reply")) return replyAnswer();
  return new Response("{}", { status: 200 });
};
const groupText = (text) => ({ type: "message", replyToken: "rt", source: { type: "group", groupId: GID, userId: UID }, message: { type: "text", id: "m" + Math.random().toString(36).slice(2), text } });
const dmText = (text) => ({ type: "message", replyToken: "rt", source: { type: "user", userId: UID }, message: { type: "text", id: "m" + Math.random().toString(36).slice(2), text } });
const refuse = (status, message) => () => new Response(JSON.stringify({ message }), { status, headers: { "content-type": "application/json" } });
// the reader (TOOSHI v2 check 13) keeps only these characters of where
const readerWhere = (w) => String(w).replace(/[^A-Za-z0-9_:./-]/g, "").slice(0, 40);

console.log("\n1) no failed send: line_last_fail is null");
{
  const env = makeEnv();
  replyAnswer = () => new Response("{}", { status: 200 });
  calls = [];
  await send(env, [groupText("キラ、今日の段取りを教えて")]);
  const h = await health(env);
  check("/health has line_last_fail", Object.prototype.hasOwnProperty.call(h.j, "line_last_fail"), JSON.stringify(h.j));
  check("line_last_fail is null after a reply LINE accepted", h.j.line_last_fail === null, JSON.stringify(h.j.line_last_fail));
  guard("the reply went out", calls.some((c) => c.url.includes("/message/reply")));
  guard("/health status ok, service and version unchanged", h.status === 200 && h.j.status === "ok" && h.j.service === "hs-kira-group" && h.j.version === "group-6-readfail2-20261013", JSON.stringify(h.j));
}

console.log("\n2) LINE refuses a reply in a group (400): kept, shown on /health without the text or the person");
{
  const env = makeEnv();
  replyAnswer = refuse(400, "Invalid reply token");
  calls = [];
  const s = await send(env, [groupText("キラ、網戸の張り替えはいくら")]);
  replyAnswer = () => new Response("{}", { status: 200 });
  const h = await health(env);
  const f = h.j.line_last_fail;
  check("kept: api reply, status 400, where group:reply", f && f.api === "reply" && f.status === 400 && f.where === "group:reply", JSON.stringify(f));
  check("kept: at is an ISO time of now", f && typeof f.at === "string" && Math.abs(Date.parse(f.at) - Date.now()) < 60000, f && f.at);
  check("kept: msg is LINE's message", f && f.msg === "Invalid reply token", f && f.msg);
  guard("/health carries neither the text nor the group or person ID", !JSON.stringify(h.j).includes("網戸") && !JSON.stringify(h.j).includes(GID) && !JSON.stringify(h.j).includes(UID));
  const p = env._puts.find((x) => x.k === KEY);
  check("kept for 30 days (expirationTtl 2592000)", p && p.p && p.p.expirationTtl === 2592000, JSON.stringify(p && p.p));
  check("where survives the reader's character filter", f && readerWhere(f.where) === f.where && f.where.length > 0, f && f.where);
  guard("the webhook still answers 200 and nothing threw", s.res.status === 200 && !s.threw);
}

console.log("\n3) LINE refuses a reply in the 1 to 1 (429): where dm:reply, the later failure replaces the earlier one");
{
  const env = makeEnv();
  replyAnswer = refuse(400, "Invalid reply token");
  await send(env, [groupText("キラ、こんにちは")]);
  replyAnswer = refuse(429, "You have reached your monthly limit.");
  await send(env, [dmText("明日の予定をまとめて")]);
  replyAnswer = () => new Response("{}", { status: 200 });
  const f = (await health(env)).j.line_last_fail;
  check("the last one: api reply, status 429, where dm:reply", f && f.api === "reply" && f.status === 429 && f.where === "dm:reply", JSON.stringify(f));
}

console.log("\n4) a successful reply after a failure does not clear the record (the time tells the reader when)");
{
  const env = makeEnv();
  replyAnswer = refuse(500, "");
  await send(env, [dmText("こんにちは")]);
  replyAnswer = () => new Response("{}", { status: 200 });
  await send(env, [dmText("もう一度")]);
  const f = (await health(env)).j.line_last_fail;
  check("still the 500 of before", f && f.status === 500 && f.where === "dm:reply", JSON.stringify(f));
}

console.log("\n5) the reply cannot reach LINE (network error): status 0, kept, nothing thrown");
{
  const env = makeEnv();
  replyAnswer = () => { throw new TypeError("network down (test)"); };
  const s = await send(env, [dmText("こんにちは")]);
  replyAnswer = () => new Response("{}", { status: 200 });
  const f = (await health(env)).j.line_last_fail;
  check("kept: status 0, api reply, where dm:reply", f && f.status === 0 && f.api === "reply" && f.where === "dm:reply", JSON.stringify(f));
  guard("the event did not throw", !s.threw && s.res.status === 200);
}

console.log("\n6) whoami and the profile command: their own where");
{
  const env = makeEnv();
  replyAnswer = refuse(400, "Invalid reply token");
  await send(env, [dmText("whoami")]);
  let f = (await health(env)).j.line_last_fail;
  check("whoami refused: where dm:whoami", f && f.where === "dm:whoami" && f.status === 400, JSON.stringify(f));
  guard("/health does not carry the user ID the whoami reply had", !String(JSON.stringify(f)).includes(UID));
  await send(env, [dmText("プロフィール確認")]);
  f = (await health(env)).j.line_last_fail;
  check("profile refused: where dm:profile", f && f.where === "dm:profile", JSON.stringify(f));
  replyAnswer = () => new Response("{}", { status: 200 });
}

console.log("\n7) the record cannot be read: \"unreadable\", never null");
{
  const env = makeEnv({ failGet: (k) => k === KEY });
  const h = await health(env);
  check("KV get throws: line_last_fail is \"unreadable\"", h.j.line_last_fail === "unreadable", JSON.stringify(h.j.line_last_fail));
  guard("/health still answers 200 ok", h.status === 200 && h.j.status === "ok");
  const env2 = makeEnv();
  env2._kv.set(KEY, "{not json");
  check("a broken record: \"unreadable\"", (await health(env2)).j.line_last_fail === "unreadable");
  const env3 = makeEnv({ noKv: true });
  check("no KV binding: \"unreadable\" (a failure could not have been kept)", (await health(env3)).j.line_last_fail === "unreadable");
}

console.log("\n8) keeping the record fails or there is no KV: the event still ends quietly");
{
  const env = makeEnv({ failPut: (k) => k === KEY });
  replyAnswer = refuse(400, "Invalid reply token");
  const s = await send(env, [dmText("こんにちは")]);
  guard("KV put throws: the event did not throw", !s.threw && s.res.status === 200);
  const env2 = makeEnv({ noKv: true });
  const s2 = await send(env2, [dmText("こんにちは")]);
  guard("no KV binding: the event did not throw", !s2.threw && s2.res.status === 200);
  replyAnswer = () => new Response("{}", { status: 200 });
}

console.log("\nchecks: " + checks + ", guards: " + guards + ", failed: " + fail);
const EXPECT = 15, EXPECT_GUARDS = 9;
if (checks < EXPECT || guards < EXPECT_GUARDS) { console.log("fewer checks than expected (" + EXPECT + " + " + EXPECT_GUARDS + " guards)"); fail++; }
console.log(fail ? "line_last_fail checks FAILED" : "line_last_fail checks all passed");
process.exit(fail ? 1 : 0);
