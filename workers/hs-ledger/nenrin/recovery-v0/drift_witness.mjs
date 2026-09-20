// RUN_ALL: library  Class 1 のドリフト証人 (設計書 3.1)。network が要るので suite にはせん。手で回す。測定部は measureSurfaces() として輸出 (籤の反対側 witness_reply.mjs が使う)。
//
//   node drift_witness.mjs https://gate.horizonshield.dev \
//        --expect-commit 3213ffc53c8d \
//        --expect-canonical 45419922149ba1763119d746d19867e2e114d20ab067ff26e11b560b1636db51 \
//        --repo /Users/oogatoshikatsu/horizon-shield \
//        --baseline baseline_20260920.jsonl \
//        --out drift_$(date -u +%Y%m%dT%H%M%SZ).jsonl
//
// 測る 9 表面 (全部 Class 1: 立証可能、決定可能、誤検知はほぼ無い):
//   health.gate_commit            ピンされとるか (unpinned = 即ドリフト)。--expect-commit があればその値か
//   agent-card.signature          公式 SDK の verifier で verify するか、canonical sha256 は署名済みの物か
//   well-known.jwks               鍵が在るか、kid と thumbprint。--baseline があれば前回と同じか (jwks_changed)
//   well-known.openai-apps-challenge  設定済みで非空か。値は公開物なので値ごと記録する (設計書 3.2)。--baseline があれば前回と同じ値か
//   ext.conduct-v1.spec           配っとる spec の sha と repo の CONDUCT_EXT_v1.md の sha が同じか (--repo が要る)
//   keys.agreement / keys.witness / keys.operator 鍵の口が答えるか (404 は「無い」の正直な答えで、ドリフトやない。5xx や落ちはドリフト)。--baseline があれば鍵が前回と同じか (key_changed)
//   keys.operator は Policy Gate の信用アンカー (0.4.8)。これが消えたら、以後の許可を第三者が検証できん
//
// --baseline は前回の走り (JSONL)。v0 の証人は prior state を持たんかった。v2 で前回との比較を証人自身に持たせた (設計書 13 節の「次」)。
// fetch は cache: "no-store"。cache を読んだ証人は何も測ってへん。
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD_SIGN = path.resolve(HERE, "../../../a2a-card-sign");
export const SURFACES = ["health.gate_commit", "agent-card.signature", "well-known.jwks", "well-known.openai-apps-challenge", "ext.conduct-v1.spec", "keys.agreement", "keys.witness", "keys.operator", "well-known.did"];
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const UA = { "user-agent": "nenrin-drift-witness/0.2" };

// 公式 SDK は a2a-card-sign の node_modules に居る。そこから解決する。ここに二重に入れん。
export async function loadSdk() {
  const req = createRequire(path.join(CARD_SIGN, "package.json"));
  return await import(pathToFileURL(req.resolve("@a2a-js/sdk")).href);
}

// 前回の走り (JSONL) を surface -> observed に畳む。同じ surface が複数在れば最後の物。
export function loadBaseline(text) {
  const prior = {};
  for (const line of String(text || "").split("\n")) {
    const t = line.trim(); if (!t) continue;
    let r; try { r = JSON.parse(t); } catch { continue; }
    if (r && r.schema === SCHEMAS.drift && r.surface && r.observed) prior[r.surface] = r.observed;
  }
  return prior;
}

// 9 表面を測って drift 記録の配列を返す。fetchImpl と sdk は差し替え可 (試験と、SDK が無い環境のため)。
export async function measureSurfaces(originIn, opts = {}) {
  const origin = String(originIn).replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const witness = opts.witness || { name: "nenrin-drift-witness", vantage: hostname() + " (operator network)" };
  const prior = opts.baseline || {};
  const expectCommit = opts.expectCommit || "", expectCanonical = opts.expectCanonical || "", repoPath = opts.repo || "";
  const records = [];

  async function get(pathname, headers = {}) {
    const r = await fetchImpl(origin + pathname, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(15000), redirect: "manual", cache: "no-store" });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, text, json };
  }
  async function record(surface, drift, kind, observed, expected, establishes, does_not_establish, extra = {}) {
    const r = await seal({
      schema: SCHEMAS.drift, recorded_at: now(), witness, prev: null,
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
    const mismatch = !!expectCommit && !unpinned && gc !== expectCommit;
    await record("health.gate_commit", unpinned || mismatch, unpinned ? "unpinned_deploy" : "commit_mismatch",
      { status: String(h.status), gate_commit: gc, gate_version: String(h.json && h.json.gate_version || "") },
      { pinned: "true", ...(expectCommit ? { gate_commit: expectCommit } : {}) },
      ["at recorded_at, GET /health returned the observed gate_commit"],
      ["who deployed", "what tree the build came from"]);
  } catch (e) { await record("health.gate_commit", true, "endpoint_error", { error: String(e && e.message || e) }, { pinned: "true" }, ["GET /health did not answer"], ["why"]); }

  // 2. agent-card.signature
  try {
    const sdk = opts.sdk || await loadSdk();
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
          const jr = await fetchImpl(j, { headers: UA, signal: AbortSignal.timeout(15000), cache: "no-store" });
          const doc = await jr.json();
          const key = (doc.keys || []).find((x) => x.kid === k);
          if (!key) throw new Error("kid " + k + " not in " + j);
          return key;
        });
        await verify(card); verified = true;
      } catch (e) { why = String(e && e.message || e); }
    } else why = "card carries no signatures";
    const canonMismatch = !!expectCanonical && canonical_sha256 !== expectCanonical;
    await record("agent-card.signature", !verified || canonMismatch, !verified ? "card_body_signature_mismatch" : "canonical_mismatch",
      { status: String(c.status), verified: String(verified), canonical_sha256, kid, alg, jku, signatures: String(sigs.length), ...(why ? { why } : {}) },
      { verified: "true", ...(expectCanonical ? { canonical_sha256: expectCanonical } : {}) },
      ["at recorded_at the served card had the observed canonical sha256", verified ? "the first signature verified with the official SDK verifier against the served JWKS" : "the first signature did not verify with the official SDK verifier"],
      ["why the body changed, if it did", "whether the signer is wrong (a verify failure alone cannot tell deploy drift from a signer fault)"]);
  } catch (e) { await record("agent-card.signature", true, "endpoint_error", { error: String(e && e.message || e) }, { verified: "true" }, ["the card or the SDK could not be loaded"], ["why"]); }

  // 3. well-known.jwks (--baseline: 前回の thumbprint と違えば jwks_changed。鍵の変化は Class 1 の中でも一番重い)
  try {
    const j = await get("/.well-known/jwks.json");
    const keys = (j.json && Array.isArray(j.json.keys)) ? j.json.keys : [];
    const thumbs = {};
    for (const k of keys) thumbs[String(k.kid || "?")] = await sha256Hex(JSON.stringify({ crv: k.crv, kty: k.kty, x: k.x, y: k.y }));
    const pj = prior["well-known.jwks"];
    const changed = !!(pj && pj.thumbprints && JSON.stringify(pj.thumbprints) !== JSON.stringify(thumbs));
    await record("well-known.jwks", keys.length === 0 || changed, keys.length === 0 ? "jwks_missing" : "jwks_changed",
      { status: String(j.status), kids: keys.map((k) => String(k.kid || "")).join(","), thumbprints: thumbs, ...(pj ? { prior_thumbprints: pj.thumbprints || {} } : {}) },
      { present: "true", ...(pj ? { equals_prior: "true" } : {}) },
      ["at recorded_at the JWKS carried the observed kids and thumbprints"].concat(pj ? [changed ? "the thumbprints differ from the baseline run" : "the thumbprints equal the baseline run"] : []),
      ["that the keys are the right keys (that is the card verification above)"].concat(pj ? [] : ["whether the keys changed (no --baseline given)"]));
  } catch (e) { await record("well-known.jwks", true, "endpoint_error", { error: String(e && e.message || e) }, { present: "true" }, ["GET /.well-known/jwks.json did not answer"], ["why"]); }

  // 4. well-known.openai-apps-challenge (値は公開物。値ごと記録する。設計書 3.2。--baseline: 前回の値と違えば public_value_changed)
  try {
    const ch = await get("/.well-known/openai-apps-challenge");
    const configured = ch.status === 200 && ch.json === null && ch.text.trim().length > 0;
    const pc = prior["well-known.openai-apps-challenge"];
    const changed = !!(configured && pc && pc.value && pc.value !== ch.text.trim());
    await record("well-known.openai-apps-challenge", !configured || changed, !configured ? "public_value_unset" : "public_value_changed",
      { status: String(ch.status), configured: String(configured), ...(configured ? { value: ch.text.trim(), sha256: await sha256Hex(ch.text.trim()) } : { body: ch.text.slice(0, 200) }), ...(pc && pc.value ? { prior_sha256: pc.sha256 || "" } : {}) },
      { configured: "true", ...(pc && pc.value ? { equals_prior: "true" } : {}) },
      [configured ? "at recorded_at the endpoint served the recorded challenge value" : "at recorded_at the endpoint served no challenge value"],
      ["whether OpenAI currently accepts the value", "who set or removed it"]);
  } catch (e) { await record("well-known.openai-apps-challenge", true, "endpoint_error", { error: String(e && e.message || e) }, { configured: "true" }, ["the challenge endpoint did not answer"], ["why"]); }

  // 5. ext.conduct-v1.spec
  try {
    const s = await get("/ext/conduct/v1", { accept: "application/json" });
    const served = String(s.json && s.json.spec_markdown_sha256 || "");
    let repo = "";
    if (repoPath) repo = await sha256Hex(readFileSync(path.join(repoPath, "workers/hs-verify-gate/ext/CONDUCT_EXT_v1.md")));
    const drift = !served || (!!repo && served !== repo);
    await record("ext.conduct-v1.spec", drift, !served ? "spec_missing" : "spec_drift",
      { status: String(s.status), served_sha256: served, ...(repo ? { repo_sha256: repo } : {}) },
      { served: "true", ...(repo ? { equals_repo: "true" } : {}) },
      ["at recorded_at the served spec carried the observed sha256"].concat(repo ? ["the repository copy hashed to repo_sha256"] : []),
      ["that the spec is correct, only that the served and repository bytes " + (repo ? "do or do not " : "were not compared, no --repo given; they ") + "match"]);
  } catch (e) { await record("ext.conduct-v1.spec", true, "endpoint_error", { error: String(e && e.message || e) }, { served: "true" }, ["GET /ext/conduct/v1 did not answer"], ["why"]); }

  // 6, 7, 8. keys.agreement / keys.witness / keys.operator (404 は正直な「無い」。ドリフトやない。--baseline: 前回と鍵が違えば key_changed、前回在って今無いなら key_removed)
  for (const [surface, p] of [["keys.agreement", "/keys/agreement.json"], ["keys.witness", "/keys/witness.json"], ["keys.operator", "/keys/operator.json"]]) {
    try {
      const k = await get(p);
      const present = k.status === 200 && k.json && typeof k.json.public_key_ed25519_b64 === "string";
      const error = k.status !== 200 && k.status !== 404;
      const key_sha256 = present ? await sha256Hex(k.json.public_key_ed25519_b64) : "";
      const pk = prior[surface];
      const removed = !!(pk && pk.present === "true" && !present);
      const changed = !!(pk && pk.key_sha256 && present && pk.key_sha256 !== key_sha256);
      await record(surface, error || removed || changed, error ? "endpoint_error" : removed ? "key_removed" : "key_changed",
        { status: String(k.status), present: String(!!present), ...(present ? { key_sha256 } : {}), ...(pk && pk.key_sha256 ? { prior_key_sha256: pk.key_sha256 } : {}) },
        { answers: "true", ...(pk && pk.present === "true" ? { equals_prior: "true" } : {}) },
        [present ? "at recorded_at the key route served a key with the recorded sha256" : "at recorded_at the key route answered " + k.status].concat(pk ? [removed ? "the baseline run had a key here; now there is none" : changed ? "the key differs from the baseline run" : "the state equals the baseline run"] : []),
        ["that the key is the operator's (that is attribution, gate 0.4.5)"].concat(pk ? [] : ["whether a key was present earlier (no --baseline given)"]));
    } catch (e) { await record(surface, true, "endpoint_error", { error: String(e && e.message || e) }, { answers: "true" }, ["GET " + p + " did not answer"], ["why"]); }
  }

  // 9. well-known.did (0.4.12: did:web の DID document。card 署名鍵と運営者鍵をドメインに縛る。404 は「未公開」の正直な答え、keys.* と同じ。
  //    --baseline: verificationMethod の鍵集合 (did_sha256) が前回と違えば did_changed、前回在って今無いなら did_removed。これが黙って変わったら、以後 did:web で身元を確かめる第三者が別の鍵を掴む)
  try {
    const d = await get("/.well-known/did.json");
    const doc = d.json;
    const present = d.status === 200 && doc && typeof doc.id === "string" && Array.isArray(doc.verificationMethod);
    const error = d.status !== 200 && d.status !== 404;
    const vm = present ? [...doc.verificationMethod].sort((a, b) => String(a.id).localeCompare(String(b.id))).map((m) => ({ id: String(m.id), jwk: m.publicKeyJwk })) : [];
    const did_sha256 = present ? await sha256Hex(JSON.stringify(vm)) : "";
    const kids = present ? doc.verificationMethod.map((m) => String(m.id).split("#")[1] || "").join(",") : "";
    const pd = prior["well-known.did"];
    const removed = !!(pd && pd.present === "true" && !present);
    const changed = !!(pd && pd.did_sha256 && present && pd.did_sha256 !== did_sha256);
    await record("well-known.did", error || removed || changed, error ? "endpoint_error" : removed ? "did_removed" : "did_changed",
      { status: String(d.status), present: String(!!present), ...(present ? { id: String(doc.id), kids, did_sha256 } : {}), ...(pd && pd.did_sha256 ? { prior_did_sha256: pd.did_sha256 } : {}) },
      { answers: "true", ...(pd && pd.present === "true" ? { equals_prior: "true" } : {}) },
      [present ? "at recorded_at /.well-known/did.json served a DID document binding the recorded keys (did_sha256) to " + String(doc.id) : "at recorded_at /.well-known/did.json answered " + d.status].concat(pd ? [removed ? "the baseline run had a DID document; now there is none" : changed ? "the bound keys differ from the baseline run" : "the state equals the baseline run"] : []),
      ["that a third party resolving did:web gets these bytes (that is off this vantage), only that these bytes were served here"].concat(pd ? [] : ["whether a DID was present earlier (no --baseline given)"]));
  } catch (e) { await record("well-known.did", true, "endpoint_error", { error: String(e && e.message || e) }, { answers: "true" }, ["GET /.well-known/did.json did not answer"], ["why"]); }
  return records;
}

// 観測の畳み方: 籤の証人が返す observed (surface -> observed object)。drift_witness の記録 9 本をそのまま畳む。
export function foldObserved(records) {
  const observed = {};
  for (const r of records) observed[r.surface] = r.observed;
  return observed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
  const origin = (process.argv[2] && /^https?:\/\//.test(process.argv[2]) ? process.argv[2] : "").replace(/\/+$/, "");
  if (!origin) { console.error("usage: node drift_witness.mjs <https origin> [--expect-commit sha] [--expect-canonical hex] [--repo path] [--baseline prev.jsonl] [--out file.jsonl]"); process.exit(2); }
  const baseline = args.baseline ? loadBaseline(readFileSync(args.baseline, "utf8")) : {};
  const records = await measureSurfaces(origin, { expectCommit: args["expect-commit"], expectCanonical: args["expect-canonical"], repo: args.repo, baseline });
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  if (args.out) { writeFileSync(args.out, lines); } else { process.stdout.write(lines); }
  const drifted = records.filter((r) => r.drift);
  console.error("nenrin-drift-witness: " + records.length + " surfaces, " + drifted.length + " drift" + (drifted.length ? ": " + drifted.map((r) => r.surface + "(" + r.kind + ")").join(", ") : "") + (args.out ? "; wrote " + args.out : "") + (args.baseline ? "; compared to " + args.baseline : ""));
  process.exit(drifted.length ? 1 : 0);
}
