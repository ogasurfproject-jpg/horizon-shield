/* hs-kira-line v28b: 大賀さんの合図の揺れと、申し送り。ネットワークには出ない。

   なぜ要るか (2026-11-25):
     23:35 JST、大賀さんが送った「振り込みの誤りを探す」が、合図「振込先の誤りを探す」と一字違いで合図と見なされず、
     お客さま向けのお支払いの案内が大賀さんに返った。合図は全角・空白・言い回しの揺れを受け、合図らしいのに形が
     合わない文には合図の一覧を返す。ID の代わりに LINE の名前でも受ける(1 人に決まる時だけ)。
     また、無料で診断書を送ったお客さまに KIRA が有料の診断を勧めたり、お支払いの案内を出したりしない様に、
     大賀さんが「申し送り」を残せる様にする。
   確かめること:
     ・振込/振り込み/振込み/口座、誤り/間違い、探す/調べる、全角・空白の揺れで「探す」が動く
     ・人が返す / KIRAに戻す / 人が返す一覧 が、空白なし・全角・大文字の ID・「ユーザー:」付きでも動く
     ・名前で送った時は 1 人に決まる時だけ記録し、2 人以上なら ID を並べ、0 人ならそう言う
     ・合図らしいのに形が合わない文には合図の一覧を返し、AI もお支払いの案内も出さない
     ・会話の一覧は名前・ID・発言の数を新しい順に出し、大賀さん自身は出さない
     ・申し送りに「無料」があれば、お支払いの問いに案内を出さず、AI の返事の勧めの文も付けず、AI の口座も差し替える
     ・申し送りは AI への指示に入る。申し送りのある方には追客を送らない。申し送りを読めない時は KIRA は返さない
     ・お客さまが「振込先の誤りを探す」と送っても、他の方の会話は出ない
     ・大賀さん自身の支払いの問いの知らせには「大賀さんご自身」と付く

   node workers/hs-kira-line/owner_cmd_test.mjs
   直す前の版で落ちることを見る: KL_WORKER=<v28 の worker.js> node workers/hs-kira-line/owner_cmd_test.mjs
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.KL_WORKER ? path.resolve(HERE, process.env.KL_WORKER) : path.join(HERE, "src", "worker.js");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hskl-owner-"));
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
const U1 = "U" + "1".repeat(32), U2 = "U" + "2".repeat(32), U3 = "U" + "3".repeat(32), U4 = "U" + "4".repeat(32), U5 = "U" + "5".repeat(32);
const NAMES = { [U1]: "山口 博之", [U2]: "佐藤 花子", [U3]: "山口 太郎", [U4]: "田中", [U5]: "鈴木 一郎" };
const BANK = "静岡銀行 平塚支店 普通 1234567 ザ ホライズンズ（カ";
function makeEnv(opts = {}) {
  const kv = new Map();
  return {
    LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_TOKEN: "tok", LINE_USER_ID: OWNER, KIRA_BRIDGE_KEY: "bk", ANTHROPIC_API_KEY: "test-not-a-key",
    BANK_INFO: BANK, _kv: kv,
    SEEN_STORE: {
      get: async (k) => { if (opts.failNote && k.startsWith("note:")) throw new Error("kv down"); return kv.has(k) ? kv.get(k) : null; },
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
let llmOut = "ご相談ありがとうございます。";
globalThis.fetch = async (url, init) => {
  const u = String(url);
  let body = null; try { body = JSON.parse((init && init.body) || "null"); } catch (_e) { body = null; }
  calls.push({ url: u, body });
  if (u.includes("api.anthropic.com")) return new Response(JSON.stringify({ content: [{ type: "text", text: llmOut }] }), { status: 200 });
  const pm = u.match(/\/v2\/bot\/profile\/(U[0-9a-f]{32})/);
  if (pm) return NAMES[pm[1]] ? new Response(JSON.stringify({ displayName: NAMES[pm[1]] }), { status: 200 }) : new Response("{}", { status: 404 });
  return new Response("{}", { status: 200 });
};
const textMsg = (uid, text) => ({ type: "message", replyToken: "rt_" + Math.random().toString(36).slice(2), source: { type: "user", userId: uid }, message: { type: "text", id: "m" + Math.random().toString(36).slice(2), text } });
const replies = () => calls.filter((c) => c.url.includes("/v2/bot/message/reply"));
const replyText = () => replies().map((c) => c.body.messages.map((m) => m.text).join("\n")).join("\n");
const pushTo = (uid) => calls.filter((c) => c.url.includes("/v2/bot/message/push") && c.body && c.body.to === uid);
const ownerText = () => pushTo(OWNER).map((c) => c.body.messages.map((m) => m.text).join("\n")).join("\n");
const llms = () => calls.filter((c) => c.url.includes("api.anthropic.com"));
const FAKE = "申し訳ございません。銀行振込のみです。楽天銀行 支店名：第二営業支店 口座番号：0000000 口座名義：ホライズンシールド";
async function seed(env) {
  const old = Date.now() - 10 * 86400e3;
  await env.SEEN_STORE.put("chat:" + U1, JSON.stringify({ messages: [{ role: "user", content: "クレジットカードでお支払いお願いいたします" }, { role: "assistant", content: FAKE }], phase: "CLOSING", lastEventAt: Date.now() - 60e3 }));
  await env.SEEN_STORE.put("chat:" + U2, JSON.stringify({ messages: [{ role: "user", content: "外壁のひび" }, { role: "assistant", content: "写真を送ってください。" }], phase: "HEARING", lastEventAt: Date.now() - 120e3 }));
  await env.SEEN_STORE.put("chat:" + U3, JSON.stringify({ messages: [{ role: "assistant", content: "外壁塗装は30坪で80〜120万円ほどです。" }], phase: "DIAGNOSIS", lastEventAt: Date.now() - 180e3 }));
  await env.SEEN_STORE.put("chat:" + OWNER, JSON.stringify({ messages: [{ role: "user", content: "試し" }], phase: "GREETING", lastEventAt: Date.now() }));
  return old;
}

console.log("1) 「探す」の言い回しの揺れ");
{
  const env = makeEnv();
  await seed(env);
  for (const t of ["振り込みの誤りを探す", "振込の誤りを探す", "振込先の 間違いを 探して", "振込先の　誤りを　探す", "口座の誤りを調べて", "振込先の誤りを探す"]) {
    calls = [];
    await send(env, [textMsg(OWNER, t)]);
    const r = replyText();
    check("「" + t + "」で探す", r.includes("件を見た") && !r.includes("お支払いのご案内") && llms().length === 0 && !ownerText().includes("お支払い案内送付"), r);
  }
  calls = [];
  await send(env, [textMsg(OWNER, "振り込みの誤りを探す")]);
  const r = replyText();
  check("見つけた会話に名前を出す", r.includes("山口 博之 さん") && r.includes(U1), r);
  check("お金の細目のあたりを出し、番号は伏せる", r.includes("楽天銀行") && r.includes("[番号]") && !r.includes("0000000"), r);
  check("該当の数を出す", r.includes("該当 1 件"), r);
  check("名前でも止められると書く", r.includes("人が返す 名前"), r);
}

console.log("\n2) 人が返す / KIRAに戻す / 人が返す一覧 の揺れ");
{
  const env = makeEnv();
  await seed(env);
  const forms = [["人が返す" + U1, U1], ["人が返す　" + U2, U2], ["人が返す U" + "3".repeat(32).toUpperCase(), U3], [U1 + " を人が返すに", U1], ["人が返す ユーザー: " + U2, U2]];
  for (const [t, u] of forms) {
    env._kv.delete("human:" + u);
    calls = [];
    await send(env, [textMsg(OWNER, t)]);
    check("「" + t.slice(0, 16) + "…」で人が返すにした", env._kv.has("human:" + u) && replyText().includes("KIRA は返さず"), replyText());
  }
  calls = [];
  await send(env, [textMsg(OWNER, "ＫＩＲＡに戻す " + U1)]);
  check("全角の「ＫＩＲＡに戻す」で戻した", !env._kv.has("human:" + U1) && replyText().includes("KIRA に戻しました"), replyText());
  calls = [];
  await send(env, [textMsg(OWNER, "キラに戻す " + U2)]);
  check("「キラに戻す」で戻した", !env._kv.has("human:" + U2), replyText());
  for (const t of ["人が返す一覧", "人が返すの一覧", "人が返す 一覧"]) {
    calls = [];
    await send(env, [textMsg(OWNER, t)]);
    check("「" + t + "」で一覧", replyText().includes("人が返す相手") && replyText().includes(U3), replyText());
  }
}

console.log("\n3) 名前で送った合図");
{
  const env = makeEnv();
  await seed(env);
  calls = [];
  await send(env, [textMsg(OWNER, "人が返す 佐藤")]);
  check("1 人に決まる名前は記録する", env._kv.has("human:" + U2) && replyText().includes("佐藤 花子 さん"), replyText());
  calls = [];
  await send(env, [textMsg(OWNER, "山口さんを人が返す")]);
  check("2 人いる名前は記録せず、ID を並べる", !env._kv.has("human:" + U1) && !env._kv.has("human:" + U3) && replyText().includes("2 人います") && replyText().includes(U1) && replyText().includes(U3), replyText());
  calls = [];
  await send(env, [textMsg(OWNER, "人が返す 鈴木")]);
  check("いない名前は、見つからないと言う", replyText().includes("見つかりませんでした") && llms().length === 0, replyText());
  calls = [];
  await send(env, [textMsg(OWNER, "KIRAに戻す 佐藤さん")]);
  check("名前で戻せる", !env._kv.has("human:" + U2) && replyText().includes("KIRA に戻しました"), replyText());
}

console.log("\n4) 合図らしいのに形が合わない文 / 合図の一覧");
{
  const env = makeEnv();
  await seed(env);
  calls = [];
  await send(env, [textMsg(OWNER, "人が返す")]);
  const r = replyText();
  check("合図の一覧を返す", r.includes("合図の形が読み取れませんでした") && r.includes("振込先の誤りを探す") && r.includes("申し送り"), r);
  check("AI もお支払いの案内も出さない", llms().length === 0 && !r.includes("お支払いのご案内"), r);
  calls = [];
  await send(env, [textMsg(OWNER, "合図")]);
  check("「合図」で一覧", replyText().includes("会話の一覧") && !replyText().includes("読み取れませんでした"), replyText());
}

console.log("\n5) 会話の一覧");
{
  const env = makeEnv();
  await seed(env);
  await env.SEEN_STORE.put("human:" + U3, JSON.stringify({ since: Date.now(), by: "owner" }));
  calls = [];
  await send(env, [textMsg(OWNER, "会話の一覧")]);
  const r = replyText();
  check("3 人を名前と ID で出す", r.includes("お客さまの会話 3 件") && r.includes("山口 博之 さん") && r.includes("佐藤 花子 さん") && r.includes(U1) && r.includes(U2) && r.includes(U3), r);
  check("新しい順(U1 が U2 より前)", r.indexOf(U1) < r.indexOf(U2) && r.indexOf(U2) < r.indexOf(U3), r);
  check("人が返す相手に印", /山口 太郎 さん \[人が返す\]/.test(r), r);
  check("大賀さん自身は出さない", !r.includes(OWNER), r);
  check("発言の数を出す", r.includes("発言 2"), r);
}

console.log("\n6) 申し送り");
{
  const env = makeEnv();
  await seed(env);
  calls = [];
  await send(env, [textMsg(OWNER, "申し送り " + U2 + " 今回の逆見積もり診断は無料。診断書は11/25にメールでお送り済み。お支払いの案内はしない。")]);
  check("申し送りを残した", env._kv.has("note:" + U2) && replyText().includes("申し送りを残しました") && replyText().includes("今回のお支払いは不要です"), replyText());
  calls = [];
  await send(env, [textMsg(U2, "カードで払えますか")]);
  let r = replyText();
  check("お支払いの問いに案内を出さない", r.includes("今回のお支払いは不要です") && !r.includes("PayPal") && !r.includes("静岡銀行") && llms().length === 0, r);
  check("大賀さんへ知らせる", ownerText().includes("申し送り: 支払い不要"), ownerText());
  calls = []; llmOut = "<STATE>{\"phase\":\"CLOSING\",\"service\":\"SVC-00\"}</STATE>こちらこそ、ありがとうございました。";
  await send(env, [textMsg(U2, "ありがとうございました")]);
  r = replyText();
  const sys = (llms()[0] && llms()[0].body && llms()[0].body.system) || "";
  check("申し送りが AI への指示に入る", sys.includes("申し送り") && sys.includes("無料"), sys.slice(-120));
  check("勧めの文(5,500円)を付けない", !r.includes("5,500") && !r.includes("申し込みます"), r);
  calls = []; llmOut = FAKE;
  await send(env, [textMsg(U2, "どうもです")]);
  r = replyText();
  check("AI が口座を書いても、案内でなく「不要です」に差し替える", r.includes("今回のお支払いは不要です") && !r.includes("楽天") && !r.includes("静岡銀行"), r);
  llmOut = "ご相談ありがとうございます。";
  calls = [];
  await send(env, [textMsg(OWNER, "申し送り 佐藤")]);
  check("名前で今の申し送りを見られる", replyText().includes("佐藤 花子 さん") && replyText().includes("診断書は11/25"), replyText());
  calls = [];
  await send(env, [textMsg(OWNER, "申し送りを消す 佐藤さん")]);
  check("名前で消せる", !env._kv.has("note:" + U2) && replyText().includes("消しました"), replyText());
  calls = [];
  await send(env, [textMsg(U2, "カードで払えますか")]);
  check("消した後は、ふつうのお支払いの案内に戻る", replyText().includes("PayPal") && replyText().includes("静岡銀行"), replyText());
}

console.log("\n7) 申し送りのある方には追客を送らない(無い方には送る)");
{
  const env = makeEnv();
  const old = Date.now() - 10 * 86400e3;
  await env.SEEN_STORE.put("chat:" + U4, JSON.stringify({ messages: [], phase: "DIAGNOSIS", registeredAt: old, lastEventAt: old, followupSent: [] }));
  await env.SEEN_STORE.put("chat:" + U5, JSON.stringify({ messages: [], phase: "DIAGNOSIS", registeredAt: old, lastEventAt: old, followupSent: [] }));
  await env.SEEN_STORE.put("note:" + U5, JSON.stringify({ text: "無料で対応済み", at: Date.now(), by: "owner" }));
  calls = [];
  await runCron(env);
  check("申し送りの無い方には追客 1", pushTo(U4).length === 1, String(pushTo(U4).length));
  check("申し送りのある方には追客 0", pushTo(U5).length === 0, String(pushTo(U5).length));
}

console.log("\n8) 申し送りを読めない時は KIRA は返さない");
{
  const env = makeEnv({ failNote: true });
  await seed(env);
  calls = [];
  await send(env, [textMsg(U2, "外壁の相場を教えてください")]);
  check("AI を呼ばない", llms().length === 0, String(llms().length));
  check("大賀さんへ知らせる", ownerText().includes("申し送りを今は読み込めなかった"), ownerText());
}

console.log("\n9) お客さまが合図の文を送っても、他の方の会話は出ない / 大賀さん自身の試し");
{
  const env = makeEnv();
  await seed(env);
  calls = [];
  await send(env, [textMsg(U2, "振込先の誤りを探す")]);
  const r = replyText();
  check("他の方の ID も件数も出ない", !r.includes(U1) && !r.includes("件を見た") && !r.includes("合図"), r);
  calls = []; llmOut = "外壁塗装の相場は 30 坪で 80〜120 万円ほどです。";
  await send(env, [textMsg(OWNER, "外壁塗装の相場は？")]);
  check("大賀さんのふつうの文は KIRA が答える(試せる)", llms().length === 1, String(llms().length));
  calls = [];
  await send(env, [textMsg(OWNER, "カードで払えますか")]);
  check("大賀さん自身の支払いの問いの知らせに「大賀さんご自身」", ownerText().includes("大賀さんご自身"), ownerText());
}

console.log("\n10) /health の版");
{
  const env = makeEnv();
  const h = await (await W.fetch(new Request("https://x/health"), env, { waitUntil: () => {} })).json();
  check("version は v28b-owner-20261125", h.version === "v28b-owner-20261125", h.version);
}

console.log("\nchecks: " + checks + ", failed: " + fail);
if (checks < 45) { console.log("fewer checks than expected"); process.exit(1); }
if (fail) { console.log("FAILED"); process.exit(1); }
console.log("大賀さんの合図と申し送り すべて通過");
