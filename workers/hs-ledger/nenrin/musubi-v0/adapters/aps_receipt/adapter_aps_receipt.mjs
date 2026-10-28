#!/usr/bin/env node
// aps-receipt adapter: the input checks the HORIZON SHIELD admission door is to run on the native APS and PIC inputs of
// the bounded refund sandbox (aeoess/agent-governance-vocabulary#193, contract revision review-2026-10-23, sections 3
// to 5), before it decides anything. The door side for this sandbox is not built yet; this file is the part that is.
//
// What this file is. A pure function over the eleven retained input files of one case, the runner's run_id and the
// consumption instant. It parses each file once, strictly, keeps the exact bytes it hashed, and runs steps 1 to 8 of
// the admission profile (hs-refund-admission-profile/0.1) in order, stopping at the first failure. It returns what it
// verified and, on a failure, a reason from the closed a2a-admission-v0 list with the step and a finer code.
//
// What it is not. It holds no key, signs nothing, keeps no state and decides nothing. Single-use consumption of the
// merchant decision, operation_id assignment, the contract's limits, the committed record and the signed admission and
// mapping records are to belong to the door, which is not built yet for this sandbox and is to be closed source (SEKI is
// private; see tools/boundary/private_patterns.txt). The door is to call this function and build on its answer.
// Publishing it lets anyone repeat the input checks of a published case without the door.
//
// APS verification is the pinned SDK's own: verifyReceiptV1, verifyReceiptWithDecisionV1, computeActionRefV2 and
// computePayloadRefV1 of agent-passport-system 8.0.1, refused unless the installed package is byte for byte the one in
// PINS.json. It is not a second implementation of APS. The PIC result is the trusted runner's output, not a PIC
// signature; this file checks that it is bound to the retained proposal and keyring bytes and recomputes the three
// PIC digests (args, claims, intent) from the retained proposal with PIC canonical JSON (RFC 8785, safe integers only).
//
//   node adapter_aps_receipt.mjs --case <dir> --run-id <id> --consumed-at <YYYY-MM-DDTHH:MM:SS.sssZ>
//       prints the per-case result (hs-aps-receipt-adapter-case-v0) for the eleven files under <dir>
//   node adapter_aps_receipt.mjs --pins
//       checks the installed SDK against PINS.json and prints the package tree digest
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, realpathSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonical } from "../../canonical_v0.mjs";
import { parseStrict } from "../../../agreement-v0/agreement_canonical.mjs";

export const PROFILE = "hs-refund-admission-profile/0.1";
export const CASE_SCHEMA = "hs-aps-receipt-adapter-case-v0";
export const CONTRACT_REVISION = "review-2026-10-23";
export const PIC_RESULT_SCHEMA = "refund-sandbox-pic-result/0.1";
export const PIC_SDK_COMMIT = "330fdd817ef81d43461ea1787939e0d1cc87d589";
export const FILES = ["inputs/pic-proposal.json", "inputs/aps-approval.json", "inputs/aps-intent.json", "inputs/aps-action.json",
  "inputs/aps-payload.json", "inputs/decision-evidence.json", "inputs/pic-verification.json", "trust/pic-keys.json",
  "trust/aps-consumption.json", "trust/handoff-issuance.json", "trust/handoff-evaluation.json"];
// Section 3 of the contract: the proposed refund profile.
export const REFUND = {
  action_type: "refund",
  scope_required: ["payments:refund"],
  worker: "did:example:refund-worker",
  approval_boundary: "did:example:refund-approval-boundary",
  target_prefix: "https://payments.operator.example/v1/payments/",
  target_suffix: "/refunds",
  tool: "refund",
  impact: "money",
  currency: "EUR",
};
// The trust selection this adapter reads from trust/aps-consumption.json until APS publishes its own test trust input
// (then the shape is fixed at freeze). Keys are Ed25519, 32 bytes as 64 lowercase hex.
export const TRUST_SCHEMA = "hs-aps-consumption-trust/0.1";
export const TRUST_ROLES = { [REFUND.worker]: "worker", [REFUND.approval_boundary]: "approval-boundary" };
// The closed reason list of a2a-admission-v0 (admission_verify_v0.mjs REASONS); this adapter names only these.
export const REASONS_USED = ["presentation_unverifiable", "outside_grant", "action_digest_mismatch", "key_revoked"];

const HEX64 = /^[0-9a-f]{64}$/;
const UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RFC3339_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const PAYMENT_ID = /^[A-Za-z0-9_-]+$/;
const HERE = dirname(fileURLToPath(import.meta.url));

function sha256hex(b) {
  return createHash("sha256").update(b).digest("hex");
}

class Stop extends Error {
  constructor(step, reason, code, detail) {
    super(code + (detail ? ": " + detail : ""));
    this.step = step; this.reason = reason; this.code = code; this.detail = detail || null;
  }
}

// PIC canonical JSON v1 for the values this profile carries: RFC 8785 (keys sorted by UTF-16 code units, strings and
// numbers as ECMAScript JSON.stringify writes them), with PIC's refusals of non-finite numbers, integers outside the
// safe range and lone surrogates.
export function jcs(v) {
  if (v === null || v === true || v === false) return String(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("no PIC canonical form for " + String(v));
    if (Number.isInteger(v) && !Number.isSafeInteger(v)) throw new Error("integer outside the safe range");
    return JSON.stringify(v);
  }
  if (typeof v === "string") {
    if (!v.isWellFormed()) throw new Error("lone surrogate");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  if (typeof v === "object") {
    const ks = Object.keys(v);
    for (const k of ks) if (!k.isWellFormed()) throw new Error("lone surrogate in a key");
    ks.sort();
    return "{" + ks.map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
  }
  throw new Error("no PIC canonical form for " + typeof v);
}

// Section 3: parse once, strictly. Duplicate members are refused by the scanner, which reads every integer token as a
// BigInt. Here an integer outside the safe range, any number written with a fraction or an exponent, a negative zero
// (the BigInt scanner would read -0 as 0), NaN, Infinity and lone surrogates are refused, and safe integers become
// numbers for the SDK. The bytes must be UTF-8 without a byte order mark.
export function strictParse(bytes) {
  const buf = Buffer.from(bytes);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) throw new Error("byte order mark");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  if (hasNegativeZero(text)) throw new Error("negative zero");
  return (function walk(x) {
    if (typeof x === "bigint") {
      if (x > BigInt(Number.MAX_SAFE_INTEGER) || x < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("integer outside the safe range");
      return Number(x);
    }
    if (typeof x === "number") throw new Error("unsupported number " + String(x));
    if (typeof x === "string") { if (!x.isWellFormed()) throw new Error("lone surrogate"); return x; }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") {
      const o = {};
      for (const k of Object.keys(x)) { if (!k.isWellFormed()) throw new Error("lone surrogate in a key"); o[k] = walk(x[k]); }
      return o;
    }
    return x;
  })(parseStrict(text));
}

// A number token -0 outside every string (-0.0 and -0e0 are already refused as fractions and exponents).
function hasNegativeZero(text) {
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "-" && text[i + 1] === "0" && !/[0-9.eE]/.test(text[i + 2] || "")) {
      return true;
    }
  }
  return false;
}

function exactKeys(o, keys) {
  return o !== null && typeof o === "object" && !Array.isArray(o) &&
    Object.keys(o).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

function isObj(o) {
  return o !== null && typeof o === "object" && !Array.isArray(o);
}

function nonEmptyAscii(s) {
  return typeof s === "string" && s.length > 0 && /^[\x21-\x7e]+$/.test(s);
}

// The closed refund argument object (section 3): exactly payment_id, amount_minor and currency.
export function refundArgsProblem(a) {
  if (!exactKeys(a, ["payment_id", "amount_minor", "currency"])) return "not exactly payment_id, amount_minor, currency";
  if (typeof a.payment_id !== "string" || !PAYMENT_ID.test(a.payment_id)) return "payment_id";
  if (typeof a.amount_minor !== "number" || !Number.isSafeInteger(a.amount_minor) || a.amount_minor <= 0) return "amount_minor";
  if (a.currency !== REFUND.currency) return "currency";
  return null;
}

// ---------------------------------------------------------------- the pinned SDK

let PINNED = null;

export function treeDigest(root) {
  const rows = [];
  (function walk(d) {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else rows.push(relative(root, p).split(sep).join("/") + "\n" + sha256hex(readFileSync(p)) + "\n");
    }
  })(root);
  return sha256hex(Buffer.from(rows.join(""), "utf8"));
}

// Refuses to hand out the SDK unless its package.json says 8.0.1 and the digest of every file in the installed
// package equals PINS.json. npm ci separately checks the tarball's sha512 against package-lock.json.
export async function pinnedSdk() {
  if (PINNED) return PINNED;
  const pins = JSON.parse(readFileSync(join(HERE, "PINS.json"), "utf8"));
  const entry = fileURLToPath(import.meta.resolve("agent-passport-system"));
  let root = dirname(entry);
  while (!statSafe(join(root, "package.json"))) root = dirname(root);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (pkg.name !== pins.aps.package || pkg.version !== pins.aps.version) throw new Error("installed agent-passport-system is " + pkg.version + ", PINS.json names " + pins.aps.version);
  const tree = treeDigest(root);
  if (tree !== pins.aps.package_tree_sha256) throw new Error("installed agent-passport-system differs from PINS.json (tree " + tree + ")");
  const sdk = await import("agent-passport-system");
  PINNED = { sdk, tree, version: pkg.version };
  return PINNED;
}

function statSafe(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

// ---------------------------------------------------------------- trust selection

function readTrust(t) {
  if (!exactKeys(t, ["schema", "profile", "scope", "keys"]) || t.schema !== TRUST_SCHEMA || t.profile !== "aps-receipt-v1") return "shape";
  if (!Array.isArray(t.scope) || jcs(t.scope) !== jcs(REFUND.scope_required)) return "scope";
  if (!Array.isArray(t.keys) || t.keys.length === 0) return "keys";
  const seen = new Set();
  for (const k of t.keys) {
    if (!exactKeys(k, ["signer", "key_id", "role", "public_key", "not_before", "not_after", "revoked_at"])) return "key shape";
    if (TRUST_ROLES[k.signer] !== k.role || !nonEmptyAscii(k.key_id) || typeof k.public_key !== "string" || !HEX64.test(k.public_key)) return "key " + k.key_id;
    if (!UTC_MS.test(k.not_before) || (k.not_after !== null && !UTC_MS.test(k.not_after)) || (k.revoked_at !== null && !UTC_MS.test(k.revoked_at))) return "key times " + k.key_id;
    const id = k.signer + "\n" + k.key_id;
    if (seen.has(id)) return "duplicate key " + k.key_id;
    seen.add(id);
  }
  return null;
}

// Issuance-time resolution: the key named by (signer, key_id), in its validity window at the record's issued_at. For
// the worker's intent a key revoked at or before issued_at is not resolved. For the approval boundary revocation is not
// read here: step 3 names any revocation at or before the consumption instant, including one before issuance, as
// key_revoked, so that it is named on its own and not folded into an unresolved key.
function resolverFor(trust, signer, { revocationInStep3 = false } = {}) {
  return (s, keyId, issuedAt) => {
    if (s !== signer) return undefined;
    const k = trust.keys.find((x) => x.signer === s && x.key_id === keyId);
    if (!k || !UTC_MS.test(issuedAt) || issuedAt < k.not_before) return undefined;
    if (k.not_after !== null && issuedAt >= k.not_after) return undefined;
    if (!revocationInStep3 && k.revoked_at !== null && k.revoked_at <= issuedAt) return undefined;
    return k.public_key;
  };
}

// ---------------------------------------------------------------- one case

export async function checkRefundCase({ files, run_id, consumed_at }) {
  const { sdk } = await pinnedSdk();
  const out = {
    schema: CASE_SCHEMA, profile: PROFILE, contract_revision: CONTRACT_REVISION,
    run_id: typeof run_id === "string" ? run_id : null, consumed_at: typeof consumed_at === "string" ? consumed_at : null,
    verified: false, reason: null, step: null, code: null, detail: null,
    inputs: [], tuple: null, decision_id: null, approval_ref: null, intent_ref: null, action_ref: null, decision_valid_until: null,
  };
  const P = {};
  try {
    // step 0: the closed input set, each file parsed once, strictly, and hashed as read
    if (!nonEmptyAscii(run_id)) throw new Stop(0, "presentation_unverifiable", "RUN_ID", "run_id");
    if (!UTC_MS.test(consumed_at || "")) throw new Stop(0, "presentation_unverifiable", "CONSUMED_AT", "consumed_at");
    if (!isObj(files) || Object.keys(files).sort().join("\n") !== [...FILES].sort().join("\n")) {
      throw new Stop(0, "presentation_unverifiable", "INPUT_SET", "not exactly the eleven section 3 files");
    }
    for (const f of FILES) {
      const bytes = files[f];
      if (!(bytes instanceof Uint8Array)) throw new Stop(0, "presentation_unverifiable", "INPUT_BYTES", f);
      let v, c;
      try { v = strictParse(bytes); } catch (e) { throw new Stop(0, "presentation_unverifiable", "STRICT_PARSE", f + ": " + e.message); }
      try { c = sha256hex(Buffer.from(canonical(v), "utf8")); } catch (e) { throw new Stop(0, "presentation_unverifiable", "NO_CANONICAL_FORM", f + ": " + e.message); }
      P[f] = v;
      out.inputs.push({ file: f, raw_sha256: "sha256:" + sha256hex(bytes), canonical_sha256: c });
    }
    const raw = Object.fromEntries(out.inputs.map((r) => [r.file, r.raw_sha256]));

    // step 1: the APS trust selection at consumption
    const trust = P["trust/aps-consumption.json"];
    const tp = readTrust(trust);
    if (tp) throw new Stop(1, "presentation_unverifiable", "TRUST_SELECTION", tp);

    // step 2: the action-intent receipt, natively
    const intent = P["inputs/aps-intent.json"];
    if (!isObj(intent) || intent.issuer !== REFUND.worker || intent.subject_agent !== REFUND.worker) {
      throw new Stop(2, "outside_grant", "INTENT_IDENTITY", "issuer and subject_agent must be " + REFUND.worker);
    }
    const vi = sdk.verifyReceiptV1(intent, resolverFor(trust, REFUND.worker), { expectedReceiptType: "aps:action-intent:v1" });
    if (vi.status !== "valid") throw new Stop(2, "presentation_unverifiable", "INTENT_NOT_VALID", vi.status + " " + vi.errors.join("; "));
    out.intent_ref = intent.receipt_id;

    // step 3: the policy-decision receipt with the four decision components, natively, then its link to the intent,
    // the verdict, the decision window and the signer's revocation state at consumption
    const approval = P["inputs/aps-approval.json"];
    const decision = P["inputs/decision-evidence.json"];
    if (!exactKeys(decision, ["authority_state", "policy_input", "decision_context", "decision_output"])) {
      throw new Stop(3, "presentation_unverifiable", "DECISION_COMPONENTS", "not exactly the four native components");
    }
    if (!isObj(approval) || approval.issuer !== REFUND.approval_boundary) throw new Stop(3, "outside_grant", "APPROVAL_ISSUER", "issuer must be " + REFUND.approval_boundary);
    const va = sdk.verifyReceiptWithDecisionV1(approval, decision, resolverFor(trust, REFUND.approval_boundary, { revocationInStep3: true }), { expectedReceiptType: "aps:policy-decision:v1", boundaryIdentity: REFUND.approval_boundary });
    if (va.status !== "valid" || va.decision_ref_bound !== true || va.decision_output_bound !== true) {
      const code = va.errors.some((e) => /decision_ref_mismatch|decision_output_mismatch/.test(e)) ? "DECISION_NOT_BOUND" : "APPROVAL_NOT_VALID";
      throw new Stop(3, code === "DECISION_NOT_BOUND" ? "action_digest_mismatch" : "presentation_unverifiable", code, va.status + " " + va.errors.join("; "));
    }
    // The composite's predecessor axis applies to action-result records only, so the intent link of a policy-decision
    // is checked here (section 3: do not assume the composite verifies it).
    if (approval.prev !== intent.receipt_id) throw new Stop(3, "action_digest_mismatch", "APPROVAL_PREV", "approval.prev is not the intent's receipt_id");
    if (approval.action_ref !== intent.action_ref || approval.subject_agent !== intent.subject_agent) {
      throw new Stop(3, "action_digest_mismatch", "APPROVAL_INTENT_ACTION", "approval and intent name different actions or subjects");
    }
    if (!(intent.issued_at <= approval.issued_at)) throw new Stop(3, "presentation_unverifiable", "APPROVAL_BEFORE_INTENT", "approval issued before its intent");
    const verdict = approval.result.verdict;
    if (verdict !== "permit") throw new Stop(3, "outside_grant", "VERDICT_NOT_PERMIT", String(verdict));
    // Contract section 5: this profile implements no decision constraint, so a permit that carries any is refused.
    const cons = approval.result.constraints;
    if (!Array.isArray(cons) || cons.length !== 0) throw new Stop(3, "outside_grant", "DECISION_CONSTRAINTS", "this profile takes a permit with no constraints");
    const validUntil = approval.result.valid_until;
    if (!(approval.issued_at <= consumed_at)) throw new Stop(3, "presentation_unverifiable", "APPROVAL_AFTER_CONSUMPTION", approval.issued_at);
    if (!(consumed_at < validUntil)) throw new Stop(3, "presentation_unverifiable", "DECISION_EXPIRED_AT_CONSUMPTION", "valid_until " + validUntil);
    for (const sig of approval.signatures.filter((s) => s.signer === REFUND.approval_boundary)) {
      const k = trust.keys.find((x) => x.signer === sig.signer && x.key_id === sig.key_id);
      if (k && k.revoked_at !== null && k.revoked_at <= consumed_at) {
        throw new Stop(3, "key_revoked",
          "APPROVAL_SIGNER_REVOKED_AT_CONSUMPTION", sig.key_id + " revoked " + k.revoked_at);
      }
    }
    out.approval_ref = approval.receipt_id;
    out.decision_valid_until = validUntil;

    // step 4: ActionReferenceInputV2 and the profile constants
    const action = P["inputs/aps-action.json"];
    try { sdk.validateActionReferenceInputV2(action); } catch (e) { throw new Stop(4, "presentation_unverifiable", "ACTION_INPUT", e.message); }
    if (action.action_type !== REFUND.action_type) throw new Stop(4, "outside_grant", "ACTION_TYPE", action.action_type);
    if (jcs(action.scope_required) !== jcs(REFUND.scope_required)) throw new Stop(4, "outside_grant", "SCOPE", jcs(action.scope_required));
    if (action.agent_id !== REFUND.worker) throw new Stop(4, "outside_grant", "WORKER", action.agent_id);
    const t = action.target;
    const tid = typeof t === "string" && t.startsWith(REFUND.target_prefix) && t.endsWith(REFUND.target_suffix)
      ? t.slice(REFUND.target_prefix.length, t.length - REFUND.target_suffix.length) : null;
    if (tid === null || !PAYMENT_ID.test(tid)) throw new Stop(4, "outside_grant", "TARGET", String(t));
    if (sdk.computeActionRefV2(action) !== approval.action_ref) throw new Stop(4, "action_digest_mismatch", "ACTION_REF", "computeActionRefV2(action) is not approval.action_ref");
    out.action_ref = approval.action_ref;

    // step 5: the exact refund tuple
    const payload = P["inputs/aps-payload.json"];
    const pp = refundArgsProblem(payload);
    if (pp) throw new Stop(5, "outside_grant", "PAYLOAD_SCHEMA", pp);
    if (sdk.computePayloadRefV1(payload) !== action.payload_ref) throw new Stop(5, "action_digest_mismatch", "PAYLOAD_REF", "computePayloadRefV1(payload) is not action.payload_ref");
    if (payload.payment_id !== tid) throw new Stop(5, "action_digest_mismatch", "TARGET_PAYMENT_ID", "target names " + tid);
    out.tuple = { payment_id: payload.payment_id, amount_minor: payload.amount_minor, currency: payload.currency };

    // step 6: the merchant decision
    const md = isObj(decision.policy_input) && isObj(decision.policy_input.merchant_decision) ? decision.policy_input.merchant_decision : null;
    if (!md || !nonEmptyAscii(md.decision_id)) throw new Stop(6, "presentation_unverifiable", "DECISION_ID", "policy_input.merchant_decision.decision_id");
    out.decision_id = md.decision_id;

    // step 7: the trusted runner's PIC result, bound to this run and to the retained proposal and keyring bytes,
    // and the proposal's single merchant claim
    const r = P["inputs/pic-verification.json"];
    const RK = ["schema", "contract_revision", "run_id", "pic_sdk_commit", "proposal_file_ref", "pic_trust_file_ref", "evaluated_at",
      "result", "tool", "impact", "args_digest", "claims_digest", "intent_digest", "error_code"];
    if (!exactKeys(r, RK)) throw new Stop(7, "presentation_unverifiable", "PIC_RESULT_SHAPE", "not exactly the fourteen fields");
    if (r.schema !== PIC_RESULT_SCHEMA || r.contract_revision !== CONTRACT_REVISION) throw new Stop(7, "presentation_unverifiable", "PIC_RESULT_SCHEMA", r.schema + " " + r.contract_revision);
    if (r.run_id !== run_id) throw new Stop(7, "presentation_unverifiable", "PIC_RESULT_RUN_ID", "result is for run " + r.run_id);
    if (r.pic_sdk_commit !== PIC_SDK_COMMIT) throw new Stop(7, "presentation_unverifiable", "PIC_SDK_COMMIT", r.pic_sdk_commit);
    if (r.result !== "allow" || r.error_code !== null) throw new Stop(7, "presentation_unverifiable", "PIC_RESULT_NOT_ALLOW", r.result + " " + r.error_code);
    if (r.proposal_file_ref !== raw["inputs/pic-proposal.json"]) throw new Stop(7, "presentation_unverifiable", "PIC_PROPOSAL_FILE_REF", "not the retained proposal bytes");
    if (r.pic_trust_file_ref !== raw["trust/pic-keys.json"]) throw new Stop(7, "presentation_unverifiable", "PIC_TRUST_FILE_REF", "not the retained keyring bytes");
    if (!UTC_MS.test(r.evaluated_at) || !(r.evaluated_at <= consumed_at)) throw new Stop(7, "presentation_unverifiable", "PIC_EVALUATED_AT", r.evaluated_at);
    if (r.tool !== REFUND.tool || r.impact !== REFUND.impact) throw new Stop(7, "outside_grant", "PIC_TOOL_IMPACT", r.tool + " " + r.impact);
    for (const k of ["args_digest", "claims_digest", "intent_digest"]) if (typeof r[k] !== "string" || !HEX64.test(r[k])) throw new Stop(7, "presentation_unverifiable", "PIC_DIGEST_FORM", k);
    const prop = P["inputs/pic-proposal.json"];
    if (!isObj(prop) || prop.protocol !== "PIC/1.0" || !isObj(prop.action) || prop.action.tool !== REFUND.tool || prop.impact !== REFUND.impact || typeof prop.intent !== "string") {
      throw new Stop(7, "outside_grant", "PIC_PROPOSAL_PROFILE", "protocol, tool, impact or intent");
    }
    if (!Array.isArray(prop.claims) || prop.claims.length !== 1 || !isObj(prop.claims[0]) || typeof prop.claims[0].text !== "string") {
      throw new Stop(7, "presentation_unverifiable", "PIC_CLAIM", "not a single merchant claim");
    }
    let claim;
    try { claim = strictParse(Buffer.from(prop.claims[0].text, "utf8")); } catch (e) { throw new Stop(7, "presentation_unverifiable", "PIC_CLAIM", e.message); }
    if (!exactKeys(claim, ["decision_id", "approval_ref"]) || !nonEmptyAscii(claim.decision_id) || typeof claim.approval_ref !== "string") {
      throw new Stop(7, "presentation_unverifiable", "PIC_CLAIM", "not exactly decision_id and approval_ref");
    }
    if (!HEX64.test(claim.approval_ref)) throw new Stop(7, "presentation_unverifiable", "PIC_APPROVAL_REF_FORM", "approval_ref must be 64 lowercase hex");
    if (claim.decision_id !== out.decision_id) throw new Stop(7, "action_digest_mismatch", "PIC_DECISION_ID", "the PIC claim names another merchant decision");
    if (claim.approval_ref !== approval.receipt_id) throw new Stop(7, "action_digest_mismatch", "PIC_APPROVAL_REF", "the PIC claim names another APS receipt");
    // The attestation the claim cites: its time bound is rechecked at consumption, and its digests must be the result's.
    const ids = Array.isArray(prop.claims[0].evidence) ? prop.claims[0].evidence : [];
    const ev = Array.isArray(prop.evidence) ? prop.evidence.filter((e) => isObj(e) && ids.includes(e.id) && e.type === "sig") : [];
    if (ids.length !== 1 || ev.length !== 1 || typeof ev[0].payload !== "string") throw new Stop(7, "presentation_unverifiable", "PIC_ATTESTATION", "the claim does not cite exactly one signature evidence");
    let att;
    try { att = strictParse(Buffer.from(ev[0].payload, "utf8")); } catch (e) { throw new Stop(7, "presentation_unverifiable", "PIC_ATTESTATION", e.message); }
    if (!isObj(att) || att.attestation_version !== "PIC-ATT/1.0" || typeof att.expires_at !== "string" || !RFC3339_Z.test(att.expires_at)) {
      throw new Stop(7, "presentation_unverifiable", "PIC_ATTESTATION", "version or expires_at");
    }
    if (!(Date.parse(consumed_at) < Date.parse(att.expires_at))) throw new Stop(7, "presentation_unverifiable", "PIC_EXPIRED_AT_CONSUMPTION", "expires_at " + att.expires_at);
    if (att.args_digest !== r.args_digest || att.claims_digest !== r.claims_digest || att.intent_digest !== r.intent_digest || att.tool !== REFUND.tool || att.impact !== REFUND.impact) {
      throw new Stop(7, "action_digest_mismatch", "PIC_ATTESTATION_DIGESTS", "the cited attestation and the runner's result disagree");
    }

    // step 8: PIC action.args from the retained proposal, the APS payload, and the three PIC digests recomputed here.
    // PIC args_digest is never compared with APS payload_ref (different domains).
    const ap = refundArgsProblem(prop.action.args);
    if (ap) throw new Stop(8, "outside_grant", "PIC_ARGS_SCHEMA", ap);
    if (jcs(prop.action.args) !== jcs(payload)) throw new Stop(8, "action_digest_mismatch", "PIC_ARGS_NOT_PAYLOAD", "PIC action.args and aps-payload.json differ");
    if (sha256hex(Buffer.from(jcs(payload), "utf8")) !== r.args_digest) throw new Stop(8, "action_digest_mismatch", "ARGS_DIGEST", "PIC canonical digest of the payload is not args_digest");
    if (sha256hex(Buffer.from(jcs(prop.claims), "utf8")) !== r.claims_digest) throw new Stop(8, "action_digest_mismatch", "CLAIMS_DIGEST", "claims_digest");
    if (sha256hex(Buffer.from(prop.intent, "utf8")) !== r.intent_digest) throw new Stop(8, "action_digest_mismatch", "INTENT_DIGEST", "intent_digest");

    out.verified = true;
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    out.reason = e.reason; out.step = e.step; out.code = e.code; out.detail = e.detail;
  }
  return out;
}

export function readCaseDir(dir) {
  const files = {};
  for (const f of FILES) {
    if (statSafe(join(dir, f))) files[f] = new Uint8Array(readFileSync(join(dir, f)));   // a missing file is left out; step 0 names it
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const a = process.argv.slice(2);
  const arg = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  if (a[0] === "--pins") {
    const p = await pinnedSdk();
    console.log("agent-passport-system " + p.version + " tree " + p.tree + " matches PINS.json");
  } else if (a.includes("--case")) {
    const r = await checkRefundCase({ files: readCaseDir(arg("--case")), run_id: arg("--run-id"), consumed_at: arg("--consumed-at") });
    console.log(JSON.stringify(r, null, 1));
    process.exit(r.verified ? 0 : 1);
  } else {
    console.log("usage: node adapter_aps_receipt.mjs --case <dir> --run-id <id> --consumed-at <utc ms> | --pins");
    process.exit(2);
  }
}
