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
// Carriage line (conferred-not-acquired): the observation rides as a sibling record keyed by task_id, never
// inside a party-signed payload. GET is read-only and recomputable by anyone. R4 returns the FULL witness set
// per hop, so a party cannot present a favorable subset as consensus.
//
// Routes (additive):
//   POST /witness/task              body = a WitnessObservation (evidence_id present)
//   GET  /witness/task?task_id=..   [&hop=<seq>]  -> full set + per-hop aggregate (R4) + chain check (R3)
//
// KV layout (all under nenrin:task:, disjoint from every existing key):
//   nenrin:task:obs:<evidence_id>                 -> canonical bytes of the observation
//   nenrin:task:<task_id>:<hop.seq>:<witness_id>  -> <evidence_id>   (index, one per independent witness)

const enc = new TextEncoder();

export async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// simplified JCS: recursive key sort, no whitespace. Deterministic across implementations (matches bind.mjs).
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
  const eid = obs.evidence_id;
  await env.LEDGER.put(OBS_KEY(eid), canonical(obs));
  await env.LEDGER.put(IDX_KEY(obs.task_id, obs.hop.seq, obs.witness_id), eid);
  return j({ ok: true, stored: true, task_id: obs.task_id, hop_seq: obs.hop.seq, witness_id: obs.witness_id, evidence_id: eid });
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
    honest: "verdict per hop aggregates the FULL witness set; disagreement is preserved, never the favorable one. Signatures and digests prove who asserted and linkage, not that the assertion is true.",
    recompute: "evidence_id = sha256(canonical(observation minus derived fields)). Fetch each and recompute yourself.",
    aligns_to: "A2A Task id (a2a.task.id); A2A issues #1769, #2103",
  });
}

// Additive dispatcher for the ledger worker. Returns null when the path is not ours (no interference).
export async function handleTaskWitness(p, request, url, env) {
  if (p !== "/witness/task") return null;
  if (request.method === "POST") return handleTaskWitnessPost(request, env);
  if (request.method === "GET") return handleTaskWitnessGet(url, env);
  return j({ ok: false, error: "method_not_allowed" }, 405);
}
