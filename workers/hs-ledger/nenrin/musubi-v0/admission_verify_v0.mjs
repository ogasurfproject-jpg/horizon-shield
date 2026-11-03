#!/usr/bin/env node
// MUSUBI admission records, the verifying side, in a second runtime: the twin of admission_verify_v0.py.
//
// admission_verify_v0.py is the reference and says what each function is for. This file gives the same verdicts, the
// same refusal codes and the same digests for the same records; admission_verify_v0.py --selftest runs both over the
// fixture and compares. The implementation of a relying party's door is not public and is not needed to check a
// record.
//
// Reading. A record is checked from its bytes with verifyAdmissionText, which reads them with parseStrict of
// ../agreement-v0/agreement_canonical.mjs: a duplicate key is unreadable (malformed), as it is for Python's
// parse_strict, and an integer in the text arrives as a BigInt while a number written with a fraction or an exponent
// (970200.0, 9.702e5) arrives as a plain number, which is a float in Python and is malformed in both. JSON.parse
// cannot do either: it keeps the last of two keys and reads 970200.0 as 970200. verifyAdmission takes a record that
// already came from parseStrict (integers as BigInt).
//
//   node admission_verify_v0.mjs --check fixtures/admission_intake/cases.json     prints what it reads from the fixture, as JSON
//   node admission_verify_v0.mjs --verify-texts < cases.json     {contract_canonical, relying_pub_b64, records: {name: text}}: each verdict
import { readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { canonical } from "./canonical_v0.mjs";
import { parseStrict } from "../agreement-v0/agreement_canonical.mjs";
import * as ce from "./clause_eval_v0.mjs";

export const SCHEMA = "a2a-admission-v0";
export const VERSION = "0.1";
export const VERSION_IMMUNE = "0.2";
export const VERSION_CONTENT = "0.3";
export const REVOKE_SCHEMA = "a2a-revocation-v0";
export const PREIMAGE_PROFILE = "a2a-admission-v0/action";
export const DECISIONS = ["admit", "escalate", "refuse"];
export const REASONS = ["within_grant", "conditional_needs_approval", "prohibited_action", "outside_grant", "amount_over_limit",
  "delegation_exceeds_parent", "contract_expired", "nonce_reused", "grant_revoked", "key_revoked",
  "presentation_unverifiable", "signer_not_on_own_domain", "action_digest_mismatch",
  "content_flagged", "content_unchecked", "exposure_full"];
export const REASONS_V02 = [...REASONS, "immune_hold", "immune_reject"];
export const IMMUNE_RULES = "a2a-immune-v0";
export const IMMUNE_VERDICTS = ["clear", "flagged", "released", "hold", "reject", "not_run"];
export const IMMUNE_REJECT_CODES = ["receptor_closed", "indicator_match", "hold_expired", "terms_malformed", "vetoed"];
export const IMMUNE_HOLD_CODES = ["unmarked_from_content", "unmarked_novel", "inflamed", "exposure_full", "cooling_off"];
export const IMMUNE_FLAG_CODES = ["unmarked_from_content", "unmarked_novel", "indicator_seen"];
const IMMUNE_KEYS = ["rules", "evaluator_sha256", "terms_sha256", "verdict", "codes", "evidence_sha256", "second_signal"];
export const REASONS_V03 = [...REASONS_V02, "content_scope_conflict"];
export const CONTENT_RULES = "a2a-content-check-v0";
export const CONTENT_VERDICTS = ["instruction", "none"];
export const CONTENT_CONFLICTS = ["none", "forbidden_by_rule", "skips_required_step", "outside_task"];
const CONTENT_KEYS = ["rules", "input_sha256", "check_sha256", "rules_sha256", "scope_sha256", "verdict", "scope_conflict", "answered", "checked"];
const CONTENT_REASONS = ["content_flagged", "content_scope_conflict", "content_unchecked"];
export const VERSION_CONTENT_V04 = "0.4";
export const REASONS_V04 = [...REASONS_V03, "content_off_topic"];
export const CONTENT_RULES_V04 = "a2a-content-check-v1";
export const CONTENT_DECISIONS_V04 = ["stop", "pass"];
export const CONTENT_MARKS_V04 = ["off_topic", "rule_conflict"];
const CONTENT_KEYS_V04 = ["rules", "input_commit", "check_sha256", "rules_sha256", "scope_sha256", "decision", "marks", "unread", "answered", "checked"];
const CONTENT_VERSIONS = [VERSION_CONTENT, VERSION_CONTENT_V04];
export const DOES_NOT_ESTABLISH_V0 = [
  "that HS allowed or blocked anything; the relying party ran the function at its own door",
  "that the agent is who it claims to be beyond what the presented signatures and keys on its own domain show",
  "that a revocation published after the chain view was known at admission time",
  "that the action was lawful, safe or wise; only that it was inside or outside the signed grant",
  "that this record is a legal authorization or determines liability"];
export const DOES_NOT_ESTABLISH = [
  DOES_NOT_ESTABLISH_V0[0],
  DOES_NOT_ESTABLISH_V0[1],
  "when a revocation without an anchor was issued, or that no revocation exists beyond those in revocations_seen; a revocation the "
    + "principal signed is obeyed with or without an anchor, and its time is not proven until it is anchored",
  DOES_NOT_ESTABLISH_V0[3],
  DOES_NOT_ESTABLISH_V0[4]];
export const DOES_NOT_ESTABLISH_V02 = [...DOES_NOT_ESTABLISH,
  "that the immune rules stopped every harmful act; a clear verdict says only that no rule in the contract's immune terms fired on the request as "
    + "presented, and the values it read are not in this record"];
export const DOES_NOT_ESTABLISH_V03 = [...DOES_NOT_ESTABLISH_V02,
  "that any content check ran, or that the same check would answer the same way again; the record carries the digests of the bytes the relying "
    + "party says it checked and of the verdict it says it read, the identifier of the rule set, and the flags, and nothing else about the content"];
export const DOES_NOT_ESTABLISH_V04 = [...DOES_NOT_ESTABLISH_V02,
  "that any content check ran, or that the same check would answer the same way again; the record carries a salted commitment to the bytes the "
    + "relying party says it checked (only a holder of the bytes and the salt can recompute it), the digest of the check it says it read, the "
    + "identifier of the rule set, the decision and the marks, and nothing else about the content",
  "that the rates measured for the named rule set hold on this contract's scope; they were measured on the scopes of public datasets, not on "
    + "a scope rendered from a contract"];
const RECORD_KEYS = ["schema", "admission_id", "relying_party", "contract_ref", "action_ref", "presentation_ref", "chain_view",
  "revocations_seen", "decision", "reasons", "clause", "rules", "establishes", "does_not_establish", "signatures"];
const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;                         // the reference reads "\Z" (no trailing newline), and so does this

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const get = (o, k) => (isObj(o) && has(o, k) && o[k] !== undefined ? o[k] : null);
const body = (rec, drop) => Object.fromEntries(Object.entries(rec).filter(([k]) => !drop.includes(k)));
const ctx = (name, obj) => Buffer.concat([ce.utf8(name + "\n"), ce.utf8(canonical(obj))]);
const tryOr = (f, fallback) => { try { return f(); } catch (_e) { return fallback; } };

// ---- the action request ----
export function actionPreimage(csha, req) {
  const a = isObj(req.action) ? req.action : {};
  return { contract_sha256: csha, action: a.action ?? null, target: a.target ?? null, amount: a.amount ?? null,
    nonce: req.nonce ?? null, expiry_height: req.expiry_height ?? null };
}
export const actionDigest = (csha, req) => ce.sha256Hex(ce.utf8(canonical(actionPreimage(csha, req))));
export const actionBinding = (csha, req) => ({ type: "canonical_request_digest", canonicalization: "musubi-canonical-v0", preimage_profile: PREIMAGE_PROFILE,
  digest: { alg: "sha-256", value: actionDigest(csha, req) } });
export function requestShapeOk(req) {
  const a = isObj(req) ? req.action : null;
  return isObj(req) && isObj(a) && typeof a.action === "string"
    && (a.target === null || a.target === undefined || typeof a.target === "string")
    && (a.amount === null || a.amount === undefined || (ce.isInt(a.amount) && a.amount >= 0))
    && typeof req.nonce === "string" && HEX32.test(req.nonce)
    && ce.isInt(req.expiry_height) && req.expiry_height >= 0
    && isObj(req.requester) && ["principal", "contractor"].includes(req.requester.role)
    && isObj(req.contract_ref);
}
export function requestSigned(contract, req) {
  const key = ce.partyKey(contract, req.requester.role);
  if (!key) return false;
  const msg = ctx("a2a-action-request-v0", body(req, ["signatures"]));
  return (Array.isArray(req.signatures) ? req.signatures : []).some((s) => isObj(s) && s.role === req.requester.role && ce.ed25519Verify(key, s.sig_b64, msg));
}

// ---- the principal's revocation record ----
export const revocationSigningBytes = (rec) => ctx(REVOKE_SCHEMA, body(rec, ["signatures", "anchor"]));
export function revocationSignedByPrincipal(contract, rec) {
  return tryOr(() => {
    if (!(isObj(rec) && rec.schema === REVOKE_SCHEMA && rec.revoked_by === "principal")) return false;
    const pk = ce.partyKey(contract, "principal");
    if (get(get(rec, "contract_ref"), "contract_sha256") !== ce.contractSha256(contract) || !pk) return false;
    const msg = revocationSigningBytes(rec);
    return (Array.isArray(rec.signatures) ? rec.signatures : []).some((s) => isObj(s) && s.role === "principal" && ce.ed25519Verify(pk, s.sig_b64, msg));
  }, false);
}

// ---- the record ----
export const admissionSigningBytes = (record) => ctx(SCHEMA, body(record, ["signatures"]));
export const admissionSha256 = (record) => ce.sha256Hex(admissionSigningBytes(record));
function hostOf(url) {
  // [0-9], not \p{Nd}: that follows the Unicode version of the runtime (Python's \d its own), and the intake reads ASCII
  const m = typeof url === "string" ? /^https:\/\/([A-Za-z0-9.-]+)(?::[0-9]+)?\//.exec(url) : null;
  return m ? m[1].toLowerCase() : null;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);           // only for arrays of strings
const sameStrings = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

// admission_verify_v0.immune_problems: a v0.2 record's immune block, its shape and its agreement with the decision.
export function immuneProblems(record) {
  const im = get(record, "immune"), reasons = get(record, "reasons"), d = get(record, "decision");
  if (!isObj(im) || !same(Object.keys(im).sort(), [...IMMUNE_KEYS].sort()) || im.rules !== IMMUNE_RULES || !Array.isArray(reasons)) return ["malformed"];
  const v = im.verdict, codes = im.codes, ts = im.terms_sha256;
  const all = [...IMMUNE_REJECT_CODES, ...IMMUNE_HOLD_CODES, ...IMMUNE_FLAG_CODES];
  const sortedUnique = Array.isArray(codes) && codes.every((c) => typeof c === "string") && same(codes, [...new Set(codes)].sort());
  let ok = IMMUNE_VERDICTS.includes(v) && sortedUnique && codes.every((c) => all.includes(c))
    && typeof im.evaluator_sha256 === "string" && HEX64.test(im.evaluator_sha256)
    && typeof im.evidence_sha256 === "string" && HEX64.test(im.evidence_sha256)
    && ((v === "not_run") === (ts === null)) && (ts === null || (typeof ts === "string" && HEX64.test(ts)))
    && (im.second_signal === null || im.second_signal === "witnesses") && ((v === "released") === (im.second_signal === "witnesses"));
  if (!ok) return ["malformed"];
  const holdR = reasons.includes("immune_hold"), rejR = reasons.includes("immune_reject");
  const within = (set) => codes.length > 0 && codes.every((c) => set.includes(c));
  if (v === "reject") ok = d === "refuse" && rejR && !holdR && codes.some((c) => IMMUNE_REJECT_CODES.includes(c));
  else if (v === "hold") ok = (d === "escalate" || d === "refuse") && holdR && !rejR && codes.some((c) => IMMUNE_HOLD_CODES.includes(c))
    && within([...IMMUNE_HOLD_CODES, ...IMMUNE_FLAG_CODES]);
  else if (v === "released") ok = !holdR && !rejR && within([...IMMUNE_HOLD_CODES, ...IMMUNE_FLAG_CODES]);
  else if (v === "flagged") ok = !holdR && !rejR && within(IMMUNE_FLAG_CODES);
  else ok = !holdR && !rejR && codes.length === 0;
  return ok ? [] : ["immune_inconsistent"];
}

// admission_verify_v0.content_problems: a v0.3 record's content block, its shape and the seven rules that tie its flags
// to the decision and reasons. Digests and flags only; the content is never in the record.
export function contentProblems(record) {
  const c = get(record, "content"), reasons = get(record, "reasons"), d = get(record, "decision");
  if (!isObj(c) || !same(Object.keys(c).sort(), [...CONTENT_KEYS].sort()) || c.rules !== CONTENT_RULES || !Array.isArray(reasons)) return ["malformed"];
  const hexNull = (k) => c[k] === null || (typeof c[k] === "string" && HEX64.test(c[k]));
  const v = c.verdict, sc = c.scope_conflict, ans = c.answered, chk = c.checked;
  if (!(["input_sha256", "check_sha256", "rules_sha256", "scope_sha256"].every(hexNull) && (v === null || CONTENT_VERDICTS.includes(v))
    && (sc === null || CONTENT_CONFLICTS.includes(sc)) && typeof ans === "boolean" && typeof chk === "boolean")) return ["malformed"];
  const r = new Set(reasons);
  const ok = (chk || (v === null && sc === null && r.has("content_unchecked")))                                  // 1 unchecked: no flags
    && (!chk || ["input_sha256", "check_sha256", "rules_sha256"].every((k) => c[k] !== null))                 // 2 checked: three digests
    && (ans || (v === null && sc === null && r.has("content_unchecked")))                                     // 3 no answer: no flags
    && ((v === "instruction") === r.has("content_flagged"))                                                   // 4 the verdict flag
    && ((sc !== null && sc !== "none") === r.has("content_scope_conflict"))                                   // 5 the scope flag
    && (c.scope_sha256 !== null || sc === null)                                                               // 6 no scope, no conflict
    && (d !== "admit" || !CONTENT_REASONS.some((x) => r.has(x)));                                             // 7 an admit carries none
  return ok ? [] : ["malformed"];
}

// admission_verify_v0.content_problems_v04: a v0.4 record's content block (A7.4: decision, marks, unread, answered, checked,
// input_commit) and rules 1 to 9 of the 0.4 content block. Fields only; the content and its salt are never in the record.
export function contentProblemsV04(record) {
  const c = get(record, "content"), reasons = get(record, "reasons"), d = get(record, "decision");
  if (!isObj(c) || !same(Object.keys(c).sort(), [...CONTENT_KEYS_V04].sort()) || c.rules !== CONTENT_RULES_V04 || !Array.isArray(reasons)) return ["malformed"];
  const hexNull = (k) => c[k] === null || (typeof c[k] === "string" && HEX64.test(c[k]));
  const dec = c.decision, mk = c.marks, un = c.unread, ans = c.answered, chk = c.checked;
  if (!(["input_commit", "check_sha256", "rules_sha256", "scope_sha256"].every(hexNull) && (dec === null || CONTENT_DECISIONS_V04.includes(dec))
    && Array.isArray(mk) && mk.every((m) => typeof m === "string") && same(mk, CONTENT_MARKS_V04.filter((m) => mk.includes(m)))
    && typeof un === "boolean" && typeof ans === "boolean" && typeof chk === "boolean")) return ["malformed"];
  const r = new Set(reasons);
  const nothing = dec === null && mk.length === 0 && un === false;
  const ok = (chk || (nothing && ans === false && r.has("content_unchecked")))                                  // 1 unchecked: nothing read
    && (!chk || ["input_commit", "check_sha256", "rules_sha256"].every((k) => c[k] !== null))                 // 2 checked: three digests
    && (ans || (nothing && r.has("content_unchecked")))                                                       // 3 no answer: no decision
    && (ans === false || dec !== null)                                                                        // 3 an answer has a decision
    && ((dec === "stop") === r.has("content_flagged"))                                                        // 4 the stop
    && (mk.includes("rule_conflict") === r.has("content_scope_conflict"))                                     // 5 rule_conflict
    && (mk.includes("off_topic") === r.has("content_off_topic"))                                              // 6 off_topic
    && ((un || !ans || !chk) === r.has("content_unchecked"))                                                  // 7 unread or no answer
    && (dec !== "stop" || (mk.length === 0 && un === false))                                                  // 8 a stop has no marks and is read
    && (!un || dec === "pass")                                                                                // 8 unread is a pass
    && (mk.length === 0 || c.scope_sha256 !== null)                                                           // a mark needs the scope
    && (d !== "admit" || !["content_flagged", "content_scope_conflict", "content_unchecked"].some((x) => r.has(x)));   // 9 an admit carries only off_topic
  return ok ? [] : ["malformed"];
}

const MAX_SAFE = 2 ** 53 - 1;
const MAX_SAFE_BIG = BigInt(MAX_SAFE);
const safeBig = (v) => typeof v === "bigint" && v <= MAX_SAFE_BIG && v >= -MAX_SAFE_BIG;
// admission_verify_v0.numbers_ok, over what parseStrict yields: every number an integer (a BigInt) within 2^53 - 1.
// A plain number is a float in the text (970200.0 or 9.702e5 included); a number past 2^53 - 1 could not be told
// from its neighbour.
export function numbersOk(x) {
  const stack = [x];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === "number") return false;
    if (typeof v === "bigint") { if (!safeBig(v)) return false; }
    else if (Array.isArray(v)) stack.push(...v);
    else if (isObj(v)) stack.push(...Object.values(v));
  }
  return true;
}
// admission_verify_v0.proto_key: an own key "__proto__" anywhere. parseStrict cannot keep one (it becomes the
// prototype or is dropped), so verifyAdmissionText asks JSON.parse, which keeps it as a key.
export function protoKey(x) {
  const stack = [x];
  while (stack.length) {
    const v = stack.pop();
    if (Array.isArray(v)) stack.push(...v);
    else if (isObj(v)) { if (has(v, "__proto__")) return true; stack.push(...Object.values(v)); }
  }
  return false;
}

// admission_verify_v0.immune_binding_problems: with a contract that carries immune terms, the record must carry their
// verdict over those terms, and not_run only on a refusal.
export function immuneBindingProblems(record, contract) {
  const terms = isObj(get(contract, "requirements")) ? get(contract.requirements, "immune") : undefined;
  if (!isObj(terms)) return [];
  const ver = get(get(record, "rules"), "version");
  if ((ver !== VERSION_IMMUNE && !CONTENT_VERSIONS.includes(ver)) || !isObj(get(record, "immune"))) return ["immune_missing"];
  const im = record.immune;
  if (get(im, "verdict") === "not_run") return get(record, "decision") === "refuse" ? [] : ["immune_not_run"];
  if (get(im, "terms_sha256") !== createHash("sha256").update(canonical(terms), "utf8").digest("hex")) return ["immune_terms_not_this_contracts"];
  return [];
}

// {verdict: "accepted" | "refused", refusals: [codes, sorted]}: admission_verify_v0.verify_admission_text, over the
// record's bytes. Text parseStrict cannot read (not JSON, a duplicate key, nested too deep) is malformed.
// admission_verify_v0.text_problem: a key outside printable ASCII (canonical_v0.mjs rule 2 throws on it), or a lone
// surrogate in any key or string (rule 7; agreement_canonical.mjs, which the intake uses, writes it raw).
const KEY_OK = /^[\x20-\x7e]*$/;
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export function textProblem(x) {
  const stack = [x];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === "string") { if (LONE.test(v)) return true; }
    else if (Array.isArray(v)) stack.push(...v);
    else if (isObj(v)) {
      for (const k of Object.keys(v)) if (!KEY_OK.test(k)) return true;
      stack.push(...Object.values(v));
    }
  }
  return false;
}

export function verifyAdmissionText(text, relyingKeyB64, contract = null) {
  // a lone surrogate in the text itself (not an escape) has no UTF-8 form: not bytes anyone sent
  if (typeof text !== "string" || LONE.test(text)) return { verdict: "refused", refusals: ["malformed"] };
  let record;
  try { record = parseStrict(text); } catch (_e) { return { verdict: "refused", refusals: ["malformed"] }; }
  // JSON.parse refuses NaN and Infinity, which parseStrict reads; such a record is already malformed and unsignable
  const proto = tryOr(() => protoKey(JSON.parse(text)), false);
  return verifyParsed(record, relyingKeyB64, contract, proto);
}

// admission_verify_v0.verify_admission, for a record that already came from parseStrict (integers as BigInt). A
// record from JSON.parse is not that: its integers are plain numbers, which read here as floats.
export function verifyAdmission(record, relyingKeyB64, contract = null) {
  return verifyParsed(record, relyingKeyB64, contract, protoKey(record));
}

function verifyParsed(record, relyingKeyB64, contract, proto) {
  if (!isObj(record) || get(record, "schema") !== SCHEMA) return { verdict: "refused", refusals: ["malformed"] };
  const ref = new Set();
  // a float, an integer past 2^53 - 1 or a "__proto__" key: no canonical form both runtimes write, so no signed bytes
  const signable = numbersOk(record) && !proto && !textProblem(record);
  if (!signable) ref.add("malformed");
  const hgt = get(isObj(get(record, "chain_view")) ? record.chain_view : {}, "height");
  if (!(safeBig(hgt) && hgt >= 0n)) ref.add("malformed");
  const keys = Object.keys(record);
  if (!isObj(get(record, "rules"))) ref.add("malformed");
  if (!isObj(get(record, "contract_ref"))) ref.add("malformed");
  const rules = isObj(get(record, "rules")) ? record.rules : {};
  const version = get(rules, "version");
  const want = CONTENT_VERSIONS.includes(version) ? [...RECORD_KEYS, "immune", "content"] : version === VERSION_IMMUNE ? [...RECORD_KEYS, "immune"] : RECORD_KEYS;
  if (keys.some((k) => !want.includes(k) && k !== "publication") || !want.every((k) => has(record, k))
    || (has(record, "publication") && record.publication !== "public")) ref.add("malformed");
  const rp = isObj(get(record, "relying_party")) ? record.relying_party : {};
  const dom = typeof get(rp, "domain") === "string" ? rp.domain : null;
  const reasons = get(record, "reasons");
  const allowed = version === VERSION_CONTENT_V04 ? REASONS_V04 : version === VERSION_CONTENT ? REASONS_V03 : version === VERSION_IMMUNE ? REASONS_V02 : REASONS;
  if (!DECISIONS.includes(get(record, "decision")) || !Array.isArray(reasons) || !reasons.length || reasons.some((r) => !allowed.includes(r))) ref.add("malformed");
  if (version !== null && version !== VERSION && version !== VERSION_IMMUNE && !CONTENT_VERSIONS.includes(version)) ref.add("malformed");
  if (has(rules, "version") && rules.version === null) ref.add("malformed");   // an explicit null is not v0
  if ((version === VERSION_IMMUNE || CONTENT_VERSIONS.includes(version)) && has(record, "immune")) for (const c of immuneProblems(record)) ref.add(c);
  if (version === VERSION_CONTENT && has(record, "content")) for (const c of contentProblems(record)) ref.add(c);
  if (version === VERSION_CONTENT_V04 && has(record, "content")) for (const c of contentProblemsV04(record)) ref.add(c);
  const dne = get(record, "does_not_establish");
  const stated = version === VERSION_CONTENT_V04 ? DOES_NOT_ESTABLISH_V04 : version === VERSION_CONTENT ? DOES_NOT_ESTABLISH_V03 : version === VERSION_IMMUNE ? DOES_NOT_ESTABLISH_V02
    : version === VERSION ? DOES_NOT_ESTABLISH : DOES_NOT_ESTABLISH_V0;
  if (!Array.isArray(dne)) ref.add("malformed");
  if (!sameStrings(dne, stated)) ref.add("does_not_establish_altered");
  if (!dom || hostOf(get(rp, "key_url")) !== dom.toLowerCase()) ref.add("signer_not_on_own_domain");
  if (!Array.isArray(get(record, "signatures"))) ref.add("malformed");
  const sigs = (Array.isArray(get(record, "signatures")) ? record.signatures : []).filter(isObj);
  const msg = signable ? tryOr(() => admissionSigningBytes(record), null) : null;
  if (signable && msg === null) ref.add("malformed");        // canonicalization threw: no canonical form, no signed bytes
  if (ce.b64Raw(relyingKeyB64, 32) === null || msg === null
    || !sigs.some((s) => get(s, "domain") === dom && get(s, "alg") === "ed25519" && ce.ed25519Verify(relyingKeyB64, get(s, "sig"), msg))) ref.add("bad_signature");
  if (isObj(contract)) {
    if (get(get(record, "contract_ref"), "contract_sha256") !== tryOr(() => ce.contractSha256(contract), undefined)) ref.add("other_contract");
    if (relyingKeyB64 === ce.partyKey(contract, "contractor")) ref.add("self_admission");
    for (const c of immuneBindingProblems(record, contract)) ref.add(c);
  }
  const refusals = [...ref].sort();
  return { verdict: refusals.length ? "refused" : "accepted", refusals };
}

let isMain = false;
try { isMain = import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch (_e) {}
if (isMain && process.argv.includes("--verify-texts")) {
  // stdin {contract_canonical, relying_pub_b64, records: {name: text}}: each record's verdict, read from its text
  const C = JSON.parse(readFileSync(0, "utf8"));
  const P = parseStrict(C.contract_canonical), out = {};
  for (const [k, text] of Object.entries(C.records)) out[k] = verifyAdmissionText(text, C.relying_pub_b64, P);
  process.stdout.write(JSON.stringify(out));
} else if (isMain && process.argv.includes("--check-immune")) {
  // the v0.2 fixture: every record's sha and verdict under the relying party's key and the contract
  const C = JSON.parse(readFileSync(process.argv[process.argv.indexOf("--check-immune") + 1], "utf8"));
  const P = parseStrict(C.contract_canonical), out = {};
  for (const [k, text] of Object.entries(C.records)) {
    out[k] = { sha: tryOr(() => admissionSha256(parseStrict(text)), null), relying: verifyAdmissionText(text, C.relying_pub_b64, P) };
  }
  process.stdout.write(JSON.stringify(out));
} else if (isMain) {
  const i = process.argv.indexOf("--check");
  if (i < 0) { console.error("usage: node admission_verify_v0.mjs --check fixtures/admission_intake/cases.json"); process.exit(1); }
  const C = JSON.parse(readFileSync(process.argv[i + 1], "utf8"));
  const P = parseStrict(C.contract_canonical), N = parseStrict(C.other_contract_canonical);
  const names = ["admission_public", "admission_private", "admission_refuse", "admission_revoked_without_anchor", "admission_brought_result", "admission_public_v0", "admission_signed_by_contractor"];
  const records = {};
  for (const k of names) {
    const rec = parseStrict(C[k]);
    records[k] = { sha: admissionSha256(rec), relying: verifyAdmissionText(C[k], C.relying_pub_b64, P), contractor: verifyAdmissionText(C[k], C.contractor_pub_b64, P),
      other: verifyAdmissionText(C[k], C.relying_pub_b64, N), edited: verifyAdmission({ ...rec, decision: "escalate" }, C.relying_pub_b64, P) };
  }
  const req = JSON.parse(C.action_request_public), csha = ce.contractSha256(P);   // the request functions read plain numbers
  process.stdout.write(JSON.stringify({ records,
    request: { shape: requestShapeOk(req), signed: requestSigned(P, req), digest: actionDigest(csha, req), binding: actionBinding(csha, req) },
    revocations: { grant: revocationSignedByPrincipal(P, JSON.parse(C.revocation_grant)), key: revocationSignedByPrincipal(P, JSON.parse(C.revocation_key)),
      by_contractor: revocationSignedByPrincipal(P, JSON.parse(C.revocation_by_contractor)), other_terms: revocationSignedByPrincipal(N, JSON.parse(C.revocation_grant)) } }) + "\n");
}
