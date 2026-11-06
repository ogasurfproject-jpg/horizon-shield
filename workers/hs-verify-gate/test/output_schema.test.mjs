// output_schema.test.mjs (2026-10-07): every top-level field a tool returns is declared in its outputSchema.
//
// Why this exists. get_conditions declared 3 properties and returned 19. lookup_server declared 7 and returned 16
// for an endpoint on the register. preflight_agent declared no outputSchema at all. check_conformance declared
// `pass` and `conditions`, which it never returned. A consumer reading the contract saw a different object from
// the one it received, on the gate that measures other people's contracts (condition 06 reads outputSchema).
//
// What it does. It calls all six tools through worker.fetch, in every shape each one can answer with (absent,
// watched, measured, held, consent or none, matching or altered record), and checks:
//   1. every top-level key of structuredContent is in outputSchema.properties,
//   2. the value has one of the declared types,
//   3. every declared property has a type and a one-line description,
//   4. every declared property was actually returned in at least one call (no declaration nothing backs),
//      except the one listed in NOT_EXERCISED with the reason,
//   5. additionalProperties is still true,
//   6. what the tools return did not change: the verdict still hashes to its own record_sha256.
// No network: fetch is replaced. Run: node test/output_schema.test.mjs   (in workers/hs-verify-gate)
import worker from "../src/worker.js";

const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const jres = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const EXT = "https://gate.horizonshield.dev/ext/conduct/v1";
const COMP = { paid_by: "public", referral_fee: false, listing_fee: false, success_fee_pct: 0, disclosure_url: "https://example.invalid/disclosure" };
const EP = "https://open.redteam.invalid/mcp";
const DOWN = "https://down.redteam.invalid/mcp";
const CARD = { name: "rt", description: "redteam card", url: EP, version: "1", skills: [], compensation: COMP,
  capabilities: { extensions: [{ uri: EXT, params: { compensation: COMP, measured_endpoints: [EP, "https://never.redteam.invalid/mcp"],
    witness_intake: "https://ledger.redteam.invalid/witness", conduct_record: "https://ledger.redteam.invalid/record" } }] } };
const TOOLS = [
  { name: "alpha", description: "redteam tool alpha", inputSchema: { type: "object", properties: {} } },
  { name: "beta", description: "redteam tool beta", inputSchema: { type: "object", properties: {} } }
];
function kv() {
  const store = new Map();
  return {
    store,
    get: async (k, type) => { const v = store.has(k) ? store.get(k) : null; return ((type === "json" || (type && type.type === "json")) && v !== null) ? JSON.parse(v) : v; },
    put: async (k, v) => { store.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    delete: async (k) => { store.delete(k); },
    list: async (o) => ({ keys: [...store.keys()].filter((k) => k.startsWith((o && o.prefix) || "")).map((name) => ({ name })), list_complete: true }),
  };
}
const HASH_A = "aa".repeat(32);
const WELLKNOWN = new Map([["open.redteam.invalid", { allow_tool_call: true }]]);
globalThis.fetch = async (url, init) => {
  const u = new URL(typeof url === "string" ? url : url.url);
  if (u.hostname === "mempool.space" || u.hostname === "blockstream.info") {
    if (u.pathname === "/api/blocks/tip/height") return new Response("900006");
    if (/^\/api\/block-height\//.test(u.pathname)) return new Response(HASH_A);
    if (/^\/api\/block\//.test(u.pathname)) return jres({ id: HASH_A, height: 900000, timestamp: Math.floor(Date.now() / 1000) + 3600 });
    return new Response("", { status: 404 });
  }
  if (u.hostname === "ledger.horizonshield.dev") return jres({ ok: true }, 201);
  if (u.hostname === "raw.githubusercontent.com") return new Response("404: Not Found", { status: 404 });
  if (u.hostname === "down.redteam.invalid") throw new Error("connect ECONNREFUSED");
  if (u.hostname === "html.redteam.invalid") return new Response("<html>hi</html>", { status: 200, headers: { "content-type": "text/html" } });
  if (!/\.redteam\.invalid$/.test(u.hostname)) return new Response("no", { status: 500 });
  if (u.pathname === "/.well-known/mcp-conduct.json") { const b = WELLKNOWN.get(u.hostname); return b ? jres(b) : new Response("", { status: 404 }); }
  if (u.pathname === "/.well-known/agent-card.json") return u.hostname === "plain.redteam.invalid" ? jres({ name: "Plain", capabilities: {} }) : jres(CARD);
  if (u.pathname === "/mcp" && (init && init.method) === "POST") {
    const body = JSON.parse(init.body); const id = body.id;
    if (body.method === "initialize") return jres({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "rt", version: "0" }, capabilities: { tools: {} } } });
    if (body.method === "tools/list") return jres({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    if (body.method === "tools/call") return jres({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "constant answer" }] } });
    return jres({ jsonrpc: "2.0", id, error: { code: -32601, message: "nope" } });
  }
  return new Response("not found", { status: 404 });
};

const env = { HS_VERIFY_KV: kv(), SWEEP_TOKEN: "schema-sweep-token", GATE_COMMIT: "schema-local", SUBREQUEST_BUDGET: 1000 };
const O = "https://gate.horizonshield.dev";
const post = (p, b, h) => worker.fetch(new Request(O + p, { method: "POST", headers: { "content-type": "application/json", ...(h || {}) }, body: JSON.stringify(b) }), env, CTX);
let rid = 0;
const rpc = async (method, params) => (await (await post("/mcp", { jsonrpc: "2.0", id: ++rid, method, params })).json()).result;
const call = (name, args) => rpc("tools/call", { name, arguments: args });

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log((ok ? "ok   " : "NG   ") + name + (ok || detail === undefined ? "" : "  <<< " + detail));
};

const jsonType = (v) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v;
const typeOk = (declared, v) => {
  const ts = Array.isArray(declared) ? declared : [declared];
  const got = jsonType(v);
  return ts.includes(got) || (got === "integer" && ts.includes("number"));
};

const tools = (await rpc("tools/list", {})).tools;
const NAMES = ["get_conditions", "check_conformance", "verify_verdict", "lookup_server", "is_verified", "preflight_agent"];
t("tools/list carries exactly the six tools", JSON.stringify(tools.map((x) => x.name)) === JSON.stringify(NAMES), JSON.stringify(tools.map((x) => x.name)));
const schemaOf = Object.fromEntries(tools.map((x) => [x.name, x.outputSchema]));

// 3 and 5: the declaration itself.
for (const n of NAMES) {
  const sc = schemaOf[n];
  t(n + ": declares an outputSchema of type object", !!sc && sc.type === "object" && sc.properties && typeof sc.properties === "object");
  if (!sc || !sc.properties) continue;
  t(n + ": additionalProperties is still true", sc.additionalProperties === true, String(sc.additionalProperties));
  const bad = Object.entries(sc.properties).filter(([, p]) => {
    const ts = Array.isArray(p.type) ? p.type : [p.type];
    const typed = ts.length > 0 && ts.every((x) => ["string", "number", "integer", "boolean", "object", "array", "null"].includes(x));
    const described = typeof p.description === "string" && p.description.length > 0 && !p.description.includes("\n");
    return !(typed && described);
  }).map(([k]) => k);
  t(n + ": every declared property has a type and a one-line description", bad.length === 0, bad.join(", "));
}

// 1, 2 and 4: call the tools.
const returned = Object.fromEntries(NAMES.map((n) => [n, new Set()]));
let calls = 0;
async function shape(name, label, args, expect) {
  const r = await call(name, args);
  calls++;
  const s = r && r.structuredContent;
  if (!s || r.isError) { t(name + " [" + label + "]: answered with a structured result", false, JSON.stringify(r).slice(0, 200)); return {}; }
  const props = schemaOf[name].properties;
  const keys = Object.keys(s);
  for (const k of keys) returned[name].add(k);
  const undeclared = keys.filter((k) => !(k in props));
  const mistyped = keys.filter((k) => k in props && !typeOk(props[k].type, s[k])).map((k) => k + " is " + jsonType(s[k]) + ", declared " + JSON.stringify(props[k].type));
  t(name + " [" + label + "]: all " + keys.length + " top-level fields are declared", undeclared.length === 0, "undeclared: " + undeclared.join(", "));
  t(name + " [" + label + "]: every field has a declared type", mistyped.length === 0, mistyped.join("; "));
  if (expect) t(name + " [" + label + "]: is the shape this case is meant to exercise", expect(s), JSON.stringify(s).slice(0, 200));
  return s;
}

await shape("get_conditions", "the only shape", {});

const verdict = await shape("check_conformance", "consent on the origin, tool called", { endpoint: EP }, (s) => s.status === "verified" && s.consent_source === "well_known" && !("consent_lookup" in s));
await shape("check_conformance", "no consent, no tool call", { endpoint: "https://noconsent.redteam.invalid/mcp" }, (s) => s.consent_source === "none" && "consent_lookup" in s);
// 2026-10-08 (FIX_LIST 6): an assertion without proof calls no tool and says so
await shape("check_conformance", "consent asserted by the requester, not proven", { endpoint: "https://noconsent.redteam.invalid/mcp", allow_tool_call: true }, (s) => s.consent_source === "none" && typeof s.consent_assertion_ignored === "object" && s.checks.determinism.measured === false);
await shape("check_conformance", "unreachable", { endpoint: DOWN }, (s) => s.status === "held" && s.reachable === false);
await shape("check_conformance", "answers, but not MCP", { endpoint: "https://html.redteam.invalid/mcp" }, (s) => s.status === "pending" && s.reachable === true);

const vOk = await shape("verify_verdict", "untouched verdict", { record: verdict }, (s) => s.verified === true);
await shape("verify_verdict", "altered verdict", { record: { ...verdict, endpoint: "https://evil.redteam.invalid/mcp" } }, (s) => s.verified === false && "recomputed_sha256" in s);
await shape("verify_verdict", "record without record_sha256", { record: { a: 1 } }, (s) => s.verified === false && "reason" in s);
await shape("verify_verdict", "no record at all", {}, (s) => s.verified === false && "reason" in s);
await shape("verify_verdict", "record_sha256 that is not a string", { record: { a: 1, record_sha256: 7 } }, (s) => s.verified === false && s.expected_sha256 === 7);

await shape("lookup_server", "absent", { endpoint: EP }, (s) => s.on_register === false && "register_size" in s);
await shape("is_verified", "absent", { endpoint: EP }, (s) => s.state === "absent" && s.verified === null);
await post("/watch", { endpoint: EP });
await post("/watch", { endpoint: DOWN });
await shape("lookup_server", "watched, not yet measured", { endpoint: EP }, (s) => s.on_register === true && s.measurements === 0 && s.latest === null);
await shape("is_verified", "watched, not yet measured", { endpoint: EP }, (s) => s.state === "watched" && s.verified === null);
for (let i = 0; i < 3; i++) await post("/sweep", { force: true }, { "x-sweep-token": "schema-sweep-token" });
await shape("lookup_server", "measured and passing", { endpoint: EP }, (s) => s.standing === "measured" && s.latest && s.latest.status === "verified");
await shape("is_verified", "measured and passing", { endpoint: EP }, (s) => s.state === "verified" && s.verified === true);
await shape("lookup_server", "measured, unreachable", { endpoint: DOWN }, (s) => s.latest && s.latest.status === "held");
await shape("is_verified", "measured, unreachable", { endpoint: DOWN }, (s) => s.state === "held" && s.verified === null);

await shape("preflight_agent", "card declares the extension", { agent: "https://open.redteam.invalid" }, (s) => s.extension_declared === true && s.register.length === 2 && typeof s.conduct_record === "string");
await shape("preflight_agent", "card declares nothing", { agent: "https://plain.redteam.invalid" }, (s) => s.extension_declared === false && s.compensation === null && s.witness_intake === null);
const pfDown = await call("preflight_agent", { agent: "https://down.redteam.invalid" });
t("preflight_agent [card unreachable]: a tool error, with no structured object to hold against the schema", pfDown.isError === true && pfDown.structuredContent === undefined);

// 4: nothing is declared that no call returned.
// measurement_note is written only when the gate's own relay path fails (gateSide in runCheck). This suite runs the
// gate in the direct context, where that path does not exist, so the field is declared from the source and not exercised here.
const NOT_EXERCISED = { check_conformance: ["measurement_note"] };
for (const n of NAMES) {
  const declared = Object.keys(schemaOf[n].properties);
  const never = declared.filter((k) => !returned[n].has(k) && !(NOT_EXERCISED[n] || []).includes(k));
  t(n + ": every declared property was returned by at least one call (" + declared.length + " declared, " + returned[n].size + " returned)", never.length === 0, "declared, never returned: " + never.join(", "));
}
t("the fields declared without being exercised are still in the schema (the exception list is not stale)",
  Object.entries(NOT_EXERCISED).every(([n, ks]) => ks.every((k) => k in schemaOf[n].properties && !returned[n].has(k))));

// The counts the task was stated in, pinned so a silent change shows up here.
// 0.4.24 adds mcp_client (how the gate calls an MCP endpoint): 19 became 20.
t("get_conditions returns 20 top-level fields and declares 20", returned.get_conditions.size === 20 && Object.keys(schemaOf.get_conditions.properties).length === 20, returned.get_conditions.size + " returned");
t("lookup_server returns 16 fields for an endpoint on the register, 7 for an absent one, 19 distinct, and declares 19",
  returned.lookup_server.size === 19 && Object.keys(schemaOf.lookup_server.properties).length === 19, returned.lookup_server.size + " distinct");

// get_conditions is deterministic and has no read to fail. Its schema says it declares no read-state field; hold it to that.
const gc = schemaOf.get_conditions.properties;
const stateLike = Object.entries(gc).filter(([, p]) => [].concat(p.type).includes("boolean") || (Array.isArray(p.enum) && p.enum.length >= 2)).map(([k]) => k);
t("get_conditions still declares no boolean and no enum (condition 06 keeps scoring it flat, as its description says)", stateLike.length === 0, stateLike.join(", "));

// lookup_server: one record, said first.
const lookup = tools.find((x) => x.name === "lookup_server");
t("lookup_server: the description opens with 'Returns one record (not a list).'", lookup.description.startsWith("Returns one record (not a list)."), lookup.description.slice(0, 60));
t("lookup_server: the outputSchema description says the same", /^Returns one record \(not a list\)/.test(lookup.outputSchema.description || ""));

// 6: content unchanged. The verdict produced above hashes to its own record_sha256, recomputed here without the gate.
{
  const { createHash } = await import("node:crypto");
  const body = JSON.parse(JSON.stringify(verdict)); delete body.record_sha256; delete body.recompute_note;
  const got = createHash("sha256").update(Buffer.from(JSON.stringify(body), "utf8")).digest("hex");
  t("the verdict still hashes to its own record_sha256 (recomputed here, not by the gate)", got === verdict.record_sha256, got + " vs " + verdict.record_sha256);
  t("verify_verdict agrees", vOk.verified === true && vOk.recomputed_sha256 === verdict.record_sha256);
  const again = await call("get_conditions", {});
  const first = await call("get_conditions", {});
  t("get_conditions returns identical bytes twice", JSON.stringify(again.structuredContent) === JSON.stringify(first.structuredContent));
}

console.log("");
if (fail) { console.log("FAIL " + fail + " of " + (pass + fail) + " (output_schema, " + calls + " tool calls)"); process.exit(1); }
console.log("PASS " + pass + "/" + pass + " (output_schema: " + calls + " tool calls, every returned top-level field is declared)");
process.exit(0);
