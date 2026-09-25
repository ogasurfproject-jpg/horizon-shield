#!/usr/bin/env node
// musubi-canonical-v0: the canonical bytes every MUSUBI digest is computed over, written in a second runtime.
//
// The rule (the same one contract_v0.canonical / agreement_verify.canonical produce in Python):
//   1. UTF-8. Non-ASCII characters are written as themselves, never as \u escapes.
//   2. Object keys sorted by Unicode code point at every level. Keys must be printable ASCII (0x20..0x7E),
//      which verify_contract enforces, so code point order and byte order and UTF-16 order all agree.
//   3. Separators "," and ":" with no whitespace anywhere outside strings.
//   4. Strings: only '"', '\\' and U+0000..U+001F are escaped; \b \f \n \r \t take the short form, the other
//      control characters \u00xx with lowercase hex. U+007F and everything above U+001F are written raw.
//   5. Numbers: integers only, within plus or minus (2^53 - 1), written in decimal with no sign on zero, no
//      exponent, no fraction. A float, NaN or Infinity has no canonical form and verify_contract refuses it.
//   6. true, false, null as literals. Empty object "{}" and empty array "[]".
//
// canonical_vectors.json holds fixed inputs with the sha256 of their canonical bytes. contract_v0.py's selftest
// recomputes them in Python and, when node is present, runs this file over the same vectors and asserts the
// bytes are identical. Two runtimes, one set of bytes, checked on every run: that is what "canonical" means here.
//
//   node canonical_v0.mjs --vectors canonical_vectors.json     # prints  <sha256>  <name> per vector
//   echo '{"b":1,"a":[true,null]}' | node canonical_v0.mjs        # prints the canonical bytes
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const SAFE = 9007199254740991;

function keyOk(k) {
  for (let i = 0; i < k.length; i++) {
    const c = k.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

function str(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x0c) out += "\\f";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c < 0x20) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

export function canonical(v) {
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") {
    if (!Number.isInteger(v) || Math.abs(v) > SAFE) throw new Error("no canonical form for " + String(v));
    return v === 0 ? "0" : String(v);
  }
  if (typeof v === "bigint") {
    if (v > BigInt(SAFE) || v < -BigInt(SAFE)) throw new Error("no canonical form for " + v.toString());
    return v.toString();
  }
  if (typeof v === "string") return str(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (typeof v === "object") {
    const keys = Object.keys(v);
    for (const k of keys) if (!keyOk(k)) throw new Error("key is not printable ASCII: " + JSON.stringify(k));
    keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));          // ASCII keys: code point order is string order
    return "{" + keys.map((k) => str(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  throw new Error("no canonical form for " + typeof v);
}

export function sha256(s) {
  return createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  if (a[0] === "--vectors") {
    const vectors = JSON.parse(readFileSync(a[1], "utf8"));
    for (const vec of vectors) {
      let line;
      try { line = sha256(canonical(vec.value)) + "  " + vec.name; }
      catch (e) { line = "REFUSED  " + vec.name + "  " + e.message; }
      process.stdout.write(line + "\n");
    }
  } else {
    const text = readFileSync(0, "utf8");
    process.stdout.write(canonical(JSON.parse(text)));
  }
}
