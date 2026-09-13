// resume_v1.mjs : JS port of resume_v1.py. Same rules, same rejection codes,
// byte-identical canonical form (sorted keys, no whitespace, raw UTF-8).
// This is the logic the ledger worker route will call. M4: two implementations, one sha.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const ALLOWED_OUTCOME = new Set(["verified", "held", "pending"]);
export const FORBIDDEN_SCORE_KEYS = new Set(["score", "rating", "stars", "points", "rank", "grade", "trust_score"]);

export function canonical(v) {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}
export function sha256Hex(s) { return createHash("sha256").update(s, "utf8").digest("hex"); }

export class Reject extends Error {
  constructor(code, why) { super(code + ": " + why); this.code = code; this.why = why; }
}

// python dict.get(k): missing -> null, present falsy values kept as they are
const g = (o, k) => (o && o[k] !== undefined ? o[k] : null);
// python truthiness (None, False, 0, "", [], {} are falsy)
const pyTruthy = (v) => !(v === null || v === undefined || v === false || v === 0 || v === "" ||
  (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0));
const pyOr = (a, b) => (pyTruthy(a) ? a : b);

function within(t, now, days) {
  // python: (parse(now) - parse(t)).days <= days ; timedelta.days floors
  return Math.floor((Date.parse(now) - Date.parse(t)) / 86400000) <= days;
}

function scanForbidden(obj, path = "$") {
  if (Array.isArray(obj)) { obj.forEach((v, i) => scanForbidden(v, path + "[" + i + "]")); return; }
  if (obj && typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      if (FORBIDDEN_SCORE_KEYS.has(String(k).toLowerCase())) throw new Reject("score_injection", "forbidden score key '" + k + "' at " + path);
      scanForbidden(obj[k], path + "." + k);
    }
  }
}

export function checkMeasurement(m) {
  const rc = m.record_canonical, claimed = m.record_sha256;
  if (typeof rc !== "string" || typeof claimed !== "string") throw new Reject("self_asserted", "measurement carries no record bytes to authenticate");
  if (sha256Hex(rc) !== claimed) throw new Reject("orphan_record", "record_sha256 does not recompute from record_canonical bytes");
  let rec;
  try { rec = JSON.parse(rc); } catch (_e) { throw new Reject("self_asserted", "record_canonical is not JSON"); }
  if (!rec || typeof rec !== "object" || rec.schema !== "jidec-path-v1") throw new Reject("self_asserted", "record is not a jidec-path-v1 measurement");
  scanForbidden(rec);
  const outcome = rec.outcome;
  if (!ALLOWED_OUTCOME.has(outcome)) throw new Reject("score_injection", "outcome must be a category, got " + JSON.stringify(outcome));
  const w = rec.witness;
  if (!w || typeof w !== "object" || Array.isArray(w) || !pyTruthy(w.name) || !pyTruthy(w.vantage)) throw new Reject("self_asserted", "measurement has no witness{name,vantage}");
  const anchor = m.anchor || {};
  const blockTime = g(anchor, "block_time");
  const measuredAt = pyOr(g(rec, "measured_at"), g(rec, "first_instant"));
  if (!pyTruthy(blockTime) || !pyTruthy(measuredAt)) throw new Reject("coordinate_chosen_by_prover", "no anchor block_time to bound the measurement time");
  if (measuredAt > blockTime) throw new Reject("coordinate_chosen_by_prover", "measured_at is after the anchoring block (postdated)");
  return [rec, outcome, w, measuredAt];
}

function copyRing(r, discrepancies) {
  const rc = r.record_canonical, claimed = r.record_sha256;
  if (typeof rc !== "string" || sha256Hex(rc) !== claimed) throw new Reject("orphan_record", "ring record_sha256 does not recompute (M1)");
  const rr = JSON.parse(rc);
  scanForbidden(rr);
  for (const d of pyOr(g(rr, "discrepancies"), [])) discrepancies.push({ record_sha256: claimed, disc: d });
  let counts = g(rr, "counts");
  if (!pyTruthy(counts)) { counts = {}; for (const k of ["instants_reached", "instants_sampled"]) if (k in rr) counts[k] = rr[k]; }
  return {
    month: pyOr(g(rr, "month"), g(rr, "from")),
    endpoint: g(rr, "endpoint"),
    counts,
    determinism: g(rr, "determinism"),
    derived: g(rr, "derived"),
    digest: g(rr, "digest"),
    ledger_n: g(r, "source_ledger_n"),
  };
}

export function assembleResume(permaId, endpoint, agentCardUrl, measurements, opts = {}) {
  const rings = opts.rings || [], agreements = opts.agreements || [];
  const periodDays = opts.period_days === undefined ? 30 : opts.period_days;
  const now = opts.now === undefined ? null : opts.now;
  const outMeas = [], discrepancies = [], counts = { verified: 0, held: 0, pending: 0 };
  const names = new Set(), vantages = new Set(), times = [];
  for (const m of measurements) {
    const [rec, outcome, w, measuredAt] = checkMeasurement(m);
    counts[outcome] += 1; names.add(w.name); vantages.add(w.vantage); times.push(measuredAt);
    for (const d of pyOr(g(rec, "discrepancies"), [])) discrepancies.push({ record_sha256: m.record_sha256, disc: d });
    const anchor = m.anchor || {};
    outMeas.push({
      measured_at: measuredAt,
      record_sha256: m.record_sha256,
      outcome,
      consent_source: g(rec, "consent_source"),
      witness: { name: w.name, vantage: w.vantage, key_url: g(w, "key_url") },
      anchor: { bitcoin_block: g(anchor, "bitcoin_block"), block_time: g(anchor, "block_time"), ots: g(anchor, "ots") },
      source_ledger_n: g(m, "source_ledger_n"),
    });
  }
  const outRings = rings.map((r) => copyRing(r, discrepancies));
  const last = times.length ? times.reduce((a, b) => (a > b ? a : b)) : null;
  const oldest = times.length ? times.reduce((a, b) => (a < b ? a : b)) : null;
  const currentNow = Boolean(last && now && within(last, now, periodDays));
  const resume = {
    schema: "nenrin-resume-v1",
    perma_id: permaId, measured_endpoint: endpoint, agent_card_url: agentCardUrl,
    counts,
    witness_diversity: { distinct_names: names.size, distinct_vantages: vantages.size },
    measurements: outMeas, discrepancies, rings: outRings,
    agreements: agreements.map((a) => ({ record_sha256: g(a, "record_sha256"), ledger_n: g(a, "source_ledger_n") })),
    freshness: { last_measured: last, oldest_measurement: oldest, current_now: currentNow, period_days: periodDays },
  };
  resume.resume_sha256 = sha256Hex(canonical(resume));
  return resume;
}

// CLI for the byte-match harness: node resume_v1.mjs --fixtures cases.json
if (process.argv[2] === "--fixtures") {
  const cases = JSON.parse(readFileSync(process.argv[3], "utf8")).cases;
  const out = [];
  for (const c of cases) {
    try {
      const a = c.args;
      const r = assembleResume(a.perma_id, a.endpoint, a.agent_card_url, a.measurements,
        { rings: a.rings, agreements: a.agreements, period_days: a.period_days, now: a.now });
      out.push({ name: c.name, ok: true, sha: r.resume_sha256 });
    } catch (e) {
      out.push({ name: c.name, ok: false, code: e instanceof Reject ? e.code : "ERROR:" + e.message });
    }
  }
  process.stdout.write(JSON.stringify({ results: out }));
}
