// quote_check.py(46e1ee18)の JS の双子(DESIGN_BATON_A74_v1 の F5)。書いた者 番人(Team) の作業役 2026-11-01、照らすのは番人(個人)。
// 正規化の順は py と同じ: NFKC、幅の無い字と向きの制御の字を消す、曲がった引用符と横線の類を写す、casefold、空白の続きを 1 つに。
// casefold と空白の判じは JS に同じ物が無いので、Python(Unicode 16.0.0)の str.casefold と str.isspace から作った表 quote_check_tables_v1.json を読む。
// 表の sha と Unicode の版が合わなければ止まる。NFKC は JS の String.prototype.normalize(Node の ICU。Unicode の版を照らす)。
// 長さは code point の数で数える(py の len と同じ)。
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const HERE = new URL(".", import.meta.url);
const TABLES_SHA = "c251e2c3";
const raw = readFileSync(new URL("quote_check_tables_v1.json", HERE));
if (!createHash("sha256").update(raw).digest("hex").startsWith(TABLES_SHA)) throw new Error("quote_check_tables_v1.json が " + TABLES_SHA + " でない");
const T = JSON.parse(raw.toString("utf8"));
if (T.unicode !== "16.0.0" || !String(process.versions.unicode).startsWith("16.0")) throw new Error("Unicode の版が 16.0 でない(表 " + T.unicode + "、node " + process.versions.unicode + ")");
const CF = new Map(Object.entries(T.casefold).map(([k, v]) => [Number(k), v]));
const WS = new Set(T.whitespace);
export const MIN_CHARS = 12, MAX_CHARS = 400;
const DROP = new Set([0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF, 0x00AD, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069]);
const MAP = new Map([[0x2018, "'"], [0x2019, "'"], [0x201A, "'"], [0x201B, "'"], [0x2032, "'"], [0x201C, '"'], [0x201D, '"'], [0x201E, '"'], [0x201F, '"'], [0x2033, '"'],
  [0x2010, "-"], [0x2011, "-"], [0x2012, "-"], [0x2013, "-"], [0x2014, "-"], [0x2015, "-"], [0x2212, "-"]]);
export const ACCEPT = ["ok", "ok_whole_text"];
function cps(s) { const out = []; for (let i = 0; i < s.length; ) { const c = s.codePointAt(i); out.push(c); i += c > 0xFFFF ? 2 : 1; } return out; }
export function norm(s) {
  s = (s == null ? "" : String(s)).normalize("NFKC");
  let t = "";
  for (const c of cps(s)) { if (DROP.has(c)) continue; t += MAP.has(c) ? MAP.get(c) : String.fromCodePoint(c); }
  let f = "";
  for (const c of cps(t)) f += CF.has(c) ? CF.get(c) : String.fromCodePoint(c);
  const parts = []; let cur = "";
  for (const c of cps(f)) { if (WS.has(c)) { if (cur) { parts.push(cur); cur = ""; } } else cur += String.fromCodePoint(c); }
  if (cur) parts.push(cur);
  return parts.join(" ");
}
export function check(quote, text) {
  const q = norm(quote);
  if (!q) return "empty";
  const n = cps(q).length;
  if (n < MIN_CHARS) return q === norm(text) ? "ok_whole_text" : "too_short";
  if (n > MAX_CHARS) return "too_long";
  if (norm(text).includes(q)) return "ok";
  return q.includes("...") ? "not_found_with_ellipsis" : "not_found";
}
export const accepted = (quote, text) => ACCEPT.includes(check(quote, text));
