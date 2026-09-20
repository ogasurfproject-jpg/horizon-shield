// RUN_ALL: library  今週の事故 (2026-09-19 から 09-20) を recovery-v0 の 7 記録に焼く。採点は recovery_verify_test.mjs
//
// これが Proof-of-Recovery の最初の一枚 (設計書 7 節)。手で観測した事故を、手で記録に落とす。
// hash と prev は必ずこのコードが計算する。人間が hex を打ち込んだ fixture は、一桁ずれても誰も気付かん。
//
//   node recovery_fixture_build.mjs            → recovery_fixture_20260920.json を書き直す
//
// 数は全部文字列 (v0 の約束、recovery_schema.mjs の頭)。
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { seal } from "./recovery_verify.mjs";
import { SCHEMAS } from "./recovery_schema.mjs";

export const FIXTURE_FILE = "recovery_fixture_20260920.json";
const ENDPOINT = "https://gate.horizonshield.dev";
const SIGNED_CANONICAL = "45419922149ba1763119d746d19867e2e114d20ab067ff26e11b560b1636db51";
const PINNED = "3213ffc53c8d";
const UNPINNED = "unpinned: this deployment did not inject a commit (deploy_gate.sh not used)";
const OPERATOR = { name: "operator-manual", vantage: "operator workstation and cloud sandbox; observations by hand, times to the minute" };

export const EXPECTED_AFTER = {
  "health.gate_commit": { gate_commit: PINNED, pinned: "true" },
  "agent-card.signature": { verified: "true", canonical_sha256: SIGNED_CANONICAL, kid: "hs-2026-09", alg: "ES256" },
  "well-known.openai-apps-challenge": { configured: "true" },
};

export async function buildFixture() {
  const driftA = await seal({
    schema: SCHEMAS.drift, recorded_at: "2026-09-20T00:05:00Z", witness: OPERATOR, prev: null,
    endpoint: ENDPOINT, surface: "health.gate_commit", drift: true, kind: "unpinned_deploy",
    observed: { gate_commit: UNPINNED, gate_version: "0.4.7" },
    expected: { pinned: "true", note: "deploy_gate.sh injects GATE_COMMIT; a raw wrangler deploy does not" },
    establishes: [
      "at recorded_at, GET /health on the endpoint returned gate_commit equal to the observed string",
      "the live build did not go through deploy_gate.sh, by the gate's own statement",
    ],
    does_not_establish: ["who ran the raw deploy", "what tree the raw deploy was made from", "whether any other surface drifted"],
  });
  const driftB = await seal({
    schema: SCHEMAS.drift, recorded_at: "2026-09-19T22:24:54Z", witness: OPERATOR, prev: null,
    endpoint: ENDPOINT, surface: "agent-card.signature", drift: true, kind: "card_body_signature_mismatch",
    source: { witness: "Agenstry", channel: "email", received_at: "2026-09-19T22:24:54Z", note: "external witness; verification re-run by hand from their production container" },
    observed: { verified: "false", kid: "hs-2026-09", alg: "ES256", canonicalisations_tried: "36", other_cards_verified_same_code: "61", their_reading: "signature predates one of 8 card edits in 7 days" },
    expected: { verified: "true", canonical_sha256: SIGNED_CANONICAL },
    establishes: [
      "an external witness reported that the signature under kid hs-2026-09 did not verify over the card body it fetched",
      "the same witness code verified 61 other signed cards, so the witness's verifier is not the failing part",
    ],
    does_not_establish: ["the cause of the mismatch (the witness's reading is a hypothesis, not a finding)", "that the signature or the signer is wrong"],
  });
  const driftC = await seal({
    schema: SCHEMAS.drift, recorded_at: "2026-09-20T01:10:00Z", witness: OPERATOR, prev: null,
    endpoint: ENDPOINT, surface: "well-known.openai-apps-challenge", drift: true, kind: "public_value_unset",
    observed: { status: "200", configured: "false", note: "This host has no OpenAI apps challenge token set. Nothing is being claimed here." },
    expected: { configured: "true", note: "the value is public by design; deploy_gate.sh passes it as a plain var on every guarded deploy" },
    establishes: [
      "at recorded_at the endpoint served no OpenAI apps challenge value",
      "no copy of the last good value existed on the operator's machine (~/.config/hs/ absent) and the key inventory recorded its location as unknown",
    ],
    does_not_establish: ["that OpenAI had already dropped the domain verification", "who removed the value"],
  });

  const proposal = await seal({
    schema: SCHEMAS.proposal, recorded_at: "2026-09-20T02:30:00Z", witness: { name: "recovery-agent-manual", vantage: "diagnosis done by hand from source, git history and the live /health" },
    prev: driftC.record_sha256, drift_sha256: [driftA.record_sha256, driftB.record_sha256, driftC.record_sha256],
    primitive: "redeploy_pinned",
    diagnosis: "Rendering the card from the committed source (HEAD 3213ffc5) and verifying it with the official verifier passes; its canonical sha256 equals the one baked at signing (edf783cf, 2026-09-11). ownAgentCard(origin) reads no env, so the served body is a function of origin alone. Therefore the live body can differ from the signed source only if the live build differs from source. /health reports gate_commit unpinned: the live build was shipped with a raw wrangler deploy that bypassed deploy_gate.sh. The same raw deploy dropped the OPENAI_APPS_CHALLENGE var. All three drifts share one cause. No re-sign is needed.",
    rejected: [
      { primitive: "resign_agent_card", why: "the committed source already verifies against the baked signature; re-signing changes nothing on the deploy side and would be the fix for a different fault" },
      { primitive: "quarantine_endpoint", why: "the gate's verdicts are unaffected; only attribution surfaces and the challenge drifted, and the operator is present" },
    ],
    expected_after: EXPECTED_AFTER,
    rollback: "redeploy Cloudflare version 46f571cf (GATE_COMMIT 4f3f6917181e, 2026-09-15) through deploy_gate.sh",
    establishes: ["from the cited drift records and the committed source, a raw unpinned deploy is the cause consistent with all three drifts", "redeploy_pinned reaches the stated expected_after if the cause is correct"],
    does_not_establish: ["that no other cause exists", "who ran the raw deploy", "that the repair has been authorized or executed"],
  });

  const authorization = await seal({
    schema: SCHEMAS.authorization, recorded_at: "2026-09-20T07:30:00Z", witness: { name: "policy-gate-manual", vantage: "operator decision in chat" },
    prev: proposal.record_sha256, proposal_sha256: proposal.record_sha256,
    decision: "approved", by: "operator (TOshi)", expires_at: "2026-09-20T12:00:00Z",
    establishes: ["the operator approved redeploy_pinned for this proposal before expires_at"],
    does_not_establish: ["that the repair was executed", "that it succeeded"],
  });

  const execution = await seal({
    schema: SCHEMAS.execution, recorded_at: "2026-09-20T07:52:00Z", witness: { name: "executor-manual", vantage: "operator terminal; the operator ran the guarded deploy" },
    prev: authorization.record_sha256, authorization_sha256: authorization.record_sha256,
    primitive: "redeploy_pinned",
    before: { "health.gate_commit": UNPINNED, "well-known.openai-apps-challenge": "not configured", "agent-card.signature": "verify false (external witness)" },
    steps: [
      "recover OPENAI_APPS_CHALLENGE from Cloudflare version 46f571cf (plain_text binding, 43 chars) with wrangler versions view --json",
      "save it to ~/.config/hs/openai_apps_challenge.txt (chmod 600) so deploy_gate.sh can recover it next time",
      "bash workers/hs-verify-gate/deploy_gate.sh: DIRTY check clean, 15 of 15 suites green, GATE_COMMIT=3213ffc53c8d, challenge passed via env",
      "wrangler deploy produced version a7008ffc-ce14-4911-a713-7c260bbf3477",
    ],
    after: { "health.gate_commit": PINNED, "well-known.openai-apps-challenge": "configured, 43 chars", cloudflare_version: "a7008ffc-ce14-4911-a713-7c260bbf3477" },
    outcome: "ok",
    establishes: ["the guarded deploy of HEAD 3213ffc5 completed and Cloudflare reports the new version", "the challenge value was recovered from a pinned earlier version, not typed by hand"],
    does_not_establish: ["that the surfaces now match expected_after (that is the verify record)", "that the external witness has re-probed"],
  });

  const verify = await seal({
    schema: SCHEMAS.verify, recorded_at: "2026-09-20T08:02:00Z", witness: OPERATOR,
    prev: execution.record_sha256, execution_sha256: execution.record_sha256,
    observed: {
      "health.gate_commit": { gate_commit: PINNED, pinned: "true" },
      "agent-card.signature": { verified: "true", canonical_sha256: SIGNED_CANONICAL, kid: "hs-2026-09", alg: "ES256", tool: "workers/a2a-card-sign/verify.mjs against the live origin" },
      "well-known.openai-apps-challenge": { configured: "true", length: "43" },
    },
    expected_after: EXPECTED_AFTER,
    recovered: true,
    external: [{ witness: "Agenstry", status: "re-probe requested by email", result: null }],
    establishes: [
      "after the execution, GET /health returned gate_commit 3213ffc53c8d",
      "the operator's own verifier (official A2A SDK verifier) returned verified true over the live card with canonical sha256 equal to the signed one",
      "the endpoint served a non-empty OpenAI apps challenge value",
    ],
    does_not_establish: ["the external witness's own verdict (result is null until they re-probe)", "that a raw deploy cannot happen again (that is the drift witness's job)"],
  });

  return [driftA, driftB, driftC, proposal, authorization, execution, verify];
}

export function render(records) { return JSON.stringify(records, null, 2) + "\n"; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const records = await buildFixture();
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), FIXTURE_FILE);
  writeFileSync(out, render(records));
  console.log("wrote " + FIXTURE_FILE + ": " + records.length + " records; segment head " + records[0].record_sha256.slice(0, 12) + ", tail " + records[records.length - 1].record_sha256.slice(0, 12));
}
