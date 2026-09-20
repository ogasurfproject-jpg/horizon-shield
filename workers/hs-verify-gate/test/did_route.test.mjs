// did_route: /.well-known/did.json が did:web:gate.horizonshield.dev を配り、card の署名鍵 (kid hs-2026-09) と
// 在れば運営者鍵をドメインに縛るか。card の conduct params が identity {kind:did, ref} でその DID を指すか。
// 測るのは deploy される src/worker.js のバイトそのもの。走らせ方: node test/did_route.test.mjs
import worker from "../src/worker.js";

const O = "https://gate.horizonshield.dev";
const ENV = { OPERATOR_PUBKEY_B64: "fqrEpRuYScHz52eeiuAWAFEeJB3T7VtZJlducNIhzZM=" };
const CTX = { waitUntil() {} };
let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? "ok   " : "NG   ") + name + (ok || detail === undefined ? "" : "  <<< " + detail)); };

const get = async (p, env = ENV) => (await worker.fetch(new Request(O + p), env, CTX)).json();

const did = await get("/.well-known/did.json");
const jwks = await get("/.well-known/jwks.json");
const card = await get("/.well-known/agent-card.json");

t("id is did:web:gate.horizonshield.dev", did.id === "did:web:gate.horizonshield.dev", did.id);
t("@context carries the did v1 context", Array.isArray(did["@context"]) && did["@context"][0] === "https://www.w3.org/ns/did/v1");

const vmCard = (did.verificationMethod || []).find((v) => v.id.endsWith("#hs-2026-09"));
t("verificationMethod carries the card signing key by kid", !!vmCard, JSON.stringify((did.verificationMethod || []).map((v) => v.id)));
t("its publicKeyJwk is exactly the key JWKS serves (same x, y, crv, kid)", !!vmCard &&
  vmCard.publicKeyJwk.x === jwks.keys[0].x && vmCard.publicKeyJwk.y === jwks.keys[0].y &&
  vmCard.publicKeyJwk.crv === jwks.keys[0].crv && vmCard.publicKeyJwk.kid === jwks.keys[0].kid,
  JSON.stringify(vmCard && vmCard.publicKeyJwk));
t("type is JsonWebKey2020 and controller is the did", !!vmCard && vmCard.type === "JsonWebKey2020" && vmCard.controller === did.id);
t("assertionMethod and authentication reference the card key", (did.assertionMethod || []).includes(did.id + "#hs-2026-09") && (did.authentication || []).includes(did.id + "#hs-2026-09"));

const vmOp = (did.verificationMethod || []).find((v) => v.id.endsWith("#operator"));
t("operator key present when configured, as an Ed25519 (OKP) JWK", !!vmOp && vmOp.publicKeyJwk.kty === "OKP" && vmOp.publicKeyJwk.crv === "Ed25519", JSON.stringify(vmOp && vmOp.publicKeyJwk));
t("operator x is base64url (no +, /, or = padding)", !!vmOp && !/[+/=]/.test(vmOp.publicKeyJwk.x), vmOp && vmOp.publicKeyJwk.x);

t("service lists the A2A endpoint at /a2a", (did.service || []).some((x) => x.type === "A2A" && x.serviceEndpoint === O + "/a2a"));

// degrade: no operator key configured -> only the card key, still valid
const did2 = await get("/.well-known/did.json", {});
t("without an operator key it serves the card key alone (no empty operator entry)",
  did2.verificationMethod.length === 1 && did2.verificationMethod[0].id.endsWith("#hs-2026-09"),
  JSON.stringify(did2.verificationMethod.map((v) => v.id)));

// the card points back at the DID (conduct-v1.1 section 11.5 allows identity in params)
const ext = (card.capabilities.extensions || [])[0];
t("the card's conduct extension params carry identity {kind:did, ref}", !!ext && ext.params.identity && ext.params.identity.kind === "did" && ext.params.identity.ref === "did:web:gate.horizonshield.dev", JSON.stringify(ext && ext.params.identity));
t("the DID the card names resolves to this document's id", ext && ext.params.identity.ref === did.id);

console.log("");
console.log("=== " + pass + " / " + (pass + fail) + (fail ? " 不合格あり" : " 合格") + " (did:web の口、扉 0.4.13) ===");
process.exit(fail ? 1 : 0);
