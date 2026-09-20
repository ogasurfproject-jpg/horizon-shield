// RUN_ALL: library  Shield エージェントの LLM 側。規則に無い drift の組み合わせに、仮説を書かせる。採点は shield_llm_test.mjs
//
// 立場 (設計書 4.2 と 2 節の適用):
//   規則が先。決定可能な物は規則が答える (同じ入力で同じ答え、無料、幻覚無し)。
//   LLM は規則が無い所だけ。あるいは --llm-second-opinion で規則の答えに対する第二意見。
//   LLM の出力は信用せん。カタログ外なら捨てる。証拠 hash が入力に無ければ捨てる。数が混じれば捨てる。JSON やなければ捨てる。
//   通った物だけ seal して提案にする。witness は shield-agent-llm、model と prompt_sha256 を記録に焼く (何を見て言うたかが残る)。
//   LLM の提案は必ず人間ゲート (approval: human)。隔離であっても自動承認せん。
//   does_not_establish に「言語モデルが書いた仮説であって所見やない」を必ず足す。
//
// 呼び方は IASF と同じ: Anthropic Messages API、ANTHROPIC_API_KEY は env から、鍵はこの file に書かん。
//   export ANTHROPIC_API_KEY=...   (read -rs で打つ。履歴に残さん)
//   SHIELD_LLM_MODEL=claude-haiku-4-5-20251001 (既定)
import { seal, verifyRecord, sha256Hex } from "./recovery_verify.mjs";
import { SCHEMAS, PRIMITIVES, hasNumber } from "./recovery_schema.mjs";

export const LLM_VERSION = "0.1.0";
export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export function catalogText() {
  return Object.entries(PRIMITIVES).map(([k, v]) => "  " + k + " (approval: " + v.approval + ", reversible: " + v.reversible + ")").join("\n");
}

export function buildPrompt(records, { baseline = null, context = "" } = {}) {
  const drifted = records.filter((r) => r.drift === true);
  const system = [
    "You are the Recovery Agent (Shield agent) of HORIZON SHIELD's Proof-of-Recovery layer.",
    "You read drift records written by an independent witness and propose at most ONE repair from a closed catalog. You never execute anything.",
    "",
    "Output rules:",
    "1. Output ONLY one JSON object. No prose before or after it. No markdown fences.",
    "2. \"primitive\" MUST be exactly one of the catalog names below, or the string \"none\" when you cannot propose responsibly.",
    "3. \"evidence_sha256\" MUST list the record_sha256 values of the drift records your diagnosis relies on: at least one, and only values present in the input.",
    "4. Every value is a string, an array of strings, or an object whose values are strings or such objects. NO numbers, NO booleans, NO null.",
    "5. \"diagnosis\": the single cause most consistent with ALL cited drifts, and why the alternatives are less consistent.",
    "6. \"rejected\": other catalog primitives you considered, each as {\"primitive\": ..., \"why\": ...}.",
    "7. \"expected_after\": for each drifted surface, the state after the repair, as strings.",
    "8. \"rollback\": how to undo the repair.",
    "9. \"establishes\": what the cited records prove. \"does_not_establish\": what remains unknown.",
    "10. If the records are consistent with a security incident (a key changed, a credential exposed, an unexplained code change), prefer quarantine_endpoint and say why.",
    "11. When uncertain, choose \"none\" and put in \"reason_if_none\" what input would decide it. Prefer the least-privileged primitive that reaches expected_after.",
    "12. \"confidence\": one of \"high\", \"medium\", \"low\".",
    "",
    "Catalog:",
    catalogText(),
    "",
    "Shape:",
    "{\"primitive\":\"...\",\"diagnosis\":\"...\",\"rejected\":[{\"primitive\":\"...\",\"why\":\"...\"}],\"expected_after\":{\"<surface>\":{\"<key>\":\"<value>\"}},\"rollback\":\"...\",\"establishes\":[\"...\"],\"does_not_establish\":[\"...\"],\"evidence_sha256\":[\"...\"],\"confidence\":\"...\",\"reason_if_none\":\"...\"}",
  ].join("\n");
  const user = [
    "Drift records from one witness run (JSON, one per line). drift:true records are the ones to explain; drift:false records are the surfaces that looked fine:",
    ...records.map((r) => JSON.stringify(r)),
    "",
    "Baseline (the previous witness run; empty if none):",
    ...(baseline && baseline.length ? baseline.map((r) => JSON.stringify(r)) : ["(none)"]),
    "",
    "Operator context (git log, deploy notes; empty if none):",
    context && context.trim() ? context.trim() : "(none)",
    "",
    "Drifted surfaces to explain: " + (drifted.length ? drifted.map((r) => r.surface + " (" + r.kind + ")").join(", ") : "(none)"),
  ].join("\n");
  return { system, user };
}

// IASF と同じ呼び方。鍵は env、file には書かん。temperature 0 で、同じ入力にできるだけ同じ答えを求める。
export async function callClaude({ system, user }, { model = process.env.SHIELD_LLM_MODEL || DEFAULT_MODEL, maxTokens = 1500 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set. This file never contains a key.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, system, messages: [{ role: "user", content: user }] }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error("anthropic http " + res.status + ": " + (await res.text()).slice(0, 300));
  const j = await res.json();
  const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  return { text, model: j.model || model };
}

// 出力の受け入れ検査。落ちたら理由を返す。通れば整形した仮説。
export function parseHypothesis(text, driftHashes) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return { ok: false, why: "no JSON object in the model output" };
  let h;
  try { h = JSON.parse(text.slice(a, b + 1)); } catch (e) { return { ok: false, why: "model output is not valid JSON: " + e.message }; }
  if (!h || typeof h !== "object" || Array.isArray(h)) return { ok: false, why: "model output is not an object" };
  if (hasNumber(h)) return { ok: false, why: "model output carries a JSON number (v0 records carry none)" };
  const isStr = (v) => typeof v === "string" && v.length > 0;
  const isStrArr = (v) => Array.isArray(v) && v.length > 0 && v.every(isStr);
  if (h.primitive === "none") return { ok: true, none: true, reason: isStr(h.reason_if_none) ? h.reason_if_none : "the model declined without a reason", confidence: h.confidence };
  if (!isStr(h.primitive) || !(h.primitive in PRIMITIVES)) return { ok: false, why: "primitive outside the catalog: " + JSON.stringify(h.primitive) };
  if (!isStrArr(h.evidence_sha256)) return { ok: false, why: "evidence_sha256 missing or empty" };
  const unknown = h.evidence_sha256.filter((x) => !driftHashes.includes(x));
  if (unknown.length) return { ok: false, why: "evidence cites hashes not in the input: " + unknown.map((x) => x.slice(0, 12)).join(",") };
  if (!isStr(h.diagnosis)) return { ok: false, why: "diagnosis missing" };
  if (!h.expected_after || typeof h.expected_after !== "object" || Array.isArray(h.expected_after) || !Object.keys(h.expected_after).length) return { ok: false, why: "expected_after missing or empty" };
  if (!isStr(h.rollback)) return { ok: false, why: "rollback missing" };
  if (!isStrArr(h.establishes) || !isStrArr(h.does_not_establish)) return { ok: false, why: "establishes / does_not_establish missing or empty" };
  const rejected = Array.isArray(h.rejected) ? h.rejected.filter((x) => x && isStr(x.primitive) && isStr(x.why)) : [];
  return { ok: true, none: false, primitive: h.primitive, diagnosis: h.diagnosis, rejected, expected_after: h.expected_after, rollback: h.rollback,
    establishes: h.establishes, does_not_establish: h.does_not_establish, evidence: h.evidence_sha256, confidence: isStr(h.confidence) ? h.confidence : "unstated" };
}

// llm は (prompt) -> { text, model } の非同期関数。試験では差し替える。既定は callClaude。
export async function llmPropose(records, { baseline = null, context = "", llm = callClaude, model } = {}) {
  const drifted = records.filter((r) => r.drift === true);
  if (drifted.length === 0) return { proposal: null, needs_human: false, reason: "no drift; nothing to ask the model" };
  const prompt = buildPrompt(records, { baseline, context });
  const prompt_sha256 = await sha256Hex(prompt.system + "\n\n" + prompt.user);
  let out;
  try { out = await llm(prompt, { model }); } catch (e) { return { proposal: null, needs_human: true, reason: "llm call failed: " + (e && e.message || e), prompt_sha256 }; }
  const hyp = parseHypothesis(String(out.text || ""), drifted.map((r) => r.record_sha256));
  if (!hyp.ok) return { proposal: null, needs_human: true, reason: "llm output rejected: " + hyp.why, prompt_sha256, model: out.model, raw: String(out.text || "").slice(0, 2000) };
  if (hyp.none) return { proposal: null, needs_human: true, reason: "the model declined to propose: " + hyp.reason, prompt_sha256, model: out.model, confidence: hyp.confidence };
  const proposal = await seal({
    schema: SCHEMAS.proposal, recorded_at: now(),
    witness: { name: "shield-agent-llm", vantage: String(out.model || model || DEFAULT_MODEL) + "; temperature 0; prompt_sha256 " + prompt_sha256 },
    prev: drifted[drifted.length - 1].record_sha256, drift_sha256: drifted.map((r) => r.record_sha256),
    primitive: hyp.primitive, approval: "human", model: String(out.model || model || DEFAULT_MODEL), prompt_sha256, llm_confidence: hyp.confidence, evidence_sha256: hyp.evidence,
    diagnosis: "[llm] " + hyp.diagnosis, rejected: hyp.rejected, expected_after: hyp.expected_after, rollback: hyp.rollback,
    establishes: hyp.establishes,
    does_not_establish: hyp.does_not_establish.concat(["this diagnosis was produced by a language model: it is a hypothesis, not a finding; a human authorizes or refuses it", "that the repair has been authorized or executed"]),
  });
  const v = await verifyRecord(proposal);
  if (!v.ok) return { proposal: null, needs_human: true, reason: "llm proposal did not verify: " + JSON.stringify(v.refusals), prompt_sha256, model: out.model };
  return { proposal, needs_human: true, reason: "language-model proposal; always requires human authorization", prompt_sha256, model: out.model, confidence: hyp.confidence };
}
