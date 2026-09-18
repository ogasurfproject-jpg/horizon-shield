// preflight.mjs : pre-execution authorization evidence for task-execution-bind-v0.
//
// The execution layer binds an action AFTER it ran (grant + receipt). This binds it BEFORE, at the moment a
// provider declares what it is about to do (grant + intent). Same primitive, the other side of the action:
//   grant   : the caller signs WHAT it authorizes (action, provider, window).
//   intent  : the provider signs WHAT it is about to do, referencing the grant by hash, before executing.
//   receipt : the provider signs WHAT it did, after executing (../bind_exec.mjs).
// All three carry the same grant_ref, so a verifier can later check declared == authorized == executed.
//
// WHAT THIS IS NOT. This does not decide whether to transact. It returns no allow/deny and no trust score.
// HORIZON SHIELD stays on the evidence side of the line: it establishes, before execution, whether a declared
// action is inside a grant the caller signed, and it surfaces the counterparty's evidence posture as MATERIAL.
// The decision belongs to the caller's own gateway (or a policy engine such as SINT or PHION), which may
// consume this evidence. Turning this into an allow/deny engine would abandon the one property that makes the
// evidence worth anything: that HORIZON SHIELD is not the party deciding.
//
// Honest line (same wall as every layer): a signature proves WHO asserted, not that the assertion is TRUE.
// "preauthorized" means the provider's DECLARED action matches the caller's signed grant. It does not promise
// the provider will execute that action; the receipt, checked afterward, is what catches a provider that
// declared one thing and did another.
import { canonical, sha256hex, aggregateVerdict } from "../task-delegation-bind-v0/bind.mjs";
import { grantRef, grantRecomputeOk, actionsEqual, isRfc3339Utc, providerAuthorized, grantIsSelfAuthorized, reconcileOutcome } from "./bind_exec.mjs";
import { sign as nodeSign, verify as nodeVerify, generateKeyPairSync } from "node:crypto";

const INTENT_DERIVED = ["intent_id", "intent_sig"];
export const intentPreimage = (i) => { const b = Object.assign({}, i); for (const k of INTENT_DERIVED) delete b[k]; return b; };
export const intentId = (i) => sha256hex(canonical(intentPreimage(i)));
export function intentRecomputeOk(i) { return typeof i.intent_id === "string" && i.intent_id === intentId(i); }
export function intentBindsGrant(g, i) { return typeof i.grant_ref === "string" && i.grant_ref === grantRef(g); }

function declaredInWindow(g, i) {
  const t = Date.parse(i.declared_at);
  if (Number.isNaN(t)) return false;
  if (g.not_before != null) { const nb = Date.parse(g.not_before); if (Number.isNaN(nb) || t < nb) return false; }
  if (g.not_after != null) { const na = Date.parse(g.not_after); if (Number.isNaN(na) || t > na) return false; }
  return true;
}

// verify a grant + intent pair BEFORE execution. Returns { ok, reason, findings }.
// ok true with reason "preauthorized" means: the declared action is inside a grant the caller signed, the
// declaring provider is the authorized executor, and the declaration falls in the grant window. It is a FACT
// about the intent, not a recommendation to proceed.
export function verifyPreflight(g, i) {
  const findings = [];
  if (!grantRecomputeOk(g)) return { ok: false, reason: "grant_recompute_mismatch", findings };
  if (!intentRecomputeOk(i)) return { ok: false, reason: "intent_recompute_mismatch", findings };
  if (!intentBindsGrant(g, i)) return { ok: false, reason: "intent_unbound", findings };
  if (!isRfc3339Utc(i.declared_at) || (g.not_before != null && !isRfc3339Utc(g.not_before)) || (g.not_after != null && !isRfc3339Utc(g.not_after)))
    return { ok: false, reason: "invalid_timestamp", findings };
  if (!providerAuthorized(g, i)) return { ok: false, reason: "provider_not_authorized", findings };
  if (!declaredInWindow(g, i)) return { ok: false, reason: "outside_authorization_window", findings };
  if (g.provider_id == null) findings.push({ code: "open_grant", why: "the grant names no provider_id, so any declaring executor is accepted; this pair does not establish the caller intended this executor." });
  if (grantIsSelfAuthorized(g)) findings.push({ code: "self_authorized", why: "caller_id equals the grant's provider_id; the caller authorized its own executor." });
  if (!actionsEqual(g.action, i.proposed_action)) return { ok: false, reason: "action_diverged", findings };
  return { ok: true, reason: "preauthorized", findings };
}

// declared == executed. The three-way match (authorized == declared == executed) is verifyPreflight ok on the
// grant+intent AND verifyExecution ok on the grant+receipt AND this, which catches a provider that declared one
// action and executed another even when both individually reference the grant.
export function intentMatchesReceipt(i, r) { return actionsEqual(i.proposed_action, r.executed_action); }

// Counterparty posture: MATERIAL for the caller's decision, never a score or a verdict. Surfaces where the
// counterparty's presented prior evidence carries unresolved disagreement (observations) or equivocation
// (receipts). Absence of conflict is NOT evidence of good conduct; it may only mean no evidence was presented.
export function counterpartyPosture(priorObservations, priorReceipts) {
  const obs = Array.isArray(priorObservations) ? priorObservations : [];
  const rcpts = Array.isArray(priorReceipts) ? priorReceipts : [];
  const byHop = new Map();
  for (const o of obs) { const k = JSON.stringify([o && o.task_id, o && o.hop ? o.hop.seq : null]); if (!byHop.has(k)) byHop.set(k, []); byHop.get(k).push(o); }
  const unresolved_disagreements = [];
  for (const [k, set] of byHop) if (aggregateVerdict(set) === "disagreement") unresolved_disagreements.push({ at: k, witnesses: set.map((o) => o.witness_id) });
  const byGrant = new Map();
  for (const r of rcpts) { const k = r && r.grant_ref; if (!byGrant.has(k)) byGrant.set(k, []); byGrant.get(k).push(r); }
  const equivocations = [];
  for (const [k, set] of byGrant) { const rec = reconcileOutcome(set, k); if (rec.status === "equivocation") equivocations.push({ grant_ref: k, receipt_ids: rec.receipt_ids }); }
  return {
    prior_observation_hops: byHop.size,
    prior_receipt_grants: byGrant.size,
    unresolved_disagreements,
    equivocations,
    note: "material for the caller's own decision, not a score and not a recommendation; absence of conflict here is not evidence of good conduct, only that none was presented",
  };
}

// signature layer for the intent: the provider signs canonical(intentPreimage), which includes grant_ref, so
// the declaration is bound to the grant and attributable to the provider.
export function newAgentKey() { return generateKeyPairSync("ed25519"); }
export function signIntent(i, providerPriv) {
  const sig = nodeSign(null, Buffer.from(canonical(intentPreimage(i)), "utf8"), providerPriv);
  return Object.assign({}, i, { intent_sig: sig.toString("base64") });
}
export function verifyIntentSig(i, providerPub) {
  if (typeof i.intent_sig !== "string" || !providerPub) return false;
  try { return nodeVerify(null, Buffer.from(canonical(intentPreimage(i)), "utf8"), providerPub, Buffer.from(i.intent_sig, "base64")); }
  catch (e) { return false; }
}

// the whole pre-execution evidence bundle, in the a2a-agreement-verify-v0 report idiom.
// input: { grant, intent, priorObservations?, priorReceipts?, resolve?, require_signature? (default true) }
export function preflightReport(input) {
  const g = input.grant, i = input.intent;
  const resolve = typeof input.resolve === "function" ? input.resolve : () => null;
  const requireSig = input.require_signature !== false;
  const findings = [];
  const pf = verifyPreflight(g, i);
  pf.findings.forEach((f) => findings.push(f));
  let sig_ok = true, sig_reason = "signature_not_required";
  if (requireSig) { sig_ok = verifyIntentSig(i, resolve(i.provider_id)); sig_reason = sig_ok ? "intent_sig_valid" : "intent_sig_invalid"; }
  const authorized = pf.ok && sig_ok;
  const posture = counterpartyPosture(input.priorObservations, input.priorReceipts);
  const establishes = [];
  if (authorized) {
    establishes.push("the declared action equals, byte for byte, the action the caller signed in the grant (grant_ref " + g.grant_ref + ")");
    establishes.push("the declaring provider is the executor the grant authorized, and the declaration falls in the grant window");
    if (requireSig) establishes.push("the intent carries a valid provider signature over its own bytes, attributable to " + i.provider_id);
  } else {
    establishes.push("nothing about authorization: " + (pf.ok ? sig_reason : pf.reason));
  }
  const does_not_establish = [
    "this is NOT a decision to proceed: HORIZON SHIELD returns evidence, not allow or deny, and no trust score; the caller's own gateway decides",
    "that the provider will execute the action it declared: the receipt, checked after execution, is what catches a declared-then-diverged action",
    "that the counterparty is trustworthy: the posture surfaces presented conflicts as material, and absence of conflict is not evidence of good conduct",
    "that any action occurred in the world: this is a pre-execution declaration, and no signature has a side-effect oracle",
  ];
  return { schema: "task-preflight-v0", task_id: g && g.task_id, authorized, status: pf.reason, signature: sig_reason, findings, counterparty_posture: posture, establishes, does_not_establish };
}
