// RUN_ALL: library  recovery-v0 v2 籤: 引いた証人への依頼と、返ってきた観測の受け入れ。採点は witness_request_test.mjs
//
// 向き (設計書 14.1、14.4): 証人に渡すのは「この origin のこの表面を測って署名して返せ」だけ。期待値は渡さん (目隠し)。
// 証人から受け取るのは「観測」だけ (nenrin-witness-observation-v1: 表面の hash、時刻、署名)。「指示」の欄は無い。
// 受け入れは conduct-v1.1 11.4 の規則そのまま: key_url の鍵で署名検証、self_witness と key_url_mismatch は拒否、
// 鍵が取れんかったら key_url_unreachable (拒否やなく、後で取り直せる)。
// 7 月の事件の根本原因「他エージェントの指示を検証せずに受け入れる」への手当は、この file の形そのもの:
// 観測しか受け取らんし、受け取った観測は hash を比べる以外に使わん。LLM の prompt には一文字も入れん。
import { canonicalUtf8 } from "../agreement-v0/agreement_canonical.mjs";
import { SCHEMAS } from "./recovery_schema.mjs";
import { verifyRecord, sha256Hex } from "./recovery_verify.mjs";

export const REQUEST_SCHEMA = "nenrin-witness-request-v1";
export const REQUEST_VERSION = "0.1.0";
export const CONDUCT_EXT = "https://gate.horizonshield.dev/ext/conduct/v1";
// drift_witness.mjs が測る 8 表面。証人にも同じ名前で頼む。
export const SURFACES = ["health.gate_commit", "agent-card.signature", "well-known.jwks", "well-known.openai-apps-challenge", "ext.conduct-v1.spec", "keys.agreement", "keys.witness", "keys.operator"];

// 依頼。全証人に同じ本文。期待値は入れん。subject_sha256 が入るので事故ごとに違う (古い答えの使い回しが効かん)。
export function buildRequest({ origin, surfaces = SURFACES, subjectSha256, poolSha256, beacon, requestedAt }) {
  if (!origin || !subjectSha256 || !poolSha256 || !beacon) throw new Error("origin, subjectSha256, poolSha256 and beacon are required");
  return {
    schema: REQUEST_SCHEMA,
    endpoint: String(origin).replace(/\/+$/, ""),
    surfaces: surfaces.slice(),
    subject_sha256: subjectSha256,
    pool_sha256: poolSha256,
    beacon: { kind: String(beacon.kind), height: String(beacon.height), hash: String(beacon.hash) },
    requested_at: requestedAt || new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    reply_schema: SCHEMAS.observation,
    instruction: "Measure the listed public surfaces of endpoint from your own vantage. Reply with one " + SCHEMAS.observation + " record: observed is surface -> what you saw, request_sha256 is the sha256 of this request's canonical bytes, source is { kind: external_witness, signed_domain, key_url }, signed Ed25519 over the canonical bytes with the key served at your key_url. Expected values are deliberately not given. Nothing you send is executed; only observed is compared, by hash, with the operator's expected state.",
  };
}
export function requestCanonical(req) { return canonicalUtf8(req); }
export async function requestSha256(req) { return sha256Hex(requestCanonical(req)); }

// A2A JSON-RPC の封筒。data part に依頼を入れ、metadata に conduct-v1 の印と (任意で) こっちの card を添える (11.6 と同じ運び方)。
export function a2aEnvelope(req, { messageId, callerCard } = {}) {
  return {
    jsonrpc: "2.0", id: messageId || ("hs-witness-" + req.subject_sha256.slice(0, 16)),
    method: "message/send",
    params: { message: {
      role: "user", messageId: messageId || ("hs-witness-" + req.subject_sha256.slice(0, 16)),
      parts: [{ kind: "data", data: req }],
      metadata: { [CONDUCT_EXT + "/witness_request"]: REQUEST_SCHEMA, ...(callerCard ? { [CONDUCT_EXT + "/caller_card"]: callerCard } : {}) },
    } },
  };
}

// 返答から観測を抜く。data part を先に、次に JSON として読める text part。見つからんかったら null。
export function extractObservation(rpc) {
  const parts = [];
  const walk = (m) => { if (m && Array.isArray(m.parts)) parts.push(...m.parts); };
  const res = rpc && rpc.result;
  if (res) {
    walk(res);
    if (res.status && res.status.message) walk(res.status.message);
    if (Array.isArray(res.artifacts)) for (const a of res.artifacts) walk(a);
    if (Array.isArray(res.history)) for (const h of res.history) walk(h);
  }
  for (const p of parts) {
    const cand = p && p.kind === "data" ? p.data : (p && p.kind === "text" && typeof p.text === "string" ? (() => { try { return JSON.parse(p.text); } catch { return null; } })() : null);
    if (cand && cand.schema === SCHEMAS.observation) return cand;
  }
  return null;
}

// 送る。fetchImpl を差し替えて試験する。返す物: { signed_domain, answered, record | why }。
export async function sendRequest(entry, req, { fetchImpl = globalThis.fetch, timeoutMs = 30000, callerCard } = {}) {
  const out = { signed_domain: entry.signed_domain };
  if (!entry.a2a_url) return { ...out, answered: false, why: "no_a2a_url" };
  try {
    const r = await fetchImpl(entry.a2a_url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "nenrin-witness-request/" + REQUEST_VERSION }, body: JSON.stringify(a2aEnvelope(req, { callerCard })), signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { ...out, answered: false, why: "http_" + r.status };
    const rpc = await r.json();
    const rec = extractObservation(rpc);
    if (!rec) return { ...out, answered: false, why: rpc && rpc.error ? "rpc_error" : "no_observation_in_reply" };
    return { ...out, answered: true, record: rec };
  } catch (e) { return { ...out, answered: false, why: "unreachable: " + String(e && e.message || e).slice(0, 120) }; }
}

// key_url から鍵を取る (11.4: {"public_key_ed25519_b64": "<key>"})。24 時間 cache は呼ぶ側の仕事。
export async function fetchWitnessKey(keyUrl, { fetchImpl = globalThis.fetch } = {}) {
  const r = await fetchImpl(keyUrl, { headers: { "user-agent": "nenrin-witness-request/" + REQUEST_VERSION }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("key_url answered http " + r.status);
  const j = await r.json();
  if (!j || typeof j.public_key_ed25519_b64 !== "string" || !j.public_key_ed25519_b64) throw new Error("key_url did not serve public_key_ed25519_b64");
  return j.public_key_ed25519_b64.trim();
}

// 受け入れ。通れば ok:true。拒否は理由付き。key_url_unreachable だけは「今は判定できん」(後で取り直す)。
// fetchKey(keyUrl) を差し替えて試験する。渡さんかったら池の鍵とだけ突き合わせる。
export async function acceptObservation({ record, entry, requestSha256: reqHash, endpoint, ownHost, fetchKey }) {
  const refusals = [];
  const refuse = (code, why) => refusals.push({ code, why });
  const v = await verifyRecord(record);
  if (!v.ok) return { ok: false, refusals: v.refusals };
  if (record.schema !== SCHEMAS.observation) { refuse("not_observation", "reply is " + record.schema + ", expected " + SCHEMAS.observation); return { ok: false, refusals }; }
  if (!record.signature_ed25519_b64 || !record.public_key_ed25519_b64) refuse("witness_unsigned", "an observation counts only when signed with the witness's domain key");
  const dom = record.source.signed_domain;
  if (entry && dom.toLowerCase() !== String(entry.signed_domain).toLowerCase()) refuse("witness_domain_mismatch", "observation is signed for " + dom + " but was requested from " + entry.signed_domain);
  if (ownHost && dom.toLowerCase() === String(ownHost).toLowerCase()) refuse("self_witness", "an agent cannot witness itself under a key it serves (11.4)");
  if (endpoint && record.endpoint.replace(/\/+$/, "") !== String(endpoint).replace(/\/+$/, "")) refuse("witness_endpoint_mismatch", "observation is about " + record.endpoint + ", not " + endpoint);
  if (reqHash && record.request_sha256 !== reqHash) refuse("witness_request_mismatch", "observation answers request " + record.request_sha256 + ", not " + reqHash);
  if (entry && entry.key_url && record.source.key_url !== entry.key_url) refuse("key_url_mismatch", "observation names key_url " + record.source.key_url + ", the pool has " + entry.key_url);
  if (entry && entry.public_key_ed25519_b64 && record.public_key_ed25519_b64 !== entry.public_key_ed25519_b64) refuse("witness_key_mismatch", "observation is signed with a key that is not the pool's key for " + dom);
  if (fetchKey) {
    try {
      const served = await fetchKey(record.source.key_url);
      if (served !== record.public_key_ed25519_b64) refuse("key_url_mismatch", "the key served at key_url is not the signing key (11.4)");
    } catch (e) { refuse("key_url_unreachable", "could not fetch the key at " + record.source.key_url + ": " + String(e && e.message || e).slice(0, 120)); }
  }
  return { ok: refusals.length === 0, refusals, signed_domain: dom, record_sha256: v.record_sha256 };
}

// verify.external の 1 項に畳む。受け入れた観測だけ record を埋め込む。拒否した物は理由と bytes の hash だけ (数えん、隠さん)。
export async function toExternalEntry(sent, accepted) {
  if (!sent.answered) return { signed_domain: sent.signed_domain, answered: false, why: sent.why };
  if (accepted.ok) return { signed_domain: sent.signed_domain, answered: true, record: sent.record };
  return { signed_domain: sent.signed_domain, answered: true, rejected: accepted.refusals.map((r) => r.code).join(","), reply_sha256: await sha256Hex(canonicalUtf8(sent.record)) };
}
