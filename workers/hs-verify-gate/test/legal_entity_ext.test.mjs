// legal_entity_ext (0.4.15): 法人身元が仕様準拠の署名の内側に入ったか、配信の並び、扉の検証器の 2 流儀。
// 穴 1: A2A 1.0 §8.4 の正規化は card を proto に写すので、proto に欄の無い provider.legalEntity は署名の前に落ちとった。
//        公式 SDK 流の署名は法人番号を覆っとらんかった。legal-entity-v1 の params は正規化を生き残る。
// 穴 2: 先頭の署名しか見ん素朴な検証器(素の RFC 8785)は、先頭が SDK 流やと落ちる。並びを plain 先頭にした。
// 穴 3: 扉の検証器は SDK 流しか試さず、2 本署名の card の plain 側を「署名後に書き換えられた」と記録しとった。
// 端から端までは使い捨て鍵で本物の署名パイプライン(sign_lib.signCard)を回して確かめる。本物の鍵には触らん。
// 走らせ方: node test/legal_entity_ext.test.mjs   (公式 SDK と sign_lib は a2a-card-sign から解く)
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash, createPublicKey, verify as nodeVerify } from "node:crypto";
import worker, { cardSignatureCanonical } from "../src/worker.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD_SIGN = path.resolve(HERE, "..", "..", "a2a-card-sign");
const req = createRequire(path.join(CARD_SIGN, "package.json"));
const sdk = await import(pathToFileURL(req.resolve("@a2a-js/sdk")).href);
const lib = await import(pathToFileURL(path.join(CARD_SIGN, "sign_lib.mjs")).href);

const ORIGIN = "https://gate.horizonshield.dev";
const URI = "https://gate.horizonshield.dev/ext/legal-entity/v1";
const CONDUCT = "https://gate.horizonshield.dev/ext/conduct/v1";
const ID = "7021001075279";
const KEYS = ["registry", "scheme", "id", "name"];
const ENV = {}; const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? "  ok   " : "  NG   ") + name + (ok || !detail ? "" : "  <<< " + String(detail).slice(0, 260))); };
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const clone = (x) => JSON.parse(JSON.stringify(x));
const bareOf = (c) => { const b = clone(c); delete b.signatures; return b; };
const leOf = (c) => ((c.capabilities && c.capabilities.extensions) || []).find((e) => e && e.uri === URI);
const mirrorEqual = (c) => { const P = (leOf(c) || {}).params || {}; const L = (c.provider && c.provider.legalEntity) || {}; return KEYS.every((k) => typeof P[k] === "string" && P[k] === L[k]); };
async function quiet(fn) { const o = [console.log, console.error, console.warn, console.info, console.debug, process.stdout.write, process.stderr.write]; console.log = console.error = console.warn = console.info = console.debug = () => {}; process.stdout.write = process.stderr.write = () => true; try { return await fn(); } finally { [console.log, console.error, console.warn, console.info, console.debug, process.stdout.write, process.stderr.write] = o; } }
async function sdkVerifies(card, jwk) { try { await quiet(() => sdk.verifyAgentCardSignature(async () => jwk)(card)); return true; } catch { return false; } }
async function plainAnyVerifies(card, jwk) { try { await lib.verifyPlain(card, async () => ({ keys: [jwk] })); return true; } catch { return false; } }
// 先頭の 1 本だけを素の RFC 8785 で見る検証器(Agenstry の振る舞いの推定模型)
function firstOnlyPlain(card, jwk) {
  const s = (card.signatures || [])[0]; if (!s) return false;
  const payload = Buffer.from(lib.jcsCanonical(bareOf(card)), "utf8").toString("base64url");
  const key = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: "jwk" });
  try { return nodeVerify("sha256", Buffer.from(s.protected + "." + payload), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s.signature, "base64url")); } catch { return false; }
}

// ---- 1. 宣言と鏡写し ----
const card = await (await worker.fetch(new Request(ORIGIN + "/.well-known/agent-card.json"), ENV, CTX)).json();
const exts = (card.capabilities && card.capabilities.extensions) || [];
const le = leOf(card);
t("the card declares legal-entity-v1 under capabilities.extensions", !!le);
t("the conduct extension is still declared first", !!exts[0] && exts[0].uri === CONDUCT, JSON.stringify(exts.map((e) => e && e.uri)));
t("legal-entity-v1 is data-only (required false)", !!le && le.required === false);
const P = (le && le.params) || {};
t("mirror rule: registry, scheme, id and name equal provider.legalEntity", mirrorEqual(card), JSON.stringify({ params: P, provider: card.provider && card.provider.legalEntity }));
t("the identifier is the operator's houjin-bango", P.registry === "JP" && P.scheme === "houjin-bango" && P.id === ID);
t("lookup_url points at the National Tax Agency register page for that id", P.lookup_url === "https://www.houjin-bangou.nta.go.jp/henkorireki-johoto.html?selHouzinNo=" + ID, P.lookup_url);

// ---- 2. 署名の内側 ----
const sdkCanon = sdk.canonicalizeAgentCard(bareOf(card));
t("the official SDK canonical bytes now contain the houjin-bango (the spec-conformant signature covers it)", sdkCanon.includes(ID));
t("without the extension the SDK canonicalizer drops the id (provider.legalEntity alone was outside the signature)", (() => { const c = bareOf(card); c.capabilities.extensions = c.capabilities.extensions.filter((e) => e.uri !== URI); return !sdk.canonicalizeAgentCard(c).includes(ID); })());
const gc = cardSignatureCanonical(card);
t("the gate's own projection agrees with the SDK byte for byte", !gc.unsupported && gc.canonical === sdkCanon, gc.unsupported ? JSON.stringify(gc.unsupported) : sha(gc.canonical).slice(0, 16) + " vs " + sha(sdkCanon).slice(0, 16));

// ---- 3. URI で仕様を配る ----
const md = readFileSync(path.join(HERE, "..", "ext", "LEGAL_ENTITY_EXT_v1.md"), "utf8");
const j = await (await worker.fetch(new Request(ORIGIN + "/ext/legal-entity/v1"), ENV, CTX)).json();
t("GET the URI returns the JSON declaration spec", j.uri === URI && j.version === "v1" && j.required === false, JSON.stringify(j).slice(0, 200));
t("the JSON names the sha256 of the markdown it serves", j.spec_markdown_sha256 === sha(md), j.spec_markdown_sha256);
const mr = await worker.fetch(new Request(ORIGIN + "/ext/legal-entity/v1", { headers: { Accept: "text/markdown" } }), ENV, CTX);
t("Accept: text/markdown returns the specification text exactly", /text\/markdown/.test(mr.headers.get("content-type") || "") && (await mr.text()) === md);
t("the example in the JSON is the gate's own declaration", JSON.stringify(j.example) === JSON.stringify(le));

// ---- 4. 焼いた署名の並び(構造だけ。検証は card_signature.test が見る) ----
const srcText = readFileSync(path.join(HERE, "..", "src", "worker.js"), "utf8");
const blk = srcText.slice(srcText.indexOf("/* @@CARD_SIGNATURE_BEGIN */"), srcText.indexOf("/* @@CARD_SIGNATURE_END */"));
const CS = JSON.parse(blk.slice(blk.indexOf("{"), blk.lastIndexOf("}") + 1));
t("served order: signatures[0] is the plain flavor (RFC 8785 of the served bytes)", !!card.signatures && card.signatures[0].signature === CS.plain.signature);
t("served order: signatures[1] is the official SDK flavor", !!card.signatures && card.signatures[1].signature === CS.signature);

// ---- 5. 端から端まで(使い捨て鍵、本物の署名パイプライン) ----
const JKU = "https://srv.le.invalid/.well-known/jwks.json";
const bare = bareOf(card);
const rec = await lib.signCard(bare, lib.ephemeralKey(), "le-test-kid", JKU);
const sdkEntry = { protected: rec.protected, signature: rec.signature };
const newOrder = Object.assign(clone(bare), { signatures: [rec.plain, sdkEntry] });
const oldOrder = Object.assign(clone(bare), { signatures: [sdkEntry, rec.plain] });
t("e2e: the official SDK verifier passes the new order (it accepts any one signature)", await sdkVerifies(newOrder, rec.jwk));
t("e2e: the official SDK verifier passes the old order too (order is irrelevant to it)", await sdkVerifies(oldOrder, rec.jwk));
t("e2e: a first-signature-only plain RFC 8785 verifier passes the new order", firstOnlyPlain(newOrder, rec.jwk));
t("e2e: the same verifier fails the old order (the Agenstry failure mode, reproduced)", !firstOnlyPlain(oldOrder, rec.jwk));
t("e2e: an any-signature plain verifier passes the new order", await plainAnyVerifies(newOrder, rec.jwk));

const tamperedParams = clone(newOrder); leOf(tamperedParams).params.id = "0000000000000";
t("e2e: editing the id inside the extension breaks the SDK signature (it is inside the signed bytes)", !(await sdkVerifies(tamperedParams, rec.jwk)));
t("e2e: and breaks the plain signature", !(await plainAnyVerifies(tamperedParams, rec.jwk)));

const tamperedProvider = clone(newOrder); tamperedProvider.provider.legalEntity.id = "0000000000000";
t("e2e: editing provider.legalEntity alone leaves the SDK signature intact (proto drops it; this is the old gap)", await sdkVerifies(tamperedProvider, rec.jwk));
t("e2e: but the mirror rule catches it", !mirrorEqual(tamperedProvider));
t("e2e: and the plain signature catches it", !(await plainAnyVerifies(tamperedProvider, rec.jwk)));

// ---- 6. 扉の検証器は 2 流儀とも正しく読む ----
const EP = "https://srv.le.invalid/mcp";
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url));
  const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json" } });
  if (u.pathname === "/.well-known/agent-card.json") return J(newOrder);
  if (u.pathname === "/.well-known/mcp-conduct.json") return J({ allow_tool_call: true });
  if (u.href === JKU) return J({ keys: [rec.jwk] });
  if (u.pathname === "/mcp") {
    const b = JSON.parse(init.body);
    if (b.method === "initialize") return J({ jsonrpc: "2.0", id: b.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "s", version: "1" }, capabilities: {} } });
    return J({ jsonrpc: "2.0", id: b.id, result: { tools: [{ name: "t1", description: "d", inputSchema: { type: "object", properties: {} } }] } });
  }
  return new Response("not found", { status: 404 });
};
const v = await (await worker.fetch(new Request("https://gate.le.invalid/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: EP }) }), { GATE_COMMIT: "legal-entity-local" }, CTX)).json();
const sd = v && v.checks && v.checks.agent_card && v.checks.agent_card.detail && v.checks.agent_card.detail.signature;
const rows = (sd && sd.signatures) || [];
t("gate: both signatures of a dual-signed card read verified", rows.length === 2 && rows.every((r) => r.verified === true), JSON.stringify(rows.map((r) => [r.verified, r.canonical, r.reason && r.reason.slice(0, 60)])));
t("gate: each row names the canonical form it verified under", rows.length === 2 && rows[0].canonical === "rfc8785-served" && rows[1].canonical === "a2a-1.0-proto", JSON.stringify(rows.map((r) => r.canonical)));
t("gate: no row claims the card was changed after signing", !rows.some((r) => /changed after signing/.test(r.reason || "")));
t("gate: the detail carries the sha256 of the plain canonical bytes", !!sd && sd.plain_canonical_sha256 === sha(lib.jcsCanonical(bare)), sd && sd.plain_canonical_sha256);
const broken = clone(newOrder); broken.description += " (edited after signing)";
globalThis.fetch = ((f) => async (url, init) => (new URL(String(url)).pathname === "/.well-known/agent-card.json" ? new Response(JSON.stringify(broken), { headers: { "content-type": "application/json" } }) : f(url, init)))(globalThis.fetch);
const vb = await (await worker.fetch(new Request("https://gate.le.invalid/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: EP }) }), { GATE_COMMIT: "legal-entity-local" }, CTX)).json();
const rb = (vb.checks.agent_card.detail.signature || {}).signatures || [];
t("gate: a card edited after signing still fails under both forms", rb.length === 2 && rb.every((r) => r.verified === false && r.canonical === null), JSON.stringify(rb.map((r) => [r.verified, r.canonical])));

console.log("\nlegal_entity_ext  " + pass + " ok, " + fail + " NG");
process.exit(fail ? 1 : 0);
