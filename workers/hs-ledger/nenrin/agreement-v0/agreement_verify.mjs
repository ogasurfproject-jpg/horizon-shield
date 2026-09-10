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

export class Report {
  constructor() {
    this.refusals = [];
    this.findings = [];
  }
  refuse(code, why, inDraft = false) {
    this.refusals.push({ code, why, in_draft: inDraft });
  }
  find(code, why, inDraft = false) {
    this.findings.push({ code, why, in_draft: inDraft });
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
      const vs = Array.isArray(node) ? node : Object.keys(node).map((k) => node[k]);
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

  // ここから先の規則はまだ入っとらん。採点板が件数で教える。
  void keys; void recorderDomain; void parseStrict;
  return buildReport(r, record, schema, false, false, [], inputText, can);
}
