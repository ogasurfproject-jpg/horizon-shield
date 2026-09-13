"""resume_v1.py : NENRIN Resume v1 reference assembler (offline, deterministic).

The resume makes no new claim. It assembles existing jidec-path-v1 measurement
records and ring records under one perma-id and refuses, by construction, any
line that is not authenticated by its own bytes. Same canonicalization as
make_ring.py so the bytes match the worker.

Three laws enforced here:
  1. no self-asserted line  (every line comes from a record whose bytes hash to its sha)
  2. discrepancies are copied verbatim, never dropped
  3. no score is ever emitted (counts and links only)
"""
import json, hashlib
from datetime import datetime, timezone

ALLOWED_OUTCOME = {"verified", "held", "pending"}
FORBIDDEN_SCORE_KEYS = {"score", "rating", "stars", "points", "rank", "grade", "trust_score"}


def canonical(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_hex(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


class Reject(Exception):
    def __init__(self, code, why):
        self.code = code
        self.why = why
        super().__init__(code + ": " + why)


def _parse(t):
    return datetime.strptime(t, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def _within(t, now, days):
    return (_parse(now) - _parse(t)).days <= days


def _scan_forbidden(obj, path="$"):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.lower() in FORBIDDEN_SCORE_KEYS:
                raise Reject("score_injection", "forbidden score key '" + k + "' at " + path)
            _scan_forbidden(v, path + "." + str(k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _scan_forbidden(v, path + "[" + str(i) + "]")


def check_measurement(m):
    """Authenticate one measurement. Returns (rec, outcome, witness, measured_at) or raises Reject."""
    rc = m.get("record_canonical")
    claimed = m.get("record_sha256")
    if not isinstance(rc, str) or not isinstance(claimed, str):
        raise Reject("self_asserted", "measurement carries no record bytes to authenticate")
    # M1: the sha must recompute from the exact bytes (orphan / doctored record caught here)
    if sha256_hex(rc) != claimed:
        raise Reject("orphan_record", "record_sha256 does not recompute from record_canonical bytes")
    try:
        rec = json.loads(rc)
    except Exception:
        raise Reject("self_asserted", "record_canonical is not JSON")
    if rec.get("schema") != "jidec-path-v1":
        raise Reject("self_asserted", "record is not a jidec-path-v1 measurement")
    _scan_forbidden(rec)
    outcome = rec.get("outcome")
    if outcome not in ALLOWED_OUTCOME:
        raise Reject("score_injection", "outcome must be a category in " + str(sorted(ALLOWED_OUTCOME)) + ", got " + repr(outcome))
    w = rec.get("witness")
    if not isinstance(w, dict) or not w.get("name") or not w.get("vantage"):
        raise Reject("self_asserted", "measurement has no witness{name,vantage}")
    # coordinate: measured_at bounded by a prover-non-owned anchor time (postdating refused)
    anchor = m.get("anchor") or {}
    block_time = anchor.get("block_time")
    measured_at = rec.get("measured_at") or rec.get("first_instant")
    if not block_time or not measured_at:
        raise Reject("coordinate_chosen_by_prover", "no anchor block_time to bound the measurement time")
    if measured_at > block_time:
        raise Reject("coordinate_chosen_by_prover", "measured_at is after the anchoring block (postdated)")
    return rec, outcome, w, measured_at


def _copy_ring(r, discrepancies):
    rc = r.get("record_canonical")
    claimed = r.get("record_sha256")
    if not isinstance(rc, str) or sha256_hex(rc) != claimed:
        raise Reject("orphan_record", "ring record_sha256 does not recompute (M1)")
    rr = json.loads(rc)
    _scan_forbidden(rr)
    for d in (rr.get("discrepancies") or []):
        discrepancies.append({"record_sha256": claimed, "disc": d})
    return {
        "month": rr.get("month") or rr.get("from"),
        "endpoint": rr.get("endpoint"),
        "counts": rr.get("counts") or {k: rr.get(k) for k in ("instants_reached", "instants_sampled") if k in rr},
        "determinism": rr.get("determinism"),
        "derived": rr.get("derived"),
        "digest": rr.get("digest"),
        "ledger_n": r.get("source_ledger_n"),
    }


def assemble_resume(perma_id, endpoint, agent_card_url, measurements,
                    rings=None, agreements=None, period_days=30, now=None):
    rings = rings or []
    agreements = agreements or []
    out_meas = []
    discrepancies = []
    counts = {"verified": 0, "held": 0, "pending": 0}
    names = set()
    vantages = set()
    times = []
    for m in measurements:
        rec, outcome, w, measured_at = check_measurement(m)
        counts[outcome] += 1
        names.add(w["name"])
        vantages.add(w["vantage"])
        times.append(measured_at)
        for d in (rec.get("discrepancies") or []):
            discrepancies.append({"record_sha256": m["record_sha256"], "disc": d})
        anchor = m.get("anchor") or {}
        out_meas.append({
            "measured_at": measured_at,
            "record_sha256": m["record_sha256"],
            "outcome": outcome,
            "consent_source": rec.get("consent_source"),
            "witness": {"name": w["name"], "vantage": w["vantage"], "key_url": w.get("key_url")},
            "anchor": {"bitcoin_block": anchor.get("bitcoin_block"), "block_time": anchor.get("block_time"), "ots": anchor.get("ots")},
            "source_ledger_n": m.get("source_ledger_n"),
        })
    out_rings = [_copy_ring(r, discrepancies) for r in rings]
    last = max(times) if times else None
    oldest = min(times) if times else None
    current_now = bool(last and now and _within(last, now, period_days))
    resume = {
        "schema": "nenrin-resume-v1",
        "perma_id": perma_id,
        "measured_endpoint": endpoint,
        "agent_card_url": agent_card_url,
        "counts": counts,
        "witness_diversity": {"distinct_names": len(names), "distinct_vantages": len(vantages)},
        "measurements": out_meas,
        "discrepancies": discrepancies,
        "rings": out_rings,
        "agreements": [{"record_sha256": a.get("record_sha256"), "ledger_n": a.get("source_ledger_n")} for a in agreements],
        "freshness": {"last_measured": last, "oldest_measurement": oldest, "current_now": current_now, "period_days": period_days},
    }
    resume["resume_sha256"] = sha256_hex(canonical(resume))
    return resume
