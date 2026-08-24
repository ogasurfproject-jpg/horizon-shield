/* ヒアリングの間隔と、返事の当て方を、実物の runDailyTick / settlePendingOnAnswer で確かめる。
   KV は模擬。時計も模擬。ネットワークには出ない。

   なぜ要るか (2026-08-24):
     稼働中のコードにあっぷす様(訪問看護)の実際の値を入れて回したところ、
     返事待ちが開いている間、追撃の枝は一度も通らないことが分かった。
     催促だけが 3・7・14・21日目に1問ずつ動き、そのあと打ち切る。
     データベースを厚くする8問は、返事が無ければ最長28日ゼロのままになる。

     この「何日目に何が起きるか」を、言葉ではなく走らせて確かめる。
     日付の話は、頭の中で数えると必ず間違える。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRCDIR = path.join(HERE, "src");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hscad-"));
for (const f of fs.readdirSync(SRCDIR)) {
  if (!f.endsWith(".js")) continue;
  let body = fs.readFileSync(path.join(SRCDIR, f), "utf8");
  body = body.replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, ".mjs")), body);
}
const AP = await import(path.join(TMP, "autopilot.mjs") + "?v=" + Math.random());

/* ---- 模擬の時計 ---------------------------------------------------- */
const RealDate = Date;
let FAKE = RealDate.parse("2026-08-23T21:17:00Z");
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(FAKE); else super(...a); }
  static now() { return FAKE; }
}
globalThis.Date = FakeDate;
const setNow = (iso) => { FAKE = RealDate.parse(iso); };
const plusDays = (d) => { FAKE = FAKE + d * 86400000; };

/* ---- 模擬の送信 ---------------------------------------------------- */
let SENT = [];
globalThis.fetch = async (url, init) => {
  let body = {};
  try { body = JSON.parse((init && init.body) || "{}"); } catch (_e) {}
  SENT.push({ url: String(url), subject: body.subject || "", html: body.html || "", text: body.text || "" });
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
};

function makeEnv() {
  const kv = new Map();
  return {
    RESEND_API_KEY: "test-key",
    _kv: kv,
    HS_HEARING_KV: {
      get: async (k, type) => {
        if (!kv.has(k)) return null;
        const v = kv.get(k);
        return type === "json" ? JSON.parse(v) : v;
      },
      put: async (k, v) => { kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
      list: async () => ({ keys: [...kv.keys()].map((name) => ({ name })) }),
    },
  };
}

async function setup({ mode }) {
  const env = makeEnv();
  const store = {
    store_id: "hs-nursing-001",
    email: "hirata@example.invalid",
    company: "株式会社あっぷす",
    industry: "nursing",
    verification: "verified",
    autopilot: {},
  };
  if (mode) store.hearing_mode = mode;
  await env.HS_HEARING_KV.put("hearing:" + store.store_id, JSON.stringify({
    profile: { industry: "nursing", company: "株式会社あっぷす" },
  }));
  await env.HS_HEARING_KV.put("store:" + store.store_id, JSON.stringify(store));
  return { env, stores: [store] };
}

async function tick(env, stores) {
  SENT = [];
  const log = await AP.runDailyTick(env, { listAllStores: async () => stores });
  return { log, sent: SENT.slice() };
}

let fail = 0;
function check(label, cond, detail) {
  console.log((cond ? "  ok   " : "  NG   ") + label + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}
const qcount = (html) => (html.match(/(?:^|>)\s*\d\)\s/g) || []).length || (html ? 1 : 0);

/* =====================================================================
   1) 見込みの相手(prospect)。返事待ちが開いている間の28日を、日付で出す。
   ===================================================================== */
console.log("1) 見込みの相手: 返事待ちのまま何日目に何が届くか");
{
  const { env, stores } = await setup({});
  setNow("2026-08-23T21:17:00Z");
  const first = await tick(env, stores);
  check("初日は2問届く", first.sent.length === 1, "送信 " + first.sent.length + " 通");
  const ap0 = stores[0].autopilot;
  check("返事待ちが立つ", !!ap0.pending, "qids=" + (ap0.pending ? ap0.pending.qids.join("+") : "-"));

  const days = [];
  for (let d = 1; d <= 30; d++) {
    plusDays(1);
    const r = await tick(env, stores);
    if (r.sent.length) days.push(d + "日目");
  }
  console.log("     届いた日: " + (days.join("、") || "一度も届かない"));
  check("催促は3・7・14・21日目だけ",
        days.join(",") === "3日目,7日目,14日目,21日目", days.join(","));
  check("22日目以降は一通も届かない", !days.some((x) => parseInt(x, 10) > 21));
}

/* =====================================================================
   2) 契約済み(onboarding)。返事待ちでも問いは止まらない。
   ===================================================================== */
console.log("\n2) 契約済み: 返事待ちのまま何日目に何が届くか");
{
  const { env, stores } = await setup({ mode: "onboarding" });
  setNow("2026-08-23T21:17:00Z");
  await tick(env, stores);
  const days = [];
  for (let d = 1; d <= 30; d++) {
    plusDays(1);
    const r = await tick(env, stores);
    if (r.sent.length) days.push(d);
  }
  console.log("     届いた日: " + (days.map((d) => d + "日目").join("、") || "一度も届かない"));
  const ap = stores[0].autopilot;
  check("2日目に次が届く(返事待ちでも止まらない)", days[0] === 2, days.join(","));
  check("3日目まで送って、そこで止まる", days.join(",") === "2,3", days.join(","));
  check("止まったら人に回す印が立つ", !!ap.needs_human,
        ap.needs_human ? ap.needs_human.why : "立っていない");
  check("催促の枝も一緒に止まる(4日目以降は無音)", !days.some((d) => d > 3));
}

/* =====================================================================
   3) 返事が来たら、止まった印も無返答の数も消える。
   ===================================================================== */
console.log("\n3) 返事が来たあと");
{
  const { env, stores } = await setup({ mode: "onboarding" });
  setNow("2026-08-23T21:17:00Z");
  await tick(env, stores);
  for (let d = 0; d < 8; d++) { plusDays(1); await tick(env, stores); }
  const s = stores[0];
  check("いったん人に回す印が立っている", !!s.autopilot.needs_human);
  AP.settlePendingOnAnswer(s, "1) こういう体制です\n2) こちらはこうです");
  check("返事で印が消える", !s.autopilot.needs_human);
  check("無返答の数が0に戻る", (s.autopilot.unanswered_sends || 0) === 0,
        "unanswered_sends=" + s.autopilot.unanswered_sends);
  plusDays(3);
  const r = await tick(env, stores);
  check("止まっていた配信が再開する", r.sent.length === 1, "送信 " + r.sent.length + " 通");
}

/* =====================================================================
   4) 波ごとの消込。1通の返事を、送っていない設問にまで入れない。
   ===================================================================== */
console.log("\n4) 波ごとの消込");
{
  const s = { store_id: "x", autopilot: {} };
  const ap = s.autopilot;
  setNow("2026-08-01T00:00:00Z");
  AP.pushWave(ap, [{ qid: "q_a", text: "Aを教えてください" },
                   { qid: "q_b", text: "Bを教えてください" }], "followup", new Date().toISOString());
  setNow("2026-08-04T00:00:00Z");
  AP.pushWave(ap, [{ qid: "q_c", text: "Cを教えてください" }], "nudge", new Date().toISOString());
  check("返事待ちに3問載っている", ap.pending.qids.join("+") === "q_a+q_b+q_c", ap.pending.qids.join("+"));
  check("波は2つ", ap.pending.waves.length === 2);

  const patch = AP.settlePendingOnAnswer(s, "はい、週1回まわっています。");
  check("直近の1問にだけ答えが入る", Object.keys(patch).join("+") === "q_c", Object.keys(patch).join("+"));
  check("推定であることを名前で残す", patch.q_c.attributed === "recent_wave", patch.q_c.attributed);
  check("古い2問は返事待ちに残る",
        s.autopilot.pending && s.autopilot.pending.qids.join("+") === "q_a+q_b",
        s.autopilot.pending ? s.autopilot.pending.qids.join("+") : "残っていない");
  check("q_a に別の質問の答えが入っていない", patch.q_a === undefined);
}

/* =====================================================================
   5) 番号つきの返事は、直近の波に切り分けて入る。
   ===================================================================== */
console.log("\n5) 番号つきの返事");
{
  const s = { store_id: "x", autopilot: {} };
  const ap = s.autopilot;
  setNow("2026-08-01T00:00:00Z");
  AP.pushWave(ap, [{ qid: "q_old", text: "むかしの問い" }], "followup", new Date().toISOString());
  setNow("2026-08-04T00:00:00Z");
  AP.pushWave(ap, [{ qid: "q_1", text: "ひとつめ" }, { qid: "q_2", text: "ふたつめ" }],
              "followup", new Date().toISOString());
  const patch = AP.settlePendingOnAnswer(s, "1) 常勤4名です\n2) 加算は2つ取っています");
  check("直近の2問に分かれて入る", Object.keys(patch).sort().join("+") === "q_1+q_2",
        Object.keys(patch).join("+"));
  check("番号で切り分けたと記録する", patch.q_1.attributed === "numbered");
  check("1問目の中身が正しい", patch.q_1.text === "常勤4名です", patch.q_1.text);
  check("2問目の中身が正しい", patch.q_2.text === "加算は2つ取っています", patch.q_2.text);
  check("古い問いは残る", s.autopilot.pending.qids.join("+") === "q_old");
}

/* =====================================================================
   6) 波が1つのときは、これまでと同じ振る舞い。
   ===================================================================== */
console.log("\n6) 波が1つのとき(これまでと同じ)");
{
  const s1 = { store_id: "x", autopilot: {} };
  setNow("2026-08-01T00:00:00Z");
  AP.pushWave(s1.autopilot, [{ qid: "q_only", text: "ひとつだけ" }], "followup", new Date().toISOString());
  const p1 = AP.settlePendingOnAnswer(s1, "はい、そうです");
  check("1問だけなら sole", p1.q_only.attributed === "sole", p1.q_only.attributed);
  check("返事待ちは閉じる", s1.autopilot.pending === null);

  const s2 = { store_id: "y", autopilot: {} };
  AP.pushWave(s2.autopilot, [{ qid: "q_1", text: "あ" }, { qid: "q_2", text: "い" }],
              "followup", new Date().toISOString());
  const p2 = AP.settlePendingOnAnswer(s2, "だいたいそんな感じです");
  check("2問に1通で番号が無ければ ambiguous", p2.q_1.attributed === "ambiguous", p2.q_1.attributed);
  check("切り分けられなくても、両方に同じ本文が入る事実は残す",
        p2.q_1.text === p2.q_2.text && p2.q_1.text === "だいたいそんな感じです");
}

/* =====================================================================
   7) 古い形(waves が無い記録)でも壊れない。
   ===================================================================== */
console.log("\n7) 古い形の記録(waves が無い)");
{
  const s = { store_id: "z", autopilot: { pending: {
    qids: ["q_focus", "q_strengths"],
    asked_texts: { q_focus: "ふ", q_strengths: "つ" },
    sent_at: "2026-08-23T21:17:00Z", via: "email",
  } } };
  const patch = AP.settlePendingOnAnswer(s, "1) 人材確保です\n2) 24時間対応です");
  check("番号で切り分けられる", patch.q_focus.text === "人材確保です", patch.q_focus.text);
  check("返事待ちは閉じる", s.autopilot.pending === null);
}

/* =====================================================================
   8) 店の書き込み。送信履歴(asked)は台帳であり、減らない。
   ===================================================================== */
console.log("\n8) 店の書き込み(競り勝っても asked を消さない)");
{
  const env = makeEnv();
  setNow("2026-08-23T21:17:00Z");

  // 巡回が2問送って、pending と asked を書いた状態を作る。
  const sent = {
    store_id: "kira-wbbk99p9",
    autopilot: {
      pending: { qids: ["q_focus", "q_strengths"], sent_at: "2026-08-23T21:17:00Z", via: "line" },
      asked: [{ qid: "q_focus", at: "2026-08-23T21:17:00Z", answered: false },
              { qid: "q_strengths", at: "2026-08-23T21:17:00Z", answered: false }],
    },
  };
  await AP.putStore(env, sent, "巡回");

  // 別の経路が、送信より前に読んだ古い写しを持ったまま書きに来る。
  // これが今日の実測(送った事実は pending に残り、送信履歴だけ消えた)と同じ形である。
  const stale = {
    store_id: "kira-wbbk99p9",
    industry: "nursing",
    autopilot: { pending: null, asked: [] },
  };
  await AP.putStore(env, stale, "kira-bridge:業種決定");

  const after = JSON.parse(env._kv.get("store:kira-wbbk99p9"));
  const ap = after.autopilot;
  check("古い写しで上書きしても asked は消えない", (ap.asked || []).length === 2,
        "asked=" + (ap.asked || []).length);
  check("消えなかったことを記録に残す", !!(ap._asked_recovered || []).length,
        JSON.stringify(ap._asked_recovered));
  check("誰が書いたかを残す",
        (ap._writes || []).map((w) => w.by).join(",") === "巡回,kira-bridge:業種決定",
        JSON.stringify((ap._writes || []).map((w) => w.by)));
  check("新しい返事待ちを踏み消したことを名前で残す",
        !!(ap._pending_overwritten || []).length,
        JSON.stringify(ap._pending_overwritten));
  check("踏み消した中身を残す",
        ((ap._pending_overwritten || [])[0] || {}).lost_qids.join("+") === "q_focus+q_strengths",
        JSON.stringify((ap._pending_overwritten || [])[0]));
  check("踏み消しは勝手に直さない(pending は書いたとおり)",
        ap.pending === null, JSON.stringify(ap.pending));

  // 同じ (qid, 時刻) は二重に積まない。
  const again = {
    store_id: "kira-wbbk99p9",
    autopilot: { asked: [{ qid: "q_focus", at: "2026-08-23T21:17:00Z", answered: false, replied_at: "2026-08-24T01:00:00Z" }] },
  };
  await AP.putStore(env, again, "form:回答取り込み");
  const ap2 = JSON.parse(env._kv.get("store:kira-wbbk99p9")).autopilot;
  check("同じ設問・同じ時刻は二重にならない", (ap2.asked || []).length === 2,
        "asked=" + (ap2.asked || []).length);
  check("返事の印がついたほうを残す",
        !!(ap2.asked.find((a) => a.qid === "q_focus") || {}).replied_at,
        JSON.stringify(ap2.asked.find((a) => a.qid === "q_focus")));

  let threw = false;
  try { await AP.putStore(env, { autopilot: {} }, "名無し"); } catch (_e) { threw = true; }
  check("店IDの無いものは書かない", threw);
}

console.log("");
if (fail) { console.log(fail + " 件おかしい。"); process.exit(1); }
console.log("間隔と消込 すべて通過");
