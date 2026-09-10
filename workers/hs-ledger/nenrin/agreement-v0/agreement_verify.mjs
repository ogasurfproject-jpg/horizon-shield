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
import { canonicalUtf8, parseStrict } from "./agreement_canonical.mjs";

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

export function schemaOf(record) {
  const s = record && typeof record === "object" && !Array.isArray(record) ? record.schema : null;
  return SCHEMAS.includes(s) ? s : null;
}

// 骨。規則はまだ 1 本も無い。計算できる鍵だけ埋めて、あとは空で返す。
// 空で返すこと自体は嘘やない。嘘になるんは、これを「合格」と呼んだときや。
export async function verify(record, opts = {}) {
  const { keys = null, recorderDomain = null, now = null, inputText = null } = opts;
  const r = new Report();
  const schema = schemaOf(record);

  const canonical = (() => {
    try {
      return canonicalUtf8(record);
    } catch {
      return null;
    }
  })();

  const report = {
    schema: REPORT_SCHEMA,
    verifier_version: VERIFIER_VERSION,
    verdict: "refused",
    record_schema: schema,
    draft: null,
    signatures_checked: false,
    key_urls_checked: false,
    refusals: r.refusals,
    findings: r.findings,
    signatures: [],
    establishes: [],
    does_not_establish: [],
    input_sha256: inputText === null ? null : await sha256Hex(inputText),
    canonical_sha256: canonical === null ? null : await sha256Hex(canonical),
    signing_sha256: null,
    input_is_canonical: inputText === null ? null : inputText === canonical,
  };
  void keys; void recorderDomain; void now; void parseStrict;
  return report;
}
