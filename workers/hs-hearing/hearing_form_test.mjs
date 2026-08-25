/* ヒアリングフォームを、実物の hearingForm を呼んで確かめる。
   ネットワークには出ない。KV も要らない。

   なぜ要るか (2026-08-25):
     このフォームは建設専用だった。必須欄が「工種」で、許可番号が「建設業許可番号」で、
     見積もり例の欄があった。訪問看護の事業所は、必須欄で止まって送れない。
     送れなければ完成度は上がらず、完成度が上がらなければ専用窓口は生成されない。

     業種で言葉を差し替えたので、次の2つを毎回確かめる。
       1) 建設の紙が、これまでと同じ言葉・同じ選択肢・同じ送信項目であること。
          峰尾様は既にこの紙で答えている。ここが変わったら、答えの意味が変わる。
       2) 訪問看護の紙に、建設の言葉が1つも残っていないこと。
          「工種」が1つでも残っていたら、それは訪問看護の事業所に見せてよい紙ではない。

     さらに、1回の送信で完成度が生成の基準(60)を超えることも確かめる。
     超えなければ、この紙を作った意味が無い。LINE の追撃は3日に2問で、
     訪問看護の設問は45問ある。追撃だけでは 2026-10-01 に間に合わない。

   node workers/hs-hearing/hearing_form_test.mjs
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRCDIR = path.join(HERE, "src");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hsform-"));
for (const f of fs.readdirSync(SRCDIR)) {
  if (!f.endsWith(".js")) continue;
  let body = fs.readFileSync(path.join(SRCDIR, f), "utf8");
  body = body.replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
  if (f === "hearing.js") {
    body += "\nexport { hearingForm, normalizeProfile, formPack, knownQids };\n";
  }
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, ".mjs")), body);
}
const H = await import(path.join(TMP, "hearing.mjs") + "?v=" + Math.random());
const AP = await import(path.join(TMP, "autopilot.mjs") + "?v=" + Math.random());
const IND = await import(path.join(TMP, "industry.mjs") + "?v=" + Math.random());
const VIS = await import(path.join(TMP, "visibility.mjs") + "?v=" + Math.random());

let ran = 0, bad = 0;
const ok = (cond, name) => { ran++; if (!cond) { bad++; console.log("  NG  " + name); } };

console.log("試す対象: " + path.join(SRCDIR, "hearing.js"));

/* ------------------------------------------------------------------ */
console.log("\n1) 建設の紙が、これまでと同じであること");

const cStore = { company: "ミネオトーヨー住器", member_no: "002", store_id: "hs-partner-002", industry: "construction" };
const c = H.hearingForm("ht_test", cStore);

for (const w of ["対応できる工種", "建設業許可番号", "施主からよく聞かれる質問と答え",
                 "施主対応の連絡先", "実際の見積もり例", "各工種の強み・こだわり",
                 "その他の工種(自由入力)", "採用(社員募集)"]) {
  ok(c.includes(w), "建設に『" + w + "』がある");
}
for (const chip of ["外壁塗装", "屋根", "内装", "クロス", "床・フローリング", "浴室", "キッチン",
                    "トイレ", "洗面", "水道", "外構", "防水", "リノベーション全般"]) {
  ok(c.includes('data-w="' + chip + '"'), "建設の工種チップ『" + chip + "』");
}
for (const role of ["塗装工", "屋根工", "防水工", "大工", "内装工", "左官", "板金工",
                    "現場監督", "施工管理", "営業", "事務"]) {
  ok(c.includes('data-w="' + role + '"'), "建設の職種チップ『" + role + "』");
}
ok(c.includes('id="addEst"'), "建設に見積もり追加ボタンがある");
ok(c.includes("社名・所在地・工種は必須です。"), "建設の必須欄のことわりが元のまま");
ok(c.includes("<title>加盟店ヒアリング ｜ Yakumo</title>"), "建設の題が元のまま");
ok(c.includes('<div class="brand">Yakumo</div>'), "建設の名乗りが Yakumo のまま");
// 送信する項目名。ここが変わると、受け側(normalizeProfile)と噛み合わなくなる。
for (const key of ["company:val(\"company\")", "rep:val(\"rep\")", "license:val(\"license\")",
                   "area:val(\"area\")", "areas:val(\"areas\")", "works:works",
                   "strengths:val(\"strengths\")", "estimates:estimates", "faqs:faqs",
                   "trust:val(\"trust\")", "contact:val(\"contact\")", "hours:val(\"hours\")",
                   "ng:val(\"ng\")"]) {
  ok(c.includes(key), "送信する項目『" + key.split(":")[0] + "』が残っている");
}

/* ------------------------------------------------------------------ */
console.log("\n2) 訪問看護の紙に、建設の言葉が残っていないこと");

const nStore = { company: "合同会社あっぷす", member_no: "003", store_id: "hs-partner-003", industry: "nursing" };
const n = H.hearingForm("ht_test2", nStore);

for (const w of ["工種", "塗装", "施主", "建設業許可", "見積もり", "職人"]) {
  const hits = n.split(w).length - 1;
  ok(hits === 0, "訪問看護に『" + w + "』が0回 (実測 " + hits + " 回)");
}
for (const w of ["対応できる医療処置", "事業所番号(指定訪問看護事業所番号)", "訪問できるエリア",
                 "ケアマネさん・ご家族からよく聞かれる質問と答え", "管理者名",
                 "正式な事業所名(法人名)", "採用(職員募集)"]) {
  ok(n.includes(w), "訪問看護に『" + w + "』がある");
}
for (const chip of ["在宅酸素", "人工呼吸器", "気管カニューレ", "中心静脈栄養", "褥瘡処置",
                    "ストーマ管理", "喀痰吸引", "ターミナルケア", "精神科訪問看護"]) {
  ok(n.includes('data-w="' + chip + '"'), "訪問看護の処置チップ『" + chip + "』");
}
for (const role of ["看護師", "准看護師", "保健師", "理学療法士", "作業療法士", "言語聴覚士",
                    "ケアマネジャー", "管理者"]) {
  ok(n.includes('data-w="' + role + '"'), "訪問看護の職種チップ『" + role + "』");
}
ok(!n.includes('id="addEst"'), "訪問看護に見積もり追加ボタンが無い");
ok(!n.includes("addEst"), "訪問看護の script が addEst に触れない");
ok(c.includes("var addEstBtn=document.getElementById(\"addEst\");"),
   "建設側は取得してから使う(要素が無い場合に備える)");
ok(c.includes("if(addEstBtn)"), "建設側も null で止まらない");
ok(n.includes("事業所名・所在地・対応できる医療処置は必須です。"), "訪問看護の必須欄のことわり");

/* ------------------------------------------------------------------ */
console.log("\n3) 業種が無い/知らない業種のときは建設に落ちること(後方互換)");

const noInd = H.hearingForm("ht_x", { company: "業種未設定の店" });
ok(noInd.includes("対応できる工種"), "業種が無ければ建設の紙");
const weird = H.hearingForm("ht_y", { company: "謎の業種", industry: "zzz" });
ok(weird.includes("対応できる工種"), "知らない業種でも建設の紙(落ちない)");
ok(H.formPack("nursing").reqAlert !== H.formPack("construction").reqAlert,
   "業種ごとに必須欄のことわりが違う");

/* ------------------------------------------------------------------ */
console.log("\n4) 追加の設問が、両方の紙に載っていること");

for (const q of VIS.visibilityQids()) {
  ok(c.includes('id="' + q + '" data-q'), "建設に可視性の設問 " + q);
  ok(n.includes('id="' + q + '" data-q'), "訪問看護に可視性の設問 " + q);
}
const nBank = Object.keys(IND.industryBank("nursing") || {});
const cBank = Object.keys(IND.industryBank("construction") || {});
ok(nBank.length >= 40, "訪問看護の設問が40問以上ある (実測 " + nBank.length + ")");
for (const q of nBank) ok(n.includes('id="' + q + '" data-q'), "訪問看護の設問 " + q + " が紙にある");
for (const q of cBank) ok(c.includes('id="' + q + '" data-q'), "建設の設問 " + q + " が紙にある");
for (const q of nBank) ok(!c.includes('id="' + q + '" data-q'), "建設の紙に訪問看護の設問 " + q + " が出ていない");
for (const f of AP.FOCUS_KEYS) {
  ok(n.includes('data-f="' + f + '"'), "目的別の組 " + f + " がある");
  for (const q of Object.keys(AP.QUESTION_BANK[f] || {})) {
    ok(n.includes('id="' + q + '" data-q'), "目的別の設問 " + q + " がある");
  }
}
ok(n.includes('id="story"'), "始めたきっかけの欄がある");
ok(n.includes('id="cases"'), "事例の欄がある");
ok(n.includes('id="focus"'), "目的を選ぶ欄がある");
ok(n.includes("payload.extra=extra"), "設問の答えを送っている");
ok(n.includes("story:val(\"story\")"), "きっかけを送っている");
ok(n.includes("cases:cases"), "事例を送っている");
ok(n.includes("focus:val(\"focus\")"), "目的を送っている");

/* ------------------------------------------------------------------ */
console.log("\n5) 受け側が、知らない設問 id を捨てること");

const raw = {
  company: "合同会社あっぷす", area: "神奈川県平塚市", works: ["在宅酸素", "ターミナルケア"],
  story: "病院で看取りに関わるうち、家に帰りたいと言う方が家に帰れない現実を見て独立しました。",
  cases: ["退院直後の人工呼吸器の方に毎日訪問した", "末期の方を自宅でお看取りした"],
  extra: {
    q_ai_place: "神奈川県平塚市○○ 1-2-3 / 0463-00-0000 / 平日9-17時",
    q_nv_oncall: "算定しています。看護師3名で回しています。",
    "__proto__": "だめ",
    "q_not_a_real_question": "これは捨てられるべき",
    "constructor": "だめ",
  },
};
const prof = H.normalizeProfile(nStore, raw);
ok(prof.extra.q_ai_place === raw.extra.q_ai_place, "実在する可視性の設問は通る");
ok(prof.extra.q_nv_oncall === raw.extra.q_nv_oncall, "実在する訪問看護の設問は通る");
ok(!("q_not_a_real_question" in prof.extra), "知らない id は捨てる");
ok(!Object.prototype.hasOwnProperty.call(prof.extra, "__proto__"), "__proto__ は入らない");
ok(!Object.prototype.hasOwnProperty.call(prof.extra, "constructor"), "constructor は入らない");
ok(prof.story === raw.story, "きっかけが profile に入る");
ok(prof.cases.length === 2, "事例が profile に入る");
ok(prof.industry === "nursing", "業種が profile に残る");
// 建設の紙から送られた訪問看護の設問は、建設の店では受け取らない
const cProf = H.normalizeProfile(cStore, { company: "x", area: "y", works: ["外壁塗装"], extra: { q_nv_oncall: "z" } });
ok(!cProf.extra || !("q_nv_oncall" in cProf.extra), "建設の店に訪問看護の設問は入らない");

/* ------------------------------------------------------------------ */
console.log("\n6) 1回の送信で、生成の基準(60)を超えること");

const filled = H.normalizeProfile(nStore, {
  company: "合同会社あっぷす",
  rep: "平田",
  license: "1460000000",
  area: "神奈川県平塚市",
  areas: "平塚市, 大磯町, 二宮町, 茅ヶ崎市",
  works: ["在宅酸素", "人工呼吸器", "褥瘡処置", "ターミナルケア"],
  strengths: "在宅酸素と人工呼吸器は開設時から対応しています。ターミナルは年間20件ほど。" +
    "オンコールは看護師3名で回しており、夜間の呼び出しから到着まで平均30分です。" +
    "精神科訪問看護は指示書を受けて対応しています。退院前カンファレンスには必ず出ています。",
  faqs: [
    { q: "夜間や休日も来てもらえますか", a: "24時間オンコールで対応しています。" },
    { q: "медicare どちらの保険になりますか", a: "主治医の指示書の内容で決まります。" },
    { q: "費用はどのくらいですか", a: "保険の種別と回数で変わります。お見積りします。" },
  ],
  trust: "開設8年、利用者60名。緩和ケア認定看護師が在籍しています。実地指導は2024年に受診しました。",
  contact: "0463-00-0000",
  hours: "平日9-17時 / 24時間オンコール",
  story: "病院で看取りに関わるうち、家に帰りたいと言う方が家に帰れない現実を見て独立しました。",
  cases: ["退院直後の人工呼吸器の方に毎日訪問した", "末期の方を自宅でお看取りした"],
  extra: {
    q_ai_place: "神奈川県平塚市○○ 1-2-3 / 0463-00-0000 / 平日9-17時 / 平塚市・大磯町・二宮町",
    q_ai_questions: "夜も来てくれるの / 何回来られるの / いくらかかるの",
    q_ai_summary: "平塚で8年、医療依存度の高い方を家で診てきた訪問看護ステーションです。",
    q_ai_tools: "空き状況と対応できる範囲は自動で。医療の判断は必ず人が出ます。",
    q_ai_found: "ケアマネさんからの紹介が8割、病院の連携室が2割です。",
    q_nv_oncall: "算定しています。看護師3名で回しています。",
    q_recruit_roles: "看護師2名。常勤希望です。",
    q_recruit_terms: "社会保険完備、週休2日、オンコール手当あり。",
    q_recruit_culture: "新人は3か月同行してから独り立ちしています。",
  },
  focus: "recruit",
});
const comp = AP.computeCompleteness(filled, { focus_primary: "recruit" });
ok(comp.score >= 60, "1枚で完成度 " + comp.score + "% (基準60)");
console.log("     → 完成度 " + comp.score + "%");
// 見積もり例を求められていないこと(訪問看護に見積書は無い)
ok(!comp.missing.some((m) => m.qid === "q_estimates"), "訪問看護に見積もり例を求めていない");

/* ------------------------------------------------------------------ */
console.log("\n7) 差し込みに耐えること");

const evil = H.hearingForm("ht_z", { company: '<script>alert(1)</script>"', industry: "nursing" });
ok(!evil.includes("<script>alert(1)"), "社名の中の script は出さない");
ok(evil.includes("&lt;script&gt;"), "社名は逃がして出す");
ok(H.hearingForm('"><script>x</script>', nStore).includes('var TOKEN="\\"><script'.slice(0, 12)),
   "トークンは JSON で埋める");

/* ------------------------------------------------------------------ */
console.log("\n8) 催促そのものに、まとめて書ける用紙の場所が載ること");

/* なぜ見るか (2026-08-25):
     LINE の催促には、用紙への案内が一行も無かった。質問だけである。
     メールには案内があったが、宛先が建設のモールの登録ページだった。
     訪問看護の方には、まとめて書く道が一度も届いていなかった。
     3日に2問で45問を埋めようとしていた理由がこれである。 */

function fakeEnv(lineUid) {
  return {
    LINE_CHANNEL_ACCESS_TOKEN: "dummy",
    HS_HEARING_KV: {
      async get(k) {
        if (k.startsWith("store2line:")) return lineUid;
        return null;
      },
    },
  };
}
async function pushedText(store, questions) {
  let sent = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opt) => {
    try { sent = JSON.parse(opt.body).messages[0].text; } catch (_e) { sent = null; }
    return { ok: true, status: 200 };
  };
  try { await AP.sendQuestions(fakeEnv("U_test"), store, questions, "nudge"); }
  finally { globalThis.fetch = realFetch; }
  return sent || "";
}

const nStoreTok = { store_id: "hs-partner-003", company: "合同会社あっぷす", industry: "nursing", token: "ht_abc123" };
const cStoreTok = { store_id: "hs-partner-002", company: "ミネオトーヨー住器", industry: "construction", token: "ht_def456" };
const shortQ = [{ qid: "q_trust", text: "信頼の裏づけを教えてください。" }];

const nBody = await pushedText(nStoreTok, shortQ);
ok(nBody.includes("https://hearing.horizonshield.dev/h/ht_abc123"),
   "訪問看護のLINEに、業種対応フォームのURLが載る");
ok(!nBody.includes("/yakumo/register/"), "訪問看護に建設モールの登録ページを出さない");
ok(nBody.includes("1枚にまとめた用紙"), "用紙があることを言葉でも伝える");
ok(nBody.includes("HORIZON SHIELD"), "訪問看護には HORIZON SHIELD として名乗る");
ok(!nBody.includes("Yakumo"), "訪問看護に Yakumo と名乗らない");

const cBody = await pushedText(cStoreTok, shortQ);
ok(cBody.includes("https://shield.the-horizons-innovation.com/yakumo/register/?code=ht_def456"),
   "建設のLINEは、これまでどおりモールの登録ページ");
ok(!cBody.includes("hearing.horizonshield.dev/h/"), "建設の導線を勝手に付け替えない");

const noTok = await pushedText({ store_id: "x", company: "トークン無し", industry: "nursing" }, shortQ);
ok(noTok.length > 0, "トークンが無くても催促自体は送れる");
ok(!noTok.includes("/h/"), "トークンが無いのに用紙のURLを作らない");

// LINE は 1900 字で切られる。切られて困るのは用紙の在り処である。
const longQ = [{ qid: "q1", text: "あ".repeat(1200) }, { qid: "q2", text: "い".repeat(1200) }];
const cut = await pushedText(nStoreTok, longQ);
ok(cut.length <= 1900, "1900字を超えない (実測 " + cut.length + ")");
ok(cut.includes("https://hearing.horizonshield.dev/h/ht_abc123"),
   "質問が長くても、用紙のURLは切り落とされない");
ok(cut.includes("…"), "削ったことが分かる印を残す");

/* ------------------------------------------------------------------ */
console.log("\n9) 既にもらった答えが、最初から埋まっていること");

/* 平田様は事業所名・エリア・医療処置を LINE で既に答えている。
   空の紙を渡せば、同じことをもう一度打たせる。
   「同じことは、もうお尋ねしません」と送った以上、紙も同じ約束を守る。 */

const hirataProf = {
  company: "合同会社アップス",
  area: "平塚市",
  areas_served: ["平塚市全域", "大磯町", "二宮町(要相談)"],
  works: ["在宅酸素", "酸素管理", "カテーテル管理"],
  contact: "", strengths: "", trust: "",
};
const bareStore = { store_id: "kira-wbbk99p9", industry: "nursing" }; // store: 側に社名が無い(実際そうだった)
const pn = H.hearingForm("ht_pre", bareStore, hirataProf);

ok(pn.includes("対象: <b>合同会社アップス</b>"), "store に社名が無くても profile から拾う");
ok(pn.includes('id="company" value="合同会社アップス"'), "社名が埋まっている");
ok(pn.includes('id="area" placeholder') && pn.includes('value="平塚市" required'), "所在地が埋まっている");
ok(pn.includes('value="平塚市全域, 大磯町, 二宮町(要相談)"'), "エリアが埋まっている");
ok(pn.includes('class="chip on" data-w="在宅酸素"'), "答えてもらった処置のチップが押されている");
ok(pn.includes('id="worksOther"') && pn.includes('value="酸素管理, カテーテル管理"'),
   "チップに無い処置は自由入力欄に入る");

const pcEmpty = H.hearingForm("ht_pre2", cStore);           // profile 無し
const pcEmpty2 = H.hearingForm("ht_pre2", cStore, {});      // 空の profile
ok(pcEmpty === pcEmpty2, "何ももらっていなければ、紙は1バイトも変わらない");
ok(!pcEmpty.includes('class="chip on"'), "空のときチップは押されていない");
ok(!pcEmpty.includes('id="area" placeholder="例：愛知県長久手市" value='), "空のとき value を書かない");

const evil2 = H.hearingForm("ht_pre3", bareStore, { area: '"><script>x</script>' });
ok(!evil2.includes('"><script>x'), "埋める値の中の script は出さない");
ok(evil2.includes("&quot;&gt;&lt;script&gt;"), "埋める値は逃がして出す");

/* ------------------------------------------------------------------ */
const EXPECT_MIN = 220;
console.log("\n実行 " + ran + " 件 / 失敗 " + bad + " 件");
if (ran < EXPECT_MIN) {
  console.log("検査の数が " + ran + " 件しかない (最低 " + EXPECT_MIN + " 件のはず)。検査が抜け落ちている。");
  process.exit(2);
}
if (bad) { console.log("フォームの検査に失敗がある。"); process.exit(1); }
console.log("フォームの検査 すべて通過");
