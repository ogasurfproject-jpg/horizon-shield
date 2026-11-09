/* 望みの頁が空のうちは、その目的の設問を 3 回で打ち切らないことを、実物の nextQuestions で確かめる。
   なぜ要るか (2026-11-09): 峰尾さま(002)の採用、001 の協力店・加盟店の増強。どちらも望みの設問が
   3 回(ASK_MAX)で打ち切られ、答え 0 のまま二度と聞かれず、人が LINE で手で聞く羽目になっていた。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRCDIR = path.join(HERE, "src");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hsfretry-"));
for (const f of fs.readdirSync(SRCDIR)) {
  if (!f.endsWith(".js")) continue;
  let body = fs.readFileSync(path.join(SRCDIR, f), "utf8");
  body = body.replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, ".mjs")), body);
}
const AP = await import(path.join(TMP, "autopilot.mjs") + "?v=" + Math.random());
let checks = 0, fails = 0;
const ok = (c, l) => { checks += 1; if (!c) { fails += 1; console.log("  NG:", l); } };
const DAY = 86400000, now = Date.now();
const iso = (d) => new Date(now - d * DAY).toISOString();
const profile = { industry: "construction", company: "試験の店", areas_served: ["平塚市", "茅ヶ崎市", "藤沢市"],
  strengths: "x".repeat(130), faqs: [{ q: "a", a: "b" }, { q: "c", a: "d" }, { q: "e", a: "f" }],
  trust: "y".repeat(40), estimates_for_audit: [{}, {}, {}], contact: "0000", license: "なし", story: "s", cases: ["c"], extra: {} };
const recruitQ = Object.keys(AP.QUESTION_BANK.recruit);
const asked3 = (qids, daysAgo) => [].concat(...qids.map((q) => [0, 1, 2].map((k) => ({ qid: q, at: iso(daysAgo + k * 4) }))));
const apBase = { focus_primary: "homeowners", focus_all: ["homeowners", "recruit"] };

/* 1) 採用の答え 0、3 回聞いて 20 日たった → 採用の設問が出る、前置き付き */
let ap = { ...apBase, asked: asked3(recruitQ, 20) };
let nq = AP.nextQuestions(profile, ap, 40);
let hit = nq.find((x) => x.qid === recruitQ[0]);
ok(!!hit, "頁が空の採用の設問は 3 回で打ち切らず出る");
ok(!!hit && hit.text.startsWith("以前にもお尋ねした問いです。御社のご希望の「人材募集」"), "4 回目は前置き付きの言い方");
/* 2) 冷却(RETRY_COOL_D)の内は出さない */
ap = { ...apBase, asked: asked3(recruitQ, 2) };
nq = AP.nextQuestions(profile, ap, 40);
ok(!nq.some((x) => recruitQ.includes(x.qid)), "最後に聞いてから 14 日未満なら出さない");
/* 3) 採用に一つ答えが入れば普通の決まりに戻る(3 回で打ち切り) */
const p2 = { ...profile, extra: { [recruitQ[0]]: { text: "サッシの取付職人を1名募集。未経験可。", at: iso(30), attributed: "sole" } } };
ap = { ...apBase, asked: asked3(recruitQ, 20) };
nq = AP.nextQuestions(p2, ap, 40);
ok(!nq.some((x) => recruitQ.slice(1).includes(x.qid)), "頁が立った後は 3 回で打ち切りに戻る");
/* 4) 望みに入っていない目的の設問は打ち切りのまま */
const frQ = Object.keys(AP.QUESTION_BANK.franchise);
ap = { ...apBase, asked: asked3(frQ, 20) };
nq = AP.nextQuestions(profile, ap, 40);
ok(!nq.some((x) => frQ.includes(x.qid)), "望みでない目的の設問は出さない");
/* 5) 人に回した店には出さない(11/04 の決まりを壊さない) */
ap = { ...apBase, asked: asked3(recruitQ, 20), needs_human: { why: "試験" } };
ok(AP.nextQuestions(profile, ap, 40).length === 0, "needs_human の店には何も出さない");
/* 6) 協力店の望み: 答えが受け答えだけ(進めて下さい)を消した後は、頁が空として前に出る */
ap = { focus_primary: "franchise", focus_all: ["franchise"], asked: asked3(frQ, 20) };
nq = AP.nextQuestions(profile, ap, 2);
ok(nq.length > 0 && frQ.includes(nq[0].qid) && nq[0].text.includes("協力店・加盟店の募集"), "協力店の設問が先頭に、前置き付きで出る");
console.log(fails ? `${fails}/${checks} 落ちた` : `望みの設問の聞き直し: ${checks}/${checks} 通過`);
process.exit(fails ? 1 : 0);
