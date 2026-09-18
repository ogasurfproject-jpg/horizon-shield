// Adversarial test for nenrin-consume-v0 (the trust-engine read surface).
// Verifies the projection carries verified FACTS and surfaced CONFLICTS, carries the honest limits through,
// and, as a hard invariant, contains NO trust score and NO allow/deny decision anywhere in its own fields.
import { evidenceId } from "../task-delegation-bind-v0/bind.mjs";
import { newAgentKey, signObservation, signEdge } from "../task-delegation-bind-v0/sign.mjs";
import { grantRef, receiptId } from "../task-execution-bind-v0/bind_exec.mjs";
import { signGrant, signReceipt } from "../task-execution-bind-v0/sign_exec.mjs";
import { intentId, signIntent } from "../task-execution-bind-v0/preflight.mjs";
import { consumeEvidence, postureLine } from "./consume.mjs";

const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");
let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 240))); if (!c) fail++; };
function allKeys(o, acc = new Set()) { if (o && typeof o === "object") { if (Array.isArray(o)) o.forEach((x) => allKeys(x, acc)); else for (const k of Object.keys(o)) { acc.add(k); allKeys(o[k], acc); } } return acc; }

const T = "task_consume_1", NB = "2026-09-18T00:00:00Z", NA = "2026-09-18T01:00:00Z", IN = "2026-09-18T00:30:00Z";
const A = "did:key:A", B = "did:key:B", C = "did:key:C", W1 = "did:key:W1", W2 = "did:key:W2";
const K = {}; for (const id of [A, B, C, W1, W2]) K[id] = newAgentKey();
const resolve = (id) => (K[id] ? K[id].publicKey : null);
const priv = (id) => K[id].privateKey;
const REF = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const GOODEV = { kind: "ledger_record", ref: REF, system: "ledger.horizonshield.dev" };

function mintGrant() { const g = { schema: "task-execution-bind-v0/grant", task_id: T, action: { tool: "a2a.invoke", target: "/invoices/pay", args_sha256: "sha_args_ok" }, caller_id: A, provider_id: B, nonce: "n1", not_before: NB, not_after: NA }; g.grant_ref = grantRef(g); return signGrant(g, priv(A)); }
function mintReceipt(g, o = {}) { const r = { schema: "task-execution-bind-v0/receipt", task_id: T, grant_ref: g.grant_ref, executed_action: { tool: "a2a.invoke", target: "/invoices/pay", args_sha256: "sha_args_ok" }, outcome: { status: o.status || "completed", result_sha256: o.result || "sha_res_1", evidence: GOODEV }, provider_id: B, executed_at: IN }; r.receipt_id = receiptId(r); return signReceipt(r, priv(B)); }
function mintIntent(g) { const i = { schema: "task-execution-bind-v0/intent", task_id: T, grant_ref: g.grant_ref, proposed_action: { tool: "a2a.invoke", target: "/invoices/pay", args_sha256: "sha_args_ok" }, provider_id: B, declared_at: IN }; i.intent_id = intentId(i); return signIntent(i, priv(B)); }
const signObs = (o) => signEdge(signObservation({ task_id: T, hop: { seq: o.seq, from: o.from, to: o.to }, prev_evidence_id: o.prev === undefined ? null : o.prev, conduct: { verdict: o.verdict, detail_ref: o.detail_ref === undefined ? null : o.detail_ref }, witness_id: o.witness, observed_at: IN }, priv(o.witness)), priv(o.from));

const grant = mintGrant();
const receipt = mintReceipt(grant);
const intent = mintIntent(grant);
const h0 = (() => { const o = { task_id: T, hop: { seq: 0, from: A, to: B }, prev_evidence_id: null, conduct: { verdict: "pass", detail_ref: "nenrin-exec://" + receipt.receipt_id }, witness_id: W1, observed_at: IN }; o.evidence_id = evidenceId(o); return signEdge(signObservation(o, priv(W1)), priv(A)); })();
const h1 = (() => { const o = { task_id: T, hop: { seq: 1, from: B, to: C }, prev_evidence_id: h0.evidence_id, conduct: { verdict: "pass", detail_ref: null }, witness_id: W2, observed_at: IN }; o.evidence_id = evidenceId(o); return signEdge(signObservation(o, priv(W2)), priv(B)); })();
const base = { task_id: T, observations: [h0, h1], grant, intent, receipt, resolve };

// ---- happy: verified facts, no conflicts, honest limits carried, anchors populated ----
const consumed = consumeEvidence(base);
chk("consume reports verified true on a clean graph", consumed.facts.verified === true, JSON.stringify(consumed.conflicts));
chk("consume reports authorized_before_execution and executed_matches_authorization", consumed.facts.authorized_before_execution === true && consumed.facts.executed_matches_authorization === true);
chk("consume reports a reconciled completed outcome", consumed.facts.outcome && consumed.facts.outcome.status === "completed" && consumed.facts.outcome.reconciled === true);
chk("consume reports two pass hops and one digest link", consumed.facts.hops.length === 2 && consumed.facts.hops.every((h) => h.verdict === "pass") && consumed.facts.digest_links === 1);
chk("consume carries content anchors the engine can key on", consumed.anchors.grant_ref === grant.grant_ref && consumed.anchors.reconciled_receipt_id === receipt.receipt_id && consumed.anchors.intent_id === intent.intent_id && consumed.anchors.observation_evidence_ids.length === 2);
chk("consume carries the honest limits unchanged from provenance", Array.isArray(consumed.does_not_establish) && consumed.does_not_establish.some((s) => s.includes("no side-effect oracle")));
chk("consume states the evidence-not-decision contract", typeof consumed.contract === "string" && consumed.contract.includes("no trust score") && consumed.contract.includes("no allow or deny"));
chk("consume tells the engine how to re-verify it itself", consumed.reverify && typeof consumed.reverify.how === "string" && !!consumed.reverify.provenance);

// ---- HARD INVARIANT: no trust score and no decision anywhere in the projection ----
const ks = allKeys(consumed);
const forbidden = ["score", "trust_score", "trust", "allow", "deny", "decision", "recommendation", "recommend", "proceed"];
chk("the projection contains NO score/trust/allow/deny/decision/recommend key anywhere", forbidden.every((k) => !ks.has(k)), [...ks].filter((k) => forbidden.includes(k)).join(","));

// ---- disagreement is surfaced, not collapsed ----
const d0b = (() => { const o = { task_id: T, hop: { seq: 0, from: A, to: B }, prev_evidence_id: null, conduct: { verdict: "fail", detail_ref: "nenrin-exec://" + receipt.receipt_id }, witness_id: W2, observed_at: IN }; o.evidence_id = evidenceId(o); return signEdge(signObservation(o, priv(W2)), priv(A)); })();
const dis = consumeEvidence({ ...base, observations: [h0, d0b, h1] });
chk("disagreement is surfaced in conflicts, not smoothed away", dis.conflicts.disagreements.length === 1 && dis.facts.hops.find((h) => h.seq === 0).disagreement === true);

// ---- equivocation refuses and is surfaced ----
const receipt2 = mintReceipt(grant, { status: "failed", result: "sha_res_2" });
const eq = consumeEvidence({ ...base, receipt, receipts: [receipt, receipt2] });
chk("equivocation makes verified false and is surfaced in conflicts", eq.facts.verified === false && eq.conflicts.equivocations.length === 1 && eq.conflicts.refused === true);

// ---- posture line: counts only, no score ----
const pl = postureLine(dis);
chk("postureLine gives counts only, no score key, and reflects the disagreement", pl.disagreement_hops === 1 && !("score" in pl) && !("trust" in pl) && typeof pl.note === "string");

// ---- determinism + dashes ----
chk("consume is deterministic for identical input", JSON.stringify(consumeEvidence(base)) === JSON.stringify(consumed));
chk("no em/en/bar dashes in the projection", !DASH.test(JSON.stringify(consumed)));

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS (nenrin-consume-v0: verified evidence for a trust engine, no score, no decision)");
process.exit(fail ? 1 : 0);
