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

let fail = 0, ran = 0;
function check(label, cond, detail) {
  console.log((cond ? "  ok   " : "  NG   ") + label + (detail ? "  " + detail : ""));
  ran++; if (!cond) fail++;
}

/* =====================================================================
   実測の再現: 答えている相手が、古い返事待ちに閉じ込められる。
   hs-partner-001(堤さま/リフォーム職人株式会社)の 2026-09-07 の実データ:
     pending.qids  = q_cases, q_fr_target, q_estimates
     pending.waves = 8/21 と 8/25 の二つ
     pending.sent_at = 2026-09-03T22:53:49Z (= 堤さまが答えた時刻)
     last_send_at    = 2026-09-03T21:18:02Z
     巡回は 9/4・9/5・9/6 と走って、一通も出ていない。completeness は 67(85未満)。
   答えるたびに残った波の時計が今に戻り、追撃の門(!ap.pending)が永久に閉じていた。
   ===================================================================== */
console.log("A) 答えている相手: 古い波を抱えたまま追撃が再開するか");
{
  const { env, stores } = await setup({});
  setNow("2026-08-21T21:17:00Z");
  await tick(env, stores);                       // 8/21 の波
  const w1at = stores[0].autopilot.pending.sent_at;
  const w1qids = [...(stores[0].autopilot.pending.qids || [])];
  plusDays(3); await tick(env, stores);          // 8/24 前後の催促で二つ目の波
  const ap1 = stores[0].autopilot;
  check("波が二つ開いている", (ap1.pending.waves || []).length >= 2,
        "waves=" + (ap1.pending.waves || []).length);

  plusDays(1);                                   // 相手が返事をする
  AP.settlePendingOnAnswer(stores[0], "こちらは大丈夫です");
  const ap2 = stores[0].autopilot;
  check("古い波は返事待ちに残る", !!ap2.pending && ap2.pending.qids.length > 0,
        ap2.pending ? ap2.pending.qids.join("+") : "-");
  check("残した波の時計を今に巻き戻さない", ap2.pending.sent_at === w1at,
        ap2.pending.sent_at + " / 送った時刻 " + w1at);

  const days = [];
  for (let d = 1; d <= 25; d++) {
    plusDays(1);
    const r = await tick(env, stores);
    if (r.sent.length) days.push(d);
  }
  console.log("     返事のあと、届いた日: " + (days.map((d) => d + "日目").join("、") || "一度も届かない"));
  check("答えている相手に、追撃が再開する", days.length > 0, days.join(","));
  // 古い波が落ちる道は二本ある。寿命(WAVE_TTL_D 日)と、抱えすぎ(PENDING_MAX_WAVES 群)。
  // どちらで落ちたかは問わない。見るのは結果、つまり最初の波が返事待ちの席を
  // 明け渡したかどうかである。落ちたことが台帳のどちらかに記録されていることも見る。
  {
    const _ap = stores[0].autopilot;
    const _live = new Set((_ap.pending && _ap.pending.qids) || []);
    const _stillHeld = w1qids.filter((q) => _live.has(q));
    check("最初の波は返事待ちの席を明け渡した", _stillHeld.length === 0,
          "まだ抱えている: " + (_stillHeld.join("+") || "なし"));
    const _logged = [...(_ap._waves_expired || []), ...(_ap._waves_dropped || [])];
    check("落としたことが台帳に残る", _logged.length > 0, JSON.stringify(_logged));
    check("落としても asked からは消さない",
          w1qids.every((q) => ((_ap.asked || []).some((a) => a.qid === q))),
          "asked=" + ((_ap.asked || []).map((a) => a.qid).join(",")));
  }
}

/* =====================================================================
   逆側の確認: 一度も返事の無い相手には、寿命を当てない。
   打ち切り(28日)は掟である。答えない相手に機械が送り続ける形にはしない。
   ===================================================================== */
console.log("\nB) 無反応の相手: 寿命は当たらない(打ち切りは残る)");
{
  const { env, stores } = await setup({});
  setNow("2026-08-21T21:17:00Z");
  await tick(env, stores);
  const days = [];
  for (let d = 1; d <= 30; d++) { plusDays(1); const r = await tick(env, stores); if (r.sent.length) days.push(d); }
  console.log("     届いた日: " + days.map((d) => d + "日目").join("、"));
  check("催促は3・7・14・21日目のまま", days.join(",") === "3,7,14,21", days.join(","));
  check("古い波を落としていない", (stores[0].autopilot._waves_expired || []).length === 0);
}

/* =====================================================================
   C) 初回ヒアリングが終わった加盟店は、自動で継続ヒアリングに移るか。
      2026-09-07 まで、立場を変えるのは /admin/hearing-mode を人が叩く一手だけだった。
      叩かれない店は prospect のまま 3/7/14/21 + 28日打ち切りで沈黙する。
   ===================================================================== */
console.log("\nC) 初回ヒアリング完了 -> 継続ヒアリングへの自動移行");
async function doneStore({ member_no, mode, completed }) {
  const { env, stores } = await setup(mode ? { mode } : {});
  if (member_no) stores[0].member_no = member_no;
  if (mode) stores[0].hearing_mode_at = "2026-08-24T00:00:00Z";
  await env.HS_HEARING_KV.put("hearing:" + stores[0].store_id, JSON.stringify({
    profile: { industry: "nursing", company: "株式会社あっぷす" },
    completed: !!completed,
  }));
  return { env, stores };
}
{
  const { env, stores } = await doneStore({ member_no: "No.001", completed: true });
  setNow("2026-09-08T21:17:00Z");
  const r = await tick(env, stores);
  check("加盟店 + 初回完了 なら自動で onboarding",
        stores[0].hearing_mode === "onboarding", String(stores[0].hearing_mode));
  check("誰が変えたかを残す", stores[0].hearing_mode_by === "auto:初回ヒアリング完了",
        String(stores[0].hearing_mode_by));
  check("巡回の記録に残る", (r.log.promoted || []).length === 1, JSON.stringify(r.log.promoted));
  const days = [];
  for (let d = 1; d <= 8; d++) { plusDays(1); const x = await tick(env, stores); if (x.sent.length) days.push(d); }
  console.log("     届いた日: " + days.map((d) => d + "日目").join("、"));
  check("返事待ちでも48時間おきに次が届く", days[0] === 2, days.join(","));
  check("3回無返答で止まり、人に回す", !!stores[0].autopilot.needs_human);
}
{
  const { env, stores } = await doneStore({ member_no: "No.009", mode: "prospect", completed: true });
  setNow("2026-09-08T21:17:00Z");
  await tick(env, stores);
  check("人が prospect と決めた店は動かさない", stores[0].hearing_mode === "prospect",
        String(stores[0].hearing_mode));
}
{
  const { env, stores } = await doneStore({ completed: true });
  setNow("2026-09-08T21:17:00Z");
  await tick(env, stores);
  check("加盟していない見込みの相手は上げない", !stores[0].hearing_mode,
        String(stores[0].hearing_mode));
}
{
  const { env, stores } = await doneStore({ member_no: "No.010", completed: false });
  setNow("2026-09-08T21:17:00Z");
  await tick(env, stores);
  check("初回ヒアリングが終わっていなければ上げない", !stores[0].hearing_mode,
        String(stores[0].hearing_mode));
}

/* =====================================================================
   D) 打ち切ってはいけない問い(q_estimates)と、昇格時の数え直し。
      実見積 3 本が無いと KIRA 採点も verified 化も始まらない。ASK_MAX=3 で
      殺すと、売った物の分母が永久に埋まらない。
   ===================================================================== */
console.log("\nD) 打ち切らない問いと、昇格時の数え直し");
function askedTimes(qid, n, atISO) {
  return { asked: Array.from({ length: n }, () => ({ qid: qid, at: atISO, answered: false })),
           focus_primary: "franchise", focus_all: ["franchise"] };
}
const consProfile = { industry: "construction", company: "リフォーム職人株式会社", estimates_for_audit: [] };
{
  setNow("2026-09-07T00:00:00Z");
  const far = AP.nextQuestions(consProfile, askedTimes("q_estimates", 3, "2026-08-08T00:00:00Z"), 10);
  const hitFar = far.find((q) => q.qid === "q_estimates");
  check("上限3回でも、14日たてば見積もりの問いは戻ってくる", !!hitFar,
        far.map((q) => q.qid).join(","));
  check("4回目は文面を変える(同じ文を繰り返さない)",
        !!hitFar && hitFar.text === AP.LAST_RESORT_TEXT.q_estimates,
        hitFar ? hitFar.text.slice(0, 24) : "-");

  const near = AP.nextQuestions(consProfile, askedTimes("q_estimates", 3, "2026-09-02T00:00:00Z"), 10);
  check("14日たっていなければ急かさない",
        !near.find((q) => q.qid === "q_estimates"), near.map((q) => q.qid).join(","));

  const story = AP.nextQuestions(consProfile, askedTimes("q_story", 3, "2026-08-08T00:00:00Z"), 10);
  check("打ち切ってよい問い(q_story)は3回で止まったまま",
        !story.find((q) => q.qid === "q_story"), story.map((q) => q.qid).join(","));
}
{
  const { env, stores } = await doneStore({ member_no: "No.001", completed: true });
  stores[0].autopilot = { unanswered_sends: 5, needs_human: { since: "2026-09-01T00:00:00Z", why: "5回続けて送って、返事が一度も無い" } };
  setNow("2026-09-07T00:00:00Z");
  await tick(env, stores);
  const ap = stores[0].autopilot;
  check("昇格したら無返答の数を0に戻す", (ap.unanswered_sends || 0) === 0 || ap.unanswered_sends === 1,
        String(ap.unanswered_sends));
  check("昇格したら人送りの印を外す(その立場での回数ではないから)",
        !ap.needs_human || ap.needs_human.since !== "2026-09-01T00:00:00Z",
        JSON.stringify(ap.needs_human || null));
}

console.log("\n確かめた数: " + ran + " 件 / 失敗 " + fail + " 件");
if (fail) { console.log("返事待ちの膠着 " + fail + " 件おかしい。"); process.exit(1); }
console.log("返事待ちの膠着 すべて通過");
