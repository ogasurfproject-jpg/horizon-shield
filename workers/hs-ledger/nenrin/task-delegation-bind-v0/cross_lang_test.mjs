// cross_lang_test.mjs : proves the Python producer (task_witness_emit.py) and the JS ledger face
// (task_ledger_v0.mjs) agree on evidence_id byte-for-byte. Python-produced observations are fed into the
// JS ledger POST handler; every one must be ACCEPTED (200), which means the JS recompute equals the Python
// evidence_id. If canonical() differed across languages by a single byte, the JS R2 check would 422.
// Run: python3 task_witness_emit.py > obs.json && node cross_lang_test.mjs
import { readFileSync } from "node:fs";
import { handleTaskWitness } from "./task_ledger_v0.mjs";

const observations = JSON.parse(readFileSync(new URL("./obs.json", import.meta.url), "utf8"));

function kv() {
  const m = new Map();
  return {
    async put(k, v) { m.set(k, v); },
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}
const env = { LEDGER: kv() };
function req(o) { return { method: "POST", json: async () => o }; }
function urlFor(qs) { return new URL("https://x/witness/task?" + qs); }
let fails = 0;
const ok = (n, c) => { console.log((c ? "  ok   " : "  FAIL ") + n); if (!c) fails++; };
async function post(o) { const r = await handleTaskWitness("/witness/task", req(o), null, env); return { status: r.status, body: JSON.parse(await r.text()) }; }
async function get(qs) { const r = await handleTaskWitness("/witness/task", { method: "GET" }, urlFor(qs), env); return { status: r.status, body: JSON.parse(await r.text()) }; }

console.log("cross-lang: Python producer output -> JS ledger (" + observations.length + " observations)");

let accepted = 0;
for (const o of observations) {
  const p = await post(o);
  const match = p.status === 200 && p.body.evidence_id === o.evidence_id;
  ok("accept " + o.task_id + " hop" + o.hop.seq + " " + o.witness_id + "  (200 and evidence_id matches => cross-lang byte match)", match);
  if (match) accepted++;
}
ok("all " + observations.length + " python observations accepted by JS ledger", accepted === observations.length);

{ const g = await get("task_id=prod-t2"); ok("prod-t2 two-hop chain continuous (cross-lang prev_evidence_id linkage, R3)", g.body.hops_observed === 2 && g.body.chain_continuous === true); }
{ const g = await get("task_id=prod-t3"); ok("prod-t3 disagreement preserved (R4)", g.body.hops[0].verdict === "disagreement" && g.body.hops[0].witnesses === 2); }
{ const g = await get("task_id=prod-t1"); ok("prod-t1 single PASS", g.body.hops[0].verdict === "PASS" && g.body.hops[0].witnesses === 1); }

console.log(fails ? ("\n" + fails + " FAILED") : "\nALL PASS (cross-lang producer <-> ledger)");
process.exit(fails ? 1 : 0);
