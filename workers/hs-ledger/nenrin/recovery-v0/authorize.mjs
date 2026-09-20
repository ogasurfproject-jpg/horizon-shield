// RUN_ALL: library  Policy Gate (v1)。人間が提案に Ed25519 で署名して authorization-v1 を作る。手で回す。鍵は file、中身は出さん。
//
//   鍵を作る (一度だけ、repo の外に):
//     openssl genpkey -algorithm ed25519 -out ~/.hs_operator_key.pem && chmod 600 ~/.hs_operator_key.pem
//   信用アンカー (検証器に渡す公開鍵、公開してよい) を出す:
//     node authorize.mjs --pub ~/.hs_operator_key.pem
//   提案を承認して署名する:
//     node authorize.mjs proposal.json --key ~/.hs_operator_key.pem --by "TOshi" --expires-in 4h --out authorization.json
//   却下する:
//     node authorize.mjs proposal.json --key ~/.hs_operator_key.pem --by "TOshi" --decision refused --out authorization.json
//
// 署名は提案の record_sha256 を含む authorization の中身に対して掛かる。運営者の秘密鍵でしか作れん。
// 検証器 (recovery_verify.verifyChain の operatorKeys) が、この署名と鍵の信用を強制する。
// これは判断 (Shield エージェント) でも実行 (Executor) でもない。権限や。設計書 4.3。
import { readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { sign as signRecord, verifyRecord } from "./recovery_verify.mjs";
import { SCHEMAS, PRIMITIVES } from "./recovery_schema.mjs";

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const home = (p) => p.replace(/^~/, process.env.HOME);

function derFromPem(pem, label) {
  const m = pem.match(new RegExp("-----BEGIN " + label + "-----([\\s\\S]*?)-----END " + label + "-----"));
  if (!m) throw new Error("no " + label + " block in the key file");
  return Buffer.from(m[1].replace(/\s+/g, ""), "base64");
}
async function loadOperatorKey(pemPath) {
  const pem = readFileSync(home(pemPath), "utf8");
  const ko = createPrivateKey(pem);
  if (ko.asymmetricKeyType !== "ed25519") throw new Error("operator key must be Ed25519; got " + ko.asymmetricKeyType);
  const priv = await crypto.subtle.importKey("pkcs8", derFromPem(pem, "PRIVATE KEY"), { name: "Ed25519" }, false, ["sign"]);
  const jwk = createPublicKey(ko).export({ format: "jwk" });
  const pubRaw = Buffer.from(jwk.x, "base64url");
  return { priv, pubRaw, pubB64: pubRaw.toString("base64") };
}
function parseDuration(s) {
  const m = String(s || "4h").match(/^(\d+)([mhd])$/);
  if (!m) throw new Error("bad --expires-in (use like 30m, 4h, 1d)");
  return (+m[1]) * (m[2] === "m" ? 60000 : m[2] === "h" ? 3600000 : 86400000);
}

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.map((a, i, arr) => a.startsWith("--") ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith("--")) ? arr[i + 1] : true] : null).filter(Boolean));

if (args.pub) { console.log((await loadOperatorKey(args.pub)).pubB64); process.exit(0); }

const proposalPath = argv[0] && !argv[0].startsWith("--") ? argv[0] : null;
if (!proposalPath || !args.key) { console.error("usage: node authorize.mjs proposal.json --key ~/.hs_operator_key.pem --by NAME [--expires-in 4h] [--decision approved|refused] [--out authorization.json]\n       node authorize.mjs --pub ~/.hs_operator_key.pem"); process.exit(2); }

const loaded = JSON.parse(readFileSync(proposalPath, "utf8"));
const rec = loaded && loaded.record_sha256 ? loaded : (loaded && loaded.proposal ? loaded.proposal : null);
if (!rec || !rec.record_sha256 || rec.schema !== SCHEMAS.proposal) throw new Error("no proposal record (with record_sha256) in " + proposalPath);
const decision = args.decision === "refused" ? "refused" : "approved";

// 何に署名するかを、署名する前に人へ見せる。
console.error("=== Policy Gate: about to " + decision.toUpperCase() + " ===");
console.error("proposal   " + rec.record_sha256.slice(0, 16) + "  primitive: " + rec.primitive + (PRIMITIVES[rec.primitive] ? " (approval: " + PRIMITIVES[rec.primitive].approval + ")" : ""));
console.error("diagnosis  " + String(rec.diagnosis || "").slice(0, 300));
console.error("rollback   " + String(rec.rollback || ""));

const auth = {
  schema: SCHEMAS.authorization, recorded_at: now(),
  witness: { name: "policy-gate", vantage: "operator Ed25519 key at " + args.key },
  prev: rec.record_sha256, proposal_sha256: rec.record_sha256,
  decision, by: String(args.by || "operator"),
  expires_at: new Date(Date.now() + parseDuration(args["expires-in"])).toISOString().replace(/\.\d{3}Z$/, "Z"),
  establishes: ["the operator " + String(args.by || "operator") + " " + decision + " proposal " + rec.record_sha256.slice(0, 12) + " (" + rec.primitive + ") before expires_at, signed with the operator Ed25519 key that only the operator holds"],
  does_not_establish: ["that the repair was executed", "that it succeeded", "that the diagnosis is correct (this authorizes the action, it does not endorse the reasoning)"],
};
const key = await loadOperatorKey(args.key);
const signed = await signRecord(auth, key.priv, key.pubRaw);
const v = await verifyRecord(signed);
if (!v.ok) throw new Error("the signed authorization does not verify: " + JSON.stringify(v.refusals));

const text = JSON.stringify(signed, null, 2) + "\n";
if (args.out) writeFileSync(args.out, text); else process.stdout.write(text);
console.error("authorization " + decision + ", signed by operator key " + key.pubB64.slice(0, 16) + "...  record " + signed.record_sha256.slice(0, 12) + (args.out ? "  wrote " + args.out : ""));
console.error("give the verifier this operator public key (trust anchor): " + key.pubB64);
