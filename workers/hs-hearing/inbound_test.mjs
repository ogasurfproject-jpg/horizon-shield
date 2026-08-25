/* 加盟店ヒアリングの入口を、入口に依らず、実物の関数を呼んで端から端まで確かめる。
   KV は模擬。ネットワークには出ない。

   なぜ要る (2026-08-25):
     「意図を見て捌く」層(質問は取り込まず窓口が答える／engaged を残す／金額は
     大賀に回す)は、これまで KIRA橋渡し(handleKiraBridge)にしか無かった。
     同じ加盟店が LINE直・メールから入ってくると、その層を通らず、質問まで
     「回答」として取り込んでいた。平田様の
       「今シートの記載をしてますが、これは途中で止めたらダメになっちゃいますか？」
     を回答として処理してしまったのと同じ穴が、他の3つの入口に残っていた。

     TOshi 指示「加盟店さんへのヒアリングするAIは全部この体制にしてくれ」。
     入口共通の handlePartnerInbound を1箇所に置き、4つの入口を全部そこへ寄せた。
     ここで、次を毎回確かめる。
       ・質問は取り込まない(hearing: も (source)reply: も書かない)
       ・質問でも engaged は残す(督促の罰点は解く。返事待ちの時計は止めない)
       ・回答は取り込む(hearing: が書かれる)
       ・金額は、意図を見る前に、機械が大賀へ回す(取り込まない)
       ・入口(line/email)を変えても、同じ判断になる
       ・handleLineWebhook を丸ごと通しても、質問に窓口が答える(配線の証拠)

   node workers/hs-hearing/inbound_test.mjs
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRCDIR = path.join(HERE, "src");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hsinb-"));
for (const f of fs.readdirSync(SRCDIR)) {
  if (!f.endsWith(".js")) continue;
  let body = fs.readFileSync(path.join(SRCDIR, f), "utf8");
  body = body.replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
  if (f === "hearing.js") {
    for (const name of ["handlePartnerInbound", "handleLineWebhook"]) {
      if (!body.includes("export { " + name + " }") && !body.includes(name + " };")) {
        body += "\nexport { " + name + " };\n";
      }
    }
  }
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, ".mjs")), body);
}
const SRC = path.join(TMP, "hearing.mjs");
console.log("試す対象: " + path.join(SRCDIR, "hearing.js") +
            " (" + fs.readFileSync(path.join(SRCDIR, "hearing.js"), "utf8").split("\n").length + " 行)");
const H = await import(SRC + "?v=" + Math.random());

// 既定の fetch は無害な 200。LINE 返信を見たい場面だけ、後で差し替える。
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" });

// 取り込みは LLM を通る。模擬を置かないと llm-not-configured で静かに戻る
// (何も設定していないことと、取り込みに失敗したことは違う)。
function makeEnv(ai) {
  const kv = new Map();
  return {
    _kv: kv,
    AI: ai ? { run: async () => ({ response: JSON.stringify(ai) }) } : undefined,
    HS_HEARING_KV: {
      get: async (k, type) => {
        if (!kv.has(k)) return null;
        const v = kv.get(k);
        return type === "json" ? JSON.parse(v) : v;
      },
      put: async (k, v) => { kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
      list: async () => ({ keys: [] }),
    },
  };
}

const keys = (env) => [...env._kv.keys()];
const has = (env, pre) => keys(env).some((k) => k.startsWith(pre));
const line = (s) => String(s || "").split("\n")[0].slice(0, 70);
let fail = 0, checks = 0;
function check(label, cond, detail) {
  checks++;
  console.log((cond ? "  ok   " : "  NG   ") + label + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}

const SID = "kira-inbound01";
// ちゃんと育っている店を用意する。督促の罰点も、返事待ちの設問も立てておく。
function seedStore(env, over) {
  const store = Object.assign({
    store_id: SID, company: "さざなみ訪問看護ステーション",
    areas: ["平塚市"], works: ["点滴の管理"], tier: "honbu",
    status: "hearing_done", source: "kira-line", industry: "nursing",
    token: "ht_zzzzzzzzzzzz", created_at: "2026-08-20T00:00:00Z",
    autopilot: {
      penalty: 5, unanswered_sends: 3, needs_human: true, nudges: 2,
      pending: { qids: ["q_fr_target"], text: "協力の条件を教えてください", sent_at: "2026-08-22T00:00:00Z" },
      last_answer_at: "2026-08-20T00:00:00Z",
    },
  }, over || {});
  env._kv.set("store:" + SID, JSON.stringify(store));
  return store;
}
const readStore = (env) => JSON.parse(env._kv.get("store:" + SID));

/* --- 1. 質問は取り込まない。だが engaged は残す。督促の時計は止めない --- */
console.log("\n1) 平田様の実文『途中で止めたらダメ…ますか？』(質問)");
{
  const env = makeEnv();          // AI 不要(FAQで決まる)
  const store = seedStore(env);
  const out = await H.handlePartnerInbound(env, SID, store, "今シートの記載をしてますが、これは途中で止めたらダメになっちゃいますか？", "line");
  console.log("     返信: " + line(out.reply));
  check("kind は question", out.kind === "question", out.kind);
  check("窓口が『途中で止めても大丈夫』と答えている", out.reply.includes("途中で止めても大丈夫"));
  check("取り込んでいない(hearing: を書いていない)", !has(env, "hearing:"), keys(env).join(","));
  check("取り込んでいない(linereply: を書いていない)", !has(env, "linereply:"));
  check("生の質問は残している(partnerq:)", has(env, "partnerq:"));
  const s = readStore(env);
  check("engaged: 督促の罰点を解いた(penalty=0)", (s.autopilot.penalty || 0) === 0, "penalty=" + s.autopilot.penalty);
  check("engaged: 未応答カウントを戻した", (s.autopilot.unanswered_sends || 0) === 0);
  check("engaged: 人送りの印を外した", !s.autopilot.needs_human);
  check("engaged: 活動時刻を更新した", s.autopilot.last_answer_at !== "2026-08-20T00:00:00Z");
  check("だが返事待ちの時計は止めない(pending 残す)", !!(s.autopilot.pending && s.autopilot.pending.qids));
  check("だが催促回数は消さない(nudges 据え置き)", s.autopilot.nudges === 2, "nudges=" + s.autopilot.nudges);
}

/* --- 2. 金額は、意図を見る前に、機械が大賀へ回す(取り込まない) -------- */
console.log("\n2) 金額の問い合わせ(意図の層より前で捕まえる)");
{
  const env = makeEnv();
  const store = seedStore(env);
  const out = await H.handlePartnerInbound(env, SID, store, "掲載の料金はいくらですか？", "line");
  console.log("     返信: " + line(out.reply));
  check("kind は money", out.kind === "money", out.kind);
  check("大賀に回している", out.reply.includes("大賀"));
  check("金額の問いも取り込まない(hearing: 無し)", !has(env, "hearing:"));
  check("金額の問いは質問棚にも積まない(partnerq: 無し)", !has(env, "partnerq:"));
}

/* --- 3. 回答は取り込む(hearing: が書かれる) ----------------------- */
console.log("\n3) 番号つきの回答は、これまでどおり取り込む");
{
  const env = makeEnv({ company: "さざなみ訪問看護ステーション", area: "平塚市", works: ["点滴の管理", "服薬管理"] });
  const store = seedStore(env);
  const out = await H.handlePartnerInbound(env, SID, store, "1) 常勤4名です\n2) 加算は2つ取っています", "line");
  console.log("     返信: " + line(out.reply));
  check("kind は answer(質問ではない)", out.kind === "answer" || out.kind === "answer-uncertain" || out.kind === "answer-missing", out.kind);
  check("取り込んでいる(hearing: を書いた)", has(env, "hearing:"), keys(env).join(","));
  check("返信が空でない", !!out.reply);
}

/* --- 4. 入口を email に変えても、質問は同じ扱い ---------------------- */
console.log("\n4) 同じ質問が『メール』から来ても、取り込まない(入口共通)");
{
  const env = makeEnv();
  const store = seedStore(env);
  const out = await H.handlePartnerInbound(env, SID, store, "これって全部書かないとダメですか？", "email");
  console.log("     返信: " + line(out.reply));
  check("kind は question", out.kind === "question", out.kind);
  check("取り込んでいない(hearing: 無し)", !has(env, "hearing:"));
  check("メールでも生の質問は残す(partnerq:)", has(env, "partnerq:"));
  check("窓口が『分かるところだけ』と答えている", out.reply.includes("分かるところだけ"));
}

/* --- 5. handleLineWebhook を丸ごと通す(配線の証拠) ------------------
   関数を直に呼ぶだけでなく、LINE Webhook の入口から通して、
   質問に窓口が答えることを確かめる。返信は api.line.me への POST を捕まえて見る。 */
console.log("\n5) LINE Webhook を丸ごと通して、質問に窓口が答える");
{
  const env = makeEnv();
  env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
  seedStore(env);
  const U = "U" + "0".repeat(32);
  env._kv.set("line2store:" + U, SID);

  let lineBody = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api.line.me")) {
      try { lineBody = JSON.parse(init.body); } catch (_e) { lineBody = null; }
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  };
  const webhook = JSON.stringify({
    events: [{ type: "message", message: { type: "text", text: "あとで続きから書けますか？" },
               source: { userId: U }, replyToken: "rt_dummy" }],
  });
  await H.handleLineWebhook(env, webhook);
  globalThis.fetch = realFetch;

  const replyText = lineBody && lineBody.messages && lineBody.messages[0] && lineBody.messages[0].text;
  console.log("     LINE返信: " + line(replyText));
  check("LINE に返信を送っている", !!replyText);
  check("窓口が『続き』の案内を返している", !!replyText && replyText.includes("続き"));
  check("取り込んでいない(hearing: 無し)", !has(env, "hearing:"), keys(env).join(","));
  check("生の質問は残している(partnerq:)", has(env, "partnerq:"));
}

/* 走らなかった試験は、通った試験と見分けがつかない。数を数えて、減ったら落とす。 */
const EXPECT = 26;
console.log("\n確かめた数: " + checks + " (最低 " + EXPECT + ")");
if (checks < EXPECT) {
  console.log("  NG   試験がまるごと走っていません。途中で止まっていないか見てください。");
  fail++;
}
console.log(fail ? fail + " 件 失敗" : "入口の統一 すべて通過");
process.exit(fail ? 1 : 0);
