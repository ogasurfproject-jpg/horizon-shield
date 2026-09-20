// RUN_ALL: library  外部エージェントが「HORIZON SHIELD の conduct 証人」= TSUGI 籤の池に入れるか、自分で確かめる道具。採点は witness_selfcheck_test.mjs
//
// 池に入る条件 (witness_pool_build と同じ、conduct-v1.1 11.4/11.6):
//   1. agent card が conduct-v1 拡張を宣言しとる
//   2. その params に witness_policy.reciprocal: true (籤で引かれたら答える宣言)
//   3. ドメインに縛った Ed25519 鍵を key_url で配る ({public_key_ed25519_b64}、key_url の host = 自分の origin の host)
//   4. /a2a が nenrin-witness-request-v1 を受けたら、署名付きの nenrin-witness-observation-v1 を返す (実際に 1 発叩いて確かめる)
//
// 参照実装: recovery-v0/witness_reply.mjs を自分の A2A 面に組み込むか、serve で立てるだけ。この道具は判定やのうて自己診断:
//   合否は「池の条件を満たすか」だけ。信用の判定やない (池に入る = 条件を満たした、であって信用された、やない)。
//   走らせ方 (自分の origin に届くシェルで):
//     node witness_selfcheck.mjs --origin https://myagent.example [--probe-target https://gate.horizonshield.dev]
import { buildRequest, requestSha256, sendRequest, extractObservation } from "./witness_request.mjs";
import { verifyRecord } from "./recovery_verify.mjs";

const CONDUCT_EXT_URIS = ["https://gate.horizonshield.dev/ext/conduct/v1", "https://w3id.org/horizonshield/conduct/v1"];
const hostOf = (u) => { try { return new URL(u).host.toLowerCase(); } catch { return ""; } };
const DUMMY64 = "0".repeat(64);

function conductParams(card) {
  const exts = card && card.capabilities && Array.isArray(card.capabilities.extensions) ? card.capabilities.extensions : [];
  for (const e of exts) if (e && CONDUCT_EXT_URIS.includes(e.uri) && e.params && typeof e.params === "object") return e.params;
  return null;
}

// origin を診断する。fetchImpl / sendImpl は差し替え可 (試験は network 無し)。
// 返す物: { origin, qualifies, checks: [{ id, ok, detail }] }
export async function selfCheck(origin, { probeTarget = "https://gate.horizonshield.dev", fetchImpl = globalThis.fetch, sendImpl = sendRequest } = {}) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok, detail });
  const host = hostOf(origin);
  let card = null, params = null, keyUrl = null;

  // 1. card + conduct-v1
  try {
    const r = await fetchImpl(String(origin).replace(/\/+$/, "") + "/.well-known/agent-card.json", { signal: AbortSignal.timeout(15000) });
    card = await r.json();
    params = conductParams(card);
    add("conduct_v1_declared", !!params, params ? "conduct-v1 extension found on the card" : "no conduct-v1 extension in capabilities.extensions[] (uri must be one of: " + CONDUCT_EXT_URIS.join(", ") + ")");
  } catch (e) { add("conduct_v1_declared", false, "could not fetch or parse the agent card: " + String(e && e.message || e)); }

  // 2. witness_policy.reciprocal
  const reciprocal = !!(params && params.witness_policy && params.witness_policy.reciprocal === true);
  add("witness_policy_reciprocal", reciprocal, reciprocal ? "witness_policy.reciprocal is true" : "the conduct params must declare witness_policy: { reciprocal: true }");

  // 3. domain-bound key at key_url
  keyUrl = (params && params.witness_reply && typeof params.witness_reply.key_url === "string") ? params.witness_reply.key_url : (String(origin).replace(/\/+$/, "") + "/keys/witness.json");
  let poolPub = "";
  try {
    const r = await fetchImpl(keyUrl, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    poolPub = typeof j.public_key_ed25519_b64 === "string" ? j.public_key_ed25519_b64 : "";
    const sameHost = hostOf(keyUrl) === host;
    add("domain_bound_key", !!poolPub && sameHost, !poolPub ? "key_url " + keyUrl + " does not serve {public_key_ed25519_b64}" : !sameHost ? "key_url host " + hostOf(keyUrl) + " is not the agent's own host " + host + " (11.4: the key must be under your own domain)" : "serves a domain-bound Ed25519 key");
  } catch (e) { add("domain_bound_key", false, "could not fetch key_url " + keyUrl + ": " + String(e && e.message || e)); }

  // 4. 実際に 1 発引いて、署名付き観測が返るか
  try {
    const req = buildRequest({ origin: probeTarget, subjectSha256: DUMMY64, poolSha256: DUMMY64, beacon: { kind: "selfcheck", height: "0", hash: DUMMY64 }, requestedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") });
    const reqHash = await requestSha256(req);
    const entry = { signed_domain: host, key_url: keyUrl, a2a_url: String(origin).replace(/\/+$/, "") + "/a2a" };
    const res = await sendImpl(entry, req, { timeoutMs: 30000 });
    if (!res.answered || !res.record) { add("answers_witness_request", false, "no signed observation came back: " + (res.why || "no_answer")); }
    else {
      const rec = res.record;
      const v = await verifyRecord(rec);
      const domOk = rec.source && String(rec.source.signed_domain).toLowerCase() === host;
      const keyUrlOk = rec.source && rec.source.key_url === keyUrl;
      const keyOk = !poolPub || rec.public_key_ed25519_b64 === poolPub;
      const reqOk = rec.request_sha256 === reqHash;
      const targetOk = hostOf(rec.endpoint) === hostOf(probeTarget);
      const ok = v.ok && domOk && keyUrlOk && keyOk && reqOk && targetOk;
      add("answers_witness_request", ok, ok ? "answered with a valid signed observation" :
        !v.ok ? "the returned observation does not verify: " + JSON.stringify(v.refusals) :
        !domOk ? "observation is signed for " + (rec.source && rec.source.signed_domain) + ", not your host " + host :
        !keyUrlOk ? "observation source.key_url is not the key_url on your card" :
        !keyOk ? "observation is signed with a key that is not the one at your key_url" :
        !reqOk ? "observation answers a different request than the one sent" :
        "observation is about " + rec.endpoint + ", not the probe target " + probeTarget);
    }
  } catch (e) { add("answers_witness_request", false, "sending a probe witness_request failed: " + String(e && e.message || e)); }

  const qualifies = checks.every((c) => c.ok);
  return { origin, host, key_url: keyUrl, qualifies, checks };
}

// @@CLI_BEGIN
import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith("--")) { const k = a.slice(2); const v = process.argv[i + 1]; if (v && !v.startsWith("--")) { args[k] = v; i++; } else args[k] = true; } }
  if (!args.origin) { console.error("usage: node witness_selfcheck.mjs --origin https://myagent.example [--probe-target https://gate.horizonshield.dev]"); process.exit(2); }
  const out = await selfCheck(args.origin, { probeTarget: args["probe-target"] || "https://gate.horizonshield.dev" });
  for (const c of out.checks) console.log((c.ok ? "  PASS  " : "  FAIL  ") + c.id + "  " + c.detail);
  console.log("\n" + (out.qualifies ? "QUALIFIES for the HORIZON SHIELD witness pool (" + out.host + "). This means the card meets the stated conditions, not that anyone trusts it." : "does NOT yet qualify: fix the FAIL lines above."));
  process.exit(out.qualifies ? 0 : 1);
}
