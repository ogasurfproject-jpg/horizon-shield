// WEDJAT / HORIZON SHIELD
// RFC 8785 (JCS) 適合の常設回帰テスト。
//
// なぜ在るか:
//   扉(hs-verify-gate)は record_sha256 と surface hash を公開し、「誰でも再計算できる」と言っている。
//   その言葉は正規化がバイト単位で仕様どおりであることに全部ぶら下がっている。正規化が静かにずれると、
//   判定は壊れずに嘘になる。落ちないので誰も気づかない。だから固定して、毎回測る。
//
//   2026-08-23 の初回実測: 本物のJCS実装(npm canonicalize@2.0.0)と 12本中11本がバイト一致。
//   外れた1本は非有限数で、旧実装は 1e400 を黙って null に変えてハッシュを返していた。修正後 13/13。
//
// 何を試すか:
//   コピーではなく worker.js の実物から canonicalJson を抜き出して試す。コピーを試すと、
//   本番だけが静かにずれても緑のままになる。それでは計器の意味がない。
//
// 使い方:
//   node tools/jcs_conformance.mjs
//   終了コード 0 = 適合。1 = 乖離(公開中のハッシュが再計算できない状態)。
//   外部依存なし。期待値は tools/jcs_vectors.json に固定。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, "..", "workers", "hs-verify-gate", "src", "worker.js");
const VECTORS = path.join(HERE, "jcs_vectors.json");

const src = fs.readFileSync(WORKER, "utf8");
const m = src.match(/function canonicalJson\(v\)\s*\{[\s\S]*?\n\}/);
if (!m) {
  console.error("FAIL: canonicalJson を worker.js から取り出せない。関数の形が変わったか、消えている。");
  process.exit(1);
}
const canonicalJson = new Function(m[0] + "; return canonicalJson;")();

// 入力は JS リテラルで持つ。JSON 経由にすると -0 が 0 に、1e400 が null になり、
// 一番測りたい2本が測れなくなる。
const EURO = "€", HEBREW = "דּ", EMOJI = "\u{1f600}", GOTHIC = "\u{10437}", CTRL80 = "";
const INPUTS = {
  "V01 numbers precision and exponent": { numbers: [333333333.33333329, 1e30, 4.50, 2e-3, 0.000000000000000000000000001] },
  "V02 key order UTF-16 vs codepoint": (() => { const o = {}; o[EURO] = "Euro"; o["\r"] = "CR"; o[HEBREW] = "Hebrew"; o["1"] = "One"; o[EMOJI] = "Emoji"; o[CTRL80] = "Control"; o["ö"] = "odia"; return o; })(),
  "V03 string escapes": { string: EURO + "$\nA'B\"\\/" },
  "V04 literals": { literals: [null, true, false] },
  "V05 nesting": { a: [[1, 2], [3, [4, 5]]], b: { z: 1, a: 2 } },
  "V06 empty containers": { e: {}, arr: [], s: "" },
  "V07 negative zero": { nz: -0, z: 0 },
  "V08 exponent boundaries": { a: 1e21, b: 1e-7, c: 1e20, d: 1e-6 },
  "V09 BMP keys": { "é": 1, "e": 2, "É": 3, " ": 4 },
  "V10 unsafe integer": { big: 9007199254740993 },
  "V11 non-BMP keys": (() => { const o = {}; o[EMOJI] = 1; o[HEBREW] = 2; o[GOTHIC] = 3; return o; })(),
  "V12 control-char keys": { "": 1, [CTRL80]: 2, "\t": 3 },
  "V13 non-finite": { huge: 1e400 },
};

const pinned = JSON.parse(fs.readFileSync(VECTORS, "utf8"));
let pass = 0;
const failures = [];

console.log("RFC 8785 (JCS) conformance / WEDJAT gate canonicalization");
console.log("source: " + path.relative(process.cwd(), WORKER));
console.log("");

for (const v of pinned.vectors) {
  if (!(v.id in INPUTS)) {
    failures.push(v.id + ": 入力がこのファイルに無い(ベクタ定義がずれている)");
    continue;
  }
  let got, threw = false;
  try { got = canonicalJson(INPUTS[v.id]); } catch (_e) { threw = true; }

  let ok;
  if (v.must_refuse) ok = threw;
  else ok = !threw && got === v.expected;

  if (ok) { pass++; console.log("  pass  " + v.id); }
  else {
    console.log("  FAIL  " + v.id);
    if (v.must_refuse) {
      console.log("        期待: 拒否(この形に再計算可能なJSONは無い)");
      console.log("        実際: " + JSON.stringify(got));
    } else if (threw) {
      console.log("        期待: " + v.expected);
      console.log("        実際: 拒否した(出せる値を拒んでいる)");
    } else {
      console.log("        期待: " + v.expected);
      console.log("        実際: " + got);
    }
    failures.push(v.id);
  }
}

console.log("");
console.log("=== " + pass + "/" + pinned.vectors.length + " conformant ===");
if (failures.length) {
  console.log("");
  console.log("公開中の record_sha256 と surface hash は、この乖離のぶん第三者が再計算できない。");
  console.log("直すまで、再計算できるという表示を出してはいけない。");
  process.exit(1);
}
console.log("正規化は仕様どおり。公開しているハッシュは第三者がバイト単位で再計算できる。");
process.exit(0);
