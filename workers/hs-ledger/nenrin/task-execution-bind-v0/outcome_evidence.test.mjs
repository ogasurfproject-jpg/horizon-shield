// Adversarial test for outcome-evidence binding. Probes: the binding is covered by receipt_id and provider_sig,
// shape rejection, and the bound-vs-confirmed distinction (no lookup, lookup not found, lookup mismatch, confirmed).
import { grantRef, receiptId } from "./bind_exec.mjs";
import { newAgentKey, signReceipt, verifyReceiptSig } from "./sign_exec.mjs";
import { verifyEvidence, evidenceWellFormed } from "./outcome_evidence.mjs";

const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");
let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 200))); if (!c) fail++; };

const T = "task_evidence_1", IN = "2026-09-18T00:30:00Z";
const CALLER = "did:key:CALLER", PROVIDER = "did:key:PROVIDER";
const provKey = newAgentKey();
const REF = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const grant = { schema: "task-execution-bind-v0/grant", task_id: T, action: { tool: "a2a.invoke", target: "/invoices/pay", args_sha256: "sha_args_ok" }, caller_id: CALLER, provider_id: PROVIDER, nonce: "n1", not_before: "2026-09-18T00:00:00Z", not_after: "2026-09-18T01:00:00Z" };
grant.grant_ref = grantRef(grant);
function mintReceipt(evidence) {
  const r = { schema: "task-execution-bind-v0/receipt", task_id: T, grant_ref: grant.grant_ref, executed_action: { tool: "a2a.invoke", target: "/invoices/pay", args_sha256: "sha_args_ok" }, outcome: { status: "completed", result_sha256: "sha_res_1" }, provider_id: PROVIDER, executed_at: IN };
  if (evidence !== undefined) r.outcome.evidence = evidence;
  r.receipt_id = receiptId(r);
  return signReceipt(r, provKey.privateKey);
}
const good = { kind: "ledger_record", ref: REF, system: "ledger.horizonshield.dev" };

// ---- no evidence: allowed, and reported as not bound (never mistaken for confirmed) ----
const v0 = verifyEvidence(mintReceipt(undefined), null);
chk("receipt without evidence is ok and reported bound:false", v0.ok === true && v0.bound === false && v0.reason === "no_evidence_bound", v0.reason);

// ---- bound but unchecked: ok, but says so ----
const v1 = verifyEvidence(mintReceipt(good), null);
chk("bound evidence with no lookup is ok and reported unchecked", v1.ok === true && v1.bound === true && v1.checked_externally === false && v1.reason === "evidence_bound_unchecked", v1.reason);

// ---- the binding is cryptographic: mutating the pointer breaks receipt_id and provider_sig ----
const r = mintReceipt(good);
const mutated = Object.assign({}, r, { outcome: Object.assign({}, r.outcome, { evidence: { ...good, ref: REF.replace(/^0/, "f") } }) });
chk("mutated evidence pointer breaks receipt_id", receiptId(mutated) !== r.receipt_id);
chk("mutated evidence pointer breaks provider_sig", verifyReceiptSig(mutated, provKey.publicKey) === false);

// ---- shape rejection ----
chk("unknown kind rejected", verifyEvidence(mintReceipt({ kind: "vibes", ref: REF, system: "x" }), null).reason === "evidence_kind_unknown");
chk("malformed ref rejected", verifyEvidence(mintReceipt({ kind: "bitcoin_tx", ref: "not-hex", system: "bitcoin" }), null).reason === "evidence_ref_malformed");
chk("missing system rejected", verifyEvidence(mintReceipt({ kind: "bitcoin_tx", ref: REF, system: "" }), null).reason === "evidence_system_missing");
chk("evidenceWellFormed accepts the good pointer", evidenceWellFormed(good).ok === true);

// ---- injected lookup: not found, mismatch, confirmed, throwing ----
const vNF = verifyEvidence(mintReceipt(good), () => ({ found: false, matches: false }));
chk("lookup not found refuses (evidence_not_found), checked_externally true", vNF.ok === false && vNF.reason === "evidence_not_found" && vNF.checked_externally === true, vNF.reason);
const vMM = verifyEvidence(mintReceipt(good), () => ({ found: true, matches: false }));
chk("lookup mismatch refuses (evidence_does_not_match)", vMM.ok === false && vMM.reason === "evidence_does_not_match", vMM.reason);
const vOK = verifyEvidence(mintReceipt(good), (ev) => ({ found: ev.ref === REF, matches: true }));
chk("lookup confirmed accepts (evidence_confirmed)", vOK.ok === true && vOK.reason === "evidence_confirmed" && vOK.checked_externally === true, vOK.reason);
const vTH = verifyEvidence(mintReceipt(good), () => { throw new Error("network down"); });
chk("a throwing lookup is treated as not confirmed, never as confirmed", vTH.ok === false && vTH.reason === "evidence_not_found", vTH.reason);

chk("no em/en/bar dashes in records", !DASH.test(JSON.stringify([grant, r])));
console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS (outcome-evidence binding)");
process.exit(fail ? 1 : 0);
