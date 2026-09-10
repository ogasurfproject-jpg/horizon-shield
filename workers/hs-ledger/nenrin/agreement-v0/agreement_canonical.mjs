// RUN_ALL: library  canonical のバイト、JS 側。試験は agreement_canonical_test.mjs
// The canonical byte form, in JavaScript, matching Python's
// json.dumps(obj, sort_keys=True, separators=(",",":"), ensure_ascii=True).
//
// Why this file exists (2026-09-10).
//
// Before any rule of the verifier is written a second time, the two languages
// have to agree on what bytes a record IS. Four places where they do not agree
// unless made to:
//
//   Key order. Python's sort_keys compares strings by code point. JavaScript's
//   default sort compares by UTF-16 code unit. For anything above the BMP those
//   disagree: U+1F600 is D83D DE00 in UTF-16, and D83D sorts below U+FFFD, so
//   the two languages put the same two keys in opposite order. One such key
//   anywhere and every byte after it differs.
//
//   Escaping. Python with ensure_ascii escapes backslash, quote, and every
//   character outside 0x20 to 0x7E, including 0x7F, and writes anything above
//   the BMP as a surrogate pair. JSON.stringify escapes almost nothing.
//
//   Integers. Python's int has no ceiling. JavaScript's number stops being
//   exact at 2^53. The fixture holds 376 copies of 2^70. JSON.parse turns that
//   into 1.1805916207174113e+21 and the record is a different record. So an
//   integer from the wire becomes a BigInt here, never a number.
//
//   Floats. Python writes repr(float): always a dot or an exponent, exponential
//   below 1e-4 and from 1e16 up, exponent padded to two digits. JavaScript
//   writes 1 for 1.0, 10000000000000000 for 1e16, 1e-7 for 1e-07. Different at
//   every one of those.
//
// The model this file serialises, stated once so there is no guessing:
//
//   bigint  is a Python int.    1n   -> "1"
//   number  is a Python float.  1    -> "1.0"
//
// That is total and it is the only reading that survives round tripping, so
// canonicalAscii does not try to guess which one a plain 1 meant. Values that
// come out of parseCanonical below already carry the right one.
//
// None of this is proved by reading it. agreement_canonical_test.mjs takes the
// fixture's payload, which IS Python's canonical bytes for 5,221 cases and their
// reports, parses it by both routes, puts it back through here, and requires
// byte identity with what it read; and it checks every one of the 17,759 doubles
// in agreement_float_repr_v1.json, which Python wrote, not I.

const CP = (s) => Array.from(s, (c) => c.codePointAt(0));

// Python's sort_keys compares by code point. Do that, not the UTF-16 default.
export function cmpCodePoints(a, b) {
  if (a === b) return 0;
  const x = CP(a), y = CP(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return x.length === y.length ? 0 : (x.length < y.length ? -1 : 1);
}

const SHORT = { 0x08: "\\b", 0x09: "\\t", 0x0a: "\\n", 0x0c: "\\f", 0x0d: "\\r" };

function hex4(n) {
  return "\\u" + n.toString(16).padStart(4, "0");
}

// Python's ESCAPE_ASCII: a backslash, a quote, or anything outside 0x20..0x7E.
// Iterate by UTF-16 unit, so an astral character comes through as its two
// surrogates and is written as a surrogate pair, exactly as Python writes it.
export function str(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (SHORT[c] !== undefined) out += SHORT[c];
    else if (c < 0x20 || c > 0x7e) out += hex4(c);
    else out += s[i];
  }
  return out + '"';
}

// Python's repr for a finite double, digit for digit.
//
// CPython asks for the shortest digit string that reads back to the same double
// and then decides the shape from decpt, the position of the decimal point:
// exponential when decpt <= -4 or decpt > 16, fixed otherwise, and ".0" stuck on
// the end of a fixed form that would otherwise look like an integer. The
// exponent carries a sign and at least two digits.
//
// JavaScript's toExponential() with no argument is the same shortest digit
// string, so the digits are had for free and only the shape has to be rebuilt.
const EXP = /^(\d)(?:\.(\d+))?e([+-]\d+)$/;

function pyFinite(a) {           // a >= 0, finite
  const m = EXP.exec(a.toExponential());
  if (!m) throw new Error("toExponential の形が読めん: " + a.toExponential());
  const digits = m[1] + (m[2] || "");
  const decpt = Number(m[3]) + 1;
  if (decpt <= -4 || decpt > 16) {
    const mant = digits.length > 1 ? digits[0] + "." + digits.slice(1) : digits;
    const e = decpt - 1;
    return mant + "e" + (e < 0 ? "-" : "+") + String(Math.abs(e)).padStart(2, "0");
  }
  if (decpt <= 0) return "0." + "0".repeat(-decpt) + digits;
  if (decpt >= digits.length) return digits + "0".repeat(decpt - digits.length) + ".0";
  return digits.slice(0, decpt) + "." + digits.slice(decpt);
}

export function num(v) {
  if (typeof v === "bigint") return v.toString();       // Python int
  if (typeof v !== "number") throw new TypeError("数やない: " + typeof v);
  if (Number.isNaN(v)) return "NaN";                    // python json.dumps
  if (v === Infinity) return "Infinity";
  if (v === -Infinity) return "-Infinity";
  const neg = v < 0 || Object.is(v, -0);
  return (neg ? "-" : "") + pyFinite(neg ? -v : v);
}

// 記録層の canonical は ensure_ascii=False や。json.dumps(ensure_ascii=False) は
// 逃がす物が 3 つだけになる: 引用符、逆斜線、そして 0x20 未満の制御文字 (うち 5 つは
// 短い形)。0x7f も、日本語も、絵文字も、そのまま生で出る。
//
// 2 つ要る理由: 契約 (fixture の入れ物) は ASCII に逃がした形で、記録そのものは
// 逃がさん形や。片方だけ持っとったら canonical_sha256 が 576 件ずれる。
// (見つけ方: 採点板の初回で、ずれとる鍵の 2 番目に canonical_sha256 が出た)
export function strUtf8(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (SHORT[c] !== undefined) out += SHORT[c];
    else if (c < 0x20) out += hex4(c);
    else out += s[i];
  }
  return out + '"';
}

function build(v, q) {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "boolean") return v ? "true" : "false";
  if (t === "number" || t === "bigint") return num(v);
  if (t === "string") return q(v);
  if (Array.isArray(v)) return "[" + v.map((x) => build(x, q)).join(",") + "]";
  if (t === "object") {
    const keys = Object.keys(v).sort(cmpCodePoints);
    let out = "{", first = true;
    for (const k of keys) {
      if (!first) out += ",";
      first = false;
      out += q(k) + ":" + build(v[k], q);
    }
    return out + "}";
  }
  throw new TypeError("書けん型: " + t);
}

// 記録層の canonical: UTF-8、鍵は全段で並べ替え、区切りは , と : で空白無し、
// 非 ASCII は逃がさん。agreement_verify.py の canonical() と同じ物。
export function canonicalUtf8(v) {
  return build(v, strUtf8);
}

// 契約の入れ物の canonical: 上と同じで、非 ASCII を \uXXXX に逃がす形。
// json.dumps(sort_keys=True, separators=(",",":"), ensure_ascii=True) と同じ物。
// 中身は build を共有しとる。二本立てにしたら、いつか片方だけ直る。
export function canonicalAscii(v) {
  return build(v, str);
}

// ---------------------------------------------------------------------------
// Reading. The half nobody writes down and everybody gets wrong.
//
// JSON.parse gives every number as a double, so 1180591620717411303424 and
// 1.1805916207174113e+21 arrive as the same value and the record cannot be put
// back the way it came. Python does not lose that: json.loads gives an int of
// whatever size. So the source text of each number has to be looked at.
//
// And json.loads keeps the LAST of two identical keys and says nothing, which is
// why agreement_verify.py does not call it bare: it calls parse_strict, which
// refuses a duplicate key outright and reports duplicate_json_key. A record
// carrying "amount" twice would otherwise canonicalize to a number the person who
// read it never saw. This file has to refuse it in the same place, by the same
// name, or the two verifiers disagree about what is even readable.
//
// JSON.parse cannot help with that: by the time a reviver sees an object, the
// duplicate is already gone. So the reader the verifier uses is the scanner in
// this file, on every host, and there is no branch on what the host can do.
// parseNative stays for one job only: to be a second opinion on the scanner in
// the round trip test. It is not, and must not become, the reader.
//
//   parseStrict     what the verifier reads with. Refuses a duplicate key.
//   parseLoose      what bare json.loads does. Last key wins. For proving that.
//   parseNative     the host's JSON.parse. Cannot see duplicates. Test only.
//
// Errors carry .code so the caller can put the right refusal name in the report
// without reading English: duplicate_json_key, too_deep, bad_json.
// ---------------------------------------------------------------------------

// Depth. Measured 2026-09-10 against the real agreement_verify.py, not reasoned
// about: python's parse_strict took 993 levels and then took 994 as well, because
// RecursionError depends on how much stack is left at that moment, not on a
// number anybody chose. So there is no depth contract to copy. What IS a contract
// is verify's own MAX_DEPTH of 32: everything at 32 or deeper is refused too_deep
// by both sides, deterministically, and the deepest input in the 5,221 case
// fixture is 41. So this reader sets no ceiling of its own. It only catches the
// host running out of stack and reports it by the same name python's reader uses,
// so that an input neither reader can hold reads the same either way.

class CanonicalError extends SyntaxError {
  constructor(code, message) {
    super(message);
    this.name = "CanonicalError";
    this.code = code;
  }
}
export { CanonicalError };

const INTISH = /^-?\d+$/;

// Does this host hand the reviver the source text? Asked once, by asking.
export const HAS_JSON_SOURCE = (() => {
  try {
    let seen = false;
    JSON.parse("1", function (k, v, ctx) {
      seen = !!ctx && typeof ctx.source === "string";
      return v;
    });
    return seen;
  } catch {
    return false;
  }
})();

// Test only. Cannot see duplicate keys. Do not read records with this.
export function parseNative(text) {
  if (!HAS_JSON_SOURCE) {
    throw new CanonicalError("bad_json", "この JS には JSON.parse の source が無い");
  }
  return JSON.parse(text, function (key, value, ctx) {
    if (typeof value !== "number") return value;
    const src = ctx && ctx.source;
    if (typeof src !== "string") {
      // 数やのに source が無い。黙って double を返したら記録が変わる。止める。
      throw new CanonicalError("bad_json", "数の source が無い: key=" + JSON.stringify(key));
    }
    return INTISH.test(src) ? BigInt(src) : value;
  });
}

const isDigit = (c) => c >= 0x30 && c <= 0x39;
const HEX4 = /^[0-9a-fA-F]{4}$/;

function scan(text, opts) {
  const dupLastWins = !!(opts && opts.duplicates === "last");
  let i = 0;
  const n = text.length;

  const err = (code, m) => {
    throw new CanonicalError(code, m + " (" + i + " 文字目)");
  };

  const ws = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
      else break;
    }
  };

  const string = () => {
    i++;                                  // opening quote, already seen
    let out = "", start = i;
    for (;;) {
      if (i >= n) err("bad_json", "文字列が閉じとらん");
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        out += text.slice(start, i);
        i++;
        return out;
      }
      if (c === 0x5c) {
        out += text.slice(start, i);
        i++;
        const e = text[i];
        i++;
        if (e === '"') out += '"';
        else if (e === "\\") out += "\\";
        else if (e === "/") out += "/";
        else if (e === "b") out += "\b";
        else if (e === "f") out += "\f";
        else if (e === "n") out += "\n";
        else if (e === "r") out += "\r";
        else if (e === "t") out += "\t";
        else if (e === "u") {
          const h = text.slice(i, i + 4);
          if (!HEX4.test(h)) err("bad_json", "\\u の後が 16 進 4 桁やない");
          // fromCharCode やから、対を組まん代理符号もそのまま残る。Python の
          // json.loads と同じ。ここで組み直したら記録が変わる。
          out += String.fromCharCode(parseInt(h, 16));
          i += 4;
        } else err("bad_json", "知らん逃がし方: \\" + e);
        start = i;
        continue;
      }
      if (c < 0x20) err("bad_json", "生の制御文字");
      i++;
    }
  };

  const number = () => {
    const s = i;
    if (text.charCodeAt(i) === 0x2d) i++;
    let c = text.charCodeAt(i);
    if (c === 0x30) i++;
    else if (c >= 0x31 && c <= 0x39) { i++; while (isDigit(text.charCodeAt(i))) i++; }
    else err("bad_json", "数が来てへん");
    let isInt = true;
    if (text.charCodeAt(i) === 0x2e) {
      isInt = false;
      i++;
      if (!isDigit(text.charCodeAt(i))) err("bad_json", "小数点の後に数字が無い");
      while (isDigit(text.charCodeAt(i))) i++;
    }
    c = text.charCodeAt(i);
    if (c === 0x65 || c === 0x45) {
      isInt = false;
      i++;
      c = text.charCodeAt(i);
      if (c === 0x2b || c === 0x2d) i++;
      if (!isDigit(text.charCodeAt(i))) err("bad_json", "指数に数字が無い");
      while (isDigit(text.charCodeAt(i))) i++;
    }
    const src = text.slice(s, i);
    return isInt ? BigInt(src) : Number(src);
  };

  const word = (w, v) => {
    if (text.slice(i, i + w.length) !== w) err("bad_json", "知らん語");
    i += w.length;
    return v;
  };

  const value = () => {
    ws();
    if (i >= n) err("bad_json", "値が来る所で終わっとる");
    const c = text.charCodeAt(i);
    if (c === 0x7b) {                     // {
      i++;
      const o = {};
      const seen = dupLastWins ? null : new Set();
      ws();
      if (text.charCodeAt(i) === 0x7d) { i++; return o; }
      for (;;) {
        ws();
        if (text.charCodeAt(i) !== 0x22) err("bad_json", "鍵は文字列やないとあかん");
        const k = string();
        if (seen) {
          // agreement_verify.py の parse_strict と同じ所で、同じ名前で断る。
          if (seen.has(k)) err("duplicate_json_key", "duplicate key in JSON object: " + k);
          seen.add(k);
        }
        ws();
        if (text.charCodeAt(i) !== 0x3a) err("bad_json", "鍵の後に : が無い");
        i++;
        // 緩い側は後勝ち。python の json.loads がそうやから、そう写す。
        o[k] = value();
        ws();
        const d = text.charCodeAt(i);
        if (d === 0x2c) { i++; continue; }
        if (d === 0x7d) { i++; return o; }
        err("bad_json", "object に , か } が無い");
      }
    }
    if (c === 0x5b) {                     // [
      i++;
      const a = [];
      ws();
      if (text.charCodeAt(i) === 0x5d) { i++; return a; }
      for (;;) {
        a.push(value());
        ws();
        const d = text.charCodeAt(i);
        if (d === 0x2c) { i++; continue; }
        if (d === 0x5d) { i++; return a; }
        err("bad_json", "array に , か ] が無い");
      }
    }
    if (c === 0x22) return string();
    if (c === 0x74) return word("true", true);
    if (c === 0x66) return word("false", false);
    if (c === 0x6e) return word("null", null);
    // NaN と Infinity。json.loads は既定でこれを通す。通したなる所やが、通す。
    // 断ったら報告書がずれるからや。python は読んだ上で verify が unsafe_number と
    // 書いて断る。ここで bad_json と書いてしもたら、同じ入力に二つの言語が別の
    // 名前を付ける。どこで断るかやのうて、何と呼ぶかが揃うとらんとあかん。
    // (見つけ方: 断る作りで先に書いて、python の parse_strict と突き合わせたら
    //  この 3 語だけ食い違うた。2026-09-10)
    if (c === 0x4e) return word("NaN", NaN);
    if (c === 0x49) return word("Infinity", Infinity);
    if (c === 0x2d && text.charCodeAt(i + 1) === 0x49) return word("-Infinity", -Infinity);
    if (c === 0x2d || isDigit(c)) return number();
    err("bad_json", "値の頭が読めん: " + JSON.stringify(text[i]));
  };

  const v = value();
  ws();
  if (i !== n) err("bad_json", "末尾に余りがある");
  return v;
}

export function parseScan(text, opts) {
  try {
    return scan(text, opts);
  } catch (e) {
    if (e instanceof RangeError) {
      // 宿主の stack が尽きた。python の読み手が RecursionError で諦めた時に
      // agreement_verify.py が書くのと同じ名前、同じ文で返す。
      throw new CanonicalError("too_deep", "the JSON is nested past what a reader can parse");
    }
    throw e;
  }
}

// What the verifier reads records with. Refuses a duplicate key by name.
export function parseStrict(text) {
  return parseScan(text);
}

// What bare json.loads does: the last of two identical keys wins, silently.
// Here so that the agreement with python can be shown rather than assumed.
export function parseLoose(text) {
  return parseScan(text, { duplicates: "last" });
}

export const parseCanonical = parseStrict;
