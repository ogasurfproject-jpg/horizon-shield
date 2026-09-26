// Adversarial test for task-delegation-bind-v0. The binding itself is trivial; these attacks probe the moat:
// observation independence (R1), non-forgery (R2), chain continuity (R3), non-suppression of disagreement (R4).
import { evidenceId, verifyObservation, chainContinuous, aggregateVerdict, canonical, parseStrict } from "./bind.mjs";
import { readFileSync } from "node:fs";

const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");
let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 200))); if (!c) fail++; };

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
// valid A -> B -> C delegation, two independent witnesses, both pass
const h0 = mint({ task_id: T, seq: 0, from: "A", to: "B", witness: "W1", verdict: "pass" });
const h1 = mint({ task_id: T, seq: 1, from: "B", to: "C", witness: "W2", verdict: "pass", prev: h0.evidence_id });

// ---- positive baseline ----
chk("valid observation h0 verifies (R1+R2)", verifyObservation(h0).ok);
chk("valid observation h1 verifies (R1+R2)", verifyObservation(h1).ok);
chk("valid A->B->C chain is continuous (R3)", chainContinuous([h0, h1]).ok);
chk("aggregate of an agreeing hop is the verdict", aggregateVerdict([h0]) === "pass");

// ---- attack 1: self-witness (the party under evaluation observes its own hop) ----
const a1 = mint({ task_id: T, seq: 1, from: "B", to: "C", witness: "C", verdict: "pass", prev: h0.evidence_id });
const r1 = verifyObservation(a1);
chk("A1 self-witness rejected (R1)", r1.ok === false && r1.reason === "witness_not_independent", r1.reason);

// ---- attack 2: bind-swap (keep the id, swap a fail into a favorable pass) ----
const bad = mint({ task_id: T, seq: 0, from: "A", to: "B", witness: "W1", verdict: "fail" });
const a2 = Object.assign({}, bad, { conduct: { verdict: "pass", detail_ref: bad.conduct.detail_ref } }); // id now stale
const r2 = verifyObservation(a2);
chk("A2 bind-swap rejected (R2 recompute mismatch)", r2.ok === false && r2.reason === "recompute_mismatch", r2.reason);

// ---- attack 3: disagreement suppression (two witnesses, opposite verdicts on the same hop) ----
const w1pass = mint({ task_id: T, seq: 0, from: "A", to: "B", witness: "W1", verdict: "pass" });
const w2fail = mint({ task_id: T, seq: 0, from: "A", to: "B", witness: "W2", verdict: "fail" });
chk("A3 full witness set yields disagreement (R4 fail-closed)", aggregateVerdict([w1pass, w2fail]) === "disagreement");
chk("A3 a suppressed subset cannot be laundered into consensus (set holds both)",
  aggregateVerdict([w1pass, w2fail]) !== "pass");

// ---- attack 4: missing hop (claim A->C, hide the B hop) ----
const skip = mint({ task_id: T, seq: 2, from: "B", to: "C", witness: "W2", verdict: "pass", prev: h0.evidence_id });
const r4 = chainContinuous([h0, skip]); // seq 0 then seq 2, no seq 1
chk("A4 hidden hop breaks chain continuity (R3)", r4.ok === false && r4.reason === "seq_gap", r4.reason);

// ---- attack 4b: forged link (right seq, wrong prev pointer) ----
const forged = mint({ task_id: T, seq: 1, from: "B", to: "C", witness: "W2", verdict: "pass", prev: "deadbeef" });
const r4b = chainContinuous([h0, forged]);
chk("A4b forged prev pointer breaks chain (R3 broken_link)", r4b.ok === false && r4b.reason === "broken_link", r4b.reason);

// ---- determinism + no forbidden dashes ----
chk("evidence_id is deterministic", evidenceId(h0) === evidenceId(mint({ task_id: T, seq: 0, from: "A", to: "B", witness: "W1", verdict: "pass" })));
chk("no em/en/bar dashes in records", !DASH.test(JSON.stringify([h0, h1])));

// ---- attack 5: bytes that another runtime would not reproduce (canonical form, pinned) ----
const code = (fn) => { try { fn(); return "ok"; } catch (e) { return e.code || "thrown"; } };
chk("A5 duplicate key refused before hashing (duplicate_key)", code(() => parseStrict('{"task_id":"t","task_id":"u"}')) === "duplicate_key");
chk("A5 nested duplicate key refused (duplicate_key)", code(() => parseStrict('{"hop":{"seq":0,"seq":1}}')) === "duplicate_key");
chk("A5 float refused at parse (non_integer_number)", code(() => parseStrict('{"seq":1.0}')) === "non_integer_number");
chk("A5 exponent refused at parse (non_integer_number)", code(() => parseStrict('{"seq":1e2}')) === "non_integer_number");
chk("A5 integer beyond 2^53-1 refused (unsafe_number)", code(() => parseStrict('{"seq":9007199254740993}')) === "unsafe_number");
chk("A5 non-ASCII key refused (key_not_printable_ascii)", code(() => parseStrict('{"t\u00e9":1}')) === "key_not_printable_ascii");
chk("A5 canonical() refuses a float handed in by code (non_integer_number)", code(() => canonical({ a: 0.5 })) === "non_integer_number");
chk("A5 canonical() refuses a non-ASCII key handed in by code", code(() => canonical({ "\u00e9": 1 })) === "key_not_printable_ascii");
chk("A5 non-ASCII string VALUES are fine and stay raw", canonical({ a: "\u00e9\u2028" }) === '{"a":"\u00e9\u2028"}');
chk("A5 control characters escape short or \\u00xx lowercase", canonical({ a: "\n\u0001" }) === '{"a":"\\n\\u0001"}');
chk("A5 parseStrict then canonical round-trips a clean record byte for byte", canonical(parseStrict(canonical(h0))) === canonical(h0));
// published fixtures keep their ids: the rule only refuses, it never changes bytes of a valid record
const fx = JSON.parse(readFileSync(new URL("./t4_fixture.json", import.meta.url), "utf8"));
const fxObs = Array.isArray(fx) ? fx : (fx.observation ? [fx.observation] : fx.observations || []);
chk("A5 t4_fixture evidence_id(s) unchanged under the pinned rule", fxObs.length > 0 && fxObs.every((o) => evidenceId(o) === o.evidence_id), fxObs.length);

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS (task-delegation-bind-v0 adversarial)");
process.exit(fail ? 1 : 0);
