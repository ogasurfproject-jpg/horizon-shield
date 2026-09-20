// RUN_ALL: library  Class 1 のドリフト証人 (設計書 3.1)。network が要るので suite にはせん。手で回す。
//
//   node drift_witness.mjs https://gate.horizonshield.dev \
//        --expect-commit 3213ffc53c8d \
//        --expect-canonical 45419922149ba1763119d746d19867e2e114d20ab067ff26e11b560b1636db51 \
//        --repo /Users/oogatoshikatsu/horizon-shield \
//        --out drift_$(date -u +%Y%m%dT%H%M%SZ).jsonl
//
// 測る 7 表面 (全部 Class 1: 立証可能、決定可能、誤検知はほぼ無い):
//   health.gate_commit            ピンされとるか (unpinned = 即ドリフト)。--expect-commit があればその値か
//   agent-card.signature          公式 SDK の verifier で verify するか、canonical sha256 は署名済みの物か
//   well-known.jwks               鍵が在るか、kid と thumbprint
//   well-known.openai-apps-challenge  設定済みで非空か。値は公開物なので値ごと記録する (設計書 3.2)
//   ext.conduct-v1.spec           配っとる spec の sha と repo の CONDUCT_EXT_v1.md の sha が同じか (--repo が要る)
//   keys.agreement / keys.witness 鍵の口が答えるか (404 は「無い」の正直な答えで、ドリフトやない。5xx や落ちはドリフト)
//
// 出す物: 表面ごとに 1 つの nenrin-drift-record-v1 (seal 済み、record_sha256 付き) を JSONL で。drift:false も書く。
// 「正常やった証拠」が年輪に要るからや。異常だけ書く証人は、正常を証明できん。
//
// 動かん。提案せん。書くだけ。(設計書 4.1)
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { seal, sha256Hex } from "./recovery_verify.mjs";
import { SCHEMAS } from "./recovery_schema.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
const origin = (process.argv[2] && /^https?:\/\//.test(process.argv[2]) ? process.argv[2] : "").replace(/\/+$/, "");
if (!origin) { console.error("usage: node drift_witness.mjs <https origin> [--expect-commit sha] [--expect-canonical hex] [--repo path] [--out file.jsonl]"); process.exit(2); }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD_SIGN = path.resolve(HERE, "../../../a2a-card-sign");
const WITNESS = { name: "nenrin-drift-witness", vantage: hostname() + " (operator network)" };
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const UA = { "user-agent": "nenrin-drift-witness/0.1" };

async function get(pathname, headers = {}) {
  const r = await fetch(origin + pathname, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(15000), redirect: "manual" });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json };
}

// 公式 SDK は a2a-card-sign の node_modules に居る。そこから解決する。ここに二重に入れん。
async function loadSdk() {
  const req = createRequire(path.join(CARD_SIGN, "package.json"));
  return await import(pathToFileURL(req.resolve("@a2a-js/sdk")).href);
}

const records = [];
async function record(surface, drift, kind, observed, expected, establishes, does_not_establish, extra = {}) {
  const r = await seal({
    schema: SCHEMAS.drift, recorded_at: now(), witness: WITNESS, prev: null,
    endpoint: origin, surface, drift, ...(drift ? { kind } : {}), observed, expected, establishes, does_not_establish, ...extra,
  });
  records.push(r);
  return r;
}

// 1. health.gate_commit
try {
  const h = await get("/health");
  const gc = h.json && typeof h.json.gate_commit === "string" ? h.json.gate_commit : "";
  const unpinned = /^unpinned/i.test(gc) || gc === "";
  const mismatch = !!args["expect-commit"] && !unpinned && gc !== args["expect-commit"];
  await record("health.gate_commit", unpinned || mismatch, unpinned ? "unpinned_deploy" : "commit_mismatch",
    { status: String(h.status), gate_commit: gc, gate_version: String(h.json && h.json.gate_version || "") },
    { pinned: "true", ...(args["expect-commit"] ? { gate_commit: args["expect-commit"] } : {}) },
    ["at recorded_at, GET /health returned the observed gate_commit"],
    ["who deployed", "what tree the build came from"]);
} catch (e) { await record("health.gate_commit", true, "endpoint_error", { error: String(e && e.message || e) }, { pinned: "true" }, ["GET /health did not answer"], ["why"]); }

// 2. agent-card.signature
try {
  const sdk = await loadSdk();
  const c = await get("/.well-known/agent-card.json");
  const card = c.json || {};
  const bare = { ...card }; delete bare.signatures;
  const canonical_sha256 = await sha256Hex(sdk.canonicalizeAgentCard(bare));
  const sigs = Array.isArray(card.signatures) ? card.signatures : [];
  let verified = false, kid = "", alg = "", jku = "", why = "";
  if (sigs.length) {
    try {
      const prot = JSON.parse(Buffer.from(sigs[0].protected, "base64url").toString("utf8"));
      kid = String(prot.kid || ""); alg = String(prot.alg || ""); jku = String(prot.jku || "");
      const verify = sdk.verifyAgentCardSignature(async (k, j) => {
        const jr = await fetch(j, { headers: UA, signal: AbortSignal.timeout(15000) });
        const doc = await jr.json();
        const key = (doc.keys || []).find((x) => x.kid === k);
        if (!key) throw new Error("kid " + k + " not in " + j);
        return key;
      });
      await verify(card); verified = true;
    } catch (e) { why = String(e && e.message || e); }
  } else why = "card carries no signatures";
  const canonMismatch = !!args["expect-canonical"] && canonical_sha256 !== args["expect-canonical"];
  await record("agent-card.signature", !verified || canonMismatch, !verified ? "card_body_signature_mismatch" : "canonical_mismatch",
    { status: String(c.status), verified: String(verified), canonical_sha256, kid, alg, jku, signatures: String(sigs.length), ...(why ? { why } : {}) },
    { verified: "true", ...(args["expect-canonical"] ? { canonical_sha256: args["expect-canonical"] } : {}) },
    ["at recorded_at the served card had the observed canonical sha256", verified ? "the first signature verified with the official SDK verifier against the served JWKS" : "the first signature did not verify with the official SDK verifier"],
    ["why the body changed, if it did", "whether the signer is wrong (a verify failure alone cannot tell deploy drift from a signer fault)"]);
} catch (e) { await record("agent-card.signature", true, "endpoint_error", { error: String(e && e.message || e) }, { verified: "true" }, ["the card or the SDK could not be loaded"], ["why"]); }

// 3. well-known.jwks
try {
  const j = await get("/.well-known/jwks.json");
  const keys = (j.json && Array.isArray(j.json.keys)) ? j.json.keys : [];
  const thumbs = {};
  for (const k of keys) thumbs[String(k.kid || "?")] = await sha256Hex(JSON.stringify({ crv: k.crv, kty: k.kty, x: k.x, y: k.y }));
  await record("well-known.jwks", keys.length === 0, "jwks_missing",
    { status: String(j.status), kids: keys.map((k) => String(k.kid || "")).join(","), thumbprints: thumbs },
    { present: "true" },
    ["at recorded_at the JWKS carried the observed kids and thumbprints"],
    ["that the keys are the right keys (that is the card verification above)"]);
} catch (e) { await record("well-known.jwks", true, "endpoint_error", { error: String(e && e.message || e) }, { present: "true" }, ["GET /.well-known/jwks.json did not answer"], ["why"]); }

// 4. well-known.openai-apps-challenge (値は公開物。値ごと記録する。設計書 3.2)
try {
  const ch = await get("/.well-known/openai-apps-challenge");
  const configured = ch.status === 200 && ch.json === null && ch.text.trim().length > 0;
  await record("well-known.openai-apps-challenge", !configured, "public_value_unset",
    { status: String(ch.status), configured: String(configured), ...(configured ? { value: ch.text.trim(), sha256: await sha256Hex(ch.text.trim()) } : { body: ch.text.slice(0, 200) }) },
    { configured: "true" },
    [configured ? "at recorded_at the endpoint served the recorded challenge value" : "at recorded_at the endpoint served no challenge value"],
    ["whether OpenAI currently accepts the value", "who set or removed it"]);
} catch (e) { await record("well-known.openai-apps-challenge", true, "endpoint_error", { error: String(e && e.message || e) }, { configured: "true" }, ["the challenge endpoint did not answer"], ["why"]); }

// 5. ext.conduct-v1.spec
try {
  const s = await get("/ext/conduct/v1", { accept: "application/json" });
  const served = String(s.json && s.json.spec_markdown_sha256 || "");
  let repo = "";
  if (args.repo) repo = await sha256Hex(readFileSync(path.join(args.repo, "workers/hs-verify-gate/ext/CONDUCT_EXT_v1.md")));
  const drift = !served || (!!repo && served !== repo);
  await record("ext.conduct-v1.spec", drift, !served ? "spec_missing" : "spec_drift",
    { status: String(s.status), served_sha256: served, ...(repo ? { repo_sha256: repo } : {}) },
    { served: "true", ...(repo ? { equals_repo: "true" } : {}) },
    ["at recorded_at the served spec carried the observed sha256"].concat(repo ? ["the repository copy hashed to repo_sha256"] : []),
    ["that the spec is correct, only that the served and repository bytes " + (repo ? "do or do not " : "were not compared, no --repo given; they ") + "match"]);
} catch (e) { await record("ext.conduct-v1.spec", true, "endpoint_error", { error: String(e && e.message || e) }, { served: "true" }, ["GET /ext/conduct/v1 did not answer"], ["why"]); }

// 6, 7. keys.agreement / keys.witness (404 は正直な「無い」。ドリフトやない)
for (const [surface, p] of [["keys.agreement", "/keys/agreement.json"], ["keys.witness", "/keys/witness.json"]]) {
  try {
    const k = await get(p);
    const present = k.status === 200 && k.json && typeof k.json.public_key_ed25519_b64 === "string";
    const error = k.status !== 200 && k.status !== 404;
    await record(surface, error, "endpoint_error",
      { status: String(k.status), present: String(!!present), ...(present ? { key_sha256: await sha256Hex(k.json.public_key_ed25519_b64) } : {}) },
      { answers: "true" },
      [present ? "at recorded_at the key route served a key with the recorded sha256" : "at recorded_at the key route answered " + k.status],
      ["that the key is the operator's (that is attribution, gate 0.4.5)", "whether a key was present earlier (v0 keeps no prior state; v1 compares to the last witnessed record)"]);
  } catch (e) { await record(surface, true, "endpoint_error", { error: String(e && e.message || e) }, { answers: "true" }, ["GET " + p + " did not answer"], ["why"]); }
}

const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
if (args.out) { writeFileSync(args.out, lines); } else { process.stdout.write(lines); }
const drifted = records.filter((r) => r.drift);
console.error("nenrin-drift-witness: " + records.length + " surfaces, " + drifted.length + " drift" + (drifted.length ? ": " + drifted.map((r) => r.surface + "(" + r.kind + ")").join(", ") : "") + (args.out ? "; wrote " + args.out : ""));
process.exit(drifted.length ? 1 : 0);
