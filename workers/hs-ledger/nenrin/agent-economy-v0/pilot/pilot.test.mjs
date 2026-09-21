import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSplits } from "./recipe.mjs";
import { buildRDA, validateRDA, makeSpentSet, canonical, rdaId } from "./rda.mjs";

const ev = (over = {}) => ({
  executor: "P_exec", operate_to: "P_yakumo",
  connect_hops: [{ connector: "P_conn", executor: "P_exec", prior_count: 0 }],
  delegation_chain_ref: "del:abc", agreement_ref: "agr:abc", witness_set_ref: "wit:abc", settlement_ref: "pay:abc",
  ...over,
});

test("splits always sum to 10000 and execute is the residual majority", () => {
  const r = computeSplits(ev());
  assert.equal(r.sum_bps, 10000);
  assert.equal(r.execute_bps, 9450);
  assert.equal(r.connect_bps, 250);
  assert.equal(r.operate_bps, 300);
  assert.ok(r.execute_bps > r.connect_bps);
});

test("intra-principal connect hop earns 0 and folds into execute", () => {
  const r = computeSplits(ev({ connect_hops: [{ connector: "P_exec", executor: "P_exec", prior_count: 0 }] }));
  assert.equal(r.connect_bps, 0);
  assert.equal(r.execute_bps, 9700);
  assert.equal(r.sum_bps, 10000);
});

test("G4: a repeated pairing decays, remainder to execute", () => {
  const fresh = computeSplits(ev({ connect_hops: [{ connector: "P_conn", executor: "P_exec", prior_count: 0 }] }));
  const repeat = computeSplits(ev({ connect_hops: [{ connector: "P_conn", executor: "P_exec", prior_count: 2 }] }));
  assert.equal(fresh.connect_bps, 250);
  assert.equal(repeat.connect_bps, 62);
  assert.ok(repeat.execute_bps > fresh.execute_bps);
  assert.equal(repeat.sum_bps, 10000);
});

test("E4: only the first N=2 connect hops count", () => {
  const r = computeSplits(ev({ connect_hops: [
    { connector: "P_a", executor: "P_exec", prior_count: 0 },
    { connector: "P_b", executor: "P_exec", prior_count: 0 },
    { connector: "P_c", executor: "P_exec", prior_count: 0 },
  ]}));
  assert.equal(r.connect_bps, 500);
  assert.equal(r.splits.filter((s) => s.role === "connect").length, 2);
  assert.equal(r.execute_bps, 9200);
});

test("buildRDA: rda_id recomputes and a good record validates", async () => {
  const rec = await buildRDA({ task_id: "task:1", evidence: ev(), gross: { amount: 1000000, currency: "JPY", external_customer_ref: "cust:x", settled: true } });
  assert.match(rec.rda_id, /^[0-9a-f]{64}$/);
  assert.equal(rec.rda_id, await rdaId(rec));
  assert.equal((await validateRDA(rec)).ok, true);
});

test("E8 fail-closed: tampered sum and missing ref are rejected", async () => {
  const rec = await buildRDA({ task_id: "t", evidence: ev(), gross: { settled: true } });
  const tampered = { ...rec, splits: [{ agent_id: "P_exec", role: "execute", share_bps: 9999 }] };
  assert.equal((await validateRDA(tampered)).ok, false);
  const noRef = await buildRDA({ task_id: "t", evidence: ev({ settlement_ref: undefined }), gross: { settled: true } });
  const v = await validateRDA(noRef);
  assert.equal(v.ok, false);
  assert.ok(v.why.some((w) => w.includes("settlement_ref")));
});

test("G2: a replayed settlement_ref is rejected by the spent-set", async () => {
  const spent = makeSpentSet();
  const rec = await buildRDA({ task_id: "t1", evidence: ev(), gross: { settled: true } });
  assert.equal((await validateRDA(rec, { spent })).ok, true);
  spent.markSpent(rec);
  const replay = await buildRDA({ task_id: "t2", evidence: ev(), gross: { settled: true } });
  const v = await validateRDA(replay, { spent });
  assert.equal(v.ok, false);
  assert.ok(v.why.some((w) => w.includes("already spent")));
});

test("G3: a recipe committed after settlement is rejected", async () => {
  const rec = await buildRDA({ task_id: "t", evidence: ev(), gross: { settled: true, settled_at: "2026-09-20T00:00:00Z" }, recipe_committed_at: "2026-09-21T00:00:00Z" });
  const v = await validateRDA(rec);
  assert.equal(v.ok, false);
  assert.ok(v.why.some((w) => w.includes("G3")));
});

test("canonical is deterministic and key-order independent", () => {
  assert.equal(canonical({ b: 1, a: [3, 2, 1] }), canonical({ a: [3, 2, 1], b: 1 }));
});
