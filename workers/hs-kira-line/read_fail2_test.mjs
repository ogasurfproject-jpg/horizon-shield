/* hs-kira-line: what KIRA reads before it answers, when that read FAILS (issue #13, second pass, 2026-10-13).
   Offline, no network: the real worker, with KV and fetch mocked.

   A failed read is not an empty one. When the chat history, the partner flag, the store's group, the lessons
   or the conversation cannot be read, KIRA does not answer as if it had none, nothing is saved over the data it
   could not read, and the owner gets the text. Every "fix" check fails on 35371672 and passes after the fix.
   The "guard" checks pass on both: they pin the success path, which must not change.

   node workers/hs-kira-line/read_fail2_test.mjs
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
const OWNER = "U" + "c".repeat(32);
const GID = "C" + "a".repeat(32);
const UID = "U" + "b".repeat(32);
const CONSUMER = "U" + "e".repeat(32);
const QUOTE_ACK = "ご返信ありがとうございます。内容を確認して、担当の大賀からあらためてお返事します。";
const PHOTO_ACK = "写真を受け取りました。ありがとうございます。担当の大賀が確認します。";

// failGet(key, n): n is how many times this key has been read so far in this env (1 for the first read).
function makeEnv(opts) {
  const o = opts || {};
  const kv = new Map();
  const puts = [];
  const reads = new Map();
  return {
    LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_TOKEN: "tok", LINE_USER_ID: OWNER, KIRA_BRIDGE_KEY: "bk", ANTHROPIC_API_KEY: "test-not-a-key",
    KIRA_SET_WAIT_MS: "1",
    _kv: kv, _puts: puts,
    SEEN_STORE: {
      get: async (k) => {
        const n = (reads.get(k) || 0) + 1; reads.set(k, n);
        if (o.failGet && o.failGet(k, n)) throw new Error("KV get failed (test)");
        return kv.has(k) ? kv.get(k) : null;
      },
      put: async (k, v) => { puts.push(k); kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
      list: async (q) => {
        const p = (q && q.prefix) || "";
        return { keys: [...kv.keys()].filter((k) => k.startsWith(p)).map((name) => ({ name })) };
      },
    },
  };
}
function sign(body) { return crypto.createHmac("sha256", SECRET).update(body).digest("base64"); }
async function send(env, events) {
  const body = JSON.stringify({ events });
  const waits = [];
  const res = await W.fetch(new Request("https://x/webhook", { method: "POST", headers: { "content-type": "application/json", "x-line-signature": sign(body) }, body }), env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return res;
}
const runCron = async (env) => { const w = []; await W.scheduled({}, env, { waitUntil: (p) => w.push(p) }); await Promise.all(w); };

let calls = [];
let bridgeOut = { ok: true, reply: "", kind: "other" };
let vision = { kind: "site_photo", is_estimate: false, estimates: [], description: "内窓を付ける前の掃き出し窓" };
const DECISION = JSON.stringify({ action: "reply", reply: "写真をありがとうございます。内窓の前の様子ですね。", reason: "-", lessons: [{ scope: "global", text: "写真には一言で中身を返すと喜ばれる" }] });
globalThis.fetch = async (url, init) => {
  const u = String(url);
  let body = null; try { body = JSON.parse((init && init.body) || "null"); } catch (_e) { body = null; }
  calls.push({ url: u, body });
  if (u.includes("/kira-bridge")) return new Response(JSON.stringify(bridgeOut), { status: 200 });
  if (u.includes("api-data.line.me")) return new Response(new Uint8Array([255, 216, 255, 1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
  if (u.includes("api.anthropic.com")) {
    const sys = String((body && body.system) || "");
    if (sys.includes("写真やファイルを読み")) return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(vision) }] }), { status: 200 });
    if (sys.includes("加盟店さん(施工会社")) return new Response(JSON.stringify({ content: [{ type: "text", text: DECISION }] }), { status: 200 });
    return new Response(JSON.stringify({ content: [{ type: "text", text: "こんにちは、KIRA です。" }] }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
};
const replies = () => calls.filter((c) => c.url.includes("/v2/bot/message/reply"));
const replyText = () => { const r = replies()[0]; return (r && r.body && r.body.messages[0].text) || ""; };
const pushes = () => calls.filter((c) => c.url.includes("/v2/bot/message/push"));
const pushTo = (to) => pushes().filter((c) => c.body && c.body.to === to);
const ownerSaid = (s) => pushTo(OWNER).some((c) => c.body.messages[0].text.includes(s));
const llms = () => calls.filter((c) => c.url.includes("api.anthropic.com"));
const decideCalls = () => llms().filter((c) => String((c.body && c.body.system) || "").includes("加盟店さん(施工会社"));
const bridges = () => calls.filter((c) => c.url.includes("/kira-bridge"));
const mid = (p) => p + Math.random().toString(36).slice(2);
const dmText = (from, text) => ({ type: "message", replyToken: "rt_dm", source: { type: "user", userId: from }, message: { type: "text", id: mid("t"), text } });
const dmImage = (from) => ({ type: "message", replyToken: "rt_img", source: { type: "user", userId: from }, message: { type: "image", id: mid("i") } });
const groupAt = (text) => ({
  type: "message", replyToken: "rt_group", source: { type: "group", groupId: GID, userId: UID },
  message: { type: "text", id: mid("g"), text, mention: { mentionees: [{ index: 0, length: 15, type: "user", isSelf: true }] } },
});
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const OLD_CHAT = JSON.stringify({ messages: [{ role: "user", content: "外壁の見積が高い気がします" }, { role: "assistant", content: "金額を教えてください" }], phase: "HEARING", visitCount: 3, usedTalks: [], registeredAt: 1, followupSent: [] });

console.log("\n1) consumer 1 to 1: the chat history cannot be read");
{
  const env = makeEnv({ failGet: (k) => k === "chat:" + CONSUMER });
  env._kv.set("chat:" + CONSUMER, OLD_CHAT);
  calls = [];
  await send(env, [dmText(CONSUMER, "その後どうなりましたか")]);
  check("history not overwritten (no put to chat:<uid>, record intact)", !env._puts.includes("chat:" + CONSUMER) && env._kv.get("chat:" + CONSUMER) === OLD_CHAT);
  check("KIRA does not answer as if the conversation were empty (model not called)", llms().length === 0);
  check("only the neutral receipt is sent", replies().length === 1 && replyText() === QUOTE_ACK, replyText().slice(0, 40));
  check("the owner gets the text and why", ownerSaid("会話の記録を今は読み込めなかった") && ownerSaid("その後どうなりましたか"));
  const env2 = makeEnv();
  env2._kv.set("chat:" + CONSUMER, OLD_CHAT);
  calls = [];
  await send(env2, [dmText(CONSUMER, "その後どうなりましたか")]);
  const saved = JSON.parse(env2._kv.get("chat:" + CONSUMER) || "{}");
  guard("normal: model sees the stored history plus the new message, and it is saved", llms().length === 1 && llms()[0].body.messages.length === 3 && saved.messages && saved.messages.length === 4);
}

console.log("\n2) consumer photo: the chat history cannot be read (follow-up clock)");
{
  const env = makeEnv({ failGet: (k) => k === "chat:" + CONSUMER });
  env._kv.set("chat:" + CONSUMER, OLD_CHAT);
  calls = [];
  await send(env, [dmImage(CONSUMER)]);
  check("touchDiagnosis does not save a fresh record over the unread history", !env._puts.includes("chat:" + CONSUMER) && env._kv.get("chat:" + CONSUMER) === OLD_CHAT);
  const env2 = makeEnv();
  env2._kv.set("chat:" + CONSUMER, OLD_CHAT);
  calls = [];
  await send(env2, [dmImage(CONSUMER)]);
  const saved = JSON.parse(env2._kv.get("chat:" + CONSUMER) || "{}");
  guard("normal: the clock is touched and the history kept", saved.lastKind === "diagnosis" && saved.messages.length === 2);
}

console.log("\n3) 1 to 1: the partner flag cannot be read");
{
  const env = makeEnv({ failGet: (k) => k === "partner:" + UID });
  env._kv.set("partner:" + UID, JSON.stringify({ since: 1, groupId: GID }));
  calls = [];
  await send(env, [dmText(UID, "先日の件、写真を送ります")]);
  check("text: not treated as a consumer (no consumer chat model call)", llms().length === 0);
  check("text: no consumer chat record is created for the store", !env._puts.includes("chat:" + UID));
  check("text: only the neutral receipt is sent", replies().length === 1 && replyText() === QUOTE_ACK, replyText().slice(0, 40));
  check("text: the owner gets the text and why", ownerSaid("加盟店かどうかを今は読み込めなかった") && ownerSaid("先日の件、写真を送ります"));
  calls = [];
  await send(env, [dmImage(UID)]);
  check("photo: no consumer diagnosis (no model call, no ¥5,500 copy), only the neutral receipt", llms().length === 0 && replies().length === 1 && replyText() === PHOTO_ACK, replyText().slice(0, 40));
  check("photo: the owner is told KIRA did not read it", ownerSaid("KIRA は写真を読んでいません"));
}

console.log("\n4) partner group: the lessons or the conversation cannot be read");
for (const failKey of ["kira_lessons:" + GID, "kira_lessons:global", "kira_gconv:" + GID]) {
  const env = makeEnv({ failGet: (k) => k === failKey });
  env._kv.set("groupPartner:" + GID, "1");
  env._kv.set("kira_lessons:" + GID, JSON.stringify([{ t: "連絡は朝がよい", at: "x", by: "kira" }]));
  calls = [];
  bridgeOut = { ok: true, reply: "", kind: "other" };
  await send(env, [groupAt("@HORIZON SHIELD 来週の段取りはどうなりますか")]);
  check(failKey + ": KIRA does not decide without it (no decision call)", decideCalls().length === 0);
  check(failKey + ": only the neutral receipt, and the owner is told why", replyText() === QUOTE_ACK && ownerSaid("経験帳か会話を今は読み込めなかった"));
}
{
  const env = makeEnv();
  env._kv.set("groupPartner:" + GID, "1");
  env._kv.set("kira_lessons:" + GID, JSON.stringify([{ t: "連絡は朝がよい", at: "x", by: "kira" }]));
  calls = [];
  await send(env, [groupAt("@HORIZON SHIELD 来週の段取りはどうなりますか")]);
  const ctx = (decideCalls()[0] && decideCalls()[0].body.messages[0].content) || "";
  guard("normal: KIRA decides with the store's lessons and replies", ctx.includes("連絡は朝がよい") && replyText().startsWith("写真をありがとうございます"));
}

console.log("\n5) partner 1 to 1: lessons unreadable, or the store's group unreadable");
{
  const env = makeEnv({ failGet: (k) => k === "kira_lessons:" + GID });
  env._kv.set("partner:" + UID, JSON.stringify({ since: 1, groupId: GID }));
  calls = [];
  bridgeOut = { ok: true, reply: "", kind: "other" };
  await send(env, [dmText(UID, "来週の段取りはどうなりますか")]);
  check("lessons unreadable: no decision, neutral receipt, owner told why", decideCalls().length === 0 && replyText() === QUOTE_ACK && ownerSaid("経験帳か会話を今は読み込めなかった"));
}
{
  // the first read of partner:<uid> (is this a store?) works; the second (which group?) fails
  const env = makeEnv({ failGet: (k, n) => k === "partner:" + UID && n >= 2 });
  env._kv.set("partner:" + UID, JSON.stringify({ since: 1, groupId: GID }));
  calls = [];
  await send(env, [dmText(UID, "来週の段取りはどうなりますか")]);
  check("group unreadable: not handed to hearing without its group", bridges().length === 0);
  check("group unreadable: no decision with a guessed scope, neutral receipt, owner told", decideCalls().length === 0 && replyText() === QUOTE_ACK && ownerSaid("所属グループを今は読み込めなかった"));
  const env2 = makeEnv();
  env2._kv.set("partner:" + UID, JSON.stringify({ since: 1, groupId: GID }));
  calls = [];
  await send(env2, [dmText(UID, "来週の段取りはどうなりますか")]);
  guard("normal: hearing gets the store's group and KIRA replies", bridges().length === 1 && bridges()[0].body.groupId === GID && replyText().startsWith("写真をありがとうございます"));
}

console.log("\n6) partner photo in 1 to 1: the store's group cannot be read");
{
  const env = makeEnv({ failGet: (k, n) => k === "partner:" + UID && n >= 2 });
  env._kv.set("partner:" + UID, JSON.stringify({ since: 1, groupId: GID }));
  calls = [];
  vision = { kind: "site_photo", is_estimate: false, estimates: [], description: "内窓を付ける前の掃き出し窓" };
  await send(env, [dmImage(UID)]);
  check("site photo: KIRA does not decide with a guessed scope; the fixed receipt is sent", decideCalls().length === 0 && replyText() === PHOTO_ACK, replyText().slice(0, 40));
  const env2 = makeEnv({ failGet: (k, n) => k === "partner:" + UID && n >= 2 });
  env2._kv.set("partner:" + UID, JSON.stringify({ since: 1, groupId: GID }));
  calls = [];
  vision = { kind: "estimate", is_estimate: true, estimates: [{ work: "外壁塗装", amount: "1200000" }], summary: "外壁塗装の見積" };
  await send(env2, [dmImage(UID)]);
  check("estimate: not handed to hearing without its group, and the owner line says so", bridges().length === 0 && ownerSaid("hearing に渡せなかった"));
  const env3 = makeEnv();
  env3._kv.set("partner:" + UID, JSON.stringify({ since: 1, groupId: GID }));
  calls = [];
  vision = { kind: "site_photo", is_estimate: false, estimates: [], description: "内窓を付ける前の掃き出し窓" };
  await send(env3, [dmImage(UID)]);
  guard("normal: KIRA decides on the photo and replies", decideCalls().length === 1 && replyText().startsWith("写真をありがとうございます"));
}

console.log("\n7) catch-up (hourly): the store's group cannot be read");
{
  const env = makeEnv({ failGet: (k) => k === "partner:" + UID });
  env._kv.set("kira_global_swept:v20", "1");
  env._kv.set("kira_gconv:dm:" + UID, JSON.stringify([{ who: "member", text: "見積の件、どうなりましたか", at: ago(30) }]));
  calls = [];
  await runCron(env);
  check("no late reply decided with a guessed scope (nothing pushed to the store)", pushTo(UID).length === 0 && decideCalls().length === 0);
  check("the owner is told it needs a look, and why", ownerSaid("返事漏れ 要確認") && ownerSaid("経験帳か会話を今は読み込めなかった"));
  const env2 = makeEnv();
  env2._kv.set("kira_global_swept:v20", "1");
  env2._kv.set("partner:" + UID, JSON.stringify({ since: 1, groupId: GID }));
  env2._kv.set("kira_gconv:dm:" + UID, JSON.stringify([{ who: "member", text: "見積の件、どうなりましたか", at: ago(30) }]));
  calls = [];
  await runCron(env2);
  guard("normal: the late reply is sent to the store", pushTo(UID).length === 1);
}

console.log("\n8) owner commands: a 1 to 1 conversation or the pending relay cannot be read");
{
  const env = makeEnv({ failGet: (k) => k === "kira_gconv:dm:" + UID });
  env._kv.set("kira_gconv:dm:" + UID, JSON.stringify([{ who: "member", text: "よろしく", at: ago(5) }]));
  calls = [];
  await send(env, [dmText(OWNER, "1対1一覧")]);
  check("1対1一覧: told it could not be read (not a list missing that store)", replyText().includes("今は読み込めませんでした"), replyText().slice(0, 40));
  calls = [];
  await send(env, [dmText(OWNER, "1対1へ 明日伺います")]);
  check("1対1へ: nothing staged to send, owner told", !env._puts.includes("kira_relay_pending") && replyText().includes("何も送っていません"));
  const env2 = makeEnv({ failGet: (k) => k === "kira_relay_pending" });
  env2._kv.set("kira_relay_pending", JSON.stringify({ body: "明日伺います", send: true, at: Date.now(), dm: true, targets: [UID] }));
  calls = [];
  await send(env2, [dmText(OWNER, "1")]);
  check("number reply: told the candidates could not be read and nothing was sent (no fall-through to the consumer chat)", replyText().includes("送り先の候補を今は読み込めませんでした") && replyText().includes("何も送っていません") && llms().length === 0 && pushTo(UID).length === 0);
  const env3 = makeEnv();
  env3._kv.set("kira_gconv:dm:" + UID, JSON.stringify([{ who: "member", text: "よろしく", at: ago(5) }]));
  calls = [];
  await send(env3, [dmText(OWNER, "1対1一覧")]);
  guard("normal: 1対1一覧 lists the store with its latest line", replyText().includes("1 対 1(新しい順)") && replyText().includes("よろしく"));
}

console.log("\n9) version");
{
  const r = await W.fetch(new Request("https://x/health"), makeEnv(), { waitUntil: () => {} });
  const j = await r.json();
  check("/health version is v26-sendcheck-20261106 (bumped by v26 2026-11-06)", j.version === "v26-sendcheck-20261106", j.version);
}

console.log("\nchecks: " + checks + ", guards: " + guards + ", failed: " + fail);
const EXPECT = 28, EXPECT_GUARDS = 7;
if (checks < EXPECT || guards < EXPECT_GUARDS) { console.log("fewer checks than expected (" + EXPECT + " + " + EXPECT_GUARDS + " guards)"); fail++; }
console.log(fail ? "read-failure (context) checks FAILED" : "read-failure (context) checks all passed");
process.exit(fail ? 1 : 0);
