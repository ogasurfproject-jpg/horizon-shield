// hs-jidec-mcp — Model Context Protocol server for JIDEC verification paths.
//
// Phase 4 of jidec-path-v1. Lets any MCP-capable agent cite and re-check a
// Bitcoin-anchored verification path by URI, without trusting HORIZON SHIELD.
//
// Tools:
//   jidec_cite(citation)            resolve + independently verify any citation
//   jidec_replay(citation)          re-observe the anchored path live, report drift
//   jidec_list_paths()              list anchored verification paths
//   jidec_how_to_verify(citation)   emit the executable verification recipe
//
// This worker is NEW and ISOLATED — it touches no existing service. It reaches
// the ledger through a service binding (LEDGER_SVC), not the public hostname,
// so same-account workers.dev subrequests cannot loop back. Reads only; no
// secrets; open so that "any AI can cite" holds literally.
//
// ---------------------------------------------------------------------------
// v1.1 (2026-07-26) — spec conformance pass, per KANBAN_TO_ANNAININ_v1.md §5.
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

// 2026-08-11: advertised origin moved to the domain we control. hs-ledger
// accepts both hostnames for replay (SELF_LEDGER_HOSTS), so records anchored
// under the old hostname still re-observe correctly when reached through this.
const LEDGER_ORIGIN = "https://ledger.horizonshield.dev";
const HEX64 = /^[0-9a-f]{64}$/i;
const VERSION = "1.2.1";
const PROTOCOL_VERSION = "2025-11-25";

/* ------------------------------ origin policy ------------------------------ */

// Returns { ok, origin } — origin is the value to echo in ACAO.
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
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
// claim_sha256 — the same route any third party would take, no privileged access.
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
  return { kind: "v0", obj };
}

// Build a citation card from raw bytes. Field-for-field compatible with
// path/jidec_cite.py so that the CLI and this server can be diffed against
// each other — two independent implementations agreeing is the point.
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
  } else {
    card.note = "This entry predates the v1 schemas (v0). Its bytes are still anchored and hash-checkable.";
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

  card.limits =
    "What this proves: these exact bytes existed at or before the anchored time and have not changed. " +
    "What this does NOT prove: that the estimate is fair, that the input data is true, or that HORIZON SHIELD is competent. " +
    "Those are judged by re-running the recipe at verify_url yourself.";

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
        "holds none. It never means the ledger could not be read — that is an error.",
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
];

async function callTool(name, args, env) {
  if (name === "jidec_list_paths") {
    const r = await ledgerGet(env, "/paths");
    // The read either worked or it did not. Say which. Do not hand back a body
    // that might be an error page and let it read as a list of zero paths.
    if (r.status !== 200)
      throw new Error(
        "the ledger could not be read: HTTP " + r.status + ". This is NOT a report " +
        "that there are no anchored paths — this server does not know how many there are."
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

  throw new Error("unknown tool: " + name);
}

/* ---------------------------------- rpc ------------------------------------ */

const SERVER_INFO = {
  protocolVersion: PROTOCOL_VERSION,
  capabilities: { tools: { listChanged: false } },
  serverInfo: { name: "hs-jidec-mcp", title: "HORIZON SHIELD JIDEC", version: VERSION },
  instructions:
    "JIDEC is a Bitcoin-anchored public verification ledger. Every tool here is read-only and requires no trust in HORIZON SHIELD: you fetch the bytes, you recompute the hash, you check the timestamp. Start with jidec_list_paths, then jidec_cite a record, then jidec_how_to_verify if you want to reproduce the result yourself.",
};


// The card the MCP Verification Gate reads (conditions 2 and 3): the card
// exists, and the compensation block states who pays. Machine readable, same
// as every sibling endpoint on this zone. 2026-08-17: added after the gate
// measured http 404 here while everything else passed.

// --- A2A Conduct Extension v1 (2026-09-06) ---
// 誰が払うか、行儀の記録(第三者が書いた物)がどこか、繋いだ相手が自分の観測をどこに出せるか。
// card の capabilities.extensions[] に置く(A2A 1.0 の正規の場所)。仕様は URI そのもの。点数も判定も無い。
const CONDUCT_EXT_URI = "https://gate.horizonshield.dev/ext/conduct/v1";
const CONDUCT_MEASURED_ENDPOINT = "https://jidec.horizonshield.dev/mcp";
const CONDUCT_WITNESS_INTAKE = "https://ledger.horizonshield.dev/witness";
const CONDUCT_RECORD_URL = "https://gate.horizonshield.dev/history?endpoint=" + encodeURIComponent(CONDUCT_MEASURED_ENDPOINT);
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

const AGENT_CARD = {
  protocolVersion: "0.3.0",
  name: "HORIZON SHIELD JIDEC",
  description: "Read-only MCP interface to JIDEC / NENRIN, a Bitcoin-anchored public verification ledger. Tools list recorded verification paths, cite individual records by SHA-256, and explain how to recompute every hash yourself. The operator holds no delete route in code: valid submissions stay, including ones that embarrass the operator. Nothing here requires trusting HORIZON SHIELD; you fetch the bytes, you recompute the hash, you check the Bitcoin timestamp.",
  url: "https://jidec.horizonshield.dev",
  preferredTransport: "JSONRPC",
  provider: { organization: "The HORIZONs\u682a\u5f0f\u4f1a\u793e", url: "https://shield.the-horizons-innovation.com" },
  version: VERSION,
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false, extensions: [conductExtension()] },
  defaultInputModes: ["application/json", "text/plain"],
  defaultOutputModes: ["application/json", "text/plain"],
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
      return new Response(JSON.stringify(AGENT_CARD, null, 2), { headers: { "Content-Type": "application/json", ...cors } });
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
      JSON.stringify({ ok: false, error: "not_found", try: "/mcp (POST) or /health" }),
      { status: 404, headers: { "Content-Type": "application/json", ...cors } }
    );
  },
};
