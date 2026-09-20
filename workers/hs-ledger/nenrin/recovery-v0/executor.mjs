// RUN_ALL: library  KIRA Executor v0 (設計書 4.4): カタログの自動承認プリミティブ quarantine_endpoint だけを実行する手。採点は executor_test.mjs
//
//   node executor.mjs proposal.json --endpoint https://x.example/mcp [--drifts drift.jsonl] [--token-file ~/.hs_sweep_token] [--gate https://gate.horizonshield.dev] [--lift] [--out-dir drift_runs]
//
// 持つ物: quarantine_endpoint (隔離) と、その解除 (--lift、可逆)。扉の POST /register/quarantine を叩く。
// 持たん物: 他の 4 プリミティブ (redeploy_pinned / resign_agent_card / revert_to_last_witnessed_good / rotate_credential)。
//   それは鍵・deploy・secret に触るので、運営者の手で実行し、記録だけ書く (設計書 4.4「v1 では人の手」)。この file は断る。
// 書く物: authorization-v1 (自動許可。by は policy:auto、署名無し。検証器の strict は auto プリミティブに署名を要求せん)、
//         execution-v1 (前後の lookup の status、手順、成否)、verify-v1 (実行者自身の再 lookup。独立した証人やない、と自分で書く)。
// token は file から読む。記録にも標準出力にも出さん。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { hostname } from "node:os";
import { seal, verifyChain } from "./recovery_verify.mjs";
import { SCHEMAS, PRIMITIVES } from "./recovery_schema.mjs";

export const EXECUTOR_VERSION = "0.1.0";
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const HELD = ["quarantine_endpoint"];

function unwrapProposal(loaded) {
  const rec = loaded && loaded.record_sha256 ? loaded : (loaded && loaded.proposal ? loaded.proposal : null);
  if (!rec || rec.schema !== SCHEMAS.proposal || !rec.record_sha256) throw new Error("no sealed nenrin-repair-proposal-v1 in the input");
  return rec;
}

// 実行。fetchImpl と token は差し替え可 (試験は偽の扉)。返す物: { authorization, execution, verify, chainOk }。
export async function execute({ proposal, endpoint, gate = "https://gate.horizonshield.dev", token, lift = false, fetchImpl = globalThis.fetch, authorization = null, witness } = {}) {
  const p = unwrapProposal(proposal);
  if (!HELD.includes(p.primitive)) throw new Error("this executor holds only " + HELD.join(", ") + "; " + p.primitive + " is " + (PRIMITIVES[p.primitive] ? "a human-approval primitive executed by the operator's own hands, recorded afterwards" : "not in the catalog"));
  if (!endpoint || !/^https:\/\//.test(endpoint)) throw new Error("endpoint (https URL of the registered row) is required");
  if (!token || String(token).trim().length < 16) throw new Error("token missing or too short (read it from a file; never pass it on the command line)");
  const g = String(gate).replace(/\/+$/, "");
  const w = witness || { name: "tsugi-executor", vantage: hostname() + " (operator network); the executor observes its own effect through the gate's public lookup, it is not an independent witness" };
  const lookup = async () => { const r = await fetchImpl(g + "/register/lookup?endpoint=" + encodeURIComponent(endpoint), { cache: "no-store", signal: AbortSignal.timeout(20000) }); const j = await r.json(); return { status: String(j.status || ""), http: String(r.status) }; };

  // 1. 許可。渡されとらんなら自動許可を書く (カタログで auto のプリミティブだけ、ここに来る)。
  let auth = authorization;
  if (!auth) {
    const exp = new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, "Z");
    auth = await seal({ schema: SCHEMAS.authorization, recorded_at: now(), witness: w, prev: p.record_sha256, proposal_sha256: p.record_sha256,
      decision: "approved", by: "policy:auto (quarantine_endpoint is the catalog's only auto-approval primitive; a stop needs no human gate, a repair does)", expires_at: exp,
      establishes: ["the executor accepted proposal " + p.record_sha256.slice(0, 12) + " under the catalog's auto-approval rule for quarantine_endpoint, valid until " + exp],
      does_not_establish: ["that a human reviewed the diagnosis", "that the endpoint misbehaved: a quarantine is a stop, not a finding"] });
  } else if (auth.proposal_sha256 !== p.record_sha256 || auth.decision !== "approved") throw new Error("the authorization given does not approve this proposal");

  // 2. 実行: 前を測る、叩く、後を測る。
  const before = await lookup();
  const steps = [];
  let outcome = "failed", httpStatus = "", detail = "";
  try {
    const body = { endpoint, proposal_sha256: p.record_sha256, authorization_sha256: auth.record_sha256, reason: (lift ? "lift: " : "") + String(p.diagnosis).slice(0, 400), ...(lift ? { lift: true } : {}) };
    const r = await fetchImpl(g + "/register/quarantine", { method: "POST", headers: { "content-type": "application/json", "x-sweep-token": String(token).trim(), "user-agent": "tsugi-executor/" + EXECUTOR_VERSION }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    httpStatus = String(r.status);
    const j = await r.json().catch(() => ({}));
    steps.push("GET " + g + "/register/lookup before: status " + before.status);
    steps.push("POST " + g + "/register/quarantine " + (lift ? "lift" : "set") + " citing proposal " + p.record_sha256.slice(0, 12) + " and authorization " + auth.record_sha256.slice(0, 12) + " with x-sweep-token (value not recorded): http " + httpStatus + (j && j.error ? " " + j.error : ""));
    detail = j && j.error ? String(j.error) : "";
  } catch (e) { steps.push("POST " + g + "/register/quarantine failed: " + String(e && e.message || e).slice(0, 200)); detail = String(e && e.message || e); }
  const after = await lookup();
  steps.push("GET " + g + "/register/lookup after: status " + after.status);
  const wanted = lift ? after.status !== "quarantined" : after.status === "quarantined";
  outcome = httpStatus === "200" && wanted ? "ok" : "failed";
  const execution = await seal({ schema: SCHEMAS.execution, recorded_at: now(), witness: w, prev: auth.record_sha256, authorization_sha256: auth.record_sha256, primitive: "quarantine_endpoint",
    before: { registry: { status: before.status } }, after: { registry: { status: after.status } }, outcome, steps,
    establishes: [outcome === "ok" ? "the gate's register row for " + endpoint + " answered status " + after.status + " after the call" : "the call did not produce the wanted register state (http " + httpStatus + (detail ? ", " + detail : "") + ")"],
    does_not_establish: ["that the endpoint misbehaved: a quarantine is a stop, not a finding", "independent observation: the executor read the gate itself", "that the cause named in the proposal is right"] });
  // 3. 再検証 (実行者自身の再 lookup。独立やない、と書く)。
  const again = await lookup();
  const verify = await seal({ schema: SCHEMAS.verify, recorded_at: now(), witness: w, prev: execution.record_sha256, execution_sha256: execution.record_sha256,
    observed: { registry: { status: again.status, http: again.http } }, expected_after: p.expected_after, recovered: lift ? again.status !== "quarantined" : again.status === (p.expected_after && p.expected_after.registry ? p.expected_after.registry.status : "quarantined"),
    external: [],
    establishes: ["after the execution, GET /register/lookup answered status " + again.status],
    does_not_establish: ["independent observation: the same actor executed and re-read (a drift witness run from another vantage is the real re-verification)", "that any external witness was drawn: none was", "that the endpoint is healthy: quarantine is the stop, health is the next incident's question"] });
  return { authorization: auth, execution, verify };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const args = {}; const pos = [];
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith("--")) { const v = argv[i + 1]; if (v !== undefined && !v.startsWith("--")) { args[a.slice(2)] = v; i++; } else args[a.slice(2)] = true; } else pos.push(a); }
  if (!pos[0]) { console.error("usage: node executor.mjs proposal.json --endpoint <https url> [--drifts drift.jsonl] [--token-file ~/.hs_sweep_token] [--gate url] [--lift] [--out-dir drift_runs]"); process.exit(2); }
  const proposal = JSON.parse(readFileSync(pos[0], "utf8"));
  let endpoint = args.endpoint;
  if (!endpoint && args.drifts) { const first = readFileSync(args.drifts, "utf8").split("\n").find((l) => l.trim()); if (first) endpoint = JSON.parse(first).endpoint; }
  const tokenFile = (args["token-file"] || "~/.hs_sweep_token").replace(/^~/, process.env.HOME);
  if (!existsSync(tokenFile)) { console.error("token file not found: " + tokenFile); process.exit(2); }
  const token = readFileSync(tokenFile, "utf8");
  const res = await execute({ proposal, endpoint, gate: args.gate, token, lift: args.lift === true });
  const outDir = args["out-dir"] || path.join(path.dirname(fileURLToPath(import.meta.url)), "drift_runs");
  mkdirSync(outDir, { recursive: true });
  const stamp = now().replace(/[-:]/g, "").replace("T", "T");
  for (const [k, v] of Object.entries(res)) writeFileSync(path.join(outDir, k + "_" + stamp + "_quarantine.json"), JSON.stringify(v, null, 2) + "\n");
  console.error("tsugi-executor: quarantine_endpoint " + (args.lift ? "lift" : "set") + " on " + endpoint + ": " + res.execution.outcome + "; wrote authorization/execution/verify to " + outDir);
  process.exit(res.execution.outcome === "ok" ? 0 : 1);
}
