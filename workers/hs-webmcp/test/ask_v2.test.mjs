// ask v2（深層）の回帰テスト。緊急・範囲外・相互ルーティング・説明文の形。
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const d = mkdtempSync(join(tmpdir(), "webmcp2-"));
const f = join(d, "m.mjs"); writeFileSync(f, src);
const worker = (await import("file://" + f)).default;

let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 300))); if (!c) fail++; };
const svc = (h) => ({ fetch: async (r) => h(r) });
const env = {
  HS_MCP_SVC: svc(async (req) => {
    const b = await req.json(); const a = b.params.arguments;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ verdict: "watch", work: a.work, quoted: a.quoted_price, fair_avg: 900000 }) }] } }), { headers: { "content-type": "application/json" } });
  }),
  LEDGER_SVC: svc(async () => new Response(JSON.stringify({ entry: 9, integrity: { match: true } }), { headers: { "content-type": "application/json" } })),
};
const call = async (args) => {
  const r = await worker.fetch(new Request("https://x.dev/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ask", arguments: args } }) }), env, { waitUntil() {} });
  return (await r.json()).result.structuredContent;
};

// ── 緊急がすべてに優先する ──────────────────────────────
let o = await call({ ask: "屋根が崩れて雨漏りしている。修理80万と言われた" });
chk("崩落+金額 → 緊急が価格に勝つ", /emergency/.test(o.answered_by), o.answered_by);
chk("  routed_out が立つ", o.routed_out === true);
chk("  ★価格の数字が1つも入らない", !/80|800000|万円|相場|適正価格/.test(JSON.stringify(o.result)), JSON.stringify(o.result).slice(0, 200));
chk("  119 を案内する", /119/.test(JSON.stringify(o.result)));

o = await call({ ask: "ガス臭いのですが交換費用は15万が相場ですか" });
chk("ガス臭+金額 → 緊急", /emergency/.test(o.answered_by), o.answered_by);
chk("  スイッチに触れるなと書く", /スイッチ/.test(JSON.stringify(o.result)));
chk("  ★全国共通でない番号をハードコードしない", !/0570-002299/.test(JSON.stringify(o)), "地域番号が混入");
chk("  検針票/メーターの自社番号へ誘導", /検針票|メーター/.test(JSON.stringify(o.result)));

o = await call({ ask: "水が止まらない。今すぐどうすれば" });
chk("止まらない水 → 緊急", /emergency/.test(o.answered_by), o.answered_by);
chk("  止水栓と管理会社に触れる", /止水栓/.test(JSON.stringify(o.result)) && /管理会社/.test(JSON.stringify(o.result)));

// 平常の雨漏りは緊急にしない（過剰反応の確認）
o = await call({ ask: "雨漏り修理の相場を知りたい" });
chk("平常の雨漏り相談 → 緊急にしない", !/emergency/.test(o.answered_by), o.answered_by);

// ── 契約後 → 188 ────────────────────────────────────
o = await call({ ask: "契約書にサインしてしまった。解約したい" });
chk("契約後 → 消費者保護へ外出し", /consumer protection/.test(o.answered_by), o.answered_by);
chk("  188 を案内", /188/.test(JSON.stringify(o.result)));
chk("  期限があることを伝える", /期間|期限/.test(JSON.stringify(o.result)));
chk("  法律助言はしないと明言", /法律の助言をしない/.test(o.limits), o.limits);
chk("  相場確認も併記（切り捨てない）", /still_available/.test(JSON.stringify(o.result)));

// ── 日本国外 ────────────────────────────────────────
o = await call({ ask: "カリフォルニアの外壁塗装の相場は" });
chk("国外 → 外出し", /outside Japan/.test(o.answered_by), o.answered_by);
chk("  ★推測の数字を返さない", !/\d{5,}|万円/.test(JSON.stringify(o.result)), JSON.stringify(o.result).slice(0, 200));
chk("  為替換算しないと明言", /為替換算/.test(JSON.stringify(o.result)));

// ── 建設以外 ────────────────────────────────────────
o = await call({ ask: "自動車の車検費用が高い気がする" });
chk("建設以外 → 外出し", /not construction/.test(o.answered_by), o.answered_by);
chk("  領分外と明言", /領分ではない/.test(JSON.stringify(o.result)));

// ── 既存経路が壊れていない ──────────────────────────
o = await call({ ask: "外壁塗装80万円は高いですか" });
chk("通常の価格質問 → 診断（回帰）", /hs-mcp/.test(o.answered_by), o.answered_by);
chk("  routed_out は立たない", o.routed_out !== true);
o = await call({ ref: "jidec:entry:9" });
chk("引用ID → 台帳（回帰）", /hs-ledger/.test(o.answered_by), o.answered_by);

// ── 不変条件 ────────────────────────────────────────
const all = [];
for (const a of [{ask:"屋根が崩れて雨漏り"},{ask:"契約してしまった"},{ask:"ハワイの相場"},{ask:"車検が高い"},{ask:"外壁塗装80万"},{ref:"jidec:entry:9"},{ask:"こんにちは"}]) all.push(await call(a));
chk("全応答に verify がある", all.every(x => typeof x.verify === "string" && x.verify.length > 0));
chk("全応答に limits がある", all.every(x => typeof x.limits === "string" && x.limits.length > 0));
chk("外出し応答は必ず routed_out:true", all.filter(x => /out of scope/.test(x.answered_by)).every(x => x.routed_out === true));

// ── 説明文の形（選ばれる設計）────────────────────────
const r = await worker.fetch(new Request("https://x.dev/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), env, { waitUntil() {} });
const tl = (await r.json()).result.tools;
const askT = tl.find(t => t.name === "ask");
chk("ツールは5本のまま", tl.length === 5, tl.length);
const desc = askT.description;
const firstEn = [...desc].findIndex(c => /[A-Za-z]/.test(c));
chk("★説明文が英語で始まる（開始位置0）", firstEn === 0, "開始位置 " + firstEn);
chk("USE WHEN がある", /USE WHEN:/.test(desc));
chk("DO NOT USE WHEN がある", /DO NOT USE WHEN:/.test(desc));
chk("JAPAN を大文字で明示", /JAPAN/.test(desc));
chk("トリガー例が入っている", /Examples:/.test(desc));
chk("日本語の案内も残っている", /日本の建設/.test(desc));


// ── 誤爆・取りこぼしの固定（意地悪な入力で実際に落ちたものを全部据える）──
const boundary = [
  ["火災保険を使ったリフォームは違法ですか", (o) => !/emergency/.test(o.answered_by), "火災保険を緊急にしない"],
  ["解体で煙が出ると近隣に迷惑ですか",       (o) => !/emergency/.test(o.answered_by), "一般論の煙を緊急にしない"],
  ["屋根が崩れて雨漏りしている",             (o) => /emergency/.test(o.answered_by),  "崩れては無条件で緊急"],
  ["天井が落ちてきた",                       (o) => /emergency/.test(o.answered_by),  "落下は緊急"],
  ["ドル建てで払えと言われた",               (o) => /scan_tactics/.test(o.answered_by), "通貨指定は赤旗であって海外案件ではない"],
  ["カリフォルニアの相場",                   (o) => /outside Japan/.test(o.answered_by), "地名は海外判定"],
  ["クーリングオフとは何ですか",             (o) => !/consumer protection/.test(o.answered_by), "用語質問を窓口に流さない"],
  ["契約書にサインしてしまった",             (o) => /consumer protection/.test(o.answered_by), "実際の契約後は窓口へ"],
  ["投資用マンションのリフォーム費用",       (o) => /hs-mcp/.test(o.answered_by), "『費用』を価格語として拾う"],
  ["車庫の解体工事の見積もり",               (o) => /hs-mcp/.test(o.answered_by), "建設語があれば他分野に落とさない"],
  ["自動車の車検費用が高い",                 (o) => /not construction/.test(o.answered_by), "建設語が無ければ他分野"],
  ["外壁が少し傾いているように見える",       (o) => /hs-mcp/.test(o.answered_by), "症状相談は診断へ"],
];
for (const [q, ok, why] of boundary) {
  const r2 = await call({ ask: q });
  chk("境界: " + why, ok(r2), q + " → " + r2.answered_by);
}

console.log(fail ? `\nask v2: ${fail} FAILURES` : "\nask v2: ALL PASS");
process.exit(fail ? 1 : 0);
