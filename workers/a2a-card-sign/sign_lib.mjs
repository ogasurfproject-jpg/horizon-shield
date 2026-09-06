// 共通部: card を Worker から描き、公式 SDK の generator で署名し、Worker のソースの定数を書き換える。
// 鍵の中身は一切出力せん(標準出力に出るのは kid / jku / 正規形の sha256 / 署名の頭 12 文字だけ)。
import { readFile, writeFile } from "node:fs/promises";
import { createPrivateKey, createPublicKey, createHash, generateKeyPairSync } from "node:crypto";
import { resolve } from "node:path";
import * as jose from "jose";
import { generateAgentCardSignature, verifyAgentCardSignature, canonicalizeAgentCard } from "@a2a-js/sdk";
import { loadWorker, makeEnv, ctx } from "../hs-mcp/test/local_env.mjs";

export const BEGIN = "/* @@CARD_SIGNATURE_BEGIN */";
export const END = "/* @@CARD_SIGNATURE_END */";

export async function renderCard(workerPath, origin) {
  const worker = await loadWorker(workerPath);
  const env = makeEnv();
  const r = await worker.fetch(new Request(origin.replace(/\/+$/, "") + "/.well-known/agent-card.json"), env, ctx);
  if (r.status !== 200) throw new Error("card not served at " + origin + " (http " + r.status + ")");
  return await r.json();
}

export function keyFromPem(pem) {
  const priv = createPrivateKey(pem);
  if (priv.asymmetricKeyType !== "ec" || priv.asymmetricKeyDetails.namedCurve !== "prime256v1") {
    throw new Error("key must be EC P-256 (prime256v1) for ES256; got " + priv.asymmetricKeyType + " " + (priv.asymmetricKeyDetails && priv.asymmetricKeyDetails.namedCurve));
  }
  return { priv, pub: createPublicKey(priv) };
}

export function ephemeralKey() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { priv: privateKey, pub: createPublicKey(privateKey) };
}

export async function publicJwk(pub, kid) {
  const jwk = await jose.exportJWK(pub);
  return Object.assign({}, jwk, { kid, alg: "ES256", use: "sig" });
}

// card(signatures 抜き)に署名し、{ kid, jku, alg, protected, signature, jwk, canonical_sha256 } を返す。
// 正規形は公式 SDK の canonicalizeAgentCard(proto 往復 + RFC 8785)。Worker は自前で正規化せんので、ここが唯一の正規化点。
export async function signCard(card, { priv, pub }, kid, jku) {
  const bare = Object.assign({}, card); delete bare.signatures;
  const canonical = canonicalizeAgentCard(bare);
  const signer = generateAgentCardSignature(priv, { alg: "ES256", typ: "JOSE", kid, jku });
  const signed = await signer(bare);
  const sig = signed.signatures[signed.signatures.length - 1];
  const jwk = await publicJwk(pub, kid);
  // その場で公式 verifier に通す。通らん署名は書かん。
  const verify = verifyAgentCardSignature(async (k, j) => { if (k !== kid) throw new Error("unknown kid " + k); return jwk; });
  await verify(Object.assign({}, bare, { signatures: [sig] }));
  return { kid, jku, alg: "ES256", protected: sig.protected, signature: sig.signature, jwk, canonical_sha256: createHash("sha256").update(canonical, "utf8").digest("hex") };
}

export async function writeSignatureConstant(workerPath, record) {
  const p = resolve(workerPath);
  const src = await readFile(p, "utf8");
  const a = src.indexOf(BEGIN), b = src.indexOf(END);
  if (a < 0 || b < 0 || b < a) throw new Error("markers not found in " + workerPath + " (apply the card-signature worker patch first)");
  const body = record ? "const CARD_SIGNATURE = " + JSON.stringify(record, null, 2) + ";" : "const CARD_SIGNATURE = null;";
  const out = src.slice(0, a + BEGIN.length) + "\n" + body + "\n" + src.slice(b);
  await writeFile(p, out);
  return out;
}

export async function verifyServed(card, fetchJwks) {
  // fetchJwks(jku) -> { keys: [...] }
  const verify = verifyAgentCardSignature(async (kid, jku) => {
    const doc = await fetchJwks(jku);
    const k = (doc.keys || []).find((x) => x.kid === kid);
    if (!k) throw new Error("kid " + kid + " not in " + jku);
    return k;
  });
  await verify(card);
}

export function decodeProtected(sig) {
  return JSON.parse(Buffer.from(sig.protected, "base64url").toString("utf8"));
}
