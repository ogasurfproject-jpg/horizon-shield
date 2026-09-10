// RUN_ALL: suite
// Prove the JavaScript canonical form is the Python one.
//
// Three kinds of evidence, because no one of them is enough on its own.
//
//   1. Unit vectors. Each one is a named place where the two languages part
//      company. Small, readable, and they say what the file is claiming.
//
//   2. Python's own float table. agreement_float_repr_v1.json holds 17,759
//      doubles as raw bits together with what Python's json.dumps wrote for
//      each. Python wrote it; nobody typed it from memory. The round trip below
//      cannot reach this: the fixture's 20.4 MB contains exactly three distinct
//      non integer values. Every disagreement about floats lives here.
//
//   3. Python's readback table. agreement_readback_v1.json holds 173 pieces of
//      JSON text together with what agreement_verify.py's own parse_strict did
//      with each: the canonical bytes it produced, or the name it refused by.
//      This is the half the round trip cannot reach at all, because the round
//      trip only ever feeds it records that are already correct. Agreeing on
//      what is broken, and on what to call it, is the other half of agreeing.
//
//   4. The round trip. The fixture's payload IS Python's canonical bytes for
//      5,221 inputs and their 5,221 reports, lone surrogates and 2^70 and all.
//      Read those bytes, parse them, put them back through the JavaScript
//      canonicaliser, require byte identity. Run it once through each of the two
//      parsers, so the host's JSON.parse and the scanner in this file have to
//      agree with Python and with each other.
//
// What none of this covers, said here rather than left to be found: a key above
// the BMP is only tested by vector 1, because the adversary never builds one.
//
// Checked by mutation on 2026-09-10: 19 deliberate breakages of
// agreement_canonical.mjs, 18 of them turned this suite red. The one that did
// not was String.fromCharCode swapped for String.fromCodePoint in the scanner,
// and that is not a hole: for any four hex digits the two are the same function,
// lone surrogates included, so there is nothing there to catch. Duplicate keys
// WERE a hole and are now vectors below.
//
// Run: node agreement_canonical_test.mjs
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  canonicalAscii, canonicalUtf8, strUtf8, cmpCodePoints, str, num,
  parseCanonical, parseStrict, parseLoose, parseNative, parseScan, HAS_JSON_SOURCE,
} from "./agreement_canonical.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = process.argv[2] || path.join(HERE, "agreement_vectors_v1.json");
const FLOATS = path.join(HERE, "agreement_float_repr_v1.json");
const READBACK = path.join(HERE, "agreement_readback_v1.json");

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log("ok   " + name); }
  else { fail++; console.log("NG   " + name + (detail !== undefined ? "  " + detail : "")); }
};
const threw = (fn) => {
  try { fn(); return false; } catch { return true; }
};
// 断ったこと自体やのうて、断った名前を見る。名前が違うたら報告書が違う。
const code = (fn) => {
  try { fn(); return "(断らんかった)"; } catch (e) { return e && e.code ? e.code : "(code 無し)"; }
};

// ---------------------------------------------------------------- 1. vectors
// この節は try で囲んである。理由: 実装が壊れると assert が NG になる前に投げる
// ことがあり、そうなると suite はそこで死んで、後ろの表も往復も一切測らんまま
// 非零で終わる。判定は正しいが、測った量が黙って減る。投げたら 1 本の不合格に
// して、先へ進ませる。(2026-09-10、変異試験で NG=0 のまま捕まった 4 本を見て)
try {

t("keys sort by code point, not by UTF-16 unit",
  canonicalAscii({ "\u{1F600}": 1n, "�": 2n }) === '{"\\ufffd":2,"\\ud83d\\ude00":1}',
  canonicalAscii({ "\u{1F600}": 1n, "�": 2n }));
t("and the naive sort would have got that wrong",
  ["\u{1F600}", "�"].sort()[0] === "\u{1F600}" && cmpCodePoints("\u{1F600}", "�") > 0);
t("non ASCII is escaped", str("日") === '"\\u65e5"', str("日"));
t("an astral character is written as a surrogate pair",
  str("\u{1F600}") === '"\\ud83d\\ude00"', str("\u{1F600}"));
t("a lone surrogate survives as an escape", str("\uD800") === '"\\ud800"', str("\uD800"));
t("DEL is escaped, tilde is not", str("~") === '"\\u007f~"', str("~"));
t("the short escapes are the short ones", str("\b\t\n\f\r") === '"\\b\\t\\n\\f\\r"', str("\b\t\n\f\r"));
t("quote and backslash", str('"\\') === '"\\"\\\\"', str('"\\'));
t("nested keys sort at every level",
  canonicalAscii({ b: 1n, a: { d: 2n, c: 3n } }) === '{"a":{"c":3,"d":2},"b":1}');
t("separators carry no spaces", canonicalAscii([1n, 2n, { a: 3n }]) === '[1,2,{"a":3}]');

// 記録層の canonical は ensure_ascii=False。逃がすんは 3 つだけ: 引用符、逆斜線、
// 0x20 未満。0x7f も日本語も絵文字も生で出る。二つの形を両方持っとらんと、
// 契約の入れ物と記録そのものが混ざる。
t("非 ASCII は逃がさん", strUtf8("日") === '"日"', strUtf8("日"));
t("DEL も生で出る", strUtf8("\u007f~") === '"\u007f~"', JSON.stringify(strUtf8("\u007f~")));
t("0x20 未満は逃がす", strUtf8("\u0001") === '"\\u0001"', JSON.stringify(strUtf8("\u0001")));
t("短い逃がし方はこっちでも短い", strUtf8("\b\t\n\f\r") === '"\\b\\t\\n\\f\\r"');
t("引用符と逆斜線は逃がす", strUtf8('"\\') === '"\\"\\\\"', strUtf8('"\\'));
t("代理符号の対は 1 文字として生で出る", strUtf8("\u{1F600}") === '"\u{1F600}"');
t("鍵の並びは二つの形で同じ",
  canonicalUtf8({ "\u{1F600}": 1n, "�": 2n }) === '{"�":2,"\u{1F600}":1}',
  canonicalUtf8({ "\u{1F600}": 1n, "�": 2n }));
t("数と真偽と null は二つの形で同じ",
  canonicalUtf8([1n, 1, true, null]) === canonicalAscii([1n, 1, true, null]));
t("ASCII だけの記録なら二つの形は一致する",
  canonicalUtf8({ a: [1n, "x"], b: null }) === canonicalAscii({ a: [1n, "x"], b: null }));

// the model: bigint is a python int, number is a python float. no guessing.
t("a bigint prints as a python int", num(0n) === "0" && num(-7n) === "-7");
t("a bigint has no ceiling",
  num(1180591620717411303424n) === "1180591620717411303424", num(1180591620717411303424n));
t("a number prints as a python float, even when it looks whole",
  num(1) === "1.0" && num(0) === "0.0" && num(-7) === "-7.0", num(1));
t("canonicalAscii refuses nothing it can write, and writes both kinds",
  canonicalAscii({ i: 2n, f: 2 }) === '{"f":2.0,"i":2}', canonicalAscii({ i: 2n, f: 2 }));
t("undefined is not writable", threw(() => canonicalAscii({ a: undefined }.a === undefined ? undefined : 1)));

// reading
t("an integer from the wire stays exact",
  canonicalAscii(parseCanonical("1180591620717411303424")) === "1180591620717411303424",
  canonicalAscii(parseCanonical("1180591620717411303424")));
t("and plain JSON.parse would have lost it",
  String(JSON.parse("1180591620717411303424")) === "1.1805916207174113e+21");
t("a float from the wire stays a float",
  canonicalAscii(parseCanonical("1.0")) === "1.0" && canonicalAscii(parseCanonical("-0.0")) === "-0.0");
t("1e16 read back is 1e+16", canonicalAscii(parseCanonical("1e16")) === "1e+16");
t("NaN と Infinity は python と同じに読む。断るんは verify の unsafe_number の役",
  num(parseStrict("NaN")) === "NaN" && canonicalAscii(parseStrict("[Infinity,-Infinity]")) === "[Infinity,-Infinity]",
  canonicalAscii(parseStrict("[Infinity,-Infinity]")));
t("the scanner refuses trailing rubbish", threw(() => parseScan("{} {}")));
t("the scanner refuses a raw control character in a string",
  threw(() => parseScan('"ab"')));
t("the scanner keeps a lone surrogate as a lone surrogate",
  parseScan('"\\ud800"').charCodeAt(0) === 0xd800);
t("the scanner refuses a leading zero", threw(() => parseScan("01")));
t("the scanner refuses a bare dot", threw(() => parseScan("1.")));

// 同じ鍵が二度来た時。agreement_verify.py は parse_strict で断り、報告書に
// duplicate_json_key と書く。ここも同じ所で、同じ名前で断らんとあかん。
// bare な json.loads の方は後勝ちで黙って通る。その両方を字で留める。
// (見つけ方: 後勝ちを先勝ちに変える変異が生き残った。それでこの節ができた。)
t("記録を読む口は同じ鍵を断る、python の parse_strict と同じ名前で",
  code(() => parseStrict('{"a":1,"a":2}')) === "duplicate_json_key",
  code(() => parseStrict('{"a":1,"a":2}')));
t("入れ子の中でも断る",
  code(() => parseStrict('{"x":{"a":1,"b":9,"a":2}}')) === "duplicate_json_key");
t("緩い口は後勝ち、bare な json.loads と同じ",
  canonicalAscii(parseLoose('{"a":1,"a":2}')) === '{"a":2}',
  canonicalAscii(parseLoose('{"a":1,"a":2}')));
t("入れ子でも後勝ち",
  canonicalAscii(parseLoose('{"x":{"a":1,"b":9,"a":2}}')) === '{"x":{"a":2,"b":9}}');
t("JSON.parse も後勝ち、つまり緩い口と一致する",
  !HAS_JSON_SOURCE ||
  canonicalAscii(parseNative('{"a":1,"a":2,"b":{"c":3,"c":4}}'))
    === canonicalAscii(parseLoose('{"a":1,"a":2,"b":{"c":3,"c":4}}')));
t("parseCanonical は厳しい方を指しとる",
  parseCanonical === parseStrict);

// 深すぎる入れ子。python は読む側が倒れて too_deep と書く。こちらは倒れる前に
// 同じ名前で断る。verify は 32 段で断るから、この蓋が判定を決めることは無い。
t("宿主の stack が尽きる深さは too_deep、python の読み手と同じ名前",
  code(() => parseStrict("[".repeat(400000) + "]".repeat(400000))) === "too_deep",
  code(() => parseStrict("[".repeat(400000) + "]".repeat(400000))));
t("python が読める深さ (993 段を実測) はこちらも読める",
  Array.isArray(parseStrict("[".repeat(993) + "]".repeat(993))));
t("壊れた JSON は bad_json",
  code(() => parseStrict("{")) === "bad_json" && code(() => parseStrict("01")) === "bad_json");
t("the two parsers agree on a hand written awkward case",
  HAS_JSON_SOURCE
    ? canonicalAscii(parseNative('{"a":[1,1.0,1e16,-0.0,2417851639229258349412352],"b":"\\ud800"}'))
      === canonicalAscii(parseScan('{"a":[1,1.0,1e16,-0.0,2417851639229258349412352],"b":"\\ud800"}'))
    : true);

} catch (e) {
  fail++;
  console.log("NG   vector が最後まで走らんかった。途中で投げた: " + (e && e.message));
}

// --------------------------------------------------- 2. python's float table
{
  const doc = JSON.parse(readFileSync(FLOATS, "utf8"));
  const dv = new DataView(new ArrayBuffer(8));
  let bad = 0, firstBad = null;
  for (const [bits, want] of doc.cases) {
    dv.setBigUint64(0, BigInt("0x" + bits));
    const got = num(dv.getFloat64(0));
    if (got !== want) {
      bad++;
      if (!firstBad) firstBad = bits + "  python " + want + "  js " + got;
    }
  }
  t("count は数え直した数と合う", doc.count === doc.cases.length, doc.count);
  t(doc.cases.length.toLocaleString() + " 個の double を Python と同じ字で書けた",
    bad === 0, bad ? bad + " 個ずれた、最初は " + firstBad : undefined);
}

// ------------------------------------------------- 3. python's readback table
{
  const doc = JSON.parse(readFileSync(READBACK, "utf8"));
  let bad = 0, firstBad = null, okCount = 0, refusedCount = 0;
  for (const [text, kind, val] of doc.cases) {
    let got;
    try {
      got = ["ok", canonicalAscii(parseStrict(text))];
    } catch (e) {
      got = ["refused", e && e.code ? e.code : "(code 無し)"];
    }
    if (got[0] === "ok") okCount++; else refusedCount++;
    if (got[0] !== kind || got[1] !== val) {
      bad++;
      if (!firstBad) {
        firstBad = JSON.stringify(text).slice(0, 50)
          + "  python " + kind + " " + JSON.stringify(val).slice(0, 40)
          + "  js " + got[0] + " " + JSON.stringify(got[1]).slice(0, 40);
      }
    }
  }
  t("count は数え直した数と合う", doc.count === doc.cases.length, doc.count);
  t("読めた数も断った数も python と同じ",
    okCount === doc.read_ok && refusedCount === doc.refused,
    "python " + doc.read_ok + "/" + doc.refused + "  js " + okCount + "/" + refusedCount);
  t(doc.cases.length + " 件の入力を python と同じに読み、同じ名前で断った",
    bad === 0, bad ? bad + " 件ずれた、最初は " + firstBad : undefined);
}

// -------------------------------------------------------- 4. the round trip
const env = JSON.parse(readFileSync(FIXTURE, "utf8"));
const payload = inflateSync(Buffer.from(env.payload, "base64"));
const sha = createHash("sha256").update(payload).digest("hex");
t("the payload is the one the envelope names", sha === env.contract_sha256,
  sha.slice(0, 16) + " vs " + String(env.contract_sha256).slice(0, 16));

const text = payload.toString("utf8");
const routes = [["JSON.parse の source", parseNative], ["この file の scanner", parseStrict]];
const bytes = {};

for (const [label, parse] of routes) {
  if (label.startsWith("JSON.parse") && !HAS_JSON_SOURCE) {
    t("JSON.parse の source がこの JS に無い", false, "Node 22 以上で走らせ");
    continue;
  }
  const t0 = Date.now();
  let out;
  try {
    out = Buffer.from(canonicalAscii(parse(text)), "utf8");
  } catch (e) {
    t(label + " で往復", false, String(e && e.message));
    continue;
  }
  bytes[label] = out;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (out.equals(payload)) {
    pass++;
    console.log("ok   " + label + " で " + payload.length.toLocaleString()
      + " バイトを往復して、1 ビットも変わらんかった (" + secs + " 秒)");
  } else {
    fail++;
    let i = 0;
    const n = Math.min(out.length, payload.length);
    while (i < n && out[i] === payload[i]) i++;
    const from = Math.max(0, i - 60), to = Math.min(n, i + 60);
    console.log("NG   " + label + " で往復が食い違うた");
    console.log("     長さ  python " + payload.length + " / js " + out.length);
    console.log("     最初に違うのは " + i + " バイト目");
    console.log("     python ...", JSON.stringify(payload.slice(from, to).toString("utf8")));
    console.log("     js     ...", JSON.stringify(out.slice(from, to).toString("utf8")));
  }
}

{
  const got = Object.values(bytes);
  t("二つの読み口が同じバイトを出した",
    got.length === 2 && got[0].equals(got[1]), got.length + " 本しか走らんかった");
}

console.log("");
console.log("=== " + pass + " / " + (pass + fail) + (fail ? " 不合格あり" : " 合格")
  + " (canonical、JS と Python の一致) ===");
process.exit(fail ? 1 : 0);
