// refund_door_v0.mjs: the admission door of the bounded refund sandbox (aeoess/agent-governance-vocabulary#193,
// contract revision review-2026-10-23), hs-refund-admission-profile/0.1. What the door decides, without Cloudflare in it.
//
// The door takes the eleven retained input files of one case, the runner's run_id and the consumption instant, and:
//   1. runs the public aps-receipt adapter (steps 0 to 8: the native APS and PIC checks, over the pinned APS SDK);
//   2. applies step 9: the refund amount against grant.limits of the sandbox contract, and the admission window
//      (committed_at to valid_until, at most 600 seconds and inside the APS decision and the PIC attestation);
//   3. consults and updates the single-use state, scoped by (workflow_id, admission_issuer, provider_namespace,
//      decision_id): a first use commits and assigns operation_id (J01, J09); the same inputs again return the existing
//      admission (J07); a fully verified new input set for the same decision and the same refund resolves to the existing
//      operation (J10, the verdict only); the same decision with other refund content is refused, nonce_reused (J08);
//   4. signs what it decided with its own key, role "admission-door" (not "admission-signer", which signs handoffs):
//        3.1 refund-sandbox-admission/0.1, the contract's committed record (unsigned; admission_ref = sha256 of its JCS)
//        3.2 a2a-admission-v0 (version 0.1), admit or refuse, verifiable with admission_verify_v0.{py,mjs}
//        3.3 hs-refund-admission-mapping-v0, one per request: committed, resolved_existing or refused
//
// State. All checks finish before one update of the state, and the state functions are synchronous: the caller (the
// Durable Object in refund_door_do.mjs) runs decide() inside blockConcurrencyWhile, so no other request reads or writes
// the state in between. Durability across restarts is the Durable Object's storage and is not claimed beyond it.
//
// Replay. replaySequence() runs requests in order against a fresh state held in memory, at consumption instants the
// caller supplies. It never reads or writes the live state. Its records say so: the mapping schema is
// hs-refund-admission-replay-v0 (a signer that expects hs-refund-admission-mapping-v0 does not take it), the
// a2a-admission-v0 record carries no "publication" (the ledger intake stores only public records), and admission_id
// starts with "replay-". It exists so that a published run (retained inputs and their recorded instants) can be put
// through the door and its records recomputed by anyone, before fresh inputs exist.
//
// The amount limit is the rule of clause_eval_v0 (limitFor and overLimit), restated below in 10 lines because
// clause_eval_v0.mjs reads its own path when it loads, which a worker cannot do. refund_door_v0.test.mjs holds the two
// together, and the record names clause_eval_v0.py by sha256 as every a2a-admission-v0 record does.
import { createHash, createPrivateKey, createPublicKey, sign as edSign } from "node:crypto";
import { canonical } from "../musubi-v0/canonical_v0.mjs";
import { checkRefundCase, FILES, jcs, strictParse, CONTRACT_REVISION, PROFILE } from "../musubi-v0/adapters/aps_receipt/adapter_aps_receipt.mjs";
import { CONTRACT_TEXT, CONTRACT_SHA256 } from "./sandbox_contract.mjs";

export { FILES, PROFILE, CONTRACT_REVISION };
export const ADMISSION_SCHEMA = "refund-sandbox-admission/0.1";
export const RECORD_SCHEMA = "a2a-admission-v0";
export const MAPPING_SCHEMA = "hs-refund-admission-mapping-v0";
export const REPLAY_SCHEMA = "hs-refund-admission-replay-v0";
export const DOOR_ROLE = "admission-door";
// sha256 of workers/hs-ledger/nenrin/musubi-v0/clause_eval_v0.py; the test recomputes it from the file.
export const EVALUATOR_SHA256 = "fee48c3a66c28fe14ecbb8e2aea03a062fbe7be22810d3ca94332b36f660bed0";
// The trusted configured scope of the mapping (contract section 5). workflow_id and provider_namespace are the ones the
// connected runs of the sandbox use; they are configuration, agreed with the runner, not read from any request.
export const CONFIG = Object.freeze({
  workflow_id: "wf-refund-193",
  admission_issuer: "horizon-shield-admission-door",
  provider_namespace: "sim-local",
  domain: "ledger.horizonshield.dev",
  key_url: "https://ledger.horizonshield.dev/sandbox/refund/keys/admission-door.json",
  window_seconds: 600,
  expiry_blocks: 144,
});
export const CONTRACT = JSON.parse(CONTRACT_TEXT);
export const DOES_NOT_ESTABLISH = [
  "that HS allowed or blocked anything; the relying party ran the function at its own door",
  "that the agent is who it claims to be beyond what the presented signatures and keys on its own domain show",
  "when a revocation without an anchor was issued, or that no revocation exists beyond those in revocations_seen; a revocation the "
    + "principal signed is obeyed with or without an anchor, and its time is not proven until it is anchored",
  "that the action was lawful, safe or wise; only that it was inside or outside the signed grant",
  "that this record is a legal authorization or determines liability"];
export const ESTABLISHES = [
  "that the door named here ran the aps-receipt adapter (steps 0 to 8) and step 9 of hs-refund-admission-profile/0.1 over the inputs named in presentation_ref, at the consumption instant of its mapping record, and signed the result",
  "that the amount was read against grant.limits of this contract with the rule of the shared clause evaluator (rules.evaluator_sha256)"];
export const NOT_ESTABLISHED = [
  "that a refund moved, that the merchant is legitimate, or any revocation state beyond trust/aps-consumption.json as presented",
  "that pic-verification.json was produced by PIC: it is the runner's result, accepted on the runner's channel (the sandbox key), bound here to the retained proposal and keyring bytes",
  "restart safety, durable admission or atomic admission-to-effect delivery; the single-use state is one Durable Object's storage",
  "a trusted time source: consumed_at is the door host's clock (clock_source), or the caller's in a replay",
  "the worker key's revocation at consumption: it is read at the intent's issuance; the approval signer's is read at consumption"];

const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const utf8 = (s) => Buffer.from(s, "utf8");
const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
const UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RUN_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_FILE = 1 << 20;

// ---------------------------------------------------------------- the amount rule of clause_eval_v0

const own = (o, k) => (isObj(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
export function limitFor(contract, action) {
  const g = isObj(contract.grant) ? contract.grant : {};
  const lm = isObj(g.limits) ? g.limits : {};
  const x = own(lm, action);
  if (!isObj(x)) return null;
  const m = own(x, "max_amount");
  return { max: Number.isInteger(m) ? m : null, unit: own(x, "unit") ?? null };
}
export function overLimit(contract, action, amount) {
  const lim = limitFor(contract, action);
  if (lim === null) return false;
  if (lim.max === null || !Number.isInteger(amount) || amount < 0) return true;
  return amount > lim.max;
}

// ---------------------------------------------------------------- keys and signatures

// An Ed25519 key from its 32-byte seed (base64, the secret's form). Returns the public key and a synchronous signer.
export function doorKeyFromSeed(seedB64, keyId) {
  const seed = Buffer.from(String(seedB64 || "").trim(), "base64");
  if (seed.length !== 32 || seed.toString("base64") !== String(seedB64).trim()) throw new Error("the door seed is not 32 bytes of canonical base64");
  const k = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
  const pubB64 = createPublicKey(k).export({ format: "der", type: "spki" }).subarray(12).toString("base64");
  return { key_id: keyId, public_key_ed25519_b64: pubB64, sign: (bytes) => edSign(null, bytes, k).toString("base64") };
}

export const recordSigningBytes = (rec) => Buffer.concat([utf8(RECORD_SCHEMA + "\n"), utf8(canonical(without(rec, "signatures")))]);
export const mappingSigningBytes = (m) => Buffer.concat([utf8(m.schema + "\n"), utf8(canonical(without(m, "signatures")))]);
function without(o, k) { const c = { ...o }; delete c[k]; return c; }

// The public key document served at CONFIG.key_url.
export function keyDocument(door, notBefore) {
  return { schema: "hs-admission-door-key-v0", role: DOOR_ROLE, not_role: "admission-signer", key_id: door.key_id, alg: "ed25519",
    public_key_ed25519_b64: door.public_key_ed25519_b64, public_key_hex: Buffer.from(door.public_key_ed25519_b64, "base64").toString("hex"),
    not_before: notBefore || null, domain: CONFIG.domain, profile: PROFILE, contract_revision: CONTRACT_REVISION,
    signs: [RECORD_SCHEMA + " (version 0.1)", MAPPING_SCHEMA, REPLAY_SCHEMA] };
}

// ---------------------------------------------------------------- requests

// {run_id, inputs: {<file>: string}} or {run_id, inputs_b64: {<file>: base64}}. The strings are the files' UTF-8 text;
// inputs_b64 carries bytes that are not UTF-8 (the adapter refuses those at step 0, and that refusal is signed too).
export function readRequest(body) {
  if (!isObj(body)) return { error: "body_not_an_object" };
  const hasT = Object.prototype.hasOwnProperty.call(body, "inputs"), hasB = Object.prototype.hasOwnProperty.call(body, "inputs_b64");
  if (hasT === hasB) return { error: "exactly_one_of_inputs_or_inputs_b64" };
  if (typeof body.run_id !== "string" || !RUN_ID.test(body.run_id)) return { error: "run_id" };
  const src = hasT ? body.inputs : body.inputs_b64;
  if (!isObj(src)) return { error: "inputs_not_an_object" };
  const files = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v !== "string") return { error: "input_not_a_string", file: k };
    const b = hasT ? utf8(v) : Buffer.from(v, "base64");
    if (!hasT && b.toString("base64") !== v) return { error: "input_not_canonical_base64", file: k };
    if (b.length > MAX_FILE) return { error: "input_over_1_mib", file: k };
    files[k] = new Uint8Array(b);
  }
  return { run_id: body.run_id, files };
}

// ---------------------------------------------------------------- time

const ceilSec = (iso) => { const t = Date.parse(iso); return Math.ceil(t / 1000) * 1000; };
const floorSec = (iso) => { const t = Date.parse(iso); return Math.floor(t / 1000) * 1000; };
const isoSec = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
export const isoMs = (ms) => new Date(ms).toISOString();

// The PIC attestation's expires_at, from the retained proposal the adapter already verified.
function picExpiresAt(files) {
  const prop = strictParse(files["inputs/pic-proposal.json"]);
  const ids = prop.claims[0].evidence;
  const ev = prop.evidence.find((e) => isObj(e) && ids.includes(e.id) && e.type === "sig");
  return strictParse(Buffer.from(ev.payload, "utf8")).expires_at;
}

// ---------------------------------------------------------------- the decision

function rawOf(c, f) { const r = c.inputs.find((x) => x.file === f); return r ? r.raw_sha256 : null; }
function bindingOf(c) { return sha256hex(utf8(canonical(c.inputs.map((x) => [x.file, x.canonical_sha256])))); }
function targetOf(files) { try { return strictParse(files["inputs/aps-action.json"]).target; } catch { return null; } }
const scopeKey = (decisionId) => [CONFIG.workflow_id, CONFIG.admission_issuer, CONFIG.provider_namespace, decisionId].join("\n");
function operationIdFor(decisionId) {
  return "op-hs-" + sha256hex(utf8(canonical({ workflow_id: CONFIG.workflow_id, admission_issuer: CONFIG.admission_issuer,
    provider_namespace: CONFIG.provider_namespace, decision_id: decisionId }))).slice(0, 24);
}

// 3.1: exactly the fields of contract section 5, in the contract's names.
export function committedRecord(c, operationId, committedAt, validUntil) {
  return {
    schema: ADMISSION_SCHEMA, contract_revision: CONTRACT_REVISION,
    workflow_id: CONFIG.workflow_id, admission_issuer: CONFIG.admission_issuer, provider_namespace: CONFIG.provider_namespace,
    decision_id: c.decision_id, operation_id: operationId, approval_ref: c.approval_ref,
    pic_evidence_ref: rawOf(c, "inputs/pic-proposal.json"), pic_verification_ref: rawOf(c, "inputs/pic-verification.json"), pic_trust_file_ref: rawOf(c, "trust/pic-keys.json"),
    aps_evidence_ref: rawOf(c, "inputs/aps-approval.json"), aps_intent_file_ref: rawOf(c, "inputs/aps-intent.json"),
    aps_action_file_ref: rawOf(c, "inputs/aps-action.json"), aps_payload_file_ref: rawOf(c, "inputs/aps-payload.json"),
    decision_evidence_ref: rawOf(c, "inputs/decision-evidence.json"), aps_consumption_trust_ref: rawOf(c, "trust/aps-consumption.json"),
    tool: "refund", arguments: c.tuple, state: "committed", committed_at: committedAt, valid_until: validUntil,
  };
}
export const admissionRef = (rec31) => "sha256:" + sha256hex(utf8(jcs(rec31)));

// 3.2: the a2a-admission-v0 record, version 0.1.
function a2aRecord({ c, files, decision, reason, chainView, replay, admissionIdSeed }) {
  const target = c.verified ? targetOf(files) : null;
  const expiryHeight = chainView.height + CONFIG.expiry_blocks;
  const nonce = c.decision_id || null;
  const amount = c.tuple ? c.tuple.amount_minor : null;
  const preimage = { contract_sha256: CONTRACT_SHA256, action: "refund", target, amount, nonce, expiry_height: expiryHeight };
  const rec = {
    schema: RECORD_SCHEMA,
    admission_id: (replay ? "replay-" : "adm-") + sha256hex(utf8(canonical(admissionIdSeed))).slice(0, 32),
    relying_party: { domain: CONFIG.domain, key_url: CONFIG.key_url },
    contract_ref: { contract_id: CONTRACT.contract_id, contract_sha256: CONTRACT_SHA256 },
    action_ref: { action_binding_digest: sha256hex(utf8(canonical(preimage))), nonce },
    presentation_ref: FILES.map((f) => {
      const r = c.inputs.find((x) => x.file === f);
      return { adapter: "aps-receipt", sha256: r ? r.canonical_sha256 : null, verified: decision === "admit" ? true : null };
    }),
    chain_view: { height: chainView.height, header_sha256: chainView.header_sha256 },
    revocations_seen: [],
    decision,
    reasons: [decision === "admit" ? "within_grant" : reason],
    clause: "grant.authorized_actions[" + CONTRACT.grant.authorized_actions.indexOf("refund") + "]",
    rules: { admit: RECORD_SCHEMA, version: "0.1", evaluator_sha256: EVALUATOR_SHA256 },
    establishes: ESTABLISHES,
    does_not_establish: DOES_NOT_ESTABLISH,
  };
  if (!replay) rec.publication = "public";
  return rec;
}

function mappingRecord({ c, runId, consumedAt, clockSource, disposition, operationId, admissionRef: aref, originalRef, admissionSha, step, code, replay }) {
  return {
    schema: replay ? REPLAY_SCHEMA : MAPPING_SCHEMA, contract_revision: CONTRACT_REVISION,
    workflow_id: CONFIG.workflow_id, admission_issuer: CONFIG.admission_issuer, provider_namespace: CONFIG.provider_namespace,
    decision_id: c.decision_id || null, operation_id: operationId || null, disposition,
    admission_ref: aref || null, original_admission_ref: originalRef || null, admission_sha256: admissionSha || null,
    step_failed: step === undefined ? null : step, code: code || null,
    consumed_at: consumedAt, clock_source: clockSource, run_id: runId,
    inputs: c.inputs.map((x) => ({ file: x.file, raw_sha256: x.raw_sha256, canonical_sha256: x.canonical_sha256 })),
  };
}

function signed(rec, bytesOf, door, withDomain) {
  const sig = door.sign(bytesOf(rec));
  return { ...rec, signatures: [withDomain ? { domain: CONFIG.domain, alg: "ed25519", sig } : { role: DOOR_ROLE, key_id: door.key_id, alg: "ed25519", sig }] };
}

// One request. state: { get(scope) -> row | null, put(scope, row) }, both synchronous.
// Returns {status, body}. Nothing in state changes unless the disposition is "committed".
export async function decide({ files, run_id, consumed_at, clock_source }, { sdk, state, door, chainView, replay = false }) {
  if (!door) throw new Error("no door key");
  if (!chainView || !Number.isSafeInteger(chainView.height) || !/^[0-9a-f]{64}$/.test(chainView.header_sha256 || "")) throw new Error("no chain view");
  if (!UTC_MS.test(consumed_at || "")) throw new Error("consumed_at must be UTC milliseconds");
  const c = await checkRefundCase({ files, run_id, consumed_at, sdk });
  const seed = { run_id, consumed_at, inputs: c.inputs.map((x) => x.canonical_sha256), replay };
  const refuse = (reason, step, code, detail, extra = {}) => {
    const r32 = signed(a2aRecord({ c, files, decision: "refuse", reason, chainView, replay, admissionIdSeed: seed }), recordSigningBytes, door, true);
    const aSha = sha256hex(recordSigningBytes(r32));
    const m = signed(mappingRecord({ c, runId: run_id, consumedAt: consumed_at, clockSource: clock_source, disposition: "refused", admissionSha: aSha, step, code, replay }), mappingSigningBytes, door, false);
    return { status: 200, body: { disposition: "refused", reason, step, code, detail, adapter: c, admission: null, admission_ref: null,
      a2a_admission: canonical(r32), admission_sha256: aSha, mapping: canonical(m), mapping_sha256: sha256hex(mappingSigningBytes(m)), ...extra } };
  };
  if (!c.verified) return refuse(c.reason, c.step, c.code, c.detail);

  // step 9: the contract's limit, then the admission window
  if (overLimit(CONTRACT, "refund", c.tuple.amount_minor)) return refuse("amount_over_limit", 9, "AMOUNT_OVER_LIMIT", "grant.limits.refund.max_amount " + limitFor(CONTRACT, "refund").max);
  const committedAtMs = ceilSec(consumed_at);
  const upper = Math.min(committedAtMs + CONFIG.window_seconds * 1000, floorSec(c.decision_valid_until), floorSec(picExpiresAt(files)));
  if (!(committedAtMs < upper)) return refuse("presentation_unverifiable", 9, "ADMISSION_WINDOW_EMPTY", "committed_at " + isoSec(committedAtMs) + " is not before " + isoSec(upper));

  // the single-use state: one read, then at most one write, with nothing in between
  const key = scopeKey(c.decision_id);
  const binding = bindingOf(c);
  const prev = state.get(key);
  if (prev) {
    if (prev.input_binding === binding && prev.response) {
      return { status: 200, body: { ...prev.response, repeated: { first_consumed_at: prev.consumed_at, consumed_at, run_id, note: "the same inputs again: the existing admission, nothing new consumed (J07)" } } };
    }
    if (jcs(prev.tuple) !== jcs(c.tuple) || prev.target !== targetOf(files)) {
      return refuse("nonce_reused", 9, "DECISION_CONSUMED_OTHER_CONTENT", "decision " + c.decision_id + " was consumed for operation " + prev.operation_id + " with other refund content");
    }
    const m = signed(mappingRecord({ c, runId: run_id, consumedAt: consumed_at, clockSource: clock_source, disposition: "resolved_existing",
      operationId: prev.operation_id, originalRef: prev.admission_ref, admissionSha: prev.admission_sha256, replay }), mappingSigningBytes, door, false);
    return { status: 200, body: { disposition: "resolved_existing", reason: null, step: null, code: null, detail: "a verified new input set for decision " + c.decision_id + " and the same refund: the existing operation, no new consumption (J10)",
      adapter: c, admission: null, admission_ref: null, original_admission_ref: prev.admission_ref, operation_id: prev.operation_id,
      a2a_admission: null, admission_sha256: prev.admission_sha256, mapping: canonical(m), mapping_sha256: sha256hex(mappingSigningBytes(m)) } };
  }
  const operationId = operationIdFor(c.decision_id);
  const r31 = committedRecord(c, operationId, isoSec(committedAtMs), isoSec(upper));
  const aref = admissionRef(r31);
  const r32 = signed(a2aRecord({ c, files, decision: "admit", chainView, replay, admissionIdSeed: seed }), recordSigningBytes, door, true);
  const aSha = sha256hex(recordSigningBytes(r32));
  const m = signed(mappingRecord({ c, runId: run_id, consumedAt: consumed_at, clockSource: clock_source, disposition: "committed",
    operationId, admissionRef: aref, admissionSha: aSha, replay }), mappingSigningBytes, door, false);
  const body = { disposition: "committed", reason: null, step: null, code: null, detail: null, adapter: c,
    admission: jcs(r31), admission_ref: aref, operation_id: operationId,
    a2a_admission: canonical(r32), admission_sha256: aSha, mapping: canonical(m), mapping_sha256: sha256hex(mappingSigningBytes(m)) };
  state.put(key, { decision_id: c.decision_id, operation_id: operationId, input_binding: binding, tuple: c.tuple, target: targetOf(files),
    approval_ref: c.approval_ref, admission_ref: aref, admission_sha256: aSha, consumed_at, response: body });
  return { status: 200, body };
}

// A state held in memory (replays and tests).
export function memoryState() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? structuredClone(m.get(k)) : null), put: (k, v) => { if (m.has(k)) throw new Error("scope already consumed"); m.set(k, structuredClone(v)); }, size: () => m.size };
}

// Requests in order against a fresh state in memory, at the instants the caller gives. Nothing live is read or written.
export async function replaySequence(requests, { sdk, door, chainView }) {
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > 16) return { status: 400, body: { error: "requests: 1 to 16" } };
  const state = memoryState(), out = [];
  for (const [i, q] of requests.entries()) {
    const r = readRequest(q);
    if (r.error) return { status: 400, body: { error: r.error, file: r.file || null, request: i } };
    if (typeof q.consumed_at !== "string" || !UTC_MS.test(q.consumed_at)) return { status: 400, body: { error: "consumed_at must be UTC milliseconds", request: i } };
    const d = await decide({ files: r.files, run_id: r.run_id, consumed_at: q.consumed_at, clock_source: "replay: consumed_at supplied by the caller, not the door's clock; a fresh state in memory, the live state not read or written" },
      { sdk, state, door, chainView, replay: true });
    out.push(d.body);
  }
  return { status: 200, body: { schema: "hs-refund-door-replay-answer-v0", replay: true, results: out } };
}

// The checks a reader repeats on an answer: the record bytes hash to the stated sha256, and the signatures verify under
// the door's public key. Returns a list of problems (empty when all hold). verifyEd25519(pubB64, sigB64, bytes) -> bool.
export function answerProblems(answer, pubB64, verifyEd25519) {
  const p = [];
  for (const [field, shaField, bytesOf, schemaOk] of [["a2a_admission", "admission_sha256", recordSigningBytes, (r) => r.schema === RECORD_SCHEMA],
    ["mapping", "mapping_sha256", mappingSigningBytes, (r) => r.schema === MAPPING_SCHEMA || r.schema === REPLAY_SCHEMA]]) {
    if (answer[field] === null || answer[field] === undefined) continue;
    let r;
    try { r = JSON.parse(answer[field]); } catch { p.push(field + ": not JSON"); continue; }
    if (canonical(r) !== answer[field]) p.push(field + ": not canonical text");
    if (!schemaOk(r)) p.push(field + ": schema");
    const bytes = bytesOf(r);
    if (sha256hex(bytes) !== answer[shaField]) p.push(field + ": sha256 differs from " + shaField);
    const sig = Array.isArray(r.signatures) && r.signatures.length === 1 ? r.signatures[0].sig : null;
    if (!sig || !verifyEd25519(pubB64, sig, bytes)) p.push(field + ": signature does not verify under the door key");
  }
  if (answer.admission !== null && answer.admission !== undefined && admissionRef(JSON.parse(answer.admission)) !== answer.admission_ref) p.push("admission: admission_ref is not sha256 of its JCS");
  return p;
}
