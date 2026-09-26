// Adversarial test for task-execution-bind-v0 (content-addressed core, sig-free).
// Probes the two properties this layer exists to supply (E1 action match, E2 outcome reconciliation),
// the E3 grant binding, and the authorized-executor, tamper and window guards. The happy path is trivial.
import { grantRef, receiptId, verifyExecution, reconcileOutcome, withActionBinding, actionBinding, CANONICALIZATION } from "./bind_exec.mjs";

const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");
let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 200))); if (!c) fail++; };

function mintGrant(o) {
  const g = {
    schema: "task-execution-bind-v0/grant",
    task_id: o.task_id,
    action: { tool: o.tool, target: o.target, args_sha256: o.args },
    caller_id: o.caller,
    provider_id: o.provider === undefined ? null : o.provider,
    nonce: o.nonce,
    not_before: o.nb === undefined ? null : o.nb,
    not_after: o.na === undefined ? null : o.na,
  };
  g.grant_ref = grantRef(g);
  return g;
}
function mintReceipt(g, o) {
  const r = {
    schema: "task-execution-bind-v0/receipt",
    task_id: g.task_id,
    grant_ref: o.grantRefOverride === undefined ? g.grant_ref : o.grantRefOverride,
    executed_action: { tool: o.tool, target: o.target, args_sha256: o.args },
    outcome: { status: o.status, result_sha256: o.result },
    provider_id: o.provider,
    executed_at: o.at,
  };
  r.receipt_id = receiptId(r);
  return r;
}

const T = "task_exec_9c2";
const NB = "2026-09-18T00:00:00Z", NA = "2026-09-18T01:00:00Z", IN = "2026-09-18T00:30:00Z";
const CALLER = "did:key:CALLER", PROVIDER = "did:key:PROVIDER";
const A = mintGrant({ task_id: T, tool: "a2a.invoke", target: "/invoices/pay", args: "sha_args_ok", caller: CALLER, provider: PROVIDER, nonce: "n1", nb: NB, na: NA });
const okArgs = { tool: "a2a.invoke", target: "/invoices/pay", args: "sha_args_ok", status: "completed", result: "sha_res_1", provider: PROVIDER, at: IN };

// ---- baseline: executed action matches the authorization, authorized executor, in window ----
const okR = mintReceipt(A, okArgs);
const vb = verifyExecution(A, okR);
chk("baseline valid pair binds the action (E1 action_bound)", vb.ok === true && vb.reason === "action_bound", vb.reason);
chk("baseline has no declared findings", vb.findings.length === 0, JSON.stringify(vb.findings));

// ---- E1a: executed target mutated (the exact attack boundary_case showed the observation layer is blind to) ----
const vt = verifyExecution(A, mintReceipt(A, { ...okArgs, target: "/attacker/acct" }));
chk("E1a executed target divergence is caught (action_diverged)", vt.ok === false && vt.reason === "action_diverged", vt.reason);

// ---- E1b: executed args mutated ----
const va = verifyExecution(A, mintReceipt(A, { ...okArgs, args: "sha_args_EVIL" }));
chk("E1b executed args divergence is caught (action_diverged)", va.ok === false && va.reason === "action_diverged", va.reason);

// ---- E3: receipt stapled to a grant it does not hash to ----
const vu = verifyExecution(A, mintReceipt(A, { ...okArgs, grantRefOverride: "deadbeefdeadbeef" }));
chk("E3 receipt not hashing to the grant is rejected (receipt_unbound)", vu.ok === false && vu.reason === "receipt_unbound", vu.reason);

// ---- authorized executor: a receipt from a provider the grant did not name ----
const vpa = verifyExecution(A, mintReceipt(A, { ...okArgs, provider: "did:key:OTHER" }));
chk("receipt from an unauthorized executor is rejected (provider_not_authorized)", vpa.ok === false && vpa.reason === "provider_not_authorized", vpa.reason);

// ---- tamper: authorized target changed after grant_ref was fixed ----
const gT = mintGrant({ task_id: T, tool: "a2a.invoke", target: "/invoices/pay", args: "sha_args_ok", caller: CALLER, provider: PROVIDER, nonce: "n1", nb: NB, na: NA });
gT.action.target = "/invoices/refund";
const vgt = verifyExecution(gT, okR);
chk("grant tamper is caught (grant_recompute_mismatch)", vgt.ok === false && vgt.reason === "grant_recompute_mismatch", vgt.reason);

// ---- tamper: outcome changed after receipt_id was fixed ----
const rT = mintReceipt(A, okArgs);
rT.outcome.status = "failed";
const vrt = verifyExecution(A, rT);
chk("receipt tamper is caught (receipt_recompute_mismatch)", vrt.ok === false && vrt.reason === "receipt_recompute_mismatch", vrt.reason);

// ---- window: execution outside the authorization window ----
const vl = verifyExecution(A, mintReceipt(A, { ...okArgs, at: "2026-09-18T02:00:00Z" }));
chk("execution after not_after is rejected (outside_authorization_window)", vl.ok === false && vl.reason === "outside_authorization_window", vl.reason);

// ---- self_authorized: the caller authorized its own executor (declared, not refused) ----
const SAME = "did:key:SAME";
const selfG = mintGrant({ task_id: T, tool: "a2a.invoke", target: "/invoices/pay", args: "sha_args_ok", caller: SAME, provider: SAME, nonce: "n2", nb: NB, na: NA });
const selfR = mintReceipt(selfG, { ...okArgs, provider: SAME });
const vs = verifyExecution(selfG, selfR);
chk("self_authorized is recorded as a declared finding, not refused", vs.ok === true && vs.findings.some((f) => f.code === "self_authorized"), JSON.stringify(vs.findings));

// ---- open_grant: no provider_id named ----
const openG = mintGrant({ task_id: T, tool: "a2a.invoke", target: "/invoices/pay", args: "sha_args_ok", caller: CALLER, nonce: "n3", nb: NB, na: NA });
const vo = verifyExecution(openG, mintReceipt(openG, { ...okArgs, provider: "did:key:ANYONE" }));
chk("open grant (no provider_id) is accepted with an open_grant finding", vo.ok === true && vo.findings.some((f) => f.code === "open_grant"), JSON.stringify(vo.findings));

// ---- E2: a lost response is recovered by re-querying (byte-identical receipt reconciles) ----
const rec1 = reconcileOutcome([okR, mintReceipt(A, okArgs)], A.grant_ref);
chk("E2 lost-response re-query reconciles to a stable outcome", rec1.status === "reconciled" && rec1.outcome.status === "completed", rec1.status);

// ---- E2: two conflicting outcomes for one grant_ref surface as equivocation, never the favorable one ----
const conflict = mintReceipt(A, { ...okArgs, status: "failed", result: "sha_res_2" });
const rec2 = reconcileOutcome([okR, conflict], A.grant_ref);
chk("E2 conflicting outcomes yield equivocation (fail-closed, not the favorable one)", rec2.status === "equivocation" && rec2.receipt_ids.length === 2, rec2.status);

// ---- timestamp strictness: a non-UTC offset must not slip past the window via Date.parse laxity ----
const vts = verifyExecution(A, mintReceipt(A, { ...okArgs, at: "2026-09-18T09:30:00+09:00" }));
chk("non-UTC executed_at is rejected (invalid_timestamp)", vts.ok === false && vts.reason === "invalid_timestamp", vts.reason);

// ---- AB: VATE-shaped action_binding (derived, optional, fail-closed when present) ----
const gAB = withActionBinding(A, "action"), rAB = withActionBinding(okR, "executed_action");
chk("AB1 attaching action_binding changes neither grant_ref nor receipt_id (derived, outside the preimage)", gAB.grant_ref === grantRef(gAB) && rAB.receipt_id === receiptId(rAB) && gAB.grant_ref === A.grant_ref && rAB.receipt_id === okR.receipt_id);
const vAB = verifyExecution(gAB, rAB);
chk("AB1 a pair carrying correct bindings verifies and reports both as recomputed", vAB.ok === true && vAB.action_binding.grant === "recomputed" && vAB.action_binding.receipt === "recomputed", JSON.stringify(vAB));
chk("AB1 binding carries the VATE shape and the pinned canonicalization name", gAB.action_binding.type === "canonical_request_digest" && gAB.action_binding.canonicalization === CANONICALIZATION && gAB.action_binding.canonicalization === "musubi-canonical-v0" && gAB.action_binding.digest.alg === "sha-256" && /^[0-9a-f]{64}$/.test(gAB.action_binding.digest.value));
chk("AB1 a pair without bindings reports absent, not an error", vb.action_binding.grant === "absent" && vb.action_binding.receipt === "absent");
const gBad = withActionBinding(A, "action"); gBad.action_binding = { ...gBad.action_binding, digest: { alg: "sha-256", value: "0".repeat(64) } };
const vBad = verifyExecution(gBad, rAB);
chk("AB2 a grant binding whose digest does not recompute is refused (action_binding_mismatch, record grant)", vBad.ok === false && vBad.reason === "action_binding_mismatch" && vBad.record === "grant", vBad.reason);
// the binding advertises the AUTHORIZED action's digest while executed_action diverged: caught before E1, as a lying binding
const rLie = mintReceipt(A, { ...okArgs, target: "/attacker/acct" }); rLie.action_binding = actionBinding(A.action);
const vLie = verifyExecution(gAB, rLie);
chk("AB3 a receipt binding advertising the authorized digest over a diverged executed_action is refused (action_binding_mismatch, record receipt)", vLie.ok === false && vLie.reason === "action_binding_mismatch" && vLie.record === "receipt", vLie.reason);
const rFor = withActionBinding(okR, "executed_action"); rFor.action_binding = { ...rFor.action_binding, canonicalization: "RFC8785" };
const vFor = verifyExecution(gAB, rFor);
chk("AB4 a binding under a canonicalization this verifier cannot recompute is refused, never accepted unchecked (action_binding_unknown_profile)", vFor.ok === false && vFor.reason === "action_binding_unknown_profile" && vFor.record === "receipt", vFor.reason);
const gMal = withActionBinding(A, "action"); gMal.action_binding = { type: "external_reference", digest: { alg: "sha-512", value: "x" } };
const vMal = verifyExecution(gMal, rAB);
chk("AB5 a malformed or non-digest binding is refused (action_binding_malformed)", vMal.ok === false && vMal.reason === "action_binding_malformed" && vMal.record === "grant", vMal.reason);
const gNull = withActionBinding(A, "action"); gNull.action_binding = null;
chk("AB5 action_binding: null is malformed, not absent", verifyExecution(gNull, rAB).reason === "action_binding_malformed");

// ---- determinism + no forbidden dashes ----
chk("grant_ref and receipt_id are deterministic", grantRef(A) === A.grant_ref && receiptId(okR) === okR.receipt_id);
chk("no em/en/bar dashes in records", !DASH.test(JSON.stringify([A, okR, conflict, gAB, rAB])));

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS (task-execution-bind-v0 adversarial)");
process.exit(fail ? 1 : 0);
