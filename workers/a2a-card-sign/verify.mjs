// 使い方: node verify.mjs https://mcp.horizonshield.dev      (本番の card を公式 verifier で検証。鍵は要らん)
//         node verify.mjs ../hs-mcp/src/mcp.js https://mcp.horizonshield.dev   (ソースから描いた card を検証。配備前の確認)
import { renderCard, verifyServed, decodeProtected } from "./sign_lib.mjs";
import { canonicalizeAgentCard } from "@a2a-js/sdk";
import { createHash } from "node:crypto";

const [a, b] = process.argv.slice(2);
let card, origin, fetchJwks;
if (a && /^https?:\/\//.test(a)) {
  origin = a.replace(/\/+$/, "");
  const r = await fetch(origin + "/.well-known/agent-card.json", { headers: { "user-agent": "a2a-card-verify/1" } });
  if (!r.ok) { console.error("card http " + r.status); process.exit(1); }
  card = await r.json();
  fetchJwks = async (jku) => { const j = await fetch(jku, { headers: { "user-agent": "a2a-card-verify/1" } }); if (!j.ok) throw new Error("jwks http " + j.status); return await j.json(); };
} else {
  origin = (b || "").replace(/\/+$/, "");
  if (!a || !origin) { console.error("usage: verify.mjs <https origin> | <worker path> <origin>"); process.exit(2); }
  const { loadWorker, makeEnv, ctx } = await import("../hs-mcp/test/local_env.mjs");
  const worker = await loadWorker(a); const env = makeEnv();
  card = await renderCard(a, origin);
  fetchJwks = async (jku) => (await worker.fetch(new Request(jku), env, ctx)).json();
}
const sigs = Array.isArray(card.signatures) ? card.signatures : [];
if (!sigs.length) { console.log(JSON.stringify({ origin, signatures: 0, verified: null, note: "card carries no signatures" })); process.exit(3); }
const bare = Object.assign({}, card); delete bare.signatures;
const canonical_sha256 = createHash("sha256").update(canonicalizeAgentCard(bare), "utf8").digest("hex");
try {
  await verifyServed(card, fetchJwks);
  const h = decodeProtected(sigs[0]);
  console.log(JSON.stringify({ origin, signatures: sigs.length, verified: true, alg: h.alg, kid: h.kid, jku: h.jku, canonical_sha256 }, null, 2));
} catch (e) {
  console.log(JSON.stringify({ origin, signatures: sigs.length, verified: false, error: String(e && e.message || e), canonical_sha256 }, null, 2));
  process.exit(1);
}
