// make_interop_fixtures.mjs : one-shot generator for the NENRIN reference interop test. Builds five frozen,
// did:key-verifiable provenance bundles, one per interop case (pass, disagreement, equivocation,
// forged_signature, broken_chain), runs each through the published verifier (sdk/nenrin_verify.mjs), and freezes
// the canonical verdict signature of each into expected.json. Any implementation that reproduces these verdict
// signatures on these fixtures is interoperable with the NENRIN evidence layer. Re-running makes NEW fixtures
// with fresh keys, so the committed fixtures and expected.json are the immutable reference and run_interop.mjs is the check.
import { writeFileSync, mkdirSync } from "node:fs";
import { evidenceId } from "../task-delegation-bind-v0/bind.mjs";
import { newAgentKey, signObservation, signEdge } from "../task-delegation-bind-v0/sign.mjs";
import { grantRef, receiptId } from "../task-execution-bind-v0/bind_exec.mjs";
import { signGrant, signReceipt } from "../task-execution-bind-v0/sign_exec.mjs";
import { didKeyEncode, rawFromKeyObject } from "../task-delegation-bind-v0/verify_fixture.mjs";
import { verifyProvenance, didKeyResolver } from "../sdk/nenrin_verify.mjs";

const NB = "2026-09-19T00:00:00Z", NA = "2026-09-19T01:00:00Z", IN = "2026-09-19T00:30:00Z";
const REF = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const GOODEV = { kind: "ledger_record", ref: REF, system: "ledger.horizonshield.dev" };
const ACTION = { tool: "a2a.invoke", target: "/task", args_sha256: "sha_args_ok" };
function did() { const k = newAgentKey(); return { k, id: didKeyEncode(rawFromKeyObject(k.publicKey)) }; }
function flipB64(s) { const i = 10; const c = s[i]; const r = c === "A" ? "B" : "A"; return s.slice(0, i) + r + s.slice(i + 1); }

function makeBundle(task_id, flavor) {
  const A = did(), B = did(), C = did(), W1 = did(), W2 = did();
  const priv = {}; for (const x of [A, B, C, W1, W2]) priv[x.id] = x.k.privateKey;
  const grant = (() => { const g = { schema: "task-execution-bind-v0/grant", task_id, action: ACTION, caller_id: A.id, provider_id: B.id, nonce: "n1", not_before: NB, not_after: NA }; g.grant_ref = grantRef(g); return signGrant(g, A.k.privateKey); })();
  const mkReceipt = (o = {}) => { const r = { schema: "task-execution-bind-v0/receipt", task_id, grant_ref: grant.grant_ref, executed_action: ACTION, outcome: { status: o.status || "completed", result_sha256: o.result || "sha_res_1", evidence: GOODEV }, provider_id: B.id, executed_at: IN }; r.receipt_id = receiptId(r); return signReceipt(r, B.k.privateKey); };
  const receipt = mkReceipt();
  const mkObs = (o) => { const obs = { task_id, hop: { seq: o.seq, from: o.from, to: o.to }, prev_evidence_id: o.prev === undefined ? null : o.prev, conduct: { verdict: o.verdict, detail_ref: o.detail_ref === undefined ? null : o.detail_ref }, witness_id: o.witness, observed_at: IN }; obs.evidence_id = evidenceId(obs); return signEdge(signObservation(obs, priv[o.witness]), priv[o.from]); };
  const h0 = mkObs({ seq: 0, from: A.id, to: B.id, witness: W1.id, verdict: "pass", detail_ref: "nenrin-exec://" + receipt.receipt_id });
  const h1 = mkObs({ seq: 1, from: B.id, to: C.id, witness: W2.id, verdict: "pass", prev: h0.evidence_id });
  const bundle = { task_id, observations: [h0, h1], grant, receipt };
  if (flavor === "disagreement") { const d = mkObs({ seq: 0, from: A.id, to: B.id, witness: W2.id, verdict: "fail", detail_ref: "nenrin-exec://" + receipt.receipt_id }); bundle.observations = [h0, d, h1]; }
  if (flavor === "equivocation") { bundle.receipts = [receipt, mkReceipt({ status: "failed", result: "sha_res_2" })]; }
  if (flavor === "forged_signature") { bundle.observations = [Object.assign({}, h0, { witness_sig: flipB64(h0.witness_sig) }), h1]; }
  if (flavor === "broken_chain") { bundle.observations = [h1]; }
  return bundle;
}

const CASES = [
  { name: "pass", intent: "a clean, fully signed delegation and execution graph, accepted" },
  { name: "disagreement", intent: "two witnesses of one hop disagree; verified true, the disagreement is surfaced not collapsed (R4)" },
  { name: "equivocation", intent: "the provider signed two conflicting receipts for one grant; fail-closed refusal" },
  { name: "forged_signature", intent: "one observation carries a tampered witness signature; refusal" },
  { name: "broken_chain", intent: "hop continuity does not hold over the presented set (R3); refusal" },
];
const sig = (p) => ({ verdict: p.verdict, refusals: p.refusals.map((r) => r.code).sort(), findings: p.findings.map((f) => f.code).sort() });

mkdirSync(new URL("./fixtures/", import.meta.url), { recursive: true });
const expected = { schema: "nenrin-interop-expected-v0", version: "0.1.0", verifier: "nenrin-provenance-verify-v0 (sdk/nenrin_verify.mjs, npm: nenrin-verify)", note: "the canonical verdict signature each fixture must reproduce: verdict, sorted refusal codes, sorted finding codes", cases: {} };
for (const c of CASES) {
  const task_id = "task_interop_" + c.name;
  const bundle = makeBundle(task_id, c.name);
  const p = verifyProvenance(Object.assign({}, bundle, { resolve: didKeyResolver }));
  writeFileSync(new URL("./fixtures/" + c.name + ".json", import.meta.url), JSON.stringify(bundle, null, 2) + "\n");
  expected.cases[c.name] = { intent: c.intent, task_id, expect: sig(p) };
  console.log(c.name.padEnd(18) + JSON.stringify(sig(p)));
}
writeFileSync(new URL("./expected.json", import.meta.url), JSON.stringify(expected, null, 2) + "\n");
console.log("\nwrote fixtures and expected.json");
