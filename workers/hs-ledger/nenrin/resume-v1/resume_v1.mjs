// resume_v1.mjs : JS port of resume_v1.py. Same rules, same rejection codes,
// byte-identical canonical form (sorted keys, no whitespace, raw UTF-8).
//
// No node imports on purpose: the ledger worker bundles this file and passes its
// own Web Crypto hasher. sha256Hex is injected (may be sync or async), so the
// whole assembly is async. node users pass createHash (see resume_cli.mjs).
// M4: two implementations, one sha.

export const ALLOWED_OUTCOME = new Set(["PASS", "FAIL"]);
export const FORBIDDEN_SCORE_KEYS = new Set(["score", "rating", "stars", "points", "rank", "grade", "trust_score"]);

export function canonical(v) {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

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

function verdictOf(rec) {
  const v = rec.verdict;
  if (v && typeof v === "object" && !Array.isArray(v)) return [g(v, "outcome"), g(v, "ok"), g(v, "n_pass"), g(v, "n_total")];
  return [g(rec, "outcome"), null, null, null];
}

export async function checkMeasurement(m, sha256Hex) {
  const rc = m.record_canonical, claimed = m.record_sha256;
  if (typeof rc !== "string" || typeof claimed !== "string") throw new Reject("self_asserted", "measurement carries no record bytes to authenticate");
  if ((await sha256Hex(rc)) !== claimed) throw new Reject("orphan_record", "record_sha256 does not recompute from record_canonical bytes");
  let rec;
  try { rec = JSON.parse(rc); } catch (_e) { throw new Reject("self_asserted", "record_canonical is not JSON"); }
  if (!rec || typeof rec !== "object" || Array.isArray(rec) || rec.schema !== "jidec-path-v1") throw new Reject("self_asserted", "record is not a jidec-path-v1 measurement");
  scanForbidden(rec);
  const [outcome, ok, nPass, nTotal] = verdictOf(rec);
  if (!ALLOWED_OUTCOME.has(outcome)) throw new Reject("score_injection", "verdict.outcome must be a category, got " + JSON.stringify(outcome));
  if (ok !== null && Boolean(ok) !== (outcome === "PASS")) throw new Reject("verdict_inconsistent", "verdict.ok disagrees with verdict.outcome");
  const w = rec.witness;
  if (!w || typeof w !== "object" || Array.isArray(w) || !pyTruthy(w.name) || !pyTruthy(w.vantage)) throw new Reject("self_asserted", "measurement has no witness{name,vantage}");
  const anchor = m.anchor || {};
  const blockTime = g(anchor, "block_time");
  const measuredAt = pyOr(pyOr(g(rec, "walked_at"), g(rec, "measured_at")), g(rec, "first_instant"));
  if (!pyTruthy(blockTime) || !pyTruthy(measuredAt)) throw new Reject("coordinate_chosen_by_prover", "no anchor block_time to bound the measurement time");
  if (measuredAt > blockTime) throw new Reject("coordinate_chosen_by_prover", "walked_at is after the anchoring block (postdated)");
  return [rec, outcome, w, measuredAt, nPass, nTotal];
}

async function copyRing(r, discrepancies, sha256Hex) {
  const rc = r.record_canonical, claimed = r.record_sha256;
  if (typeof rc !== "string" || (await sha256Hex(rc)) !== claimed) throw new Reject("orphan_record", "ring record_sha256 does not recompute (M1)");
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

export async function assembleResume(permaId, endpoint, agentCardUrl, measurements, opts = {}) {
  const sha256Hex = opts.sha256Hex;
  if (typeof sha256Hex !== "function") throw new Error("assembleResume: opts.sha256Hex (string -> hex, sync or async) is required");
  const rings = opts.rings || [], agreements = opts.agreements || [];
  const periodDays = opts.period_days === undefined ? 30 : opts.period_days;
  const now = opts.now === undefined ? null : opts.now;
  const outMeas = [], discrepancies = [], counts = { PASS: 0, FAIL: 0 };
  const names = new Set(), vantages = new Set(), times = [];
  for (const m of measurements) {
    const [rec, outcome, w, measuredAt, nPass, nTotal] = await checkMeasurement(m, sha256Hex);
    counts[outcome] += 1; names.add(w.name); vantages.add(w.vantage); times.push(measuredAt);
    for (const d of pyOr(g(rec, "discrepancies"), [])) discrepancies.push({ record_sha256: m.record_sha256, disc: d });
    const anchor = m.anchor || {};
    outMeas.push({
      measured_at: measuredAt,
      record_sha256: m.record_sha256,
      outcome,
      n_pass: nPass,
      n_total: nTotal,
      base: g(rec, "base"),
      purpose: g(rec, "purpose"),
      witness: { name: w.name, vantage: w.vantage, key_url: g(w, "key_url") },
      record_url: g(m, "record_url"),
      anchor: { bitcoin_block: g(anchor, "bitcoin_block"), block_time: g(anchor, "block_time"), ots: g(anchor, "ots"), batch_sha256: g(anchor, "batch_sha256") },
      source_ledger_n: g(m, "source_ledger_n"),
    });
  }
  const outRings = [];
  for (const r of rings) outRings.push(await copyRing(r, discrepancies, sha256Hex));
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
  resume.resume_sha256 = await sha256Hex(canonical(resume));
  return resume;
}
