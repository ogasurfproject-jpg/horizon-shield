// card_signature (hs-mcp): 焼いてある CARD_SIGNATURE が、いま src/mcp.js が描く card の本体に対して verify するか。
// 扉の同名 suite(workers/hs-verify-gate/test/card_signature.test.mjs)を KIRA に写した物。2026-09-25 に足した。
// 穴: KIRA にはこの門が無かったので、card の中身を変えて署名し直し忘れても、誰も気付かんまま本番に出せた。
// 扉は 0.4.8 と 0.4.9 でそれを 2 回踏んどる。card を変えたら必ず署名し直す。し直さんかったらここで赤になる。
// 併せて: 2 流儀とも通ること(公式 SDK / 素の RFC 8785)、先頭の 1 本が素の RFC 8785 で通ること(先頭しか見ん検証器向け)。
// 走らせ方: node test/card_signature.test.mjs   (workers/hs-mcp で。公式 SDK と sign_lib は a2a-card-sign から解く)
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { createHash, createPublicKey, verify as nodeVerify } from "node:crypto";
import worker from "../src/mcp.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD_SIGN = path.resolve(HERE, "..", "..", "a2a-card-sign");
const req = createRequire(path.join(CARD_SIGN, "package.json"));
const sdk = await import(pathToFileURL(req.resolve("@a2a-js/sdk")).href);
const lib = await import(pathToFileURL(path.join(CARD_SIGN, "sign_lib.mjs")).href);

const ORIGIN = "https://mcp.horizonshield.dev";
const ENV = {}; const CTX = { waitUntil() {} };
let pass = 0, fail = 0; const out = [];
const t = (name, ok, detail) => { ok ? pass++ : fail++; out.push((ok ? "  ok   " : "  NG   ") + name + (ok || !detail ? "" : "  <<< " + detail)); };
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
async function quiet(fn) { const o = [console.log, console.error, console.warn, console.info, console.debug, process.stdout.write, process.stderr.write]; console.log = console.error = console.warn = console.info = console.debug = () => {}; process.stdout.write = process.stderr.write = () => true; try { return await fn(); } finally { [console.log, console.error, console.warn, console.info, console.debug, process.stdout.write, process.stderr.write] = o; } }

const card = await (await worker.fetch(new Request(ORIGIN + "/.well-known/agent-card.json"), ENV, CTX)).json();
const jwks = await (await worker.fetch(new Request(ORIGIN + "/.well-known/jwks.json"), ENV, CTX)).json();
const sigs = Array.isArray(card.signatures) ? card.signatures : [];
t("the card served for the canonical origin carries a signature", sigs.length >= 1);
t("the JWKS served by the same source carries the signing kid", (() => { try { const p = JSON.parse(Buffer.from(sigs[0].protected, "base64url").toString("utf8")); return (jwks.keys || []).some((k) => k.kid === p.kid); } catch { return false; } })());
const bare = { ...card }; delete bare.signatures;
const canonical = sha(sdk.canonicalizeAgentCard(bare));
let verified = false, why = "";
try {
  await quiet(() => sdk.verifyAgentCardSignature(async (kid) => { const k = (jwks.keys || []).find((x) => x.kid === kid); if (!k) throw new Error("kid " + kid + " not in the served JWKS"); return k; })(card));
  verified = true;
} catch (e) { why = String(e && e.message || e); }
const RESIGN = "Re-sign before deploying: cd workers/a2a-card-sign && node sign.mjs --worker ../hs-mcp/src/mcp.js --origin " + ORIGIN + " --key ~/.hs_card_key.pem --kid hs-2026-09, then copy src/mcp.js to hs-mcp-private/mcp.js";
t("the baked CARD_SIGNATURE verifies under the official SDK over the body this source renders (canonical " + canonical.slice(0, 12) + ")", verified, why + ". The body changed after it was signed. " + RESIGN);
let plainOk = false;
try { await lib.verifyPlain(card, async () => jwks); plainOk = true; } catch (e) { why = String(e && e.message || e); }
t("a signature verifies over plain RFC 8785 of the card as served", plainOk, why + ". " + RESIGN);
const first = (() => {
  const s = sigs[0]; if (!s) return false;
  const h = JSON.parse(Buffer.from(s.protected, "base64url").toString("utf8"));
  const k = (jwks.keys || []).find((x) => x.kid === h.kid); if (!k) return false;
  const payload = Buffer.from(lib.jcsCanonical(bare), "utf8").toString("base64url");
  try { return nodeVerify("sha256", Buffer.from(s.protected + "." + payload), { key: createPublicKey({ key: { kty: k.kty, crv: k.crv, x: k.x, y: k.y }, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(s.signature, "base64url")); } catch { return false; }
})();
t("signatures[0] alone verifies over plain RFC 8785 (verifiers that read only the first signature pass)", first);

console.log(out.join("\n"));
console.log("=== " + pass + " / " + (pass + fail) + " 合格 (card signature over the rendered body、KIRA " + (card.version || "") + ") ===");
if (fail) { console.log("card を変えて署名し直さんと、本番の card は verify せん。deploy の前にここで止まる。それが正しい。"); process.exit(1); }
