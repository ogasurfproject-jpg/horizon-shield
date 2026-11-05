/* hs-kira-line v26: 送れたかを確かめる。ネットワークには出ない。

   なぜ要るか (2026-11-06):
     峰尾さま(No.002)が 11/5 22:35 に、こちらの問い「今の季節に施主さんへ伝えたいこと」へ
     1 対 1 で答えた。hearing には取り込まれた(q_en_season)のに、返事は届かず、毎時の拾い直しも出ず、
     大賀さんへの知らせも無かった。送信の関数が LINE の返事を見ていなかったため、断られても
     「送った」と記録していた。拾い直しは済みの印を送る前に付けていた。1 対 1 でも KIRA が黙れた。
   確かめること:
     ・1 対 1 の答えに KIRA が黙ると決めても、受け取りの一言を返す。お礼だけなら黙ってよい
     ・LINE が返信を断ったら、会話に「送った」と書かず、大賀さんへ知らせ、/health に残す
     ・その発言は毎時の拾い直しで送り直す。拾い直しも断られたら 3 回まで、毎回知らせる
     ・加盟店グループの返事でも同じ
     ・通信の失敗で投げない

   node workers/hs-kira-line/sendcheck_test.mjs
   直す前の版で落ちることを見る: KL_WORKER=src/worker.js.20261106-sendcheck.bak node workers/hs-kira-line/sendcheck_test.mjs
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.KL_WORKER ? path.resolve(HERE, process.env.KL_WORKER) : path.join(HERE, "src", "worker.js");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hskl-sc-"));
fs.copyFileSync(SRC, path.join(TMP, "worker.mjs"));
const W = (await import(path.join(TMP, "worker.mjs"))).default;
console.log("試す対象: " + SRC);

let fail = 0, checks = 0;
function check(label, cond, detail) {
  checks++;
  console.log((cond ? "  ok   " : "  NG   ") + label + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}

const SECRET = "test-channel-secret";
const OWNER = "U" + "c".repeat(32);
const DMU = "U" + "d".repeat(32);
const GID = "C" + "a".repeat(32);
const GUID = "U" + "b".repeat(32);
function makeEnv() {
  const kv = new Map();
  return {
    LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_TOKEN: "tok", LINE_USER_ID: OWNER, KIRA_BRIDGE_KEY: "bk", ANTHROPIC_API_KEY: "test-not-a-key",
    SEEN_STORE: {
      get: async (k) => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => { kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
      list: async (o) => ({ keys: [...kv.keys()].filter((k) => k.startsWith((o && o.prefix) || "")).map((name) => ({ name })) }),
    },
  };
}
async function dmEnv() { const env = makeEnv(); await env.SEEN_STORE.put("partner:" + DMU, JSON.stringify({ since: 1 })); await env.SEEN_STORE.put("kira_global_swept:v20", "1"); return env; }
function sign(body) { return crypto.createHmac("sha256", SECRET).update(body).digest("base64"); }
async function send(env, events) {
  const body = JSON.stringify({ events });
  const waits = [];
  const res = await W.fetch(new Request("https://x/webhook", { method: "POST", headers: { "content-type": "application/json", "x-line-signature": sign(body) }, body }), env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return res;
}
const runCron = async (env) => { const w = []; await W.scheduled({}, env, { waitUntil: (p) => w.push(p) }); await Promise.all(w); };
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

let calls = [];
let llmOut = null;
let bridgeExtra = { kind: "answer" };
// LINE の返事を決める: { reply: [status, message] | null, push: ..., pushTo: { <uid>: [status, message] }, throwPush: bool }
let line = {};
globalThis.fetch = async (url, init) => {
  const u = String(url);
  let body = null; try { body = JSON.parse((init && init.body) || "null"); } catch (_e) { body = null; }
  calls.push({ url: u, body });
  if (u.includes("/kira-bridge")) return new Response(JSON.stringify(Object.assign({ ok: true, reply: "" }, bridgeExtra)), { status: 200 });
  if (u.includes("api.anthropic.com") && llmOut !== null) return new Response(JSON.stringify({ content: [{ type: "text", text: llmOut }] }), { status: 200 });
  if (u.includes("/v2/bot/message/reply") && line.reply) return new Response(JSON.stringify({ message: line.reply[1] }), { status: line.reply[0] });
  if (u.includes("/v2/bot/message/push")) {
    if (line.throwPush) throw new Error("network down");
    const per = line.pushTo && body && line.pushTo[body.to];
    if (per) return new Response(JSON.stringify({ message: per[1] }), { status: per[0] });
  }
  return new Response("{}", { status: 200 });
};
const dmMsg = (text) => ({ type: "message", replyToken: "rt_dm", source: { type: "user", userId: DMU }, message: { type: "text", id: "d" + Math.random().toString(36).slice(2), text } });
const groupMsg = (text) => ({ type: "message", replyToken: "rt_group", source: { type: "group", groupId: GID, userId: GUID }, message: { type: "text", id: "g" + Math.random().toString(36).slice(2), text, mention: { mentionees: [{ index: 0, length: 15, type: "user", isSelf: true }] } } });
const replies = () => calls.filter((c) => c.url.includes("/v2/bot/message/reply"));
const pushTo = (uid) => calls.filter((c) => c.url.includes("/v2/bot/message/push") && c.body && c.body.to === uid);
const ownerText = () => pushTo(OWNER).map((c) => c.body.messages[0].text).join("\n");
const llms = () => calls.filter((c) => c.url.includes("api.anthropic.com"));
const conv = async (env, key) => JSON.parse((await env.SEEN_STORE.get("kira_gconv:" + key)) || "[]");
const SILENT = JSON.stringify({ action: "silent", reply: "", reason: "", lessons: [] });
const MINEO = "年末の大掃除前になると網戸の張替えが大変混み合います。\n早めにご依頼お願いします。";

console.log("\n1) 1 対 1 の答えに KIRA が黙ると決めても、受け取りの一言を返す(峰尾さまの 11/5)");
{
  const env = await dmEnv();
  calls = []; line = {}; bridgeExtra = { kind: "answer", asked: "q_en_season" }; llmOut = SILENT;
  await send(env, [dmMsg(MINEO)]);
  check("返信した", replies().length === 1, String(replies().length));
  check("答えへの受け取り(ご回答ありがとうございます)", replies()[0] && replies()[0].body.messages[0].text.startsWith("ご回答ありがとうございます"), replies()[0] && replies()[0].body.messages[0].text);
  const c = await conv(env, "dm:" + DMU);
  check("会話の最後は KIRA の返事(拾い直しで二重に送らない)", c.length && c[c.length - 1].who === "kira", c.length ? c[c.length - 1].who : "");
}

console.log("\n2) 1 対 1 でも、お礼や了解だけの発言なら黙ってよい");
{
  for (const t of ["ありがとうございます！", "了解です。よろしくお願いします。", "承知しました"]) {
    const env = await dmEnv();
    calls = []; line = {}; bridgeExtra = { kind: "aside" }; llmOut = SILENT;
    await send(env, [dmMsg(t)]);
    check("「" + t + "」には返さない", replies().length === 0, String(replies().length));
  }
}

console.log("\n3) 答えでない発言に KIRA が黙っても、受け取りの一言を返す");
{
  const env = await dmEnv();
  calls = []; line = {}; bridgeExtra = { kind: "question" }; llmOut = SILENT;
  await send(env, [dmMsg("来月の掲載はいつ頃になりますか")]);
  check("返信した", replies().length === 1);
  check("答え以外には「大賀からあらためて」の一言", replies()[0] && replies()[0].body.messages[0].text.includes("大賀"), replies()[0] && replies()[0].body.messages[0].text);
}

console.log("\n4) LINE が 1 対 1 の返信を断った: 送ったと書かず、大賀さんへ知らせ、/health に残す");
{
  const env = await dmEnv();
  calls = []; line = { reply: [400, "Invalid reply token"] }; bridgeExtra = { kind: "answer" };
  llmOut = JSON.stringify({ action: "reply", reply: "季節のお知らせ、ありがとうございます。", reason: "", lessons: [] });
  await send(env, [dmMsg(MINEO)]);
  const c = await conv(env, "dm:" + DMU);
  check("会話の最後は加盟店さんの発言のまま(送れていない)", c.length && c[c.length - 1].who === "member", c.length ? c[c.length - 1].who : "");
  check("大賀さんへ「返事が届いていません」と知らせた", ownerText().includes("返事が届いていません"), ownerText().slice(0, 80));
  check("知らせに LINE の理由を付けた", ownerText().includes("400") && ownerText().includes("Invalid reply token"));
  check("知らせに届いた発言と KIRA の文を付けた", ownerText().includes("網戸") && ownerText().includes("季節のお知らせ"));
  const h = await (await W.fetch(new Request("https://x/health"), env, { waitUntil: () => {} })).json();
  check("/health の line_last_fail に残した(reply 400)", h.line_last_fail && h.line_last_fail.api === "reply" && h.line_last_fail.status === 400, JSON.stringify(h.line_last_fail));
  check("/health に本文と相手の ID を出さない", !JSON.stringify(h).includes("網戸") && !JSON.stringify(h).includes(DMU));

  console.log("\n5) その発言は毎時の拾い直しで、おわびを付けて送り直す");
  const c2 = await conv(env, "dm:" + DMU);
  c2[c2.length - 1].at = ago(30);
  await env.SEEN_STORE.put("kira_gconv:dm:" + DMU, JSON.stringify(c2));
  calls = []; line = {}; llmOut = JSON.stringify({ action: "reply", reply: "季節のお知らせ、ありがとうございます。", reason: "", lessons: [] });
  await runCron(env);
  check("相手に push で送り直した", pushTo(DMU).length === 1, String(pushTo(DMU).length));
  check("おわびを頭に付けた", pushTo(DMU)[0] && pushTo(DMU)[0].body.messages[0].text.startsWith("お返事が遅くなり"));
  calls = [];
  await runCron(env);
  check("次の巡回では送らない", pushTo(DMU).length === 0 && llms().length === 0);
}

console.log("\n6) 拾い直しも断られた(月の上限など): 済みにせず 3 回まで送り直し、毎回知らせる");
{
  const env = await dmEnv();
  await env.SEEN_STORE.put("kira_gconv:dm:" + DMU, JSON.stringify([{ who: "member", text: MINEO, at: ago(40) }]));
  llmOut = JSON.stringify({ action: "reply", reply: "季節のお知らせ、ありがとうございます。", reason: "", lessons: [] });
  const tries = [];
  for (let i = 1; i <= 4; i++) {
    calls = []; line = { pushTo: { [DMU]: [429, "You have reached your monthly limit."] } };
    await runCron(env);
    tries.push({ toMember: pushTo(DMU).length, owner: ownerText() });
  }
  check("1 回目: 送ろうとした", tries[0].toMember === 1);
  check("1 回目: 大賀さんへ「拾い直しも届いていません」(1/3)", tries[0].owner.includes("拾い直しも届いていません") && tries[0].owner.includes("1/3"), tries[0].owner.slice(0, 80));
  check("知らせに 429 と上限の理由を付けた", tries[0].owner.includes("429") && tries[0].owner.includes("monthly limit"));
  check("2 回目も送り直した", tries[1].toMember === 1 && tries[1].owner.includes("2/3"));
  check("3 回目: 手で返すよう知らせた", tries[2].toMember === 1 && tries[2].owner.includes("手で返してください"));
  check("4 回目: もう送らない", tries[3].toMember === 0, String(tries[3].toMember));
  const h = await (await W.fetch(new Request("https://x/health"), env, { waitUntil: () => {} })).json();
  check("/health に push 429 を残した", h.line_last_fail && h.line_last_fail.api === "push" && h.line_last_fail.status === 429, JSON.stringify(h.line_last_fail));
}

console.log("\n7) 拾い直しでも 1 対 1 は黙らない(お礼だけでなければ)");
{
  const env = await dmEnv();
  await env.SEEN_STORE.put("kira_gconv:dm:" + DMU, JSON.stringify([{ who: "member", text: MINEO, at: ago(30) }]));
  calls = []; line = {}; llmOut = SILENT;
  await runCron(env);
  check("おわびと受け取りの一言を送った", pushTo(DMU).length === 1 && pushTo(DMU)[0].body.messages[0].text.startsWith("お返事が遅くなり"), pushTo(DMU)[0] && pushTo(DMU)[0].body.messages[0].text);
}

console.log("\n8) 加盟店グループの返事を LINE が断った: 送ったと書かず、知らせる");
{
  const env = makeEnv();
  await env.SEEN_STORE.put("kira_global_swept:v20", "1");
  await env.SEEN_STORE.put("groupPartner:" + GID, JSON.stringify({ store: "hs-partner-002" }));
  calls = []; line = { reply: [400, "Invalid reply token"] }; bridgeExtra = { kind: "answer" };
  llmOut = JSON.stringify({ action: "reply", reply: "ありがとうございます。", reason: "", lessons: [] });
  await send(env, [groupMsg("@HORIZON SHIELD 写真あとで送ります")]);
  const c = await conv(env, GID);
  check("返信を試みた", replies().length === 1);
  check("会話の最後は加盟店さんの発言のまま", c.length && c[c.length - 1].who === "member", c.length ? c[c.length - 1].who : "");
  check("大賀さんへ知らせた", ownerText().includes("加盟店グループ") && ownerText().includes("返事が届いていません"), ownerText().slice(0, 80));
}

console.log("\n9) 通信が落ちても送信の関数は投げない(拾い直しが止まらない)");
{
  const env = await dmEnv();
  await env.SEEN_STORE.put("kira_gconv:dm:" + DMU, JSON.stringify([{ who: "member", text: MINEO, at: ago(30) }]));
  calls = []; line = { throwPush: true }; llmOut = JSON.stringify({ action: "reply", reply: "ありがとうございます。", reason: "", lessons: [] });
  let threw = false;
  try { await runCron(env); } catch (_e) { threw = true; }
  check("巡回が投げない", !threw);
  const t = await env.SEEN_STORE.get("kira_catchup_try:dm:" + DMU + ":" + JSON.parse(await env.SEEN_STORE.get("kira_gconv:dm:" + DMU))[0].at);
  check("送れなかった回数を数えた(済みにしない)", t === "1", String(t));
}

console.log("\n10) /health の版");
{
  const h = await (await W.fetch(new Request("https://x/health"), makeEnv(), { waitUntil: () => {} })).json();
  check("version は v26-sendcheck-20261106", h.version === "v26-sendcheck-20261106", h.version);
  check("送れなかった記録が無ければ line_last_fail は null", h.line_last_fail === null, JSON.stringify(h.line_last_fail));
}

const EXPECT = 32;
console.log("\n確かめた数: " + checks + " (最低 " + EXPECT + ")");
if (checks < EXPECT) { console.log("  NG   試験がまるごと走っていません。"); fail++; }
console.log(fail ? fail + " 件 失敗" : "送れたかの確かめ すべて通過");
process.exit(fail ? 1 : 0);
