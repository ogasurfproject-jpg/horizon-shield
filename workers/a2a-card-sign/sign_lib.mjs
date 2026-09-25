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

// 素の RFC 8785(JCS): 配られる card そのもの(signatures 抜き)を、UTF-16 code unit 順の再帰 key sort +
// JSON.stringify 直列化で正規化する。公式 SDK は先に proto 往復をやるので、proto が知らん field
// (url / protocolVersion / preferredTransport / compensation / dataset / ledger ...)を落とし、既定値も省く。
// 「JWS は signatures を除いた card に対して」と仕様を素直に読む検証器はこの JCS 流で検証するので、
// 2026-09-25 からその流儀にも同じ鍵で 2 本目を署名する。2 本目は url を含む配信バイト全部を覆う。
export function jcsCanonical(v) {
  if (Array.isArray(v)) return "[" + v.map(jcsCanonical).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcsCanonical(v[k])).join(",") + "}";
  return JSON.stringify(v);
}

// card(signatures 抜き)に署名し、{ kid, jku, alg, protected, signature, plain, jwk, canonical_sha256, jcs_sha256 } を返す。
// 1 本目 = 公式 SDK の canonicalizeAgentCard(proto 往復 + RFC 8785)。2 本目(plain) = 素の RFC 8785。
// どちらも書く前にその場で検証する。公式 verifier は「1 本でも検証できれば通す」ので 2 本は両立する(実測 2026-09-25)。
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
  const jcsText = jcsCanonical(bare);
  const flat = await new jose.FlattenedSign(new TextEncoder().encode(jcsText)).setProtectedHeader({ alg: "ES256", typ: "JOSE", kid, jku }).sign(priv);
  const plain = { protected: flat.protected, signature: flat.signature };
  await jose.flattenedVerify({ protected: plain.protected, payload: flat.payload, signature: plain.signature }, pub);
  await verify(Object.assign({}, bare, { signatures: [sig, plain] }));
  return { kid, jku, alg: "ES256", protected: sig.protected, signature: sig.signature, plain, jwk,
           canonical_sha256: createHash("sha256").update(canonical, "utf8").digest("hex"),
           jcs_sha256: createHash("sha256").update(jcsText, "utf8").digest("hex") };
}

// 素の RFC 8785 流の検証: 配られた card から payload を再構成し、signatures のどれか 1 本が検証できれば良い。
export async function verifyPlain(card, fetchJwks) {
  const bare = Object.assign({}, card); delete bare.signatures;
  const payload = Buffer.from(jcsCanonical(bare), "utf8").toString("base64url");
  const sigs = Array.isArray(card.signatures) ? card.signatures : [];
  const errs = [];
  for (const s of sigs) {
    try {
      const h = decodeProtected(s);
      const doc = await fetchJwks(h.jku);
      const k = (doc.keys || []).find((x) => x.kid === h.kid);
      if (!k) throw new Error("kid " + h.kid + " not in " + h.jku);
      await jose.flattenedVerify({ protected: s.protected, payload, signature: s.signature }, await jose.importJWK(k, h.alg || "ES256"));
      return true;
    } catch (e) { errs.push(String(e && e.message || e)); }
  }
  throw new Error("no signature verifies over plain RFC 8785 of the served card: " + errs.join(" | "));
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
