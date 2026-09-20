// RUN_ALL: library  recovery-v0 の検証器。採点は recovery_verify_test.mjs
//
// 何を検証するか:
//   1 記録:  型 (recovery_schema) / record_sha256 の再計算 / (在れば) Ed25519 署名
//   連鎖:    drift+ → proposal → authorization → execution → verify の順、prev の鎖、参照 hash の実値、
//            許可されとらん実行の拒否、提案と実行のプリミティブ一致、提案と再検証の expected_after 一致
//
// canonical bytes は agreement_canonical.canonicalUtf8 をそのまま使う (witness intake と同じ、ensure_ascii=False)。
// 二本立てにせん。hash は record_sha256 と署名 2 欄を除いた canonical bytes に対して取る。
// 非同期な理由は agreement_verify.mjs と同じ: sha256 も Ed25519 も WebCrypto。Worker に同期の口が無い。
import { canonicalUtf8 } from "../agreement-v0/agreement_canonical.mjs";
import { validate, SCHEMAS, PRIMITIVES } from "./recovery_schema.mjs";

export const VERIFIER_VERSION = "0.2.0"; // v1: cryptographic Policy Gate (signed operator authorization)
const enc = new TextEncoder();

export async function sha256Hex(bytes) {
  const b = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  const d = await globalThis.crypto.subtle.digest("SHA-256", b);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// hash と署名の対象: 自分の hash と署名 2 欄を除いた本体。
export function hashedBody(record) {
  const { record_sha256, signature_ed25519_b64, public_key_ed25519_b64, ...rest } = record;
  return rest;
}
export function canonicalText(record) { return canonicalUtf8(hashedBody(record)); }
export function canonicalBytes(record) { return enc.encode(canonicalText(record)); }
export async function recordSha256(record) { return sha256Hex(canonicalBytes(record)); }

// 本体に record_sha256 を焼く。既にある hash と署名は捨てて計算し直す (古い hash を引き継がん)。
export async function seal(record) {
  const r = { ...hashedBody(record) };
  r.record_sha256 = await recordSha256(r);
  return r;
}

const b64ToBytes = (s) => Uint8Array.from(Buffer.from(s, "base64"));
const bytesToB64 = (b) => Buffer.from(b).toString("base64");

// Ed25519 (witness intake と同じ欄名): canonical bytes への署名。
export async function verifySignature(record) {
  const sig = record.signature_ed25519_b64, pub = record.public_key_ed25519_b64;
  if (!sig || !pub) return { ok: false, why: "signature_ed25519_b64 and public_key_ed25519_b64 must both be present" };
  try {
    const key = await globalThis.crypto.subtle.importKey("raw", b64ToBytes(pub), { name: "Ed25519" }, false, ["verify"]);
    const ok = await globalThis.crypto.subtle.verify({ name: "Ed25519" }, key, b64ToBytes(sig), canonicalBytes(record));
    return ok ? { ok: true } : { ok: false, why: "Ed25519 signature does not verify over the canonical bytes" };
  } catch (e) {
    return { ok: false, why: "signature check failed: " + (e && e.message || e) };
  }
}

// 署名して返す。privateKey は WebCrypto の CryptoKey (Ed25519, sign)、publicKeyRaw は 32 バイト。
export async function sign(record, privateKey, publicKeyRaw) {
  const r = await seal(record);
  const sig = await globalThis.crypto.subtle.sign({ name: "Ed25519" }, privateKey, canonicalBytes(r));
  return { ...r, signature_ed25519_b64: bytesToB64(sig), public_key_ed25519_b64: bytesToB64(publicKeyRaw) };
}

// 1 記録の検証。
export async function verifyRecord(record) {
  const refusals = validate(record);
  if (refusals.length) return { ok: false, refusals };
  const h = await recordSha256(record);
  if (record.record_sha256 !== undefined && record.record_sha256 !== h) {
    return { ok: false, refusals: [{ code: "hash_mismatch", why: "record_sha256 does not recompute: carried " + record.record_sha256 + ", computed " + h }] };
  }
  if (record.signature_ed25519_b64 !== undefined || record.public_key_ed25519_b64 !== undefined) {
    const s = await verifySignature(record);
    if (!s.ok) return { ok: false, refusals: [{ code: "bad_signature", why: s.why }] };
  }
  return { ok: true, refusals: [], record_sha256: h };
}

// 連鎖 (1 事故 = 1 区間) の検証。records は記録順。
// opts.operatorKeys: 運営者の公開鍵 (base64 raw Ed25519) の配列。渡すと strict モード (v1):
//   人間承認プリミティブ (approval: human) の実行は、その許可が運営者鍵で署名され、かつ鍵が信用集合に在ることを要求する。
//   渡さんと lenient (v0 互換): decision: approved だけで通す。既存の記録を割らんため。
export async function verifyChain(records, opts = {}) {
  const operatorKeys = Array.isArray(opts.operatorKeys) ? opts.operatorKeys : null;
  const refusals = [];
  const refuse = (code, why) => refusals.push({ code, why });
  if (!Array.isArray(records) || records.length === 0) { refuse("empty_chain", "no records"); return { ok: false, refusals }; }

  const hashes = [];
  for (let i = 0; i < records.length; i++) {
    const v = await verifyRecord(records[i]);
    if (!v.ok) { for (const x of v.refusals) refuse(x.code, "record[" + i + "] (" + (records[i] && records[i].schema) + "): " + x.why); return { ok: false, refusals }; }
    hashes.push(v.record_sha256);
  }

  let i = 0; const drifts = [];
  while (i < records.length && records[i].schema === SCHEMAS.drift) { drifts.push(hashes[i]); i++; }
  if (drifts.length === 0) { refuse("no_drift", "a segment starts with at least one drift record"); return { ok: false, refusals }; }

  const rest = records.slice(i);
  const expect = [SCHEMAS.proposal, SCHEMAS.authorization, SCHEMAS.execution, SCHEMAS.verify];
  if (rest.length > expect.length) refuse("bad_order", "more than " + expect.length + " records after the drift records");
  for (let k = 0; k < Math.min(rest.length, expect.length); k++) {
    if (rest[k].schema !== expect[k]) refuse("bad_order", "record[" + (i + k) + "] is " + rest[k].schema + ", expected " + expect[k]);
  }
  if (refusals.length) return { ok: false, refusals };

  for (let k = i; k < records.length; k++) {
    if (records[k].prev !== hashes[k - 1]) refuse("chain_broken", "record[" + k + "].prev " + records[k].prev + " != previous record_sha256 " + hashes[k - 1]);
  }
  const [proposal, authorization, execution, verify] = rest;
  if (proposal) for (const h of proposal.drift_sha256) if (!drifts.includes(h)) refuse("unknown_drift", "proposal cites drift " + h + " that is not in this segment");
  if (authorization && authorization.proposal_sha256 !== hashes[i]) refuse("ref_mismatch", "authorization.proposal_sha256 != proposal record_sha256");
  if (execution && execution.authorization_sha256 !== hashes[i + 1]) refuse("ref_mismatch", "execution.authorization_sha256 != authorization record_sha256");
  if (verify && verify.execution_sha256 !== hashes[i + 2]) refuse("ref_mismatch", "verify.execution_sha256 != execution record_sha256");
  if (authorization && execution && authorization.decision !== "approved") refuse("unauthorized_execution", "execution follows an authorization whose decision is " + authorization.decision);
  if (execution) {
    const prim = execution.primitive;
    const needsHuman = !!(PRIMITIVES[prim] && PRIMITIVES[prim].approval === "human");
    if (needsHuman && operatorKeys) {
      if (!authorization) refuse("unauthorized_execution", "human-approval primitive " + prim + " executed with no authorization");
      else {
        const signed = !!(authorization.signature_ed25519_b64 && authorization.public_key_ed25519_b64);
        if (!signed) refuse("authorization_unsigned", "human-approval primitive " + prim + " follows an authorization not signed by an operator key");
        else if (!operatorKeys.includes(authorization.public_key_ed25519_b64)) refuse("authorization_untrusted_key", "authorization signed by a key not in the operator trust set");
      }
    }
    if (authorization && authorization.expires_at && execution.recorded_at > authorization.expires_at) refuse("authorization_expired", "execution.recorded_at " + execution.recorded_at + " is after authorization.expires_at " + authorization.expires_at);
  }
  if (proposal && execution && proposal.primitive !== execution.primitive) refuse("primitive_mismatch", "execution.primitive " + execution.primitive + " != proposal.primitive " + proposal.primitive);
  if (proposal && verify && canonicalUtf8(proposal.expected_after) !== canonicalUtf8(verify.expected_after)) refuse("expected_after_drift", "verify.expected_after differs from proposal.expected_after: the target moved after authorization");
  if (verify && verify.recovered === true) {
    // recovered:true を名乗るなら、observed が expected_after の全 surface を持っとらなあかん
    for (const k of Object.keys(verify.expected_after)) if (!(k in verify.observed)) refuse("recovered_unobserved", "recovered is true but observed has no entry for surface " + k);
  }
  return { ok: refusals.length === 0, refusals, segment: { drifts, hashes, complete: rest.length === 4 } };
}
