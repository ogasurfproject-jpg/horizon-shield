/* hs-kira-line: when hearing answers the bridge with a failed read (issue #13, third pass, 2026-10-13).
   Offline, no network: the real worker, with KV and fetch mocked.

   hs-hearing now answers /kira-bridge with 503 intake_read_failed or store_read_failed when it could not read the
   conversation's intake or store (it wrote nothing). In a 1 to 1 KIRA then does not decide either: it sends the
   neutral receipt and the owner gets the text and which read failed. In a group the owner line names the code.
   Every "fix" check fails on d118ad9e and passes after the fix. The "guard" checks pass on both: they pin the
   behaviour on an ordinary hearing outage, which must not change.

   node workers/hs-kira-line/read_fail3_test.mjs
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
let bridgeStatus = 200;
let vision = { kind: "site_photo", is_estimate: false, estimates: [], description: "内窓を付ける前の掃き出し窓" };
const DECISION = JSON.stringify({ action: "reply", reply: "写真をありがとうございます。内窓の前の様子ですね。", reason: "-", lessons: [{ scope: "global", text: "写真には一言で中身を返すと喜ばれる" }] });
globalThis.fetch = async (url, init) => {
  const u = String(url);
  let body = null; try { body = JSON.parse((init && init.body) || "null"); } catch (_e) { body = null; }
  calls.push({ url: u, body });
  if (u.includes("/kira-bridge")) return new Response(typeof bridgeOut === "string" ? bridgeOut : JSON.stringify(bridgeOut), { status: bridgeStatus });
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


for (const code of ["intake_read_failed", "store_read_failed"]) {
  console.log("\n1) partner 1 to 1: hearing answers 503 " + code);
  const env = makeEnv();
  env._kv.set("partner:" + UID, JSON.stringify({ since: 1, groupId: GID }));
  calls = [];
  bridgeStatus = 503; bridgeOut = { ok: false, error: code };
  await send(env, [dmText(UID, "訪問看護です")]);
  guard(code + ": the bridge was asked once", bridges().length === 1);
  check(code + ": KIRA does not decide without hearing's record (no decision call)", decideCalls().length === 0);
  check(code + ": only the neutral receipt is sent", replies().length === 1 && replyText() === QUOTE_ACK, replyText().slice(0, 40));
  check(code + ": the owner gets the text and which read failed", ownerSaid(code) && ownerSaid("訪問看護です"));
}

console.log("\n2) partner group: hearing answers 503 store_read_failed");
{
  const env = makeEnv();
  env._kv.set("groupPartner:" + GID, "1");
  calls = [];
  bridgeStatus = 503; bridgeOut = { ok: false, error: "store_read_failed" };
  await send(env, [groupAt("@HORIZON SHIELD 来週の段取りはどうなりますか")]);
  check("the owner line names the failed read", ownerSaid("転送失敗") && ownerSaid("store_read_failed"));
}

console.log("\n3) an ordinary hearing outage (not a read failure) is handled as before");
{
  const env = makeEnv();
  env._kv.set("partner:" + UID, JSON.stringify({ since: 1, groupId: GID }));
  calls = [];
  bridgeStatus = 500; bridgeOut = "down";
  await send(env, [dmText(UID, "来週の段取りはどうなりますか")]);
  guard("500: KIRA still decides and replies", decideCalls().length === 1 && replyText().startsWith("写真をありがとうございます"), replyText().slice(0, 40));
  guard("500: the owner is told it was not handed over", ownerSaid("渡せませんでした") && ownerSaid("status 500"));
  const env2 = makeEnv();
  env2._kv.set("partner:" + UID, JSON.stringify({ since: 1, groupId: GID }));
  calls = [];
  bridgeStatus = 200; bridgeOut = { ok: true, reply: "", kind: "other" };
  await send(env2, [dmText(UID, "来週の段取りはどうなりますか")]);
  guard("normal: hearing answers 200 and KIRA replies", bridges().length === 1 && decideCalls().length === 1 && replyText().startsWith("写真をありがとうございます"));
}

console.log("\n4) version");
{
  const r = await W.fetch(new Request("https://x/health"), makeEnv(), { waitUntil: () => {} });
  const j = await r.json();
  check("/health version is v26-sendcheck-20261106 (bumped by v26 2026-11-06)", j.version === "v26-sendcheck-20261106", j.version);
}

console.log("\nchecks: " + checks + ", guards: " + guards + ", failed: " + fail);
const EXPECT = 8, EXPECT_GUARDS = 5;
if (checks < EXPECT || guards < EXPECT_GUARDS) { console.log("fewer checks than expected (" + EXPECT + " + " + EXPECT_GUARDS + " guards)"); fail++; }
console.log(fail ? "read-failure (hearing bridge) checks FAILED" : "read-failure (hearing bridge) checks all passed");
process.exit(fail ? 1 : 0);
