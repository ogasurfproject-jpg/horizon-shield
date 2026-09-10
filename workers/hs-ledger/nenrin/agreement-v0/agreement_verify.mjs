// RUN_ALL: library  検証規則の 2 つ目の実装。まだ骨だけ。採点は agreement_verify_test.mjs
//
// a2a-agreement-v1 / v1.1 の検証器、JavaScript 側。
//
// これは 2 つ目の実装や。1 つ目は agreement_verify.py で、あちらが正しい。ここが
// 正しいかどうかは、5,221 件の凍った報告書と 1 バイトも違わんかどうかだけで決まる。
// 読んで納得しても意味が無い。agreement_verify_test.mjs が点を付ける。
//
// 今どこまで来とるか (2026-09-10):
//   まだ骨だけ。規則は 1 本も入っとらん。報告書の型と、鍵の計算できる分だけ。
//   採点板は 0 から始まる。0 を緑と呼ばんのが、この作りの一番大事な所や。
//
// 非同期な理由。sha256 も Ed25519 も WebCrypto でやる。Worker には同期の口が無い。
// 後から同期を非同期に直すのは書き直しやから、最初から非同期にしとく。
import { canonicalUtf8, cmpCodePoints, num, parseStrict } from "./agreement_canonical.mjs";

export const VERIFIER_VERSION = "0.2.0";
export const REPORT_SCHEMA = "a2a-agreement-verify-v0";
export const SCHEMAS = ["a2a-agreement-v1", "a2a-agreement-v1.1"];

const enc = new TextEncoder();

export async function sha256Hex(bytes) {
  const b = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  const d = await globalThis.crypto.subtle.digest("SHA-256", b);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// v1 の草案が 4 節で名前を挙げとる code。ここに載っとらん物は、検証器を作る途中で
// 見つかった追加や。v1.1 はそれを取り込む。どちらかは報告書に必ず書く。
export const DRAFT_CODES = new Set([
  "one_sided", "signatures_disagree", "self_agreement", "bad_key_url",
  "key_url_unreachable", "missing_conduct_sha", "disclaimer_missing", "fee_tied_to_outcome",
]);

export class Report {
  constructor() {
    this.refusals = [];
    this.findings = [];
    // 断りと所見が **同じ** 覚え書きを共有しとる。同じ (code, why) は二度出さん。
    // 分けたら、断った後に同じ文言の所見が出て、python と違う報告書になる。
    this.seen = new Set();
  }
  _once(code, why) {
    const k = JSON.stringify([code, why]);
    if (this.seen.has(k)) return false;
    this.seen.add(k);
    return true;
  }
  // in_draft は渡す物やのうて、code から導く物や。
  refuse(code, why) {
    if (!this._once(code, why)) return;
    this.refusals.push({ code, why, in_draft: DRAFT_CODES.has(code) });
  }
  // 所見に in_draft は付かん。鍵の集合が断りと違う。
  find(code, why) {
    if (!this._once(code, why)) return;
    this.findings.push({ code, why });
  }
}

// python の repr()。断り文の %r はこれや。JSON の書き方とは別物で、
// None / True / 単引用符 / \x00 / 印字できん文字 の扱いが全部違う。
//
// 印字できるかどうかは python の Py_UNICODE_ISPRINTABLE と同じ規則で決める:
// 分類が Cc Cf Cs Co Cn Zl Zp Zs の文字は印字できん扱い。ただし空白 (U+0020) だけは
// 印字できる扱いや。この規則は当てもんやのうて、agreement_pyrepr_v1.json の
// 809 件 (契約に出る値 260 種を全部含む) で突き合わせてある。
const NONPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

function reprStr(s) {
  // 引用符の選び方: 既定は単引用符。中に ' が有って " が無いときだけ二重引用符。
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {                 // 符号位置で回す。代理対を 1 文字として見るため
    const cp = ch.codePointAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === q) out += "\\" + q;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    // 空白 (U+0020) は Zs やが、python は印字できる扱いにする。ここだけ例外。
    // (書いた comment には有ったのに実装に入れ忘れとって、809 件中 29 件がずれた。
    //  表が無かったら「まあ空白は大丈夫やろ」で通しとった。)
    else if (ch !== " " && NONPRINTABLE.test(ch)) {
      if (cp < 0x100) out += "\\x" + cp.toString(16).padStart(2, "0");
      else if (cp < 0x10000) out += "\\u" + cp.toString(16).padStart(4, "0");
      else out += "\\U" + cp.toString(16).padStart(8, "0");
    } else out += ch;
  }
  return out + q;
}

export function pyRepr(v) {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") {
    // repr(float) は json.dumps と違う。無限と NaN が inf / -inf / nan になる。
    if (Number.isNaN(v)) return "nan";
    if (v === Infinity) return "inf";
    if (v === -Infinity) return "-inf";
    return num(v);
  }
  if (typeof v === "string") return reprStr(v);
  if (Array.isArray(v)) return "[" + v.map(pyRepr).join(", ") + "]";
  if (typeof v === "object") {
    // dict は挿入順で出る。並べ替えたらあかん。
    return "{" + Object.keys(v).map((k) => pyRepr(k) + ": " + pyRepr(v[k])).join(", ") + "}";
  }
  throw new TypeError("repr できん型: " + typeof v);
}

// python の "%s" % v。None は "None"、真偽は "True"/"False"、int は桁、それ以外は str()。
// establishes に block の高さを差し込む所で要る。ここを JSON の書き方でやったら
// null や true がそのまま出て、python と 1 文字ずれる。
export function pyStr(v) {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return num(v);
  if (typeof v === "string") return v;
  return canonicalUtf8(v);
}

export function schemaOf(record) {
  const s = record && typeof record === "object" && !Array.isArray(record) ? record.schema : null;
  return SCHEMAS.includes(s) ? s : null;
}

export const SCHEMA_V1 = "a2a-agreement-v1";
export const SCHEMA_V11 = "a2a-agreement-v1.1";
export const CONTEXT = { [SCHEMA_V1]: "", [SCHEMA_V11]: "a2a-agreement-v1.1\n" };
export const DRAFT = {
  [SCHEMA_V1]: "ops/AGREEMENT_EXT_v0_DRAFT.md",
  [SCHEMA_V11]: "ops/AGREEMENT_EXT_v0_1_DRAFT.md",
};

export const PAID_BY_WORDS = ["both", "neither", "third_party"];
export const PAID_BY_V1 = ["party_a", "party_b"].concat(PAID_BY_WORDS);
export const FEE_BASES_OK = ["flat", "per_record", "subscription", "none"];
export const FEE_BASES_BAD = ["percent_of_amount", "percent", "share_of_amount", "success_fee",
  "commission", "basis_points", "per_mille", "share_of_savings"];

// python の \b は Unicode の語境界 (文字・数字・下線)。JS の \b は ASCII だけや。
// "\bpaid\b" は "支払paid済" の中で、python は当たらんが JS は当たる。
// せやから \b を書かずに、Unicode の見回しで同じ境界を作る。
const WB = "(?<![\\p{L}\\p{N}_])";
const WE = "(?![\\p{L}\\p{N}_])";
const w = (body) => new RegExp(WB + "(?:" + body + ")" + WE, "u");

// establishes[] が言うたらあかんこと。この記録が証すのは「2 つの鍵が同じバイトに
// 署名した」だけで、その後に何が起きたかやない。
export const OVERCLAIM = [
  [w("performed"), "performance"],
  [w("deliver(?:ed|y)"), "delivery"],
  [w("money (?:moved|was sent)"), "movement of money"],
  [w("funds? (?:moved|were sent|were transferred)"), "movement of funds"],
  [new RegExp(WB + "paid" + WE + "(?!\\s+for\\s+(?:this|the)\\s+record)", "u"), "payment"],
  [w("payment (?:was|has been) (?:made|completed|settled|received)"), "payment"],
  [w("contract"), "formation of a contract"],
  [w("binding"), "legal effect"],
  [new RegExp(WB + "guarantee", "u"), "a guarantee"],
  [w("escrow"), "custody"],
  [w("custody"), "custody"],
  [w("solvent"), "solvency"],
  [w("lawful"), "lawfulness"],
  [w("fair"), "fairness"],
  [w("certified"), "certification"],
];

// v1.1: does_not_establish が実際に覆わなあかん題目。
export const REQUIRED_DNE = [
  ["performance", ["perform"]],
  ["that this is not a contract", ["contract"]],
  ["that money moved", ["money", "payment", "paid"]],
  ["the accuracy of the conduct records", ["conduct record"]],
];

export const ROLES = ["payer", "payee", "peer"];

// python の str.strip() が削る空白と、JS の trim() が削る空白は違う集合や。
// python だけ: \x1c \x1d \x1e \x1f \x85。JS だけ: \ufeff。
// 測って確かめた (2026-09-10)。\x85 は scan_text の制御文字にも入っとらんから、
// ここまで生きて届く。trim() で代用したら、その 1 文字で domain の判定が割れる。
const PY_SPACE = "\u0009\u000a\u000b\u000c\u000d\u001c\u001d\u001e\u001f\u0020"
  + "\u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007"
  + "\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000";

export function pyStrip(s) {
  let a = 0, b = s.length;
  while (a < b && PY_SPACE.includes(s[a])) a++;
  while (b > a && PY_SPACE.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

const rstripDot = (s) => { let b = s.length; while (b > 0 && s[b - 1] === ".") b--; return s.slice(0, b); };

const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

// 裸のホスト名。小文字、末尾の点は落とす。そうでなければ null。
export function normDomain(d) {
  if (typeof d !== "string" || d === "") return null;
  const s = rstripDot(pyStrip(d).toLowerCase());
  if (!s || s.includes("/") || s.includes("@") || s.includes(":") || s.includes(" ")) return null;
  const labels = s.split(".");
  if (labels.length < 2) return null;
  for (const lab of labels) if (!lab || !LABEL.test(lab)) return null;
  return s;
}

// https の URL のホスト。https でないか読めん時は null。
export function hostOfHttps(u) {
  if (typeof u !== "string") return null;
  const m = /^https:\/\/([^/?#\s@]+)(?:[/?#][\s\S]*)?$/.exec(pyStrip(u));
  if (!m) return null;
  const host = rstripDot(m[1].split(":")[0].toLowerCase());
  return host || null;
}

export const underDomain = (host, domain) => host === domain || (host || "").endsWith("." + domain);

export const parentTwo = (domain) => {
  const parts = domain.split(".");
  return parts.length >= 2 ? parts.slice(-2).join(".") : domain;
};

// 正準な base64 で、長さもぴったりでないとあかん。そうでなければ null。
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
export function b64Raw(str, wantLen) {
  if (typeof str !== "string" || str === "") return null;
  if (!B64.test(str) || str.length % 4 !== 0) return null;   // python の validate=True
  let raw;
  try {
    const bin = atob(str);
    raw = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch { return null; }
  if (raw.length !== wantLen) return null;
  // 余り bit が立っとる、あるいは詰め方が別、を弾く: 書き戻して同じ字か見る
  let back = "";
  for (const b of raw) back += String.fromCharCode(b);
  if (btoa(back) !== str) return null;
  return raw;
}

// python の type(x).__name__ 。not_two_parties の文面で使う。
export function pyTypeName(v) {
  if (v === null || v === undefined) return "NoneType";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "bigint") return "int";
  if (typeof v === "number") return "float";
  if (typeof v === "string") return "str";
  if (Array.isArray(v)) return "list";
  return "dict";
}

export const MAX_DEPTH = 32;
export const MAX_NODES = 20000;
export const MAX_STRING = 4096;
export const MAX_ARRAY = 64;
export const MAX_BYTES = { [SCHEMA_V1]: 65536, [SCHEMA_V11]: 16384 };
export const SAFE_INT_MAX = 9007199254740991n;   // 2**53 - 1

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// python の list.sort() は要素ごとに符号位置で比べる。tuple の list もそれや。
// JS の既定の sort は文字列にして UTF-16 単位で比べるから、BMP の外で割れる。
const cmpTuple = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    const c = cmpCodePoints(String(a[i]), String(b[i]));
    if (c !== 0) return c;
  }
  return 0;
};

// python の sorted(keys, reverse=True)
const keysDesc = (o) => Object.keys(o).sort(cmpCodePoints).reverse();

// 深さ、節の数、自分自身を指しとるか。canonical にする前に測る。
// 際限の無い形を canonical にしようとするのは、読み手が答える代わりに死ぬ道や。
export function measure(root) {
  let depth = 0, nodes = 0;
  const seen = new Set();
  const stack = [[root, 1]];
  while (stack.length) {
    const [node, d] = stack.pop();
    nodes += 1;
    if (d > depth) depth = d;
    if (isObj(node) || Array.isArray(node)) {
      if (seen.has(node)) return [depth, nodes, true];
      seen.add(node);
      if (d >= MAX_DEPTH || nodes > MAX_NODES) return [depth, nodes, false];
      // 子は鍵の並べ替え順で辿る。scan_text や scan_numbers と同じや。
      // この関数は深さの上限で **早く抜ける** から、報告する節の数は「どの部分木に
      // 先に降りたか」で変わる。それは dict の挿入順で決まっとった。JSON は挿入順を
      // 運ばんし、JS は整数に見える鍵を勝手に前へ出す。せやから「holds N nodes」は、
      // 2 つ目の実装が再現できん数やった。
      // (2026-09-10、この移植が 5,221 件中 2 件で食い違うた。決め手は python を
      //  自分の契約に当てたことで、python もその 2 件を再現でけへんかった。
      //  参照実装が記録から再現でけへん値は、最初から仕様やない。)
      const vs = Array.isArray(node) ? node : keysDesc(node).map((k) => node[k]);
      for (const v of vs) stack.push([v, d + 1]);
    }
  }
  return [depth, nodes, false];
}

// \x09 (tab) だけがここから外れとる。\x7f は入っとる。python の字をそのまま写す。
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f]/;

// canonical にできん文字列と、端末が言うことを聞いてまう文字列。
// 対を組まん代理符号は JSON としては正しく、json.loads も通り、UTF-8 に直す所で死ぬ。
export function scanText(root) {
  const out = [];
  const stack = [[root, "$"]];
  while (stack.length) {
    const [node, p] = stack.pop();
    if (typeof node === "string") {
      for (const ch of node) {                 // 符号位置で回る。python の for ch in s と同じ
        const cp = ch.codePointAt(0);
        if (cp >= 0xd800 && cp <= 0xdfff) {
          out.push([p, "carries a lone surrogate (U+" + cp.toString(16).toUpperCase().padStart(4, "0")
            + "), which is not encodable as UTF-8"]);
          break;
        }
      }
      if (CONTROL.test(node)) out.push([p, "carries a control character"]);
      const n = [...node].length;              // python は符号位置で数える
      if (n > MAX_STRING) out.push([p, "is " + n + " characters; the limit is " + MAX_STRING]);
    } else if (isObj(node)) {
      for (const k of keysDesc(node)) {
        stack.push([k, p + ".<key>"]);
        stack.push([node[k], p + "." + k]);
      }
    } else if (Array.isArray(node)) {
      if (node.length > MAX_ARRAY) {
        out.push([p, "has " + node.length + " entries; the limit is " + MAX_ARRAY]);
      }
      for (let i = Math.min(node.length, MAX_ARRAY + 1) - 1; i >= 0; i--) {
        stack.push([node[i], p + "[" + i + "]"]);
      }
    }
  }
  out.sort(cmpTuple);
  return out;
}

// 2 つ目の実装が同じに読み戻せんかもしれん数。
export function scanNumbers(root, path = "$") {
  const out = [];
  const stack = [[root, path]];
  while (stack.length) {
    const [node, p] = stack.pop();
    if (typeof node === "boolean") continue;
    if (typeof node === "bigint") {
      const abs = node < 0n ? -node : node;
      if (abs > SAFE_INT_MAX) out.push([p, "integer outside the RFC 7493 safe range", node.toString()]);
    } else if (typeof node === "number") {
      if (Number.isNaN(node) || node === Infinity || node === -Infinity) {
        out.push([p, "not a finite number", pyRepr(node)]);
      } else {
        out.push([p, "not an integer", pyRepr(node)]);
      }
    } else if (isObj(node)) {
      for (const k of keysDesc(node)) stack.push([node[k], p + "." + k]);
    } else if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push([node[i], p + "[" + i + "]"]);
    }
  }
  out.sort(cmpTuple);
  return out;
}

// 当事者が署名するバイト:// 当事者が署名するバイト: signatures を抜いた記録の canonical に、schema の前置きを付けた物。
export function signingBytes(record, schema) {
  const sc = schema === undefined || schema === null ? (schemaOf(record) || SCHEMA_V1) : schema;
  const body = {};
  for (const k of Object.keys(record)) if (k !== "signatures") body[k] = record[k];
  return enc.encode((CONTEXT[sc] === undefined ? "" : CONTEXT[sc]) + canonicalUtf8(body));
}

// 記録が何を立証せんか。verdict に関わらず、この 6 行が土台や。
const DNE_BASE = [
  "that either party performed, or that money moved",
  "that this record is a contract, or that the terms are lawful, fair or complete",
  "that either party is solvent, competent or honest",
  "that the conduct records named by sha256 are accurate; only that they are the records that were presented",
  "that this record was filed anywhere, or that it is the only one these parties signed",
  "anything about time: the anchor bounds agreed_at from above, and this verifier never saw an anchor",
];

// 記録に触る前に断った時の報告書。_report と鍵の集合が違う (signatures を持たん)。
// そこを揃えんかったら、canonical のバイトが必ずずれる。
function early(r, inputTextSha, est, dne) {
  return {
    schema: REPORT_SCHEMA,
    verifier_version: VERIFIER_VERSION,
    record_schema: null,
    draft: null,
    verdict: "refused",
    signatures_checked: false,
    key_urls_checked: false,
    refusals: r.refusals,
    findings: r.findings,
    canonical_sha256: null,
    signing_sha256: null,
    input_sha256: inputTextSha,
    input_is_canonical: null,
    establishes: est,
    does_not_establish: dne,
  };
}

export async function buildReport(r, record, schema, checked, urlsChecked, perSig, inputText, can) {
  const verdict = r.refusals.length ? "refused" : (checked ? "accepted" : "incomplete");
  const selfMeasured = r.findings.some((f) => f.code === "conduct_self_measured");
  const dne = DNE_BASE.slice();
  if (!urlsChecked) {
    dne.push("that the key each party signed with is the key it serves at its key_url: no URL was fetched, because this verifier is offline");
  }
  if (selfMeasured) {
    dne.push("that the conduct pinned here was measured by anybody other than the two parties: at least one side declared self_measured");
  }
  const out = {
    schema: REPORT_SCHEMA,
    verifier_version: VERIFIER_VERSION,
    record_schema: schema,
    draft: DRAFT[schema] === undefined ? null : DRAFT[schema],
    verdict,
    signatures_checked: checked,
    key_urls_checked: urlsChecked,
    refusals: r.refusals,
    findings: r.findings,
    signatures: perSig,
    canonical_sha256: await sha256Hex(can),
    signing_sha256: schema ? await sha256Hex(signingBytes(record, schema)) : null,
    input_sha256: inputText === null || inputText === undefined ? null : await sha256Hex(inputText),
    input_is_canonical: inputText === null || inputText === undefined ? null : inputText.trim() === can,
    establishes: [],
    does_not_establish: dne,
  };
  if (verdict === "accepted") {
    out.establishes = [
      "two keys, one per party, signed the same canonical bytes, and both Ed25519 signatures verify",
      "each party named a conduct record by sha256 at the moment of signing",
      "the record discloses who paid for this record",
    ];
    if (schema === SCHEMA_V11) {
      out.establishes.push("the keys are inside the signed bytes, so this result can be reproduced from the record alone, with no network and no live key server");
      if (!selfMeasured) {
        out.establishes.push("each party pinned the counterparty's conduct as written by somebody other than the two parties");
      }
    }
    if (urlsChecked) {
      out.establishes.push("each signing key is the key served at that party's own key_url, so the signature is attributable to the domain and not only to the holder of the key");
    }
    const lb = record && typeof record === "object" && !Array.isArray(record) ? record.lower_bound : null;
    if (lb && typeof lb === "object" && !Array.isArray(lb) && lb.kind === "bitcoin_block") {
      out.establishes.push("the record names Bitcoin block " + pyStr(lb.height)
        + " by hash, so it cannot have been written before that block existed; the anchor bounds it from above and this bounds it from below");
    }
  } else if (verdict === "incomplete") {
    out.establishes = [
      "the record has the shape its schema requires",
      "no signature was checked, so nothing here says the parties agreed",
    ];
  } else {
    out.establishes = ["that this record was refused, for the reasons listed, without any editorial step"];
  }
  if (inputText !== null && inputText !== undefined && out.input_is_canonical === false
      && !out.findings.some((f) => f.code === "not_canonical")
      && !out.refusals.some((x) => x.code === "not_canonical")) {
    out.findings = out.findings.concat([{
      code: "not_canonical",
      why: "the bytes handed to this verifier are not the canonical bytes; canonical_sha256 is what an anchor would carry, input_sha256 is what you have",
    }]);
  }
  return out;
}

// 骨。規則はまだ 1 本も無い。計算できる鍵だけ埋めて、あとは空で返す。
// 空で返すこと自体は嘘やない。嘘になるんは、これを「合格」と呼んだときや。

// python の re.match は、pattern の末尾の $ が「文字列の終わり、または終わりの直前の
// 改行 1 つ」に当たる。JS の $ は改行を許さん。ここを写さんかったら、末尾に改行の付いた
// 値で片方だけ通る。scan_text が制御文字を先に断るから今は届かんが、規則の写しは
// 届く届かんで決めるもんやない。
export function pyFullMatch(body, s) {
  if (typeof s !== "string") return false;
  return new RegExp("^(?:" + body + ")\\n?$").test(s);
}

// python の str(x)。文字列はそのまま、それ以外は repr と同じ物が出る。
// String(v) で代用したら dict が [object Object]、list が "1,2" になる。
// (2026-09-10、採点板が key_url_not_pinned の文面 30 件で捕まえた。)
const pyStrOf = (v) => (typeof v === "string" ? v : pyRepr(v));

// python の真偽値。None False 0 0.0 "" [] {} が偽で、それ以外は真。
// JS では {} も [] も真やから、"x or y" を "x || y" と書いた所が全部ずれる。
// (2026-09-10、key_url が {} の記録で、python は party の key_url に落ちるのに
//  JS は {} を掴んで no_key にした。採点板の 9 件がこれ。)
export function pyTruthy(v) {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "bigint") return v !== 0n;
  if (typeof v === "number") return v !== 0;          // NaN は python でも真
  if (typeof v === "string") return v !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

// --- Ed25519 の鍵の衛生。library も網も要らんように、素の算術で書く ---------------
// 小さい位数の公開鍵は、1 つの署名を多くの message で通してまう。断るんは心配性や
// のうて、「この鍵がこれに署名した」と「どれかの鍵が受け入れた」の差や。
// python 側と同じ式をそのまま写す。BigInt やから桁は落ちん。

const P25519 = (1n << 255n) - 19n;
const L25519 = (1n << 252n) + 27742317777372353535851937790883648493n;

function powMod(b, e, m) {
  let r = 1n;
  b %= m;
  if (b < 0n) b += m;
  while (e > 0n) {
    if (e & 1n) r = r * b % m;
    b = b * b % m;
    e >>= 1n;
  }
  return r;
}

const mod = (a, m) => { const x = a % m; return x < 0n ? x + m : x; };

const D25519 = mod(-121665n * powMod(121666n, P25519 - 2n, P25519), P25519);
const I25519 = powMod(2n, (P25519 - 1n) / 4n, P25519);

function xrecover(y) {
  const xx = mod((y * y - 1n) * powMod(D25519 * y * y + 1n, P25519 - 2n, P25519), P25519);
  let x = powMod(xx, (P25519 + 3n) / 8n, P25519);
  if (mod(x * x - xx, P25519) !== 0n) x = mod(x * I25519, P25519);
  if (mod(x * x - xx, P25519) !== 0n) return null;
  return x;
}

function decodePoint(raw) {
  if (raw.length !== 32) return null;
  let n = 0n;
  for (let i = 31; i >= 0; i--) n = (n << 8n) | BigInt(raw[i]);   // little endian
  const sign = n >> 255n;
  const y = n & ((1n << 255n) - 1n);
  if (y >= P25519) return null;              // 点の非正準な符号化
  let x = xrecover(y);
  if (x === null) return null;
  if ((x & 1n) !== sign) x = mod(P25519 - x, P25519);
  if (x === 0n && sign === 1n) return null;  // もう一つの非正準な符号化
  if (mod(-x * x + y * y - 1n - D25519 * x * x * y * y, P25519) !== 0n) return null;
  return [x, y];
}

const ptExt = ([x, y]) => [mod(x, P25519), mod(y, P25519), 1n, mod(x * y, P25519)];
const EXT_IDENTITY = [0n, 1n, 1n, 0n];

// 拡張座標、a = -1。足すたびに逆元を取ると遅うて、遅い検査は飛ばされる。
// 飛ばされる検査は検査やない。
function extAdd(p, q) {
  const [x1, y1, z1, t1] = p, [x2, y2, z2, t2] = q;
  const a = mod((y1 - x1) * (y2 - x2), P25519);
  const b = mod((y1 + x1) * (y2 + x2), P25519);
  const c = mod(t1 * 2n * D25519 * t2, P25519);
  const d = mod(z1 * 2n * z2, P25519);
  const e = b - a, f = d - c, g = d + c, h = b + a;
  return [mod(e * f, P25519), mod(g * h, P25519), mod(f * g, P25519), mod(e * h, P25519)];
}

const extIsIdentity = ([x, y, z]) => mod(x, P25519) === 0n && mod(y - z, P25519) === 0n;

function scalarmult(point, e) {
  let result = EXT_IDENTITY;
  let addend = ptExt(point);
  while (e > 0n) {
    if (e & 1n) result = extAdd(result, addend);
    addend = extAdd(addend, addend);
    e >>= 1n;
  }
  return result;
}

const KEY_CACHE = new Map();

// 素な位数 L の点なら null。そうでなければ理由。
export function publicKeyProblem(raw) {
  if (!(raw instanceof Uint8Array)) return "is not 32 bytes";
  const key = [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (KEY_CACHE.has(key)) return KEY_CACHE.get(key);
  const point = decodePoint(raw);
  let why;
  if (point === null) why = "is not a canonical encoding of a point on curve25519";
  else if (point[0] === 0n && point[1] === 1n) why = "is the identity element, under which forged signatures verify";
  else if (!extIsIdentity(scalarmult(point, L25519))) why = "is not in the prime order subgroup (a small order or mixed order point)";
  else why = null;
  if (KEY_CACHE.size < 4096) KEY_CACHE.set(key, why);
  return why;
}

// true / false、あるいは鍵か署名がそもそも使えん時は null。
// WebCrypto を使う。Node でも Worker でも同じ口や。python は cryptography (OpenSSL) を
// 使うとる。どちらも RFC 8032 やが、同じかどうかは 5,221 件が言う。
export async function ed25519Verify(pubB64, sigB64, message) {
  const rawPub = b64Raw(pubB64, 32);
  const rawSig = b64Raw(sigB64, 64);
  if (rawPub === null || rawSig === null) return null;
  if (publicKeyProblem(rawPub) !== null) return null;
  try {
    const key = await globalThis.crypto.subtle.importKey("raw", rawPub, { name: "Ed25519" }, false, ["verify"]);
    return await globalThis.crypto.subtle.verify({ name: "Ed25519" }, key, rawSig, message);
  } catch {
    return null;
  }
}

export async function verify(record, opts = {}) {
  const { keys = null, recorderDomain = null, now = null, inputText = null } = opts;
  const r = new Report();
  const shaIn = async () => (inputText === null || inputText === undefined ? null : await sha256Hex(inputText));

  // 1. 形。中身に触る前に。
  if (!isObj(record)) {
    r.refuse("bad_json", "the record must be a JSON object");
    return early(r, await shaIn(),
      ["that this input was refused before any field was read"],
      ["anything at all about any party, term or signature"]);
  }

  const [depth, nodes, cyclic] = measure(record);
  if (cyclic || depth >= MAX_DEPTH || nodes > MAX_NODES) {
    const why = cyclic ? "the record refers to itself"
      : "the record is " + depth + " levels deep and holds " + nodes
        + " nodes; the limits are " + MAX_DEPTH + " and " + MAX_NODES;
    r.refuse("too_deep", why + ". Refused without canonicalizing it, because a reader that recurses would die here instead of answering");
    return early(r, await shaIn(),
      ["that this record was refused for its shape alone, before any field was read"],
      ["anything at all about the parties, the terms or the signatures"]);
  }

  const badText = scanText(record);
  if (badText.length) {
    for (const [p, why] of badText.slice(0, 8)) r.refuse("bad_text", p + " " + why);
    return early(r, await shaIn(),
      ["that this record was refused for its text alone, before any field was read"],
      ["anything at all about the parties, the terms or the signatures"]);
  }

  const schema = schemaOf(record);
  const strict = schema === SCHEMA_V11;
  if (schema === null) {
    r.refuse("bad_schema", "schema must be one of " + SCHEMAS.join(", ")
      + ", found " + pyRepr(record.schema === undefined ? null : record.schema));
  }
  const can = canonicalUtf8(record);
  const canBytes = enc.encode(can).length;
  const limit = MAX_BYTES[schema === null ? SCHEMA_V1 : schema];
  if (canBytes > limit) {
    r.refuse("too_large", "the canonical record is " + canBytes + " bytes; the limit for "
      + (schema === null ? "an unknown schema" : schema) + " is " + limit);
    return early(r, await shaIn(),
      ["that this record was refused for its size alone"],
      ["anything at all about the parties, the terms or the signatures"]);
  }

  // 2. 数。読み込む所で壊れた値は、後の検査を全部無意味にする。
  for (const [pth, why, shown] of scanNumbers(record)) {
    const inTerms = pth.startsWith("$.terms") || pth.startsWith("$.recorder");
    if (why === "not an integer" && !inTerms) {
      r.find("non_integer_number", pth + " is " + why + " (" + shown
        + "); a reader that prints a fixed number of digits will not reproduce these bytes");
    } else {
      r.refuse("unsafe_number", pth + " is " + why + " (" + shown + ")");
    }
  }

  // 3. canonical の形
  if (inputText !== null && inputText !== undefined && inputText.trim() !== can) {
    if (strict) {
      r.refuse("not_canonical", "the bytes handed to this verifier are not the canonical bytes; under v1.1 a record travels in canonical form so that the sha an anchor carries is the sha you hold");
    } else {
      r.find("not_canonical", "the bytes handed to this verifier are not the canonical bytes; canonical_sha256 is what an anchor would carry, input_sha256 is what you have");
    }
  }

  // 4. この合意の識別 (v1.1)
  if (strict) {
    const aid = record.agreement_id;
    if (!(typeof aid === "string" && pyFullMatch("[0-9a-f]{32}", aid))) {
      r.refuse("bad_agreement_id", "agreement_id must be 32 lowercase hex characters chosen at random by the parties, found "
        + pyRepr(aid === undefined ? null : aid)
        + "; without it two honest agreements with identical terms in the same second are one record");
    }
  }

  // 5. agreed_at
  const at = record.agreed_at;
  const pattern = strict
    ? "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z"
    : "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z";
  if (typeof at !== "string" || !pyFullMatch(pattern, at)) {
    r.refuse("bad_agreed_at", "agreed_at must be an ISO-8601 UTC instant"
      + (strict ? " of the form YYYY-MM-DDTHH:MM:SSZ" : " ending in Z")
      + ", found " + pyRepr(at === undefined ? null : at));
  } else if (now && at > now) {
    r.find("agreed_at_in_future", "agreed_at (" + at + ") is later than the time given to this verifier ("
      + now + "); it is a claim by the parties, and the anchor is what bounds it from above");
  }

  const lb = record.lower_bound;
  if (lb !== null && lb !== undefined) {
    const okLb = isObj(lb) && lb.kind === "bitcoin_block"
      && typeof lb.height === "bigint"
      && typeof lb.hash === "string" && pyFullMatch("[0-9a-f]{64}", lb.hash);
    if (!okLb) {
      r.refuse("bad_lower_bound", "lower_bound, when present, must be {kind: bitcoin_block, height: integer, hash: 64 lowercase hex}");
    }
  }

  // 6. parties
  let parties = record.parties;
  if (!Array.isArray(parties) || parties.length !== 2) {
    r.refuse("not_two_parties", "parties must be exactly two objects, found "
      + (Array.isArray(parties) ? String(parties.length) : pyTypeName(parties)));
    parties = Array.isArray(parties) ? parties.filter(isObj) : [];
  }
  const doms = [];
  const pubs = [];
  for (let i = 0; i < parties.length; i++) {
    const pp = parties[i];
    const tag = "parties[" + i + "]";
    if (!isObj(pp)) { r.refuse("bad_party", tag + " is not an object"); continue; }
    const d = normDomain(pp.domain);
    if (!d) {
      r.refuse("bad_domain", tag + ".domain must be a bare hostname, found "
        + pyRepr(pp.domain === undefined ? null : pp.domain));
    } else {
      doms.push(d);
      if (d.split(".").some((lab) => lab.startsWith("xn--"))) {
        r.find("punycode_domain", tag + ".domain " + d
          + " is an internationalised name; two such names can look alike and this verifier compares bytes, not glyphs");
      }
    }
    const ku = pp.key_url;
    const kh = hostOfHttps(ku);
    if (!kh) {
      r.refuse("bad_key_url", tag + ".key_url must be an https URL, found " + pyRepr(ku === undefined ? null : ku));
    } else if (d && !underDomain(kh, d)) {
      r.refuse("bad_key_url", tag + ".key_url host " + kh + " is not under that party's own domain " + d);
    }
    if (typeof pp.agent_card !== "string" || !hostOfHttps(pp.agent_card)) {
      r.refuse("missing_field", tag + ".agent_card must be an https URL (the card this party presented)");
    }
    if (strict) {
      const pk = pp.public_key_ed25519_b64;
      const raw = typeof pk === "string" ? b64Raw(pk, 32) : null;
      if (raw === null) {
        r.refuse("bad_public_key", tag + ".public_key_ed25519_b64 must be 32 bytes of canonical base64; under v1.1 the key lives inside the signed bytes so the record verifies offline forever, whatever the key_url serves next year");
      } else {
        const problem = publicKeyProblem(raw);
        if (problem) r.refuse("bad_public_key", tag + ".public_key_ed25519_b64 " + problem);
        else pubs.push(pk);
      }
      const cs = pp.agent_card_sha256;
      if (!(typeof cs === "string" && pyFullMatch("[0-9a-f]{64}", cs))) {
        r.refuse("bad_card_sha", tag + ".agent_card_sha256 must be 64 lowercase hex; a card named by URL alone can be rewritten after the fact");
      }
      const cr = pp.conduct_record;
      if (!isObj(cr)) {
        r.refuse("missing_conduct_sha", tag + ".conduct_record must be an object {sha256, url, subject_domain, measured_by_domain}");
      } else {
        const sha = cr.sha256;
        if (sha === null || sha === undefined || sha === "") {
          r.refuse("missing_conduct_sha", tag + " presented no conduct record; an agreement record without a conduct record on each side is half of the point");
        } else if (!(typeof sha === "string" && pyFullMatch("[0-9a-f]{64}", sha))) {
          r.refuse("bad_conduct_sha", tag + ".conduct_record.sha256 must be 64 lowercase hex characters, found " + pyRepr(sha));
        }
        if (!hostOfHttps(cr.url)) r.refuse("missing_field", tag + ".conduct_record.url must be an https URL");
        if (!normDomain(cr.subject_domain)) r.refuse("bad_domain", tag + ".conduct_record.subject_domain must be a bare hostname");
        if (!normDomain(cr.measured_by_domain)) r.refuse("bad_domain", tag + ".conduct_record.measured_by_domain must be a bare hostname");
        if (cr.self_measured !== null && cr.self_measured !== undefined && typeof cr.self_measured !== "boolean") {
          r.refuse("missing_field", tag + ".conduct_record.self_measured, when present, must be true or false");
        }
      }
    } else {
      const sha = pp.conduct_record_sha256;
      if (sha === null || sha === undefined || sha === "") {
        r.refuse("missing_conduct_sha", tag + " presented no conduct record; an agreement record without a conduct record on each side is half of the point");
      } else if (!(typeof sha === "string" && pyFullMatch("[0-9a-f]{64}", sha))) {
        r.refuse("bad_conduct_sha", tag + ".conduct_record_sha256 must be 64 lowercase hex characters, found " + pyRepr(sha));
      }
      if (typeof pp.conduct_record_url !== "string" || !pp.conduct_record_url) {
        r.refuse("missing_field", tag + ".conduct_record_url is required");
      }
    }
    const role = pp.role;
    if (!ROLES.includes(role)) {
      r.refuse("bad_role", tag + ".role must be one of " + ROLES.join(", ")
        + ", found " + pyRepr(role === undefined ? null : role));
    }
  }

  const roles = parties.filter(isObj).map((x) => (x.role === undefined ? null : x.role));
  let payer = null, payee = null;
  if (doms.length === 2) {
    const [a, b] = doms;
    if (a === b) {
      r.refuse("self_agreement", "both parties are " + a + "; one party cannot agree with itself");
    } else if (underDomain(a, b) || underDomain(b, a)) {
      r.refuse("self_agreement", a + " and " + b + " are the same domain, one a subdomain of the other");
    } else if (parentTwo(a) === parentTwo(b)) {
      r.find("shared_parent_domain", a + " and " + b + " share the parent " + parentTwo(a)
        + "; this verifier does not resolve registrable domains offline (no public suffix list) and does not refuse on that alone");
    }
    if (roles.length === 2 && roles.every((x) => ROLES.includes(x))) {
      const sorted = roles.slice().sort(cmpCodePoints);
      if (sorted[0] === "payee" && sorted[1] === "payer") {
        payer = doms[roles.indexOf("payer")];
        payee = doms[roles.indexOf("payee")];
      } else if (!(roles[0] === "peer" && roles[1] === "peer")) {
        r.refuse("roles_inconsistent", "roles must be payer with payee, or peer with peer, found "
          + roles.map(pyStrOf).join(" and "));
      }
    }
  }
  if (pubs.length === 2 && pubs[0] === pubs[1]) {
    r.refuse("same_public_key", "both parties present the same public key; two domains holding one key is one party wearing two names");
  }

  // 6b. 誰の conduct が刺さっとるか (v1 が二通りに訊いとった事を v1.1 は一通りで訊く)
  if (strict && doms.length === 2 && parties.length === 2) {
    for (let i = 0; i < parties.length; i++) {
      const pp = parties[i];
      if (!isObj(pp)) continue;
      const cr = pp.conduct_record;
      if (!isObj(cr)) continue;
      const mine = normDomain(pp.domain);
      const other = (doms.length === 2 && mine === doms[i]) ? doms[1 - i] : null;
      const subj = normDomain(cr.subject_domain);
      const meas = normDomain(cr.measured_by_domain);
      if (subj && other && !underDomain(subj, other)) {
        r.refuse("conduct_subject_wrong", "parties[" + i + "] presented a conduct record about " + subj
          + "; each party pins the COUNTERPARTY's conduct, so the subject must be " + other + " or a host under it");
      }
      if (meas && mine && (underDomain(meas, mine) || (other && underDomain(meas, other)))) {
        if (cr.self_measured === true) {
          r.find("conduct_self_measured", "parties[" + i + "] pins a conduct record written by " + meas
            + ", which is one of the two parties; declared, so it is recorded rather than refused, and this record does not establish that the conduct was measured by anybody other than the parties");
        } else {
          r.refuse("conduct_self_measured_undeclared", "parties[" + i + "] pins a conduct record written by " + meas
            + ", which is one of the two parties. A party measuring itself or its counterparty is permitted only when the record says so (conduct_record.self_measured true), because it changes what the record proves");
        }
      }
    }
    const shas = parties.map((pp) => {
      const cr = isObj(pp) ? pp.conduct_record : null;
      return isObj(cr) ? (cr.sha256 === undefined ? null : cr.sha256) : null;
    });
    if (shas.length === 2 && shas[0] && shas[0] === shas[1]) {
      r.find("same_conduct_record", "both parties presented the same conduct record "
        + [...pyStrOf(shas[0])].slice(0, 12).join("") + "; the point of the field is one record per side");
    }
  } else if (!strict && parties.length === 2) {
    const shas = parties.filter(isObj).map((pp) => (pp.conduct_record_sha256 === undefined ? null : pp.conduct_record_sha256));
    if (shas.length === 2 && shas[0] && shas[0] === shas[1]) {
      r.find("same_conduct_record", "both parties presented the same conduct record "
        + [...pyStrOf(shas[0])].slice(0, 12).join("")
        + "; the point of the field is the counterparty's conduct as written by somebody other than the party presenting it");
    }
  }

  // 7. terms: 有るか、形は合うとるか、だけ。中身はこの層の誰も judge せん。
  const terms = record.terms;
  if (!isObj(terms)) {
    r.refuse("missing_field", "terms must be an object");
  } else if (strict) {
    if (typeof terms.what !== "string" || !terms.what) r.refuse("missing_field", "terms.what is required");
    if (!hostOfHttps(terms.disclosure_url)) r.refuse("missing_field", "terms.disclosure_url must be an https URL");
    const cons = terms.consideration;
    if (cons !== "money" && cons !== "none") {
      r.refuse("bad_consideration", 'terms.consideration must be "money" or "none"; an agreement with no price must say it has none rather than leave the fields out and let a reader guess');
    }
    const moneyHere = ["currency", "amount_minor_units", "minor_unit_scale", "fee_basis"]
      .filter((k) => terms[k] !== null && terms[k] !== undefined);
    const wpw = terms.who_pays_whom;
    if (cons === "money") {
      if (!(payer && payee)) {
        r.refuse("terms_contradict_roles", "consideration is money, so the two roles must be payer and payee");
      }
      const cur = terms.currency;
      if (!(typeof cur === "string" && pyFullMatch("[A-Z]{3}", cur))) {
        r.refuse("bad_currency", "terms.currency must be three upper case letters (ISO 4217), found "
          + pyRepr(cur === undefined ? null : cur));
      }
      const amt = terms.amount_minor_units;
      const scale = terms.minor_unit_scale;
      if ((amt === null || amt === undefined) && !pyTruthy(terms.fee_basis)) {
        r.refuse("missing_field", "terms needs amount_minor_units or fee_basis");
      }
      if (amt !== null && amt !== undefined) {
        if (typeof amt !== "bigint" || amt < 0n) {
          r.refuse("bad_amount", "terms.amount_minor_units must be a non negative integer in the currency's minor units; a price written as a double is a price two runtimes print differently");
        }
        if (typeof scale !== "bigint" || !(scale >= 0n && scale <= 4n)) {
          r.refuse("bad_amount", "terms.minor_unit_scale must be an integer 0 to 4; without it 100 is both one hundred yen and one yen");
        }
      }
      if (!isObj(wpw) || (payer && payee && (normDomain(wpw.from) !== payer || normDomain(wpw.to) !== payee))) {
        r.refuse("terms_contradict_roles", "terms.who_pays_whom must be {from: " + pyStrOf(payer)
          + ", to: " + pyStrOf(payee) + "} to match the roles; prose that disagrees with the roles is two records in one");
      }
    } else if (cons === "none") {
      if (!(roles.length === 2 && roles[0] === "peer" && roles[1] === "peer")) {
        r.refuse("terms_contradict_roles", "consideration is none, so neither party is a payer; both roles must be peer");
      }
      if (moneyHere.length) {
        r.refuse("terms_contradict_roles", "consideration is none, and terms still carries "
          + moneyHere.join(", ") + ". A record may not say both");
      }
      if (wpw !== null && wpw !== undefined) {
        r.refuse("terms_contradict_roles", "consideration is none names no payer, so terms.who_pays_whom must be absent");
      }
    }
  } else {
    for (const req of ["what", "who_pays_whom", "currency", "disclosure_url"]) {
      if (typeof terms[req] !== "string" || !terms[req]) r.refuse("missing_field", "terms." + req + " is required");
    }
    if ((terms.amount === null || terms.amount === undefined) && !pyTruthy(terms.fee_basis)) {
      r.refuse("missing_field", "terms needs amount or fee_basis");
    }
  }

  // 8. 記録の代金は誰が払うたか、誰が記録したか
  let fee = null;
  if (strict) {
    const rec = record.recorder;
    if (!isObj(rec)) {
      r.refuse("bad_recorder", "recorder is required under v1.1: {domain, is_a_party, fee}. A record whose recorder is unnamed cannot be checked for an interest in what it records");
    } else {
      const rdom = normDomain(rec.domain);
      if (!rdom) r.refuse("bad_recorder", "recorder.domain must be a bare hostname");
      const isParty = rec.is_a_party;
      if (typeof isParty !== "boolean") r.refuse("bad_recorder", "recorder.is_a_party must be true or false");
      const actually = !!rdom && doms.some((d) => underDomain(rdom, d) || underDomain(d, rdom));
      if (typeof isParty === "boolean" && actually !== isParty) {
        r.refuse("recorder_undisclosed", "recorder.is_a_party says " + (isParty ? "true" : "false")
          + ", but recorder.domain " + rdom + " " + (actually ? "is" : "is not")
          + " one of the parties. A recorder that is also a party has an interest in what it records, and that belongs in the signed bytes");
      }
      if (actually && isParty === true) {
        r.find("operator_is_a_party", "the recorder " + rdom
          + " is a party to this agreement; declared inside the signed bytes, so a reader sees it without trusting a policy page");
      }
      fee = rec.fee === undefined ? null : rec.fee;
      if (!isObj(fee) || typeof fee.basis !== "string") {
        r.refuse("bad_recorder", "recorder.fee must be an object with a basis");
      }
    }
  } else {
    fee = record.recorder_fee === undefined ? null : record.recorder_fee;
  }

  if (isObj(fee) && typeof fee.basis === "string") {
    const basis = fee.basis;
    if (FEE_BASES_BAD.includes(basis)) {
      r.refuse("fee_tied_to_outcome", "the recorder fee basis " + pyRepr(basis)
        + " varies with the deal; the recorder must not be paid more when the number is bigger");
    } else if (!FEE_BASES_OK.includes(basis)) {
      r.refuse("fee_tied_to_outcome", "the recorder fee basis " + pyRepr(basis)
        + " is not one of the bases that are independent of the deal (" + FEE_BASES_OK.join(", ") + ")");
    } else if (basis === "none"
        && !(fee.amount_minor_units === null || fee.amount_minor_units === undefined || fee.amount_minor_units === 0n)
        && !(fee.amount === null || fee.amount === undefined || fee.amount === 0n)) {
      r.refuse("bad_recorder", "a fee basis of none may not carry an amount");
    }
  } else if (fee !== null && fee !== undefined && !isObj(fee)) {
    r.refuse("missing_field", "the recorder fee must be an object with a basis");
  }

  const paid = record.record_paid_by;
  if (strict) {
    if (!(PAID_BY_WORDS.includes(paid) || (typeof paid === "string" && doms.includes(normDomain(paid))))) {
      r.refuse("bad_record_paid_by", "record_paid_by must name a party's domain or be one of "
        + PAID_BY_WORDS.join(", ") + ", found " + pyRepr(paid === undefined ? null : paid)
        + "; v1's party_a and party_b are positions in an array, and reordering the array reverses who paid");
    }
  } else {
    if (!PAID_BY_V1.includes(paid)) {
      r.refuse("bad_record_paid_by", "record_paid_by must be one of " + PAID_BY_V1.join(", ")
        + ", found " + pyRepr(paid === undefined ? null : paid));
    } else if (paid === "party_a" || paid === "party_b") {
      r.find("paid_by_positional", "record_paid_by names a position in the parties array, so a reader that reorders parties silently reverses who paid; naming the domain would not have that property");
    }
  }

  if (record.upstream !== null && record.upstream !== undefined) {
    const u = record.upstream;
    if (!isObj(u) || typeof u.protocol !== "string" || typeof u.reference !== "string") {
      r.refuse("missing_field", "upstream, when present, must be {protocol, reference}");
    } else {
      r.find("upstream_unverified", "upstream names " + u.protocol + " " + u.reference
        + " as declared; nothing in this layer checked it");
    }
  }

  // 9. 記録が「これを証す」と言うとる中身
  const est = record.establishes, dne = record.does_not_establish;
  const okArr = (x) => Array.isArray(x) && x.length > 0
    && x.every((v) => typeof v === "string" && pyStrip(v) !== "");
  if (!okArr(est) || !okArr(dne)) {
    r.refuse("disclaimer_missing", "establishes and does_not_establish are both required and neither may be empty");
  } else {
    const blob = est.join(" ").toLowerCase();
    for (const [re2, what] of OVERCLAIM) {
      if (re2.test(blob)) {
        r.refuse("establishes_overclaims", "establishes claims " + what
          + "; this record proves that two keys signed the same bytes at a time bounded from above by a Bitcoin block, and nothing more");
        break;
      }
    }
    const low = dne.join(" ").toLowerCase();
    if (strict) {
      const missing = REQUIRED_DNE.filter(([, needles]) => !needles.some((n) => low.includes(n))).map(([name]) => name);
      if (missing.length) r.refuse("disclaimer_incomplete", "does_not_establish must cover: " + missing.join("; "));
    } else if (dne.length < 3 || (!low.includes("perform") && !low.includes("contract"))) {
      r.find("disclaimer_thin", "does_not_establish should say at least that neither party performed and that this is not a contract");
    }
  }

  // 10. 署名
  let sigs = record.signatures;
  if (!Array.isArray(sigs) || sigs.length < 2) {
    r.refuse("one_sided", "a record needs two signatures; found "
      + (Array.isArray(sigs) ? String(sigs.length) : "none")
      + ". A one sided receipt is not an agreement");
    sigs = Array.isArray(sigs) ? sigs : [];
  } else if (sigs.length > 2) {
    r.refuse("extra_signatures", "signatures must be exactly two, found " + sigs.length);
  }

  const sigDoms = [];
  for (let i = 0; i < sigs.length; i++) {
    const sg = sigs[i];
    const tag = "signatures[" + i + "]";
    if (!isObj(sg)) { r.refuse("bad_signature", tag + " is not an object"); continue; }
    const d = normDomain(sg.domain);
    if (!d) {
      r.refuse("bad_domain", tag + ".domain must be a bare hostname, found "
        + pyRepr(sg.domain === undefined ? null : sg.domain));
      continue;
    }
    sigDoms.push(d);
    if (sg.alg !== "ed25519") {
      r.refuse("bad_signature", tag + ".alg must be ed25519, found " + pyRepr(sg.alg === undefined ? null : sg.alg));
    }
    if (b64Raw(sg.signature, 64) === null) {
      r.refuse("bad_signature", tag + ".signature must be 64 bytes of canonical base64");
    }
    let party = null;
    for (const pp of parties) {
      if (isObj(pp) && normDomain(pp.domain) === d) { party = pp; break; }
    }
    if (party === null) {
      r.refuse("signature_not_a_party", tag + " is signed by " + d
        + ", which is not one of the two parties; two signatures are not two sides unless they are the two sides");
      continue;
    }
    const ku = sg.key_url;
    if (strict) {
      if (ku !== null && ku !== undefined) {
        r.refuse("signature_key_url_present", tag + " carries a key_url. Signatures are removed before signing, so anything in this block is outside the signed bytes and whoever holds the record can swap it. Under v1.1 the key and its URL live in the party entry");
      }
    } else if (ku !== null && ku !== undefined && typeof ku !== "string") {
      r.refuse("bad_key_url", tag + ".key_url must be a string, found " + pyTypeName(ku));
    } else if (ku !== null && ku !== undefined && ku !== party.key_url) {
      r.refuse("key_url_not_pinned", tag + ".key_url (" + pyStrOf(ku)
        + ") differs from the key_url this party pinned inside the signed bytes ("
        + pyStrOf(party.key_url === undefined ? null : party.key_url)
        + "); the signature block is outside the signed bytes and whoever holds the record could swap it");
    }
  }

  if (sigDoms.length === 2 && sigDoms[0] === sigDoms[1]) {
    r.refuse("one_sided", "both signatures are from " + sigDoms[0] + "; one side signing twice is one side");
  }

  // 11. 実際の暗号
  let checked = false;
  let urlsChecked = false;
  const perSig = [];
  if (sigs.length && (strict || pyTruthy(keys))) {
    const msg = signingBytes(record, schema);
    const results = [];
    const urlResults = [];
    for (const sg of sigs) {
      if (!isObj(sg)) continue;
      const d = normDomain(sg.domain) || "?";
      const party = parties.find((pp) => isObj(pp) && normDomain(pp.domain) === d) || null;
      let pub = null, ku = null;
      if (strict) {
        pub = isObj(party) ? (party.public_key_ed25519_b64 === undefined ? null : party.public_key_ed25519_b64) : null;
        ku = isObj(party) ? (party.key_url === undefined ? null : party.key_url) : null;
        if (keys !== null && keys !== undefined && typeof ku === "string") {
          const served = keys[ku] === undefined ? null : keys[ku];
          if (served === null) {
            r.refuse("key_url_unreachable", "no public key was supplied for " + pyStrOf(ku)
              + "; offline this means the key set handed to the verifier does not contain it, and an intake would answer 503 and retry rather than judge");
            urlResults.push(false);
          } else if (served !== pub) {
            r.refuse("key_url_mismatch", "the key served at " + pyStrOf(ku)
              + " is not the key pinned inside the signed bytes for " + d);
            urlResults.push(false);
          } else {
            urlResults.push(true);
          }
        }
      } else {
        ku = pyTruthy(sg.key_url) ? sg.key_url
        : (isObj(party) ? (party.key_url === undefined ? null : party.key_url) : null);
        if (typeof ku !== "string") ku = null;
        pub = ku ? (keys[ku] === undefined ? null : keys[ku]) : null;
        if (pub === null) {
          r.refuse("key_url_unreachable", "no public key was supplied for " + pyStrOf(ku)
            + "; offline this means the key set handed to the verifier does not contain it, and an intake would answer 503 and retry rather than judge");
          results.push(null);
          perSig.push({ domain: d, key_url: ku, result: "no_key" });
          continue;
        }
        if (isObj(party) && pyTruthy(party.key_url) && ku !== party.key_url) {
          r.refuse("key_url_mismatch", "the key checked for " + d + " was not the one pinned in the signed bytes");
        }
        urlResults.push(true);
      }
      if (typeof pub !== "string") {
        results.push(null);
        perSig.push({ domain: d, key_url: typeof ku === "string" ? ku : null, result: "no_key" });
        continue;
      }
      const ok = await ed25519Verify(pub, pyTruthy(sg.signature) ? sg.signature : "", msg);
      results.push(ok);
      perSig.push({ domain: d, key_url: typeof ku === "string" ? ku : null,
        result: ok === true ? "valid" : (ok === false ? "invalid" : "unusable") });
    }
    const decided = results.filter((x) => x !== null);
    // checked は報告書に記された証拠から**導く**。横に置いたら、いつか一覧と食い違う。
    checked = perSig.length === 2 && perSig.every((e) => e.result === "valid");
    if (decided.length) {
      if (decided.some((x) => x === true) && decided.some((x) => x === false)) {
        r.refuse("signatures_disagree", "one signature covers these bytes and the other does not; the two parties did not sign the same record");
      } else if (decided.every((x) => x === false)) {
        r.refuse("signature_invalid", "no signature on this record covers these bytes");
      } else if (decided.length < 2) {
        r.refuse("one_sided", "only one signature could be checked");
      }
    }
    if (results.some((x) => x === null)) {
      r.refuse("bad_signature", "a signature or public key could not be used");
    }
    urlsChecked = urlResults.length > 0 && urlResults.length === 2 && urlResults.every(Boolean);
  }

  if (pyTruthy(recorderDomain) && !strict) {
    const rd = normDomain(recorderDomain);
    for (const d of doms) {
      if (rd && underDomain(d, rd)) {
        r.find("operator_is_a_party", "the recorder's own domain " + rd
          + " is a party to this agreement; permitted, and disclosed here, because a recorder that is also a party has an interest in what it records");
        break;
      }
    }
  }

  void parseStrict;
  return buildReport(r, record, schema, checked, urlsChecked, perSig, inputText, can);
}
