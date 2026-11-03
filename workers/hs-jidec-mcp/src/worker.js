// hs-jidec-mcp, Model Context Protocol server for JIDEC verification paths.
//
// Phase 4 of jidec-path-v1. Lets any MCP-capable agent cite and re-check a
// Bitcoin-anchored verification path by URI, without trusting HORIZON SHIELD.
//
// Tools (1.3.0 adds nenrin_resume, nenrin_trust_signal, nenrin_witness, nenrin_ledger_head, nenrin_ledger_entry;
// 1.4.0 adds nenrin_admission, nenrin_agreement, nenrin_furui_day, nenrin_furui_leaf):
//   jidec_cite(citation)            resolve + independently verify any citation
//   jidec_replay(citation)          re-observe the anchored path live, report drift
//   jidec_list_paths()              list anchored verification paths
//   jidec_how_to_verify(citation)   emit the executable verification recipe
//
// This worker is NEW and ISOLATED, it touches no existing service. It reaches
// the ledger through a service binding (LEDGER_SVC), not the public hostname,
// so same-account workers.dev subrequests cannot loop back. Reads only; no
// secrets; open so that "any AI can cite" holds literally.
//
// ---------------------------------------------------------------------------
// v1.1 (2026-07-26), spec conformance pass, per KANBAN_TO_ANNAININ_v1.md §5.
//
//  1. protocolVersion 2024-11-05 -> 2025-11-25 (current spec revision).
//     The 2026-07-28 revision removes `initialize` / `notifications/initialized`
//     and Mcp-Session-Id entirely. This worker is already stateless and never
//     required a session, so it satisfies both revisions simultaneously: a
//     client that skips `initialize` and calls `tools/call` directly works.
//
//  2. GET /mcp now returns 405, not 404. The spec MUSTs a single endpoint
//     serving both POST and GET; 405 is the conformant "no SSE stream here"
//     answer. 404 wrongly tells a client the endpoint does not exist.
//
//  3. Origin is validated on every request (DNS-rebinding requirement).
//     Policy for THIS server, stated openly because the whole point of JIDEC
//     is that nothing is hidden: every tool is read-only, there are no
//     secrets, no session state, and no ambient authority to steal, so the
//     allowlist defaults to "any http(s) origin". Opaque origins (`null`,
//     from sandboxed iframes / file://) are refused with 403, and the
//     allowlist is tightenable at any time via env.ALLOWED_ORIGINS without a
//     code change. ACAO echoes the caller's origin (with Vary: Origin)
//     instead of a blanket "*".
//
//  4. Every tool carries `title` and `annotations.readOnlyHint`. All four
//     tools are strictly read-only; readOnlyHint is the machine-readable form
//     of "you do not have to trust us with anything".
//
//  5. jidec_cite no longer resolves only through /paths/{sha}. Spec entries
//     (#2 SPEC_HASH_INDEPENDENCE_v1, #5 JIDEC_PATH_SPEC_v1) and jidec-claim-v1
//     entries used to return 400. It now falls back to raw bytes + local
//     SHA-256 recomputation, mirroring path/jidec_cite.py's citation card so
//     the CLI and the MCP server agree field-for-field.
// ---------------------------------------------------------------------------

import { dayChecks, leafChecks } from "./furui_read.mjs";

// 2026-08-11: advertised origin moved to the domain we control. hs-ledger
// accepts both hostnames for replay (SELF_LEDGER_HOSTS), so records anchored
// under the old hostname still re-observe correctly when reached through this.
const LEDGER_ORIGIN = "https://ledger.horizonshield.dev";
const HEX64 = /^[0-9a-f]{64}$/i;
// 1.3.0 (2026-09-30): NENRIN read tools. The A2A card keeps its own version (CARD_VERSION) because its bytes are
// signed and its A2A face did not change; re-signing is a separate step, not a side effect of adding MCP tools.
// 1.4.0 (2026-11-03): admission and agreement records by sha, the content check runner's day record (furui-check-day-v0)
// and one envelope of a day (a leaf) with its checks recomputed here. The A2A card does not list MCP tools, so it is not
// re-signed for this.
const VERSION = "1.4.0";
const CARD_VERSION = "1.2.2";
const PROTOCOL_VERSION = "2025-11-25";
// The content check runner's public reads (GET only; no content, scope or answer text). A custom domain, so a plain
// fetch reaches it from this worker; RUNNER_SVC, when bound, is used instead.
const RUNNER_ORIGIN = "https://furui.horizonshield.dev";
const FURUI_KEYS_PATH = "/.well-known/furui-check-keys.json";
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/* ------------------------------ origin policy ------------------------------ */

// Returns { ok, origin }, origin is the value to echo in ACAO.
function checkOrigin(req, env) {
  const o = req.headers.get("Origin");
  if (!o) return { ok: true, origin: "*" }; // non-browser client (curl, MCP host, agent)
  if (o === "null") return { ok: false, origin: null }; // opaque: sandboxed iframe / file://

  let u;
  try { u = new URL(o); } catch { return { ok: false, origin: null }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, origin: null };

  const allow = (env && env.ALLOWED_ORIGINS) || "*";
  if (allow.trim() === "*") return { ok: true, origin: o };

  const list = allow.split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes(o) ? { ok: true, origin: o } : { ok: false, origin: null };
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version, A2A-Extensions, X-A2A-Extensions, A2A-Version",
    "Access-Control-Expose-Headers": "A2A-Extensions, X-A2A-Extensions",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/* --------------------------------- ledger ---------------------------------- */

async function ledgerGet(env, path) {
  const r = await env.LEDGER_SVC.fetch(new Request(LEDGER_ORIGIN + path));
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

async function runnerGet(env, path) {
  const req = new Request(RUNNER_ORIGIN + path, { headers: { accept: "application/json", "user-agent": "hs-jidec-mcp/" + VERSION } });
  const r = env && env.RUNNER_SVC ? await env.RUNNER_SVC.fetch(req) : await fetch(req, { signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

async function ledgerGetBytes(env, path) {
  const r = await env.LEDGER_SVC.fetch(new Request(LEDGER_ORIGIN + path));
  return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()) };
}

async function sha256hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* -------------------------------- citations -------------------------------- */

function parseCitation(c) {
  c = String(c || "").trim();
  if (/^https?:\/\//.test(c)) {
    const mh = c.match(/\/paths\/([0-9a-f]{64})/i);
    if (mh) return { kind: "hash", val: mh[1].toLowerCase() };
    const me = c.match(/\/ledger\/(\d+)/);
    if (me) return { kind: "entry", val: Number(me[1]) };
    throw new Error("unrecognized ledger URL: " + c);
  }
  if (c.startsWith("jidec:entry:")) return { kind: "entry", val: Number(c.split(":").pop()) };
  if (c.startsWith("jidec:path:")) return { kind: "hash", val: String(c.split(":").pop()).toLowerCase() };
  if (c.startsWith("jidec:")) {
    const t = c.slice("jidec:".length);
    if (HEX64.test(t)) return { kind: "hash", val: t.toLowerCase() };
  }
  if (HEX64.test(c)) return { kind: "hash", val: c.toLowerCase() };
  if (/^\d+$/.test(c)) return { kind: "entry", val: Number(c) };
  throw new Error("unrecognized citation: " + c);
}

// Resolve a citation to { n, sha } using only public reads.
// A bare hash is resolved by scanning the public /ledger index for a matching
// claim_sha256, the same route any third party would take, no privileged access.
async function resolve(env, citation) {
  const p = parseCitation(citation);

  if (p.kind === "entry") {
    const e = await ledgerGet(env, `/ledger/${p.val}?format=json`);
    if (e.status !== 200 || !e.body || !e.body.claim_sha256)
      throw new Error("could not resolve entry " + p.val);
    return { n: Number(p.val), sha: String(e.body.claim_sha256).toLowerCase() };
  }

  const idx = await ledgerGet(env, "/ledger");
  if (idx.status === 200 && idx.body && Array.isArray(idx.body.entries)) {
    for (const e of idx.body.entries) {
      if (String(e.claim_sha256 || "").toLowerCase() === p.val) return { n: Number(e.n), sha: p.val };
    }
  }
  // Not in the index window: a /paths/{sha} lookup may still resolve it O(1).
  const pr = await ledgerGet(env, `/paths/${p.val}`);
  if (pr.status === 200 && pr.body && pr.body.entry) return { n: Number(pr.body.entry), sha: p.val };
  throw new Error(
    "no ledger entry has claim_sha256 == " + p.val + " (public index covers the most recent 100 entries)"
  );
}

function classifyRecord(text) {
  let obj = null;
  try { obj = JSON.parse(text); } catch { return { kind: "v0-plain", obj: null }; }
  if (obj && obj.schema === "jidec-path-v1") return { kind: "jidec-path-v1", obj };
  if (obj && obj.schema === "jidec-claim-v1") return { kind: "jidec-claim-v1", obj };
  // 2026-10-13. A record that names its own schema (nenrin-*-batch-v1, nenrin-head-checkpoint-v1, ...) is not a
  // v0 estimate entry; calling it v0 told readers of a NENRIN batch it was an old estimate proof. Same rule in
  // path/jidec_cite.py so the two implementations still diff clean.
  if (obj && typeof obj === "object" && !Array.isArray(obj) && typeof obj.schema === "string" && obj.schema)
    return { kind: obj.schema, obj };
  return { kind: "v0", obj };
}

// Build a citation card from raw bytes. Field-for-field compatible with
// path/jidec_cite.py so that the CLI and this server can be diffed against
// each other, two independent implementations agreeing is the point.
async function buildCard(env, n, sha, citation) {
  const raw = await ledgerGetBytes(env, `/ledger/${n}?format=raw`);
  if (raw.status !== 200) throw new Error(`could not fetch raw record for entry ${n}: HTTP ${raw.status}`);
  const recomputed = await sha256hex(raw.bytes);

  const meta = await ledgerGet(env, `/ledger/${n}?format=json`);
  const m = meta.status === 200 && meta.body && typeof meta.body === "object" ? meta.body : {};
  const entryClaim = String(m.claim_sha256 || "").toLowerCase();

  const match = recomputed === sha && (entryClaim === "" || entryClaim === recomputed);

  const ots = m.ots_status;
  const bitcoin =
    ots === "confirmed" && m.bitcoin_block
      ? { status: "confirmed", block: m.bitcoin_block, block_time: m.block_time || null }
      : { status: ots || "none", block: null, block_time: null };

  const text = new TextDecoder().decode(raw.bytes);
  const { kind, obj } = classifyRecord(text);
  const ledgerUrl = `${LEDGER_ORIGIN}/ledger/${n}`;

  const card = {
    citation,
    resolved_entry: n,
    ledger_url: ledgerUrl,
    raw_url: ledgerUrl + "?format=raw",
    ots_url: ledgerUrl + "/ots",
    verify_url: `${LEDGER_ORIGIN}/verify/${n}`,
    integrity: { claimed_sha256: sha, recomputed_sha256: recomputed, match },
    bitcoin,
    record_kind: kind,
  };

  if (kind === "jidec-path-v1" && obj) {
    card.path = {
      purpose: obj.purpose,
      walked_at: obj.walked_at,
      verdict: obj.verdict,
      assertions: (obj.assertions || []).map((a) => ({ claim: a.claim, result: a.result })),
      base: obj.base,
      path_url: `${LEDGER_ORIGIN}/paths/${sha}`,
      replay_url: `${LEDGER_ORIGIN}/paths/${sha}/replay`,
    };
  } else if (kind === "jidec-claim-v1" && obj) {
    card.claim = {};
    for (const k of ["work_id", "input_sha256", "reference_bundle_sha256", "algorithm_commit",
                     "thresholds_sha256", "result_sha256", "pdf_sha256", "issued_at"])
      card.claim[k] = obj[k];
  } else if (kind === "v0") {
    card.note = "This entry predates the v1 schemas (v0). Its bytes are still anchored and hash-checkable.";
  } else if (kind === "v0-plain") {
    // 2026-10-30: same as hs-ledger /cite. A plain-text record is not an estimate; the claim covers all its bytes.
    // Reported on #194 by Federico Blanco (invinoveritas), credited by name with his consent.
    card.note = "This entry is a plain-text record. The claim is the SHA-256 of all its bytes, as the raw route serves them; what it does and does not establish is written inside the record itself.";
  } else {
    card.note = "This entry is a " + kind + " record. Its bytes are anchored and hash-checkable; what it does and does not establish is written inside the record itself.";
  }

  card.trust_note = match
    ? "Independently verified: the entry's bytes hash to the cited id" +
      (bitcoin.status === "confirmed"
        ? `, and that id is confirmed in Bitcoin block ${bitcoin.block}`
        : bitcoin.status === "pending"
        ? ", and that id is submitted to OpenTimestamps (Bitcoin confirmation pending)"
        : "") +
      ". No trust in HORIZON SHIELD required."
    : "INTEGRITY FAILURE: the entry's bytes do NOT hash to the cited id. Do not rely on this citation.";

  const estimateEra = kind === "jidec-claim-v1" || kind === "jidec-path-v1" || kind === "v0";
  card.limits = estimateEra
    ? "What this proves: these exact bytes existed at or before the anchored time and have not changed. " +
      "What this does NOT prove: that the estimate is fair, that the input data is true, or that HORIZON SHIELD is competent. " +
      "Those are judged by re-running the recipe at verify_url yourself."
    : "What this proves: these exact bytes existed at or before the anchored time and have not changed. " +
      "What this does NOT prove: that any assertion inside the record is true, or that HORIZON SHIELD is competent. " +
      "Read the record's own fields for what it claims and what it says it does not establish.";

  return card;
}

/* ---------------------------------- tools ---------------------------------- */

// Federico Blanco Sanchez-Llanos, "The Mould, Not the Letter", 2026-08-20:
//   never let "the fetch failed" and "the fetch succeeded and found nothing"
//   collapse into the same downstream value.
//
// Measured 2026-08-20: all four tools here declared no outputSchema, so a consumer
// received free text and had no declared way to separate the two. Worse, the
// ledger read in jidec_list_paths returned r.body without looking at r.status:
// a ledger that answered 500 and a ledger that holds no paths both arrived as a
// successful result. On a ledger whose entire purpose is verification, that was
// the weakest spot in the building.
//
// Now: a read that FAILS throws, and the rpc layer returns it with isError: true.
// A read that SUCCEEDS and finds nothing returns lookup:"absent" with a count of 0.
// The two can never be confused, by contract and not only by prose.

const LOOKUP_FIELD = {
  type: "string",
  enum: ["ok", "absent"],
  description:
    "ok = the ledger was read and the record exists. absent = the ledger was read " +
    "and there is no such record. A read that FAILED never appears here: it comes " +
    "back as a tool error (isError: true), so a consumer can never mistake this " +
    "server's own failure for a statement about the ledger's contents.",
};

const CITE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    lookup: LOOKUP_FIELD,
    citation: { type: "string" },
    resolved_entry: { type: ["number", "string", "null"] },
    integrity: {
      type: "object",
      description: "The whole point: claimed vs recomputed. match:false is an integrity FAILURE, which is a finding, not an error.",
      properties: {
        claimed_sha256: { type: "string" },
        recomputed_sha256: { type: "string" },
        match: { type: "boolean" },
      },
      required: ["match"],
    },
    bitcoin: { type: "object", properties: { status: { type: "string" } } },
    record_kind: { type: "string" },
    trust_note: { type: "string" },
    limits: { type: "string" },
  },
  required: ["lookup", "integrity"],
  additionalProperties: true,
};

const LIST_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    lookup: LOOKUP_FIELD,
    count: {
      type: "number",
      description:
        "How many anchored paths the ledger returned. 0 means the ledger answered and " +
        "holds none. It never means the ledger could not be read, that is an error.",
    },
    paths: { type: "array", items: { type: "object" } },
  },
  required: ["lookup", "count"],
  additionalProperties: true,
};

const REPLAY_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    lookup: LOOKUP_FIELD,
    verdict: { type: "string", description: "MATCH or DRIFT. Nodes that could not be re-observed are deferred, never counted as drift." },
  },
  required: ["lookup"],
  additionalProperties: true,
};

const RECIPE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    lookup: LOOKUP_FIELD,
    citation: { type: "string" },
    resolved_entry: { type: ["number", "string", "null"] },
    path_id: { type: "string" },
    recipe: { type: ["object", "string"] },
  },
  required: ["lookup"],
  additionalProperties: true,
};

const NENRIN_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    lookup: LOOKUP_FIELD,
    source_url: { type: "string", description: "The public ledger URL that returned this body. Fetch it yourself to compare." },
    does_not_establish: { type: "array", items: { type: "string" } },
  },
  required: ["lookup", "source_url"],
  additionalProperties: true,
};

const NENRIN_LIMITS = [
  "a signature proves who asserted a record and how records link, not that the assertion is true",
  "no executed action is proven to have happened in the world",
  "not yet anchored is not false, and absent from the ledger is not a negative finding",
  "this is a history, not a score or a recommendation",
];

function httpsEndpoint(v) {
  try { const u = new URL(String(v || "")); return u.protocol === "https:" ? u.toString() : null; } catch { return null; }
}

async function nenrinRead(env, path, what) {
  const r = await ledgerGet(env, path);
  const source_url = LEDGER_ORIGIN + path;
  if (r.status === 404) return { lookup: "absent", source_url, does_not_establish: NENRIN_LIMITS, note: "The ledger was read and holds no " + what + ". That is a fact about the ledger, not a finding about anyone." };
  if (r.status !== 200 || !r.body || typeof r.body !== "object")
    throw new Error("the ledger could not be read for " + what + ": HTTP " + r.status + ". This is NOT a statement that the record does not exist.");
  return { lookup: "ok", source_url, ...r.body, does_not_establish: NENRIN_LIMITS };
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const TOOLS = [
  {
    name: "jidec_cite",
    title: "Cite and independently verify a JIDEC record",
    description:
      "Resolve and INDEPENDENTLY verify any JIDEC citation. Accepts 'jidec:path:<sha>', 'jidec:entry:<n>', a bare 64-hex id, or a ledger URL. Fetches the record's exact bytes, recomputes SHA-256 locally, and confirms it equals the cited id. Returns integrity, Bitcoin anchoring status, the parsed record (verification path, claim, or v0 spec entry), and an explicit statement of what the proof does and does not cover. No trust in HORIZON SHIELD is required to accept the result.",
    inputSchema: {
      type: "object",
      properties: { citation: { type: "string", description: "jidec:path:<sha> | jidec:entry:<n> | 64-hex | ledger URL" } },
      required: ["citation"],
    },
    outputSchema: CITE_OUTPUT_SCHEMA,
    annotations: { title: "Cite and independently verify a JIDEC record", ...READ_ONLY },
  },
  {
    name: "jidec_replay",
    title: "Re-observe an anchored path and report drift",
    description:
      "Re-observe an anchored JIDEC verification path against the live system right now and report drift. Returns MATCH (the live system still matches what was anchored) or DRIFT (it changed), node by node. Nodes that cannot be re-observed server-side are reported as deferred, never counted as drift.",
    inputSchema: {
      type: "object",
      properties: { citation: { type: "string", description: "jidec:path:<sha> | jidec:entry:<n> | ledger URL" } },
      required: ["citation"],
    },
    outputSchema: REPLAY_OUTPUT_SCHEMA,
    annotations: { title: "Re-observe an anchored path and report drift", ...READ_ONLY },
  },
  {
    name: "jidec_list_paths",
    title: "List anchored verification paths",
    description: "List the anchored JIDEC verification paths (most recent first), with purpose, verdict and Bitcoin anchoring status.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: LIST_OUTPUT_SCHEMA,
    annotations: { title: "List anchored verification paths", ...READ_ONLY },
  },
  {
    name: "jidec_how_to_verify",
    title: "Get the executable verification recipe",
    description:
      "Return the step-by-step recipe for verifying a JIDEC record WITHOUT trusting HORIZON SHIELD: which bytes to fetch, which hashes to recompute, which OpenTimestamps proof to check, which algorithm commit to check out, and what must match. Use this when you want to confirm the result yourself rather than repeat an assertion.",
    inputSchema: {
      type: "object",
      properties: { citation: { type: "string", description: "jidec:path:<sha> | jidec:entry:<n> | 64-hex | ledger URL" } },
      required: ["citation"],
    },
    outputSchema: RECIPE_OUTPUT_SCHEMA,
    annotations: { title: "Get the executable verification recipe", ...READ_ONLY },
  },
  {
    name: "nenrin_resume",
    title: "Recorded conduct history of an endpoint (NENRIN résumé)",
    description:
      "Return the NENRIN résumé of an agent or MCP endpoint: every recorded measurement that touches its origin (by the gate and by outside witnesses, signed or not), which are Bitcoin-anchored, discrepancies, rings, agreements[] (anchored agreements), admissions[] (the anchored admissions whose relying party is on the endpoint's host: record_sha256, ledger entry, decision, the closed part of a 0.4 content block, revoked; no text), and the records not counted with the reason. Includes resume_sha256 and a recompute recipe. A history, not a score. Absent means no record, not a negative finding.",
    inputSchema: {
      type: "object",
      properties: { endpoint: { type: "string", description: "https URL of the agent or MCP endpoint, e.g. https://mcp.horizonshield.dev/mcp" } },
      required: ["endpoint"],
    },
    outputSchema: NENRIN_OUTPUT_SCHEMA,
    annotations: { title: "Recorded conduct history of an endpoint (NENRIN résumé)", ...READ_ONLY },
  },
  {
    name: "nenrin_trust_signal",
    title: "Compact conduct signal of an endpoint",
    description:
      "Return the compact NENRIN signal for an endpoint: counts of anchored measurements, witness diversity and freshness, in a shape a trust engine or orderer can read. No score, no allow or deny.",
    inputSchema: {
      type: "object",
      properties: { endpoint: { type: "string", description: "https URL of the agent or MCP endpoint" } },
      required: ["endpoint"],
    },
    outputSchema: NENRIN_OUTPUT_SCHEMA,
    annotations: { title: "Compact conduct signal of an endpoint", ...READ_ONLY },
  },
  {
    name: "nenrin_witness",
    title: "One witness record by its SHA-256",
    description:
      "Return one NENRIN witness record by its record SHA-256: pending or anchored, and when anchored, the ledger entry and batch that carry it. Use it to check a walk someone says they submitted.",
    inputSchema: {
      type: "object",
      properties: { sha256: { type: "string", description: "64-hex record SHA-256" } },
      required: ["sha256"],
    },
    outputSchema: NENRIN_OUTPUT_SCHEMA,
    annotations: { title: "One witness record by its SHA-256", ...READ_ONLY },
  },
  {
    name: "nenrin_ledger_head",
    title: "Current ledger head and its bound end marker",
    description:
      "Return the current head of the JIDEC/NENRIN ledger: entry count n, the head hash, and the end marker bound into the chain (jidec-head-v1) with the recipe to recompute it. Compare it with a head you saw earlier to detect truncation or rewrite.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: NENRIN_OUTPUT_SCHEMA,
    annotations: { title: "Current ledger head and its bound end marker", ...READ_ONLY },
  },
  {
    name: "nenrin_ledger_entry",
    title: "One ledger entry by number",
    description:
      "Return ledger entry n as the ledger serves it: claim_sha256, the canonical record bytes, work description, OpenTimestamps status and Bitcoin block when anchored. Pair with jidec_how_to_verify to recompute it.",
    inputSchema: {
      type: "object",
      properties: { n: { type: "integer", minimum: 1, description: "entry number" } },
      required: ["n"],
    },
    outputSchema: NENRIN_OUTPUT_SCHEMA,
    annotations: { title: "One ledger entry by number", ...READ_ONLY },
  },
  {
    name: "nenrin_admission",
    title: "One admission record by its SHA-256",
    description:
      "Return one admission record (a2a-admission-v0) as the ledger stores it, by its canonical SHA-256: the exact record bytes, pending or anchored, and the ledger entry once anchored. A door writes one before it lets an agent's action run; version 0.4 carries the content check as fields only (a salted commitment to the content, the digest of the check, the rule set, decision, marks), no text. The anchored admissions of a relying party are also listed in admissions[] of its Résumé (nenrin_resume).",
    inputSchema: {
      type: "object",
      properties: { sha256: { type: "string", description: "64-hex canonical SHA-256 of the admission record" } },
      required: ["sha256"],
    },
    outputSchema: NENRIN_OUTPUT_SCHEMA,
    annotations: { title: "One admission record by its SHA-256", ...READ_ONLY },
  },
  {
    name: "nenrin_agreement",
    title: "One agreement record by its SHA-256",
    description:
      "Return one agreement record as the ledger stores it, by its canonical SHA-256: the exact record bytes, pending or anchored, and the ledger entry once anchored. The anchored agreements of an endpoint are listed in agreements[] of its Résumé (nenrin_resume).",
    inputSchema: {
      type: "object",
      properties: { sha256: { type: "string", description: "64-hex canonical SHA-256 of the agreement record" } },
      required: ["sha256"],
    },
    outputSchema: NENRIN_OUTPUT_SCHEMA,
    annotations: { title: "One agreement record by its SHA-256", ...READ_ONLY },
  },
  {
    name: "nenrin_furui_day",
    title: "A content check runner's day record, checked",
    description:
      "Return the day record (furui-check-day-v0) of the content check runner: the signed RFC 6962 root of one UTC day's check envelopes and their count. Give its SHA-256, or a day (YYYY-MM-DD) to find it through the runner's day status. This server reads the record from the ledger and the key from the ledger's /.well-known/furui-check-keys.json, and recomputes: the bytes hash to the SHA-256, the shape is closed, the key is listed for the record's heights, the Ed25519 signature verifies, and whether the record is anchored. No content, scope or answer text is in it.",
    inputSchema: {
      type: "object",
      properties: {
        sha256: { type: "string", description: "64-hex canonical SHA-256 of the day record" },
        day: { type: "string", description: "UTC day YYYY-MM-DD, used when sha256 is not given" },
      },
    },
    outputSchema: NENRIN_OUTPUT_SCHEMA,
    annotations: { title: "A content check runner's day record, checked", ...READ_ONLY },
  },
  {
    name: "nenrin_furui_leaf",
    title: "One check envelope of a day (a leaf), checked against the day record",
    description:
      "Return envelope i of a closed UTC day as the content check runner serves it (kept 7 days after the day), with its RFC 6962 audit path. This server recomputes: the envelope has the closed shape (digests, numbers, booleans, fixed words; no text), the leaf hash is sha256(0x00 || canonical envelope), the audit path rebuilds the root of the day record the ledger stores, and the runner's Ed25519 signature verifies under the key the ledger lists. An admission of version 0.4 names the check of such an envelope by its digest.",
    inputSchema: {
      type: "object",
      properties: {
        day: { type: "string", description: "UTC day YYYY-MM-DD" },
        index: { type: "integer", minimum: 0, description: "leaf index, 0 to n-1" },
      },
      required: ["day", "index"],
    },
    outputSchema: NENRIN_OUTPUT_SCHEMA,
    annotations: { title: "One check envelope of a day (a leaf), checked against the day record", ...READ_ONLY },
  },
];

async function callTool(name, args, env) {
  if (name === "jidec_list_paths") {
    const r = await ledgerGet(env, "/paths");
    // The read either worked or it did not. Say which. Do not hand back a body
    // that might be an error page and let it read as a list of zero paths.
    if (r.status !== 200)
      throw new Error(
        "the ledger could not be read: HTTP " + r.status + ". This is NOT a report " +
        "that there are no anchored paths, this server does not know how many there are."
      );
    const paths = Array.isArray(r.body) ? r.body
                : (r.body && Array.isArray(r.body.paths)) ? r.body.paths
                : null;
    if (paths === null)
      throw new Error("the ledger answered 200 but not with a list of paths; refusing to report a count this server cannot stand behind.");
    return {
      lookup: paths.length ? "ok" : "absent",
      count: paths.length,
      paths: paths,
      note: paths.length ? undefined
        : "The ledger was read successfully and holds no anchored paths. This is a fact about the ledger, not a failure of this server.",
    };
  }

  if (name === "jidec_cite") {
    const { n, sha } = await resolve(env, args.citation);
    // Fast path: an anchored verification path answers O(1) with its own card.
    const r = await ledgerGet(env, `/paths/${sha}`);
    if (r.status === 200 && r.body && typeof r.body === "object") {
      const card = await buildCard(env, n, sha, args.citation);
      return { lookup: "ok", ...card, path_card: r.body };
    }
    // Everything else (jidec-claim-v1, v0 spec entries such as #2 and #5):
    // verify from raw bytes locally. This is why entry #2 / #5 used to 400.
    return { lookup: "ok", ...(await buildCard(env, n, sha, args.citation)) };
  }

  if (name === "jidec_replay") {
    const { sha } = await resolve(env, args.citation);
    const r = await ledgerGet(env, `/paths/${sha}/replay`);
    // The ledger answers 404 when no path has that id and 400 when the entry
    // exists but is not a jidec-path-v1 record (e.g. a spec entry). Both mean
    // "nothing to re-walk", and both deserve an explanation rather than a code.
    if (r.status === 404 || r.status === 400)
      throw new Error(
        "entry " + sha + " is not a jidec-path-v1 record, so there is nothing to re-walk. " +
        "Use jidec_cite for hash and anchor verification of this entry."
      );
    if (r.status !== 200) throw new Error("replay error " + r.status);
    return { lookup: "ok", ...(r.body && typeof r.body === "object" ? r.body : { body: r.body }) };
  }

  if (name === "jidec_how_to_verify") {
    const { n, sha } = await resolve(env, args.citation);
    const r = await ledgerGet(env, `/verify/${n}`);
    if (r.status !== 200) throw new Error("verify recipe unavailable: HTTP " + r.status);
    return {
      lookup: "ok",
      citation: args.citation,
      resolved_entry: n,
      path_id: sha,
      recipe: r.body,
      independent_tooling: {
        cli: "python3 path/jidec_cite.py " + args.citation + " --json",
        note: "The CLI is a separate implementation of this same check. Running both and diffing them is stronger than trusting either.",
      },
    };
  }

  if (name === "nenrin_resume" || name === "nenrin_trust_signal") {
    const ep = httpsEndpoint(args.endpoint);
    if (!ep) throw new Error("endpoint must be an https URL, e.g. https://mcp.horizonshield.dev/mcp");
    const route = name === "nenrin_resume" ? "/resume" : "/trust-signal";
    return await nenrinRead(env, route + "?endpoint=" + encodeURIComponent(ep), "record for " + ep);
  }

  if (name === "nenrin_witness") {
    const sha = String(args.sha256 || "").toLowerCase();
    if (!HEX64.test(sha)) throw new Error("sha256 must be 64 hex characters");
    return await nenrinRead(env, "/witness/" + sha, "witness record " + sha);
  }

  if (name === "nenrin_ledger_head") return await nenrinRead(env, "/ledger/head", "head");

  if (name === "nenrin_ledger_entry") {
    const n = Number(args.n);
    if (!Number.isInteger(n) || n < 1) throw new Error("n must be a positive integer");
    // 2026-10-13. /ledger/{n} answers HTML by default (the receipt page) and JSON only for ?format=json or
    // Accept: application/json. Asking without either got the page, which nenrinRead cannot parse, so every
    // entry read failed with "could not be read ... HTTP 200" (found 2026-10-13 on entries 86 to 88).
    return await nenrinRead(env, "/ledger/" + n + "?format=json", "entry " + n);
  }

  if (name === "nenrin_admission" || name === "nenrin_agreement") {
    const sha = String(args.sha256 || "").toLowerCase();
    if (!HEX64.test(sha)) throw new Error("sha256 must be 64 hex characters");
    const kind = name === "nenrin_admission" ? "admission" : "agreement";
    return await nenrinRead(env, "/" + kind + "/" + sha, kind + " record " + sha);
  }

  if (name === "nenrin_furui_day") return await furuiDay(env, args);
  if (name === "nenrin_furui_leaf") return await furuiLeaf(env, args);

  throw new Error("unknown tool: " + name);
}

const FURUI_LIMITS = [
  "a day record shows that checks were made and signed and that their root has not changed; it does not show that any check was right",
  "no content, scope, question or answer text is kept, so none can be read here",
  "the runner keeps a day's envelopes 7 days after the day; after that only the root remains",
  "not yet anchored is not false, and absent is not a negative finding",
];
function realDay(s) {
  const m = DAY_RE.exec(String(s || "")); if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
async function ledgerKeys(env) {
  const k = await ledgerGet(env, FURUI_KEYS_PATH);
  if (k.status !== 200 || !k.body || typeof k.body !== "object") throw new Error("the ledger's furui-check keys could not be read: HTTP " + k.status + ". Nothing was checked.");
  return k.body;
}
// The runner's status of a closed day: { sha } of its day record at the ledger, or { absent } with the runner's words.
async function runnerDaySha(env, day) {
  const r = await runnerGet(env, "/furui/day/" + day + "/status");
  if (r.status !== 200 || !r.body || typeof r.body !== "object") throw new Error("the runner's day status could not be read for " + day + ": HTTP " + r.status + ". This is NOT a statement that the day has no record.");
  const st = r.body.status;
  const sha = st && typeof st.ledger_canonical_sha256 === "string" ? st.ledger_canonical_sha256.toLowerCase() : null;
  if (!st || !sha || !HEX64.test(sha)) return { absent: true, runner_status: r.body, source_url: RUNNER_ORIGIN + "/furui/day/" + day + "/status" };
  return { sha, runner_status: r.body };
}
async function furuiDay(env, args) {
  let sha = args.sha256 ? String(args.sha256).toLowerCase() : null, viaDay = null;
  if (sha !== null && !HEX64.test(sha)) throw new Error("sha256 must be 64 hex characters");
  if (sha === null) {
    if (!realDay(args.day)) throw new Error("give sha256 (64 hex) or day (YYYY-MM-DD)");
    viaDay = await runnerDaySha(env, args.day);
    if (viaDay.absent) return { lookup: "absent", source_url: viaDay.source_url, day: args.day, runner_status: viaDay.runner_status, does_not_establish: FURUI_LIMITS,
      note: "The runner holds no accepted day record for " + args.day + " (a day without checks has none, and a day answers after it closes, from about 00:47 UTC the next day)." };
    sha = viaDay.sha;
  }
  const path = "/furui-check-day/" + sha, source_url = LEDGER_ORIGIN + path;
  const r = await ledgerGet(env, path);
  if (r.status === 404) return { lookup: "absent", source_url, canonical_sha256: sha, does_not_establish: FURUI_LIMITS, note: "The ledger was read and holds no day record under this sha." };
  if (r.status !== 200 || !r.body || typeof r.body !== "object") throw new Error("the ledger could not be read for day record " + sha + ": HTTP " + r.status + ". This is NOT a statement that the record does not exist.");
  const keys = await ledgerKeys(env);
  const { checks, record, problem } = await dayChecks(sha, r.body, keys);
  const hold = ["bytes_hash_to_the_sha", "closed_shape", "key_listed", "signature_valid"].every((k) => checks[k] === true);
  return { lookup: "ok", source_url, canonical_sha256: sha, record_canonical: r.body.record_canonical, status: r.body.status, ledger_entry: r.body.ledger_entry ?? null,
    day: record && record.day, n: record && record.n, root: record && record.root, checks, all_hold: hold, problem: problem || null,
    keys_url: LEDGER_ORIGIN + FURUI_KEYS_PATH, runner_status: viaDay ? viaDay.runner_status : undefined,
    how_to_check: "sha256 of record_canonical must equal canonical_sha256; the Ed25519 signature is over 'furui-check-day-v0\\n' + the canonical record without signatures, under the key listed at keys_url; anchored records carry ledger_entry, whose OpenTimestamps proof is at " + LEDGER_ORIGIN + "/ledger/{ledger_entry}/ots",
    does_not_establish: FURUI_LIMITS };
}
async function furuiLeaf(env, args) {
  const day = String(args.day || ""), i = Number(args.index);
  if (!realDay(day)) throw new Error("day must be YYYY-MM-DD");
  if (!Number.isInteger(i) || i < 0 || i > 999999) throw new Error("index must be an integer from 0");
  const path = "/furui/day/" + day + "/leaf/" + i, source_url = RUNNER_ORIGIN + path;
  const r = await runnerGet(env, path);
  if (r.status === 410 || r.status === 404) {
    const why = r.body && typeof r.body === "object" ? r.body.error : null;
    if (r.status === 404 && !["day_open", "no_leaf", "not_kept"].includes(why)) throw new Error("the runner answered 404 without a known reason for " + path + ". This is NOT a statement that the leaf does not exist.");
    return { lookup: "absent", source_url, day, index: i, gone: r.status === 410, runner_says: why, does_not_establish: FURUI_LIMITS,
      note: r.status === 410 ? "The runner kept this day's envelopes 7 days and has deleted them; the day record and its root remain (nenrin_furui_day)." : "The runner has no such leaf (" + why + ")." };
  }
  if (r.status !== 200 || !r.body || typeof r.body !== "object") throw new Error("the runner could not be read for " + path + ": HTTP " + r.status + ". Nothing was checked.");
  const ds = await runnerDaySha(env, day);
  if (ds.absent) throw new Error("the runner serves a leaf for " + day + " but no accepted day record at the ledger; the leaf cannot be held to a ledger root.");
  const dr = await ledgerGet(env, "/furui-check-day/" + ds.sha);
  if (dr.status !== 200 || !dr.body || typeof dr.body !== "object") throw new Error("the ledger's day record " + ds.sha + " could not be read: HTTP " + dr.status + ". Nothing was checked.");
  const keys = await ledgerKeys(env);
  const d = await dayChecks(ds.sha, dr.body, keys);
  const l = await leafChecks(r.body, d.record, ds.sha, keys, LEDGER_ORIGIN + FURUI_KEYS_PATH);
  const dayHold = ["bytes_hash_to_the_sha", "closed_shape", "key_listed", "signature_valid"].every((k) => d.checks[k] === true);
  const hold = dayHold && Object.values(l.checks).every((v) => v === true);
  return { lookup: "ok", source_url, day, index: i, n: r.body.n, root: r.body.root, leaf_sha256: r.body.leaf_sha256, envelope_sha256: r.body.envelope_sha256,
    envelope: r.body.envelope, proof: r.body.proof, kept_until: r.body.kept_until ?? null,
    day_record: { canonical_sha256: ds.sha, source_url: LEDGER_ORIGIN + "/furui-check-day/" + ds.sha, status: dr.body.status, ledger_entry: dr.body.ledger_entry ?? null, checks: d.checks },
    checks: l.checks, all_hold: hold, problem: l.problem || d.problem || null, keys_url: LEDGER_ORIGIN + FURUI_KEYS_PATH,
    how_to_check: "leaf_sha256 = sha256(0x00 || canonical envelope); fold the proof (RFC 6962 audit path) to the day record's root; the envelope's Ed25519 signature is over 'furui-check-signed-v1\\n' + canonical {schema, check, signer}",
    does_not_establish: FURUI_LIMITS };
}

/* ---------------------------------- rpc ------------------------------------ */

const SERVER_INFO = {
  protocolVersion: PROTOCOL_VERSION,
  capabilities: { tools: { listChanged: false } },
  serverInfo: { name: "hs-jidec-mcp", title: "HORIZON SHIELD JIDEC", version: VERSION },
  instructions:
    "JIDEC / NENRIN is a Bitcoin-anchored public verification ledger. Every tool here is read-only and requires no trust in HORIZON SHIELD: you fetch the bytes, you recompute the hash, you check the timestamp. For what an agent or MCP endpoint has done over time, call nenrin_resume (or nenrin_trust_signal for the compact form); for one submitted walk, nenrin_witness; for one admission or agreement record, nenrin_admission or nenrin_agreement (the Résumé lists them in admissions[] and agreements[]); for the content check runner's day record and one of its envelopes, nenrin_furui_day and nenrin_furui_leaf; for the chain itself, nenrin_ledger_head and nenrin_ledger_entry. To cite and recompute a record, jidec_cite then jidec_how_to_verify. A NENRIN history is not a score: a signature proves who asserted, not that it is true, and absence is not a negative finding. Offline verifier for NENRIN bundles: npx nenrin-verify.",
};


// The card the MCP Verification Gate reads (conditions 2 and 3): the card
// exists, and the compensation block states who pays. Machine readable, same
// as every sibling endpoint on this zone. 2026-08-17: added after the gate
// measured http 404 here while everything else passed.

// --- A2A Conduct Extension v1 (2026-09-06) ---
// 誰が払うか、行儀の記録(第三者が書いた物)がどこか、繋いだ相手が自分の観測をどこに出せるか。
// card の capabilities.extensions[] に置く(A2A 1.0 の正規の場所)。仕様は URI そのもの。点数も判定も無い。
const CONDUCT_EXT_URI = "https://gate.horizonshield.dev/ext/conduct/v1";
// 2026-10-02 legal-entity-v1: 扉と同じ定数と拡張。provider.legalEntity は proto に欄が無く署名の前に落ちるので、同じ値を拡張の params にも置く(params は署名に入る)。
const LEGAL_ENTITY_EXT_URI = "https://gate.horizonshield.dev/ext/legal-entity/v1";
const LEGAL_ENTITY = { registry: "JP", scheme: "houjin-bango", id: "7021001075279", name: "The HORIZ\u97f3s Co., Ltd." };
const LEGAL_ENTITY_LOOKUP_URL = "https://www.houjin-bangou.nta.go.jp/henkorireki-johoto.html?selHouzinNo=" + LEGAL_ENTITY.id;
function legalEntityExtension() {
  return { uri: LEGAL_ENTITY_EXT_URI, description: "The legal entity that answers for this agent, declared inside the signed bytes. The specification is served at the URI.", required: false, params: Object.assign({}, LEGAL_ENTITY, { lookup_url: LEGAL_ENTITY_LOOKUP_URL }) };
}
// 0.4.3 (2026-09-09). w3id.org の永続識別子。perma-id/w3id.org#6653 merge、302 で上の URI へ。
// A2A の拡張ガイダンスが perma-id を推しとるので、その綴りで活性化してくる client は出る。
// 識別子は 1 本のまま。読むのは閉じた 2 本の一覧、完全一致だけ。redirect は叩かん。
// echo は要求された綴りをそのまま返し、中身(metadata の鍵と Message.extensions)は常に正規の URI を名乗る。
const CONDUCT_EXT_PERMANENT_ID = "https://w3id.org/horizonshield/conduct/v1";
const CONDUCT_EXT_URIS = [CONDUCT_EXT_URI, CONDUCT_EXT_PERMANENT_ID];
const CONDUCT_MEASURED_ENDPOINT = "https://jidec.horizonshield.dev/mcp";
const CONDUCT_WITNESS_INTAKE = "https://ledger.horizonshield.dev/witness";
const CONDUCT_RECORD_URL = "https://gate.horizonshield.dev/history?endpoint=" + encodeURIComponent(CONDUCT_MEASURED_ENDPOINT);

// ---- Agent Card 署名 (A2A 1.0 §8.4: JWS ES256 over RFC 8785 of the proto-shaped card, signatures 欄は除く) ----
// 署名は Worker の中では作らん。鍵を持つ Mac の上で workers/a2a-card-sign/sign.mjs が公式 SDK(@a2a-js/sdk)の generator で計算し、
// 下の定数を書き換える(配備前、commit 対象)。Worker は鍵を持たず、公開鍵だけを /.well-known/jwks.json で配る。
// card の中身が変わったら署名は必ず作り直す。作り直さんと検証で落ちる = 改ざんと同じ顔になる。それが正しい。
// 署名は正規の origin(CARD_CANONICAL_ORIGIN)で配る card にだけ付ける。workers.dev の別名で開いた card は signatures 無し。
/* @@CARD_SIGNATURE_BEGIN */
const CARD_SIGNATURE = {
  "kid": "hs-2026-09",
  "jku": "https://jidec.horizonshield.dev/.well-known/jwks.json",
  "alg": "ES256",
  "protected": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpPU0UiLCJraWQiOiJocy0yMDI2LTA5Iiwiamt1IjoiaHR0cHM6Ly9qaWRlYy5ob3Jpem9uc2hpZWxkLmRldi8ud2VsbC1rbm93bi9qd2tzLmpzb24ifQ",
  "signature": "5Thg1m0AkJYAaXCICKFseMhEmOBGtrA80LHuQOgixkygNvDjlXU04wf7IYecTxMEztT_Sjpu1jSL_343qTCFOA",
  "plain": {
    "protected": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpPU0UiLCJraWQiOiJocy0yMDI2LTA5Iiwiamt1IjoiaHR0cHM6Ly9qaWRlYy5ob3Jpem9uc2hpZWxkLmRldi8ud2VsbC1rbm93bi9qd2tzLmpzb24ifQ",
    "signature": "CRk_sQ8lcXUz_8mtN9Qv8K2rTUj6ZomX68LJ8LkcIajZXMDDDLF2cNEGv7hKXxwb1DCvIM0f_vqEY1KpnDM8HQ"
  },
  "jwk": {
    "kty": "EC",
    "x": "CytwnuXFtXi7PFCcF-TCbvW5OgOg4KuWRLeRvdfHWLs",
    "y": "Zha3FI2QplMaGveXjrIg8PxrZ6dTjHmESoGs88uAIiA",
    "crv": "P-256",
    "kid": "hs-2026-09",
    "alg": "ES256",
    "use": "sig"
  },
  "canonical_sha256": "f5025430c717fc30473f61f3d3d4e91730db2349e862967759382029847042fe",
  "jcs_sha256": "c805bd4e5f72015c0e316240b3742b5a92315191b6c158520e4ee0cd580f0117"
};
/* @@CARD_SIGNATURE_END */
const CARD_CANONICAL_ORIGIN = "https://jidec.horizonshield.dev";
function withCardSignature(card, origin) {
  if (!CARD_SIGNATURE || !CARD_SIGNATURE.protected || !CARD_SIGNATURE.signature) return card;
  if (String(origin || "").replace(/\/+$/, "") !== CARD_CANONICAL_ORIGIN) return card;
  const entries = [{ protected: CARD_SIGNATURE.protected, signature: CARD_SIGNATURE.signature }];
  // 2 本目(あれば): 同じ鍵で素の RFC 8785 に署名した写し。公式 SDK 流の 1 本目と両立し、url を含む配信バイト全部を覆う。
  if (CARD_SIGNATURE.plain && CARD_SIGNATURE.plain.protected && CARD_SIGNATURE.plain.signature) entries.push({ protected: CARD_SIGNATURE.plain.protected, signature: CARD_SIGNATURE.plain.signature });
  return Object.assign({}, card, { signatures: entries });
}
function jwksDocument() {
  return { keys: CARD_SIGNATURE && CARD_SIGNATURE.jwk ? [CARD_SIGNATURE.jwk] : [] };
}
// hs-jidec-mcp の card の top-level compensation と同じ 5 鍵(扉 0.3.2 は両方読んで一致を要求する)。
const CONDUCT_COMPENSATION = {
  paid_by: "other",
  paid_by_note: "The operator funds this ledger itself, as the cost of making its own conduct checkable. Reading is free. Witness submission is free. No listed party pays, no reader pays, and there is no paid placement.",
  referral_fee: false,
  listing_fee: false,
  success_fee_pct: 0,
  disclosure_url: "https://ledger.horizonshield.dev/llms.txt"
};
function conductExtension() {
  return {
    uri: CONDUCT_EXT_URI,
    description: "Who pays this agent, where its measured conduct record lives, and where to file a witness walk. The specification is served at the URI.",
    required: false,
    params: {
      compensation: CONDUCT_COMPENSATION,
      measured_endpoints: [CONDUCT_MEASURED_ENDPOINT],
      conduct_record: CONDUCT_RECORD_URL,
      verdict_recipe: "https://gate.horizonshield.dev/spec",
      witness_intake: CONDUCT_WITNESS_INTAKE,
      register: "https://gate.horizonshield.dev/register",
      rings: {
        spec: "https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/NENRIN_SPEC_v1.md",
        spec_sha256: "9ccba2e325fd2a555fcdb2dec519b8c6bf7a669064674846aea98ecfff824e3d",
        base: "https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/rings/",
        path: "<slug>/<YYYY-MM>.json",
        slug: "endpoint URL without https://, lower case, every run of characters outside [a-z0-9] replaced by one hyphen, hyphens trimmed at both ends",
        ledger: "https://ledger.horizonshield.dev/ledger"
      }
    }
  };
}

// --- A2A 線の上の互換 (2026-09-06 第二波) ---
// この server は今まで MCP だけ喋り、card の url は A2A を喋らん場所を指しとった(看板が嘘)。/a2a を足して看板と口を揃える。
// 公式 SDK の実測: 0.3 互換路は X-A2A-Extensions を送る。1.0 の綴りは A2A-Extensions。読むのは両方、echo は A2A-Extensions + 要求の綴り。
const A2A_EXT_HEADER = "A2A-Extensions";
const A2A_EXT_HEADER_LEGACY = "X-A2A-Extensions";
const A2A_VERSION_HEADER = "A2A-Version";
function a2aRequestedExtensionUris(request) {
  const out = [];
  for (const name of [A2A_EXT_HEADER, A2A_EXT_HEADER_LEGACY]) {
    const h = request.headers.get(name) || "";
    for (const u of h.split(",")) { const t = u.trim(); if (t && !out.includes(t)) out.push(t); }
  }
  return out;
}
function a2aActivatedExtensions(request) { return a2aRequestedExtensionUris(request).filter((u) => CONDUCT_EXT_URIS.includes(u)); }
function a2aEchoHeaders(request, activated) {
  if (!activated.length) return {};
  const h = {}; h[A2A_EXT_HEADER] = activated.join(",");
  if (request.headers.get(A2A_EXT_HEADER_LEGACY)) h[A2A_EXT_HEADER_LEGACY] = activated.join(",");
  return h;
}
function a2aWire(method, request) {
  if (method === "SendMessage") return "1.0";
  if (method === "message/send") return "0.3";
  const v = ((request && request.headers.get(A2A_VERSION_HEADER)) || "").trim();
  return v.startsWith("1.") ? "1.0" : "0.3";
}
function a2aPartText(p) { return p && typeof p === "object" && typeof p.text === "string" && (p.kind === undefined || p.kind === "text") ? p.text : null; }
function a2aPart10(p) {
  if (!p || typeof p !== "object") return p;
  const o = {};
  if (p.kind === "text" || typeof p.text === "string") o.text = String(p.text === undefined ? "" : p.text);
  else if (p.kind === "data" || p.data !== undefined) o.data = p.data;
  else { for (const k of Object.keys(p)) if (k !== "kind") o[k] = p[k]; }
  if (p.metadata && typeof p.metadata === "object") o.metadata = p.metadata;
  return o;
}
function a2aMessage10(m) {
  const o = {};
  for (const k of Object.keys(m)) { if (k === "kind" || k === "role" || k === "parts") continue; o[k] = m[k]; }
  o.role = m.role === "user" ? "ROLE_USER" : m.role === "agent" ? "ROLE_AGENT" : "ROLE_UNSPECIFIED";
  o.parts = Array.isArray(m.parts) ? m.parts.map(a2aPart10) : [];
  return o;
}
function a2aSendMessageResult(result, wire) {
  if (wire !== "1.0" || !result || typeof result !== "object") return result;
  if (result.kind === "message") return { message: a2aMessage10(result) };
  return result;
}
// conduct-v1.4 (仕様 14 節, 2026-09-28)。/endpoint は「記録が当たる測定対象」(measured_endpoints の 1 本)、
// /served_by は「この要求が実際に届いた URL」。扉の /a2a が /mcp と名乗っとったのを外の証人が見つけた(同じ定数の型がここにもあった)。
// served_by は要求から取る。定数は 1 か所で配られとる間しか正しくない。query と fragment は入れん。
function servedByOf(request) {
  const u = new URL(request.url);
  return u.origin + u.pathname;
}
function conductMetadata(servedBy) {
  const m = {};
  m[CONDUCT_EXT_URI + "/endpoint"] = CONDUCT_MEASURED_ENDPOINT;
  m[CONDUCT_EXT_URI + "/conduct_record"] = CONDUCT_RECORD_URL;
  m[CONDUCT_EXT_URI + "/witness_intake"] = CONDUCT_WITNESS_INTAKE;
  if (typeof servedBy === "string" && servedBy) m[CONDUCT_EXT_URI + "/served_by"] = servedBy;
  return m;
}
function a2aAttachConduct(result, servedBy) {
  result.metadata = Object.assign({}, result.metadata || {}, conductMetadata(servedBy));
  const ex = Array.isArray(result.extensions) ? result.extensions.slice() : [];
  if (!ex.includes(CONDUCT_EXT_URI)) ex.push(CONDUCT_EXT_URI);
  result.extensions = ex;
  return result;
}
const A2A_URL = "https://jidec.horizonshield.dev/a2a";
// A2A の口: text part の引用(jidec:entry:<n> / jidec:path:<sha> / 64-hex / 数字)を jidec_cite に渡し、Message で返す。
// 引用が無ければ使い方を返す(エラーにせん: 相手は人でなく agent、次の一手が要る)。
async function handleA2A(req, env, cors) {
  let b; try { b = await req.json(); } catch { b = null; }
  const rid = b && b.id !== undefined ? b.id : null;
  const activated = a2aActivatedExtensions(req);
  const echo = a2aEchoHeaders(req, activated);
  const send = (payload, status) => new Response(JSON.stringify({ jsonrpc: "2.0", id: rid, ...payload }), { status: status || 200, headers: { "Content-Type": "application/json", ...cors, ...echo } });
  if (!b || b.jsonrpc !== "2.0") return send({ error: { code: -32600, message: "invalid request: jsonrpc 2.0 envelope required" } });
  if (b.method !== "message/send" && b.method !== "SendMessage")
    return send({ error: { code: -32601, message: "method not found: " + String(b.method) + ". This agent implements SendMessage (1.0) and message/send (0.3); send a JIDEC citation as a text part." } });
  const wire = a2aWire(b.method, req);
  const parts = (b.params && b.params.message && Array.isArray(b.params.message.parts)) ? b.params.message.parts : [];
  const text = parts.map(a2aPartText).filter((x) => typeof x === "string").join(" ").trim();
  const cite = text.match(/jidec:[a-z]*:?[0-9a-f]+|[0-9a-f]{64}|\b\d+\b/i);
  let result;
  if (!cite) {
    result = { kind: "message", role: "agent", messageId: crypto.randomUUID(), parts: [
      { kind: "text", text: "Send a JIDEC citation as a text part: jidec:entry:<n>, jidec:path:<sha256>, a bare 64-hex id, or an entry number. This agent resolves it, recomputes the SHA-256, and reports the Bitcoin anchoring status. Tools over MCP: " + CONDUCT_MEASURED_ENDPOINT },
      { kind: "data", data: { skills: AGENT_CARD.skills.map((s) => s.id), mcp: CONDUCT_MEASURED_ENDPOINT, ledger: LEDGER_ORIGIN } }
    ] };
  } else {
    try {
      const out = await callTool("jidec_cite", { citation: cite[0] }, env);
      result = { kind: "message", role: "agent", messageId: crypto.randomUUID(), parts: [
        { kind: "text", text: typeof out.trust_note === "string" ? out.trust_note : ("Resolved " + cite[0] + ". Recompute the SHA-256 yourself; the data part carries the bytes location and the anchor status.") },
        { kind: "data", data: out }
      ] };
    } catch (e) {
      return send({ error: { code: -32000, message: String((e && e.message) || e) } });
    }
  }
  if (activated.length) result = a2aAttachConduct(result, servedByOf(req));  // 0.4.3: どっちの綴りでも中身は同じ
  return send({ result: a2aSendMessageResult(result, wire) });
}

const AGENT_CARD = {
  // 2026-09-06 第二波: 1.0 の supportedInterfaces と 0.3 の url/preferredTransport/protocolVersion を同居させる。
  // url は A2A を喋る /a2a を指す(以前は MCP しか無い root を指しとって、A2A client には -32601 か 404 が返っとった)。
  supportedInterfaces: [
    { url: A2A_URL, protocolBinding: "JSONRPC", protocolVersion: "1.0" },
    { url: A2A_URL, protocolBinding: "JSONRPC", protocolVersion: "0.3" }
  ],
  protocolVersion: "0.3.0",
  name: "HORIZON SHIELD JIDEC",
  description: "Read-only MCP interface to JIDEC / NENRIN, a Bitcoin-anchored public verification ledger. Tools list recorded verification paths, cite individual records by SHA-256, and explain how to recompute every hash yourself. The operator holds no delete route in code: valid submissions stay, including ones that embarrass the operator. Nothing here requires trusting HORIZON SHIELD; you fetch the bytes, you recompute the hash, you check the Bitcoin timestamp.",
  url: A2A_URL,
  preferredTransport: "JSONRPC",
  provider: { organization: "The HORIZONs\u682a\u5f0f\u4f1a\u793e", url: "https://shield.the-horizons-innovation.com", legalEntity: LEGAL_ENTITY },
  version: CARD_VERSION,
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false, extensions: [conductExtension(), legalEntityExtension()] },
  defaultInputModes: ["application/json", "text/plain"],
  defaultOutputModes: ["application/json", "text/plain"],
  // 2026-10-02 Security declaration: この worker に認証の口は無い(読み取り専用、運営の口も無い)。[{}] は「匿名で呼べる」の明示(OpenAPI と同じ読み方)。
  // 無い scheme は宣言せん。[{}] は公式 SDK の canonicalizer が空として落とすので署名の対象には入らん(扉と同じ)。
  securityRequirements: [{}],
  // top-level は旧読者のため。extension の params.compensation と同じ物(扉 0.3.2 は一致を要求する)。
  compensation: CONDUCT_COMPENSATION,
  skills: [
    { id: "jidec-list-paths", name: "List verification paths", description: "Enumerate the verification paths recorded on the ledger, newest first, with their anchor status.", tags: ["ledger", "verification", "bitcoin"] },
    { id: "jidec-cite", name: "Cite a record", description: "Return a citable record with its SHA-256 and Bitcoin anchor, so another agent can quote it without trusting this server.", tags: ["citation", "sha256", "opentimestamps"] },
    { id: "jidec-replay", name: "Replay a verification", description: "Re-run the recorded verification steps and compare the result against the anchored hash.", tags: ["replay", "recompute"] },
    { id: "jidec-how-to-verify", name: "How to verify", description: "Step-by-step instructions for recomputing any record hash and checking its Bitcoin timestamp with independent tools.", tags: ["verify", "instructions"] }
  ]
};

function wantsSSE(req) {
  return (req.headers.get("Accept") || "").includes("text/event-stream");
}
function rpcSend(req, id, payload, cors) {
  const msg = { jsonrpc: "2.0", id, ...payload };
  if (wantsSSE(req)) {
    return new Response(`event: message\ndata: ${JSON.stringify(msg)}\n\n`, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...cors },
    });
  }
  return new Response(JSON.stringify(msg), { headers: { "Content-Type": "application/json", ...cors } });
}
const rpcResult = (req, id, result, cors) => rpcSend(req, id, { result }, cors);
const rpcError = (req, id, code, message, cors) => rpcSend(req, id, { error: { code, message } }, cors);

/* --------------------------------- fetch ----------------------------------- */

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const oc = checkOrigin(req, env);
    const cors = corsHeaders(oc.origin);

    if (!oc.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "forbidden_origin",
          detail:
            "Origin not permitted. This server validates Origin per the MCP transport security requirement (DNS rebinding). Opaque origins are refused.",
        }),
        { status: 403, headers: { "Content-Type": "application/json", Vary: "Origin" } }
      );
    }

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        JSON.stringify(
          {
            ok: true,
            service: "hs-jidec-mcp",
            version: VERSION,
            mcp: { endpoint: "/mcp", transport: "streamable-http", protocol_version: PROTOCOL_VERSION, stateless: true },
            a2a: { endpoint: "/a2a", methods: ["SendMessage", "message/send"], agent_card: "/.well-known/agent-card.json", jwks: "/.well-known/jwks.json" },
            tools: TOOLS.map((t) => t.name),
            read_only: true,
            ledger: LEDGER_ORIGIN,
            discovery: LEDGER_ORIGIN + "/.well-known/api-catalog",
          },
          null,
          2
        ),
        { headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    if (url.pathname === "/.well-known/glama.json") {
      return new Response(JSON.stringify({ "$schema": "https://glama.ai/mcp/schemas/connector.json", maintainers: [{ email: "ogasurfproject@gmail.com" }] }, null, 2), { headers: { "Content-Type": "application/json", ...cors } });
    }

    if (url.pathname === "/.well-known/agent-card.json") {
      return new Response(JSON.stringify(withCardSignature(AGENT_CARD, url.origin), null, 2), { headers: { "Content-Type": "application/json", ...cors } });
    }
    if (url.pathname === "/.well-known/jwks.json") {
      return new Response(JSON.stringify(jwksDocument(), null, 2), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600", ...cors } });
    }

    // A2A JSON-RPC (2026-09-06 第二波)。card の supportedInterfaces / url がここを指す。
    if (url.pathname === "/a2a") {
      if (req.method === "GET") {
        return new Response(JSON.stringify({ ok: true, transport: "A2A JSON-RPC (POST)", methods: ["SendMessage", "message/send"], agent_card: "/.well-known/agent-card.json", extensions: [CONDUCT_EXT_URI] }), { headers: { "Content-Type": "application/json", ...cors } });
      }
      if (req.method !== "POST") {
        return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), { status: 405, headers: { "Content-Type": "application/json", Allow: "POST, GET, OPTIONS", ...cors } });
      }
      return await handleA2A(req, env, cors);
    }

    if (url.pathname === "/mcp") {
      // The spec MUSTs one endpoint serving both POST and GET. This server does
      // not offer a server-initiated SSE stream, so GET is 405 (method not
      // allowed here) rather than 404 (endpoint does not exist).
      if (req.method === "GET") {
        return new Response(
          JSON.stringify({ ok: false, error: "method_not_allowed", detail: "This MCP endpoint is stateless and offers no server-initiated SSE stream. Use POST." }),
          { status: 405, headers: { "Content-Type": "application/json", Allow: "POST, OPTIONS", ...cors } }
        );
      }

      if (req.method !== "POST") {
        return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json", Allow: "POST, GET, OPTIONS", ...cors },
        });
      }

      let body;
      try { body = await req.json(); } catch { return rpcError(req, null, -32700, "parse error", cors); }
      const { id, method, params } = body || {};

      // Stateless by construction: `initialize` is honoured for clients on
      // 2025-11-25 and earlier, and is simply not required by clients on
      // 2026-07-28 and later, which may call tools/* directly.
      if (method === "initialize") return rpcResult(req, id, SERVER_INFO, cors);
      if (method === "ping") return rpcResult(req, id, {}, cors);
      if (method && method.startsWith("notifications/")) return new Response(null, { status: 202, headers: cors });
      if (method === "tools/list") return rpcResult(req, id, { tools: TOOLS }, cors);
      if (method === "tools/call") {
        try {
          const out = await callTool(params?.name, params?.arguments || {}, env);
          // Every tool here declares an outputSchema, so a successful result MUST
          // carry structuredContent (MCP 2025-06-18). The text block stays for
          // clients that predate structured output.
          const structured = (out && typeof out === "object" && !Array.isArray(out)) ? out : { value: out };
          return rpcResult(
            req,
            id,
            { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: structured },
            cors
          );
        } catch (e) {
          // Tool-level failures are reported as results with isError, per spec,
          // so the model can see and reason about the failure text.
          return rpcResult(
            req,
            id,
            { content: [{ type: "text", text: String((e && e.message) || e) }], isError: true },
            cors
          );
        }
      }
      return rpcError(req, id, -32601, `method not found: ${method}`, cors);
    }

    return new Response(
      JSON.stringify({ ok: false, error: "not_found", try: "/mcp (POST), /a2a (POST) or /health" }),
      { status: 404, headers: { "Content-Type": "application/json", ...cors } }
    );
  },
};
