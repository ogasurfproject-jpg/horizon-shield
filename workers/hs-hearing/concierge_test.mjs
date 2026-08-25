/* 加盟店窓口の「意図を見る層」を、端から端まで確かめる。
   ネットワークに出ない。KV も要らない。

   なぜ要るか (2026-08-25):
     このシステムは、加盟店から入ってくる文を全部「回答」として処理していた。
     だから、加盟店が質問してきたときにも回答として取り込もうとし、
     答えられずに定型文を返した。平田様の
       「今シートの記載をしてますが、これは途中で止めたらダメになっちゃいますか？」
     に、問いを無視して「掲載します」と返したのが、その形である。

     意図を見分ける層を入れたので、次を毎回確かめる。
       ・質問を質問と見分けること(とくに平田様の実文)
       ・番号つきの返事は回答のままであること
       ・決まった問いに、決まった答え(台帳の範囲)を返すこと
       ・台帳に無い問いは、大賀に回すこと(作り話をしない)

   node workers/hs-hearing/concierge_test.mjs
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRCDIR = path.join(HERE, "src");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hscon-"));
for (const f of fs.readdirSync(SRCDIR)) {
  if (!f.endsWith(".js")) continue;
  let body = fs.readFileSync(path.join(SRCDIR, f), "utf8");
  body = body.replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, ".mjs")), body);
}
const C = await import(path.join(TMP, "concierge.mjs") + "?v=" + Math.random());

let ran = 0, bad = 0;
const ok = (cond, name) => { ran++; if (!cond) { bad++; console.log("  NG  " + name); } };

console.log("試す対象: " + path.join(SRCDIR, "concierge.js"));

/* ------------------------------------------------------------------ */
console.log("\n1) 意図を見分ける");

// 平田様の実文。これが question と出なければ、この層を作った意味が無い。
ok(C.partnerIntent("今シートの記載をしてますが、これは途中で止めたらダメになっちゃいますか？") === "question",
   "平田様の実文『途中で止めたらダメ…ますか？』は質問");

for (const q of [
  "夜間も来てもらえますか？",
  "これって全部書かないとダメですか",
  "何を書けばいいか分かりません",
  "料金はいくらですか？",
  "途中で保存できますか",
  "掲載はいつ頃になりますでしょうか",
  "写真も送った方がいいですか？",
]) ok(C.partnerIntent(q) === "question", "質問: " + q);

for (const a of [
  "1) 常勤4名です\n2) 加算は2つ取っています",
  "①在宅酸素 ②人工呼吸器",
  "うちは創業70年です",
  "在宅酸素、人工呼吸器、褥瘡処置、ターミナルケア",
  "神奈川県平塚市とその周辺で対応しています",
  "看護師3名、准看護師1名です",
]) ok(C.partnerIntent(a) === "answer", "回答: " + a);

ok(C.partnerIntent("") === "other", "空は other");
ok(C.partnerIntent("ありがとうございます") === "answer", "お礼は回答扱い(既定・実害なし)");

// 番号つきは、末尾に ？ があっても回答(こちらの複数設問への返事)
ok(C.partnerIntent("1) はい\n2) それは何ですか？") === "answer",
   "番号つきで始まれば、末尾が疑問でも回答");

/* ------------------------------------------------------------------ */
console.log("\n2) 決まった問いに、決まった答え(台帳の範囲)");

const faqStop = C.conciergeFAQ("今シートの記載をしてますが、これは途中で止めたらダメになっちゃいますか？");
ok(faqStop && faqStop.includes("途中で止めても大丈夫"), "止めたら→『途中で止めても大丈夫』");
ok(faqStop && faqStop.includes("送信するまでは保存されない"), "止めたら→保存の条件も添える");
ok(faqStop && !/[0-9０-９]\s*(円|万)/.test(faqStop), "止めたらの答えに金額は無い");

ok(C.conciergeFAQ("途中で保存できますか").includes("途中で止めても大丈夫"), "保存できますか→同じ答え");
ok(C.conciergeFAQ("あとで続きから書けますか").includes("続き"), "続き→続きの案内");

const faqWhat = C.conciergeFAQ("何を書けばいいか分かりません");
ok(faqWhat && faqWhat.includes("分かるところだけ"), "何を書く→『分かるところだけ』");

const faqMoney = C.conciergeFAQ("料金はいくらですか");
ok(faqMoney && faqMoney.includes("大賀"), "料金→大賀に回す");

/* ------------------------------------------------------------------ */
console.log("\n3) 台帳に無い問いは、null を返す(呼ぶ側が大賀へ回す)");

for (const q of [
  "看護体制強化加算の要件を教えてください",
  "御社の会社概要を教えて",
  "明日の何時に来ますか",
]) ok(C.conciergeFAQ(q) === null, "台帳外は null: " + q);

/* ------------------------------------------------------------------ */
console.log("\n4) 台帳(FACT_SHEET)と逃げ道(ESCALATE)の中身");

ok(Array.isArray(C.FACT_SHEET) && C.FACT_SHEET.length >= 5, "台帳が5項目以上ある");
ok(C.FACT_SHEET.some((x) => x.includes("途中で止めても大丈夫")), "台帳に『途中で止めても大丈夫』がある");
ok(C.FACT_SHEET.some((x) => x.includes("料金") && x.includes("大賀")), "台帳で料金は大賀に回すと明記");
// 台帳に、制度や加算の具体的な数字を書いていないこと(人が出るべき領域)
ok(!C.FACT_SHEET.some((x) => /[0-9０-９]\s*(単位|円)/.test(x)), "台帳に単位数や金額の具体を書いていない");
ok(typeof C.ESCALATE === "string" && C.ESCALATE.includes("大賀"), "逃げ道は大賀に回す");

/* ------------------------------------------------------------------ */
const EXPECT_MIN = 32;
console.log("\n実行 " + ran + " 件 / 失敗 " + bad + " 件");
if (ran < EXPECT_MIN) { console.log("検査が少ない(" + ran + " < " + EXPECT_MIN + ")。抜けている。"); process.exit(2); }
if (bad) { console.log("窓口の検査に失敗がある。"); process.exit(1); }
console.log("窓口の検査 すべて通過");
