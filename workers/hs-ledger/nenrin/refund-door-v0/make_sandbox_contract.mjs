#!/usr/bin/env node
// make_sandbox_contract.mjs: writes sandbox_contract.mjs, the a2a-contract-v0 contract the refund sandbox door admits
// under (hs-refund-admission-profile/0.1, step 9). Its two parties are test parties whose keys are derived in memory
// from the public labels below, so anyone can rebuild the same bytes; they stand for no merchant and no worker. The grant
// authorizes "refund" up to grant.limits.refund.max_amount minor units of EUR, and requirements.admission is
// "required_before_execution". The contract door (contract_door_v0.mjs) must accept the result, or nothing is written.
//
//   node make_sandbox_contract.mjs            prints the module text
//   node make_sandbox_contract.mjs --check    exits 1 unless sandbox_contract.mjs is byte for byte what this prints
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical } from "../musubi-v0/canonical_v0.mjs";
import { contractSigningBytes, verifyContract } from "../musubi-v0/contract_door_v0.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const seed = (label) => createHash("sha256").update("hs-refund-door-sandbox/" + label, "utf8").digest();
const der = (s) => createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), s]), format: "der", type: "pkcs8" });
const pub = (s) => createPublicKey(der(s)).export({ format: "der", type: "spki" }).subarray(12).toString("base64");

const P = { domain: "merchant.sandbox.example", key_url: "https://merchant.sandbox.example/keys/contract.json", role: "principal", public_key_ed25519_b64: pub(seed("principal")) };
const C = { domain: "refund-worker.sandbox.example", key_url: "https://refund-worker.sandbox.example/keys/contract.json", role: "contractor", public_key_ed25519_b64: pub(seed("contractor")) };
const contract = {
  schema: "a2a-contract-v0",
  contract_id: createHash("sha256").update("hs-refund-door-sandbox/contract/review-2026-10-23", "utf8").digest("hex").slice(0, 32),
  agreed_at: "2026-11-07T00:00:00Z",
  parties: [P, C],
  task: { a2a_task_id: "refund-sandbox-review-2026-10-23", payload_digest: createHash("sha256").update("aeoess/agent-governance-vocabulary#193", "utf8").digest("hex"), purpose: "bounded_refund_sandbox" },
  grant: {
    authorized_actions: ["refund"],
    prohibited_actions: [],
    conditional: [],
    delegation: { allowed: [] },
    limits: { refund: { max_amount: 5000, unit: "EUR" } },
    finality: { depth: 3, max_target_bits: "1d00ffff" },
    revocation: { effective_at: "anchor" },
    witnesses: [],
  },
  requirements: { admission: "required_before_execution", evidence: "nenrin_required", recovery: "tsugi_required" },
  bond: null,
  expiry: null,
  lower_bound: null,
  parent_contract: null,
  nonce: createHash("sha256").update("hs-refund-door-sandbox/nonce", "utf8").digest("hex").slice(0, 32),
  liability_boundary: [],
  selection_provenance: null,
  establishes: ["that both parties signed these grant bytes"],
  does_not_establish: ["that HS enforced any of this at runtime", "that the contractor obeyed the grant, only that its recorded acts match or deviate from it",
    "that HS judges liability or fault; the verdict is a function anyone recomputes", "that a prohibited action was impossible, only that performing one is a provable deviation",
    "that this is a legal contract or determines legal responsibility"],
};
const msg = contractSigningBytes(contract);
contract.signatures = [
  { alg: "ed25519", domain: P.domain, signature: sign(null, msg, der(seed("principal"))).toString("base64") },
  { alg: "ed25519", domain: C.domain, signature: sign(null, msg, der(seed("contractor"))).toString("base64") },
];
const v = verifyContract(contract);
if (v.verdict !== "accepted") { console.error("the contract door refuses the sandbox contract: " + JSON.stringify(v)); process.exit(1); }
const text = canonical(contract);
const out = "// sandbox_contract.mjs: written by make_sandbox_contract.mjs; do not edit by hand.\n"
  + "// The a2a-contract-v0 contract of the refund sandbox door, as its canonical (musubi-canonical-v0) text. Test parties only.\n"
  + "export const CONTRACT_TEXT = " + JSON.stringify(text) + ";\n"
  + "export const CONTRACT_SHA256 = " + JSON.stringify(createHash("sha256").update(msg).digest("hex")) + ";\n";
if (process.argv.includes("--check")) {
  const now = readFileSync(join(HERE, "sandbox_contract.mjs"), "utf8");
  if (now !== out) { console.error("sandbox_contract.mjs differs from what make_sandbox_contract.mjs writes"); process.exit(1); }
  console.log("sandbox_contract.mjs is what make_sandbox_contract.mjs writes; the contract door accepts it");
} else process.stdout.write(out);
