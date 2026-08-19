// deploy の前に、今夜の本物のファイルでエンジンを通す。
//
// Python で出した答えと、Worker に載せる JavaScript が同じ答えを出すか。
// 違ったら載せない。
//
//   node test_recompute.mjs
//
// 同じディレクトリに recompute.js を置いて、hs-docfix の中で走らせる。

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { recomputeHandler, verifyEventHandler } from "./recompute.js";

const ok = (b) => (b ? "一致" : "★ 食い違い");

function latest(prefix) {
  const ds = readdirSync(".").filter((f) => f.startsWith(prefix)).sort();
  return ds.length ? ds[ds.length - 1] : null;
}

console.log("node", process.version);
console.log();

// ------------------------------------------------------------------ 1. entry 244

const anchor = latest("_nenrin_anchor_244_");
if (!anchor || !existsSync(`${anchor}/entry.json`)) {
  console.log("entry.json が見つからない。_nenrin_anchor_244_* のあるところで走らせろ。");
} else {
  const entry = JSON.parse(readFileSync(`${anchor}/entry.json`, "utf8"));
  console.log("=".repeat(74));
  console.log(`1. entry 244  (${anchor})`);
  console.log("=".repeat(74));

  const cases = [
    ["record_sha256", entry.record_sha256, { record: entry.record }],
    ["chain.content_hash", entry.chain?.content_hash, { record: entry.record }],
    ["chain.head_hash", entry.chain?.head_hash, { chain: entry.chain }],
  ];

  const expected = {
    record_sha256: "非JCS（\\uXXXX エスケープ）で再現するはず",
    "chain.content_hash": "JCS で再現するはず",
    "chain.head_hash": "hex の連結で再現するはず",
  };

  for (const [name, claimed, obj] of cases) {
    if (!claimed) { console.log(`  ${name}  値が無い`); continue; }
    const t0 = Date.now();
    const r = await recomputeHandler({ object: obj, claimed });
    const ms = Date.now() - t0;
    console.log(`\n  ${name}`);
    console.log(`    期待   ${expected[name]}`);
    console.log(`    結果   再現 ${r.body.reproduced ? "できた" : "★ できず"}   試行 ${r.body.candidates_tried}   ${ms}ms`);
    for (const rc of r.body.recipes || []) {
      console.log(`    レシピ ${rc.expression}`);
      console.log(`           JCS適合 ${rc.matches_rfc8785_jcs}`);
      if (rc.python) console.log(`           ${rc.python}`);
    }
    if (r.body.canonicalization_note) console.log(`    判定   ${r.body.canonicalization_note}`);
    if (!r.body.reproduced) console.log(`    ${r.body.what_this_is_not}`);
  }

  // 主張を渡さない形。canonical を出して自分の写しを持つ。
  console.log("\n  claimed を渡さない場合（自分の写しを作る）");
  const c = await recomputeHandler({ object: entry.record });
  for (const [k, v] of Object.entries(c.body.forms)) console.log(`    ${k.padEnd(26)} ${v.sha256}`);
  console.log(`    参考: 台帳が載せている record_sha256      ${entry.record_sha256}`);
  console.log(`          台帳が載せている chain.content_hash ${entry.chain?.content_hash}`);
}
console.log();

// ------------------------------------------------------------------ 2. 署名イベント

const relay = latest("_nenrin_relay_");
const evPath = relay ? `${relay}/event_review.json` : null;
if (!evPath || !existsSync(evPath)) {
  console.log("event_review.json が見つからない。リレー取得のディレクトリが要る。");
} else {
  const ev = JSON.parse(readFileSync(evPath, "utf8"));
  console.log("=".repeat(74));
  console.log(`2. 署名イベント  (${evPath})`);
  console.log("=".repeat(74));
  const t0 = Date.now();
  const r = await verifyEventHandler({ event: ev, assert_inside: ["review_model_hash", "policy_version", "verdict", "この鍵は無い"] });
  const ms = Date.now() - t0;
  const b = r.body;
  console.log(`  event_id            ${b.event_id}`);
  console.log(`  id 再計算           ${b.id_recomputed ? "一致" : "★ 不一致"}   (${b.id_serialization})`);
  console.log(`  署名 検証           ${b.signature_valid === true ? "有効" : b.signature_valid === false ? "★ 無効" : "測れず"}   (${b.signature_note})`);
  console.log(`  かかった時間        ${ms}ms`);
  console.log(`  content の鍵        ${(b.content_keys || []).length}本`);
  console.log("  署名の内側かどうか");
  for (const [k, v] of Object.entries(b.fields_inside_signed_bytes || {})) {
    console.log(`    ${k.padEnd(20)} ${v.found_at ? v.found_at : "content に無し"}   内側: ${v.inside_signed_bytes}`);
    if (v.value !== undefined && typeof v.value === "string") console.log(`    ${"".padEnd(20)} 値 ${v.value}`);
  }

  console.log("\n  Python の自前 BIP340 と、この JavaScript の自前 BIP340 が");
  console.log("  同じ答えを出したかどうかが、ここで分かる。");
  console.log("  Python 側は 2026-08-18T14:19:09Z に「有効」と出している。");

  // 壊れた署名を1バイト変えて渡し、ちゃんと無効と言うか
  const broken = JSON.parse(JSON.stringify(ev));
  const last = broken.sig.slice(-1);
  broken.sig = broken.sig.slice(0, -1) + (last === "0" ? "1" : "0");
  const r2 = await verifyEventHandler({ event: broken });
  console.log(`\n  sig を1文字だけ変えた場合  ${r2.body.signature_valid === false ? "無効と出た（正しい）" : "★ 無効と出ない。実装がおかしい"}`);

  const broken2 = JSON.parse(JSON.stringify(ev));
  broken2.content = broken2.content + " ";
  const r3 = await verifyEventHandler({ event: broken2 });
  console.log(`  content に空白を1つ足した場合  ${r3.body.id_recomputed === false ? "id 不一致と出た（正しい）" : "★ 一致と出た。実装がおかしい"}`);
}

console.log();
console.log("終わり。この出力をそのまま貼れ。");
