/* hs-kira-line v28: お支払いの案内を AI に書かせない。ネットワークには出ない。

   なぜ要るか (2026-11-25):
     17:16 JST、お客さま(施主)の「クレジットカードでお支払いお願いいたします」が、決まった 6 つの言葉
     (「申し込みます」「振込先を教えて」など)に当たらず AI(haiku)に回った。KIRA_SYSTEM には古い
     「銀行振込のみ対応(クレジットカード決済は準備中)」「申し込み意思確認後に振込先をご案内」が残っていて、
     AI は振込先を知らないまま、実在しない振込先(銀行・支店・番号・名義)を作って送った。PayPal(カード可)も
     出さなかった。決まった文の振込先も、名義の途中の空白で切れて「The」とだけ出ていた。
   確かめること:
     ・支払いの話は、どの言い回しでも、どの段でも AI に渡さず、決まった文(PayPal と正しい振込先)で返す
     ・名義は空白を含めて全部出す(「The」で切らない)
     ・AI の返事に振込先らしき語、知らない PayPal のリンク、「カードは準備中」の類が出たら、送らずに差し替えて大賀さんへ知らせる
     ・返金・取り消し・振り込んでしまった、は AI に渡さず大賀さんへ回す
     ・大賀さんが「人が返す」にした相手には KIRA は返さず(受け取りの一言は 6 時間に 1 回)、届いた文と写真を回す。追客も送らない
     ・KIRA_SYSTEM に「準備中」「銀行振込のみ」が無く、PayPal がある。勧めの文は「振込先をご案内」でなく PayPal と振込の案内

   node workers/hs-kira-line/payment_test.mjs
   直す前の版で落ちることを見る: KL_WORKER=<v27 の worker.js> node workers/hs-kira-line/payment_test.mjs
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.KL_WORKER ? path.resolve(HERE, process.env.KL_WORKER) : path.join(HERE, "src", "worker.js");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hskl-pay-"));
fs.copyFileSync(SRC, path.join(TMP, "worker.mjs"));
const W = (await import(path.join(TMP, "worker.mjs"))).default;
console.log("試す対象: " + SRC);

let fail = 0, checks = 0;
function check(label, cond, detail) {
  checks++;
  console.log((cond ? "  ok   " : "  NG   ") + label + (detail ? "  " + String(detail).slice(0, 160).replace(/\n/g, " / ") : ""));
  if (!cond) fail++;
}

const SECRET = "test-channel-secret";
const OWNER = "U" + "c".repeat(32);
const CU = "U" + "e".repeat(32);
const BANK = "静岡銀行 平塚支店 普通 1234567 ザ ホライズンズ（カ";
function makeEnv(bank = BANK) {
  const kv = new Map();
  return {
    LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_TOKEN: "tok", LINE_USER_ID: OWNER, KIRA_BRIDGE_KEY: "bk", ANTHROPIC_API_KEY: "test-not-a-key",
    BANK_INFO: bank, _kv: kv,
    SEEN_STORE: {
      get: async (k) => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => { kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
      list: async (o) => ({ keys: [...kv.keys()].filter((k) => k.startsWith((o && o.prefix) || "")).map((name) => ({ name })), list_complete: true }),
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
let llmOut = "ご相談ありがとうございます。外壁塗装の相場は、30坪のシリコンで80〜120万円ほどです。";
globalThis.fetch = async (url, init) => {
  const u = String(url);
  let body = null; try { body = JSON.parse((init && init.body) || "null"); } catch (_e) { body = null; }
  calls.push({ url: u, body });
  if (u.includes("api.anthropic.com")) return new Response(JSON.stringify({ content: [{ type: "text", text: llmOut }] }), { status: 200 });
  return new Response("{}", { status: 200 });
};
const textMsg = (uid, text) => ({ type: "message", replyToken: "rt_" + Math.random().toString(36).slice(2), source: { type: "user", userId: uid }, message: { type: "text", id: "m" + Math.random().toString(36).slice(2), text } });
const imageMsg = (uid) => ({ type: "message", replyToken: "rt_img", source: { type: "user", userId: uid }, message: { type: "image", id: "i" + Math.random().toString(36).slice(2) } });
const replies = () => calls.filter((c) => c.url.includes("/v2/bot/message/reply"));
const replyText = () => replies().map((c) => c.body.messages.map((m) => m.text).join("\n")).join("\n");
const pushTo = (uid) => calls.filter((c) => c.url.includes("/v2/bot/message/push") && c.body && c.body.to === uid);
const ownerText = () => pushTo(OWNER).map((c) => c.body.messages[0].text).join("\n");
const llms = () => calls.filter((c) => c.url.includes("api.anthropic.com"));
async function withPhase(env, phase, extra = {}) {
  await env.SEEN_STORE.put("chat:" + CU, JSON.stringify(Object.assign({ messages: [{ role: "user", content: "外壁塗装の見積もりが高い気がします" }, { role: "assistant", content: "見積書を見せてください。" }], phase, registeredAt: Date.now() - 3600e3, followupSent: [] }, extra)));
}

console.log("\n1) 11-25 の言い回し「クレジットカードでお支払いお願いいたします」: AI に渡さず決まった文で返す");
{
  const env = makeEnv();
  await withPhase(env, "CLOSING");
  calls = [];
  llmOut = "申し訳ございません。現在クレジットカード決済の準備中のため銀行振込のみです。楽天銀行 支店名：第二営業支店 口座番号：0000000";
  await send(env, [textMsg(CU, "クレジットカードでお支払いお願いいたします")]);
  const r = replyText();
  check("AI を呼ばない", llms().length === 0, String(llms().length));
  check("1 回だけ返した", replies().length === 1, String(replies().length));
  check("PayPal の 5,500 円のリンク", r.includes("https://www.paypal.com/ncp/payment/H747QJMWFM4BS"), r);
  check("カードで払える(PayPal のアカウントが無くても)", r.includes("PayPal のアカウントをお持ちでなくても、カードでお支払いいただけます"), r);
  check("正しい振込先(静岡銀行 平塚支店)", r.includes("銀行名：静岡銀行") && r.includes("支店名：平塚支店"), r);
  check("名義を空白ごと全部出す", r.includes("口座名義：ザ ホライズンズ（カ"), r);
  check("作られた振込先は出ない", !r.includes("楽天") && !r.includes("第二営業支店") && !r.includes("0000000"));
  check("「準備中」は出ない", !r.includes("準備中"));
  check("大賀さんへ「お支払い案内送付」", ownerText().includes("お支払い案内送付"), ownerText());
}

console.log("\n2) 前の BANK_INFO(名義が The HORIZ音s株式会社)でも、名義を「The」で切らない");
{
  const env = makeEnv("静岡銀行 平塚支店 普通 1234567 The HORIZ音s株式会社");
  await withPhase(env, "PROPOSAL");
  calls = [];
  await send(env, [textMsg(CU, "申し込みます")]);
  const r = replyText();
  check("名義が「The HORIZ音s株式会社」全部", r.includes("口座名義：The HORIZ音s株式会社"), r);
}

console.log("\n3) 最初の段(GREETING)でも、支払いの問いには決まった文で返す。言い回しを替えても同じ");
for (const t of ["支払い方法を教えて", "カード払いはできますか？", "PayPalで払えますか", "振込先を知りたいです", "決済方法は？"]) {
  const env = makeEnv();
  calls = [];
  await send(env, [textMsg(CU, t)]);
  check("「" + t + "」: AI を呼ばず PayPal と振込の案内", llms().length === 0 && replyText().includes("H747QJMWFM4BS") && replyText().includes("静岡銀行"), replyText());
}

console.log("\n4) 返金・取り消し・振り込んでしまった: AI に渡さず、大賀さんへ回す");
for (const t of ["さっきの口座に振り込んでしまいました", "返金してください", "キャンセルしたいです"]) {
  const env = makeEnv();
  await withPhase(env, "COMPLETE");
  calls = [];
  await send(env, [textMsg(CU, t)]);
  check("「" + t + "」: AI を呼ばない", llms().length === 0);
  check("「" + t + "」: 担当の大賀から連絡と返す", replyText().includes("担当の大賀から直接ご連絡"), replyText());
  check("「" + t + "」: 大賀さんへ要対応で知らせる", ownerText().includes("お金の手続きの問い合わせ") && ownerText().includes(t), ownerText());
  check("「" + t + "」: 振込先を出さない", !replyText().includes("静岡銀行"));
}

console.log("\n5) AI の返事に振込先らしき物が出たら、送らずに差し替えて知らせる");
for (const [name, out] of [
  ["作られた振込先", "お振込先は楽天銀行 第二営業支店 普通預金 口座番号 0000000 口座名義 ホライズンシールド です。"],
  ["知らない PayPal のリンク", "こちらからどうぞ https://www.paypal.com/ncp/payment/ZZZZZZZZZZZZZ"],
  ["カードは準備中", "申し訳ございません。クレジットカード決済は準備中です。"],
]) {
  const env = makeEnv();
  await withPhase(env, "DIAGNOSIS");
  calls = []; llmOut = out;
  await send(env, [textMsg(CU, "外壁塗装の見積もり、この金額は相場と比べてどうですか？")]);
  const r = replyText();
  check(name + ": AI は呼んだ(支払いの問いではない)", llms().length === 1);
  check(name + ": 送った文は決まったお支払いの案内", r.includes("H747QJMWFM4BS") && r.includes("静岡銀行"), r);
  check(name + ": AI の文は送らない", !r.includes("楽天") && !r.includes("ZZZZZZZZZZZZZ") && !r.includes("準備中"), r);
  check(name + ": 大賀さんへ「差し替えた」と知らせ、数字は伏せる", ownerText().includes("KIRA の返事を差し替えた") && !ownerText().includes("0000000"), ownerText());
}

console.log("\n6) お金の話の無い AI の返事は、そのまま送る");
{
  const env = makeEnv();
  await withPhase(env, "DIAGNOSIS");
  calls = []; llmOut = "外壁塗装は30坪のシリコンで80〜120万円ほどが目安です。見積書を見せていただければ確認します。";
  await send(env, [textMsg(CU, "外壁塗装の相場はいくらくらいですか")]);
  check("AI の文をそのまま送った", replyText().startsWith("外壁塗装は30坪のシリコンで"), replyText());
  check("差し替えの知らせは無い", !ownerText().includes("差し替えた"));
}

console.log("\n7) KIRA_SYSTEM: 「準備中」「銀行振込のみ」が無く、PayPal と「振込先を書かない」がある");
{
  const env = makeEnv();
  calls = []; llmOut = "はい、ご相談ください。";
  await send(env, [textMsg(CU, "外壁のひび割れが気になっています")]);
  const sys = (llms()[0] && llms()[0].body && llms()[0].body.system) || "";
  check("AI に渡す指示に「準備中」が無い", sys.length > 0 && !sys.includes("準備中"), sys.slice(0, 40));
  check("「銀行振込のみ」が無い", !sys.includes("銀行振込のみ"));
  check("PayPal がある", sys.includes("PayPal"));
  check("「振込先・PayPal のリンクを絶対に書かない」がある", sys.includes("絶対に書かない"));
}

console.log("\n8) 勧めの文(CLOSING): 「振込先をご案内」でなく、PayPal(カード可)と振込の案内");
{
  const env = makeEnv();
  await withPhase(env, "PROPOSAL");
  calls = []; llmOut = "まずは逆見積もり診断がおすすめです。<STATE>{\"phase\":\"CLOSING\",\"service\":\"SVC-00\"}</STATE>";
  await send(env, [textMsg(CU, "診断をお願いしたいです")]);
  const r = replyText();
  check("PayPal(カード可)と書く", r.includes("PayPal(カード可)"), r);
  check("「振込先をご案内します」は無い", !r.includes("振込先をご案内します"), r);
}

console.log("\n9) 人が返す: 大賀さんの 1 対 1 の言葉で入れる、一覧、戻す");
{
  const env = makeEnv();
  calls = [];
  await send(env, [textMsg(OWNER, "人が返す " + CU)]);
  check("入れたと返す", replyText().includes("以後 " + CU + " には KIRA は返さず"), replyText());
  check("KV に human:<id>", env._kv.has("human:" + CU));
  calls = [];
  await send(env, [textMsg(OWNER, "人が返す一覧")]);
  check("一覧に出る", replyText().includes(CU), replyText());

  console.log("\n10) 人が返す相手の文: KIRA は返さず、大賀さんへ回す。受け取りの一言は 6 時間に 1 回");
  calls = []; llmOut = "AI の返事";
  await send(env, [textMsg(CU, "写真を送りました。よろしくお願いします")]);
  check("AI を呼ばない", llms().length === 0);
  check("受け取りの一言を返した", replyText() === "受け取りました。ありがとうございます。担当の大賀からお返事いたします。", replyText());
  check("大賀さんへ本文を回した", ownerText().includes("【人が返す相手から】") && ownerText().includes("写真を送りました"), ownerText());
  calls = [];
  await send(env, [textMsg(CU, "メールアドレスは test@example.com です")]);
  check("2 通目は受け取りの一言を返さない", replies().length === 0, String(replies().length));
  check("2 通目も大賀さんへ回した", ownerText().includes("test@example.com"));
  calls = [];
  await send(env, [textMsg(CU, "カードで払えますか")]);
  check("支払いの問いでも KIRA は案内を送らない(大賀さんへ回す)", replies().length === 0 && ownerText().includes("カードで払えますか"), replyText());

  console.log("\n11) 人が返す相手の写真: 診断せず、大賀さんへ知らせる");
  calls = [];
  await send(env, [imageMsg(CU)]);
  check("AI を呼ばない(診断しない)", llms().length === 0);
  check("大賀さんへ「[写真]」と知らせた", ownerText().includes("[写真]"), ownerText());

  console.log("\n12) 人が返す相手には追客を送らない");
  await env.SEEN_STORE.put("chat:" + CU, JSON.stringify({ messages: [], phase: "DIAGNOSIS", registeredAt: Date.now() - 10 * 86400e3, lastEventAt: Date.now() - 10 * 86400e3, followupSent: [] }));
  calls = [];
  await runCron(env);
  check("追客の push は 0", pushTo(CU).length === 0, String(pushTo(CU).length));

  console.log("\n13) KIRAに戻す: 戻した後は KIRA が返す");
  calls = [];
  await send(env, [textMsg(OWNER, "KIRAに戻す " + CU)]);
  check("戻したと返す", replyText().includes("KIRA に戻しました"), replyText());
  check("KV から消えた", !env._kv.has("human:" + CU));
  calls = []; llmOut = "はい、ご相談ください。";
  await send(env, [textMsg(CU, "外壁のひび割れが気になっています")]);
  check("AI を呼んだ", llms().length === 1);
}

console.log("\n14) 人が返す相手でない人には、追客はこれまでどおり送る(このページの直しで止めていない)");
{
  const env = makeEnv();
  await env.SEEN_STORE.put("chat:" + CU, JSON.stringify({ messages: [], phase: "DIAGNOSIS", registeredAt: Date.now() - 10 * 86400e3, lastEventAt: Date.now() - 10 * 86400e3, followupSent: [] }));
  calls = [];
  await runCron(env);
  check("追客の push が 1", pushTo(CU).length === 1, String(pushTo(CU).length));
}

console.log("\n15) 振込先の誤りを探す: AI が振込先を書いた会話だけを出し、番号は伏せる");
{
  const env = makeEnv();
  const U1 = "U" + "1".repeat(32), U2 = "U" + "2".repeat(32), U3 = "U" + "3".repeat(32);
  await env.SEEN_STORE.put("chat:" + U1, JSON.stringify({ messages: [{ role: "user", content: "クレジットカードでお支払いお願いいたします" }, { role: "assistant", content: "申し訳ございません。銀行振込のみです。楽天銀行 支店名：第二営業支店 口座番号：0000000 口座名義：ホライズンシールド" }], phase: "CLOSING" }));
  await env.SEEN_STORE.put("chat:" + U2, JSON.stringify({ messages: [{ role: "user", content: "申し込みます" }, { role: "assistant", content: "お申し込みありがとうございます！【お振込先】銀行名：静岡銀行 支店名：平塚支店 口座種別：普通 口座番号：1234567 口座名義：The" }], phase: "COMPLETE" }));
  await env.SEEN_STORE.put("chat:" + U3, JSON.stringify({ messages: [{ role: "assistant", content: "外壁塗装は30坪で80〜120万円ほどです。" }], phase: "DIAGNOSIS" }));
  calls = [];
  await send(env, [textMsg(OWNER, "振込先の誤りを探す")]);
  const r = replyText();
  check("会話 3 件を見た", r.includes("会話 3 件を見た"), r);
  check("作られた振込先の会話(U1)を出す", r.includes(U1), r);
  check("正しい振込先の会話(U2)は出さない", !r.includes(U2), r);
  check("お金の話の無い会話(U3)は出さない", !r.includes(U3), r);
  check("番号は伏せる", !r.includes("0000000") && r.includes("[番号]"), r);
}

console.log("\n16) /health の版");
{
  const env = makeEnv();
  const h = await (await W.fetch(new Request("https://x/health"), env, { waitUntil: () => {} })).json();
  check("version は v28-payment-20261125", h.version === "v28-payment-20261125", h.version);
}

console.log("\nchecks: " + checks + ", failed: " + fail);
if (checks < 60) { console.log("fewer checks than expected"); process.exit(1); }
if (fail) { console.log("FAILED"); process.exit(1); }
console.log("お支払いの案内の直し すべて通過");
