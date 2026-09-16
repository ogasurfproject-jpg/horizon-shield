// Signature layer for task-delegation-bind-v0. Ed25519 detached signatures over the same canonical bytes
// as evidence_id. Wire form in production is a detached JWS (EdDSA); DIDs resolve to the public key
// (did:key is self-contained and needs no network). Here a resolver id -> publicKey stands in for DID resolution.
//
// Two signatures, two different jobs:
//  witness_sig : the witness signs its observation -> the verdict is ATTRIBUTABLE and non-repudiable (not spoofable).
//  edge_sig    : the delegating party (hop.from) signs {task_id, hop} -> the edge A->B is PARTY-ATTESTED,
//                not merely witness-claimed. This closes the self-asserted-chain hole at the party level.
// Honest line: signatures prove WHO asserted, not that the assertion is TRUE. Combined with R1 (independent
// witness) and R4 (disagreement surfaced) you get attributable + independent + non-suppressible observations.
import { sign as nodeSign, verify as nodeVerify, generateKeyPairSync } from "node:crypto";
import { canonical, preimage } from "./bind.mjs";

export function newAgentKey() { return generateKeyPairSync("ed25519"); } // { publicKey, privateKey } KeyObjects

const edgeOf = (obs) => ({ task_id: obs.task_id, hop: obs.hop });

export function signObservation(obs, witnessPriv) {
  const sig = nodeSign(null, Buffer.from(canonical(preimage(obs)), "utf8"), witnessPriv);
  return Object.assign({}, obs, { witness_sig: sig.toString("base64") });
}
export function signEdge(obs, fromPriv) {
  const sig = nodeSign(null, Buffer.from(canonical(edgeOf(obs)), "utf8"), fromPriv);
  return Object.assign({}, obs, { edge_sig: sig.toString("base64") });
}
export function verifyWitnessSig(obs, witnessPub) {
  if (typeof obs.witness_sig !== "string" || !witnessPub) return false;
  try { return nodeVerify(null, Buffer.from(canonical(preimage(obs)), "utf8"), witnessPub, Buffer.from(obs.witness_sig, "base64")); }
  catch (e) { return false; }
}
export function verifyEdgeSig(obs, fromPub) {
  if (typeof obs.edge_sig !== "string" || !fromPub) return false;
  try { return nodeVerify(null, Buffer.from(canonical(edgeOf(obs)), "utf8"), fromPub, Buffer.from(obs.edge_sig, "base64")); }
  catch (e) { return false; }
}
// signed verify: witness signature (attribution) + edge signature (party-attested edge). resolve: id -> publicKey.
export function verifySigned(obs, resolve) {
  if (!verifyWitnessSig(obs, resolve(obs.witness_id))) return { ok: false, reason: "witness_sig_invalid" };
  if (!verifyEdgeSig(obs, resolve(obs.hop.from))) return { ok: false, reason: "edge_sig_invalid" };
  return { ok: true };
}
