// task-delegation-bind-v0 : deterministic binding of an A2A Task id to NENRIN conduct evidence.
// 番人 reference impl (2026-09-16). Standard-track: anchors on the A2A Task `id` (v1.0 literal, tasks/get).
// Evidence rides ALONGSIDE the task (a sibling NENRIN record keyed by task_id), never inside a party-signed
// payload. That is the conferred-not-acquired line: the party under evaluation cannot mint its own verdict.
// Same primitive shape as the AP2 fair-price attestation (content hash + independent recompute + sibling carriage).
import { createHash } from "node:crypto";
import { parseStrict, checkCanonicalInput } from "./strict_json.mjs";
export { parseStrict, checkCanonicalInput };

export const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// Canonical form, pinned (SPEC.md): keys sorted by code point (keys are printable ASCII, so every runtime sorts
// them the same way), no whitespace, strings escaped only for '"', '\\' and U+0000..U+001F, non-ASCII raw,
// integers only within plus or minus 2^53 - 1. canonical() refuses input outside the rule instead of producing
// bytes another runtime might not reproduce; parseStrict() refuses duplicate keys before anything is hashed.
function canon(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}
export function canonical(v) {
  checkCanonicalInput(v);
  return canon(v);
}

// evidence_id = content hash over the preimage (the record minus derived/envelope fields).
// Signatures are excluded so adding them never changes evidence_id, and the witness signs the same bytes.
const DERIVED_FIELDS = ["evidence_id", "witness_sig", "edge_sig"];
export function preimage(obs) {
  const b = Object.assign({}, obs);
  for (const k of DERIVED_FIELDS) delete b[k];
  return b;
}
export function evidenceId(obs) {
  return sha256hex(canonical(preimage(obs)));
}

// R1 independence: the witness must not be either party of the hop it observes.
export function witnessIndependent(obs) {
  return obs.witness_id !== obs.hop.from && obs.witness_id !== obs.hop.to;
}

// R2 recompute: stored evidence_id must equal the recomputed content hash (detects tamper and bind-swap).
export function recomputeOk(obs) {
  return typeof obs.evidence_id === "string" && obs.evidence_id === evidenceId(obs);
}

// verify one observation on its own (R1 + R2).
export function verifyObservation(obs) {
  if (!witnessIndependent(obs)) return { ok: false, reason: "witness_not_independent" };
  if (!recomputeOk(obs)) return { ok: false, reason: "recompute_mismatch" };
  return { ok: true };
}

// R3 chain continuity: observations of one task, ordered by hop.seq, contiguous from 0, each linking the prior
// hop's evidence_id via prev_evidence_id. A hidden or forged hop breaks the link.
export function chainContinuous(observations) {
  const ord = observations.slice().sort((a, b) => a.hop.seq - b.hop.seq);
  for (let i = 0; i < ord.length; i++) {
    const o = ord[i];
    if (o.hop.seq !== i) return { ok: false, reason: "seq_gap", at: i };
    if (i === 0) {
      if (o.prev_evidence_id !== null) return { ok: false, reason: "root_prev_not_null", at: i };
    } else if (o.prev_evidence_id !== evidenceId(ord[i - 1])) {
      return { ok: false, reason: "broken_link", at: i };
    }
  }
  return { ok: true };
}

// R4 fail-closed aggregate: over the SET of witness observations for one {task_id, hop.seq}, differing verdicts
// aggregate to "disagreement", never collapse to the favorable one. A trust-signal read MUST return the full set,
// so a party cannot present a subset as consensus.
export function aggregateVerdict(observationsForHop) {
  const verdicts = [...new Set(observationsForHop.map((o) => o.conduct.verdict))];
  if (verdicts.length === 0) return "no_evidence";
  if (verdicts.length > 1) return "disagreement";
  return verdicts[0];
}
