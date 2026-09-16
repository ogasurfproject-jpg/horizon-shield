// task_trust_signal_selftest.mjs : offline test of GET /trust-signal?task_id=<id> (task-bound conduct signal).
// In-memory KV + Web Crypto. Verifies verdict aggregation (R4), chain continuity (R3), adverse-hop naming,
// disclosure, dispatcher guards, and the hard promise that no numeric score is ever emitted.
// Run: node task_trust_signal_selftest.mjs
import { evidenceId, handleTaskWitness, handleTaskTrustSignal } from "./task_ledger_v0.mjs";

function kv() {
  const m = new Map();
  return {
    async put(k, v) { m.set(k, v); },
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}
const ENV = () => ({ LEDGER: kv() });

async function obs({ task_id, seq = 0, from = "did:key:A", to = "did:key:B", prev = null, verdict = "PASS", witness = "did:key:W1" }) {
  const o = { task_id, hop: { seq, from, to }, prev_evidence_id: prev, conduct: { verdict, detail_ref: null }, witness_id: witness, observed_at: "2026-09-16T00:00:00Z" };
  o.evidence_id = await evidenceId(o);
  return o;
}
function urlFor(qs) { return new URL("https://ledger.horizonshield.dev/trust-signal?" + qs); }

let fails = 0;
const ok = (name, cond) => { console.log((cond ? "  ok   " : "  FAIL ") + name); if (!cond) fails++; };
async function post(env, o) { const r = await handleTaskWitness("/witness/task", { method: "POST", json: async () => o }, null, env); return { status: r.status, body: JSON.parse(await r.text()) }; }
async function ts(env, qs) {
  const r = await handleTaskTrustSignal("/trust-signal", { method: "GET" }, urlFor(qs), env);
  return r === null ? { isNull: true } : { status: r.status, body: JSON.parse(await r.text()) };
}

console.log("task-conduct-trust-signal-v0 : selftest (Web Crypto)");

// 1) two-hop chain, both PASS
{
  const env = ENV();
  const h0 = await obs({ task_id: "tt1", seq: 0, from: "did:key:A", to: "did:key:B", prev: null, witness: "did:key:W1" });
  const h1 = await obs({ task_id: "tt1", seq: 1, from: "did:key:B", to: "did:key:C", prev: h0.evidence_id, witness: "did:key:W2" });
  await post(env, h0); await post(env, h1);
  const g = await ts(env, "task_id=tt1");
  ok("1 signal name + task_id", g.body.signal === "task-conduct-trust-signal-v0" && g.body.task_id === "tt1");
  ok("1 two hops, chain continuous (R3)", g.body.hops_observed === 2 && g.body.chain_continuous === true);
  ok("1 both PASS", g.body.delegation[0].verdict === "PASS" && g.body.delegation[1].verdict === "PASS");
  ok("1 no adverse hops", Array.isArray(g.body.adverse_hops) && g.body.adverse_hops.length === 0);
  ok("1 unsigned => attributable false, signed_witnesses 0, edge_attested false", g.body.delegation[0].attributable === false && g.body.delegation[0].signed_witnesses === 0 && g.body.delegation[0].edge_attested === false);
  ok("1 R1 independent asserted", g.body.delegation[0].independent === true);
  ok("1 issuer_is_party disclosed false", g.body.issuer_is_party === false);
  ok("1 issuer echoes request origin", g.body.issuer === "https://ledger.horizonshield.dev");
}

// 2) disagreement on a hop (R4): PASS + FAIL from two independent witnesses
{
  const env = ENV();
  await post(env, await obs({ task_id: "tt2", seq: 0, verdict: "PASS", witness: "did:key:W1" }));
  await post(env, await obs({ task_id: "tt2", seq: 0, verdict: "FAIL", witness: "did:key:W2" }));
  const g = await ts(env, "task_id=tt2");
  ok("2 disagreement preserved (R4)", g.body.delegation[0].verdict === "disagreement" && g.body.delegation[0].witnesses === 2);
  ok("2 disagreement is adverse (counted, named)", g.body.adverse_hops.length === 1 && g.body.adverse_hops[0] === 0);
}

// 3) FAIL hop is adverse
{
  const env = ENV();
  await post(env, await obs({ task_id: "tt3", seq: 0, verdict: "FAIL", witness: "did:key:W1" }));
  const g = await ts(env, "task_id=tt3");
  ok("3 FAIL verdict surfaced", g.body.delegation[0].verdict === "FAIL");
  ok("3 FAIL named in adverse_hops", g.body.adverse_hops.length === 1 && g.body.adverse_hops[0] === 0);
}

// 4) broken chain (R3): prev does not match
{
  const env = ENV();
  const h0 = await obs({ task_id: "tt4", seq: 0, prev: null, witness: "did:key:W1" });
  const h1 = await obs({ task_id: "tt4", seq: 1, from: "did:key:B", to: "did:key:C", prev: "deadbeef", witness: "did:key:W2" });
  await post(env, h0); await post(env, h1);
  const g = await ts(env, "task_id=tt4");
  ok("4 broken link => chain false + reason (R3)", g.body.chain_continuous === false && g.body.chain_reason === "broken_link");
}

// 5) dispatcher guards: only GET /trust-signal?task_id=... is ours; everything else returns null (falls through)
{
  const env = ENV();
  const noTid = await handleTaskTrustSignal("/trust-signal", { method: "GET" }, new URL("https://x/trust-signal?endpoint=https://mcp.horizonshield.dev/mcp"), env);
  ok("5a no task_id => null (endpoint mode reached untouched)", noTid === null);
  const postMethod = await handleTaskTrustSignal("/trust-signal", { method: "POST" }, urlFor("task_id=tt1"), env);
  ok("5b POST => null (GET only)", postMethod === null);
  const otherPath = await handleTaskTrustSignal("/resume", { method: "GET" }, urlFor("task_id=tt1"), env);
  ok("5c other path => null", otherPath === null);
}

// 6) hard promise: the signal never carries a numeric score, and says so
{
  const env = ENV();
  await post(env, await obs({ task_id: "tt6", seq: 0, verdict: "PASS", witness: "did:key:W1" }));
  const g = await ts(env, "task_id=tt6");
  const raw = JSON.stringify(g.body);
  ok("6 no \"score\" key anywhere in the signal", !/\"score\"\s*:/.test(raw));
  ok("6 not_a_score disclosure present", typeof g.body.not_a_score === "string" && g.body.not_a_score.length > 0);
  ok("6 recompute instructions present", typeof g.body.recompute === "string" && g.body.recompute.indexOf("/witness/task?task_id=") >= 0);
}

// 7) empty task: no observations => empty delegation, chain trivially continuous, no crash
{
  const env = ENV();
  const g = await ts(env, "task_id=does-not-exist");
  ok("7 unknown task => zero hops, no adverse, ok true", g.body.ok === true && g.body.hops_observed === 0 && g.body.adverse_hops.length === 0);
}

console.log(fails ? ("\n" + fails + " FAILED") : "\nALL PASS (task-conduct-trust-signal-v0)");
process.exit(fails ? 1 : 0);
