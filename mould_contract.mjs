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
// THREE RULERS, ALL REPORTED (2026-08-21). They err in different directions, so the
// honest artifact is the spread between them plus the field names, never one number:
//   v1  all-depth structural   a boolean or a 2+ enum ANYWHERE in the schema. The
//                              original ruler. Reproduces the frozen mould-gh-12
//                              figure (96.7% cannot, on the 30-sample).
//   v2  top-level structural   the same test, but ONLY on the envelope's own
//                              properties, not fields nested inside the domain
//                              payload. Federico's refinement, 2026-08-20. Strips
//                              the entity-nested false positive (a job's remote
//                              boolean) without dropping a real read-state, which
//                              all sit at the envelope. This is the ruler the live
//                              gate now uses. Its known blind spot: a schema that
//                              declares its shape through a root allOf / anyOf with
//                              no direct properties reads as "cannot" even if a
//                              discriminator sits inside the composition. Rare, errs
//                              toward overstating "cannot", none of our own hit it.
//   lex  field-name lexical    a property NAME (any depth) drawn from a fixed list.
//                              Misses domain-specific names, so it OVERSTATES the
//                              problem: an UPPER BOUND, not a measurement (99.1% on
//                              the 30-sample). Kept only as the top of the band.
//   The gap between v2 top-level structural and lexical is the residual Federico
//   named: a top-level metadata boolean (cache_hit) is structurally identical to a
//   top-level read-state, and only meaning separates them. No shape rule crosses
//   that line, so the field names are printed for a human to make the call.
//
// HONEST LIMITS ,  state these wherever the numbers are published:
//   1. A schema is a declaration, not behaviour. A tool with a good schema can still
//      collapse at runtime; a tool with no schema may return prose a reader can tell
//      apart. This measures the contract offered to the consumer, nothing more.
//   2. outputSchema arrived in protocol revision 2025-06-18. Part of what a low score
//      measures is when the server was written, not only what its author cared about.
//   3. Field NAMES are not consulted by the structural rulers on purpose: the author
//      of this probe owns some of the endpoints it scores, and a name list would let
//      him score himself well by renaming his own fields.
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

// ---- THREE RULERS ----------------------------------------------------------
// A property "holds a state" if it declares a boolean, or an enum with 2+ values.
function isStateProp(pv) {
  if (!pv || typeof pv !== "object") return null;
  const t = pv.type;
  const types = Array.isArray(t) ? t : (t ? [t] : []);
  const isBool = types.includes("boolean");
  const isEnum = Array.isArray(pv.enum) && pv.enum.length >= 2;
  if (isBool || isEnum) return isEnum ? "enum" : "boolean";
  return null;
}

// v1: all-depth structural. Any state-holding property ANYWHERE. The original ruler;
// reproduces the frozen mould-gh-12 figure.
function collectDeep(node, out = [], depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return out;
  if (Array.isArray(node)) { for (const v of node) collectDeep(v, out, depth + 1); return out; }
  for (const [k, v] of Object.entries(node)) {
    if (k === "properties" && v && typeof v === "object" && !Array.isArray(v)) {
      for (const [pk, pv] of Object.entries(v)) {
        const kind = isStateProp(pv);
        if (kind) out.push({ name: pk, kind });
      }
    }
    collectDeep(v, out, depth + 1);
  }
  return out;
}

// v2: top-level structural. Only the envelope's own properties. Federico's refinement.
function collectTopLevel(node, out = []) {
  const props = (node && node.properties && typeof node.properties === "object" && !Array.isArray(node.properties))
    ? node.properties : {};
  for (const [pk, pv] of Object.entries(props)) {
    const kind = isStateProp(pv);
    if (kind) out.push({ name: pk, kind });
  }
  return out;
}

// lexical: any property NAME (any depth) in the fixed list. Upper bound.
function collectLexical(node) {
  const seen = new Set(), out = [];
  for (const k of allKeys(node)) {
    if (seen.has(k)) continue; seen.add(k);
    if (DISCRIMINATING_FIELD.test(k)) out.push(k);
  }
  return out;
}

function dedupTyped(arr) {
  const s = new Set(), o = [];
  for (const f of arr) { if (s.has(f.name)) continue; s.add(f.name); o.push(f.name + ":" + f.kind); }
  return o;
}

function classifyTool(tool) {
  const desc = String(tool.description || "");
  const out = tool.outputSchema;
  const hasOut = !!(out && typeof out === "object" && Object.keys(out).length);
  const descNF = DESC_NOTFOUND.test(desc);
  const descER = DESC_ERROR.test(desc);
  if (!hasOut) {
    return { name: tool.name, opaque: true, v1: [], v2: [], lex: [], descNF, descER };
  }
  return {
    name: tool.name,
    opaque: false,
    v1: dedupTyped(collectDeep(out)),
    v2: dedupTyped(collectTopLevel(out)),
    lex: collectLexical(out),
    descNF, descER,
  };
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
  return { url, ok: true, initHttp, proto, tools: tools.map((x) => classifyTool(x)) };
}

// a tool "can hold the difference" under a ruler if it is not opaque and that
// ruler found at least one state-holding field.
const canV1 = (t) => !t.opaque && t.v1.length > 0;
const canV2 = (t) => !t.opaque && t.v2.length > 0;
const canLex = (t) => !t.opaque && t.lex.length > 0;

function report(label, results) {
  const bar = "-".repeat(72);
  console.log(`\n${bar}\n${label}\n${bar}`);
  let servers = 0, tot = 0, opaque = 0;
  const cannot = { v1: 0, v2: 0, lex: 0 };
  const canSrv = { v1: new Set(), v2: new Set(), lex: new Set() };
  const dropped = [];
  for (const r of results) {
    if (!r.ok) {
      console.log(r.dead
        ? `  [unreachable] ${r.url}  (no HTTP response; not retried)`
        : `  [answered, not MCP here] ${r.url}  (http=${r.initHttp}, tried ${r.tried})`);
      continue;
    }
    servers++;
    console.log(`  ${r.url}   [proto ${r.proto}]  tools=${r.tools.length}`);
    for (const t of r.tools) {
      tot++;
      if (t.opaque) opaque++;
      if (!canV1(t)) cannot.v1++; else canSrv.v1.add(r.url);
      if (!canV2(t)) cannot.v2++; else canSrv.v2.add(r.url);
      if (!canLex(t)) cannot.lex++; else canSrv.lex.add(r.url);
      if (canV1(t) && !canV2(t)) dropped.push({ url: r.url, name: t.name, had: t.v1 });
    }
    for (const t of r.tools.slice(0, 8)) {
      const mk = (b) => (b ? "CAN" : " . ");
      const fld = t.v2.length ? ` {${t.v2.join(",")}}` : (t.v1.length ? ` (v1 only:{${t.v1.join(",")}})` : "");
      console.log(`        - ${String(t.name).slice(0, 38).padEnd(38)} v1:${mk(canV1(t))} v2:${mk(canV2(t))} lex:${mk(canLex(t))}${fld}`);
    }
    if (r.tools.length > 8) console.log(`        ... ${r.tools.length - 8} more`);
  }
  console.log(`\n  SERVERS spoke MCP: ${servers}   TOOLS seen: ${tot}   (OPAQUE, no outputSchema: ${opaque})`);
  if (tot) {
    const pct = (n) => `${String(n).padStart(3)}/${tot} (${(100 * n / tot).toFixed(1)}%)`;
    console.log(`  CANNOT hold "failed" vs "found nothing", by ruler:`);
    console.log(`    v1 all-depth  structural (frozen ruler, reproduces mould-gh-12) : ${pct(cannot.v1)}`);
    console.log(`    v2 top-level  structural (Federico refinement, live gate ruler) : ${pct(cannot.v2)}`);
    console.log(`    lexical field-name       (upper bound, overstates the problem)  : ${pct(cannot.lex)}`);
    console.log(`  servers where NOT ONE tool can hold the difference:`);
    console.log(`    v1: ${servers - canSrv.v1.size}/${servers}   v2: ${servers - canSrv.v2.size}/${servers}   lexical: ${servers - canSrv.lex.size}/${servers}`);
    if (dropped.length) {
      console.log(`\n  v1 -> v2 DROPPED (${dropped.length}): "can" all-depth, "cannot" top-level.`);
      console.log(`  Their only discriminator sat BELOW the envelope, so it is not read-state:`);
      for (const d of dropped) console.log(`    - ${d.url}  ${d.name}  had:{${d.had.join(",")}}`);
    } else {
      console.log(`\n  v1 -> v2 DROPPED: none here (top-level and all-depth agree on this set).`);
    }
  }
  return { tot, opaque, cannot, servers, canSrv, dropped };
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
  let c2 = 0; for (const t of r.tools) if (canV2(t)) c2++;
  const verdict = r.tools.length === 0 ? "no tools" : (c2 === 0 ? "CANNOT (v2)" : `${c2} can (v2)`);
  return `${tag} MCP ok  tools=${String(r.tools.length).padStart(3)}  ${verdict.padEnd(14)} ${r.url}`;
}

(async () => {
  const bar = "=".repeat(72);
  console.log(bar);
  console.log("MOULD PROBE ,  CONTRACT layer (READ-ONLY, tools/list only, NO tools/call)");
  console.log("METHOD (published before results):");
  console.log("  initialize (retrying protocol versions, honouring supportedVersions),");
  console.log("  then tools/list ,  a listing, which executes nothing.");
  console.log("  Each tool's declared outputSchema is scored by THREE rulers, all printed,");
  console.log("  because they err in different directions and the honest artifact is the");
  console.log("  spread plus the field names, never one number:");
  console.log("    v1 all-depth  structural : a boolean or 2+ enum ANYWHERE. Reproduces");
  console.log("                               the frozen mould-gh-12 figure.");
  console.log("    v2 top-level  structural : the same, but only on the envelope's own");
  console.log("                               properties, not fields nested in the payload.");
  console.log("                               Federico's refinement; the live gate ruler.");
  console.log("    lexical field-name       : a known field NAME at any depth. Upper bound,");
  console.log("                               overstates the problem; kept as top of band.");
  console.log("  Field NAMES are not consulted by the structural rulers: the author owns");
  console.log("  some scored endpoints, and a name list would let him score himself well.");
  console.log("  LIMIT: a schema is a declaration, not behaviour. Runtime needs tools/call,");
  console.log("  which is only done where consent exists. v2 blind spot: a root allOf/anyOf");
  console.log("  with no direct properties reads as 'cannot'; rare, errs toward overstating.");
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
  console.log("PUBLISH: the three cannot-percentages as a band, the v1->v2 dropped list,");
  console.log("and the field names. v1 reproduces the frozen record; v2 is the live gate's");
  console.log("current number; lexical is the upper bound. Own endpoints' band FIRST,");
  console.log("including if ours is the worse one.");
})();
