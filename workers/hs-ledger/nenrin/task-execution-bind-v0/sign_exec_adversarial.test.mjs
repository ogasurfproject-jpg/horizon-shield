// Adversarial test for the task-execution-bind-v0 signature layer. Real Ed25519 keys, a resolver id -> pubkey.
// Focus: attribution (spoofed caller / provider), post-sign tamper, and the two griefing paths against
// reconciliation, plus genuine attributable equivocation.
import { grantRef, receiptId, withActionBinding } from "./bind_exec.mjs";
import { newAgentKey, signGrant, signReceipt, verifySignedExecution, reconcileSigned } from "./sign_exec.mjs";

const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");
let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 200))); if (!c) fail++; };

const K = { "did:key:CALLER": newAgentKey(), "did:key:PROVIDER": newAgentKey(), "did:key:EVIL": newAgentKey() };
const resolve = (id) => (K[id] ? K[id].publicKey : null);
const priv = (id) => K[id].privateKey;

const T = "task_exec_sig_1";
const NB = "2026-09-18T00:00:00Z", NA = "2026-09-18T01:00:00Z", IN = "2026-09-18T00:30:00Z";
const CALLER = "did:key:CALLER", PROVIDER = "did:key:PROVIDER", EVIL = "did:key:EVIL";

function mintGrant(o) {
  const g = { schema: "task-execution-bind-v0/grant", task_id: T, action: { tool: "a2a.invoke", target: o.target || "/invoices/pay", args: undefined, args_sha256: o.args || "sha_args_ok" }, caller_id: o.caller || CALLER, provider_id: o.provider || PROVIDER, nonce: o.nonce || "n1", not_before: NB, not_after: NA };
  delete g.action.args;
  g.grant_ref = grantRef(g);
  return g;
}
function mintReceipt(g, o) {
  const r = { schema: "task-execution-bind-v0/receipt", task_id: g.task_id, grant_ref: g.grant_ref, executed_action: { tool: "a2a.invoke", target: o.target || "/invoices/pay", args_sha256: o.args || "sha_args_ok" }, outcome: { status: o.status || "completed", result_sha256: o.result || "sha_res_1" }, provider_id: o.provider || PROVIDER, executed_at: o.at || IN };
  r.receipt_id = receiptId(r);
  return r;
}

const g = mintGrant({});
const gSigned = signGrant(g, priv(CALLER));
const rSigned = signReceipt(mintReceipt(g, {}), priv(PROVIDER));

// ---- baseline: caller authorized (caller_sig) + provider receipted (provider_sig) ----
const vb = verifySignedExecution(gSigned, rSigned, resolve);
chk("baseline signed pair verifies", vb.ok === true, vb.reason);

// ---- spoofed caller: grant signed by the wrong key ----
const gSpoof = signGrant(mintGrant({}), priv(EVIL));
const vc = verifySignedExecution(gSpoof, rSigned, resolve);
chk("spoofed caller signature rejected (caller_sig_invalid)", vc.ok === false && vc.reason === "caller_sig_invalid", vc.reason);

// ---- spoofed provider: receipt signed by the wrong key ----
const rSpoof = signReceipt(mintReceipt(g, {}), priv(EVIL));
const vp = verifySignedExecution(gSigned, rSpoof, resolve);
chk("spoofed provider signature rejected (provider_sig_invalid)", vp.ok === false && vp.reason === "provider_sig_invalid", vp.reason);

// ---- post-sign tamper: outcome changed after the provider signed ----
const rTamper = signReceipt(mintReceipt(g, {}), priv(PROVIDER));
rTamper.outcome.status = "failed";
const vt = verifySignedExecution(gSigned, rTamper, resolve);
chk("post-sign receipt tamper rejected (provider_sig_invalid)", vt.ok === false && vt.reason === "provider_sig_invalid", vt.reason);

// ---- griefing path A: a stranger signs a conflicting receipt under its OWN id ----
const evilOwn = signReceipt(mintReceipt(g, { status: "failed", result: "sha_evil", provider: EVIL }), priv(EVIL));
const recA = reconcileSigned([rSigned, evilOwn], g.grant_ref, PROVIDER, resolve);
chk("griefing A (stranger under own id) cannot manufacture equivocation", recA.status === "reconciled" && recA.outcome.status === "completed", JSON.stringify(recA));

// ---- griefing path B: a stranger impersonates the provider id but signs with its own key ----
const evilImpersonate = signReceipt(mintReceipt(g, { status: "failed", result: "sha_evil2", provider: PROVIDER }), priv(EVIL));
const recB = reconcileSigned([rSigned, evilImpersonate], g.grant_ref, PROVIDER, resolve);
chk("griefing B (stranger impersonating provider id) cannot manufacture equivocation", recB.status === "reconciled" && recB.outcome.status === "completed", JSON.stringify(recB));

// ---- genuine equivocation: the authorized provider itself signs two conflicting outcomes ----
const rAlt = signReceipt(mintReceipt(g, { status: "failed", result: "sha_res_2" }), priv(PROVIDER));
const recE = reconcileSigned([rSigned, rAlt], g.grant_ref, PROVIDER, resolve);
chk("genuine equivocation by the authorized provider is surfaced (fail-closed)", recE.status === "equivocation" && recE.receipt_ids.length === 2 && recE.provider_id === PROVIDER, JSON.stringify(recE));

// ---- open grant: reconciliation requires a named executor, not silent no_authentic_receipt ----
const recNull = reconcileSigned([rSigned], g.grant_ref, null, resolve);
chk("reconcileSigned with no authorized provider is explicit (no_authorized_provider)", recNull.status === "no_authorized_provider", recNull.status);

// ---- action_binding is outside the signed bytes: attach before or after signing, the signatures still verify ----
const gABafter = withActionBinding(gSigned, "action"), rABafter = withActionBinding(rSigned, "executed_action");
chk("action_binding attached after signing leaves caller_sig and provider_sig valid", verifySignedExecution(gABafter, rABafter, resolve).ok === true);
const gABbefore = signGrant(withActionBinding(g, "action"), priv(CALLER));
chk("signing with the binding present yields the same signature bytes as signing without it (derived field)", gABbefore.caller_sig === gSigned.caller_sig && verifySignedExecution(gABbefore, rSigned, resolve).ok === true);
const rABlie = withActionBinding(rSigned, "executed_action"); rABlie.action_binding.digest = { alg: "sha-256", value: "f".repeat(64) };
chk("a lying binding does not break the provider signature (it is outside the signed bytes); the content verifier is what refuses it", verifySignedExecution(gSigned, rABlie, resolve).ok === true);

// ---- no forbidden dashes ----
chk("no em/en/bar dashes in signed records", !DASH.test(JSON.stringify([gSigned, rSigned, rAlt, gABafter])));

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS (task-execution-bind-v0 signature adversarial)");
process.exit(fail ? 1 : 0);
