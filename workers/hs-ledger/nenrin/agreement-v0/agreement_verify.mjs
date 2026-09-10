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
import { canonicalUtf8, num, parseStrict } from "./agreement_canonical.mjs";

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

// 当事者が署名するバイト: signatures を抜いた記録の canonical に、schema の前置きを付けた物。
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
export async function verify(record, opts = {}) {
  const { keys = null, recorderDomain = null, now = null, inputText = null } = opts;
  const r = new Report();
  const schema = schemaOf(record);
  const can = (() => { try { return canonicalUtf8(record); } catch { return null; } })();

  // 規則はまだ入っとらん。土台 (_report と _early) だけ本物にした。
  // 骨のままの所は、採点板が件数で教える。
  if (can === null) {
    return early(r, inputText === null ? null : await sha256Hex(inputText), [], DNE_BASE.slice());
  }
  void keys; void recorderDomain; void now; void parseStrict;
  return buildReport(r, record, schema, false, false, [], inputText, can);
}
