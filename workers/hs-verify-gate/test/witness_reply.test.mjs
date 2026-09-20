// witness_reply: 扉の /a2a が witness_request を受けて署名付き観測を返す (0.4.14)。network は stub。
// 走らせ方: node test/witness_reply.test.mjs
import worker from "../src/worker.js";
import { WITNESS_SURFACES } from "../src/witness.js";
import { verifyRecord } from "../../hs-ledger/nenrin/recovery-v0/recovery_verify.mjs";

const O = "https://gate.horizonshield.dev";
const CTX = { waitUntil() {} };
let pass = 0, fail = 0; const out = [];
const t = (name, ok, detail) => { ok ? pass++ : fail++; out.push((ok ? "  ok   " : "  NG   ") + name + (ok || !detail ? "" : "  <<< " + detail)); };
const b64 = (u) => Buffer.from(u).toString("base64");

// 証人鍵を作って env に (pkcs8 の base64 と raw 公開鍵の base64)
const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const PRIV = b64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey)));
const PUB = b64(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
const ENV_KEYED = { WITNESS_PRIVKEY_B64: PRIV, WITNESS_PUBKEY_B64: PUB };
const ENV_BARE = {};

const req = (endpoint, surfaces = WITNESS_SURFACES) => ({
  schema: "nenrin-witness-request-v1", endpoint, surfaces,
  subject_sha256: "a".repeat(64), pool_sha256: "b".repeat(64),
  beacon: { kind: "bitcoin", height: "900000", hash: "c".repeat(64) },
  requested_at: "2026-09-20T16:00:00Z", reply_schema: "nenrin-witness-observation-v1",
  instruction: "Measure the listed public surfaces of endpoint from your own vantage.",
});
const post = (env, body) => worker.fetch(new Request(O + "/a2a", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env, CTX);
const rpc = (r) => ({ jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { role: "user", messageId: "m1", parts: [{ kind: "data", data: r }] } } });
const dataPart = (j) => { const parts = (j.result && j.result.parts) || (j.result && j.result.message && j.result.message.parts) || (j.result && j.result.status && j.result.status.message && j.result.status.message.parts) || []; return parts.find((p) => p.kind === "data"); };
const metaOf = (j) => (j.result && j.result.metadata) || (j.result && j.result.message && j.result.message.metadata) || (j.result && j.result.status && j.result.status.message && j.result.status.message.metadata) || {};

// 1. 鍵未設定 -> witness_not_configured で正直に断る
{
  const j = await (await post(ENV_BARE, rpc(req("https://target-gate.dev")))).json();
  const m = metaOf(j);
  t("no key -> declined witness_not_configured", Object.values(m).includes("witness_not_configured") || /witness_not_configured/.test(JSON.stringify(j)), JSON.stringify(j).slice(0, 200));
}

// 2. self_witness -> 断る (鍵が在っても)
{
  const j = await (await post(ENV_KEYED, rpc(req("https://gate.horizonshield.dev/a2a")))).json();
  t("self_witness declined", /self_witness/.test(JSON.stringify(j)), JSON.stringify(j).slice(0, 200));
}

// 3. 非公開 target -> 断る
{
  const j = await (await post(ENV_KEYED, rpc(req("https://localhost")))).json();
  t("non-public target declined", /target_not_public/.test(JSON.stringify(j)), JSON.stringify(j).slice(0, 200));
}

// 4. happy path: 公開 target を stub fetch で測って署名付き観測を返す
const TARGET = "https://target-gate.dev";
const realFetch = globalThis.fetch;
const canned = {
  "/health": { status: 200, body: JSON.stringify({ ok: true, gate_version: "9.9.9", gate_commit: "abc123def456" }) },
  "/.well-known/agent-card.json": { status: 200, body: JSON.stringify({ name: "Target", description: "d", version: "1", supportedInterfaces: [{ url: TARGET + "/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" }], capabilities: {}, defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"], skills: [{ id: "s", name: "S", description: "sd", tags: ["t"] }] }) },
  "/.well-known/jwks.json": { status: 200, body: JSON.stringify({ keys: [{ kty: "EC", crv: "P-256", kid: "k1", x: "AAA", y: "BBB" }] }) },
  "/.well-known/openai-apps-challenge": { status: 200, body: "challenge-value-xyz" },
  "/ext/conduct/v1": { status: 200, body: JSON.stringify({ spec_markdown_sha256: "d".repeat(64) }) },
  "/keys/agreement.json": { status: 404, body: "no" },
  "/keys/witness.json": { status: 200, body: JSON.stringify({ public_key_ed25519_b64: "somekey" }) },
  "/keys/operator.json": { status: 404, body: "no" },
  "/.well-known/did.json": { status: 404, body: "no" },
};
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.origin !== "https://target-gate.dev") throw new Error("unexpected fetch to " + u.origin);
  const c = canned[u.pathname];
  if (!c) return new Response("not found", { status: 404 });
  return new Response(c.body, { status: c.status });
};
let obs;
try {
  const j = await (await post(ENV_KEYED, rpc(req(TARGET, ["health.gate_commit", "well-known.jwks", "well-known.did"])))).json();
  const dp = dataPart(j);
  obs = dp && dp.data;
  t("happy path returns a data part with an observation", !!obs && obs.schema === "nenrin-witness-observation-v1", JSON.stringify(j).slice(0, 300));
} finally { globalThis.fetch = realFetch; }

if (obs) {
  const v = await verifyRecord(obs);
  t("returned observation verifies (schema + record_sha256 + Ed25519)", v.ok, JSON.stringify(v.refusals || []));
  t("source is the gate's witness domain", obs.source && obs.source.signed_domain === "gate.horizonshield.dev" && obs.source.key_url === "https://gate.horizonshield.dev/keys/witness.json");
  t("public key matches the configured WITNESS_PUBKEY_B64", obs.public_key_ed25519_b64 === PUB, obs.public_key_ed25519_b64 + " vs " + PUB);
  t("observed carries the 3 requested surfaces", obs.observed && Object.keys(obs.observed).length === 3 && obs.observed["health.gate_commit"] && obs.observed["well-known.jwks"] && obs.observed["well-known.did"], JSON.stringify(Object.keys(obs.observed || {})));
  t("health surface read the target's gate_commit", obs.observed["health.gate_commit"].gate_commit === "abc123def456", JSON.stringify(obs.observed["health.gate_commit"]));
  t("did surface saw the target's 404 as present=false", obs.observed["well-known.did"].present === "false", JSON.stringify(obs.observed["well-known.did"]));
}

// 5. 既存の /a2a (MCP endpoint URL を text で) は壊れとらん
{
  const body = { jsonrpc: "2.0", id: 2, method: "message/send", params: { message: { role: "user", parts: [{ kind: "text", text: "check https://mcp.example-x.dev/mcp" }] } } };
  const r = await post(ENV_KEYED, body);
  const j = await r.json();
  t("text-URL /a2a message goes to the existing path, not the witness path", /storage_unavailable/.test(JSON.stringify(j)) && !/witness/.test(JSON.stringify(j)), JSON.stringify(j).slice(0, 160));
}

console.log(out.join("\n"));
console.log("=== " + pass + " / " + (pass + fail) + " 合格 (witness reply over /a2a、扉 0.4.14) ===");
if (fail) process.exit(1);
