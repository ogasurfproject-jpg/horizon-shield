// verify_fixture.mjs : offline verifier for t4_fixture.json.
//
// A frozen, did:key-verifiable signed WitnessObservation, tracked (not gitignored) as an immutable T-4 input
// for a2aproject/A2A#1769. The WitnessObservation implementation pin stays 4d7c9c270c2846465fafdea9833869c5660c4ae2;
// this is a concrete example vector at its own commit, not a change to the impl.
//
// It resolves the did:key witness_id and hop.from to Ed25519 public keys from the identifiers themselves (did:key
// is self-encoding, so there is no network and no key server), recomputes evidence_id (R2), checks witness
// independence (R1), and verifies witness_sig and edge_sig. Run: node verify_fixture.mjs
import { readFileSync } from "node:fs";
import { createPublicKey } from "node:crypto";
import { verifyObservation, evidenceId } from "./bind.mjs";
import { verifySigned } from "./sign.mjs";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58encode(bytes) {
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let str = "";
  for (let k = 0; k < bytes.length && bytes[k] === 0; k++) str += "1";
  for (let q = digits.length - 1; q >= 0; q--) str += B58[digits[q]];
  return str;
}
export function b58decode(str) {
  const bytes = [0];
  for (let i = 0; i < str.length; i++) {
    let carry = B58.indexOf(str[i]);
    if (carry < 0) throw new Error("bad base58 char");
    for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  let zeros = 0; while (zeros < str.length && str[zeros] === "1") zeros++;
  const res = [];
  for (let z = 0; z < zeros; z++) res.push(0);
  for (let k = bytes.length - 1; k >= 0; k--) res.push(bytes[k]);
  return Uint8Array.from(res);
}
export function rawFromKeyObject(keyObject) { return Buffer.from(keyObject.export({ format: "jwk" }).x, "base64url"); }
export function didKeyEncode(raw) { const p = new Uint8Array(2 + raw.length); p[0] = 0xed; p[1] = 0x01; p.set(raw, 2); return "did:key:z" + b58encode(p); }
export function publicKeyFromDidKey(did) {
  if (typeof did !== "string" || !did.startsWith("did:key:z")) throw new Error("not a did:key");
  const payload = b58decode(did.slice("did:key:z".length));
  if (payload[0] !== 0xed || payload[1] !== 0x01) throw new Error("not an ed25519-pub did:key");
  const raw = Buffer.from(payload.slice(2));
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" });
}

export function verifyFixture(fixture) {
  const obs = fixture.observation;
  const resolve = (id) => publicKeyFromDidKey(id);
  const r2 = verifyObservation(obs);                 // R1 independence + R2 recompute
  const sigs = verifySigned(obs, resolve);           // witness_sig (attribution) + edge_sig (party-attested edge)
  return { r1r2: r2, signatures: sigs, evidence_id: evidenceId(obs), witness_id: obs.witness_id, from: obs.hop.from };
}

function main() {
  const path = new URL("./t4_fixture.json", import.meta.url);
  const fixture = JSON.parse(readFileSync(path, "utf8"));
  const v = verifyFixture(fixture);
  const ok = v.r1r2.ok && v.signatures.ok && v.evidence_id === fixture.observation.evidence_id;
  console.log("did:key witness_id :", v.witness_id);
  console.log("did:key hop.from   :", v.from);
  console.log("evidence_id        :", v.evidence_id, v.evidence_id === fixture.observation.evidence_id ? "(recomputes, R2 ok)" : "(MISMATCH)");
  console.log("R1 independence + R2:", v.r1r2.ok ? "ok" : "FAIL " + v.r1r2.reason);
  console.log("witness_sig + edge_sig:", v.signatures.ok ? "ok" : "FAIL " + v.signatures.reason);
  console.log(ok ? "\nPASS: fixture verifies offline against its own did:key identifiers" : "\nFAIL");
  process.exit(ok ? 0 : 1);
}
if (process.argv[1] && process.argv[1].endsWith("verify_fixture.mjs")) main();
