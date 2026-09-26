// task-execution-bind-v0 : deterministic binding of an AUTHORIZED action to its EXECUTION receipt,
// at the caller/gateway execution boundary. Composable counterpart to task-delegation-bind-v0
// (third-party observation) and to Poke-nushi's VATE (a2aproject/A2A#1769). VATE is the artifact of
// record for this boundary; this is a minimal, swappable reference implementation whose only job is to
// make the composition seam testable end to end. It claims no ownership of the boundary.
//
// It supplies exactly the two properties boundary_case.test.mjs proved the observation layer is silent on:
//   E1 authorized-action match : did the executed action equal the authorized one?
//   E2 outcome reconciliation  : after a lost response, is the outcome recoverable, and is provider
//                                equivocation DETECTABLE rather than launderable into the favorable one?
//   E3 grant binding           : the receipt commits to the grant by hash INSIDE the provider's signed bytes.
//
// A grant names the authorized executor (provider_id). Scoping reconciliation to that executor is what makes
// equivocation attributable and closes the forge-a-second-receipt griefing path (see sign_exec.reconcileSigned).
//
// Honest line (the same wall as the observation layer): a signature proves WHO asserted, not that the
// assertion is TRUE. E1 compares two SIGNED statements (a caller's authorization and a provider's receipt);
// it establishes that the provider's CLAIMED action matches the authorization, not that the provider
// performed it in the world. E2 makes a lost outcome recoverable and equivocation detectable; it does NOT
// prevent equivocation and does NOT prove the reconciled outcome is the real-world outcome.
import { canonical, sha256hex } from "../task-delegation-bind-v0/bind.mjs";

// Derived/envelope fields, excluded from the content hash so signing never changes the hash and the
// signer signs the same bytes the verifier recomputes. Same discipline as evidence_id in bind.mjs.
const GRANT_DERIVED = ["grant_ref", "caller_sig", "action_binding"];
const RECEIPT_DERIVED = ["receipt_id", "provider_sig", "action_binding"];

function stripped(rec, derived) {
  const b = Object.assign({}, rec);
  for (const k of derived) delete b[k];
  return b;
}
export const grantPreimage = (g) => stripped(g, GRANT_DERIVED);
export const receiptPreimage = (r) => stripped(r, RECEIPT_DERIVED);
export const grantRef = (g) => sha256hex(canonical(grantPreimage(g)));
export const receiptId = (r) => sha256hex(canonical(receiptPreimage(r)));

// action equality by canonical bytes (tool, target, args_sha256), order-independent, extra fields diverge.
export function actionsEqual(a, b) {
  return !!a && !!b && canonical(a) === canonical(b);
}

// self-authorization (declared, not refused): the grant's caller authorized its own executor.
// Evaluated on the GRANT (who authorized whom), not on who happened to sign a receipt.
export function grantIsSelfAuthorized(g) {
  return g.provider_id != null && g.caller_id === g.provider_id;
}

// the receipt must come from the executor the grant authorized. A grant with provider_id null is an open
// grant (any executor); v0 records that as a finding rather than silently accepting it.
export function providerAuthorized(g, r) {
  return g.provider_id == null || r.provider_id === g.provider_id;
}

// E3: recompute grant_ref and require the receipt to reference THIS grant by that hash.
export function receiptBindsGrant(g, r) {
  return typeof r.grant_ref === "string" && r.grant_ref === grantRef(g);
}

// strict RFC3339 UTC ("...Z") timestamp. v0 requires UTC Z form so a non-UTC offset or a date-only
// string cannot slip an execution past the window via Date.parse laxity.
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export function isRfc3339Utc(s) { return typeof s === "string" && RFC3339_UTC.test(s) && !Number.isNaN(Date.parse(s)); }

// validity window: executed_at within [not_before, not_after]; both bounds live in the signed grant.
export function withinWindow(g, r) {
  const t = Date.parse(r.executed_at);
  if (Number.isNaN(t)) return false;
  if (g.not_before != null) { const nb = Date.parse(g.not_before); if (Number.isNaN(nb) || t < nb) return false; }
  if (g.not_after != null) { const na = Date.parse(g.not_after); if (Number.isNaN(na) || t > na) return false; }
  return true;
}

// E1: does the provider's executed_action match the caller's authorized action?
export function actionMatch(g, r) {
  if (!actionsEqual(g.action, r.executed_action)) return { ok: false, reason: "action_diverged" };
  return { ok: true };
}

// R2-style recompute for each record on its own (detects tamper and bind-swap).
export function grantRecomputeOk(g) { return typeof g.grant_ref === "string" && g.grant_ref === grantRef(g); }
export function receiptRecomputeOk(r) { return typeof r.receipt_id === "string" && r.receipt_id === receiptId(r); }

// ---- interop: VATE-shaped action_binding (a2aproject/A2A#1769, Poke-nushi's admission-receipt / post-execution-receipt) ----
// { type, canonicalization, preimage_profile, digest:{alg,value} } over the action, so a VATE recipient can compare
// digest.value with its effective_request_hash without reading this spec. It is DERIVED, like grant_ref: excluded
// from the preimage, so attaching it never changes grant_ref, receipt_id or any signature, and no published fixture
// moves. It adds no trust: the action it digests is already inside the signed bytes. A verifier that finds one
// recomputes it from the signed action and refuses a record whose binding does not recompute (fail-closed), so an
// accepted report never vouches for a binding it did not check. The canonicalization name is the one rule this
// repository already proves byte-identical across Python and Node (../musubi-v0/canonical_vectors.json).
export const CANONICALIZATION = "musubi-canonical-v0";
export const ACTION_PREIMAGE_PROFILE = "task-execution-bind-v0/action";
export const actionDigest = (action) => sha256hex(canonical(action));
export function actionBinding(action) {
  return { type: "canonical_request_digest", canonicalization: CANONICALIZATION, preimage_profile: ACTION_PREIMAGE_PROFILE, digest: { alg: "sha-256", value: actionDigest(action) } };
}
// attach a binding over rec[key] (grant: "action", receipt: "executed_action", intent: "proposed_action").
export const withActionBinding = (rec, key) => Object.assign({}, rec, { action_binding: actionBinding(rec[key]) });
// status: absent | recomputed | malformed | unknown_profile | mismatch. Only absent and recomputed are acceptable.
export function checkActionBinding(rec, key) {
  const b = rec.action_binding;
  if (b === undefined) return { status: "absent" };
  if (!b || typeof b !== "object" || Array.isArray(b) || b.type !== "canonical_request_digest" || !b.digest || typeof b.digest !== "object" || b.digest.alg !== "sha-256" || typeof b.digest.value !== "string")
    return { status: "malformed" };
  if (b.canonicalization !== CANONICALIZATION || b.preimage_profile !== ACTION_PREIMAGE_PROFILE) return { status: "unknown_profile" };
  if (rec[key] == null || b.digest.value !== actionDigest(rec[key])) return { status: "mismatch" };
  return { status: "recomputed" };
}
export const actionBindingOk = (st) => st === "absent" || st === "recomputed";

// verify a grant+receipt pair (content-addressed core; signatures handled in sign_exec.mjs).
// findings carries DECLARED, non-fatal disclosures (mirrors the conduct_self_measured finding in agreement-v0).
export function verifyExecution(g, r) {
  const findings = [];
  if (!grantRecomputeOk(g)) return { ok: false, reason: "grant_recompute_mismatch", findings };
  if (!receiptRecomputeOk(r)) return { ok: false, reason: "receipt_recompute_mismatch", findings };
  const gb = checkActionBinding(g, "action"), rb = checkActionBinding(r, "executed_action");
  const action_binding = { grant: gb.status, receipt: rb.status };
  if (!actionBindingOk(gb.status)) return { ok: false, reason: "action_binding_" + gb.status, record: "grant", findings, action_binding };
  if (!actionBindingOk(rb.status)) return { ok: false, reason: "action_binding_" + rb.status, record: "receipt", findings, action_binding };
  if (!receiptBindsGrant(g, r)) return { ok: false, reason: "receipt_unbound", findings, action_binding };
  if (!isRfc3339Utc(r.executed_at) || (g.not_before != null && !isRfc3339Utc(g.not_before)) || (g.not_after != null && !isRfc3339Utc(g.not_after)))
    return { ok: false, reason: "invalid_timestamp", findings };
  if (!providerAuthorized(g, r)) return { ok: false, reason: "provider_not_authorized", findings };
  if (!withinWindow(g, r)) return { ok: false, reason: "outside_authorization_window", findings };
  if (g.provider_id == null) findings.push({ code: "open_grant", why: "the grant names no provider_id, so any executor's receipt is accepted; this pair does not establish that the executor was the one the caller intended." });
  if (grantIsSelfAuthorized(g)) findings.push({ code: "self_authorized", why: "caller_id equals the grant's provider_id; the caller authorized its own executor. Declared, so recorded not refused; this pair does not establish that the authorization came from anyone other than the executor." });
  const e1 = actionMatch(g, r);
  return { ok: e1.ok, reason: e1.ok ? "action_bound" : e1.reason, findings, action_binding };
}

// E2 (sig-free) reconciliation over a SET of receipts for one grant_ref. Fail-closed like R4: conflicting
// committed outcomes yield "equivocation", never the favorable one. A lost response is recovered by
// re-querying this set and finding the byte-identical receipt. NOTE: without signatures this reports only
// STRUCTURAL conflict; a third party could forge a second receipt. Attributable equivocation is in sign_exec.
export function reconcileOutcome(receipts, grant_ref) {
  const forGrant = receipts.filter((r) => r.grant_ref === grant_ref && receiptRecomputeOk(r));
  const ids = [...new Set(forGrant.map((r) => r.receipt_id))];
  if (ids.length === 0) return { status: "no_receipt" };
  if (ids.length > 1) return { status: "equivocation", receipt_ids: ids };
  return { status: "reconciled", receipt_id: ids[0], outcome: forGrant[0].outcome };
}
