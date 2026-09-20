// card_signature: 焼いてある CARD_SIGNATURE が、いま src/worker.js が描く card の本体に対して verify するか。
// 2026-09-20 に日次証人 (TSUGI drift witness) が見つけた穴: card は version を持つので、version を上げるたびに本体が変わり、
// 署名し直さんと本番の card は verify せんようになる。0.4.8 と 0.4.9 で 2 回、誰も気付かんまま撒いた。
// この suite は deploy_gate.sh の門に立つ。署名し直さずに version を上げたら、ここで止まる。
// 走らせ方: node test/card_signature.test.mjs   (公式 SDK は a2a-card-sign の node_modules から解く)
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import worker from "../src/worker.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD_SIGN = path.resolve(HERE, "..", "..", "a2a-card-sign");
const req = createRequire(path.join(CARD_SIGN, "package.json"));
const sdk = await import(pathToFileURL(req.resolve("@a2a-js/sdk")).href);

const ORIGIN = "https://gate.horizonshield.dev";
const ENV = {}; const CTX = { waitUntil() {} };
let pass = 0, fail = 0; const out = [];
const t = (name, ok, detail) => { ok ? pass++ : fail++; out.push((ok ? "  ok   " : "  NG   ") + name + (ok || !detail ? "" : "  <<< " + detail)); };
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");

const card = await (await worker.fetch(new Request(ORIGIN + "/.well-known/agent-card.json"), ENV, CTX)).json();
const jwks = await (await worker.fetch(new Request(ORIGIN + "/.well-known/jwks.json"), ENV, CTX)).json();
const sigs = Array.isArray(card.signatures) ? card.signatures : [];
t("the card served for the canonical origin carries a signature", sigs.length >= 1);
t("the JWKS served by the same source carries the signing kid", (() => { try { const p = JSON.parse(Buffer.from(sigs[0].protected, "base64url").toString("utf8")); return (jwks.keys || []).some((k) => k.kid === p.kid); } catch { return false; } })());
const bare = { ...card }; delete bare.signatures;
const canonical = await sha(sdk.canonicalizeAgentCard(bare));
let verified = false, why = "";
try {
  await sdk.verifyAgentCardSignature(async (kid) => { const k = (jwks.keys || []).find((x) => x.kid === kid); if (!k) throw new Error("kid " + kid + " not in the served JWKS"); return k; })(card);
  verified = true;
} catch (e) { why = String(e && e.message || e); }
t("the baked CARD_SIGNATURE verifies over the body this source renders (canonical " + canonical.slice(0, 12) + ", version " + card.version + ")", verified,
  why + ". The body changed after it was signed (a version bump changes the card). Re-sign before deploying: node workers/a2a-card-sign/sign.mjs --worker workers/hs-verify-gate/src/worker.js --origin " + ORIGIN + " --key ~/.hs_card_key.pem --kid <kid>");

console.log(out.join("\n"));
console.log("=== " + pass + " / " + (pass + fail) + " 合格 (card signature over the rendered body、扉 " + card.version + ") ===");
if (fail) { console.log("署名し直さずに version を上げると、本番の card は verify せん。deploy_gate.sh はここで止まる。それが正しい。"); process.exit(1); }
