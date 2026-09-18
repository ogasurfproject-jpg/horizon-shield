// Adversarial + demo test for candidate_evidence.mjs (NENRIN-side interop for A2A#1631 discovery and an ordering
// primitive such as ARBITER). Builds three candidates for one task: one clean, one with a witness disagreement,
// one with provider equivocation. Asserts NENRIN produces per-candidate verified material and a run-record with
// permitted and order left null, computes no score, and never orders or filters.
import { evidenceId } from "../task-delegation-bind-v0/bind.mjs";
import { newAgentKey, signObservation, signEdge } from "../task-delegation-bind-v0/sign.mjs";
import { grantRef, receiptId } from "../task-execution-bind-v0/bind_exec.mjs";
import { signGrant, signReceipt } from "../task-execution-bind-v0/sign_exec.mjs";
import { candidateEvidenceSet } from "./candidate_evidence.mjs";

const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");
let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 200))); if (!c) fail++; };
function allKeys(o, acc = new Set()) { if (o && typeof o === "object") { if (Array.isArray(o)) o.forEach((x) => allKeys(x, acc)); else for (const k of Object.keys(o)) { acc.add(k); allKeys(o[k], acc); } } return acc; }

const T = "task_discovery_1", NB = "2026-09-18T00:00:00Z", NA = "2026-09-18T01:00:00Z", IN = "2026-09-18T00:30:00Z";
const REF = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const GOODEV = { kind: "ledger_record", ref: REF, system: "ledger.horizonshield.dev" };
const K = {};
const key = (id) => { if (!K[id]) K[id] = newAgentKey(); return K[id]; };
const resolve = (id) => (K[id] ? K[id].publicKey : null);
const priv = (id) => key(id).privateKey;

// build one candidate's provenance for the shared task T. flavor: "clean" | "disagreement" | "equivocation".
function makeCandidate(p, flavor) {
  const A = "did:key:" + p + "A", B = "did:key:" + p + "B", C = "did:key:" + p + "C", W1 = "did:key:" + p + "W1", W2 = "did:key:" + p + "W2";
  [A, B, C, W1, W2].forEach(key);
  const grant = (() => { const g = { schema: "task-execution-bind-v0/grant", task_id: T, action: { tool: "a2a.invoke", target: "/task", args_sha256: "sha_args_ok" }, caller_id: A, provider_id: B, nonce: "n1", not_before: NB, not_after: NA }; g.grant_ref = grantRef(g); return signGrant(g, priv(A)); })();
  const mkReceipt = (o = {}) => { const r = { schema: "task-execution-bind-v0/receipt", task_id: T, grant_ref: grant.grant_ref, executed_action: { tool: "a2a.invoke", target: "/task", args_sha256: "sha_args_ok" }, outcome: { status: o.status || "completed", result_sha256: o.result || "sha_res_1", evidence: GOODEV }, provider_id: B, executed_at: IN }; r.receipt_id = receiptId(r); return signReceipt(r, priv(B)); };
  const receipt = mkReceipt();
  const mkObs = (o) => { const obs = { task_id: T, hop: { seq: o.seq, from: o.from, to: o.to }, prev_evidence_id: o.prev === undefined ? null : o.prev, conduct: { verdict: o.verdict, detail_ref: o.detail_ref === undefined ? null : o.detail_ref }, witness_id: o.witness, observed_at: IN }; obs.evidence_id = evidenceId(obs); return signEdge(signObservation(obs, priv(o.witness)), priv(o.from)); };
  const h0 = mkObs({ seq: 0, from: A, to: B, witness: W1, verdict: "pass", detail_ref: "nenrin-exec://" + receipt.receipt_id });
  const h1 = mkObs({ seq: 1, from: B, to: C, witness: W2, verdict: "pass", prev: h0.evidence_id });
  const records = { observations: [h0, h1], grant, receipt, resolve };
  if (flavor === "disagreement") { const d = mkObs({ seq: 0, from: A, to: B, witness: W2, verdict: "fail", detail_ref: "nenrin-exec://" + receipt.receipt_id }); records.observations = [h0, d, h1]; }
  if (flavor === "equivocation") { records.receipts = [receipt, mkReceipt({ status: "failed", result: "sha_res_2" })]; }
  return { candidate_id: p, records };
}

const set = candidateEvidenceSet(T, [makeCandidate("cand_clean_", "clean"), makeCandidate("cand_dis_", "disagreement"), makeCandidate("cand_equiv_", "equivocation")]);
const byId = Object.fromEntries(set.candidates.map((c) => [c.candidate_id, c]));

chk("three candidates were evaluated for the one task", set.candidates.length === 3 && set.task_id === T);
chk("the clean candidate verifies with no surfaced conflict", byId["cand_clean_"].verified === true && byId["cand_clean_"].disagreement_hops === 0 && byId["cand_clean_"].equivocations === 0);
chk("the disagreement candidate verifies but surfaces the disagreement, not smoothed", byId["cand_dis_"].verified === true && byId["cand_dis_"].disagreement_hops === 1);
chk("the equivocation candidate is not verified and its equivocation is surfaced", byId["cand_equiv_"].verified === false && byId["cand_equiv_"].equivocations === 1);

// the hard invariant: NENRIN decides nothing here
chk("run_record leaves permitted null (the trust filter decides)", set.run_record.permitted === null);
chk("run_record leaves order null (the orderer such as ARBITER decides)", set.run_record.order === null);
chk("every candidate carries content anchors to key on and re-verify", set.candidates.every((c) => c.anchors && typeof c.anchors.grant_ref === "string") && set.run_record.evidence_anchors.length === 3);
chk("does_not_establish states plainly that NENRIN neither permits, orders, nor scores", set.does_not_establish.some((s) => s.includes("permitted")) && set.does_not_establish.some((s) => s.includes("order")) && set.does_not_establish.some((s) => s.includes("trust score")));
const ks = allKeys(set);
chk("no score/trust/allow/deny/decision/recommendation key anywhere in the set", ["score", "trust_score", "trust", "allow", "deny", "decision", "recommendation"].every((k) => !ks.has(k)), [...ks].filter((k) => ["score", "trust_score", "trust", "allow", "deny", "decision", "recommendation"].includes(k)).join(","));

chk("candidate evidence set is deterministic for identical input", JSON.stringify(candidateEvidenceSet(T, [makeCandidate("cand_clean_", "clean"), makeCandidate("cand_dis_", "disagreement"), makeCandidate("cand_equiv_", "equivocation")]).candidates.map((c) => ({ id: c.candidate_id, v: c.verified, d: c.disagreement_hops, e: c.equivocations }))) === JSON.stringify(set.candidates.map((c) => ({ id: c.candidate_id, v: c.verified, d: c.disagreement_hops, e: c.equivocations }))));
chk("no em/en/bar dashes in the set", !DASH.test(JSON.stringify(set)));

console.log("\n--- demo: per-candidate material a trust filter and ARBITER would read (NENRIN orders nothing) ---");
for (const c of set.candidates) console.log("  " + c.candidate_id + "  verified=" + c.verified + "  disagreement_hops=" + c.disagreement_hops + "  equivocations=" + c.equivocations);
console.log("  run_record.permitted=" + set.run_record.permitted + "  run_record.order=" + set.run_record.order);

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS (nenrin-candidate-evidence-v0: per-candidate verified evidence, NENRIN neither permits nor orders nor scores)");
process.exit(fail ? 1 : 0);
