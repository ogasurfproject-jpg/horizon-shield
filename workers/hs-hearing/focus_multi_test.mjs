/* 複数フォーカス(focus_all)の採点と設問選びを、実物の computeCompleteness / nextQuestions で確かめる。
   KV もネットワークも要らない純粋関数。

   なぜ要るか (2026-08-25):
     峰尾様(hs-partner-002)の望みは二つある。新規顧客確保(homeowners)と 従業員募集(recruit)。
     これまでの採点は focus_primary の1バンクしか見ておらず、二つ目の望みの設問は
     聞かれず・数えられず、nextQuestions ではテキストが引けずに落ちていた。
     focus_all を主軸から順に合算するよう直した。その挙動を、言葉ではなく走らせて確かめる。

     後方互換も同時に見る。focus_all が無い/単一の既存店は、一問一句これまでと同じであること。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRCDIR = path.join(HERE, "src");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hsfocus-"));
for (const f of fs.readdirSync(SRCDIR)) {
  if (!f.endsWith(".js")) continue;
  let body = fs.readFileSync(path.join(SRCDIR, f), "utf8");
  body = body.replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, ".mjs")), body);
}
const AP = await import(path.join(TMP, "autopilot.mjs") + "?v=" + Math.random());

let checks = 0, fails = 0;
const ok = (cond, label) => { checks += 1; if (!cond) { fails += 1; console.log("  NG:", label); } };

const HOME_QIDS = ["q_home_cases", "q_home_warranty", "q_home_policy"];
const RECRUIT_QIDS = ["q_recruit_roles", "q_recruit_terms", "q_recruit_culture"];

// 望みが二つある店の型。峰尾様に相当。フォーカス個別は未回答。
const profile = {
  company: "ミネオトーヨー住器株式会社",
  areas_served: ["平塚市", "茅ヶ崎市", "藤沢市"],
  contact: "TEL 0463-61-4955",
  hours: "平日8:00-18:30",
  faqs: [{ q: "内窓は寒さに効きますか", a: "はい" }],
  industry: "construction",
  extra: {},
};
const askableQids = (prof, ap) => new Set(AP.computeCompleteness(prof, ap).askable.map((m) => m.qid));

/* 1) 複数フォーカス: homeowners と recruit の両バンクが askable に出る */
const apMulti = { focus_primary: "homeowners", focus_all: ["homeowners", "recruit"] };
const askMulti = askableQids(profile, apMulti);
for (const q of HOME_QIDS) ok(askMulti.has(q), "multi askable に " + q);
for (const q of RECRUIT_QIDS) ok(askMulti.has(q), "multi askable に " + q);

/* 2) 後方互換: focus_all 無し(従来の記録) → homeowners のみ。recruit は出ない */
const apLegacy = { focus_primary: "homeowners" };
const askLegacy = askableQids(profile, apLegacy);
for (const q of HOME_QIDS) ok(askLegacy.has(q), "legacy askable に " + q);
for (const q of RECRUIT_QIDS) ok(!askLegacy.has(q), "legacy askable に " + q + " は出ない");

/* 3) 後方互換: focus_all:[単一] は focus_primary のみと同点・同 askable */
const apSingleArr = { focus_primary: "homeowners", focus_all: ["homeowners"] };
ok(AP.computeCompleteness(profile, apSingleArr).score === AP.computeCompleteness(profile, apLegacy).score,
   "focus_all:[単一] のスコアが従来と一致");
ok([...askableQids(profile, apSingleArr)].sort().join(",") === [...askLegacy].sort().join(","),
   "focus_all:[単一] の askable が従来と一致");

/* 4) nextQuestions が両バンクのテキストを引けること(recruit の設問が落ちない) */
const nq = AP.nextQuestions(profile, apMulti, 20);
const nqMap = new Map(nq.map((x) => [x.qid, x.text]));
ok(nqMap.has("q_recruit_roles") && nqMap.get("q_recruit_roles").length > 0, "nextQuestions が q_recruit_roles をテキスト付きで出す");
ok(nqMap.has("q_home_cases") && nqMap.get("q_home_cases").length > 0, "nextQuestions が q_home_cases をテキスト付きで出す");

/* 5) 配点10点は全体で頭打ち: 6問すべて回答済みなら focus 個別は askable から消える */
const profDone = { ...profile, extra: {} };
for (const q of [...HOME_QIDS, ...RECRUIT_QIDS]) profDone.extra[q] = "回答済み";
const askDone = askableQids(profDone, apMulti);
for (const q of [...HOME_QIDS, ...RECRUIT_QIDS]) ok(!askDone.has(q), "全回答後 askable に " + q + " は無い");
// 全回答済みの複数フォーカス点は、単一フォーカス全回答と同じ(10点で頭打ち)
const profDoneSingle = { ...profile, extra: {} };
for (const q of HOME_QIDS) profDoneSingle.extra[q] = "回答済み";
ok(AP.computeCompleteness(profDone, apMulti).score === AP.computeCompleteness(profDoneSingle, apLegacy).score,
   "複数フォーカス全回答の点が単一全回答と同じ(10点頭打ち)");

/* 6) フォーカス未設定の店は従来どおり q_focus が askable、focus 個別は出ない */
const apNone = {};
const askNone = askableQids(profile, apNone);
ok(askNone.has("q_focus"), "focus 未設定なら q_focus が askable");
for (const q of [...HOME_QIDS, ...RECRUIT_QIDS]) ok(!askNone.has(q), "focus 未設定で " + q + " は出ない");

/* 7) 無効キーは黙って落とす(壊れた focus_all を混ぜても事故らない) */
const apDirty = { focus_primary: "homeowners", focus_all: ["homeowners", "bogus", "recruit", "homeowners"] };
const askDirty = askableQids(profile, apDirty);
for (const q of [...HOME_QIDS, ...RECRUIT_QIDS]) ok(askDirty.has(q), "無効キー混在でも " + q + " は出る");
ok(!askDirty.has("bogus"), "無効キー bogus は設問に化けない");

console.log("");
const EXPECT = 37;
console.log("確かめた数:", checks, "/ 失敗", fails, "件  (EXPECT " + EXPECT + ")");
if (fails > 0) { console.log("複数フォーカスの検査 失敗あり"); process.exit(1); }
if (checks !== EXPECT) { console.log("EXPECT と実数が違う。走った数=" + checks); process.exit(1); }
console.log("複数フォーカスの検査 すべて通過");
