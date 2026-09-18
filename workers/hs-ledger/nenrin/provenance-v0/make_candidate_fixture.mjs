// make_candidate_fixture.mjs : one-shot generator for candidate_fixture.json, the real multi-candidate discovery
// state for a2aproject/A2A#1631 and ziolndr's ARBITER. Several candidate agents for one task, each with real
// did:key-signed provenance, covering the two hard cases ziolndr named: a witness disagreement and a provider
// equivocation. It runs NENRIN candidateEvidenceSet (evidence only, permitted and order left null), then a
// clearly-labeled REFERENCE trust filter (not NENRIN) to produce the finite permitted set, and leaves order null
// for ARBITER. Re-running produces a NEW fixture with fresh keys, so the COMMITTED candidate_fixture.json is the
// immutable artifact and verify_candidate_fixture.mjs is the offline check.
import { writeFileSync } from "node:fs";
import { evidenceId } from "../task-delegation-bind-v0/bind.mjs";
import { newAgentKey, signObservation, signEdge } from "../task-delegation-bind-v0/sign.mjs";
import { grantRef, receiptId } from "../task-execution-bind-v0/bind_exec.mjs";
import { signGrant, signReceipt } from "../task-execution-bind-v0/sign_exec.mjs";
import { didKeyEncode, rawFromKeyObject, publicKeyFromDidKey } from "../task-delegation-bind-v0/verify_fixture.mjs";
import { candidateEvidenceSet } from "./candidate_evidence.mjs";
import { referenceTrustFilter } from "./reference_trust_filter.mjs";

const T = "task_discovery_1631_1";
const NB = "2026-09-18T00:00:00Z", NA = "2026-09-18T01:00:00Z", IN = "2026-09-18T00:30:00Z";
const REF = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const GOODEV = { kind: "ledger_record", ref: REF, system: "ledger.horizonshield.dev" };
const resolve = (id) => publicKeyFromDidKey(id);

function did() { const k = newAgentKey(); return { k, id: didKeyEncode(rawFromKeyObject(k.publicKey)) }; }

function makeCandidate(candidate_id, flavor) {
  const A = did(), B = did(), C = did(), W1 = did(), W2 = did();
  const priv = {}; for (const x of [A, B, C, W1, W2]) priv[x.id] = x.k.privateKey;
  const grant = (() => { const g = { schema: "task-execution-bind-v0/grant", task_id: T, action: { tool: "a2a.invoke", target: "/task", args_sha256: "sha_args_ok" }, caller_id: A.id, provider_id: B.id, nonce: "n1", not_before: NB, not_after: NA }; g.grant_ref = grantRef(g); return signGrant(g, A.k.privateKey); })();
  const mkReceipt = (o = {}) => { const r = { schema: "task-execution-bind-v0/receipt", task_id: T, grant_ref: grant.grant_ref, executed_action: { tool: "a2a.invoke", target: "/task", args_sha256: "sha_args_ok" }, outcome: { status: o.status || "completed", result_sha256: o.result || "sha_res_1", evidence: GOODEV }, provider_id: B.id, executed_at: IN }; r.receipt_id = receiptId(r); return signReceipt(r, B.k.privateKey); };
  const receipt = mkReceipt();
  const mkObs = (o) => { const obs = { task_id: T, hop: { seq: o.seq, from: o.from, to: o.to }, prev_evidence_id: o.prev === undefined ? null : o.prev, conduct: { verdict: o.verdict, detail_ref: o.detail_ref === undefined ? null : o.detail_ref }, witness_id: o.witness, observed_at: IN }; obs.evidence_id = evidenceId(obs); return signEdge(signObservation(obs, priv[o.witness]), priv[o.from]); };
  const h0 = mkObs({ seq: 0, from: A.id, to: B.id, witness: W1.id, verdict: "pass", detail_ref: "nenrin-exec://" + receipt.receipt_id });
  const h1 = mkObs({ seq: 1, from: B.id, to: C.id, witness: W2.id, verdict: "pass", prev: h0.evidence_id });
  const records = { observations: [h0, h1], grant, receipt };
  if (flavor === "disagreement") { const d = mkObs({ seq: 0, from: A.id, to: B.id, witness: W2.id, verdict: "fail", detail_ref: "nenrin-exec://" + receipt.receipt_id }); records.observations = [h0, d, h1]; }
  if (flavor === "equivocation") { records.receipts = [receipt, mkReceipt({ status: "failed", result: "sha_res_2" })]; }
  return { candidate_id, records };
}

const candidates = [
  makeCandidate("cand_alpha", "clean"),
  makeCandidate("cand_bravo", "disagreement"),
  makeCandidate("cand_charlie", "equivocation"),
];
candidates.forEach((c) => { c.records.resolve = resolve; });

const set = candidateEvidenceSet(T, candidates);
const filter = referenceTrustFilter(set);
const embedRecords = (rec) => { const { resolve: _r, ...rest } = rec; return rest; };

const fixture = {
  schema: "nenrin-candidate-fixture-v0",
  version: "0.1.0",
  note: "A frozen, did:key-verifiable multi-candidate discovery state for a2aproject/A2A#1631 and ziolndr's ARBITER (ziolndr/arbiter-agent-routing). Three candidate agents for one task, each with real Ed25519 did:key-signed provenance, covering the two hard cases: a witness disagreement (surfaced, not smoothed) and a provider equivocation (fail-closed). NENRIN supplies evidence only; the reference trust filter produces permitted; order is left null for ARBITER.",
  how_to_verify: "node verify_candidate_fixture.mjs  (offline: resolves every did:key with no network, re-runs nenrin-candidate-evidence-v0 from the embedded records, re-applies the reference trust filter, and checks the recorded candidate set and permitted set match).",
  did_key_note: "every caller, provider and witness id is a did:key; the Ed25519 public keys are self-encoded in the identifiers, so verification needs no network and no key server.",
  boundary: "evidence (NENRIN candidateEvidenceSet) then permitted (trust filter) then order (ARBITER) then recorded result (NENRIN run_record). NENRIN computes no permitted, no order, no score. The reference trust filter is an example policy, not NENRIN. ARBITER, not NENRIN, produces order.",
  task: { task_id: T, description: "select an agent to perform the A2A invocation a2a.invoke /task for " + T + "; three candidates were discovered, each with its own provenance", authorized_action: { tool: "a2a.invoke", target: "/task" } },
  candidate_ids: candidates.map((c) => c.candidate_id),
  candidates: candidates.map((c) => ({ candidate_id: c.candidate_id, records: embedRecords(c.records) })),
  candidate_evidence_set: set,
  reference_trust_filter: filter,
  run_record: Object.assign({}, set.run_record, {
    permitted: filter.permitted,
    permitted_by: "reference-trust-filter-v0 (example policy, not NENRIN)",
    order: null,
    order_by: "left null for ARBITER (ziolndr/arbiter-agent-routing); it orders permitted against the task and writes order back here",
  }),
  arbiter: { repo: "https://github.com/ziolndr/arbiter-agent-routing", compare: "POST https://api.grip.fyi/v1/compare", note: "ARBITER orders the permitted field against the task and returns order; that order is written into run_record.order to complete evidence then permitted then order then recorded result" },
  does_not_establish: set.does_not_establish,
};

writeFileSync(new URL("./candidate_fixture.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
console.log("wrote candidate_fixture.json  candidates=" + candidates.map((c) => c.candidate_id).join(",") + "  permitted=" + JSON.stringify(filter.permitted) + "  order=null");
