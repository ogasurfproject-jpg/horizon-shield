// RUN_ALL: library  Shield エージェント = Recovery Agent (設計書 4.2)。採点は shield_agent_test.mjs
//
// drift-record を読んで、切り分けて、カタログから 1 つだけ提案する。実行せん。鍵に触らん。deploy に触らん。
//
//   node shield_agent.mjs drift.jsonl [--baseline baseline.jsonl] [--source-verifies true|false] [--llm] [--llm-second-opinion] [--context notes.txt] [--out proposal.json]
//
// 頭は二段や。規則の表 (RULES) が先、規則に無い組み合わせだけ LLM (shield_llm.mjs) に仮説を書かせる。
// --llm-second-opinion を付けると、規則が答えた時もモデルに聞いて、同じ物を選んだかを横に書く (規則の答えは動かさん)。
//
// 頭は規則の表 (RULES) や。LLM やない。同じ入力なら同じ提案が出る、誰でも再計算できる。
// 提案は seal 済みの nenrin-repair-proposal-v1。drift_sha256 に読んだ drift の hash、prev に最後の drift の hash。
// recovery_verify.verifyChain にそのまま通る (区間: drift+ → proposal)。
//
// 迷ったら提案せん。needs_human: true と「何が足りんか」を返す (設計書 2 節: 迷ったら止めて人を呼ぶ)。
// 確信して提案するのは、Class 1 の決定可能な組み合わせだけ。表に無い drift は人の仕事で、表は ADR で育つ。
//
// 今週の事故 (unpinned + 署名不一致 + challenge 消失) を食わせると R1 が当たり、resign_agent_card を却下して
// redeploy_pinned を出す。外部証人の「署名し直せ」より一段深い所で答える。それがこの層の存在理由や。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { seal, verifyRecord } from "./recovery_verify.mjs";
import { SCHEMAS, PRIMITIVES } from "./recovery_schema.mjs";
import { llmPropose } from "./shield_llm.mjs";

export const AGENT_VERSION = "0.1.0";
const WITNESS = { name: "shield-agent", vantage: "rule table v" + AGENT_VERSION + "; no network; reads drift records and an optional baseline only" };
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export function parseJsonl(text) { return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)); }

function index(records) {
  const bySurface = {}; for (const r of records) bySurface[r.surface] = r;
  return { bySurface, drifted: records.filter((r) => r.drift === true) };
}
const kindOf = (ix, s) => ix.bySurface[s] && ix.bySurface[s].drift === true ? ix.bySurface[s].kind : null;
const short = (h) => String(h || "").slice(0, 12);

// baseline との比較で出る所見。drift:false の記録でも、鍵が変わっとったら言う。提案はせん、人を呼ぶ。
export function compareBaseline(records, baseline) {
  const findings = [];
  if (!baseline) return findings;
  const b = {}; for (const r of baseline) b[r.surface] = r;
  for (const r of records) {
    const p = b[r.surface]; if (!p) continue;
    const o = r.observed || {}, q = p.observed || {};
    if (r.surface === "well-known.jwks" && o.kids !== undefined && q.kids !== undefined && (o.kids !== q.kids || JSON.stringify(o.thumbprints) !== JSON.stringify(q.thumbprints)))
      findings.push({ code: "jwks_changed", surface: r.surface, why: "kids or thumbprints differ from baseline " + short(p.record_sha256) });
    if ((r.surface === "keys.agreement" || r.surface === "keys.witness") && o.key_sha256 !== q.key_sha256)
      findings.push({ code: "key_changed", surface: r.surface, why: "key_sha256 differs from baseline " + short(p.record_sha256) + " (a rotation or an incident; a human decides which)" });
    if (r.surface === "well-known.openai-apps-challenge" && o.configured === "true" && q.configured === "true" && o.sha256 !== q.sha256)
      findings.push({ code: "challenge_changed", surface: r.surface, why: "challenge value differs from baseline " + short(p.record_sha256) });
  }
  return findings;
}

// 規則の表。上から順、最初に当たった物。
// when(ix, ctx) -> false | { needs_human, reason } | { primitive, diagnosis, rejected, expected_after, rollback, establishes, does_not_establish }
export const RULES = [
  { id: "R0_contain_on_outage", when(ix) {
      const errs = ix.drifted.filter((r) => r.kind === "endpoint_error");
      if (errs.length < 3) return false;
      return { primitive: "quarantine_endpoint",
        diagnosis: errs.length + " of " + Object.keys(ix.bySurface).length + " surfaces did not answer (" + errs.map((r) => r.surface).join(", ") + "). That is an outage or a partition, not a content drift. Contain first; diagnose when it answers.",
        rejected: [{ primitive: "redeploy_pinned", why: "deploying into an endpoint that does not answer proves nothing and can bury the cause" }],
        expected_after: { registry: { status: "quarantined" } },
        rollback: "lift the quarantine (recorded) once the endpoint answers and a fresh witness run shows 0 drift",
        establishes: ["the endpoint failed to answer on the listed surfaces at the witness's recorded_at"],
        does_not_establish: ["why it does not answer", "that any content drifted"] };
  } },
  { id: "R1_unpinned_deploy", when(ix) {
      if (kindOf(ix, "health.gate_commit") !== "unpinned_deploy") return false;
      const h = ix.bySurface["health.gate_commit"], sig = ix.bySurface["agent-card.signature"];
      const others = ix.drifted.filter((r) => r.surface !== "health.gate_commit").map((r) => r.surface + "(" + r.kind + ")");
      const expected_after = { "health.gate_commit": { pinned: "true", ...(h.expected && h.expected.gate_commit ? { gate_commit: h.expected.gate_commit } : {}) } };
      if (kindOf(ix, "agent-card.signature")) expected_after["agent-card.signature"] = { verified: "true", ...(sig.expected && sig.expected.canonical_sha256 ? { canonical_sha256: sig.expected.canonical_sha256 } : {}) };
      if (kindOf(ix, "well-known.openai-apps-challenge")) expected_after["well-known.openai-apps-challenge"] = { configured: "true" };
      if (kindOf(ix, "ext.conduct-v1.spec")) expected_after["ext.conduct-v1.spec"] = { served: "true", equals_repo: "true" };
      return { primitive: "redeploy_pinned",
        diagnosis: "gate_commit is unpinned: the live build was shipped with a raw deploy that bypassed deploy_gate.sh. Every other drifted surface here is deploy-derived" + (others.length ? " (" + others.join(", ") + ")" : "") + ", so one cause explains all of them. Redeploying the committed source through the guard restores the signed card body, the pinned commit and the plain vars a raw deploy drops.",
        rejected: [
          { primitive: "resign_agent_card", why: "the signature is a property of the committed source, not of the live build; a pinned redeploy restores that source. If the signature still fails after the redeploy, that is a different fault and the next proposal is resign_agent_card" },
          { primitive: "quarantine_endpoint", why: "verdicts are unaffected by attribution surfaces; the operator can repair without stopping the gate" }],
        expected_after,
        rollback: "redeploy the previous pinned Cloudflare version through deploy_gate.sh (wrangler versions list; the newest version whose GATE_COMMIT is a sha)",
        establishes: ["from the drift records alone, a raw unpinned deploy is the single cause consistent with every drifted surface listed"],
        does_not_establish: ["who ran the raw deploy", "that no second cause exists", "that the committed source verifies (run a2a-card-sign/verify.mjs against source before executing)"] };
  } },
  { id: "R2_commit_mismatch", when(ix) {
      if (kindOf(ix, "health.gate_commit") !== "commit_mismatch") return false;
      const o = ix.bySurface["health.gate_commit"];
      return { primitive: "redeploy_pinned",
        diagnosis: "gate_commit is pinned to " + o.observed.gate_commit + " but " + o.expected.gate_commit + " was expected: the live build is a different pinned commit than the one intended. Redeploy the intended commit through the guard.",
        rejected: [{ primitive: "resign_agent_card", why: "a wrong commit is a deploy fact, not a signature fact" }],
        expected_after: { "health.gate_commit": { pinned: "true", gate_commit: o.expected.gate_commit } },
        rollback: "redeploy " + o.observed.gate_commit + " through deploy_gate.sh",
        establishes: ["the live pinned commit differs from the expected one"],
        does_not_establish: ["which of the two the operator wants (the expected value came from the witness's arguments)"] };
  } },
  { id: "R3_signature_only", when(ix, ctx) {
      if (kindOf(ix, "agent-card.signature") !== "card_body_signature_mismatch") return false;
      if (kindOf(ix, "health.gate_commit")) return false;
      if (ctx.sourceVerifies === false) return { primitive: "resign_agent_card",
        diagnosis: "the live card does not verify and the committed source does not verify either (--source-verifies false): the card body was edited after it was signed. Re-sign the current body with a2a-card-sign, then redeploy through the guard.",
        rejected: [{ primitive: "redeploy_pinned", why: "redeploying a body the signature was not made over serves the same mismatch again" }],
        expected_after: { "agent-card.signature": { verified: "true" } },
        rollback: "restore the previous CARD_SIGNATURE constant from git and redeploy",
        establishes: ["both the live card and the committed source fail verification, so the fault is in the source, not the deploy"],
        does_not_establish: ["which edit broke it", "whether the signer's canonical form is wrong (if a fresh re-sign still fails, that is the next hypothesis)"] };
      return { needs_human: true, reason: ctx.sourceVerifies === true
        ? "the live card fails but the committed source verifies and gate_commit is pinned as expected: the records cannot explain this (a pinned deploy of a verifying source should serve a verifying card). Compare the live card bytes with the source render by hand before touching anything."
        : "signature drift alone cannot tell deploy drift from a signer fault. Run workers/a2a-card-sign/verify.mjs against the committed source and pass --source-verifies true or false." };
  } },
  { id: "R4_challenge_unset", when(ix, ctx) {
      if (kindOf(ix, "well-known.openai-apps-challenge") !== "public_value_unset") return false;
      if (kindOf(ix, "health.gate_commit")) return false;
      const b = ctx.baselineBySurface && ctx.baselineBySurface["well-known.openai-apps-challenge"];
      const hasValue = !!(b && b.observed && b.observed.configured === "true" && b.observed.value);
      return { primitive: "redeploy_pinned",
        diagnosis: "the OpenAI apps challenge is unset while the commit is pinned: the last deploy passed no value. deploy_gate.sh refuses to deploy without one, so supply the value and redeploy through the guard." + (hasValue ? " The last witnessed value is in baseline record " + short(b.record_sha256) + " (public by design), so no issuer round-trip is needed." : " No baseline holds the value; recover it from the issuer or from a pinned Cloudflare version's plain_text binding."),
        rejected: [{ primitive: "revert_to_last_witnessed_good", why: "on this gate the value is delivered only by the guarded deploy, so the revert is the redeploy" }],
        expected_after: { "well-known.openai-apps-challenge": { configured: "true", ...(hasValue ? { sha256: b.observed.sha256 } : {}) } },
        rollback: "none needed: a served value is strictly better than none; if the issuer rejects it, replace and redeploy",
        establishes: ["the challenge surface is unset on a pinned build"],
        does_not_establish: ["that the issuer still expects the baseline value"] };
  } },
  { id: "R5_spec_drift", when(ix) {
      const k = kindOf(ix, "ext.conduct-v1.spec"); if (!k || k === "endpoint_error") return false;
      if (kindOf(ix, "health.gate_commit")) return false;
      return { primitive: "redeploy_pinned",
        diagnosis: k === "spec_missing" ? "the extension spec is not served: redeploy the committed source through the guard." : "the served spec bytes differ from the repository copy: the repository moved after the last deploy. Redeploy through the guard so served and repository bytes agree.",
        rejected: [],
        expected_after: { "ext.conduct-v1.spec": { served: "true", equals_repo: "true" } },
        rollback: "redeploy the previous pinned version",
        establishes: ["served and repository spec bytes differ"],
        does_not_establish: ["which copy the operator wants (the repository is taken as the intent)"] };
  } },
  { id: "R6_jwks_missing", when(ix) {
      if (kindOf(ix, "well-known.jwks") !== "jwks_missing") return false;
      return { primitive: "quarantine_endpoint",
        diagnosis: "the JWKS serves no keys: every card signature is unverifiable and attribution is gone. Contain and page; an empty key set can be a bad deploy or a key incident, and only a human can tell which.",
        rejected: [{ primitive: "rotate_credential", why: "rotation before diagnosis destroys the evidence of whether the key was compromised" }],
        expected_after: { registry: { status: "quarantined" } },
        rollback: "lift the quarantine once the JWKS serves the expected kid and a fresh witness run shows 0 drift",
        establishes: ["the JWKS carried no keys at the witness's recorded_at"],
        does_not_establish: ["why"] };
  } },
];

export async function diagnose(records, { baseline = null, sourceVerifies = undefined, llm = null, llmSecondOpinion = false, context = "", model } = {}) {
  const ix = index(records);
  const findings = compareBaseline(records, baseline);
  const ctx = { sourceVerifies, baselineBySurface: baseline ? Object.fromEntries(baseline.map((r) => [r.surface, r])) : null };
  if (ix.drifted.length === 0) return { proposal: null, rule: null, mode: "none", needs_human: findings.length > 0, reason: findings.length ? "no drift, but the baseline comparison raised findings" : "no drift", findings };
  for (const rule of RULES) {
    const hit = rule.when(ix, ctx);
    if (!hit) continue;
    if (hit.needs_human) return { proposal: null, rule: rule.id, mode: "none", needs_human: true, reason: hit.reason, findings };
    if (!(hit.primitive in PRIMITIVES)) throw new Error("rule " + rule.id + " proposed a primitive outside the catalog: " + hit.primitive);
    const proposal = await seal({
      schema: SCHEMAS.proposal, recorded_at: now(), witness: WITNESS,
      prev: ix.drifted[ix.drifted.length - 1].record_sha256, drift_sha256: ix.drifted.map((r) => r.record_sha256),
      primitive: hit.primitive, approval: PRIMITIVES[hit.primitive].approval,
      diagnosis: "[" + rule.id + "] " + hit.diagnosis, rejected: hit.rejected, expected_after: hit.expected_after, rollback: hit.rollback,
      establishes: hit.establishes, does_not_establish: hit.does_not_establish.concat(["that the repair has been authorized or executed"]),
    });
    const v = await verifyRecord(proposal);
    if (!v.ok) throw new Error("the agent produced a proposal that does not verify: " + JSON.stringify(v.refusals));
    const human = PRIMITIVES[hit.primitive].approval === "human";
    const result = { proposal, rule: rule.id, mode: "rule", needs_human: human || findings.length > 0, reason: human ? "primitive requires human authorization" : "auto-approvable containment", findings };
    // 第二意見: 規則の答えは動かさん。モデルが同じ物を選んだかどうかを横に書く。違ったら人が読む。
    if (llm && llmSecondOpinion) {
      const so = await llmPropose(records, { baseline, context, llm, model });
      result.second_opinion = so.proposal
        ? { primitive: so.proposal.primitive, agrees: so.proposal.primitive === proposal.primitive, diagnosis: so.proposal.diagnosis, confidence: so.confidence, model: so.model, prompt_sha256: so.prompt_sha256 }
        : { primitive: null, agrees: null, reason: so.reason, model: so.model || null, prompt_sha256: so.prompt_sha256 || null };
      if (result.second_opinion.agrees === false) result.needs_human = true;
    }
    return result;
  }
  // 規則に無い組み合わせ。ここが LLM の出番や。無ければ人。
  if (llm) {
    const lo = await llmPropose(records, { baseline, context, llm, model });
    return { proposal: lo.proposal, rule: null, mode: lo.proposal ? "llm" : "none", needs_human: true, reason: lo.reason, findings, model: lo.model || null, prompt_sha256: lo.prompt_sha256 || null, confidence: lo.confidence || null };
  }
  return { proposal: null, rule: null, mode: "none", needs_human: true, reason: "drift present but no rule matches: " + ix.drifted.map((r) => r.surface + "(" + r.kind + ")").join(", ") + ". A human diagnoses, or run with --llm; the rule table grows by ADR.", findings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  const args = Object.fromEntries(process.argv.slice(3).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
  if (!file || file.startsWith("--")) { console.error("usage: node shield_agent.mjs drift.jsonl [--baseline baseline.jsonl] [--source-verifies true|false] [--llm] [--llm-second-opinion] [--llm-model m] [--context notes.txt] [--out proposal.json]"); process.exit(2); }
  const records = parseJsonl(readFileSync(file, "utf8"));
  const baseline = args.baseline ? parseJsonl(readFileSync(args.baseline, "utf8")) : null;
  const sv = args["source-verifies"] === "true" ? true : args["source-verifies"] === "false" ? false : undefined;
  const useLlm = process.argv.includes("--llm") || process.argv.includes("--llm-second-opinion");
  const { callClaude } = await import("./shield_llm.mjs");
  const context = args.context ? readFileSync(args.context, "utf8") : "";
  const out = await diagnose(records, { baseline, sourceVerifies: sv, llm: useLlm ? callClaude : null, llmSecondOpinion: process.argv.includes("--llm-second-opinion"), context, model: args["llm-model"] });
  const text = JSON.stringify(out, null, 2) + "\n";
  if (args.out) writeFileSync(args.out, text); else process.stdout.write(text);
  console.error("shield-agent: " + (out.proposal ? "proposal " + out.proposal.primitive + " [" + out.rule + "]" : "no proposal") + (out.needs_human ? "; needs human: " + out.reason : "") + (out.findings.length ? "; findings: " + out.findings.map((f) => f.code).join(",") : ""));
  process.exit(out.proposal ? 0 : out.needs_human ? 2 : 0);
}
