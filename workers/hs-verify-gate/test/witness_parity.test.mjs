// witness_parity: src/witness.js (Worker-native) が、recovery-v0 の Node 参照と 1 バイト違わん物を出すことを守る。
// ここが割れたら、扉が署名して返す観測が TSUGI の検証器 (recovery_verify) で verify せんようになる。
// 走らせ方: node test/witness_parity.test.mjs   (Node で回す。参照は node: を使うが試験は Node やから読める)
import * as W from "../src/witness.js";
import { canonicalUtf8 as refCanonical } from "../../hs-ledger/nenrin/agreement-v0/agreement_canonical.mjs";
import { answerRequest as refAnswer } from "../../hs-ledger/nenrin/recovery-v0/witness_reply.mjs";
import { verifyRecord } from "../../hs-ledger/nenrin/recovery-v0/recovery_verify.mjs";

let pass = 0, fail = 0; const out = [];
const t = (name, ok, detail) => { ok ? pass++ : fail++; out.push((ok ? "  ok   " : "  NG   ") + name + (ok || !detail ? "" : "  <<< " + detail)); };

// A. canonical の写しが本物と一致するか (記録層は ensure_ascii=False)
const canonCases = [
  { a: 1, b: "x" }, { z: [1, 2, 3], a: null }, { "é": "日本", emoji: "😀" },
  { nested: { b: { c: "d" }, a: [] }, s: "quote\"and\\back" }, { ctrl: "tab\tnl\nreturn\r" },
  { surfaces: ["health.gate_commit", "well-known.did"], k: "" }, { "😀key": 1, akey: 2 },
];
for (const c of canonCases) t("canonical matches ref: " + JSON.stringify(c).slice(0, 40), W.canonicalUtf8(c) === refCanonical(c), "gate " + W.canonicalUtf8(c) + " ref " + refCanonical(c));

// B. 署名付き観測が byte 一致するか。同じ依頼・同じ観測・同じ鍵・同じ時刻を両方に渡す。
const key = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const pubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey));
const signedDomain = "gate.horizonshield.dev";
const keyUrl = "https://gate.horizonshield.dev/keys/witness.json";
const vantage = "gate.horizonshield.dev (cloudflare edge, " + signedDomain + ")";
const target = "https://other-gate.dev";
const req = {
  schema: "nenrin-witness-request-v1", endpoint: target,
  surfaces: ["health.gate_commit", "agent-card.signature", "well-known.did", "some.surface.this.witness.does.not.measure"],
  subject_sha256: "a".repeat(64), pool_sha256: "b".repeat(64),
  beacon: { kind: "bitcoin", height: "900000", hash: "c".repeat(64) },
  requested_at: "2026-09-20T16:00:00Z", reply_schema: "nenrin-witness-observation-v1",
  instruction: "Measure the listed public surfaces of endpoint from your own vantage.",
};
const observedFixed = {
  "health.gate_commit": { status: "200", gate_commit: "deadbeef1234", gate_version: "0.4.14" },
  "agent-card.signature": { status: "200", verified: "true", canonical_sha256: "f".repeat(64), kid: "k1", alg: "ES256", jku: "https://other-gate.dev/.well-known/jwks.json", signatures: "1" },
  "well-known.did": { status: "200", present: "true", id: "did:web:other-gate.dev", kids: "k1", did_sha256: "e".repeat(64) },
};
// witness.js の measure は folded observed を直接返す。Node 参照の measure は records 配列を返す (foldObserved が畳む)。
const measureWorker = async () => observedFixed;
const measureRef = async () => Object.entries(observedFixed).map(([surface, observed]) => ({ schema: "nenrin-drift-witness-v1", surface, observed }));

// 時刻を固定 (両方の内部 now() を同じ文字列に)。
const RealDate = Date; const FIXED = "2026-09-20T16:00:00.000Z";
globalThis.Date = class extends RealDate { constructor(...a) { super(a.length ? a[0] : FIXED); } toISOString() { return FIXED; } static now() { return new RealDate(FIXED).getTime(); } };
let wr, rr;
try {
  wr = await W.answerWitnessRequest(req, { signedDomain, keyUrl, priv: key.privateKey, pubRaw, measure: measureWorker });
  // 参照は名前を引いて番地を篩う段 (witness_ssrf_guard) を持つ。Worker にその段は無い (Cloudflare の fetch は内側に route せん、platform の性質)。
  // 両側に同じ入力を見せるため、ここでは参照の事前確認を resolver: null で外す。番地の篩そのものは witness_ssrf_guard_test で採点する。
  rr = await refAnswer(req, { signedDomain, keyUrl, priv: key.privateKey, pubRaw, measure: measureRef, resolver: null, vantage });
} finally { globalThis.Date = RealDate; }

t("worker answered", wr.answered, JSON.stringify(wr).slice(0, 120));
t("ref answered", rr.answered, JSON.stringify(rr).slice(0, 120));
const wc = W.canonicalUtf8(wr.record), rc = refCanonical(rr.record);
t("signed observation is byte-identical to the Node reference", wc === rc, "\n    gate: " + wc + "\n    ref : " + rc);
t("worker record_sha256 == ref record_sha256", wr.record && rr.record && wr.record.record_sha256 === rr.record.record_sha256, (wr.record||{}).record_sha256 + " vs " + (rr.record||{}).record_sha256);
t("worker signature == ref signature", (wr.record||{}).signature_ed25519_b64 === (rr.record||{}).signature_ed25519_b64);
// C. 本物の検証器 (recovery_verify) が扉の観測を通すか
const v = await verifyRecord(wr.record);
t("the gate's observation verifies under recovery_verify (schema + record_sha256 + Ed25519)", v.ok, JSON.stringify(v.refusals || []));
t("unknown surface is disclosed in does_not_establish", (wr.record.does_not_establish || []).some((x) => /does not measure/.test(x)));
t("known surfaces only in observed (unknown dropped)", Object.keys(wr.record.observed).length === 3 && !wr.record.observed["some.surface.this.witness.does.not.measure"]);

// D. 断り: self_witness / bad_request / target_not_public が参照と同じ判定
const selfReq = { ...req, endpoint: "https://gate.horizonshield.dev/a2a" };
const ws = await W.answerWitnessRequest(selfReq, { signedDomain, keyUrl, priv: key.privateKey, pubRaw, measure: measureWorker });
const rs = await refAnswer(selfReq, { signedDomain, keyUrl, priv: key.privateKey, pubRaw, measure: measureRef, vantage });
t("self_witness declined (both)", !ws.answered && ws.declined === "self_witness" && !rs.answered && rs.declined === "self_witness", JSON.stringify(ws) + " | " + JSON.stringify(rs));
const badReq = { ...req, subject_sha256: "nope" };
const wb = await W.answerWitnessRequest(badReq, { signedDomain, keyUrl, priv: key.privateKey, pubRaw, measure: measureWorker });
t("bad_request declined", !wb.answered && wb.declined === "bad_request", JSON.stringify(wb));
const privReq = { ...req, endpoint: "https://localhost" };
const wp = await W.answerWitnessRequest(privReq, { signedDomain, keyUrl, priv: key.privateKey, pubRaw, measure: measureWorker });
t("target_not_public declined (localhost)", !wp.answered && wp.declined === "target_not_public", JSON.stringify(wp));

console.log(out.join("\n"));
console.log("=== " + pass + " / " + (pass + fail) + " 合格 (witness parity: src/witness.js == Node 参照) ===");
if (fail) process.exit(1);
