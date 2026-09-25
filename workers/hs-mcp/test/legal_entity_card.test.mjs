// legal_entity_card (hs-mcp 1.0.10): KIRA の card で、法人身元が仕様準拠の署名の内側に入ったか、配信の並び、root の版。
// 扉 0.4.15 と同じ手。穴: proto に欄の無い provider.legalEntity は §8.4 の正規化で落ちる。legal-entity-v1 の params は生き残る。
// 端から端までは使い捨て鍵で本物の署名パイプライン(sign_lib.signCard)を回す。本物の鍵には触らん。
// 走らせ方: node test/legal_entity_card.test.mjs   (workers/hs-mcp で。公式 SDK と sign_lib は a2a-card-sign から解く)
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createPublicKey, verify as nodeVerify } from "node:crypto";
import worker from "../src/mcp.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD_SIGN = path.resolve(HERE, "..", "..", "a2a-card-sign");
const req = createRequire(path.join(CARD_SIGN, "package.json"));
const sdk = await import(pathToFileURL(req.resolve("@a2a-js/sdk")).href);
const lib = await import(pathToFileURL(path.join(CARD_SIGN, "sign_lib.mjs")).href);

const O = "https://mcp.horizonshield.dev";
const URI = "https://gate.horizonshield.dev/ext/legal-entity/v1";
const CONDUCT = "https://gate.horizonshield.dev/ext/conduct/v1";
const ID = "7021001075279";
const KEYS = ["registry", "scheme", "id", "name"];
const ENV = {}; const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? "  ok   " : "  NG   ") + name + (ok || !detail ? "" : "  <<< " + String(detail).slice(0, 260))); };
const clone = (x) => JSON.parse(JSON.stringify(x));
const bareOf = (c) => { const b = clone(c); delete b.signatures; return b; };
const leOf = (c) => ((c.capabilities && c.capabilities.extensions) || []).find((e) => e && e.uri === URI);
const mirrorEqual = (c) => { const P = (leOf(c) || {}).params || {}; const L = (c.provider && c.provider.legalEntity) || {}; return KEYS.every((k) => typeof P[k] === "string" && P[k] === L[k]); };
async function quiet(fn) { const o = [console.log, console.error, console.warn, console.info, console.debug, process.stdout.write, process.stderr.write]; console.log = console.error = console.warn = console.info = console.debug = () => {}; process.stdout.write = process.stderr.write = () => true; try { return await fn(); } finally { [console.log, console.error, console.warn, console.info, console.debug, process.stdout.write, process.stderr.write] = o; } }
async function sdkVerifies(card, jwk) { try { await quiet(() => sdk.verifyAgentCardSignature(async () => jwk)(card)); return true; } catch { return false; } }
function firstOnlyPlain(card, jwk) {
  const s = (card.signatures || [])[0]; if (!s) return false;
  const payload = Buffer.from(lib.jcsCanonical(bareOf(card)), "utf8").toString("base64url");
  const key = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: "jwk" });
  try { return nodeVerify("sha256", Buffer.from(s.protected + "." + payload), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s.signature, "base64url")); } catch { return false; }
}

const card = await (await worker.fetch(new Request(O + "/.well-known/agent-card.json"), ENV, CTX)).json();
const exts = (card.capabilities && card.capabilities.extensions) || [];
const le = leOf(card);
const P = (le && le.params) || {};

// ---- 1. 宣言と鏡写し ----
t("the card declares legal-entity-v1 under capabilities.extensions", !!le);
t("the conduct extension is still declared first", !!exts[0] && exts[0].uri === CONDUCT, JSON.stringify(exts.map((e) => e && e.uri)));
t("legal-entity-v1 is data-only (required false)", !!le && le.required === false);
t("provider.legalEntity is present", !!(card.provider && card.provider.legalEntity));
t("mirror rule: registry, scheme, id and name equal provider.legalEntity", mirrorEqual(card), JSON.stringify({ params: P, provider: card.provider }));
t("the declared name is the same string as provider.organization", P.name === card.provider.organization);
t("the identifier is the operator's houjin-bango", P.registry === "JP" && P.scheme === "houjin-bango" && P.id === ID);
t("lookup_url points at the National Tax Agency register page for that id", P.lookup_url === "https://www.houjin-bangou.nta.go.jp/henkorireki-johoto.html?selHouzinNo=" + ID, P.lookup_url);

// ---- 2. 署名の内側と root の版 ----
t("the official SDK canonical bytes contain the houjin-bango", sdk.canonicalizeAgentCard(bareOf(card)).includes(ID));
t("without the extension the SDK canonicalizer drops the id", (() => { const c = bareOf(card); c.capabilities.extensions = c.capabilities.extensions.filter((e) => e.uri !== URI); return !sdk.canonicalizeAgentCard(c).includes(ID); })());
t("root protocolVersion is 1.0 and 0.3 stays in supportedInterfaces[1]", card.protocolVersion === "1.0" && card.supportedInterfaces[1] && card.supportedInterfaces[1].protocolVersion === "0.3");

// ---- 3. 焼いた署名の並び(構造だけ) ----
const srcText = readFileSync(path.join(HERE, "..", "src", "mcp.js"), "utf8");
const blk = srcText.slice(srcText.indexOf("/* @@CARD_SIGNATURE_BEGIN */"), srcText.indexOf("/* @@CARD_SIGNATURE_END */"));
const CS = JSON.parse(blk.slice(blk.indexOf("{"), blk.lastIndexOf("}") + 1));
t("served order: signatures[0] is the plain flavor", !!card.signatures && card.signatures[0].signature === CS.plain.signature);
t("served order: signatures[1] is the official SDK flavor", !!card.signatures && card.signatures[1].signature === CS.signature);

// ---- 4. 端から端まで(使い捨て鍵) ----
const bare = bareOf(card);
const rec = await lib.signCard(bare, lib.ephemeralKey(), "kira-le-test", O + "/.well-known/jwks.json");
const sdkEntry = { protected: rec.protected, signature: rec.signature };
const newOrder = Object.assign(clone(bare), { signatures: [rec.plain, sdkEntry] });
const oldOrder = Object.assign(clone(bare), { signatures: [sdkEntry, rec.plain] });
t("e2e: the official SDK verifier passes the new order", await sdkVerifies(newOrder, rec.jwk));
t("e2e: a first-signature-only plain RFC 8785 verifier passes the new order", firstOnlyPlain(newOrder, rec.jwk));
t("e2e: the same verifier fails the old order (the failure mode, reproduced)", !firstOnlyPlain(oldOrder, rec.jwk));
const tp = clone(newOrder); leOf(tp).params.id = "0000000000000";
t("e2e: editing the id inside the extension breaks the SDK signature", !(await sdkVerifies(tp, rec.jwk)));
const tq = clone(newOrder); tq.provider.legalEntity.id = "0000000000000";
t("e2e: editing provider.legalEntity alone is caught by the mirror rule", !mirrorEqual(tq));

console.log("\nlegal_entity_card  " + pass + " ok, " + fail + " NG");
process.exit(fail ? 1 : 0);
