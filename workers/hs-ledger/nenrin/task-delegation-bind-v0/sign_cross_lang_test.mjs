// sign_cross_lang_test.mjs : proves Python Ed25519 signing (task_witness_emit.py) verifies under the JS ledger
// face (task_ledger_v0.mjs) via did:key, and that forged/tampered signatures are rejected.
// Python signs with real Ed25519 keys and did:key identifiers; the JS ledger decodes did:key (base58btc +
// multicodec ed25519-pub) and verifies with Web Crypto. Run after: python3 task_witness_emit.py --signed > signed.json
import { readFileSync } from "node:fs";
import { handleTaskWitness } from "./task_ledger_v0.mjs";

const cases = JSON.parse(readFileSync(new URL("./signed.json", import.meta.url), "utf8"));

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

console.log("sign cross-lang: Python Ed25519 + did:key -> JS ledger verify (" + cases.length + " cases)");

for (const c of cases) {
  const p = await post(c.obs);
  const accepted = p.status === 200;
  const passed = c.expect === "accept" ? accepted : (p.status === 422 && !accepted);
  const got = accepted ? "accept" : ("reject:" + p.body.error);
  ok(c.case + "  -> " + got + "  (expect " + c.expect + ")", passed);
}

{ const g = await get("task_id=sig-t1"); ok("sig-t1 GET: signed_witnesses=1 and edge_attested=true", g.body.hops[0].signed_witnesses === 1 && g.body.hops[0].edge_attested === true); }
{ const g = await get("task_id=sig-t5"); ok("sig-t5 GET: unsigned stored, signed_witnesses=0", g.body.hops[0].signed_witnesses === 0 && g.body.hops[0].verdict === "PASS"); }

console.log(fails ? ("\n" + fails + " FAILED") : "\nALL PASS (sign cross-lang: producer signs, ledger verifies via did:key)");
process.exit(fails ? 1 : 0);
