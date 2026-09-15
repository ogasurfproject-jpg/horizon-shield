// trust_signal_route_selftest.mjs : 本物の台帳 worker の GET /trust-signal を KV モックで叩く(offline)。
// resume_route_selftest と同じ形の witness batch を seed し、射影が worker 経由で出るまで確かめる。
// 実行: cd workers/hs-ledger/nenrin/trust-signal-v1 && node trust_signal_route_selftest.mjs
import { createHash } from "node:crypto";
import { canonical } from "../resume-v1/resume_v1.mjs";
import worker from "../../src/worker.js";

const shaNode = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const BASE = "https://mcp.horizonshield.dev", EP = BASE + "/mcp";

function walk(base, { outcome = "PASS", walked_at = "2026-08-15T17:04:31Z", witness = { name: "anonymous", vantage: "tokyo fiber" }, disc = null } = {}) {
  const r = { schema: "jidec-path-v1", base, purpose: "a2a-conduct-walk", walked_at, witness,
    verdict: { ok: outcome === "PASS", outcome, n_pass: outcome === "PASS" ? 5 : 3, n_total: 5 },
    nodes: [{ n: 0, kind: "card", request: { method: "GET", url: base + "/.well-known/agent-card.json" }, response: { status: 200, body_sha256: "ab".repeat(32) } }],
    assertions: [] };
  if (disc) r.discrepancies = disc;
  return r;
}
function stored(rec, { endpoint = EP } = {}) {
  const rc = canonical(rec), sha = shaNode(rc);
  return { sha, record_canonical: rc, signed: false, mode: "full", endpoint, counted: true, count_reason: null,
    purpose: rec.purpose, witness_name: rec.witness && rec.witness.name, vantage: rec.witness && rec.witness.vantage, submitted_at: "2026-08-15T18:00:00Z" };
}
function batchEntry(n, storedList, { bitcoin_block = 965862, block_time = "2026-09-06 01:08 UTC" } = {}) {
  const items = [...storedList].sort((a, b) => (a.sha < b.sha ? -1 : 1));
  const batch = { schema: "nenrin-witness-batch-v1", anchored_at: "2026-08-15T00:30:00Z", count: items.length,
    records: items.map((s) => ({ sha: s.sha, purpose: s.purpose, witness_name: s.witness_name, vantage: s.vantage, signed: s.signed })) };
  const rc = JSON.stringify(batch);
  return { entry: { n, work: `NENRIN witness batch (${items.length})`, claim_sha256: shaNode(rc), record_canonical: rc, schema: "v0-plain", ots_status: "confirmed", bitcoin_block, block_time }, items };
}

const store = {};
const kv = { get: async (k) => (k in store ? store[k] : null), put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true }) };
const env = { LEDGER: kv, LEDGER_ADMIN_TOKEN: "test" };
function seed(entries, anchoredItems = []) {
  for (const k of Object.keys(store)) delete store[k];
  store["seq"] = String(Math.max(0, ...entries.map((e) => e.n)));
  for (const e of entries) store["entry:" + e.n] = JSON.stringify(e);
  for (const [n, s] of anchoredItems) store["wit:anchored:" + s.sha] = JSON.stringify({ n, stored: s });
}
const call = (path) => worker.fetch(new Request("https://ledger.test" + path, {}), env);
let bad = 0; const ok = (name, cond, why = "") => { console.log((cond ? "[OK]   " : "[FAIL] ") + name + (why ? "  " + why : "")); if (!cond) bad++; };

// 2 witnesses: 1 PASS + 1 FAIL(悪い履歴)、FAIL に食い違いを1つ載せる
const sPass = stored(walk(BASE, { outcome: "PASS", witness: { name: "fed", vantage: "vps madrid" } }));
const sFail = stored(walk(BASE, { outcome: "FAIL", walked_at: "2026-08-20T00:00:00Z", witness: { name: "anon", vantage: "tokyo fiber" }, disc: [{ note: "reachable vs 522" }] }));
const b = batchEntry(38, [sPass, sFail]);
seed([b.entry], b.items.map((s) => [38, s]));

// 1) endpoint 無し = 400
{ const r = await call("/trust-signal"); ok("B1_400_without_endpoint", r.status === 400); }

// 2) /trust-signal(json)= 第三者観測 signal が worker 経由で出る
{
  const r = await call("/trust-signal?endpoint=" + encodeURIComponent(EP));
  const j = await r.json();
  ok("T1_200", r.status === 200, String(r.status));
  ok("T2_signal_kind", j.signal_kind === "third-party-observation", j.signal_kind);
  ok("T3_subject_endpoint", j.subject && j.subject.endpoint === EP, j.subject && j.subject.endpoint);
  ok("T4_measurements_2", j.observation && j.observation.measurements === 2, j.observation && j.observation.measurements);
  ok("T5_adverse_fail_1", j.adverse && j.adverse.fail_outcomes === 1, j.adverse && j.adverse.fail_outcomes);
  ok("T6_adverse_disagreements_1", j.adverse && j.adverse.disagreements === 1, j.adverse && j.adverse.disagreements);
  ok("T7_adverse_erasable_false", j.adverse && j.adverse.erasable === false, j.adverse && j.adverse.erasable);
  ok("T8_scored_false", j.maps_to && j.maps_to.scored === false, j.maps_to && j.maps_to.scored);
  ok("T9_anchor_block", j.time_depth && j.time_depth.oldest_anchor && j.time_depth.oldest_anchor.block === 965862, JSON.stringify(j.time_depth && j.time_depth.oldest_anchor));
  ok("T10_issuer_is_party_true_for_own_zone", j.issuer && j.issuer.is_party_to_subject === true, JSON.stringify(j.issuer));
  ok("T11_no_score_key", !JSON.stringify(j).match(/"(score|rating|rank|grade|trust_score)"/), "score key leaked");
}

// 3) format=a2a = trust.signals[] の behavioral entry
{
  const r = await call("/trust-signal?endpoint=" + encodeURIComponent(EP) + "&format=a2a");
  const j = await r.json();
  ok("A1_type_behavioral", j.type === "behavioral", j.type);
  ok("A2_provider_sig_null", j.provider && j.provider.sig === null, JSON.stringify(j.provider));
  ok("A3_layer_recomputable", j["x-nenrin"] && j["x-nenrin"].layer === "recomputable", j["x-nenrin"] && j["x-nenrin"].layer);
  ok("A4_carries_adverse", j["x-nenrin"] && j["x-nenrin"].adverse && j["x-nenrin"].adverse.fail_outcomes === 1, JSON.stringify(j["x-nenrin"] && j["x-nenrin"].adverse));
}

console.log(bad ? `\n${bad} FAIL` : "\ntrust-signal route selftest  all green");
if (bad) process.exit(1);
