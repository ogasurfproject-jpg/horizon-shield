// RUN_ALL: suite
// KIRA Executor v0 の採点: 隔離だけを持つ手が、偽の扉に対して authorization / execution / verify を書き、検証器が strict で通す。
// 他のプリミティブは断る。token は記録に出ん。緑の意味: 手が箱の中に居る、それだけ。
import { execute, EXECUTOR_VERSION } from "./executor.mjs";
import { seal, verifyChain } from "./recovery_verify.mjs";
import { SCHEMAS } from "./recovery_schema.mjs";
let pass = 0, fail = 0; const out = [];
const t = (n, ok, d) => { ok ? pass++ : fail++; out.push((ok ? "  ok   " : "  FAIL ") + n + (ok || !d ? "" : "  <- " + d)); };
const codes = (r) => r.refusals.map((x) => x.code);
const EP = "https://down.example/mcp", TOKEN = "t".repeat(64), OPKEY = "fqrEpRuYScHz52eeiuAWAFEeJB3T7VtZJlducNIhzZM=";

// 偽の扉: register の状態を持ち、token を見る
function fakeGate() {
  const rows = { [EP]: { status: "pending" } };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url); calls.push({ path: u.pathname, method: init.method || "GET", headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    if (u.pathname === "/register/lookup") { const ep = u.searchParams.get("endpoint"); const row = rows[ep]; return { status: 200, json: async () => ({ status: row ? row.status : "unknown" }) }; }
    if (u.pathname === "/register/quarantine") {
      if ((init.headers || {})["x-sweep-token"] !== TOKEN) return { status: 403, json: async () => ({ error: "forbidden" }) };
      const b = JSON.parse(init.body); const row = rows[b.endpoint];
      if (!row) return { status: 404, json: async () => ({ error: "not_on_register" }) };
      if (!/^[0-9a-f]{64}$/.test(b.proposal_sha256)) return { status: 400, json: async () => ({ error: "proposal_sha256_required" }) };
      if (b.lift) { if (row.status !== "quarantined") return { status: 409, json: async () => ({ error: "not_quarantined" }) }; row.status = "pending"; }
      else row.status = "quarantined";
      return { status: 200, json: async () => ({ ok: true }) };
    }
    return { status: 404, json: async () => ({}) };
  };
  return { rows, calls, fetchImpl };
}
const drift = await seal({ schema: SCHEMAS.drift, recorded_at: "2026-09-20T13:00:00Z", witness: { name: "nenrin-drift-witness", vantage: "test" }, prev: null, endpoint: EP, surface: "health.gate_commit", drift: true, kind: "endpoint_error", observed: { error: "fetch failed" }, expected: { pinned: "true" }, establishes: ["GET /health did not answer"], does_not_establish: ["why"] });
const proposal = await seal({ schema: SCHEMAS.proposal, recorded_at: "2026-09-20T13:01:00Z", witness: { name: "shield-agent", vantage: "test" }, prev: drift.record_sha256, drift_sha256: [drift.record_sha256], primitive: "quarantine_endpoint", approval: "auto",
  diagnosis: "[R0_contain_on_outage] the endpoint does not answer; stop serving verdicts for it until it answers and a fresh witness run shows 0 drift",
  rejected: [{ primitive: "redeploy_pinned", why: "deploying into an endpoint that does not answer proves nothing" }], expected_after: { registry: { status: "quarantined" } },
  rollback: "lift the quarantine (recorded) once the endpoint answers", establishes: ["the endpoint failed to answer"], does_not_establish: ["why it failed"] });

// 1. quarantine
const g = fakeGate();
const r = await execute({ proposal, endpoint: EP, gate: "https://gate.test", token: TOKEN, fetchImpl: g.fetchImpl, witness: { name: "tsugi-executor", vantage: "test" } });
t("executor writes an auto authorization (approved, by policy:auto, unsigned, expiring)", r.authorization.decision === "approved" && /policy:auto/.test(r.authorization.by) && !r.authorization.signature_ed25519_b64 && r.authorization.expires_at > r.authorization.recorded_at);
t("execution: before pending, after quarantined, outcome ok, steps name the call and never the token", r.execution.before.registry.status === "pending" && r.execution.after.registry.status === "quarantined" && r.execution.outcome === "ok" && r.execution.steps.length === 3 && !JSON.stringify(r).includes(TOKEN));
t("the gate was called with the token header, the proposal hash and the authorization hash", g.calls.some((c) => c.path === "/register/quarantine" && c.headers["x-sweep-token"] === TOKEN && c.body.proposal_sha256 === proposal.record_sha256 && c.body.authorization_sha256 === r.authorization.record_sha256));
t("verify: recovered true, observed status quarantined, says it is not an independent observation", r.verify.recovered === true && r.verify.observed.registry.status === "quarantined" && r.verify.does_not_establish.some((x) => /independent/.test(x)));
const chain = [drift, proposal, r.authorization, r.execution, r.verify];
const strict = await verifyChain(chain, { operatorKeys: [OPKEY] });
t("the 5 records verify strict with the operator key: an auto primitive needs no signed authorization", strict.ok && strict.segment.complete, JSON.stringify(strict.refusals));
t("asked for a witness quorum the chain says honestly witness_quorum_short (nobody was drawn)", codes(await verifyChain(chain, { operatorKeys: [OPKEY], witnessQuorum: { q: 1 } })).includes("witness_quorum_short"));

// 2. refusals: other primitives, bad token, unknown endpoint, missing endpoint
const human = await seal({ ...proposal, primitive: "redeploy_pinned", approval: "human" });
let threw = ""; try { await execute({ proposal: human, endpoint: EP, gate: "https://gate.test", token: TOKEN, fetchImpl: g.fetchImpl }); } catch (e) { threw = e.message; }
t("redeploy_pinned is refused: the executor holds only quarantine_endpoint", /holds only quarantine_endpoint/.test(threw) && /operator's own hands/.test(threw), threw);
const weird = await seal({ ...proposal, primitive: "quarantine_endpoint" });
const g2 = fakeGate();
const rBad = await execute({ proposal: weird, endpoint: EP, gate: "https://gate.test", token: "x".repeat(64), fetchImpl: g2.fetchImpl, witness: { name: "e", vantage: "t" } });
t("wrong token: the gate answers 403, execution outcome failed, the row untouched, the failure is recorded not hidden", rBad.execution.outcome === "failed" && g2.rows[EP].status === "pending" && /http 403/.test(rBad.execution.steps[1]) && rBad.verify.recovered === false);
const g3 = fakeGate();
const rNone = await execute({ proposal, endpoint: "https://nobody.example/mcp", gate: "https://gate.test", token: TOKEN, fetchImpl: g3.fetchImpl, witness: { name: "e", vantage: "t" } });
t("endpoint not on the register: 404 recorded, outcome failed", rNone.execution.outcome === "failed" && /not_on_register/.test(rNone.execution.steps[1]));
threw = ""; try { await execute({ proposal, endpoint: EP, gate: "https://gate.test", token: "short", fetchImpl: g.fetchImpl }); } catch (e) { threw = e.message; }
t("a short token is refused before any call", /token missing or too short/.test(threw));
threw = ""; try { await execute({ proposal, gate: "https://gate.test", token: TOKEN, fetchImpl: g.fetchImpl }); } catch (e) { threw = e.message; }
t("no endpoint: refused", /endpoint/.test(threw));
const wrongAuth = await seal({ ...r.authorization, decision: "refused" });
threw = ""; try { await execute({ proposal, endpoint: EP, gate: "https://gate.test", token: TOKEN, fetchImpl: g.fetchImpl, authorization: wrongAuth }); } catch (e) { threw = e.message; }
t("an authorization that does not approve this proposal is refused", /does not approve/.test(threw));

// 3. lift (reversible)
const rL = await execute({ proposal, endpoint: EP, gate: "https://gate.test", token: TOKEN, fetchImpl: g.fetchImpl, lift: true, witness: { name: "tsugi-executor", vantage: "test" } });
t("lift: before quarantined, after pending, outcome ok, recovered true", rL.execution.before.registry.status === "quarantined" && rL.execution.after.registry.status === "pending" && rL.execution.outcome === "ok" && rL.verify.recovered === true);
t("EXECUTOR_VERSION 0.1.0", EXECUTOR_VERSION === "0.1.0");
console.log(out.join("\n"));
console.log("=== " + pass + " / " + (pass + fail) + " 合格 (executor v0: 隔離だけを持つ手) ===");
process.exit(fail ? 1 : 0);
