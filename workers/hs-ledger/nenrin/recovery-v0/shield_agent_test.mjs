// RUN_ALL: suite
// Shield エージェントの採点。今週の事故に対して何を言うか、そして表の各規則が意図した所で当たり、迷う所で止まるか。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { diagnose, RULES, compareBaseline } from "./shield_agent.mjs";
import { seal, verifyChain, verifyRecord } from "./recovery_verify.mjs";
import { SCHEMAS, PRIMITIVES } from "./recovery_schema.mjs";
import { FIXTURE_FILE } from "./recovery_fixture_build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0; const out = [];
const t = (name, ok, detail) => { ok ? pass++ : fail++; out.push((ok ? "  ok   " : "  FAIL ") + name + (ok || !detail ? "" : "  <- " + detail)); };
const fx = JSON.parse(readFileSync(path.join(HERE, FIXTURE_FILE), "utf8"));
const weekDrifts = fx.slice(0, 3);

async function d(surface, kind, observed = {}, expected = {}) {
  return seal({ schema: SCHEMAS.drift, recorded_at: "2026-09-20T09:00:00Z", witness: { name: "t", vantage: "t" }, prev: null, endpoint: "https://x.example",
    surface, drift: !!kind, ...(kind ? { kind } : {}), observed, expected, establishes: ["t"], does_not_establish: ["t"] });
}
const ok = (surface, observed = {}) => d(surface, null, observed, {});

// 1. 今週の事故
{
  const r = await diagnose(weekDrifts);
  t("this week: R1 fires", r.rule === "R1_unpinned_deploy", r.rule + " " + r.reason);
  t("this week: proposes redeploy_pinned, not resign", r.proposal && r.proposal.primitive === "redeploy_pinned");
  t("this week: resign_agent_card is explicitly rejected with a reason", !!(r.proposal && r.proposal.rejected.find((x) => x.primitive === "resign_agent_card" && x.why.length > 20)));
  t("this week: drift_sha256 cites exactly the three drifts", r.proposal && JSON.stringify(r.proposal.drift_sha256) === JSON.stringify(weekDrifts.map((x) => x.record_sha256)));
  t("this week: prev is the last drift", r.proposal && r.proposal.prev === weekDrifts[2].record_sha256);
  t("this week: expected_after covers all three drifted surfaces", r.proposal && ["health.gate_commit", "agent-card.signature", "well-known.openai-apps-challenge"].every((k) => k in r.proposal.expected_after));
  t("this week: expected canonical carried from the drift's expected", r.proposal && r.proposal.expected_after["agent-card.signature"].canonical_sha256 === "45419922149ba1763119d746d19867e2e114d20ab067ff26e11b560b1636db51");
  t("this week: needs human (redeploy touches deploy)", r.needs_human === true);
  const chain = await verifyChain([...weekDrifts, r.proposal]);
  t("this week: drifts + agent proposal verify as an incomplete segment", chain.ok && chain.segment.complete === false, JSON.stringify(chain.refusals));
  t("this week: the proposal itself verifies", (await verifyRecord(r.proposal)).ok);
}
// 2. 署名だけ
{
  const sig = await d("agent-card.signature", "card_body_signature_mismatch", { verified: "false" }, { verified: "true" });
  const pinned = await ok("health.gate_commit", { gate_commit: "abc" });
  const a = await diagnose([pinned, sig], { sourceVerifies: false });
  t("signature only, source does not verify: resign_agent_card", a.proposal && a.proposal.primitive === "resign_agent_card" && a.rule === "R3_signature_only");
  const b = await diagnose([pinned, sig], { sourceVerifies: true });
  t("signature only, source verifies, pinned: no proposal, human", b.proposal === null && b.needs_human === true && /cannot explain/.test(b.reason));
  const c = await diagnose([pinned, sig]);
  t("signature only, unknown source state: no proposal, asks for verify.mjs", c.proposal === null && c.needs_human === true && /verify\.mjs/.test(c.reason));
}
// 3. challenge だけ、baseline あり
{
  const ch = await d("well-known.openai-apps-challenge", "public_value_unset", { configured: "false" }, { configured: "true" });
  const pinned = await ok("health.gate_commit", { gate_commit: "abc" });
  const base = [await ok("well-known.openai-apps-challenge", { configured: "true", value: "PUBLICVALUE", sha256: "ab".repeat(32) })];
  const r = await diagnose([pinned, ch], { baseline: base });
  t("challenge only with baseline: redeploy_pinned via R4", r.proposal && r.proposal.primitive === "redeploy_pinned" && r.rule === "R4_challenge_unset");
  t("challenge only with baseline: diagnosis cites the baseline record", r.proposal && /baseline record/.test(r.proposal.diagnosis));
  t("challenge only with baseline: expected_after carries the baseline sha256", r.proposal && r.proposal.expected_after["well-known.openai-apps-challenge"].sha256 === "ab".repeat(32));
  const r2 = await diagnose([pinned, ch]);
  t("challenge only without baseline: still redeploy_pinned, says recover from issuer", r2.proposal && r2.proposal.primitive === "redeploy_pinned" && /issuer/.test(r2.proposal.diagnosis));
}
// 4. 落ちとる
{
  const errs = await Promise.all(["health.gate_commit", "agent-card.signature", "well-known.jwks"].map((s) => d(s, "endpoint_error", { error: "x" }, {})));
  const r = await diagnose(errs);
  t("three endpoint errors: quarantine_endpoint via R0, auto-approvable", r.proposal && r.proposal.primitive === "quarantine_endpoint" && r.rule === "R0_contain_on_outage" && r.needs_human === false);
  const one = await diagnose([errs[0]]);
  t("one endpoint error alone: no rule, human", one.proposal === null && one.needs_human === true);
}
// 5. 他の規則
{
  const r6 = await diagnose([await d("well-known.jwks", "jwks_missing", { kids: "" }, { present: "true" })]);
  t("jwks missing: quarantine via R6, rotate_credential rejected", r6.proposal && r6.proposal.primitive === "quarantine_endpoint" && r6.proposal.rejected[0].primitive === "rotate_credential");
  const r5 = await diagnose([await ok("health.gate_commit"), await d("ext.conduct-v1.spec", "spec_drift", { served_sha256: "a", repo_sha256: "b" }, { equals_repo: "true" })]);
  t("spec drift, pinned: redeploy_pinned via R5", r5.proposal && r5.proposal.primitive === "redeploy_pinned" && r5.rule === "R5_spec_drift");
  const r2 = await diagnose([await d("health.gate_commit", "commit_mismatch", { gate_commit: "111111111111" }, { gate_commit: "222222222222" })]);
  t("commit mismatch: redeploy_pinned via R2 with the expected commit", r2.proposal && r2.rule === "R2_commit_mismatch" && r2.proposal.expected_after["health.gate_commit"].gate_commit === "222222222222");
  const none = await diagnose([await ok("health.gate_commit"), await ok("well-known.jwks")]);
  t("no drift: no proposal, no human", none.proposal === null && none.needs_human === false);
  const unk = await diagnose([await d("keys.witness", "endpoint_error", { error: "500" }, {}), await d("something.new", "weird_kind", {}, {})]);
  t("unknown kind: no proposal, human, names the surfaces", unk.proposal === null && unk.needs_human === true && /something\.new\(weird_kind\)/.test(unk.reason));
}
// 6. baseline の所見
{
  const nowK = await ok("keys.witness", { status: "200", present: "true", key_sha256: "new" });
  const base = [await ok("keys.witness", { status: "200", present: "true", key_sha256: "old" })];
  const r = await diagnose([nowK], { baseline: base });
  t("key changed vs baseline with no drift: finding key_changed, human", r.proposal === null && r.needs_human === true && r.findings.some((f) => f.code === "key_changed"));
  const f = compareBaseline([await ok("well-known.jwks", { kids: "a", thumbprints: { a: "1" } })], [await ok("well-known.jwks", { kids: "a", thumbprints: { a: "2" } })]);
  t("jwks thumbprint changed vs baseline: finding jwks_changed", f.some((x) => x.code === "jwks_changed"));
}
// 7. 表そのものの健全性
{
  t("every rule id is unique", new Set(RULES.map((r) => r.id)).size === RULES.length);
  t("R0 (containment) is first: stop before diagnosing", RULES[0].id === "R0_contain_on_outage");
  t("every primitive the catalog names has an approval level", Object.values(PRIMITIVES).every((p) => ["auto", "human"].includes(p.approval)));
}

console.log(out.join("\n"));
console.log("=== " + pass + " / " + (pass + fail) + " 合格 (shield-agent: 今週の事故 + 規則 " + RULES.length + " 本) ===");
if (fail) process.exit(1);
