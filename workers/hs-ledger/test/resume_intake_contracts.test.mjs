// test/resume_intake_contracts.test.mjs
// The Résumé's agreements[] for the rows the agreement intake writes (2026-11-03): MUSUBI contracts (a2a-contract-v0) and
// agreements, named by {sha, kind, parties, bytes_url} with their bytes at the intake. On the LIVE worker (src/worker.js)
// with a mock KV and a mock AGREEMENT_INTAKE service binding. The contract is the real one of musubi-v0/run0003
// (contract_sha256 e1fa47a0), in a batch shaped like ledger entry 83 (one contract, two executions). No network.
//
// Run: node test/resume_intake_contracts.test.mjs
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorker, mockKV } from "./load.mjs";
import { canonicalUtf8, parseStrict } from "../nenrin/agreement-v0/agreement_canonical.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGIN = "https://ledger.horizonshield.dev", INTAKE = "https://agreement.horizonshield.dev";
const worker = await loadWorker("src/worker.js");
const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
let pass = 0, fail = 0;
const t = (name, ok, detail) => { if (ok) { pass++; console.log("ok   " + name); } else { fail++; console.log("NG   " + name + (detail !== undefined ? "   <<< " + JSON.stringify(detail).slice(0, 700) : "")); } };
globalThis.fetch = async () => new Response("not found", { status: 404 });

const RUN3 = readFileSync(resolve(HERE, "../nenrin/musubi-v0/run0003/contract.json"), "utf8");
const E1 = "e1fa47a049a94fd725efafa0a1d603e51a16158c58d2638d4c9052c1329109c8";
const csha = (text) => { const r = parseStrict(text); const b = {}; for (const k of Object.keys(r)) if (k !== "signatures") b[k] = r[k]; return sha("a2a-contract-v0\n" + canonicalUtf8(b)); };
t("0. the run0003 contract's contract_sha256 is e1fa47a0 (the digest both parties signed)", csha(RUN3) === E1, csha(RUN3));

const domainsOf = (text) => parseStrict(text).parties.map((p) => p.domain);
const crow = (s, text, over) => ({ sha: s, kind: "contract", schema: "a2a-contract-v0", parties: domainsOf(text), bytes_url: INTAKE + "/contract/" + s, musubi_version: "0.3.0", ...(over || {}) });
const xrow = (i) => ({ sha: sha("exec" + i), kind: "execution", schema: "a2a-execution-v0", parties: ["shield.the-horizons-innovation.com"],
  bytes_url: INTAKE + "/execution/" + sha("exec" + i), musubi_version: "0.3.0", contract_sha256: E1 });
// an entry shaped like ledger entry 83: the intake's nenrin-agreement-batch-v1 (kinds contract 1, execution 2)
function ibatch(n, records, { ots_status = "confirmed", bitcoin_block = 970000 + n, block_time = "2026-10-12T01:00:00Z" } = {}) {
  const kinds = {}; for (const r of records) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  const b = { schema: "nenrin-agreement-batch-v1", anchored_at: "2026-10-12T00:45:00Z", count: records.length, kinds, records: [...records].sort((a, c) => (a.sha < c.sha ? -1 : 1)),
    intake_version: "0.4.0", musubi_version: "0.3.0", verifier_sha256: "0".repeat(64), note: "NENRIN batch" };
  const rc = JSON.stringify(b);
  return { n, work: "NENRIN agreement batch (" + records.length + ")", claim_sha256: sha(rc), record_canonical: rc, schema: "v0-plain", ots_status, bitcoin_block, block_time };
}
// a ledger pool agreement (the rows read as before)
function lagreement(parties) {
  const rec = { schema: "a2a-agreement-v1.1", agreement_id: "ag-" + parties.join(","), parties: parties.map((d, i) => ({ role: i ? "contractor" : "principal", domain: d, key_url: "https://" + d + "/keys/agreement.json" })), publication: "public" };
  const rc = canonicalUtf8(rec);
  return { canonical_sha256: sha(rc), record_canonical: rc, report: { record_schema: "a2a-agreement-v1.1", verdict: "accepted" } };
}
function lbatch(n, items) {
  const b = { schema: "nenrin-agreement-batch-v1", anchored_at: "2026-11-01T00:30:00Z", count: items.length,
    records: items.map((s) => ({ canonical_sha256: s.canonical_sha256, record_schema: s.report.record_schema, verdict: "accepted", verifier_version: "x" })) };
  const rc = JSON.stringify(b);
  return { n, work: "NENRIN agreement batch", claim_sha256: sha(rc), record_canonical: rc, schema: "v0-plain", ots_status: "confirmed", bitcoin_block: 974000 + n, block_time: "2026-11-01T01:00:00Z" };
}

let env, served, asked;
function seed(entries, files, { binding = true } = {}) {
  const put = [["seq", String(Math.max(0, ...entries.map(([e]) => e.n)))]];
  for (const [e, items] of entries) {
    put.push(["entry:" + e.n, JSON.stringify(e)]);
    for (const s of items || []) put.push(["agr:anchored:" + s.canonical_sha256, JSON.stringify({ n: e.n, stored: s })]);
  }
  served = files || {}; asked = [];
  env = { LEDGER: mockKV(put).binding, LEDGER_ADMIN_TOKEN: "t".repeat(64) };
  if (binding) env.AGREEMENT_INTAKE = { fetch: async (req) => { const u = new URL(req.url); asked.push(u.origin + u.pathname);
    const f = served[u.origin + u.pathname]; return f ? new Response(f[1], { status: f[0] }) : new Response(JSON.stringify({ error: "not_found" }), { status: 404 }); } };
}
const resume = async (ep) => {
  const r = await worker.fetch(new Request(ORIGIN + "/resume?endpoint=" + encodeURIComponent(ep)), env, { waitUntil: () => {} });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (_e) {}
  return { status: r.status, j, text };
};
const EP = "https://shield.the-horizons-innovation.com/";
const nc = (j, why) => (j.not_counted || []).filter((x) => x.why === why);

// ---- 1. the run0003 contract in an entry shaped like 83 ----
const E83 = ibatch(83, [crow(E1, RUN3), xrow(1), xrow(2)]);
seed([[E83]], { [INTAKE + "/contract/" + E1]: [200, RUN3] });
let r = await resume(EP);
t("1. the Résumé answers 200 with schema nenrin-resume-v1", r.status === 200 && r.j.schema === "nenrin-resume-v1", r.status);
t("1. agreements[] lists the run0003 contract e1fa47a0 from entry 83", JSON.stringify(r.j.agreements) === JSON.stringify([{ record_sha256: E1, ledger_n: 83 }]), r.j.agreements);
t("1. the executions are neither in agreements[] nor in not_counted (they are evidence, not agreements)", !(r.j.not_counted || []).some((x) => x.kind === "execution") && r.j.agreements.length === 1, r.j.not_counted);
t("1. the bytes were read from the intake's fixed path through the binding, once", JSON.stringify(asked) === JSON.stringify([INTAKE + "/contract/" + E1]), asked);
t("1. nothing about it is in not_counted", !(r.j.not_counted || []).some((x) => x.record_sha256 === E1), r.j.not_counted);
r = await resume("https://the-horizons-innovation.com/");
t("1. the principal's domain sees it too", r.j.agreements.length === 1 && r.j.agreements[0].record_sha256 === E1, r.j.agreements);
const before = asked.length;
r = await resume("https://mcp.horizonshield.dev/mcp");
t("1. another host does not see it, and its bytes are not even fetched", r.j.agreements.length === 0 && asked.length === before && !(r.j.not_counted || []).length, { a: r.j.agreements, asked });

// ---- 2. the same contract pretty printed: contract_sha256 names the terms, not the layout ----
const PRETTY = JSON.stringify(JSON.parse(RUN3), null, 2);
seed([[E83]], { [INTAKE + "/contract/" + E1]: [200, PRETTY] });
r = await resume(EP);
t("2. bytes laid out differently still verify by contract_sha256", r.j.agreements.length === 1 && r.j.agreements[0].record_sha256 === E1 && sha(PRETTY) !== E1, r.j);

// ---- 3. red cases: each is named in not_counted, none is dropped without a word ----
const one = (j) => (j.not_counted || []).filter((x) => x.record_sha256 === E1);
seed([[ibatch(83, [crow(E1, RUN3), xrow(1)], { ots_status: "pending", bitcoin_block: null, block_time: null })]], { [INTAKE + "/contract/" + E1]: [200, RUN3] });
r = await resume(EP);
t("3a. not yet anchored: not in agreements[], named not_yet_anchored with kind contract", r.j.agreements.length === 0 && one(r.j).length === 1 && one(r.j)[0].why === "not_yet_anchored" && one(r.j)[0].kind === "contract" && one(r.j)[0].ots_status === "pending", r.j.not_counted);
seed([[ibatch(83, [crow(E1, RUN3)], { bitcoin_block: 971000, block_time: null })]], { [INTAKE + "/contract/" + E1]: [200, RUN3] });
r = await resume(EP);
t("3b. confirmed without block time: named confirmed_without_block_time", one(r.j).length === 1 && one(r.j)[0].why === "confirmed_without_block_time", r.j.not_counted);
seed([[E83]], {}, { binding: false });
r = await resume(EP);
t("3c. no binding: named intake_bytes_unavailable (no_binding)", r.j.agreements.length === 0 && one(r.j)[0].why === "intake_bytes_unavailable" && one(r.j)[0].detail === "no_binding", r.j.not_counted);
seed([[E83]], {});
r = await resume(EP);
t("3d. the intake answers 404: named intake_bytes_unavailable (http_404)", one(r.j)[0].why === "intake_bytes_unavailable" && one(r.j)[0].detail === "http_404", r.j.not_counted);
seed([[E83]], { [INTAKE + "/contract/" + E1]: [410, JSON.stringify({ error: "withheld" })] });
r = await resume(EP);
t("3e. the intake answers 410 (withheld): named with http_410", one(r.j)[0].why === "intake_bytes_unavailable" && one(r.j)[0].detail === "http_410", r.j.not_counted);
const TAMPER = RUN3.replace('"contract_id":', '"contract_id" :').replace(/"nonce":\s*"([0-9a-f])/, (m, c) => m.slice(0, -1) + (c === "0" ? "1" : "0"));
seed([[E83]], { [INTAKE + "/contract/" + E1]: [200, TAMPER] });
r = await resume(EP);
t("3f. a term changed: named contract_bytes_do_not_match_the_contract_sha256", TAMPER !== RUN3 && r.j.agreements.length === 0 && one(r.j)[0].why === "contract_bytes_do_not_match_the_contract_sha256", r.j.not_counted);
seed([[E83]], { [INTAKE + "/contract/" + E1]: [200, "not json"] });
r = await resume(EP);
t("3g. bytes that are not JSON: named contract_bytes_do_not_match_the_contract_sha256", one(r.j)[0].why === "contract_bytes_do_not_match_the_contract_sha256", r.j.not_counted);
seed([[ibatch(83, [crow(E1, RUN3, { bytes_url: "https://evil.example/contract/" + E1 })])]], { [INTAKE + "/contract/" + E1]: [200, RUN3] });
r = await resume(EP);
t("3h. a bytes_url that is not the intake: named, and nothing is fetched", one(r.j)[0].why === "intake_row_bytes_url_is_not_the_intake" && asked.length === 0, { nc: r.j.not_counted, asked });
const OTHER = canonicalUtf8({ ...parseStrict(RUN3), parties: parseStrict(RUN3).parties.map((p) => ({ ...p, domain: "other.example", key_url: "https://other.example/k.json" })) });
const OS = csha(OTHER);
seed([[ibatch(84, [crow(OS, OTHER, { parties: ["shield.the-horizons-innovation.com"] })])]], { [INTAKE + "/contract/" + OS]: [200, OTHER] });
r = await resume(EP);
t("3i. the row lists the host but the verified record does not: named record_parties_do_not_name_this_host",
  r.j.agreements.length === 0 && (r.j.not_counted || []).some((x) => x.record_sha256 === OS && x.why === "record_parties_do_not_name_this_host"), r.j.not_counted);
seed([[ibatch(85, [crow("XYZ", RUN3, { bytes_url: INTAKE + "/contract/XYZ" })])]], {});
r = await resume(EP);
t("3j. a row whose sha is not 64 hex: named intake_row_sha_is_not_64_hex", (r.j.not_counted || []).some((x) => x.why === "intake_row_sha_is_not_64_hex"), r.j.not_counted);

// ---- 4. an intake agreement row: named by the sha256 of its bytes ----
const AGB = canonicalUtf8({ schema: "a2a-agreement-v1", agreement_id: "intake-ag", parties: [{ role: "principal", domain: "shield.the-horizons-innovation.com", key_url: "https://shield.the-horizons-innovation.com/k.json" }, { role: "contractor", domain: "b.example", key_url: "https://b.example/k.json" }] });
const AGS = sha(AGB);
const arow = { sha: AGS, kind: "agreement", schema: "a2a-agreement-v1", parties: ["shield.the-horizons-innovation.com", "b.example"], bytes_url: INTAKE + "/agreement/" + AGS, agreed_at: null, verifier_version: "x" };
seed([[ibatch(86, [arow])]], { [INTAKE + "/agreement/" + AGS]: [200, AGB] });
r = await resume(EP);
t("4a. an intake agreement whose bytes hash to its sha is listed", JSON.stringify(r.j.agreements) === JSON.stringify([{ record_sha256: AGS, ledger_n: 86 }]), r.j.agreements);
seed([[ibatch(86, [arow])]], { [INTAKE + "/agreement/" + AGS]: [200, AGB + " "] });
r = await resume(EP);
t("4b. one byte more: named agreement_bytes_do_not_hash_to_the_listed_sha", r.j.agreements.length === 0 && (r.j.not_counted || []).some((x) => x.record_sha256 === AGS && x.why === "agreement_bytes_do_not_hash_to_the_listed_sha" && x.kind === "agreement"), r.j.not_counted);

// ---- 5. the ledger's own rows are read as before, and both kinds sort by entry then batch order ----
const LA = lagreement(["shield.the-horizons-innovation.com", "buyer.example.net"]);
seed([[lbatch(90, [LA]), [LA]], [E83]], { [INTAKE + "/contract/" + E1]: [200, RUN3] });
r = await resume(EP);
t("5. agreements[] holds the intake contract (83) then the ledger pool agreement (90)",
  JSON.stringify(r.j.agreements) === JSON.stringify([{ record_sha256: E1, ledger_n: 83 }, { record_sha256: LA.canonical_sha256, ledger_n: 90 }]), r.j.agreements);
seed([[lbatch(90, [LA]), [LA]]], {});
const withB = (await resume(EP)).text;
seed([[lbatch(90, [LA]), [LA]]], {}, { binding: false });
const noB = (await resume(EP)).text;
const norm = (s) => s.replace(/"(evaluated_at|generated_at|now)":"[^"]*"/g, '"$1":"X"');
t("5. with no intake rows, the Résumé is the same with or without the binding", norm(withB) === norm(noB) && asked.length === 0);

console.log("");
if (fail) { console.log("FAIL " + fail + " of " + (pass + fail) + " (the agreement intake's contracts in the Résumé)"); process.exit(1); }
console.log("PASS " + pass + "/" + pass + " (the agreement intake's contracts in the Résumé)");
