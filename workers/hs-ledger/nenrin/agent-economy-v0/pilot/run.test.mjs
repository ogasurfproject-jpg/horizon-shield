import { test } from "node:test";
import assert from "node:assert/strict";
import { pickWitness, observationsOf, runFromRecords } from "./run.mjs";
import { rdaId } from "./rda.mjs";

const delegation = () => [
  { hop: { seq: 0, from: "A", to: "B" }, witness_id: "W", conduct: { verdict: "pass" }, evidence_id: "ev0" },
  { hop: { seq: 1, from: "B", to: "C" }, witness_id: "W", conduct: { verdict: "pass" }, evidence_id: "ev1" },
];
const agreement = { schema: "a2a-agreement-v1", terms: { amount: 1000000, currency: "JPY" }, record_sha256: "agr1" };
const settlement = (over = {}) => ({ ref: "pay1", signer_kind: "psp", customer_ref: "cust", settled_at: "2026-09-21T00:00:00Z", ...over });

test("observationsOf unwraps common ledger shapes", () => {
  const arr = delegation();
  assert.equal(observationsOf(arr).length, 2);
  assert.equal(observationsOf({ observations: arr }).length, 2);
  assert.equal(observationsOf({ set: arr }).length, 2);
  assert.deepEqual(observationsOf({ nope: 1 }), []);
});

test("pickWitness takes the independent observation, or one by id", () => {
  const d = delegation();
  assert.equal(pickWitness(d).witness_id, "W");
  assert.equal(pickWitness(d, "W").evidence_id, "ev0");
  assert.equal(pickWitness(d, "ZZ"), null);
});

test("runFromRecords: live-shaped records produce a valid RDA and a matching seed", async () => {
  const r = await runFromRecords({ task_id: "t1", delegation: delegation(), agreement, agreement_ref: "agr1", settlement: settlement(), operate_to: "Yakumo" });
  assert.equal(r.ok, true, JSON.stringify(r.why));
  assert.equal(r.rda.splits.find((s) => s.role === "execute").agent_id, "C");
  assert.equal(r.seed.claim_sha256, await rdaId(r.rda));
  assert.equal(r.seed.claim_sha256, r.rda.rda_id);
});

test("runFromRecords propagates fail-closed (Tier C settlement, no RDA)", async () => {
  const r = await runFromRecords({ task_id: "t1", delegation: delegation(), agreement, settlement: settlement({ signer_kind: "self_custodial" }), operate_to: "Yakumo" });
  assert.equal(r.ok, false);
  assert.ok(r.why[0].includes("not admissible"));
});

test("runFromRecords fails closed when the delegation set has no witness", async () => {
  const r = await runFromRecords({ task_id: "t1", delegation: [], agreement, settlement: settlement() });
  assert.equal(r.ok, false);
  assert.ok(r.why[0].includes("no witness"));
});
