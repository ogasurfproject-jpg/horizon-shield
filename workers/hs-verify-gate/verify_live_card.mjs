// verify_live_card: 本番の gate から live の agent-card と JWKS を取り、公式 A2A SDK (@a2a-js/sdk) で
// JWS を検証する。外部の検証者 (Agenstry など、SDK を使う側) がやるのと同じ事を、お前の vantage で再現する。
// deploy 前の描画 card を見る card_signature.test と違い、これは deploy 済みの本番バイトそのものを見る。
// 走らせ方 (本番): node workers/hs-verify-gate/verify_live_card.mjs
//        (別 origin): CARD_ORIGIN=https://... node workers/hs-verify-gate/verify_live_card.mjs
//        (offline 試験): node workers/hs-verify-gate/verify_live_card.mjs --card card.json --jwks jwks.json
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD_SIGN = path.resolve(HERE, "..", "a2a-card-sign");
const req = createRequire(path.join(CARD_SIGN, "package.json"));
const sdk = await import(pathToFileURL(req.resolve("@a2a-js/sdk")).href);

const args = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith("--")) { args[a.slice(2)] = process.argv[i + 1]; i++; } }
const ORIGIN = (process.env.CARD_ORIGIN || "https://gate.horizonshield.dev").replace(/\/+$/, "");

let card, jwks, whereCard, whereJwks;
if (args.card) {
  whereCard = args.card; whereJwks = args.jwks || args.card.replace(/card/, "jwks");
  card = JSON.parse(readFileSync(whereCard, "utf8"));
  jwks = JSON.parse(readFileSync(whereJwks, "utf8"));
} else {
  whereCard = ORIGIN + "/.well-known/agent-card.json"; whereJwks = ORIGIN + "/.well-known/jwks.json";
  card = await (await fetch(whereCard, { cache: "no-store" })).json();
  jwks = await (await fetch(whereJwks, { cache: "no-store" })).json();
}

const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");
const sigs = Array.isArray(card.signatures) ? card.signatures : [];
if (!sigs.length) { console.log("INVALID  the live card carries no signatures (" + whereCard + ")"); process.exit(1); }
let kid = "?"; try { kid = JSON.parse(Buffer.from(sigs[0].protected, "base64url").toString("utf8")).kid; } catch (_e) {}
const bare = { ...card }; delete bare.signatures;
const canonical = sdk.canonicalizeAgentCard(bare);
const canon12 = (await sha(canonical)).slice(0, 12);

try {
  await sdk.verifyAgentCardSignature(async (k) => { const j = (jwks.keys || []).find((x) => x.kid === k); if (!j) throw new Error("kid " + k + " not in the served JWKS"); return j; })(card);
  console.log("VERIFIED  " + whereCard);
  console.log("  version " + card.version + "   kid " + kid + "   canonical " + canon12);
  console.log("  検証は公式 @a2a-js/sdk。SDK を使う外部検証者はこの vantage で同じ結果を得る。");
} catch (e) {
  console.log("INVALID   " + whereCard);
  console.log("  version " + card.version + "   kid " + kid + "   canonical " + canon12);
  console.log("  reason: " + String(e && e.message || e));
  console.log("  = 本番バイトが署名対象と違う。deploy 後に再署名しとらんか、canonical が別。");
  process.exit(1);
}
