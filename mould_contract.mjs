#!/usr/bin/env node
// mould_contract.mjs ,  Federico's rule at the CONTRACT layer. READ-ONLY. Never tools/call.
//
// Rule (Federico Blanco Sanchez-Llanos, "The Mould, Not the Letter", 2026-08-20):
//   never let "the fetch failed" and "the fetch succeeded and found nothing"
//   collapse into the same downstream value.
//
// WHY THIS PROBE EXISTS
//   The first probe measured the PROTOCOL layer (unknown method / resource / prompt).
//   Everyone passed ,  the SDK forces it. That layer is thin.
//   The layer the rule actually bites is inside a tool: it looked, found nothing,
//   and had to decide what the consumer receives. Watching that at runtime needs
//   tools/call, which we will not do to strangers.
//
//   But the question "CAN the consumer tell the two apart?" is answered before
//   runtime ,  by the CONTRACT. tools/list returns it. tools/list executes nothing.
//   So the deep layer IS measurable, read-only, across the whole population.
//
// WHAT IS MEASURED (per tool)
//   OPAQUE      no outputSchema. The consumer receives free text and has, by
//               contract, NO programmatic way to separate "failed" from "empty".
//   FLAT        outputSchema exists, but declares no field that can hold a STATE.
//   DISCRIMINATING  outputSchema declares at least one boolean, or one enum with
//               2+ values ,  a place where "read ok / read failed / nothing matched"
//               can actually live. Field names are NOT consulted (see v0.4 note).
//
// HONEST LIMITS ,  state these wherever the numbers are published:
//   1. A schema is a declaration, not behaviour. A tool with a good schema can still
//      collapse at runtime; a tool with no schema may return prose a reader can tell
//      apart. This measures the contract offered to the consumer, nothing more.
//   2. This test replaced a field-NAME list on 2026-08-20 after that list was caught
//      under-counting our own repaired endpoints. Any number produced by the older
//      lexical version is an UPPER BOUND on the problem, not a measurement of it.
//   3. outputSchema arrived in protocol revision 2025-06-18. Part of what a low score
//      measures is when the server was written, not only what its author cared about.
//
// Own endpoints are measured FIRST. Population sample is spread, slow, capped.
// Run:  node mould_contract.mjs [sample_N] [endpoints_file]
//   e.g. node mould_contract.mjs 30
//        node mould_contract.mjs 0     <- own endpoints only, touch nobody else

import fs from "node:fs";

const OWN = [
  "https://mcp.horizonshield.dev/mcp",
  "https://hearing.horizonshield.dev/mcp",
  "https://web.horizonshield.dev/mcp",
  "https://jidec.horizonshield.dev/mcp",
  "https://p001.horizonshield.dev/mcp",
  "https://p002.horizonshield.dev/mcp",
  "https://gate.horizonshield.dev/mcp",
];

let N = process.argv[2] === undefined ? 20 : parseInt(process.argv[2], 10);
if (Number.isNaN(N) || N < 0) N = 20;
const CAP = 100;
if (N > CAP) { console.error(`Refusing N=${N}; capped at ${CAP}. Do not blast the list.`); N = CAP; }
const FILE = process.argv[3] || "survey/survey0_v4_endpoints_active_2026-08-19.txt";

// Protocol versions to try, newest first ,  a server that rejects one may accept another.
const PROTOS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const PAUSE = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- heuristics, printed at run time so they can be disputed -----------------
const DISCRIMINATING_FIELD =
  /^(error|errors|is_?error|status|state|found|ok|success|succeeded|failed|failure|reason|code|message|detail|empty|count|total|num_?results?|result_?count|matched|matches|hits)$/i;
const DESC_NOTFOUND = /not found|no (results?|matches?|records?|data|items?)|empty|zero results|nothing found|if none/i;
const DESC_ERROR = /\berrors?\b|\bfails?\b|\bfailure\b|\bexception\b|\bunavailable\b|\bthrows?\b|\btimeout\b/i;
// ---------------------------------------------------------------------------

async function post(url, body, session, proto) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": proto,
  };
  if (session) headers["Mcp-Session-Id"] = session;
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000) });
    const raw = await res.text();
    return { status: res.status, ct: res.headers.get("content-type") || "",
             sid: res.headers.get("mcp-session-id"), raw, err: null };
  } catch (e) { return { status: null, ct: "", sid: null, raw: "", err: String(e) }; }
}
function parseRpc(ct, raw) {
  if (!raw) return null;
  if (ct.includes("text/event-stream") || /^\s*event:/.test(raw) ||
      raw.includes("\ndata:") || raw.startsWith("data:")) {
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith("data:")) { try { return JSON.parse(t.slice(5).trim()); } catch {} }
    }
    return null;
  }
  try { return JSON.parse(raw); } catch { return null; }
}
function allKeys(node, out = [], depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return out;
  if (Array.isArray(node)) { for (const v of node) allKeys(v, out, depth + 1); return out; }
  for (const [k, v] of Object.entries(node)) {
    if (k === "properties" && v && typeof v === "object" && !Array.isArray(v)) {
      for (const pk of Object.keys(v)) out.push(pk);
    }
    allKeys(v, out, depth + 1);
  }
  return out;
}

// v0.4 ,  the classifier was lexical and it under-counted.
//
// v0.3 matched field NAMES against a list (error|status|found|ok|count|...).
// Measuring our own fixed endpoints exposed the flaw: hs-verify-gate declares
// on_register (boolean) and verified (boolean), hs-hearing declares roster_read
// (boolean), and hs-mcp declares failure_reason. All of them genuinely carry the
// difference. All were scored FLAT, because the list had never heard of those words.
//
// The obvious repair ,  add on_register|verified|roster_read to the list ,  is the
// one thing that must not be done. That is tuning the ruler to the thing being
// measured, by an author who owns some of the things being measured. Any score it
// produced afterwards would be worthless, and worse, would look good.
//
// So the test is now STRUCTURAL and name-independent: can the declared contract
// carry a STATE at all? A boolean field has two states. An enum has its listed
// states. Those are the shapes a "read succeeded / read failed / nothing matched"
// distinction can actually live in, whatever the author chose to call it.
//
// A bare count is deliberately NOT enough. count: 0 does not tell a consumer the
// source was read ,  a careless implementation returns 0 on failure too. That
// judgement cost us: it means a fix we shipped earlier today (adding count to
// fourteen hs-mcp schemas) does not pass this bar, and the number below says so.
function collectTyped(node, out = []) {
  // v2, 2026-08-20, Federico's refinement: only the ENVELOPE (top-level properties of
  // the outputSchema), not fields nested inside the domain payload. Read-state lives in
  // the envelope; a job's remote:boolean lives inside the job object and is not one.
  // This strips the entity-nested false-positive class without dropping real read-states
  // (ours are all top-level). It cannot separate a top-level metadata boolean from a
  // top-level read-state, so the field names stay published for a human to judge.
  const props = (node && node.properties && typeof node.properties === "object" && !Array.isArray(node.properties))
    ? node.properties : {};
  for (const [pk, pv] of Object.entries(props)) {
    if (!pv || typeof pv !== "object") continue;
    const t = pv.type;
    const types = Array.isArray(t) ? t : (t ? [t] : []);
    const isBool = types.includes("boolean");
    const isEnum = Array.isArray(pv.enum) && pv.enum.length >= 2;
    if (isBool || isEnum) out.push({ name: pk, kind: isEnum ? "enum" : "boolean" });
  }
  return out;
}

function classifyTool(tool) {
  const desc = String(tool.description || "");
  const out = tool.outputSchema;
  const hasOut = !!(out && typeof out === "object" && Object.keys(out).length);
  const descNF = DESC_NOTFOUND.test(desc);
  const descER = DESC_ERROR.test(desc);
  if (!hasOut) {
    return { cls: "OPAQUE", fields: [], descNF, descER };
  }
  // structural: a boolean or an enum can hold a state. Nothing else is counted,
  // and no field name is privileged.
  const typed = collectTyped(out);
  const seen = new Set();
  const disc = [];
  for (const f of typed) {
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    disc.push(f.name + ":" + f.kind);
  }
  return { cls: disc.length ? "DISCRIMINATING" : "FLAT", fields: disc, descNF, descER };
}

async function inspect(url) {
  // initialize, retrying across protocol versions; honour a server's advertised list.
  //
  // v0.2 FIX ,  this function broke Federico's own rule.
  //   v0.1 retried all three protocol versions whether the endpoint had REFUSED the
  //   version (a real answer: "not that one") or had simply not answered at all
  //   (a dead host, a timeout). Two different negative outcomes, collapsed into one
  //   downstream value: "try the next version". A dead host cost 3 x 20s instead of
  //   one, which is how it looked like a hang. The probe for the collapse collapsed.
  //   Now: no HTTP response at all -> stop, report UNREACHABLE, do not retry.
  let init = null, sid = null, proto = null, initHttp = null, tried = [], dead = false;
  for (const p of PROTOS) {
    const i = await post(url, { jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: p, capabilities: {},
                clientInfo: { name: "mould-contract", version: "0.1" } } }, null, p);
    initHttp = i.status; tried.push(p);
    // "the fetch failed" is NOT "the server said no" ,  keep them apart.
    if (i.status === null) { dead = true; break; }
    const o = parseRpc(i.ct, i.raw);
    if (o && o.result) { init = o; sid = i.sid; proto = p; break; }
    // server told us which versions it speaks -> take the newest it offers
    const sup = o && o.error && o.error.data && o.error.data.supportedVersions;
    if (Array.isArray(sup) && sup.length) {
      const pick = sup[0];
      if (!tried.includes(pick)) {
        await sleep(PAUSE);
        const j = await post(url, { jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: pick, capabilities: {},
                    clientInfo: { name: "mould-contract", version: "0.1" } } }, null, pick);
        initHttp = j.status; tried.push(pick);
        const jo = parseRpc(j.ct, j.raw);
        if (jo && jo.result) { init = jo; sid = j.sid; proto = pick; break; }
      }
    }
    await sleep(PAUSE);
  }
  if (!init) return { url, ok: false, dead, initHttp, tried, tools: [] };

  if (sid) { await sleep(PAUSE);
    await post(url, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, sid, proto); }
  await sleep(PAUSE);

  // tools/list ,  a listing. Executes nothing.
  const t = await post(url, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sid, proto);
  const to = parseRpc(t.ct, t.raw);
  const tools = (to && to.result && Array.isArray(to.result.tools)) ? to.result.tools : [];
  return { url, ok: true, initHttp, proto, tools: tools.map((x) => ({ name: x.name, ...classifyTool(x) })) };
}

function report(label, results) {
  const bar = "-".repeat(72);
  console.log(`\n${bar}\n${label}\n${bar}`);
  let O = 0, F = 0, D = 0, servers = 0, opaqueServers = 0;
  for (const r of results) {
    if (!r.ok) {
      // report the two negatives separately ,  that is the whole point
      console.log(r.dead
        ? `  [unreachable] ${r.url}  (no HTTP response; not retried)`
        : `  [answered, not MCP here] ${r.url}  (http=${r.initHttp}, tried ${r.tried})`);
      continue;
    }
    servers++;
    const o = r.tools.filter((t) => t.cls === "OPAQUE").length;
    const f = r.tools.filter((t) => t.cls === "FLAT").length;
    const d = r.tools.filter((t) => t.cls === "DISCRIMINATING").length;
    O += o; F += f; D += d;
    if (r.tools.length && d === 0) opaqueServers++;
    console.log(`  ${r.url}`);
    console.log(`      tools=${r.tools.length}  OPAQUE=${o}  FLAT=${f}  DISCRIMINATING=${d}   [proto ${r.proto}]`);
    for (const t of r.tools.slice(0, 6)) {
      const extra = t.fields.length ? ` fields:{${t.fields.join(",")}}` : "";
      const dsc = (t.descNF ? " desc:not-found" : "") + (t.descER ? " desc:error" : "");
      console.log(`        - ${String(t.name).slice(0, 44).padEnd(44)} ${t.cls}${extra}${dsc}`);
    }
    if (r.tools.length > 6) console.log(`        ... ${r.tools.length - 6} more`);
  }
  const tot = O + F + D;
  console.log(`\n  SERVERS spoke MCP: ${servers}   TOOLS seen: ${tot}`);
  if (tot) {
    console.log(`    OPAQUE         (no outputSchema at all) : ${O}  (${(100*O/tot).toFixed(1)}%)`);
    console.log(`    FLAT           (schema, no discriminator): ${F}  (${(100*F/tot).toFixed(1)}%)`);
    console.log(`    DISCRIMINATING (can hold the difference) : ${D}  (${(100*D/tot).toFixed(1)}%)`);
    console.log(`    => tools whose CONTRACT gives the consumer no way to separate`);
    console.log(`       "failed" from "found nothing": ${O + F}  (${(100*(O+F)/tot).toFixed(1)}%)`);
    console.log(`    servers where NOT ONE tool can hold the difference: ${opaqueServers}/${servers}`);
  }
  return { O, F, D, servers, opaqueServers };
}

// v0.3 ,  a run that prints nothing until it finishes makes "still working" and
// "hung" arrive at the operator as the same value: a blinking cursor. That is the
// same collapse this probe is about, at the human boundary. So: emit one line per
// endpoint, as it completes, with a counter.
function liveLine(i, n, r) {
  const tag = `[${String(i).padStart(2)}/${n}]`;
  if (!r.ok) {
    return `${tag} ${r.dead ? "UNREACHABLE      " : "answered-not-MCP "} ${r.url}`;
  }
  const o = r.tools.filter((t) => t.cls === "OPAQUE").length;
  const f = r.tools.filter((t) => t.cls === "FLAT").length;
  const d = r.tools.filter((t) => t.cls === "DISCRIMINATING").length;
  const verdict = r.tools.length === 0 ? "no tools" : (d === 0 ? "CANNOT hold diff" : `${d} can hold diff`);
  return `${tag} MCP ok  tools=${String(r.tools.length).padStart(3)}  O=${o} F=${f} D=${d}  ${verdict.padEnd(16)} ${r.url}`;
}

(async () => {
  const bar = "=".repeat(72);
  console.log(bar);
  console.log("MOULD PROBE ,  CONTRACT layer (READ-ONLY, tools/list only, NO tools/call)");
  console.log("METHOD (published before results):");
  console.log("  initialize (retrying protocol versions, honouring supportedVersions),");
  console.log("  then tools/list ,  a listing, which executes nothing.");
  console.log("  Each tool is classed by whether its declared contract can carry the");
  console.log("  difference between 'the fetch failed' and 'it found nothing'.");
  console.log("  TEST USED (structural, name-independent ,  argue with it):");
  console.log("    a contract can hold the difference if it declares at least one");
  console.log("    boolean field, or an enum with 2+ values. Those are the shapes a");
  console.log("    read-succeeded / read-failed / nothing-matched state can live in.");
  console.log("    Field NAMES are deliberately not consulted: the author of this");
  console.log("    probe also owns some of the endpoints it scores, and a name list");
  console.log("    would let him score himself well by renaming his own fields.");
  console.log("    A bare count does NOT pass: count 0 does not prove the read worked.");
  console.log("  LIMIT: a schema is a declaration, not behaviour. This measures the");
  console.log("  contract offered to the consumer. Runtime behaviour needs tools/call,");
  console.log("  which is only done where consent exists.");
  console.log("  Own endpoints measured FIRST. ~1.5s between requests.");
  console.log(bar);

  const t0 = Date.now();
  const own = [];
  console.log(`\nprobing own ${OWN.length} endpoints (live, one line each as it lands):`);
  for (const u of OWN) {
    const r = await inspect(u);
    own.push(r);
    console.log(liveLine(own.length, OWN.length, r));
    await sleep(PAUSE);
  }
  const ownAgg = report(`OWN ENDPOINTS (${OWN.length}) ,  we measure ourselves first`, own);

  let popAgg = null;
  if (N > 0) {
    let all = fs.readFileSync(FILE, "utf8").split(/\r?\n/).map((s) => s.trim())
      .filter(Boolean).filter((u) => /^https?:\/\//.test(u))
      .filter((u) => !/horizonshield\.dev/.test(u));
    const step = Math.max(1, Math.floor(all.length / N));
    const sample = [];
    for (let i = 0; i < all.length && sample.length < N; i += step) sample.push(all[i]);
    console.log(`\n(population: ${all.length} usable, sampling ${sample.length} every ${step}th line)`);
    console.log(`each line lands as that endpoint answers; expect roughly ${Math.ceil(sample.length * 8 / 60)}-${Math.ceil(sample.length * 16 / 60)} min total.\n`);
    const pop = [];
    for (const u of sample) {
      let r;
      try { r = await inspect(u); }
      catch (e) { r = { url: u, ok: false, dead: true, initHttp: null, tried: [], tools: [] }; }
      pop.push(r);
      console.log(liveLine(pop.length, sample.length, r));
      await sleep(PAUSE);
    }
    popAgg = report(`POPULATION SAMPLE (${sample.length} of ${all.length}, own excluded)`, pop);
  }

  const elapsed = (Date.now() - t0) / 1000;
  console.log("\n" + bar);
  console.log(`elapsed ${elapsed.toFixed(0)}s`);
  console.log("JUDGMENT GATE (manual, not automated):");
  console.log("  If the share of tools that cannot hold the difference is large, this");
  console.log("  DOES separate endpoints ,  unlike -32601, which everyone passes ,  and");
  console.log("  is a real candidate for directory condition 06, citing Federico as");
  console.log("  its source. If it is near zero, do not make it a condition; publish");
  console.log("  that we measured and found no meaningful difference.");
  console.log("  Either way: measure our own endpoints' number FIRST and publish it,");
  console.log("  including if ours is the bad one.");
})();
