// Adversarial test for the signature layer. Probes attribution (witness_sig) and party-attested edges (edge_sig):
// spoofed witness, forged edge, cross-task replay, post-sign tamper. Also proves signing does not move evidence_id.
import { evidenceId, verifyObservation } from "./bind.mjs";
import { newAgentKey, signObservation, signEdge, verifySigned, verifyWitnessSig } from "./sign.mjs";

const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");
let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 200))); if (!c) fail++; };

const K = { A: newAgentKey(), B: newAgentKey(), C: newAgentKey(), W1: newAgentKey(), W2: newAgentKey(), X: newAgentKey() };
const resolve = (id) => (K[id] ? K[id].publicKey : null);

function mint(o) {
  const obs = {
    task_id: o.task_id, hop: { seq: o.seq, from: o.from, to: o.to },
    prev_evidence_id: o.prev === undefined ? null : o.prev,
    conduct: { verdict: o.verdict, detail_ref: "nenrin://" + o.task_id + "/" + o.seq },
    witness_id: o.witness, observed_at: "2026-09-16T00:00:00Z",
  };
  obs.evidence_id = evidenceId(obs);
  return obs;
}

const T = "task_8f31";
const base = mint({ task_id: T, seq: 0, from: "A", to: "B", witness: "W1", verdict: "pass" });
const eid_unsigned = base.evidence_id;
// witness W1 signs its observation, delegating party A signs the edge
let good = signObservation(base, K.W1.privateKey);
good = signEdge(good, K.A.privateKey);

// ---- positives ----
chk("signed observation verifies (witness_sig + edge_sig)", verifySigned(good, resolve).ok);
chk("signing does not change evidence_id (preimage excludes sigs)", evidenceId(good) === eid_unsigned);
chk("core R1+R2 still hold on the signed record", verifyObservation(good).ok);

// ---- S1: spoofed witness (claims W1 but signs with an unrelated key X) ----
let s1 = signObservation(base, K.X.privateKey);   // witness_id still "W1"
s1 = signEdge(s1, K.A.privateKey);
const rS1 = verifySigned(s1, resolve);
chk("S1 spoofed witness rejected", rS1.ok === false && rS1.reason === "witness_sig_invalid", rS1.reason);

// ---- S2: forged edge (the receiver B signs the edge instead of the delegator A) ----
let s2 = signObservation(base, K.W1.privateKey);
s2 = signEdge(s2, K.B.privateKey);                // hop.from is A, but B signed
const rS2 = verifySigned(s2, resolve);
chk("S2 forged edge (signed by receiver, not delegator) rejected", rS2.ok === false && rS2.reason === "edge_sig_invalid", rS2.reason);

// ---- S3: cross-task replay (lift a valid signed record onto a different task_id) ----
const s3 = Object.assign({}, good, { task_id: "task_OTHER" });
chk("S3 cross-task replay rejected (sig bound to task_id)", verifyWitnessSig(s3, resolve("W1")) === false);

// ---- S4: post-sign tamper (flip the verdict to pass after W1 signed a fail) ----
let failObs = mint({ task_id: T, seq: 0, from: "A", to: "B", witness: "W1", verdict: "fail" });
let s4 = signObservation(failObs, K.W1.privateKey);
s4 = Object.assign({}, s4, { conduct: { verdict: "pass", detail_ref: failObs.conduct.detail_ref } });
chk("S4 post-sign verdict tamper rejected", verifyWitnessSig(s4, resolve("W1")) === false);

// ---- unsigned record must not pass signed verify ----
chk("unsigned record fails signed verify", verifySigned(base, resolve).ok === false);

chk("no em/en/bar dashes in signed record", !DASH.test(JSON.stringify(good)));

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS (task-delegation-bind-v0 signature layer)");
process.exit(fail ? 1 : 0);
