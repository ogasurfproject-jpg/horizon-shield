// Adversarial test for preflight.mjs (pre-execution authorization evidence).
// Probes: the pre-execution action match (an unauthorized action is caught BEFORE it runs), the
// declared-vs-executed three-way match, counterparty posture as material (no score), tamper and signature,
// and the hard invariant that this layer returns EVIDENCE, never a decision.
import { grantRef, receiptId } from "./bind_exec.mjs";
import { evidenceId } from "../task-delegation-bind-v0/bind.mjs";
import { verifyPreflight, intentId, intentMatchesReceipt, counterpartyPosture, preflightReport, newAgentKey, signIntent } from "./preflight.mjs";

const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");
let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 200))); if (!c) fail++; };

const T = "task_pre_1";
const NB = "2026-09-18T00:00:00Z", NA = "2026-09-18T01:00:00Z", IN = "2026-09-18T00:30:00Z";
const CALLER = "did:key:CALLER", PROVIDER = "did:key:PROVIDER";
const K = { [PROVIDER]: newAgentKey(), "did:key:EVIL": newAgentKey() };
const resolve = (id) => (K[id] ? K[id].publicKey : null);

function mintGrant(o = {}) {
  const g = { schema: "task-execution-bind-v0/grant", task_id: T, action: { tool: "a2a.invoke", target: o.target || "/invoices/pay", args_sha256: o.args || "sha_args_ok" }, caller_id: o.caller || CALLER, provider_id: o.provider === undefined ? PROVIDER : o.provider, nonce: "n1", not_before: NB, not_after: NA };
  g.grant_ref = grantRef(g);
  return g;
}
function mintIntent(g, o = {}) {
  const i = { schema: "task-execution-bind-v0/intent", task_id: T, grant_ref: o.grantRefOverride === undefined ? g.grant_ref : o.grantRefOverride, proposed_action: { tool: "a2a.invoke", target: o.target || "/invoices/pay", args_sha256: o.args || "sha_args_ok" }, provider_id: o.provider || PROVIDER, declared_at: o.at || IN };
  i.intent_id = intentId(i);
  return i;
}
function mintReceipt(g, o = {}) {
  const r = { schema: "task-execution-bind-v0/receipt", task_id: T, grant_ref: g.grant_ref, executed_action: { tool: "a2a.invoke", target: o.target || "/invoices/pay", args_sha256: o.args || "sha_args_ok" }, outcome: { status: o.status || "completed", result_sha256: "sha_res_1" }, provider_id: PROVIDER, executed_at: IN };
  r.receipt_id = receiptId(r);
  return r;
}
function mintObs(o) { const obs = { task_id: o.task || T, hop: { seq: o.seq, from: o.from, to: o.to }, prev_evidence_id: null, conduct: { verdict: o.verdict, detail_ref: null }, witness_id: o.witness, observed_at: IN }; obs.evidence_id = evidenceId(obs); return obs; }

const grant = mintGrant();

// ---- baseline: the declared action is inside the grant, before execution ----
const pf = verifyPreflight(grant, mintIntent(grant));
chk("baseline intent is preauthorized", pf.ok === true && pf.reason === "preauthorized", pf.reason);
chk("baseline has no declared findings", pf.findings.length === 0);

// ---- the whole point: an unauthorized action is caught BEFORE it runs ----
const bad = verifyPreflight(grant, mintIntent(grant, { target: "/attacker/acct" }));
chk("a declared action outside the grant is caught pre-execution (action_diverged)", bad.ok === false && bad.reason === "action_diverged", bad.reason);

// ---- intent bound to a grant it does not hash to ----
chk("intent not hashing to the grant is rejected (intent_unbound)", verifyPreflight(grant, mintIntent(grant, { grantRefOverride: "deadbeef" })).reason === "intent_unbound");

// ---- non-UTC declared_at ----
chk("non-UTC declared_at is rejected (invalid_timestamp)", verifyPreflight(grant, mintIntent(grant, { at: "2026-09-18T09:30:00+09:00" })).reason === "invalid_timestamp");

// ---- a provider the grant did not authorize declaring intent ----
chk("declaration by an unauthorized executor is rejected (provider_not_authorized)", verifyPreflight(grant, mintIntent(grant, { provider: "did:key:OTHER" })).reason === "provider_not_authorized");

// ---- declaration outside the window ----
chk("declaration after not_after is rejected (outside_authorization_window)", verifyPreflight(grant, mintIntent(grant, { at: "2026-09-18T02:00:00Z" })).reason === "outside_authorization_window");

// ---- intent tamper ----
const it = mintIntent(grant); it.proposed_action.target = "/invoices/refund";
chk("intent tamper is caught (intent_recompute_mismatch)", verifyPreflight(grant, it).reason === "intent_recompute_mismatch");

// ---- declared findings ----
const selfG = mintGrant({ caller: "did:key:SAME", provider: "did:key:SAME" });
chk("self_authorized is a declared finding, not a refusal", verifyPreflight(selfG, mintIntent(selfG, { provider: "did:key:SAME" })).findings.some((f) => f.code === "self_authorized"));
const openG = mintGrant({ provider: null });
chk("open grant is accepted with an open_grant finding", (() => { const r = verifyPreflight(openG, mintIntent(openG, { provider: "did:key:ANY" })); return r.ok === true && r.findings.some((f) => f.code === "open_grant"); })());

// ---- THREE-WAY: declared == executed catches a provider that declared one thing and did another ----
const intent = mintIntent(grant);
chk("declared matches executed when the provider keeps its word", intentMatchesReceipt(intent, mintReceipt(grant)) === true);
chk("declared-then-diverged is caught (declared /invoices/pay, executed /attacker/acct)", intentMatchesReceipt(intent, mintReceipt(grant, { target: "/attacker/acct" })) === false);

// ---- counterparty posture: MATERIAL, not a score ----
const obsPass = mintObs({ seq: 0, from: "A", to: "B", witness: "W1", verdict: "pass" });
const obsFail = mintObs({ seq: 0, from: "A", to: "B", witness: "W2", verdict: "fail" });
const r1 = mintReceipt(grant, { status: "completed" });
const r2 = mintReceipt(grant, { status: "failed" });
const posture = counterpartyPosture([obsPass, obsFail], [r1, r2]);
chk("posture surfaces an unresolved disagreement", posture.unresolved_disagreements.length === 1);
chk("posture surfaces an equivocation", posture.equivocations.length === 1 && posture.equivocations[0].receipt_ids.length === 2);
chk("posture carries no score, trust or verdict key", !("score" in posture) && !("trust" in posture) && !("verdict" in posture) && typeof posture.note === "string");

// ---- signatures: valid, spoofed ----
const signed = signIntent(mintIntent(grant), K[PROVIDER].privateKey);
chk("a valid signed intent reports authorized", preflightReport({ grant, intent: signed, resolve }).authorized === true);
const spoof = signIntent(mintIntent(grant), K["did:key:EVIL"].privateKey);
const spoofRep = preflightReport({ grant, intent: spoof, resolve });
chk("a spoofed intent signature reports NOT authorized (intent_sig_invalid)", spoofRep.authorized === false && spoofRep.signature === "intent_sig_invalid");

// ---- the hard invariant: this returns EVIDENCE, never a decision ----
const rep = preflightReport({ grant, intent: signed, resolve, priorObservations: [obsPass, obsFail], priorReceipts: [r1, r2] });
chk("report has no allow, deny, decision, recommendation or score key", ["allow", "deny", "decision", "recommendation", "score", "proceed", "trust_score"].every((k) => !(k in rep)));
chk("report.authorized is a boolean fact, not a recommendation", typeof rep.authorized === "boolean");
chk("does_not_establish states plainly that this is not a decision to proceed and returns no score", rep.does_not_establish.some((s) => s.includes("not") && s.includes("decision to proceed") && s.includes("no trust score")));
chk("report still carries the posture material alongside the authorization fact", rep.counterparty_posture.unresolved_disagreements.length === 1 && rep.counterparty_posture.equivocations.length === 1);

// ---- determinism + dashes ----
chk("verifyPreflight is deterministic", JSON.stringify(verifyPreflight(grant, intent)) === JSON.stringify(verifyPreflight(grant, mintIntent(grant))));
chk("no em/en/bar dashes in records or report", !DASH.test(JSON.stringify([grant, signed, rep])));

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS (task-preflight-v0: pre-execution authorization evidence, not a decision)");
process.exit(fail ? 1 : 0);
