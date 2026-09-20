// RUN_ALL: suite
// witness_selfcheck: 良い証人は池の条件を満たすと言い、欠けとる証人は落とす。network 無し (fetch と send を stub)。
// 走らせ方: node witness_selfcheck_test.mjs
import { selfCheck } from "./witness_selfcheck.mjs";
import { answerRequest } from "./witness_reply.mjs";
import { fixtureKey } from "./witness_fixture_build.mjs";

let pass = 0, fail = 0; const out = [];
const t = (name, ok, detail) => { ok ? pass++ : fail++; out.push((ok ? "  ok   " : "  NG   ") + name + (ok || !detail ? "" : "  <<< " + detail)); };

const CONDUCT = "https://gate.horizonshield.dev/ext/conduct/v1";
const GOOD = "witness-good.example";
const stubMeasure = () => async () => [{ surface: "health.gate_commit", observed: { status: "200", gate_commit: "x" } }];

// card の作り (conduct-v1 + witness_policy.reciprocal + witness_reply.key_url を選べる)
function cardFor(host, { reciprocal = true, keyUrl } = {}) {
  const params = { compensation: { paid_by: "public" }, measured_endpoints: ["https://" + host + "/mcp"], conduct_record: "x", witness_intake: "x" };
  if (reciprocal) params.witness_policy = { reciprocal: true };
  params.witness_reply = { key_url: keyUrl || ("https://" + host + "/keys/witness.json") };
  return { name: host, capabilities: { extensions: [{ uri: CONDUCT, params }] } };
}
// fetchImpl の stub: card と key_url を配る
function mkFetch(host, cardOpts, pubB64) {
  return async (url) => {
    const u = new URL(String(url));
    if (u.pathname === "/.well-known/agent-card.json") return new Response(JSON.stringify(cardFor(host, cardOpts)), { status: 200 });
    if (u.pathname.startsWith("/keys/")) return new Response(JSON.stringify({ public_key_ed25519_b64: pubB64 }), { status: 200 });
    return new Response("nf", { status: 404 });
  };
}
// sendImpl の stub: fixture 鍵で本物に署名して答える
function mkSend(host) {
  return async (entry, req) => {
    const k = await fixtureKey(host);
    const r = await answerRequest(req, { signedDomain: host, keyUrl: entry.key_url, priv: k.privKey, pubRaw: k.pubRaw, measure: stubMeasure(), allowPrivateTargets: true });
    return { signed_domain: host, answered: r.answered, record: r.record, why: r.declined };
  };
}

const goodKey = await fixtureKey(GOOD);

// A. 良い証人 -> 4 条件すべて PASS、qualifies
{
  const r = await selfCheck("https://" + GOOD, { fetchImpl: mkFetch(GOOD, {}, goodKey.pubB64), sendImpl: mkSend(GOOD) });
  t("good witness qualifies", r.qualifies, JSON.stringify(r.checks));
  t("all 4 checks pass", r.checks.length === 4 && r.checks.every((c) => c.ok));
}

// B. reciprocal 宣言が無い -> witness_policy_reciprocal FAIL、qualifies false
{
  const r = await selfCheck("https://" + GOOD, { fetchImpl: mkFetch(GOOD, { reciprocal: false }, goodKey.pubB64), sendImpl: mkSend(GOOD) });
  t("no reciprocal -> does not qualify", !r.qualifies);
  t("the failing check is witness_policy_reciprocal", r.checks.find((c) => c.id === "witness_policy_reciprocal" && !c.ok) !== undefined, JSON.stringify(r.checks.map((c) => [c.id, c.ok])));
}

// C. key_url が別ホスト -> domain_bound_key FAIL
{
  const r = await selfCheck("https://" + GOOD, { fetchImpl: mkFetch(GOOD, { keyUrl: "https://someone-else.example/keys/witness.json" }, goodKey.pubB64), sendImpl: mkSend(GOOD) });
  t("off-domain key_url -> does not qualify", !r.qualifies);
  t("the failing check is domain_bound_key", r.checks.find((c) => c.id === "domain_bound_key" && !c.ok) !== undefined, JSON.stringify(r.checks.map((c) => [c.id, c.ok])));
}

// D. /a2a が答えん -> answers_witness_request FAIL
{
  const r = await selfCheck("https://" + GOOD, { fetchImpl: mkFetch(GOOD, {}, goodKey.pubB64), sendImpl: async () => ({ answered: false, why: "unreachable" }) });
  t("silent /a2a -> does not qualify", !r.qualifies);
  t("the failing check is answers_witness_request", r.checks.find((c) => c.id === "answers_witness_request" && !c.ok) !== undefined);
}

console.log(out.join("\n"));
console.log("=== " + pass + " / " + (pass + fail) + " 合格 (witness selfcheck: 池入り自己診断) ===");
if (fail) process.exit(1);