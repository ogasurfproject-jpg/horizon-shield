// admission_intake.mjs: the intake for a2a-admission-v0 and a2a-revocation-v0 at ledger.horizonshield.dev
// (POST /admission, POST /revocation). It records and anchors. It decides nothing.
//
// What an operator of this intake does and does not do. A relying party ran admit() at its own door and signed the
// result. This intake checks that the bytes are canonical, that the signature is the relying party's and that the key
// is served on the relying party's own domain, stores the bytes under their sha256, and queues them for the daily
// batch that the agreement intake already anchors to Bitcoin. It does not run admit(), does not read the contract,
// and never says whether the action should have been admitted. That is settle v1.11's and v1.12's recomputation, done by anyone.
//
// Publication. Only the signer can make a record public (record-privacy-v1). An admission is stored only when its
// signed bytes say "publication": "public". A revocation is the principal's own act and carries hashes, no names; it
// is stored when the principal's signature verifies under the key the contract names and the principal's key_url
// serves.
//
// Storage is the agreement intake's (doStore in ../agreement-v0/agreement_intake.mjs): the same strongly consistent
// deduplication by sha256, the same pending pool, the same daily batch. Nothing new is anchored differently.
//
// Workers safe: Web Crypto only, no node: imports. The canonical form is the one rule the house has
// (musubi-canonical-v0, which agreement_canonical.mjs's canonicalUtf8 writes; the test holds the two together on
// records made by the Python reference).
import { parseStrict, canonicalUtf8, CanonicalError } from "../agreement-v0/agreement_canonical.mjs";
import { ed25519Verify } from "../agreement-v0/agreement_verify.mjs";

export const ADMISSION_INTAKE_VERSION = "admission-intake 0.5.0";
export const ADMISSION_SCHEMA = "a2a-admission-v0";
export const REVOCATION_SCHEMA = "a2a-revocation-v0";
export const MAX_BYTES = 65536;
export const RETRY_AFTER_SECONDS = 30;
export const PRIVACY_POLICY = "https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-verify-gate/ext/RECORD_PRIVACY_v1.md";
const DECISIONS = ["admit", "escalate", "refuse"];
const REASONS = ["within_grant", "conditional_needs_approval", "prohibited_action", "outside_grant", "amount_over_limit",
  "delegation_exceeds_parent", "contract_expired", "nonce_reused", "grant_revoked", "key_revoked",
  "presentation_unverifiable", "signer_not_on_own_domain", "action_digest_mismatch",
  "content_flagged", "content_unchecked", "exposure_full"];
const REASONS_V0_2 = [...REASONS, "immune_hold", "immune_reject"];
const REASONS_V0_3 = [...REASONS_V0_2, "content_scope_conflict"];
const REASONS_V0_4 = [...REASONS_V0_3, "content_off_topic"];
// v0.2 (2026-10-20) carries the immune block (immune_v0.py): digests and codes, no values. The intake checks its shape and
// that it agrees with the decision, the same rule as admission_verify_v0.immune_problems. It does not rerun the rules.
const IMMUNE_KEYS = ["codes", "evaluator_sha256", "evidence_sha256", "rules", "second_signal", "terms_sha256", "verdict"];
const IMMUNE_REJECT = ["receptor_closed", "indicator_match", "hold_expired", "terms_malformed", "vetoed"];
const IMMUNE_HOLD = ["unmarked_from_content", "unmarked_novel", "inflamed", "exposure_full", "cooling_off"];
const IMMUNE_FLAG = ["unmarked_from_content", "unmarked_novel", "indicator_seen"];
const H64 = /^[0-9a-f]{64}$/;
function immuneCodes(record) {
  const im = record.immune, r = record.reasons, d = record.decision;
  if (!isObj(im) || JSON.stringify(Object.keys(im).sort()) !== JSON.stringify(IMMUNE_KEYS) || im.rules !== "a2a-immune-v0" || !Array.isArray(r)) return ["malformed"];
  const v = im.verdict, c = im.codes, ts = im.terms_sha256;
  const sorted = Array.isArray(c) && c.every((x) => typeof x === "string") && JSON.stringify(c) === JSON.stringify([...new Set(c)].sort());
  let ok = ["clear", "flagged", "released", "hold", "reject", "not_run"].includes(v) && sorted && c.every((x) => IMMUNE_REJECT.includes(x) || IMMUNE_HOLD.includes(x) || IMMUNE_FLAG.includes(x))
    && typeof im.evaluator_sha256 === "string" && H64.test(im.evaluator_sha256) && typeof im.evidence_sha256 === "string" && H64.test(im.evidence_sha256)
    && ((v === "not_run") === (ts === null)) && (ts === null || (typeof ts === "string" && H64.test(ts)))
    && (im.second_signal === null || im.second_signal === "witnesses") && ((v === "released") === (im.second_signal === "witnesses"));
  if (!ok) return ["malformed"];
  const h = r.includes("immune_hold"), j = r.includes("immune_reject"), within = (set) => c.length > 0 && c.every((x) => set.includes(x));
  if (v === "reject") ok = d === "refuse" && j && !h && c.some((x) => IMMUNE_REJECT.includes(x));
  else if (v === "hold") ok = (d === "escalate" || d === "refuse") && h && !j && c.some((x) => IMMUNE_HOLD.includes(x)) && within([...IMMUNE_HOLD, ...IMMUNE_FLAG]);
  else if (v === "released") ok = !h && !j && within([...IMMUNE_HOLD, ...IMMUNE_FLAG]);
  else if (v === "flagged") ok = !h && !j && within(IMMUNE_FLAG);
  else ok = !h && !j && c.length === 0;
  return ok ? [] : ["immune_inconsistent"];
}
// v0.3 (2026-10-27) carries immune and the content block: what the relying party says its content check read, as digests
// and flags. The intake checks its shape and its seven rules, the same as admission_verify_v0.content_problems. It never sees the content.
const CONTENT_KEYS = ["answered", "check_sha256", "checked", "input_sha256", "rules", "rules_sha256", "scope_conflict", "scope_sha256", "verdict"];
const CONTENT_CONFLICTS = ["none", "forbidden_by_rule", "skips_required_step", "outside_task"];
const CONTENT_REASONS = ["content_flagged", "content_scope_conflict", "content_unchecked"];
function contentCodes(record) {
  const c = record.content, r = record.reasons, d = record.decision;
  if (!isObj(c) || JSON.stringify(Object.keys(c).sort()) !== JSON.stringify(CONTENT_KEYS) || c.rules !== "a2a-content-check-v0" || !Array.isArray(r)) return ["malformed"];
  const hexNull = (k) => c[k] === null || (typeof c[k] === "string" && H64.test(c[k]));
  const v = c.verdict, sc = c.scope_conflict, ans = c.answered, chk = c.checked;
  if (!(["input_sha256", "check_sha256", "rules_sha256", "scope_sha256"].every(hexNull) && (v === null || v === "instruction" || v === "none")
    && (sc === null || CONTENT_CONFLICTS.includes(sc)) && typeof ans === "boolean" && typeof chk === "boolean")) return ["malformed"];
  const ok = (chk || (v === null && sc === null && r.includes("content_unchecked")))
    && (!chk || ["input_sha256", "check_sha256", "rules_sha256"].every((k) => c[k] !== null))
    && (ans || (v === null && sc === null && r.includes("content_unchecked")))
    && ((v === "instruction") === r.includes("content_flagged"))
    && ((sc !== null && sc !== "none") === r.includes("content_scope_conflict"))
    && (c.scope_sha256 !== null || sc === null)
    && (d !== "admit" || !CONTENT_REASONS.some((x) => r.includes(x)));
  return ok ? [] : ["malformed"];
}
// v0.4 (2026-11-01) carries immune and the content block in the shape of FURUI A7.4: a salted commitment to the content
// (input_commit), the digests of the check and the rule set, the decision, the marks, unread, answered and checked. The
// intake checks its shape and its nine rules, the same as admission_verify_v0.content_problems_v04. It never sees the content.
const CONTENT_KEYS_V04 = ["answered", "check_sha256", "checked", "decision", "input_commit", "marks", "rules", "rules_sha256", "scope_sha256", "unread"];
const MARKS_V04 = ["off_topic", "rule_conflict"];
function contentCodesV04(record) {
  const c = record.content, r = record.reasons, d = record.decision;
  if (!isObj(c) || JSON.stringify(Object.keys(c).sort()) !== JSON.stringify(CONTENT_KEYS_V04) || c.rules !== "a2a-content-check-v1" || !Array.isArray(r)) return ["malformed"];
  const hexNull = (k) => c[k] === null || (typeof c[k] === "string" && H64.test(c[k]));
  const dec = c.decision, mk = c.marks, un = c.unread, ans = c.answered, chk = c.checked;
  if (!(["input_commit", "check_sha256", "rules_sha256", "scope_sha256"].every(hexNull) && (dec === null || dec === "stop" || dec === "pass")
    && Array.isArray(mk) && mk.every((m) => typeof m === "string") && JSON.stringify(mk) === JSON.stringify(MARKS_V04.filter((m) => mk.includes(m)))
    && typeof un === "boolean" && typeof ans === "boolean" && typeof chk === "boolean")) return ["malformed"];
  const has = (x) => r.includes(x);
  const nothing = dec === null && mk.length === 0 && un === false;
  const ok = (chk || (nothing && ans === false && has("content_unchecked")))
    && (!chk || ["input_commit", "check_sha256", "rules_sha256"].every((k) => c[k] !== null))
    && (ans || (nothing && has("content_unchecked")))
    && (ans === false || dec !== null)
    && ((dec === "stop") === has("content_flagged"))
    && (mk.includes("rule_conflict") === has("content_scope_conflict"))
    && (mk.includes("off_topic") === has("content_off_topic"))
    && ((un || !ans || !chk) === has("content_unchecked"))
    && (dec !== "stop" || (mk.length === 0 && un === false))
    && (!un || dec === "pass")
    && (mk.length === 0 || c.scope_sha256 !== null)
    && (d !== "admit" || !["content_flagged", "content_scope_conflict", "content_unchecked"].some(has));
  return ok ? [] : ["malformed"];
}
// v0.5 carries immune and the content block of more than one runner (a2a-content-check-v2): checks[] in runner_id order, one
// per runner, quorum {required, answered}, and the block's decision, marks, checked and disagreement_kind, which must be what
// checks[] and quorum.required give. The record's content_ reasons must be exactly the set they give; an admit needs the
// decision pass. The same rules as admission_verify_v0.content_problems_v05. It never sees the content and holds no policy.
const CONTENT_KEYS_V05 = ["checked", "checks", "decision", "disagreement_kind", "input_commit", "marks", "quorum", "rules", "runners_sha256", "scope_sha256"];
const CHECK_KEYS_V05 = ["answered", "check_sha256", "day", "decision", "key_id", "marks", "rules_sha256", "runner_id", "scope_sha256", "unread", "why"];
const WHY_V05 = ["ok", "no_envelope", "timeout", "capped", "signature", "rules_mismatch", "scope_mismatch", "commit_mismatch", "shape", "unread", "decision_null", "not_answered"];
const KINDS_V05 = ["n/a", "none", "decision", "marks", "both"];
const RUNNER_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const smallInt = (x, lo, hi) => (typeof x === "bigint" && x >= BigInt(lo) && x <= BigInt(hi)) || (Number.isSafeInteger(x) && x >= lo && x <= hi);
const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
function checkBadV05(k, scope) {
  if (!isObj(k) || JSON.stringify(Object.keys(k).sort()) !== JSON.stringify(CHECK_KEYS_V05)) return true;
  const hexNull = (x) => x === null || (typeof x === "string" && H64.test(x));
  const why = k.why, dec = k.decision, mk = k.marks, un = k.unread;
  if (!(typeof k.runner_id === "string" && RUNNER_ID.test(k.runner_id) && typeof k.key_id === "string" && RUNNER_ID.test(k.key_id)
    && typeof k.rules_sha256 === "string" && H64.test(k.rules_sha256) && hexNull(k.check_sha256) && hexNull(k.scope_sha256)
    && (k.day === null || (typeof k.day === "string" && DAY.test(k.day))) && WHY_V05.includes(why) && (dec === null || dec === "stop" || dec === "pass")
    && (un === true || un === false || un === null) && Array.isArray(mk) && mk.every((m) => typeof m === "string") && sameList(mk, MARKS_V04.filter((m) => mk.includes(m)))
    && typeof k.answered === "boolean")) return true;
  if (k.answered !== (why === "ok") || (k.scope_sha256 !== null && k.scope_sha256 !== scope)) return true;
  if (why === "ok") return !(dec !== null && k.check_sha256 !== null && un === false && (dec === "pass" || mk.length === 0) && (mk.length === 0 || k.scope_sha256 !== null));
  if (why === "unread") return !(dec === "pass" && un === true && k.check_sha256 !== null && (mk.length === 0 || k.scope_sha256 !== null));
  return !(dec === null && mk.length === 0 && un !== true);
}
function contentCodesV05(record) {
  const c = record.content, r = record.reasons, d = record.decision;
  if (!isObj(c) || JSON.stringify(Object.keys(c).sort()) !== JSON.stringify(CONTENT_KEYS_V05) || c.rules !== "a2a-content-check-v2" || !Array.isArray(r)) return ["malformed"];
  const hexNull = (k) => c[k] === null || (typeof c[k] === "string" && H64.test(c[k]));
  const q = c.quorum, ks = c.checks;
  if (!(["input_commit", "scope_sha256", "runners_sha256"].every(hexNull) && typeof c.checked === "boolean" && (c.decision === null || c.decision === "stop" || c.decision === "pass")
    && KINDS_V05.includes(c.disagreement_kind) && Array.isArray(c.marks) && isObj(q) && JSON.stringify(Object.keys(q).sort()) === JSON.stringify(["answered", "required"])
    && smallInt(q.required, 1, 64) && smallInt(q.answered, 0, 64) && Array.isArray(ks) && ks.length <= 64)) return ["malformed"];
  if (ks.some((k) => checkBadV05(k, c.scope_sha256))) return ["malformed"];
  for (let i = 1; i < ks.length; i++) if (!(ks[i - 1].runner_id < ks[i].runner_id)) return ["malformed"];
  const want = new Set(), marks = new Set(), ok = ks.filter((k) => k.why === "ok"), required = Number(q.required);
  for (const k of ks) {
    if (k.why === "ok" && k.decision === "stop") want.add("content_flagged");
    else if (k.why === "ok" || k.why === "unread") { for (const m of k.marks) marks.add(m); if (k.why === "unread") want.add("content_unchecked"); }
    else want.add("content_unchecked");
  }
  const answered = new Set(ok.map((k) => k.key_id)).size;
  if (answered < required) want.add("content_unchecked");
  if (marks.has("rule_conflict")) want.add("content_scope_conflict");
  if (marks.has("off_topic")) want.add("content_off_topic");
  const dec = ok.some((k) => k.decision === "stop") ? "stop" : answered >= required ? "pass" : null;
  let kind = "n/a";
  if (answered > 1) {
    const dd = new Set(ok.map((k) => k.decision)).size > 1, md = new Set(ok.filter((k) => k.decision === "pass").map((k) => k.marks.join(","))).size > 1;
    kind = dd && md ? "both" : dd ? "decision" : md ? "marks" : "none";
  }
  const have = ["content_flagged", "content_scope_conflict", "content_off_topic", "content_unchecked"].filter((x) => r.includes(x));
  const good = c.decision === dec && sameList(c.marks, MARKS_V04.filter((m) => marks.has(m))) && c.checked === (dec !== null) && Number(q.answered) === answered
    && c.disagreement_kind === kind && (!c.checked || c.input_commit !== null) && have.length === want.size && have.every((x) => want.has(x))
    && (d !== "admit" || (dec === "pass" && c.checked === true && !["content_flagged", "content_scope_conflict", "content_unchecked"].some((x) => r.includes(x))));
  return good ? [] : ["malformed"];
}
// The stated limits a record must carry, by the version of admit() that wrote it. A v0 record has no rules.version;
// a v0.1 record says "0.1" and states the limit about unanchored revocations. A record of one version carrying the
// other's list is refused, and so is a version this intake does not know.
const DOES_NOT_ESTABLISH_V0 = [
  "that HS allowed or blocked anything; the relying party ran the function at its own door",
  "that the agent is who it claims to be beyond what the presented signatures and keys on its own domain show",
  "that a revocation published after the chain view was known at admission time",
  "that the action was lawful, safe or wise; only that it was inside or outside the signed grant",
  "that this record is a legal authorization or determines liability"];
const DOES_NOT_ESTABLISH_V0_1 = [
  DOES_NOT_ESTABLISH_V0[0],
  DOES_NOT_ESTABLISH_V0[1],
  "when a revocation without an anchor was issued, or that no revocation exists beyond those in revocations_seen; a revocation the "
    + "principal signed is obeyed with or without an anchor, and its time is not proven until it is anchored",
  DOES_NOT_ESTABLISH_V0[3],
  DOES_NOT_ESTABLISH_V0[4]];
const DOES_NOT_ESTABLISH_V0_2 = [...DOES_NOT_ESTABLISH_V0_1,
  "that the immune rules stopped every harmful act; a clear verdict says only that no rule in the contract's immune terms fired on the request as "
    + "presented, and the values it read are not in this record"];
const DOES_NOT_ESTABLISH_V0_3 = [...DOES_NOT_ESTABLISH_V0_2,
  "that any content check ran, or that the same check would answer the same way again; the record carries the digests of the bytes the relying "
    + "party says it checked and of the verdict it says it read, the identifier of the rule set, and the flags, and nothing else about the content"];
const DOES_NOT_ESTABLISH_V0_4 = [...DOES_NOT_ESTABLISH_V0_2,
  "that any content check ran, or that the same check would answer the same way again; the record carries a salted commitment to the bytes the "
    + "relying party says it checked (only a holder of the bytes and the salt can recompute it), the digest of the check it says it read, the "
    + "identifier of the rule set, the decision and the marks, and nothing else about the content",
  "that the rates measured for the named rule set hold on this contract's scope; they were measured on the scopes of public datasets, not on "
    + "a scope rendered from a contract"];
const DOES_NOT_ESTABLISH_V0_5 = [...DOES_NOT_ESTABLISH_V0_2,
  "that any content check ran, or that the same checks would answer the same way again; the record carries a salted commitment to the bytes "
    + "the relying party says it sent to every runner (only a holder of the bytes and the salt can recompute it), the digest of each check it "
    + "says it read, the identifiers of the rule sets, each decision and its marks, and nothing else about the content",
  "that the rates measured for the named rule sets hold on this contract's scope; they were measured on the scopes of public datasets, not "
    + "on a scope rendered from a contract",
  "that the runners reached their answers apart from one another, or that their models, prompts or operators differ beyond the keys and "
    + "rule set digests the record names",
  "which runner's answer was right when the answers differ; disagreement_kind says only how they differ",
  "why a runner gave no answer when its check says timeout or capped; those two are the relying party's own account, and no signed "
    + "envelope shows them",
  "that a pass here means what a pass means in a v0.4 record; a v0.4 block says pass for a check that answered pass with part of the "
    + "content unread, while here such a runner is not counted as answered, so the block's decision may be null where v0.4 would say pass"];
export const LIMITS_BY_VERSION = { v0: DOES_NOT_ESTABLISH_V0, "0.1": DOES_NOT_ESTABLISH_V0_1, "0.2": DOES_NOT_ESTABLISH_V0_2, "0.3": DOES_NOT_ESTABLISH_V0_3,
  "0.4": DOES_NOT_ESTABLISH_V0_4, "0.5": DOES_NOT_ESTABLISH_V0_5 };
const RECORD_KEYS = ["schema", "admission_id", "relying_party", "contract_ref", "action_ref", "presentation_ref", "chain_view",
  "revocations_seen", "decision", "reasons", "clause", "rules", "establishes", "does_not_establish", "signatures"];
const REVOKE_KEYS = ["schema", "contract_ref", "revoked_by", "signatures"];

const enc = new TextEncoder();
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const sameStrings = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
// admission_verify_v0.numbers_ok over what parseStrict yields: every number an integer (a BigInt) within 2^53 - 1. A
// plain number is a float in the text; canonicalUtf8 writes it back as Python would, so the canonical check alone
// lets 0.5 or 2^60 through, and the verifier refuses both.
function numbersOk(x) {
  const stack = [x];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === "number") return false;
    if (typeof v === "bigint") { if (v > 9007199254740991n || v < -9007199254740991n) return false; }
    else if (Array.isArray(v)) stack.push(...v);
    else if (isObj(v)) stack.push(...Object.values(v));
  }
  return true;
}
// admission_verify_v0.text_problem: a key outside printable ASCII, or a lone surrogate in any key or string. canonicalUtf8
// writes both without complaint (a lone surrogate raw), and the verifiers find no canonical form for either.
const KEY_OK = /^[\x20-\x7e]*$/;
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
function textProblem(x) {
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
const body = (rec, drop) => Object.fromEntries(Object.entries(rec).filter(([k]) => !drop.includes(k)));
const res = (status, b, headers) => ({ status, body: b, headers: headers || {} });
async function sha256Hex(bytes) {
  const d = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const signingBytes = (context, obj) => enc.encode(context + "\n" + canonicalUtf8(obj));
function hostOf(url) {
  const m = typeof url === "string" ? /^https:\/\/([A-Za-z0-9.-]+)(?::[0-9]+)?\//.exec(url) : null;   // ASCII digits, as the verifiers
  return m ? m[1].toLowerCase() : null;
}

async function readBody(request) {
  let b;
  try { b = await request.json(); } catch { return { error: res(400, { error: "bad_json" }) }; }
  if (!isObj(b) || typeof b.record_canonical !== "string") return { error: res(400, { error: "record_canonical (string) required" }) };
  if (enc.encode(b.record_canonical).length > MAX_BYTES) return { error: res(413, { error: "too_large", max_bytes: MAX_BYTES }) };
  return { b };
}
function parseCanonical(text, what) {
  let record;
  try { record = parseStrict(text); } catch (e) {
    return { error: res(422, { error: "unparseable_record", reason_code: e instanceof CanonicalError ? e.code : "bad_json", stage: "parse",
      note: "the " + what + " could not be read as canonical JSON, so nothing was checked and nothing was stored" }) };
  }
  let again;
  try { again = canonicalUtf8(record); } catch { again = null; }
  if (again !== text) return { error: res(422, { error: "not_canonical", stage: "parse",
    note: "record_canonical must be the musubi-canonical-v0 bytes of the record (sorted keys, no whitespace); the sha256 this intake serves is over exactly those bytes" }) };
  return { record };
}
const refused = (codes, extra) => res(422, Object.assign({ status: "refused", refusals: codes,
  note: "not accepted, so not stored, not anchored, not served by sha" }, extra || {}));
const keyUnreachable = (ku, got) => res(503, { error: "key_url_unreachable", key_url: ku, why: (got && got.why) || "the key could not be fetched",
  retry_after_seconds: RETRY_AFTER_SECONDS, note: "a key that cannot be fetched is an unanswered question, not a bad record; retry later" },
  { "retry-after": String(RETRY_AFTER_SECONDS) });

async function storeAccepted(store, origin, kind, canonicalSha, payload, extra) {
  const claim = await store.claimAccepted(canonicalSha, payload);
  if (claim && claim.unbound) return res(503, { error: "dedupe_gate_unbound", retry_after_seconds: RETRY_AFTER_SECONDS,
    note: "the strongly consistent deduplication gate is not bound; refusing to store on eventually consistent storage. fail closed." },
    { "retry-after": String(RETRY_AFTER_SECONDS) });
  const url = origin + "/" + kind + "/" + canonicalSha;
  if (claim && claim.duplicate) return res(200, Object.assign({ status: (claim.stored && claim.stored.status) || "pending_anchor", dedup: true,
    verdict: "accepted", canonical_sha256: canonicalSha, url, note: "already recorded; one record per canonical_sha256" }, extra));
  if (store.queueForAnchor) { try { await store.queueForAnchor(canonicalSha, payload); } catch (_e) { /* served, just not queued */ } }
  return res(201, Object.assign({ status: "pending_anchor", verdict: "accepted", canonical_sha256: canonicalSha, url,
    anchor_policy: "recorded and served by sha now, and queued for the daily batch that anchors the accepted pool to Bitcoin at 00:30 UTC",
    does_not_establish: ["that this ledger agrees with the decision in the record; it stored what the relying party signed",
      "that the action was inside the grant; settle v1.11 recomputes that from the contract"] }, extra));
}

// POST /admission  {"record_canonical": "<musubi-canonical-v0 bytes of a signed a2a-admission-v0>"}
export async function handleAdmissionIntake(request, deps) {
  const { fetchKey, store, now = () => new Date().toISOString(), recorderDomain = null, rateLimit = null, origin = "https://ledger.horizonshield.dev" } = deps || {};
  const rb = await readBody(request);
  if (rb.error) return rb.error;
  if (rateLimit) { const rl = await rateLimit(); if (rl && rl.ok === false) return res(429, { error: rl.error || "rate_limited", cap: rl.cap, scope: rl.scope }); }
  const pc = parseCanonical(rb.b.record_canonical, "admission");
  if (pc.error) return pc.error;
  const record = pc.record;
  const codes = [];
  if (!isObj(record) || record.schema !== ADMISSION_SCHEMA) return refused(["malformed"], { why: "schema must be " + ADMISSION_SCHEMA });
  const keys = Object.keys(record);
  const rules = isObj(record.rules) ? record.rules : {};
  const version = Object.prototype.hasOwnProperty.call(rules, "version") ? rules.version : "v0";
  const want = version === "0.3" || version === "0.4" || version === "0.5" ? [...RECORD_KEYS, "immune", "content"] : version === "0.2" ? [...RECORD_KEYS, "immune"] : RECORD_KEYS;
  if (!want.every((k) => keys.includes(k)) || keys.some((k) => !want.includes(k) && k !== "publication")) codes.push("malformed");
  // the same shape rules as admission_verify_v0.verify_admission: every number a safe integer, and these fields of their type
  if (!numbersOk(record) || textProblem(record) || !isObj(record.rules) || !isObj(record.contract_ref) || !Array.isArray(record.does_not_establish)
    || !Array.isArray(record.signatures)) codes.push("malformed");
  const allowed = version === "0.4" || version === "0.5" ? REASONS_V0_4 : version === "0.3" ? REASONS_V0_3 : version === "0.2" ? REASONS_V0_2 : REASONS;
  if (!DECISIONS.includes(record.decision) || !Array.isArray(record.reasons) || !record.reasons.length || record.reasons.some((r) => !allowed.includes(r))) codes.push("malformed");
  if ((version === "0.2" || version === "0.3" || version === "0.4" || version === "0.5") && keys.includes("immune")) codes.push(...immuneCodes(record));
  if (version === "0.3" && keys.includes("content")) codes.push(...contentCodes(record));
  if (version === "0.4" && keys.includes("content")) codes.push(...contentCodesV04(record));
  if (version === "0.5" && keys.includes("content")) codes.push(...contentCodesV05(record));
  // the chain height a decision was made at is an integer (a float would let a door step outside the inflammation count)
  const cvh = isObj(record.chain_view) ? record.chain_view.height : undefined;
  // (the strict parser may hand integers over as BigInt)
  if (!((typeof cvh === "bigint" && cvh >= 0n && cvh <= 9007199254740991n) || (Number.isSafeInteger(cvh) && cvh >= 0))) codes.push("malformed");
  const stated = typeof version === "string" && Object.prototype.hasOwnProperty.call(LIMITS_BY_VERSION, version) ? LIMITS_BY_VERSION[version] : null;
  if (stated === null || version === "v0" && Object.prototype.hasOwnProperty.call(rules, "version")) codes.push("malformed");
  else if (!sameStrings(record.does_not_establish, stated)) codes.push("does_not_establish_altered");   // no JSON.stringify: a BigInt throws
  const rp = isObj(record.relying_party) ? record.relying_party : {};
  const dom = typeof rp.domain === "string" && rp.domain ? rp.domain : null;
  if (!dom || hostOf(rp.key_url) !== dom.toLowerCase()) codes.push("signer_not_on_own_domain");
  if (codes.length) return refused([...new Set(codes)].sort());
  if (record.publication !== "public") {
    return refused([Object.prototype.hasOwnProperty.call(record, "publication") ? "publication_not_public" : "publication_consent_missing"], {
      why: "this ledger stores only admissions whose signed bytes say \"publication\": \"public\"; only the signer can make its record public",
      how_to_publish: "write \"publication\": \"public\" into the record before signing it, and file the new canonical bytes",
      how_to_keep_private: "do not file it here. To fix its existence time without revealing it, timestamp its sha256 yourself",
      policy: PRIVACY_POLICY });
  }
  const got = await fetchKey(rp.key_url);
  if (!got || got.ok !== true || typeof got.key !== "string") return keyUnreachable(rp.key_url, got);
  const msg = signingBytes(ADMISSION_SCHEMA, body(record, ["signatures"]));
  let signed = false;
  for (const s of Array.isArray(record.signatures) ? record.signatures : []) {
    if (isObj(s) && s.domain === dom && s.alg === "ed25519" && (await ed25519Verify(got.key, s.sig, msg)) === true) { signed = true; break; }
  }
  if (!signed) return refused(["bad_signature"], { why: "no signature by " + dom + " verifies under the key its key_url serves" });
  const canonicalSha = await sha256Hex(enc.encode(rb.b.record_canonical));
  const admissionSha = await sha256Hex(msg);
  const nowVal = typeof now === "function" ? now() : now;
  const report = { record_schema: ADMISSION_SCHEMA, verdict: "accepted", canonical_sha256: canonicalSha, admission_sha256: admissionSha,
    relying_party: dom, decision: record.decision, admit_version: version === "v0" ? "0" : version, verifier_version: ADMISSION_INTAKE_VERSION,
    checked: ["canonical bytes", "closed lists for decision and reasons", "the stated limits are unaltered", "key_url on the relying party's own domain",
      ...(version === "0.2" || version === "0.3" || version === "0.4" || version === "0.5" ? ["the immune block's shape and its agreement with the decision and reasons (not the immune rules themselves)"] : []),
      ...(version === "0.3" ? ["the content block's shape and its seven rules against the decision and reasons (digests and flags only; the content is not sent here)"] : []),
      ...(version === "0.4" ? ["the content block's shape and its nine rules against the decision and reasons (a salted commitment, digests, the decision and the marks; the content is not sent here)"] : []),
      ...(version === "0.5" ? ["the content block's shape, its checks in runner_id order, and that its decision, marks, checked, quorum.answered, disagreement_kind and the record's content_ reasons are what its checks and quorum.required give (the content is not sent here; no policy is held)"] : []),
      "Ed25519 signature under the key that key_url serves", "signed consent to publication"],
    not_checked: ["the decision itself; this intake does not run admit() and does not hold the contract"] };
  const payload = { canonical_sha256: canonicalSha, record_canonical: rb.b.record_canonical, report, verifier_version: ADMISSION_INTAKE_VERSION,
    recorder_domain: recorderDomain, submitted_at: nowVal, status: "pending_anchor" };
  return storeAccepted(store, origin, "admission", canonicalSha, payload, { admission_sha256: admissionSha, report,
    how_to_cite: "an execution record names this admission by admission_sha256 (the sha256 of the bytes the relying party signed)" });
}

// POST /revocation  {"record_canonical": "<a2a-revocation-v0, principal signed>", "contract_canonical": "<the a2a-contract-v0 it revokes>"}
// The contract is needed to know whose key the principal's is. It is checked and then dropped: only the revocation is stored.
export async function handleRevocationIntake(request, deps) {
  const { fetchKey, store, now = () => new Date().toISOString(), recorderDomain = null, rateLimit = null, origin = "https://ledger.horizonshield.dev" } = deps || {};
  const rb = await readBody(request);
  if (rb.error) return rb.error;
  if (typeof rb.b.contract_canonical !== "string") return res(400, { error: "contract_canonical (string) required",
    note: "the contract names the principal's key; it is read to check the signature and is not stored" });
  if (enc.encode(rb.b.contract_canonical).length > MAX_BYTES) return res(413, { error: "too_large", max_bytes: MAX_BYTES });
  if (rateLimit) { const rl = await rateLimit(); if (rl && rl.ok === false) return res(429, { error: rl.error || "rate_limited", cap: rl.cap, scope: rl.scope }); }
  const pr = parseCanonical(rb.b.record_canonical, "revocation");
  if (pr.error) return pr.error;
  const pk = parseCanonical(rb.b.contract_canonical, "contract");
  if (pk.error) return pk.error;
  const rec = pr.record, contract = pk.record;
  const keys = isObj(rec) ? Object.keys(rec) : [];
  if (!isObj(rec) || rec.schema !== REVOCATION_SCHEMA || rec.revoked_by !== "principal" || !REVOKE_KEYS.every((k) => keys.includes(k))
    || keys.some((k) => !REVOKE_KEYS.includes(k) && k !== "revoked_key") || !isObj(rec.contract_ref)) return refused(["malformed"]);
  if (Object.prototype.hasOwnProperty.call(rec, "revoked_key") && !(isObj(rec.revoked_key) && typeof rec.revoked_key.public_key_ed25519_b64 === "string")) return refused(["malformed"]);
  if (!isObj(contract) || contract.schema !== "a2a-contract-v0" || !Array.isArray(contract.parties) || !Array.isArray(contract.signatures)) return refused(["contract_malformed"]);
  const contractMsg = signingBytes("a2a-contract-v0", body(contract, ["signatures"]));
  const contractSha = await sha256Hex(contractMsg);
  if (rec.contract_ref.contract_sha256 !== contractSha) return refused(["other_contract"], { why: "the revocation names contract_sha256 " + String(rec.contract_ref.contract_sha256) + ", the contract sent hashes to " + contractSha });
  for (const role of ["principal", "contractor"]) {
    const p = contract.parties.find((x) => isObj(x) && x.role === role);
    let ok = false;
    for (const s of p ? contract.signatures : []) {
      if (isObj(s) && s.domain === p.domain && s.alg === "ed25519" && (await ed25519Verify(p.public_key_ed25519_b64, s.signature, contractMsg)) === true) { ok = true; break; }
    }
    if (!ok) return refused(["contract_not_signed_by_both"]);
  }
  const principal = contract.parties.find((x) => isObj(x) && x.role === "principal");
  const pd = typeof principal.domain === "string" ? principal.domain.toLowerCase() : "";
  const kh = hostOf(principal.key_url);
  if (!pd || !kh || !(kh === pd || kh.endsWith("." + pd))) return refused(["signer_not_on_own_domain"]);
  const got = await fetchKey(principal.key_url);
  if (!got || got.ok !== true || typeof got.key !== "string") return keyUnreachable(principal.key_url, got);
  if (got.key !== principal.public_key_ed25519_b64) return refused(["key_url_serves_another_key"], { why: "the principal's key_url no longer serves the key the contract names" });
  const msg = signingBytes(REVOCATION_SCHEMA, body(rec, ["signatures", "anchor"]));
  let signed = false;
  for (const s of Array.isArray(rec.signatures) ? rec.signatures : []) {
    if (isObj(s) && s.role === "principal" && (await ed25519Verify(got.key, s.sig_b64, msg)) === true) { signed = true; break; }
  }
  if (!signed) return refused(["bad_signature"], { why: "the revocation is not signed by the contract's principal" });
  const canonicalSha = await sha256Hex(enc.encode(rb.b.record_canonical));
  const nowVal = typeof now === "function" ? now() : now;
  const report = { record_schema: REVOCATION_SCHEMA, verdict: "accepted", canonical_sha256: canonicalSha, contract_sha256: contractSha,
    revokes: Object.prototype.hasOwnProperty.call(rec, "revoked_key") ? "key" : "grant", principal: principal.domain, verifier_version: ADMISSION_INTAKE_VERSION,
    not_checked: ["whether any admission or execution came before or after it; the anchor height answers that"] };
  const payload = { canonical_sha256: canonicalSha, record_canonical: rb.b.record_canonical, report, verifier_version: ADMISSION_INTAKE_VERSION,
    recorder_domain: recorderDomain, submitted_at: nowVal, status: "pending_anchor" };
  return storeAccepted(store, origin, "revocation", canonicalSha, payload, { report,
    visible_from: "admit() v0.1 obeys this revocation as soon as the relying party holds it, anchored or not; the anchor proves when it existed, and until it is anchored that time is not proven" });
}

// GET /admission/{sha} and GET /revocation/{sha}: the exact stored bytes, so anyone can recompute the sha and the signature.
export async function handleStoredGet(kind, sha, deps) {
  const { store, origin = "https://ledger.horizonshield.dev" } = deps || {};
  const s = String(sha || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(s)) return res(400, { error: "bad_sha" });
  const stored = await store.getAccepted(s);
  const want = kind === "admission" ? ADMISSION_SCHEMA : REVOCATION_SCHEMA;
  if (!stored || !stored.report || stored.report.record_schema !== want) return res(404, { error: "not_found", canonical_sha256: s });
  let status = stored.status || "pending_anchor", ledgerEntry = null;
  if (store.anchorState) { const a = await store.anchorState(s); if (a && a.anchored) { status = "anchored"; ledgerEntry = a.ledger_entry; } }
  return res(200, { canonical_sha256: s, record_canonical: stored.record_canonical, report: stored.report, status, ledger_entry: ledgerEntry,
    ledger_url: ledgerEntry ? origin + "/ledger/" + ledgerEntry : null, submitted_at: stored.submitted_at });
}

export function admissionSelfDescription(origin) {
  const o = origin || "https://ledger.horizonshield.dev";
  return { intake: ADMISSION_INTAKE_VERSION, schemas: [ADMISSION_SCHEMA, REVOCATION_SCHEMA],
    post_admission: o + "/admission  {\"record_canonical\"}", post_revocation: o + "/revocation  {\"record_canonical\", \"contract_canonical\"}",
    serve_by_sha: [o + "/admission/{canonical_sha256}", o + "/revocation/{canonical_sha256}"], max_bytes: MAX_BYTES,
    what_this_does: "stores what a relying party (admission) or a principal (revocation) signed, under its sha256, and anchors it with the daily batch",
    what_this_does_not_do: ["run admit() or hold the contract", "say whether an action should have been admitted", "allow or block anything"],
    function: "https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/workers/hs-ledger/nenrin/musubi-v0 (admission_verify_v0.py, admission_verify_v0.mjs, settle_v1_11.py, settle_v1_12.py, immune_v0.py)",
    versions: ["v0 (no rules.version)", "0.1", "0.2 (carries the immune block of immune_v0.py: digests and codes, no values; the intake checks its shape, not the rules)",
      "0.3 (carries immune and the content block, a2a-content-check-v0: digests and flags, no content; the intake checks its shape and its seven rules, not the check)",
      "0.4 (carries immune and the content block, a2a-content-check-v1: a salted commitment, digests, the decision and the marks, no content; the intake checks its shape and its nine rules, not the check)",
      "0.5 (carries immune and the content block of more than one runner, a2a-content-check-v2: checks[] and quorum, no content; the intake checks that the block and the reasons follow from its checks, not the checks)"],
    publication: "an admission is stored only when its signed bytes say \"publication\": \"public\"", policy: PRIVACY_POLICY };
}
