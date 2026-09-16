// task_ledger_v0.mjs : additive NENRIN ledger face for A2A task-bound conduct observations (bind-v0).
//
// Workers-native crypto (Web Crypto, no Node built-in): deploys without the nodejs_compat flag and changes
// nothing about the ledger worker's runtime. evidence_id is byte-identical to bind.mjs (same simplified-JCS
// canonical + SHA-256), so the offline reference impl and this live face agree on every hash.
//
// Parallel to the existing endpoint-keyed witness path; touches none of it. It anchors evidence on the
// A2A Task `id` (a2a.task.id, aligned to A2A issues #1769 / #2103), so a verifier can ask "who did what on
// THIS delegated task, observed by whom" instead of "this agent failed once".
//
// Content invariants (always): R1 independence, R2 recompute, R3 chain continuity, R4 non-suppression.
// Attribution (optional, verified when present): witness_sig (Ed25519 by the witness over canonical(preimage))
// makes the verdict attributable; edge_sig (Ed25519 by hop.from over canonical({task_id,hop})) makes the
// delegation edge party-attested. Keys resolve from did:key with no network (self-contained, offline byte-match).
// A present-but-invalid signature is REJECTED (422); an absent signature is accepted (unsigned, content-only).
//
// Routes (additive):
//   POST /witness/task              body = a WitnessObservation (evidence_id present; witness_sig/edge_sig optional)
//   GET  /witness/task?task_id=..   [&hop=<seq>]  -> full set + per-hop aggregate (R4) + chain check (R3)
//   GET  /trust-signal?task_id=..   -> consumable task-bound conduct signal (counts and verdicts, never a score)
//
// KV layout (all under nenrin:task:, disjoint from every existing key):
//   nenrin:task:obs:<evidence_id>                 -> canonical bytes of the observation
//   nenrin:task:<task_id>:<hop.seq>:<witness_id>  -> <evidence_id>   (index, one per independent witness)

const enc = new TextEncoder();

export async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}

const DERIVED_FIELDS = ["evidence_id", "witness_sig", "edge_sig"];
function preimage(obs) {
  const b = Object.assign({}, obs);
  for (const k of DERIVED_FIELDS) delete b[k];
  return b;
}
export async function evidenceId(obs) {
  return sha256hex(canonical(preimage(obs)));
}

function witnessIndependent(obs) {
  return obs.witness_id !== obs.hop.from && obs.witness_id !== obs.hop.to;
}
async function recomputeOk(obs) {
  return typeof obs.evidence_id === "string" && obs.evidence_id === (await evidenceId(obs));
}
async function verifyObservation(obs) {
  if (!witnessIndependent(obs)) return { ok: false, reason: "witness_not_independent" };
  if (!(await recomputeOk(obs))) return { ok: false, reason: "recompute_mismatch" };
  return { ok: true };
}
async function chainContinuous(observations) {
  const ord = observations.slice().sort((a, b) => a.hop.seq - b.hop.seq);
  for (let i = 0; i < ord.length; i++) {
    const o = ord[i];
    if (o.hop.seq !== i) return { ok: false, reason: "seq_gap", at: i };
    if (i === 0) {
      if (o.prev_evidence_id !== null) return { ok: false, reason: "root_prev_not_null", at: i };
    } else if (o.prev_evidence_id !== (await evidenceId(ord[i - 1]))) {
      return { ok: false, reason: "broken_link", at: i };
    }
  }
  return { ok: true };
}
function aggregateVerdict(observationsForHop) {
  const verdicts = [...new Set(observationsForHop.map((o) => o.conduct.verdict))];
  if (verdicts.length === 0) return "no_evidence";
  if (verdicts.length > 1) return "disagreement";
  return verdicts[0];
}

// ---- attribution: did:key (Ed25519) resolution + signature verification, all offline (Web Crypto) ----
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s) {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const ch of s) { if (ch === "1") bytes.unshift(0); else break; }
  return new Uint8Array(bytes);
}
function pubFromDidKey(did) {
  if (typeof did !== "string" || !did.startsWith("did:key:z")) return null;
  const dec = b58decode(did.slice("did:key:z".length));
  if (!dec || dec.length !== 34 || dec[0] !== 0xed || dec[1] !== 0x01) return null; // multicodec ed25519-pub
  return dec.slice(2);
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
async function ed25519Verify(pubRaw, sigB64, msg) {
  try {
    const key = await crypto.subtle.importKey("raw", pubRaw, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, b64ToBytes(sigB64), enc.encode(msg));
  } catch { return false; }
}
// Verify present signatures. Returns {ok} or {ok:false, reason}. Absent signatures are allowed (content-only).
async function verifySignatures(obs) {
  if (typeof obs.witness_sig === "string") {
    const pub = pubFromDidKey(obs.witness_id);
    if (!pub) return { ok: false, reason: "witness_id_not_did_key" };
    if (!(await ed25519Verify(pub, obs.witness_sig, canonical(preimage(obs))))) return { ok: false, reason: "witness_sig_invalid" };
  }
  if (typeof obs.edge_sig === "string") {
    const pub = pubFromDidKey(obs.hop.from);
    if (!pub) return { ok: false, reason: "hop_from_not_did_key" };
    if (!(await ed25519Verify(pub, obs.edge_sig, canonical({ task_id: obs.task_id, hop: obs.hop })))) return { ok: false, reason: "edge_sig_invalid" };
  }
  return { ok: true };
}

const OBS_KEY = (eid) => "nenrin:task:obs:" + eid;
const IDX_KEY = (tid, seq, wid) => "nenrin:task:" + tid + ":" + seq + ":" + wid;
const IDX_PREFIX = (tid) => "nenrin:task:" + tid + ":";

function j(o, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

function shapeError(obs) {
  if (!obs || typeof obs !== "object") return "not_an_object";
  if (typeof obs.task_id !== "string" || obs.task_id === "") return "task_id_missing";
  if (!obs.hop || typeof obs.hop.seq !== "number" || typeof obs.hop.from !== "string" || typeof obs.hop.to !== "string") return "hop_missing";
  if (!("prev_evidence_id" in obs) || (obs.prev_evidence_id !== null && typeof obs.prev_evidence_id !== "string")) return "prev_evidence_id_missing";
  if (!obs.conduct || typeof obs.conduct.verdict !== "string") return "conduct_verdict_missing";
  if (typeof obs.witness_id !== "string" || obs.witness_id === "") return "witness_id_missing";
  if (typeof obs.evidence_id !== "string" || obs.evidence_id === "") return "evidence_id_missing";
  return null;
}

export async function handleTaskWitnessPost(request, env) {
  let obs;
  try { obs = await request.json(); } catch { return j({ ok: false, error: "bad_json" }, 400); }
  const se = shapeError(obs);
  if (se) return j({ ok: false, error: se, need: "task_id, hop{seq,from,to}, prev_evidence_id, conduct{verdict}, witness_id, evidence_id" }, 400);
  const v = await verifyObservation(obs); // R1 independence + R2 recompute
  if (!v.ok) return j({ ok: false, error: v.reason }, 422);
  const s = await verifySignatures(obs); // optional attribution; present-but-invalid is rejected
  if (!s.ok) return j({ ok: false, error: s.reason }, 422);
  const eid = obs.evidence_id;
  await env.LEDGER.put(OBS_KEY(eid), canonical(obs));
  await env.LEDGER.put(IDX_KEY(obs.task_id, obs.hop.seq, obs.witness_id), eid);
  return j({
    ok: true, stored: true, task_id: obs.task_id, hop_seq: obs.hop.seq, witness_id: obs.witness_id,
    evidence_id: eid, witness_sig: typeof obs.witness_sig === "string", edge_sig: typeof obs.edge_sig === "string",
  });
}

export async function handleTaskWitnessGet(url, env) {
  const tid = url.searchParams.get("task_id");
  if (!tid) return j({ ok: false, error: "task_id_required" }, 400);
  const hopFilter = url.searchParams.get("hop");

  const listed = await env.LEDGER.list({ prefix: IDX_PREFIX(tid) });
  const seen = new Set();
  const obs = [];
  for (const entry of (listed.keys || [])) {
    const eid = await env.LEDGER.get(entry.name);
    if (!eid || seen.has(eid)) continue;
    seen.add(eid);
    const raw = await env.LEDGER.get(OBS_KEY(eid));
    if (!raw) continue;
    let o;
    try { o = JSON.parse(raw); } catch { continue; }
    obs.push(o);
  }

  const byHop = {};
  for (const o of obs) (byHop[o.hop.seq] = byHop[o.hop.seq] || []).push(o);
  let hops = Object.keys(byHop).map(Number).sort((a, b) => a - b).map((seq) => ({
    hop_seq: seq,
    from: byHop[seq][0].hop.from,
    to: byHop[seq][0].hop.to,
    witnesses: byHop[seq].length,
    signed_witnesses: byHop[seq].filter((o) => typeof o.witness_sig === "string").length,
    edge_attested: byHop[seq].some((o) => typeof o.edge_sig === "string"),
    verdict: aggregateVerdict(byHop[seq]),
    evidence_ids: byHop[seq].map((o) => o.evidence_id).sort(),
  }));

  const repr = hops.map((h) => byHop[h.hop_seq][0]);
  const chain = await chainContinuous(repr);

  if (hopFilter !== null) hops = hops.filter((h) => h.hop_seq === Number(hopFilter));

  return j({
    ok: true,
    task_id: tid,
    hops_observed: hops.length,
    chain_continuous: chain.ok,
    chain_reason: chain.ok ? undefined : chain.reason,
    hops,
    honest: "verdict per hop aggregates the FULL witness set; disagreement is preserved, never the favorable one. Signatures prove who asserted and linkage (attributable, non-repudiable), not that the assertion is true.",
    recompute: "evidence_id = sha256(canonical(observation minus derived fields)). witness_sig is Ed25519 over the same canonical preimage; the key is inside witness_id (did:key). Recompute and verify yourself.",
    aligns_to: "A2A Task id (a2a.task.id); A2A issues #1769, #2103",
  });
}

// ---- task-bound trust signal (additive read surface) ----
// The same content as GET /witness/task, shaped as a consumable signal: counts and verdicts only, never a
// score; adverse hops are named, never hidden; disclosure (issuer_is_party) and recompute travel with it.
async function collectTaskObservations(env, tid) {
  const listed = await env.LEDGER.list({ prefix: IDX_PREFIX(tid) });
  const seen = new Set();
  const obs = [];
  for (const entry of (listed.keys || [])) {
    const eid = await env.LEDGER.get(entry.name);
    if (!eid || seen.has(eid)) continue;
    seen.add(eid);
    const raw = await env.LEDGER.get(OBS_KEY(eid));
    if (!raw) continue;
    let o; try { o = JSON.parse(raw); } catch { continue; }
    obs.push(o);
  }
  return obs;
}

// GET /trust-signal?task_id=<id> : task-bound conduct signal. Returns null for any other shape so the
// existing endpoint-keyed /trust-signal handler is reached untouched.
export async function handleTaskTrustSignal(p, request, url, env) {
  if (p !== "/trust-signal" || request.method !== "GET") return null;
  const tid = url.searchParams.get("task_id");
  if (!tid) return null;

  const obs = await collectTaskObservations(env, tid);
  const byHop = {};
  for (const o of obs) (byHop[o.hop.seq] = byHop[o.hop.seq] || []).push(o);
  const seqs = Object.keys(byHop).map(Number).sort((a, b) => a - b);
  const delegation = seqs.map((seq) => {
    const set = byHop[seq];
    const signed = set.filter((o) => typeof o.witness_sig === "string").length;
    return {
      hop_seq: seq,
      from: set[0].hop.from,
      to: set[0].hop.to,
      verdict: aggregateVerdict(set),
      witnesses: set.length,
      signed_witnesses: signed,
      edge_attested: set.some((o) => typeof o.edge_sig === "string"),
      attributable: signed > 0,
      independent: true,
      evidence_ids: set.map((o) => o.evidence_id).sort(),
    };
  });
  const repr = seqs.map((seq) => byHop[seq][0]);
  const chain = await chainContinuous(repr);
  const adverse_hops = delegation.filter((h) => h.verdict === "FAIL" || h.verdict === "disagreement").map((h) => h.hop_seq);
  const as_of = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const issuer = url.origin.replace(/\/$/, "");

  return j({
    ok: true,
    signal: "task-conduct-trust-signal-v0",
    task_id: tid,
    as_of,
    issuer,
    issuer_is_party: false,
    hops_observed: delegation.length,
    chain_continuous: chain.ok,
    chain_reason: chain.ok ? undefined : chain.reason,
    delegation,
    adverse_hops,
    honest: "verdict per hop aggregates the FULL witness set; disagreement is preserved, never the favorable one. Signatures prove who asserted and the delegation edge, not that the assertion is true.",
    recompute: "GET " + issuer + "/witness/task?task_id=" + encodeURIComponent(tid) + " for the full observation set; evidence_id = sha256(canonical(obs minus derived fields)); witness_sig/edge_sig are Ed25519 over the canonical preimage and canonical({task_id,hop}), the key is inside the did:key. Recompute and verify yourself.",
    not_a_score: "counts and verdicts only; this signal never emits a numeric trustworthiness score.",
    aligns_to: "A2A Task id (a2a.task.id); A2A issues #1769, #2103",
  });
}

// Additive dispatcher for the ledger worker. Returns null when the path is not ours (no interference).
export async function handleTaskWitness(p, request, url, env) {
  if (p !== "/witness/task") return null;
  try {
    if (request.method === "POST") return await handleTaskWitnessPost(request, env);
    if (request.method === "GET") return await handleTaskWitnessGet(url, env);
    return j({ ok: false, error: "method_not_allowed" }, 405);
  } catch (e) {
    // Additive module must never crash the shared ledger worker: handle() has no outer try/catch, so an
    // internal throw here would surface as a Cloudflare 1101 (non-JSON). Convert it to a clean JSON 500
    // that also reports the cause, so a client sees a diagnosable error instead of a dead worker.
    return j({ ok: false, error: "task_witness_internal", detail: String((e && e.message) || e), stack: String((e && e.stack) || "").slice(0, 600) }, 500);
  }
}
