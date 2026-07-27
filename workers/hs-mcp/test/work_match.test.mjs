// 工種照合の回帰テスト。**うちが過大請求を「適正です」と返していた件の再発防止。**
//
// 起きていたこと（2026-07-27 実測）:
//   audit_estimate(work="屋根塗装", quoted_price=1200000)
//     → 外壁＋屋根塗装セット 30坪(90〜130万) に当たり verdict="適正レンジ内" level="ok"
//   真の候補は 屋根塗装 30坪（シリコン）(25〜60万)。**平均の2.4倍、上限の2倍を「安心です」と返していた。**
//   原因は includes() で当たった候補の**配列1番目**をそのまま使っていたこと。同じ2行が4箇所にあった。
//   souba-db 183件・照会語370件の全数走査で 65語が候補割れ、うち24語が同じ誤りを起こしていた。
//
// ここで固定するのは3つ。
//   1) 先頭一致が部分一致に勝つこと（「屋根塗装」が正しい先に着く）
//   2) 候補が割れて判定が一致しないときは**判定を出さない**こと
//   3) **level="ok" を返したなら、同じ段位のどの候補もその金額を alert と言わないこと**
//      ← これが本丸。3 が守られている限り「過大請求を安心と返す」は起きない。
//
// 実物を叩く。souba-db はリポジトリの実データを差し込む。

import { readFileSync } from "node:fs";
import worker, { pickCands, verdictOf, strictest } from "../src/mcp.js";

const DB = JSON.parse(readFileSync(new URL("../../../data/souba-db.json", import.meta.url), "utf8"));
const LIST = DB.categories;

// souba-db の取得だけを差し替える。それ以外のネットワークは使わせない。
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url && url.url ? url.url : url);
  if (u.includes("/data/souba-db.json")) {
    return new Response(JSON.stringify(DB), { headers: { "content-type": "application/json" } });
  }
  throw new Error("テスト中に想定外の外部アクセス: " + u);
};

let fail = 0;
const chk = (n, c, x = "") => {
  console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 240)));
  if (!c) fail++;
};

const call = async (name, args) => {
  const r = await worker.fetch(new Request("https://hs-mcp.test/", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }), {}, { waitUntil() {} });
  const j = await r.json();
  const txt = j.result && j.result.content && j.result.content[0] && j.result.content[0].text;
  try { return JSON.parse(txt); } catch (e) { return { _raw: String(txt) }; }
};

// ---- 1. 実際に起きていた誤りそのもの ----
{
  const o = await call("audit_estimate", { work: "屋根塗装", quoted_price: 1200000 });
  chk("屋根塗装120万が『外壁＋屋根塗装セット』に流れない", o.work === "屋根塗装 30坪（シリコン）", JSON.stringify(o).slice(0, 200));
  chk("屋根塗装120万を『適正』と言わない", o.level !== "ok", "level=" + o.level);
  chk("  適正レンジは屋根塗装単体のもの", o.fair_range && o.fair_range.max === 600000, JSON.stringify(o.fair_range));
}

// ---- 2. 絞り込めず、しかも判定が割れる語では判定を出さない ----
// **「候補が複数ある」だけでは止めない。**結論が一致するなら答えて構わない。
// 曖昧さを件数ではなく結果で測る、という設計をここで固定する。
for (const [q, why] of [["屋根", "塗装25万〜葺き替え200万まで指しうる"],
                        ["リフォーム", "候補が多く、結論が割れる"]]) {
  const o = await call("audit_estimate", { work: q, quoted_price: 1200000 });
  chk("判定保留: " + q + "（" + why + "）", o.ambiguous === true, JSON.stringify(o).slice(0, 200));
  chk("  候補を返す: " + q, Array.isArray(o.candidates) && o.candidates.length > 1);
  chk("  判定語を含まない: " + q, o.verdict === undefined && o.level === undefined);
  chk("  『こちらでは決められない』と書く: " + q, /決めることはできない/.test(o.limits || ""));
}

// ---- 2-b. 判定が一致するなら答えてよい。ただし**何に当てたかを必ず開示する。** ----
// 「浴室」で120万は、該当する段位の候補（強化ガラス交換・解体・乾燥機）が全部「高すぎる」と言う。
// 結論が割れないので答える。**ただし聞かれた語と当たった工事名の両方を出す。**
// 片方しか見せないと、工事名のすり替えに見える。
// 「外構」で120万が「適正」になるのは正しい。段位で絞ると work が外構で始まるのは
// 外構フルセット 関東（100〜180万）1件だけで、庭木剪定などは cat「外構・庭」の部分一致にすぎない。
// **外構で120万と言う人が庭木剪定1本を指している可能性は考えなくてよい。**
// ここで見るのは判定の向きではなく**開示**である。安全側かどうかは第3節の不変条件が見る。
for (const [q, p, expect] of [["浴室", 1200000, "複数候補・判定一致"], ["外構", 1200000, "段位で1件に絞れる"]]) {
  const o = await call("audit_estimate", { work: q, quoted_price: p });
  if (o.ambiguous) { chk("開示: " + q + " は判定保留（" + expect + "）", true); continue; }
  chk("開示: " + q + " は聞かれた語をそのまま返す（" + expect + "）", o.work_query === q, "work_query=" + o.work_query);
  chk("開示: " + q + " は当たった工事名も返す", typeof o.work === "string" && o.work.length > 0, o.work);
  chk("開示: " + q + " は何件から選んだかを返す", o.matched && typeof o.matched.count === "number", JSON.stringify(o.matched));
  if (o.matched && o.matched.count > 1) {
    chk("開示: " + q + " は選ばなかった候補も返す", Array.isArray(o.matched.others) && o.matched.others.length > 0);
    chk("開示: " + q + " は甘い側に倒していないと明記", /甘い側に倒さない/.test(o.matched.selected_because || ""));
  }
}

// ---- 3. 本丸の不変条件 ----
// **level="ok" を返したなら、同じ段位のどの候補もその金額を alert と言わない。**
// 照会語は souba-db 自身（cat / work名の頭 / work完全名）と、hs-webmcp の router が送る語から作る。
const ASK_WORKS_SENT = ["外壁塗装","雨漏り","屋根","外壁","トイレ","キッチン","浴室","ユニットバス","洗面","給湯器",
  "エコキュート","シロアリ","内窓","窓","サッシ","玄関","フローリング","床","クロス","解体","外構","カーポート",
  "エアコン","断熱","防水","足場","電気","配管","給排水","リノベ","リフォーム","新築","塗装",
  "屋根塗装","屋根カバー工法","屋根葺き替え","トイレ交換","キッチン交換","ユニットバス交換","給湯器交換","雨漏り修理"];
const QUERIES = new Set(ASK_WORKS_SENT);
for (const e of LIST) {
  if (e.cat) QUERIES.add(e.cat);
  if (e.work) {
    QUERIES.add(e.work);
    const head = e.work.normalize("NFKC").split(" ")[0].split("(")[0].trim();
    if (head.length >= 2) QUERIES.add(head);
  }
}
const PROBES = [50000, 120000, 300000, 600000, 1200000, 2000000, 5000000];
let checked = 0, violations = [];
for (const q of QUERIES) {
  const cand = pickCands(LIST, q);
  if (!cand.length) continue;
  for (const p of PROBES) {
    const o = await call("audit_estimate", { work: q, quoted_price: p });
    if (o.ambiguous || o.unit_mismatch || o.did_you_mean || o._raw) continue;
    checked++;
    if (o.level !== "ok") continue;
    // 単価建てに総額を渡した候補は照合対象から外れている（実装と同じ扱い）。
    const same = cand.filter(e => verdictOf(e, p) !== "unit_mismatch");
    const worse = same.filter(e => verdictOf(e, p) === "alert");
    if (worse.length) violations.push({ q, p, said: o.work, worse: worse.map(e => e.work) });
  }
}
chk("判定を返した組み合わせ数が十分にある（素通りしていない）", checked > 300, "checked=" + checked);
chk("**『適正』と返した中に、同じ段位の候補が危険水準と言うものは1件も無い**",
    violations.length === 0, JSON.stringify(violations.slice(0, 5), null, 1));
console.log("      走査: 照会語 " + QUERIES.size + " × 金額 " + PROBES.length + " / 判定が出た組 " + checked);

// ---- 4. 署名・刻印は、確定できないなら拒む ----
{
  const o = await call("verify_fair_price", { work: "屋根" });
  chk("署名: 絞り込めない工事名には署名しない", o.ambiguous === true, JSON.stringify(o).slice(0, 200));
  chk("  ハッシュも検証URLも発行しない", o.claim_hash === undefined && o.verify_url === undefined);
}
{
  const o = await call("verify_fair_price", { work: "屋根塗装 30坪（シリコン）" });
  const c = o.fair_price_claim || {};
  const v = o.verification || {};
  chk("署名: 一意に決まるなら従来どおり発行する", o.ambiguous !== true && c.work === "屋根塗装 30坪（シリコン）",
      JSON.stringify(o).slice(0, 240));
  chk("  署名対象は屋根塗装単体のレンジ", c.fair_max === 600000, JSON.stringify(c));
  chk("  検証手段が付いている", !!(v.claim_sha256 || v.verify_url || o.verify_url || o.claim_hash),
      JSON.stringify(v).slice(0, 200));
}

// ---- 4-b. 適正レンジを下回る見積も「適正」ではない ----
// 旧実装は price <= max なら無条件で ok だったので、
// 屋根葺き替え(適正90〜180万)に10万円を渡しても「適正レンジ内です。安心です」と返していた。
// souba-db 全件走査で **min 未満なのに ok になる組が 693/915** あった。
// 同じ扱いは hs-pdf-gen/hs-meisai-engine.js の総額判定に既に在り（subtotal < lo → watch）、
// **二つのエンジンが同じ見積に違う判定を出していた。**ここで揃えたことを固定する。
for (const [w, p, why] of [
  ["屋根葺き替え スレート 30坪", 100000, "適正90〜180万に10万円"],
  ["外壁塗装 30坪 一式（シリコン）", 200000, "適正70〜115万に20万円"],
]) {
  const o = await call("audit_estimate", { work: w, quoted_price: p });
  chk("安すぎ: " + why + " を『適正』と言わない", o.level !== "ok", "level=" + o.level + " verdict=" + o.verdict);
  chk("  安すぎと明示する", /安すぎ/.test(o.verdict || ""), o.verdict);
  chk("  『安いことは良い知らせではない』と書く", /良い知らせではありません/.test(o.advice || ""), o.advice);
  chk("  何を疑うべきかを具体的に書く", /(追加請求|下地処理|足場)/.test(o.advice || ""), o.advice);
  // **一つの応答の中で相反することを言わない。**安すぎの応答に「適正上限を超えています」が
  // 混ざっていた（ehn の文面が高い前提のままだった）。向きで文面を分けたことを固定する。
  chk("  応答の中で逆のことを言わない", !/適正上限を超え/.test(JSON.stringify(o)), JSON.stringify(o.ehn || {}));
  chk("  安すぎ側の EHN 文面になっている", /下回っています/.test((o.ehn && o.ehn.why) || ""), (o.ehn || {}).why);
}
{
  const o = await call("audit_estimate", { work: "屋根塗装 30坪（シリコン）", quoted_price: 400000 });
  chk("安すぎ: レンジ内は従来どおり適正のまま", o.level === "ok" && /適正レンジ内/.test(o.verdict), o.verdict);
}

// ---- 5. 相場の一覧は絞らない。並び順だけ直す ----
{
  const o = await call("get_price_range", { query: "屋根" });
  chk("一覧は全件返す（絞り込みはしない）", o.count === 8, "count=" + o.count);
  chk("一覧の先頭は一致の質が最も高いもの", o.prices && /^屋根/.test(o.prices[0].work), o.prices && o.prices[0].work);
}

// ---- 6. 甘い側に倒さない ----
{
  const cand = pickCands(LIST, "屋根");
  const s = strictest(cand);
  chk("複数候補で選ぶのは上限が最も低いもの", cand.every(e => e.max >= s.max), s.work);
}

globalThis.fetch = realFetch;
console.log(fail ? `\nwork match: ${fail} FAILURES` : "\nwork match: ALL PASS");
process.exit(fail ? 1 : 0);
