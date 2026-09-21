import { test } from "node:test";
import assert from "node:assert/strict";
import { issueRDA, toJidecSeed } from "./issuer.mjs";
import { validateRDA, makeSpentSet, rdaId } from "./rda.mjs";
import { makeHistory } from "./history.mjs";

// A -> B -> C, executor C, connectors A and B. witness W is independent.
const delegation = () => [
  { hop: { seq: 0, from: "A", to: "B" }, witness_id: "W", conduct: { verdict: "pass" }, evidence_id: "ev0" },
  { hop: { seq: 1, from: "B", to: "C" }, witness_id: "W", conduct: { verdict: "pass" }, evidence_id: "ev1" },
];
const agreement = { schema: "a2a-agreement-v1", terms: { amount: 1000000, currency: "JPY" }, record_sha256: "agr1" };
const witness = { witness_id: "W", conduct: { verdict: "pass" }, evidence_id: "wit1" };
const settlement = (over = {}) => ({ ref: "pay1", signer_kind: "psp", customer_ref: "cust", settled_at: "2026-09-21T00:00:00Z", ...over });
const base = (over = {}) => ({ task_id: "t1", delegation: delegation(), agreement, witness, settlement: settlement(), operate_to: "Yakumo", ...over });

test("happy path: valid RDA, executor C, two connectors at 250, execute 9200", async () => {
  const r = await issueRDA(base());
  assert.equal(r.ok, true, JSON.stringify(r.why));
  assert.equal((await validateRDA(r.rda)).ok, true);
  const byRole = (role) => r.rda.splits.filter((s) => s.role === role);
  assert.equal(byRole("execute")[0].agent_id, "C");
  assert.equal(byRole("execute")[0].share_bps, 9200);
  assert.equal(byRole("connect").length, 2);
  assert.equal(byRole("operate")[0].share_bps, 300);
  assert.equal(r.rda.gross.amount, 1000000);
});

test("fail-closed: a non-pass verdict yields no RDA", async () => {
  const r = await issueRDA(base({ witness: { witness_id: "W", conduct: { verdict: "fail" }, evidence_id: "wit1" } }));
  assert.equal(r.ok, false);
  assert.ok(r.why[0].includes("not pass"));
});

test("fail-closed: a Tier C settlement is refused (G5)", async () => {
  const r = await issueRDA(base({ settlement: settlement({ signer_kind: "self_custodial" }) }));
  assert.equal(r.ok, false);
  assert.ok(r.why[0].includes("not admissible"));
});

test("W3: a witness that is a party to the task is refused", async () => {
  const r = await issueRDA(base({ witness: { witness_id: "C", conduct: { verdict: "pass" }, evidence_id: "w" } }));
  assert.equal(r.ok, false);
  assert.ok(r.why[0].includes("W3"));
});

test("G4: prior settled A->C tasks decay A's connect share", async () => {
  const h = makeHistory([
    { splits: [{ role: "connect", agent_id: "A", share_bps: 250 }, { role: "execute", agent_id: "C", share_bps: 9450 }] },
  ]);
  const r = await issueRDA(base({ history: h }));
  const a = r.rda.splits.find((s) => s.role === "connect" && s.agent_id === "A");
  assert.equal(a.share_bps, 125); // floor(250 * 0.5), one prior pairing
});

test("G6: an over-cap connector is folded into execute", async () => {
  // A already has 400 connect and 0 execute in history -> next 250 would exceed execute+grace(500)? 400+250=650 > 500 -> fold A
  const h = makeHistory([
    { splits: [{ role: "connect", agent_id: "A", share_bps: 250 }, { role: "execute", agent_id: "Z", share_bps: 9450 }] },
    { splits: [{ role: "connect", agent_id: "A", share_bps: 150 }, { role: "execute", agent_id: "Z", share_bps: 9550 }] },
  ]);
  const r = await issueRDA(base({ history: h }));
  assert.ok(r.folded.includes("A"));
  assert.equal(r.rda.splits.filter((s) => s.role === "connect").length, 1); // only B survives
  assert.equal(r.rda.splits.find((s) => s.role === "execute").share_bps, 9450); // 10000 - 250(B) - 300
});

test("G2: a spent settlement_ref is rejected on the second task", async () => {
  const spent = makeSpentSet();
  const r1 = await issueRDA(base({ spent }));
  assert.equal(r1.ok, true);
  spent.markSpent(r1.rda);
  const r2 = await issueRDA(base({ task_id: "t2", spent })); // same settlement ref pay1
  assert.equal(r2.ok, false);
  assert.ok(r2.why.some((w) => w.includes("already spent")));
});

test("S8: the JIDEC seed claim_sha256 equals the rda_id", async () => {
  const r = await issueRDA(base());
  const seed = await toJidecSeed(r.rda);
  assert.equal(seed.claim_sha256, await rdaId(r.rda));
  assert.equal(seed.claim_sha256, r.rda.rda_id);
  assert.ok(seed.record_canonical.includes("\"task_id\":\"t1\""));
  assert.ok(seed.work.includes("not a transfer"));
});
