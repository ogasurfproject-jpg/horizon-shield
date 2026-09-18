// make_t4_fixture.mjs : one-shot generator for t4_fixture.json (local; re-running produces a NEW fixture with
// fresh keys, so the COMMITTED t4_fixture.json is the immutable artifact and verify_fixture.mjs is the check).
import { writeFileSync } from "node:fs";
import { evidenceId } from "./bind.mjs";
import { newAgentKey, signObservation, signEdge } from "./sign.mjs";
import { didKeyEncode, rawFromKeyObject } from "./verify_fixture.mjs";

const W = newAgentKey(), A = newAgentKey(), B = newAgentKey();
const didW = didKeyEncode(rawFromKeyObject(W.publicKey));
const didA = didKeyEncode(rawFromKeyObject(A.publicKey));
const didB = didKeyEncode(rawFromKeyObject(B.publicKey));

const obs = {
  task_id: "task_t4_fixture_1",
  hop: { seq: 0, from: didA, to: didB },
  prev_evidence_id: null,
  conduct: { verdict: "pass", detail_ref: "nenrin://task_t4_fixture_1/0" },
  witness_id: didW,
  observed_at: "2026-09-18T00:00:00Z",
};
obs.evidence_id = evidenceId(obs);
let signed = signObservation(obs, W.privateKey);   // adds witness_sig
signed = signEdge(signed, A.privateKey);           // adds edge_sig

const fixture = {
  schema: "task-delegation-bind-v0/fixture",
  note: "A frozen, did:key-verifiable signed WitnessObservation, tracked (not gitignored) as an immutable T-4 input for a2aproject/A2A#1769. The WitnessObservation implementation pin remains 4d7c9c270c2846465fafdea9833869c5660c4ae2; this is a concrete example vector at its own commit, not a change to the implementation.",
  how_to_verify: "node verify_fixture.mjs  (offline: resolves the did:key witness_id and hop.from to Ed25519 keys with no network, recomputes evidence_id for R2, checks witness independence R1, and verifies witness_sig and edge_sig).",
  did_key_note: "witness_id, hop.from and hop.to are did:key identifiers; the Ed25519 public keys are self-encoded in them, so verification needs no network and no key server.",
  observation: signed,
};
writeFileSync(new URL("./t4_fixture.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
console.log("wrote t4_fixture.json  witness_id=" + didW.slice(0, 24) + "...  evidence_id=" + obs.evidence_id);
