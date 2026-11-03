// test/resume_twin_parity.test.mjs
// The Cloud Run copy and the Cloudflare ledger give the same Résumé for the agreement intake's rows (2026-11-03).
// The same worker.js runs in both; what differs is how AGREEMENT_INTAKE is reached: on Cloudflare a service binding,
// on Cloud Run a plain HTTPS fetch (gcp/bindings.mjs, what gcp/server.mjs uses). For each case the same KV and the same
// intake answers go through both, and agreements[], not_counted and the whole body (evaluated_at aside) must be equal.
// The contract is the real one of musubi-v0/run0003 (contract_sha256 e1fa47a0). No network.
//
// Run: node test/resume_twin_parity.test.mjs
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorker, mockKV } from "./load.mjs";
import { serviceBindings } from "../gcp/bindings.mjs";
import { canonicalUtf8, parseStrict } from "../nenrin/agreement-v0/agreement_canonical.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGIN = "https://ledger.horizonshield.dev", INTAKE = "https://agreement.horizonshield.dev";
const worker = await loadWorker("src/worker.js");
const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
let pass = 0, fail = 0;
const t = (name, ok, detail) => { if (ok) { pass++; console.log("ok   " + name); } else { fail++; console.log("NG   " + name + (detail !== undefined ? "   <<< " + JSON.stringify(detail).slice(0, 700) : "")); } };

const RUN3 = readFileSync(resolve(HERE, "../nenrin/musubi-v0/run0003/contract.json"), "utf8");
const E1 = "e1fa47a049a94fd725efafa0a1d603e51a16158c58d2638d4c9052c1329109c8";
const csha = (text) => { const r = parseStrict(text); const b = {}; for (const k of Object.keys(r)) if (k !== "signatures") b[k] = r[k]; return sha("a2a-contract-v0\n" + canonicalUtf8(b)); };
const domainsOf = (text) => parseStrict(text).parties.map((p) => p.domain);
const crow = (s, text, over) => ({ sha: s, kind: "contract", schema: "a2a-contract-v0", parties: domainsOf(text), bytes_url: INTAKE + "/contract/" + s, musubi_version: "0.3.0", ...(over || {}) });
const xrow = (i) => ({ sha: sha("exec" + i), kind: "execution", schema: "a2a-execution-v0", parties: ["shield.the-horizons-innovation.com"], bytes_url: INTAKE + "/execution/" + sha("exec" + i), contract_sha256: E1 });
function ibatch(n, records, { ots_status = "confirmed", bitcoin_block = 970000 + n, block_time = "2026-10-12T01:00:00Z" } = {}) {
  const b = { schema: "nenrin-agreement-batch-v1", anchored_at: "2026-10-12T00:45:00Z", count: records.length, records: [...records].sort((a, c) => (a.sha < c.sha ? -1 : 1)) };
  const rc = JSON.stringify(b);
  return { n, claim_sha256: sha(rc), record_canonical: rc, schema: "v0-plain", ots_status, bitcoin_block, block_time };
}
function lagreement(parties) {
  const rec = { schema: "a2a-agreement-v1.1", agreement_id: "ag-" + parties.join(","), parties: parties.map((d, i) => ({ role: i ? "contractor" : "principal", domain: d, key_url: "https://" + d + "/k.json" })) };
  const rc = canonicalUtf8(rec);
  return { canonical_sha256: sha(rc), record_canonical: rc, report: { record_schema: "a2a-agreement-v1.1" } };
}
function lbatch(n, items) {
  const rc = JSON.stringify({ schema: "nenrin-agreement-batch-v1", records: items.map((s) => ({ canonical_sha256: s.canonical_sha256, record_schema: s.report.record_schema })) });
  return { n, claim_sha256: sha(rc), record_canonical: rc, ots_status: "confirmed", bitcoin_block: 974000 + n, block_time: "2026-11-01T01:00:00Z" };
}
const AGB = canonicalUtf8({ schema: "a2a-agreement-v1", agreement_id: "intake-ag", parties: [{ role: "principal", domain: "shield.the-horizons-innovation.com", key_url: "https://shield.the-horizons-innovation.com/k.json" }, { role: "contractor", domain: "b.example", key_url: "https://b.example/k.json" }] });
const AGS = sha(AGB);
const arow = { sha: AGS, kind: "agreement", schema: "a2a-agreement-v1", parties: ["shield.the-horizons-innovation.com", "b.example"], bytes_url: INTAKE + "/agreement/" + AGS };
const OTHER = canonicalUtf8({ ...parseStrict(RUN3), parties: parseStrict(RUN3).parties.map((p) => ({ ...p, domain: "other.example", key_url: "https://other.example/k.json" })) });
const OS = csha(OTHER);
const LA = lagreement(["shield.the-horizons-innovation.com", "buyer.example.net"]);
const C = (path) => INTAKE + "/contract/" + path;

// [name, entries [[entry, ledger pool items]], intake files {url: [status, body]}, what Cloudflare must show]
const CASES = [
  ["entry 83 shape, anchored", [[ibatch(83, [crow(E1, RUN3), xrow(1), xrow(2)])]], { [C(E1)]: [200, RUN3] }, (j) => j.agreements.length === 1 && j.agreements[0].record_sha256 === E1],
  ["pretty printed bytes", [[ibatch(83, [crow(E1, RUN3)])]], { [C(E1)]: [200, JSON.stringify(JSON.parse(RUN3), null, 2)] }, (j) => j.agreements.length === 1],
  ["not yet anchored", [[ibatch(83, [crow(E1, RUN3)], { ots_status: "pending", bitcoin_block: null, block_time: null })]], { [C(E1)]: [200, RUN3] }, (j) => j.not_counted.some((x) => x.why === "not_yet_anchored")],
  ["the intake answers 404", [[ibatch(83, [crow(E1, RUN3)])]], {}, (j) => j.not_counted.some((x) => x.why === "intake_bytes_unavailable" && x.detail === "http_404")],
  ["the intake answers 410", [[ibatch(83, [crow(E1, RUN3)])]], { [C(E1)]: [410, "{}"] }, (j) => j.not_counted.some((x) => x.detail === "http_410")],
  ["a term changed", [[ibatch(83, [crow(E1, RUN3)])]], { [C(E1)]: [200, RUN3.replace(/"nonce":\s*"([0-9a-f])/, (m, c) => m.slice(0, -1) + (c === "0" ? "1" : "0"))] }, (j) => j.not_counted.some((x) => x.why === "contract_bytes_do_not_match_the_contract_sha256")],
  ["a bytes_url that is not the intake", [[ibatch(83, [crow(E1, RUN3, { bytes_url: "https://evil.example/contract/" + E1 })])]], { [C(E1)]: [200, RUN3] }, (j) => j.not_counted.some((x) => x.why === "intake_row_bytes_url_is_not_the_intake")],
  ["row and record parties differ", [[ibatch(84, [crow(OS, OTHER, { parties: ["shield.the-horizons-innovation.com"] })])]], { [C(OS)]: [200, OTHER] }, (j) => j.not_counted.some((x) => x.why === "record_parties_do_not_name_this_host")],
  ["an intake agreement (the older form)", [[ibatch(86, [arow])]], { [INTAKE + "/agreement/" + AGS]: [200, AGB] }, (j) => j.agreements.length === 1 && j.agreements[0].record_sha256 === AGS],
  ["an intake agreement one byte off", [[ibatch(86, [arow])]], { [INTAKE + "/agreement/" + AGS]: [200, AGB + " "] }, (j) => j.not_counted.some((x) => x.why === "agreement_bytes_do_not_hash_to_the_listed_sha")],
  ["the ledger pool and the intake together", [[lbatch(90, [LA]), [LA]], [ibatch(83, [crow(E1, RUN3)])]], { [C(E1)]: [200, RUN3] }, (j) => j.agreements.length === 2],
  ["the ledger pool alone", [[lbatch(90, [LA]), [LA]]], {}, (j) => j.agreements.length === 1],
];

function kvOf(entries) {
  const put = [["seq", String(Math.max(0, ...entries.map(([e]) => e.n)))]];
  for (const [e, items] of entries) { put.push(["entry:" + e.n, JSON.stringify(e)]); for (const s of items || []) put.push(["agr:anchored:" + s.canonical_sha256, JSON.stringify({ n: e.n, stored: s })]); }
  return mockKV(put).binding;
}
const answer = (files, req) => { const u = new URL(req.url); const f = files[u.origin + u.pathname]; return f ? new Response(f[1], { status: f[0] }) : new Response("{}", { status: 404 }); };
async function resume(env, ep) {
  const r = await worker.fetch(new Request(ORIGIN + "/resume?endpoint=" + encodeURIComponent(ep)), env, { waitUntil: () => {} });
  return JSON.parse(await r.text());
}
const norm = (j) => JSON.stringify({ ...j, evaluated_at: "X", generated_at: "X" });
globalThis.fetch = async () => new Response("not found", { status: 404 });
for (const [name, entries, files, want] of CASES) {
  for (const ep of ["https://shield.the-horizons-innovation.com/", "https://the-horizons-innovation.com/", "https://mcp.horizonshield.dev/mcp"]) {
    const cf = await resume({ LEDGER: kvOf(entries), AGREEMENT_INTAKE: { fetch: async (req) => answer(files, req) } }, ep);
    const seen = [];
    const twinFetch = async (input, init) => { const req = input instanceof Request ? input : new Request(input, init); seen.push(req.url); return answer(files, req); };
    const tw = await resume({ LEDGER: kvOf(entries), ...serviceBindings(twinFetch) }, ep);
    const tag = name + " @ " + new URL(ep).host;
    t(tag + ": agreements[] equal", JSON.stringify(cf.agreements) === JSON.stringify(tw.agreements), { cf: cf.agreements, tw: tw.agreements });
    t(tag + ": not_counted equal", JSON.stringify(cf.not_counted) === JSON.stringify(tw.not_counted), { cf: cf.not_counted, tw: tw.not_counted });
    t(tag + ": whole Résumé equal", norm(cf) === norm(tw));
    if (ep === "https://shield.the-horizons-innovation.com/") t(tag + ": Cloudflare shows what the case is about", want(cf), { a: cf.agreements, nc: cf.not_counted });
    t(tag + ": the twin reached only the intake's fixed paths", seen.every((u) => /^https:\/\/agreement\.horizonshield\.dev\/(contract|agreement)\/[0-9a-f]{64}$/.test(u)), seen);
  }
}
const b = serviceBindings(async () => new Response("x"));
t("bindings.mjs gives GATE, PDF_GEN and AGREEMENT_INTAKE, each with fetch", ["GATE", "PDF_GEN", "AGREEMENT_INTAKE"].every((k) => typeof b[k].fetch === "function") && Object.keys(b).length === 3);
const src = readFileSync(resolve(HERE, "../gcp/server.mjs"), "utf8");
t("gcp/server.mjs takes its bindings from bindings.mjs", /import \{ serviceBindings \} from "\.\/bindings\.mjs";/.test(src) && /\.\.\.serviceBindings\(\)/.test(src));

console.log("");
if (fail) { console.log("FAIL " + fail + " of " + (pass + fail) + " (the Cloud Run copy and Cloudflare give the same Résumé)"); process.exit(1); }
console.log("PASS " + pass + "/" + pass + " (the Cloud Run copy and Cloudflare give the same Résumé)");
