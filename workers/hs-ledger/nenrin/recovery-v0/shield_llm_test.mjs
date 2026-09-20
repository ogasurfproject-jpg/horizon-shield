// RUN_ALL: suite
// LLM 側の採点。本物のモデルは呼ばん (network も鍵も要らん)。差し替えの llm で「受け入れ検査が何を通し、何を捨てるか」を見る。
// 緑の意味: モデルが何を返しても、カタログ外・証拠無し・数混入・JSON 以外は提案にならん、そして通った物は連鎖検証に乗る。それだけ。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { diagnose } from "./shield_agent.mjs";
import { llmPropose, buildPrompt, parseHypothesis, catalogText } from "./shield_llm.mjs";
import { seal, verifyChain, verifyRecord } from "./recovery_verify.mjs";
import { SCHEMAS, PRIMITIVES } from "./recovery_schema.mjs";
import { FIXTURE_FILE } from "./recovery_fixture_build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0; const out = [];
const t = (name, ok, detail) => { ok ? pass++ : fail++; out.push((ok ? "  ok   " : "  FAIL ") + name + (ok || !detail ? "" : "  <- " + detail)); };
const fx = JSON.parse(readFileSync(path.join(HERE, FIXTURE_FILE), "utf8"));
const week = fx.slice(0, 3);
async function d(surface, kind, observed = {}, expected = {}) {
  return seal({ schema: SCHEMAS.drift, recorded_at: "2026-09-20T09:00:00Z", witness: { name: "t", vantage: "t" }, prev: null, endpoint: "https://x.example",
    surface, drift: !!kind, ...(kind ? { kind } : {}), observed, expected, establishes: ["t"], does_not_establish: ["t"] });
}
// 規則に無い組み合わせ (表の R0〜R6 のどれにも当たらん)
const novel = [await d("keys.witness", "endpoint_error", { error: "500" }, {}), await d("something.new", "weird_kind", { x: "y" }, { x: "z" })];
const hashes = novel.map((r) => r.record_sha256);
const stub = (obj) => async () => ({ text: typeof obj === "string" ? obj : JSON.stringify(obj), model: "stub-model" });
const good = { primitive: "quarantine_endpoint", diagnosis: "two unrelated surfaces failed in one run; contain until it answers", rejected: [{ primitive: "redeploy_pinned", why: "no evidence the build changed" }],
  expected_after: { "keys.witness": { status: "200" }, "something.new": { x: "z" } }, rollback: "lift the quarantine", establishes: ["both surfaces failed at recorded_at"], does_not_establish: ["why"], evidence_sha256: hashes, confidence: "medium" };

// 1. 通る仮説
{
  const r = await diagnose(novel, { llm: stub(good) });
  t("novel drift + valid model output: proposal in llm mode", r.mode === "llm" && r.proposal && r.proposal.primitive === "quarantine_endpoint", r.reason);
  t("llm proposal: witness is shield-agent-llm and names the model", r.proposal && r.proposal.witness.name === "shield-agent-llm" && /stub-model/.test(r.proposal.witness.vantage));
  t("llm proposal: approval is human even for containment", r.proposal && r.proposal.approval === "human" && r.needs_human === true);
  t("llm proposal: prompt_sha256 is 64 hex and matches the result", r.proposal && /^[0-9a-f]{64}$/.test(r.proposal.prompt_sha256) && r.prompt_sha256 === r.proposal.prompt_sha256);
  t("llm proposal: does_not_establish carries the language-model disclaimer", r.proposal && r.proposal.does_not_establish.some((x) => /language model/.test(x)));
  t("llm proposal: diagnosis is tagged [llm]", r.proposal && r.proposal.diagnosis.startsWith("[llm] "));
  t("llm proposal: evidence hashes recorded", r.proposal && JSON.stringify(r.proposal.evidence_sha256) === JSON.stringify(hashes));
  t("llm proposal: verifies as a record", (await verifyRecord(r.proposal)).ok);
  const chain = await verifyChain([...novel, r.proposal]);
  t("llm proposal: drifts + proposal verify as an incomplete segment", chain.ok && chain.segment.complete === false, JSON.stringify(chain.refusals));
}
// 2. 捨てる物
{
  const bad1 = await diagnose(novel, { llm: stub({ ...good, primitive: "rm_rf_root" }) });
  t("primitive outside the catalog: rejected, human", bad1.proposal === null && bad1.needs_human && /outside the catalog/.test(bad1.reason));
  const bad2 = await diagnose(novel, { llm: stub("Sure! Here is my analysis: the deploy is broken.") });
  t("prose without JSON: rejected", bad2.proposal === null && /no JSON object/.test(bad2.reason));
  const bad3 = await diagnose(novel, { llm: stub({ ...good, evidence_sha256: ["0".repeat(64)] }) });
  t("evidence citing a hash not in the input: rejected", bad3.proposal === null && /not in the input/.test(bad3.reason));
  const bad4 = await diagnose(novel, { llm: stub({ ...good, expected_after: { "keys.witness": { retries: 3 } } }) });
  t("a JSON number in the output: rejected", bad4.proposal === null && /number/.test(bad4.reason));
  const bad5 = await diagnose(novel, { llm: stub({ ...good, evidence_sha256: [] }) });
  t("empty evidence: rejected", bad5.proposal === null && /evidence_sha256/.test(bad5.reason));
  const bad6 = await diagnose(novel, { llm: stub({ ...good, does_not_establish: [] }) });
  t("empty does_not_establish: rejected", bad6.proposal === null && /does_not_establish/.test(bad6.reason));
  const none = await diagnose(novel, { llm: stub({ primitive: "none", reason_if_none: "need the git log since the last pinned deploy", confidence: "low" }) });
  t("model declines with a reason: no proposal, reason surfaced", none.proposal === null && none.needs_human && /git log/.test(none.reason));
  const thrown = await diagnose(novel, { llm: async () => { throw new Error("anthropic http 401"); } });
  t("model call fails: no proposal, failure surfaced, nothing thrown", thrown.proposal === null && /llm call failed: anthropic http 401/.test(thrown.reason));
  const fenced = await diagnose(novel, { llm: stub("```json\n" + JSON.stringify(good) + "\n```") });
  t("markdown-fenced JSON: still parsed", fenced.proposal && fenced.proposal.primitive === "quarantine_endpoint");
}
// 3. 規則が先、LLM は後
{
  const r = await diagnose(week, { llm: stub({ ...good, primitive: "resign_agent_card", evidence_sha256: week.map((x) => x.record_sha256) }) });
  t("rule matches: model is not consulted, rule answer stands", r.mode === "rule" && r.rule === "R1_unpinned_deploy" && r.proposal.primitive === "redeploy_pinned" && r.second_opinion === undefined);
  const agree = await diagnose(week, { llm: stub({ ...good, primitive: "redeploy_pinned", evidence_sha256: week.map((x) => x.record_sha256) }), llmSecondOpinion: true });
  t("second opinion agreeing: recorded, rule answer unchanged", agree.mode === "rule" && agree.second_opinion && agree.second_opinion.agrees === true && agree.proposal.primitive === "redeploy_pinned");
  const dis = await diagnose(week, { llm: stub({ ...good, primitive: "resign_agent_card", evidence_sha256: week.map((x) => x.record_sha256) }), llmSecondOpinion: true });
  t("second opinion disagreeing: recorded, rule answer unchanged, human flagged", dis.mode === "rule" && dis.second_opinion.agrees === false && dis.proposal.primitive === "redeploy_pinned" && dis.needs_human === true);
  const noLlm = await diagnose(novel);
  t("novel drift without llm: no proposal, points at --llm", noLlm.mode === "none" && /--llm/.test(noLlm.reason));
}
// 4. prompt
{
  const p = buildPrompt(novel, { baseline: [], context: "git log: abc123 raw deploy" });
  t("prompt: catalog names are in the system text", Object.keys(PRIMITIVES).every((k) => p.system.includes(k)));
  t("prompt: JSON-only and no-numbers rules stated", /ONLY one JSON object/.test(p.system) && /NO numbers/.test(p.system));
  t("prompt: drift hashes and operator context are in the user text", hashes.every((h) => p.user.includes(h)) && /raw deploy/.test(p.user));
  t("prompt: catalogText lists approval levels", /approval: human/.test(catalogText()) && /approval: auto/.test(catalogText()));
  const ph = parseHypothesis(JSON.stringify({ primitive: "none", reason_if_none: "x" }), hashes);
  t("parseHypothesis: none is accepted with its reason", ph.ok && ph.none && ph.reason === "x");
  const nd = await llmPropose([await d("health.gate_commit", null, {}, {})], { llm: stub(good) });
  t("llmPropose with no drift: does not call the model", nd.proposal === null && /no drift/.test(nd.reason));
}
console.log(out.join("\n"));
console.log("=== " + pass + " / " + (pass + fail) + " 合格 (shield-llm: 受け入れ検査と二段の順番) ===");
if (fail) process.exit(1);
