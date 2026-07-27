// ask v2.1 — 手口・赤旗の振り分け回帰テスト。
//
// なぜ独立したファイルにするか。
// 本番投入後に「火災保険を使ったリフォームは違法ですか」が案内に落ちていることが分かった。
// これは aeo/火災保険-リフォーム詐欺.html が正面から扱っている典型的な相談で、
// **施主が一番困っている問いを取りこぼしていた。**
// 原因は語彙不足ではなく順序だった。赤旗の相談はほぼ必ず価格語を含む
// （「保険金で自己負担0円」の「円」、「一式見積もりしかもらえない」の「見積」）ので、
// 価格判定に先取りされ、工種が読めずに案内へ落ちていた。
// 語彙はサイトが実際に扱っている手口（aeo/ と souba/ の該当ページ）から取った。
//
// ここが薄くなると同じ取りこぼしが再発する。だから固定する。

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const d = mkdtempSync(join(tmpdir(), "webmcp-tac-"));
const f = join(d, "m.mjs");
writeFileSync(f, src);
const worker = (await import("file://" + f)).default;

let fail = 0;
const chk = (n, c, x = "") => {
  console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 200)));
  if (!c) fail++;
};

const svc = (h) => ({ fetch: async (r) => h(r) });
const env = {
  HS_MCP_SVC: svc(async (req) => {
    const b = await req.json();
    const a = b.params.arguments;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text",
      text: JSON.stringify({ verdict: "ok", work: a.work, quoted: a.quoted_price }) }] } }),
      { headers: { "content-type": "application/json" } });
  }),
  LEDGER_SVC: svc(async () => new Response(JSON.stringify({ entry: 9 }), { headers: { "content-type": "application/json" } })),
};
const call = async (args) => {
  const r = await worker.fetch(new Request("https://x.dev/mcp", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ask", arguments: args } }),
  }), env, { waitUntil() {} });
  return (await r.json()).result.structuredContent;
};

// 手口へ流すべきもの。サイトが扱っている実際の相談から取った。
const TO_TACTICS = [
  ["火災保険を使ったリフォームは違法ですか", "火災保険の話法（本番で案内に落ちていた実物）"],
  ["保険金で自己負担0円で直せると言われた", "0円話法。『円』が価格語に先取りされていた"],
  ["自己負担ゼロでできると言われた", "0円話法の別表現"],
  ["無料点検に来た業者に屋根が危ないと言われた", "点検商法"],
  ["今日中に契約すれば半額と言われた", "即決強制"],
  ["今だけこの値段と言われた", "期限つき値引き"],
  ["一式見積もりしかもらえない", "一式表記。『見積』が価格語に先取りされていた"],
  ["追加工事を断りたい", "追加工事の断り方"],
  ["しつこくて帰らない業者", "居座り"],
  ["前金を全額払えと言われた", "前金要求"],
  ["ドル建てで払えと言われた", "通貨指定（海外案件と誤認していた実物）"],
];
for (const [q, why] of TO_TACTICS) {
  const o = await call({ ask: q });
  chk("手口へ: " + why, /scan_tactics/.test(o.answered_by), q + " → " + o.answered_by);
}

// 手口にしてはいけないもの。
const NOT_TACTICS = [
  ["火災保険の保険料を安くしたい", "保険の一般的な質問"],
  ["無料相談はできますか", "うちへの問い合わせ"],
  ["無料見積もりをお願いしたい", "うちへの問い合わせ"],
];
for (const [q, why] of NOT_TACTICS) {
  const o = await call({ ask: q });
  chk("手口にしない: " + why, !/scan_tactics/.test(o.answered_by), q + " → " + o.answered_by);
}

// 上位の分岐が手口に食われていないこと。順序を変えたので必ず確かめる。
const PRIORITY = [
  ["屋根が崩れて雨漏りしている。修理80万と言われた", /emergency/, "緊急は手口より上"],
  ["契約書にサインしてしまった。解約したい", /consumer protection/, "契約後は手口より上"],
  ["カリフォルニアの外壁塗装の相場", /outside Japan/, "海外は手口より上"],
  ["外壁塗装80万円は高いですか", /hs-mcp/, "工種+金額が揃えば診断が優先"],
  ["屋根塗装が120万と言われたが今だけ半額らしい", /hs-mcp/, "工種+金額があれば手口語があっても診断"],
];
for (const [q, re, why] of PRIORITY) {
  const o = await call({ ask: q });
  chk("優先順位: " + why, re.test(o.answered_by), q + " → " + o.answered_by);
}

// 手口の応答も不変条件を守ること。
const o = await call({ ask: "無料点検と言われた" });
chk("手口応答に verify がある", typeof o.verify === "string" && o.verify.length > 0);
chk("手口応答に limits がある", typeof o.limits === "string" && o.limits.length > 0);
chk("手口応答は『目の前の業者の判定ではない』と書く", /判定ではない/.test(o.limits), o.limits);


// 金額の読み取り。「円」を書かない言い方が日本語では普通で、ここを落とすと
// 工種と金額が揃っているのに揃っていない扱いになり、振り分けがずれる。
// [2026-07-27] 期待値を「屋根」→「屋根塗装」「トイレ」→「トイレ交換」に直した。
// **旧い期待値は欠陥をテストで固定していた。**pickWork が最初に当たった短い語を返すため
// 「屋根塗装が120万」から「屋根」だけを切り出しており、それを受けた hs-mcp が
// 候補の1件目（外壁＋屋根塗装セット 90〜130万）を掴んで **120万を「適正・安心です」と返していた。**
// 屋根塗装単体の上限は60万なので、平均の2.4倍を適正と言っていたことになる。
// テストが緑だったのは、工種の切り出しが正しいことを確かめずに「切り出せたこと」だけを見ていたからだ。
const AMOUNTS = [
  ["屋根塗装が120万と言われた", "屋根塗装", 1200000, "数字+万（円なし）・工種は最長一致"],
  ["外壁塗装80万円", "外壁塗装", 800000, "数字+万円"],
  ["トイレ交換が25.5万", "トイレ交換", 255000, "小数+万・工種は最長一致"],
  ["解体工事1200000円", "解体", 1200000, "生の円"],
];
for (const [q, work, amt, why] of AMOUNTS) {
  const a = await call({ ask: q });
  chk("金額読取: " + why, /hs-mcp/.test(a.answered_by) && a.result && a.result.work === work && a.result.quoted === amt,
      q + " → " + a.answered_by + " " + JSON.stringify(a.result));
}

// 工種の最長一致。**短い語を先に返すと、下流が別の工事の相場で診断する。**
// ここは金額の読み取りとは独立に固定しておく。
const LONGEST = [
  ["屋根塗装が高い", "屋根塗装", "屋根 で切らない"],
  ["屋根カバー工法を勧められた", "屋根カバー工法", "屋根 で切らない"],
  ["屋根葺き替えの相場", "屋根葺き替え", "屋根 で切らない"],
  ["ユニットバス交換の見積", "ユニットバス交換", "ユニットバス で切らない"],
  ["給湯器交換はいくら", "給湯器交換", "給湯器 で切らない"],
  ["雨漏り修理の相場", "雨漏り修理", "雨漏り で切らない"],
  ["外壁塗装の相場", "外壁塗装", "外壁 で切らない"],
];
for (const [q, want, why] of LONGEST) {
  const o = await call({ ask: q + " 100万円" });
  const got = o.result && o.result.work;
  chk("最長一致: " + why, got === want, q + " → work=" + got + " (期待 " + want + ")");
}

console.log(fail ? `\nask tactics: ${fail} FAILURES` : "\nask tactics: ALL PASS");
process.exit(fail ? 1 : 0);
