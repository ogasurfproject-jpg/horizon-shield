// node test/nenrin_tools.test.mjs : the 1.3.0 NENRIN read tools against a mock ledger (no network).
import worker from "../src/worker.js";
let n = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } n++; };
const seen = [];
const routes = {
  "/resume?endpoint=https%3A%2F%2Fmcp.horizonshield.dev%2Fmcp": [200, { schema: "nenrin-resume-v1", counts: { measurements: 3 }, resume_sha256: "a".repeat(64) }],
  "/trust-signal?endpoint=https%3A%2F%2Fmcp.horizonshield.dev%2Fmcp": [200, { schema: "nenrin-trust-signal-v1", counts: { anchored: 3 } }],
  ["/witness/" + "b".repeat(64)]: [200, { status: "anchored", entry: 58 }],
  "/ledger/head": [200, { n: 64, head: "c".repeat(64) }],
  "/ledger/64?format=json": [200, { n: 64, claim_sha256: "f6400d87" }],
  "/ledger/999?format=json": [404, { error: "not_found" }],
  "/ledger/65?format=json": [503, "upstream"],
};
const env = { LEDGER_SVC: { fetch: async (req) => {
  const u = new URL(req.url); const k = u.pathname + u.search; seen.push(k);
  // Like the real ledger: /ledger/{n} is the HTML receipt page unless ?format=json, ?format=raw or Accept: application/json.
  if (/^\/ledger\/\d+$/.test(u.pathname) && !["json", "raw"].includes(u.searchParams.get("format")) && !(req.headers.get("accept") || "").includes("application/json"))
    return new Response("<!DOCTYPE html><html><body>receipt page</body></html>", { status: 200, headers: { "content-type": "text/html" } });
  const [st, body] = routes[k] || [404, { error: "not_found" }];
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: st });
} } };
async function rpc(method, params) {
  const r = await worker.fetch(new Request("https://jidec.horizonshield.dev/mcp", { method: "POST", headers: { "content-type": "application/json", origin: "https://claude.ai" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), env);
  return (await r.json()).result;
}
const call = (name, args) => rpc("tools/call", { name, arguments: args || {} });

const init = await rpc("initialize", {});
ok(init.serverInfo.version === "1.3.0" && init.instructions.includes("nenrin_resume"), "initialize 1.3.0 names nenrin_resume");
const list = (await rpc("tools/list", {})).tools;
const names = list.map((t) => t.name);
for (const t of ["jidec_cite", "jidec_replay", "jidec_list_paths", "jidec_how_to_verify", "nenrin_resume", "nenrin_trust_signal", "nenrin_witness", "nenrin_ledger_head", "nenrin_ledger_entry"]) ok(names.includes(t), "tool listed: " + t);
ok(list.every((t) => t.annotations.readOnlyHint === true && t.outputSchema && t.inputSchema), "every tool read-only with schemas");

let r = await call("nenrin_resume", { endpoint: "https://mcp.horizonshield.dev/mcp" });
ok(!r.isError && r.structuredContent.lookup === "ok" && r.structuredContent.counts.measurements === 3, "resume ok");
ok(r.structuredContent.source_url === "https://ledger.horizonshield.dev/resume?endpoint=https%3A%2F%2Fmcp.horizonshield.dev%2Fmcp", "resume source_url");
ok(r.structuredContent.does_not_establish.length === 4, "resume carries does_not_establish");
r = await call("nenrin_trust_signal", { endpoint: "https://mcp.horizonshield.dev/mcp" });
ok(r.structuredContent.counts.anchored === 3, "trust signal ok");
r = await call("nenrin_resume", { endpoint: "http://insecure.example/mcp" });
ok(r.isError && /https/.test(r.content[0].text), "http endpoint refused");
r = await call("nenrin_witness", { sha256: "B".repeat(64) });
ok(r.structuredContent.lookup === "ok" && r.structuredContent.entry === 58, "witness by sha, case folded");
r = await call("nenrin_witness", { sha256: "xyz" });
ok(r.isError, "bad sha refused");
r = await call("nenrin_ledger_head", {});
ok(r.structuredContent.n === 64, "head");
r = await call("nenrin_ledger_entry", { n: 64 });
ok(r.structuredContent.claim_sha256 === "f6400d87", "entry 64");
ok(seen.includes("/ledger/64?format=json") && r.structuredContent.source_url === "https://ledger.horizonshield.dev/ledger/64?format=json", "entry read asks the ledger for JSON, not the HTML page");
r = await call("nenrin_ledger_entry", { n: 999 });
ok(!r.isError && r.structuredContent.lookup === "absent", "404 is absent, not an error");
r = await call("nenrin_ledger_entry", { n: 65 });
ok(r.isError && /NOT a statement/.test(r.content[0].text), "503 is an error, never absent");
r = await call("nenrin_ledger_entry", { n: 0 });
ok(r.isError, "n=0 refused");
// jidec_cite names a record's own schema (2026-10-13): a NENRIN batch is not a v0 estimate entry.
const shaHex = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const batch = JSON.stringify({ schema: "nenrin-agreement-batch-v1", count: 1, records: [] });
const v0rec = JSON.stringify({ estimate: { total: 1 } });
const bSha = await shaHex(batch), vSha = await shaHex(v0rec);
routes["/ledger/88?format=raw"] = [200, batch];
routes["/ledger/88?format=json"] = [200, { n: 88, claim_sha256: bSha, ots_status: "confirmed", bitcoin_block: 971024 }];
routes["/ledger/3?format=raw"] = [200, v0rec];
routes["/ledger/3?format=json"] = [200, { n: 3, claim_sha256: vSha, ots_status: "confirmed", bitcoin_block: 900000 }];
r = await call("jidec_cite", { citation: "jidec:entry:88" });
ok(!r.isError && r.structuredContent.integrity.match === true && r.structuredContent.record_kind === "nenrin-agreement-batch-v1", "a NENRIN batch is reported under its own schema");
ok(/nenrin-agreement-batch-v1 record/.test(r.structuredContent.note) && !/estimate/.test(r.structuredContent.limits), "its note names the schema and its limits do not talk about an estimate");
r = await call("jidec_cite", { citation: "jidec:entry:3" });
ok(r.structuredContent.record_kind === "v0" && /predates the v1 schemas/.test(r.structuredContent.note) && /estimate is fair/.test(r.structuredContent.limits), "a record with no schema stays v0 with the estimate limits");
// 2026-10-30: a plain-text record (#194, a plan) is named as one, with limits that do not talk about an estimate (same as hs-ledger /cite).
const plainRec = "# FURUI blind-04: the plan\n\n**Status:** a plan record, anchored before the draw.\n";
const pSha = await shaHex(plainRec);
routes["/ledger/194?format=raw"] = [200, plainRec];
routes["/ledger/194?format=json"] = [200, { n: 194, claim_sha256: pSha, ots_status: "confirmed", bitcoin_block: 973640 }];
r = await call("jidec_cite", { citation: "jidec:entry:194" });
ok(!r.isError && r.structuredContent.integrity.match === true && r.structuredContent.record_kind === "v0-plain", "a plain-text record keeps its kind v0-plain");
ok(/plain-text record/.test(r.structuredContent.note) && !/predates/.test(r.structuredContent.note) && !/estimate/.test(r.structuredContent.limits), "its note says plain text and its limits do not talk about an estimate");
const card = await (await worker.fetch(new Request("https://jidec.horizonshield.dev/.well-known/agent-card.json"), env)).json();
ok(card.version === "1.2.2", "signed card version 1.2.2");
ok(card.provider && card.provider.legalEntity && card.provider.legalEntity.id === "7021001075279", "provider.legalEntity houjin-bango");
ok((card.capabilities.extensions || []).some((e) => e.uri === "https://gate.horizonshield.dev/ext/legal-entity/v1" && e.params && e.params.id === card.provider.legalEntity.id && e.params.name === card.provider.legalEntity.name), "legal-entity-v1 params mirror provider.legalEntity");
ok(Array.isArray(card.securityRequirements) && card.securityRequirements.length === 1 && Object.keys(card.securityRequirements[0]).length === 0 && !card.securitySchemes, "securityRequirements [{}] and no invented scheme");
console.log("ALL PASS (hs-jidec-mcp 1.3.0 NENRIN tools: " + n + " checks)");
