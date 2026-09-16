// task_ledger_selftest.mjs : offline test of the additive /witness/task ledger face.
// Uses an in-memory KV mock and Web Crypto (global crypto.subtle, present in Node 20+ and in Workers).
// No network, no live ledger. Run: node task_ledger_selftest.mjs
import { evidenceId, handleTaskWitness } from "./task_ledger_v0.mjs";

function kv() {
  const m = new Map();
  return {
    async put(k, v) { m.set(k, v); },
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}
const ENV = () => ({ LEDGER: kv() });

async function obs({ task_id = "t1", seq = 0, from = "did:key:A", to = "did:key:B", prev = null, verdict = "PASS", witness = "did:key:W1" }) {
  const o = { task_id, hop: { seq, from, to }, prev_evidence_id: prev, conduct: { verdict, detail_ref: null }, witness_id: witness, observed_at: "2026-09-16T00:00:00Z" };
  o.evidence_id = await evidenceId(o);
  return o;
}
function req(method, body) { return { method, json: async () => body }; }
function urlFor(qs) { return new URL("https://ledger.horizonshield.dev/witness/task?" + qs); }

let fails = 0;
const ok = (name, cond) => { console.log((cond ? "  ok   " : "  FAIL ") + name); if (!cond) fails++; };
async function post(env, o) { const r = await handleTaskWitness("/witness/task", req("POST", o), null, env); return { status: r.status, body: JSON.parse(await r.text()) }; }
async function get(env, qs) { const r = await handleTaskWitness("/witness/task", { method: "GET" }, urlFor(qs), env); return { status: r.status, body: JSON.parse(await r.text()) }; }

console.log("task-delegation-bind-v0 : ledger face selftest (Web Crypto)");

{
  const env = ENV();
  const o = await obs({ task_id: "t1", verdict: "PASS" });
  const p = await post(env, o);
  ok("1 post accepted (200)", p.status === 200 && p.body.ok === true);
  ok("1 evidence_id echoed matches recompute", p.body.evidence_id === o.evidence_id);
  const g = await get(env, "task_id=t1");
  ok("1 get one hop", g.body.hops_observed === 1 && g.body.hops[0].verdict === "PASS" && g.body.hops[0].witnesses === 1);
}

{
  const env = ENV();
  await post(env, await obs({ task_id: "t2", verdict: "PASS", witness: "did:key:W1" }));
  await post(env, await obs({ task_id: "t2", verdict: "PASS", witness: "did:key:W2" }));
  const g = await get(env, "task_id=t2");
  ok("2 agree -> PASS", g.body.hops[0].verdict === "PASS" && g.body.hops[0].witnesses === 2 && g.body.hops[0].evidence_ids.length === 2);
}

{
  const env = ENV();
  await post(env, await obs({ task_id: "t3", verdict: "PASS", witness: "did:key:W1" }));
  await post(env, await obs({ task_id: "t3", verdict: "FAIL", witness: "did:key:W2" }));
  const g = await get(env, "task_id=t3");
  ok("3 disagree -> disagreement (R4)", g.body.hops[0].verdict === "disagreement" && g.body.hops[0].witnesses === 2);
}

{
  const env = ENV();
  const o = await obs({ task_id: "t4" });
  o.evidence_id = "0".repeat(64);
  const p = await post(env, o);
  ok("4 tampered evidence_id -> 422 recompute_mismatch (R2)", p.status === 422 && p.body.error === "recompute_mismatch");
}

{
  const env = ENV();
  const o = await obs({ task_id: "t4b", verdict: "PASS" });
  o.conduct.verdict = "FAIL";
  const p = await post(env, o);
  ok("4b post-stamp field tamper -> 422 (R2)", p.status === 422 && p.body.error === "recompute_mismatch");
}

{
  const env = ENV();
  const o = await obs({ task_id: "t5", from: "did:key:A", witness: "did:key:A" });
  const p = await post(env, o);
  ok("5 self-witness -> 422 witness_not_independent (R1)", p.status === 422 && p.body.error === "witness_not_independent");
}

{
  const env = ENV();
  const h0 = await obs({ task_id: "t6", seq: 0, from: "did:key:A", to: "did:key:B", prev: null, witness: "did:key:W1" });
  const h1 = await obs({ task_id: "t6", seq: 1, from: "did:key:B", to: "did:key:C", prev: h0.evidence_id, witness: "did:key:W2" });
  await post(env, h0); await post(env, h1);
  const g = await get(env, "task_id=t6");
  ok("6 two hops observed", g.body.hops_observed === 2);
  ok("6 chain continuous true (R3)", g.body.chain_continuous === true);
}

{
  const env = ENV();
  const h0 = await obs({ task_id: "t7", seq: 0, prev: null, witness: "did:key:W1" });
  const h1 = await obs({ task_id: "t7", seq: 1, from: "did:key:B", to: "did:key:C", prev: "deadbeef", witness: "did:key:W2" });
  await post(env, h0); await post(env, h1);
  const g = await get(env, "task_id=t7");
  ok("7 broken link -> chain false (R3)", g.body.chain_continuous === false && g.body.chain_reason === "broken_link");
}

{
  const env = ENV();
  const h0 = await obs({ task_id: "t8", seq: 0, prev: null, witness: "did:key:W1" });
  const h2 = await obs({ task_id: "t8", seq: 2, prev: "whatever", witness: "did:key:W3" });
  await post(env, h0); await post(env, h2);
  const g = await get(env, "task_id=t8");
  ok("8 seq gap -> chain false (R3)", g.body.chain_continuous === false && g.body.chain_reason === "seq_gap");
}

{
  const env = ENV();
  await post(env, await obs({ task_id: "t9", verdict: "PASS", witness: "did:key:W1" }));
  await post(env, await obs({ task_id: "other", verdict: "FAIL", witness: "did:key:W9" }));
  const g = await get(env, "task_id=t9");
  ok("9 cross-task isolation", g.body.hops_observed === 1 && g.body.hops[0].verdict === "PASS");
}

{
  const env = ENV();
  const h0 = await obs({ task_id: "t10", seq: 0, prev: null, witness: "did:key:W1" });
  const h1 = await obs({ task_id: "t10", seq: 1, prev: h0.evidence_id, witness: "did:key:W2" });
  await post(env, h0); await post(env, h1);
  const g = await get(env, "task_id=t10&hop=1");
  ok("10 hop filter returns only seq 1", g.body.hops.length === 1 && g.body.hops[0].hop_seq === 1);
}

{
  const env = ENV();
  const p = await post(env, { task_id: "t11" });
  ok("11 missing hop -> 400 hop_missing", p.status === 400 && p.body.error === "hop_missing");
}

{
  const env = ENV();
  const r = await handleTaskWitness("/witness/task", { method: "GET" }, new URL("https://x/witness/task"), env);
  ok("12 get without task_id -> 400", r.status === 400);
}

console.log(fails ? ("\n" + fails + " FAILED") : "\nALL PASS (task_ledger_v0, Web Crypto)");
process.exit(fails ? 1 : 0);
