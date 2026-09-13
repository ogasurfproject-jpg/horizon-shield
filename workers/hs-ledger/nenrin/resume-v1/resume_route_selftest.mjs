// resume_route_selftest.mjs : drives the real ledger worker's GET /resume offline with a KV mock
// shaped like production: witness records anchored as nenrin-witness-batch-v1 entries whose bytes live
// at wit:anchored:<sha> (two-hop authentication), plus witness walks anchored as their own entries.
// Run from the resume-v1 directory:
//   node --experimental-default-type=module resume_route_selftest.mjs
import { createHash } from "node:crypto";
import { canonical, assembleResume } from "./resume_v1.mjs";
import worker from "../../src/worker.js";

const shaNode = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const enc = new TextEncoder();
const shaSubtle = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

const BASE = "https://mcp.horizonshield.dev", EP = BASE + "/mcp";
function walk(base, { outcome = "PASS", walked_at = "2026-09-10T00:00:00Z", nodeUrl = null, witness = { name: "anonymous", vantage: "tokyo fiber" } } = {}) {
  return { schema: "jidec-path-v1", base, purpose: "a2a-conduct-walk", walked_at, witness,
    verdict: { ok: outcome === "PASS", outcome, n_pass: 5, n_total: 5 },
    nodes: [{ n: 0, kind: "card", request: { method: "GET", url: nodeUrl || base + "/.well-known/agent-card.json" }, response: { status: 200, body_sha256: "ab".repeat(32) } }],
    assertions: [] };
}
// a stored witness record as the intake writes it (wit:anchored:<sha> -> {n, stored})
function stored(rec, { endpoint = EP, mode = "full", counted = true, count_reason = null, tamperBytes = false } = {}) {
  const rc = canonical(rec);
  const sha = shaNode(rc);
  return { sha, record_canonical: tamperBytes ? rc + " " : rc, signed: false, mode, endpoint, counted, count_reason,
    purpose: rec.purpose, witness_name: rec.witness && rec.witness.name, vantage: rec.witness && rec.witness.vantage, submitted_at: "2026-09-10T01:00:00Z" };
}
// a batch entry exactly as anchorWitnessPool builds it (records sorted by sha; JSON.stringify, insertion order)
function batchEntry(n, storedList, { ots_status = "confirmed", bitcoin_block = 966000 + n, block_time = "2026-09-10T06:00:00Z" } = {}) {
  const items = [...storedList].sort((a, b) => (a.sha < b.sha ? -1 : 1));
  const batch = { schema: "nenrin-witness-batch-v1", anchored_at: "2026-09-10T00:30:00Z", count: items.length,
    records: items.map((s) => ({ sha: s.sha, purpose: s.purpose, witness_name: s.witness_name, vantage: s.vantage, signed: s.signed })) };
  const rc = JSON.stringify(batch);
  return { entry: { n, work: `NENRIN witness batch (${items.length} records)`, claim_sha256: shaNode(rc), record_canonical: rc, schema: "v0-plain", ots_status, bitcoin_block, block_time }, items };
}
function pathEntry(n, rec, { ots_status = "confirmed", bitcoin_block = 966000 + n, block_time = "2026-09-10T06:00:00Z", tamper = false } = {}) {
  const rc = canonical(rec);
  return { n, claim_sha256: tamper ? "0".repeat(64) : shaNode(rc), record_canonical: rc, ots_status, bitcoin_block, block_time };
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
const call = (path, headers = {}) => worker.fetch(new Request("https://ledger.test" + path, { headers }), env);
let bad = 0; const ok = (name, cond, why = "") => { console.log((cond ? "[OK]   " : "[FAIL] ") + name + (why ? "  " + why : "")); if (!cond) bad++; };

// 0. hasher parity: subtle (worker path) == node:crypto
{
  const m = { record_canonical: canonical(walk(BASE)), record_sha256: null, anchor: { bitcoin_block: 1, block_time: "2026-09-10T06:00:00Z", ots: "x" }, source_ledger_n: 1 };
  m.record_sha256 = shaNode(m.record_canonical);
  const a = await assembleResume(EP, EP, null, [m], { sha256Hex: shaSubtle, now: "2026-09-13T00:00:00Z" });
  const b = await assembleResume(EP, EP, null, [m], { sha256Hex: shaNode, now: "2026-09-13T00:00:00Z" });
  ok("H0_subtle_hasher_matches_node_crypto", a.resume_sha256 === b.resume_sha256, a.resume_sha256.slice(0, 12));
}

// 1. production-shaped ledger
const sA = stored(walk(BASE));                                                                                   // counted
const sB = stored(walk(BASE, { walked_at: "2026-09-10T02:00:00Z", witness: { name: "babyblueviper1", vantage: "madrid" } })); // counted, 2nd witness
const sC = stored(walk("https://other.example"), { endpoint: "https://other.example/mcp" });                  // other agent -> out of scope
const sD = stored(walk(BASE, { walked_at: "2026-09-10T03:00:00Z" }), { mode: "commitment" });                   // unrevealed -> not counted
const sE = stored(walk(BASE, { walked_at: "2026-09-10T04:00:00Z" }), { counted: false, count_reason: "same witness, same endpoint, same day; stored, not counted" });
const b3 = batchEntry(3, [sA, sB, sC, sD, sE]);
const sF = stored(walk(BASE, { walked_at: "2026-09-11T00:00:00Z" }));
const b5 = batchEntry(5, [sF], { ots_status: "pending", bitcoin_block: null, block_time: null });               // batch not anchored yet
const sG = stored(walk(BASE, { walked_at: "2026-09-12T00:00:00Z" }));
const b6 = batchEntry(6, [sG]);                                                                                    // listed in batch but bytes missing from KV
seed([
  { n: 1, claim_sha256: "11".repeat(32), record_canonical: JSON.stringify({ schema: "jidec-claim-v1", work: "audit" }), ots_status: "confirmed", bitcoin_block: 1, block_time: "2026-01-01T00:00:00Z" },
  pathEntry(2, { schema: "jidec-path-v1", purpose: "audit-path", nodes: [{ request: { url: EP } }] }),           // path without witness -> out of scope
  b3.entry,
  pathEntry(4, walk("https://witness.example", { nodeUrl: EP, walked_at: "2026-09-12T12:00:00Z", witness: { name: "c", vantage: "osaka" } }), { block_time: "2026-09-12T18:00:00Z" }), // per-entry walk touching EP -> counted
  b5.entry,
  b6.entry,
], [[3, sA], [3, sB], [3, sC], [3, sD], [3, sE], [5, sF] /* sG deliberately absent */]);

let res = await call("/resume?endpoint=" + encodeURIComponent(EP));
ok("R1_status_200", res.status === 200, String(res.status));
let body = await res.json();
ok("R2_counts_PASS_3", body.counts && body.counts.PASS === 3 && body.counts.FAIL === 0, JSON.stringify(body.counts));
const order = body.measurements.map((m) => m.source_ledger_n + ":" + m.record_sha256.slice(0, 6));
const batchOrder = b3.items.filter((s) => [sA.sha, sB.sha].includes(s.sha)).map((s) => "3:" + s.sha.slice(0, 6));
ok("R3_order_entry_asc_then_batch_order", JSON.stringify(order) === JSON.stringify([...batchOrder, "4:" + body.measurements[2].record_sha256.slice(0, 6)]), JSON.stringify(order));
ok("R4_batch_lines_carry_two_hop_anchor", body.measurements.slice(0, 2).every((m) => m.anchor.batch_sha256 === b3.entry.claim_sha256 && m.record_url === "https://ledger.test/witness/" + m.record_sha256 && m.anchor.ots === "https://ledger.test/ledger/3/ots"));
ok("R5_per_entry_line_has_no_batch_sha", body.measurements[2].anchor.batch_sha256 === null && body.measurements[2].record_url.includes("/paths/"));
const whys = body.not_counted.map((x) => x.why).sort();
ok("R6_not_counted_reasons_named", JSON.stringify(whys) === JSON.stringify(["batch_lists_sha_but_stored_bytes_missing", "commitment_unrevealed", "not_yet_anchored", "stored_not_counted"]), JSON.stringify(whys));
ok("R7_out_of_scope_2", body.scan && body.scan.out_of_scope === 2 && body.scan.seq === 6, JSON.stringify(body.scan));
ok("R8_witness_diversity_3_3", body.witness_diversity.distinct_names === 3 && body.witness_diversity.distinct_vantages === 3, JSON.stringify(body.witness_diversity));
ok("R9_no_score_keys_anywhere", !/"(score|rating|stars|points|rank|grade|trust_score)"\s*:/i.test(JSON.stringify(body)));
{
  const core = { ...body }; for (const k of ["evaluated_at", "not_counted", "scan", "recompute", "resume_sha256"]) delete core[k];
  ok("R10_resume_sha_recomputes_from_envelope", (await shaSubtle(canonical(core))) === body.resume_sha256);
}
ok("R11_perma_id_is_origin", body.perma_id === BASE && body.measured_endpoint === EP);

// 2. md face
res = await call("/resume?endpoint=" + encodeURIComponent(EP) + "&format=md");
let text = await res.text();
ok("M1_md_200_markdown", res.status === 200 && /markdown/.test(res.headers.get("content-type") || ""));
ok("M2_md_table_uses_witness_url", text.startsWith("# NENRIN Resume v1") && text.includes("https://ledger.test/witness/" + sA.sha));
ok("M3_md_no_forbidden_dashes", !new RegExp("[" + String.fromCharCode(0x2014, 0x2013, 0x2015) + "]").test(text));

// 3. fail-closed: stored bytes do not hash to the sha the batch lists -> 422 orphan_record
const sX = stored(walk(BASE), { tamperBytes: true });
const b7 = batchEntry(7, [sX]);
seed([b7.entry], [[7, sX]]);
res = await call("/resume?endpoint=" + encodeURIComponent(EP)); body = await res.json();
ok("F1_422_orphan_record_on_tampered_stored_bytes", res.status === 422 && body.code === "orphan_record", res.status + " " + JSON.stringify(body.code));

// 4. bad input, empty ledger
res = await call("/resume"); ok("B1_400_without_endpoint", res.status === 400);
res = await call("/resume?endpoint=http%3A%2F%2Finsecure.example"); ok("B2_400_non_https", res.status === 400);
seed([]); res = await call("/resume?endpoint=" + encodeURIComponent(EP)); body = await res.json();
ok("Z1_empty_ledger_assembles_zero", res.status === 200 && body.counts.PASS === 0 && body.freshness.current_now === false);

console.log("\nroute selftest  " + (bad ? "FAIL " + bad : "all green"));
process.exit(bad ? 1 : 0);
