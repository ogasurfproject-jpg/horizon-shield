#!/usr/bin/env node
// RUN_ALL: suite    長め (一分半ほど)。写しを壊すだけで、元の file には触らん
//
// 検証規則を 1 本ずつ壊して、5,221 件の採点板が気付くかを見る。
//
// なぜこれが要るか (2026-09-10)。
//
// agreement_verify_test.mjs は 5,221 / 5,221 で緑や。それだけでは、規則が正しいことも、
// 契約が規則を覆うとることも言えん。言えるんは「今の実装が今の契約と一致する」だけで、
// 両方が同じ所で間違うとる筋を排除できとらん。壊して赤くなって初めて、その規則が
// 契約に測られとると言える。
//
// 兄弟の agreement_mutation.py は python 側の検証器を、agreement_canonical_mutation.mjs は
// バイトの形を測る。これは JS 側の検証規則や。三つとも写しを壊すだけで元には触らん。
//
//   node agreement_verify_mutation.mjs
import { readFileSync, writeFileSync, mkdtempSync, symlinkSync, copyFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(HERE, "agreement_verify.mjs");
const SUITE = path.join(HERE, "agreement_verify_test.mjs");
const NEED = ["agreement_canonical.mjs", "agreement_vectors_v1.json", "agreement_pyrepr_v1.json"];

const MUTANTS = [
  // 報告書の組み立て
  ["in_draft を code から導かず常に false", "in_draft: DRAFT_CODES.has(code)", "in_draft: false"],
  // 等価。緑のままが正しい。
  // python の refuse と find は同じ覚え書き (seen) を共有しとる。同じ (code, why) が
  // 断りに出たら所見には出ん。分けたらそこで差が出る **はず** やが、今の規則では
  // その衝突が 1 度も起きん。起きんから、分けても出力は同じや。
  // 「見た限り無い」で済ませとらん: agreement_redteam.py の residual に、契約の全記録で
  // (code, why) が両方に出んことを測る vector がある。あれが赤くなった日に、この変異は
  // 等価やのうなって、この行は caught に変わる。
  ["所見が断りと覚え書きを共有せん (等価)",
   "  find(code, why) {\n    if (!this._once(code, why)) return;",
   "  find(code, why) {\n    if (this.findings.some((f) => f.code === code && f.why === why)) return;",
   "equivalent"],
  ["同じ (code, why) の重複を許す", "    if (this.seen.has(k)) return false;", "    if (false) return false;"],
  ["所見にも in_draft を付ける", "this.findings.push({ code, why });", "this.findings.push({ code, why, in_draft: false });"],
  ["checked を証拠から導かず true に", 'checked = perSig.length === 2 && perSig.every((e) => e.result === "valid");', "checked = true;"],
  ["urlsChecked を常に true に", "urlsChecked = urlResults.length > 0 && urlResults.length === 2 && urlResults.every(Boolean);", "urlsChecked = true;"],
  // 形
  ["measure が鍵を並べ替えん", "const vs = Array.isArray(node) ? node : keysDesc(node).map((k) => node[k]);", "const vs = Array.isArray(node) ? node : Object.keys(node).map((k) => node[k]);"],
  ["文字数を符号位置でのうて UTF-16 単位で数える", "const n = [...node].length;", "const n = node.length;"],
  ["制御文字の類に tab を入れる", "/[\\u0000-\\u0008\\u000a-\\u001f\\u007f]/", "/[\\u0000-\\u001f\\u007f]/"],
  ["安全な整数の上限を上げる", "SAFE_INT_MAX = 9007199254740991n", "SAFE_INT_MAX = 90071992547409910n"],
  ["scanText の結果を並べ替えん", "  out.sort(cmpTuple);\n  return out;\n}\n\n// 2 つ目の実装が同じに読み戻せんかもしれん数。", "  return out;\n}\n\n// 2 つ目の実装が同じに読み戻せんかもしれん数。"],
  // 文字と真偽
  ["pyStrip を trim に", "  let a = 0, b = s.length;", "  return s.trim(); let a = 0, b = s.length;"],
  ["python の真偽値を JS の真偽値に", "export function pyTruthy(v) {", "export function pyTruthy(v) { return !!v;"],
  ["str(x) を String(x) に", 'const pyStrOf = (v) => (typeof v === "string" ? v : pyRepr(v));', 'const pyStrOf = (v) => (typeof v === "string" ? v : String(v));'],
  // 語境界は前と後ろの二つ。片方だけ ascii にした実装が有り得るから、片方ずつ壊す。
  // (最初 WB だけ壊して「捕まえられん」と出た。後ろが Unicode のままやったから、
  //  日本語に挟まれた語はどちらでも当たらんかった。半分の変異は変異やない。)
  ["語境界の前を ASCII の \\b に", 'const WB = "(?<![\\\\p{L}\\\\p{N}_])";', 'const WB = "\\\\b";'],
  ["語境界の後ろを ASCII の \\b に", 'const WE = "(?![\\\\p{L}\\\\p{N}_])";', 'const WE = "\\\\b";'],
  // ドメイン
  ["hostOfHttps が http も通す", "/^https:\\/\\/([^/?#\\s@]+)(?:[/?#][\\s\\S]*)?$/", "/^https?:\\/\\/([^/?#\\s@]+)(?:[/?#][\\s\\S]*)?$/"],
  ["underDomain から点を落とす", 'host === domain || (host || "").endsWith("." + domain)', 'host === domain || (host || "").endsWith(domain)'],
  ["normDomain がラベル 1 つでも通す", "if (labels.length < 2) return null;", ""],
  ["b64Raw が書き戻しの照合をやめる", "if (btoa(back) !== str) return null;", ""],
  // 署名するバイト
  ["署名するバイトから前置きを落とす", '(CONTEXT[sc] === undefined ? "" : CONTEXT[sc]) + canonicalUtf8(body)', "canonicalUtf8(body)"],
  ["署名するバイトに signatures を残す", 'if (k !== "signatures") body[k] = record[k];', "body[k] = record[k];"],
  // 暗号
  ["部分群の検査を外す", "else if (!extIsIdentity(scalarmult(point, L25519)))", "else if (false)"],
  ["恒等元の検査を外す", "else if (point[0] === 0n && point[1] === 1n)", "else if (false)"],
  ["非正準な y の検査を外す", "if (y >= P25519) return null;", ""],
  ["署名検査の前の鍵の衛生を飛ばす", "if (publicKeyProblem(rawPub) !== null) return null;", ""],
  // 規則そのもの
  ["v1.1 の not_canonical を所見に格下げ", 'r.refuse("not_canonical", "the bytes handed to this verifier are not the canonical bytes; under v1.1', 'r.find("not_canonical", "the bytes handed to this verifier are not the canonical bytes; under v1.1'],
  ["agreed_at の形を緩める", '"\\\\d{4}-\\\\d{2}-\\\\d{2}T\\\\d{2}:\\\\d{2}:\\\\d{2}Z"', '"\\\\d{4}-.*"'],
  ["overclaim の見張りを外す", "for (const [re2, what] of OVERCLAIM) {", "for (const [re2, what] of []) {"],
  ["REQUIRED_DNE を 1 つ減らす", '["that money moved", ["money", "payment", "paid"]],', ""],
  ["fee の悪い basis を通す", "if (FEE_BASES_BAD.includes(basis)) {", "if (false) {"],
  ["自己合意の検査を外す", "if (a === b) {", "if (false) {"],
  ["conduct の主体の検査を外す", "if (subj && other && !underDomain(subj, other)) {", "if (false) {"],
];

const src = readFileSync(TARGET, "utf8");
const work = mkdtempSync(path.join(os.tmpdir(), "agreement-verify-mutation-"));
copyFileSync(SUITE, path.join(work, path.basename(SUITE)));
for (const f of NEED) {
  const from = path.join(HERE, f);
  if (!existsSync(from)) {
    console.error("★ 拒否: " + f + " が無い。要る物が欠けたまま変異を回しても、何も測っとらん。");
    process.exit(2);
  }
  symlinkSync(from, path.join(work, f));
}
const copyTarget = path.join(work, path.basename(TARGET));
const copySuite = path.join(work, path.basename(SUITE));

const run = () => {
  const r = spawnSync(process.execPath, [copySuite], {
    cwd: work, encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024,
  });
  const line = (r.stdout || "").split("\n").find((l) => /^SCORE:/.test(l)) || "";
  return { caught: r.status !== 0, score: line.replace(/^SCORE:\s*/, "").trim() };
};

console.log("target      " + path.basename(TARGET));
console.log("suite       " + path.basename(SUITE) + " (5,221 件の契約)");
console.log("作業場      " + work + "  (元の file には触らん)");
console.log("mutants     " + MUTANTS.length + " ("
  + MUTANTS.filter((m) => m[3] !== "equivalent").length + " 捕まえる、"
  + MUTANTS.filter((m) => m[3] === "equivalent").length + " 等価)");
console.log("");

writeFileSync(copyTarget, src);
const base = run();
if (base.caught) {
  console.error("★ 拒否: 変異を入れる前から採点板が赤い。ここから先は何も測れん。");
  process.exit(2);
}
console.log("  " + "変異なし".padEnd(44) + "緑      " + base.score);

const wrong = [];
for (const [name, old, neu, expect] of MUTANTS) {
  const want = expect !== "equivalent";
  const hits = src.split(old).length - 1;
  if (hits !== 1) {
    console.log("  " + name.padEnd(44) + "錨が " + hits + " 箇所");
    wrong.push(name + " (錨)");
    continue;
  }
  writeFileSync(copyTarget, src.replace(old, neu));
  const { caught, score } = run();
  if (caught !== want) wrong.push(name);
  console.log("  " + name.padEnd(44) + (caught ? "捕まえた" : "生き残った").padEnd(12)
    + (caught === want ? "ok  " : "★ 期待は " + expect + "  ") + (score || "(点が読めん)"));
}

writeFileSync(copyTarget, src);
const after = run();
console.log("");
console.log("元の file  " + (readFileSync(TARGET, "utf8") === src ? "1 バイトも触っとらん" : "★ 変わっとる"));
if (after.caught) {
  console.log("★ 拒否: 写しを元に戻したのに赤い。この結果は信用したらあかん。");
  process.exit(2);
}
if (wrong.length) {
  console.log("=== " + (MUTANTS.length - wrong.length) + " / " + MUTANTS.length
    + "、捕まえられんかったんは: " + wrong.join("、") + " ===");
  process.exit(1);
}
console.log("=== " + MUTANTS.length + " / " + MUTANTS.length + " 合格 (検証規則の mutation) ===");
console.log("5,221 / 5,221 の緑が意味を持つんは、規則を 1 本壊したら赤くなるからや。");
process.exit(0);
