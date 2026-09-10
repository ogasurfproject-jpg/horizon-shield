#!/usr/bin/env node
// RUN_ALL: suite    長め (五十秒ほど)。写しを壊すだけで、元の file には触らん
// 規則を 1 本ずつ壊して、試験が気付くかを見る。
//
// なぜこれが要るか (2026-09-10)。
//
// agreement_canonical_test.mjs は 44 / 44 で緑や。緑やから正しい、とは言えん。
// 通っとるだけかもしれん。正しいと言えるんは、規則を壊したら赤くなるときだけや。
// 実際、この battery を初めて回したとき「同じ鍵を先勝ちにする」が生き残った。
// 試験には重複鍵の行が 1 本も無かった。今は有る。見つけたんは緑の試験やのうて、
// この file や。
//
// 兄弟の agreement_mutation.py と違うて、これは元の file を書き換えん。写しを
// 作業場に置いて、写しの方を壊す。理由は二つ。元が壊れたまま残る筋が一本も無い
// こと。それと、この作業場では mount した folder の file を消せんから、後始末が
// 失敗する筋を最初から作らんこと。
//
//   node agreement_canonical_mutation.mjs
//
// expect が "caught" の変異は、試験が赤くならなあかん。"equivalent" の変異は、
// 見た目が違うだけで振舞いが同じやから、緑のままが正しい。等価やと書いた以上、
// なぜ等価かをその場に書く。書けんもんは equivalent やない、ただの穴や。
import { readFileSync, writeFileSync, mkdtempSync, symlinkSync, copyFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(HERE, "agreement_canonical.mjs");
const SUITE = path.join(HERE, "agreement_canonical_test.mjs");
const TABLES = [
  "agreement_vectors_v1.json",
  "agreement_float_repr_v1.json",
  "agreement_readback_v1.json",
];

export const MUTANTS = [
  // 書く側
  ["鍵の並びを既定の sort に戻す", "Object.keys(v).sort(cmpCodePoints)", "Object.keys(v).sort()", "caught"],
  ["cmpCodePoints を長さ比較だけにする", "if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;", "", "caught"],
  ["逃がす境目を 0x7e から 0x7f に", "c < 0x20 || c > 0x7e", "c < 0x20 || c > 0x7f", "caught"],
  // 錨は 2 つの関数を跨いで一致してまうから、次の行まで含めて 1 箇所に絞る。
  // (2026-09-10、strUtf8 を足したら str と同じ行が生まれて、変異器が 2 箇所やと言うて断った。
  //  断ってくれたから気付いた。黙って片方だけ変えとったら、測っとる物が違うてまう。)
  ["str が短い逃がし方をやめる",
   "else if (SHORT[c] !== undefined) out += SHORT[c];\n    else if (c < 0x20 || c > 0x7e)",
   "else if (c < 0x20 || c > 0x7e)", "caught"],
  ["strUtf8 が短い逃がし方をやめる",
   "else if (SHORT[c] !== undefined) out += SHORT[c];\n    else if (c < 0x20) out",
   "else if (c < 0x20) out", "caught"],
  ["\\u を 4 桁詰めせん", 'n.toString(16).padStart(4, "0")', "n.toString(16)", "caught"],
  ["指数形に変わる所を 16 から 17 に", "decpt <= -4 || decpt > 16", "decpt <= -4 || decpt > 17", "caught"],
  ["小さい側の境目を -4 から -5 に", "decpt <= -4 || decpt > 16", "decpt < -4 || decpt > 16", "caught"],
  ["指数の 2 桁揃えをやめる", 'String(Math.abs(e)).padStart(2, "0")', "String(Math.abs(e))", "caught"],
  ["整数に見える float の .0 を落とす", 'return digits + "0".repeat(decpt - digits.length) + ".0";', 'return digits + "0".repeat(decpt - digits.length);', "caught"],
  ["-0.0 の符号を落とす", "const neg = v < 0 || Object.is(v, -0);", "const neg = v < 0;", "caught"],
  ["bigint を Number に落とす", 'if (typeof v === "bigint") return v.toString();', 'if (typeof v === "bigint") return String(Number(v));', "caught"],
  // 読む側
  ["JSON.parse の口で int を BigInt にせん", "INTISH.test(src) ? BigInt(src) : value", "value", "caught"],
  ["scanner で指数付きを int 扱いにする", "    if (c === 0x65 || c === 0x45) {\n      isInt = false;", "    if (c === 0x65 || c === 0x45) {", "caught"],
  ["scanner で小数点付きを int 扱いにする", "    if (text.charCodeAt(i) === 0x2e) {\n      isInt = false;", "    if (text.charCodeAt(i) === 0x2e) {", "caught"],
  ["scanner で int も Number にする", "return isInt ? BigInt(src) : Number(src);", "return Number(src);", "caught"],
  ["同じ鍵を黙って通す", 'if (seen.has(k)) err("duplicate_json_key"', "if (false) err(\"duplicate_json_key\"", "caught"],
  ["同じ鍵の断り名を bad_json にする", 'err("duplicate_json_key", "duplicate key in JSON object: " + k)', 'err("bad_json", "duplicate key in JSON object: " + k)', "caught"],
  ["緩い口でも同じ鍵を断る", 'const dupLastWins = !!(opts && opts.duplicates === "last");', "const dupLastWins = false;", "caught"],
  ["厳しい口を緩い口にすり替える", "export function parseStrict(text) {\n  return parseScan(text);", 'export function parseStrict(text) {\n  return parseScan(text, { duplicates: "last" });', "caught"],
  ["NaN を断る", 'if (c === 0x4e) return word("NaN", NaN);', "", "caught"],
  ["Infinity を断る", 'if (c === 0x49) return word("Infinity", Infinity);', "", "caught"],
  ["-Infinity を数として読もうとする", 'if (c === 0x2d && text.charCodeAt(i + 1) === 0x49) return word("-Infinity", -Infinity);', "", "caught"],
  ["stack 切れを too_deep と呼ばん", 'throw new CanonicalError("too_deep", "the JSON is nested past what a reader can parse");', 'throw new CanonicalError("bad_json", "deep");', "caught"],
  ["末尾の余り検査を外す", '  if (i !== n) err("bad_json", "末尾に余りがある");', "", "caught"],
  ["先頭の 0 を通す", "    if (c === 0x30) i++;", "    if (c === 0x30) { i++; while (isDigit(text.charCodeAt(i))) i++; }", "caught"],
  ["生の制御文字を文字列に通す", '    if (c < 0x20) err("bad_json", "生の制御文字");', "", "caught"],
  // 記録層の形 (ensure_ascii=False)
  ["strUtf8 が非 ASCII も逃がす", "    else if (c < 0x20) out += hex4(c);", "    else if (c < 0x20 || c > 0x7e) out += hex4(c);", "caught"],
  ["strUtf8 が制御文字を逃がさん", "    else if (c < 0x20) out += hex4(c);", "", "caught"],
  ["canonicalUtf8 が ASCII に逃がす形を使う", "  return build(v, strUtf8);", "  return build(v, str);", "caught"],
  ["canonicalAscii が逃がさん形を使う", "  return build(v, str);", "  return build(v, strUtf8);", "caught"],
  ["build が鍵を既定の sort で並べる", "    const keys = Object.keys(v).sort(cmpCodePoints);", "    const keys = Object.keys(v).sort();", "caught"],
  // 等価。緑のままが正しい。
  ["fromCharCode を fromCodePoint に (等価)",
   "out += String.fromCharCode(parseInt(h, 16));",
   "out += String.fromCodePoint(parseInt(h, 16));",
   "equivalent"],
  // なぜ等価か: \u の後は 16 進 4 桁と決まっとるから、渡る値は必ず 0 から 0xFFFF。
  // その範囲では fromCodePoint は fromCharCode と同じ物を返す。対を組まん代理符号
  // でも同じで、fromCodePoint は 0xD800 を放り出さん。2026-09-10 に両方走らせて確認。
];

// 直に走らせた時だけ回す。import された時は MUTANTS を渡すだけ。
// (README の数を測る側が、変異試験を走らせずに本数を数えられるようにするため。)
const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_MAIN) {

const src = readFileSync(TARGET, "utf8");
const work = mkdtempSync(path.join(os.tmpdir(), "agreement-canonical-mutation-"));
copyFileSync(SUITE, path.join(work, path.basename(SUITE)));
for (const f of TABLES) {
  const from = path.join(HERE, f);
  if (!existsSync(from)) {
    console.error("★ 拒否: " + f + " が無い。表が無いまま変異を回しても、何も測っとらん。");
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
  return { caught: r.status !== 0, ng: (r.stdout || "").split("\n").filter((l) => l.trim().startsWith("NG")).length };
};

console.log("target      " + path.basename(TARGET));
console.log("suite       " + path.basename(SUITE));
console.log("作業場      " + work + "  (元の file には触らん)");
console.log("mutants     " + MUTANTS.length + " (" + MUTANTS.filter((m) => m[3] === "caught").length
  + " 捕まえる、" + MUTANTS.filter((m) => m[3] === "equivalent").length + " 等価)");
console.log("");

// 変異なしで赤かったら、その先の "捕まえた" は全部嘘になる。先に見る。
writeFileSync(copyTarget, src);
const base = run();
if (base.caught) {
  console.error("★ 拒否: 変異を入れる前から試験が赤い。ここから先は何も測れん。");
  console.error("        先に node agreement_canonical_test.mjs を通せ。");
  process.exit(2);
}
console.log("  " + "変異なし".padEnd(46) + "緑    ここが緑やから、以下の赤に意味がある");

const wrong = [];
for (const [name, old, neu, expect] of MUTANTS) {
  const hits = src.split(old).length - 1;
  if (hits !== 1) {
    console.log("  " + name.padEnd(46) + "錨が " + hits + " 箇所");
    wrong.push(name + " (錨)");
    continue;
  }
  writeFileSync(copyTarget, src.replace(old, neu));
  const { caught, ng } = run();
  const want = expect === "caught";
  const good = caught === want;
  if (!good) wrong.push(name);
  console.log("  " + name.padEnd(46) + (caught ? "捕まえた" : "生き残った").padEnd(12)
    + "NG=" + String(ng).padEnd(3) + (good ? "ok" : "★ 期待は " + expect));
}

writeFileSync(copyTarget, src);
const after = run();
console.log("");
console.log("元の file  " + (readFileSync(TARGET, "utf8") === src ? "1 バイトも触っとらん" : "★ 変わっとる"));
if (after.caught) {
  console.log("★ 拒否: 写しを元に戻したのに試験が赤い。この結果は信用したらあかん。");
  process.exit(2);
}

if (wrong.length) {
  console.log("=== " + (MUTANTS.length - wrong.length) + " / " + MUTANTS.length
    + "、思た通りに動かんかったんは: " + wrong.join("、") + " ===");
  process.exit(1);
}
console.log("=== " + MUTANTS.length + " / " + MUTANTS.length + " 合格 (canonical の mutation) ===");
console.log("緑やから正しいんやない。壊したら赤くなるから正しい。等価と書いた 1 本だけは、なぜ等価かをこの file に書いてある。");
process.exit(0);

}
