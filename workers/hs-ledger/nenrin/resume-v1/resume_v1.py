"""resume_v1.py : NENRIN Resume v1 reference assembler (offline, deterministic).

The resume makes no new claim. It assembles existing jidec-path-v1 witness-walk
records (a2a_conduct_walk.py shape: verdict{ok,outcome,n_pass,n_total}, walked_at,
base, witness{name,vantage}, nodes[]) under one identity and refuses, by
construction, any line that is not authenticated by its own bytes. Same
canonicalization as make_ring.py so the bytes match the worker.

Three laws enforced here:
  1. no self-asserted line  (every line comes from a record whose bytes hash to its sha)
  2. discrepancies are copied verbatim, never dropped
  3. no score is ever emitted (counts and links only; PASS/FAIL and n_pass/n_total are counts)
"""
import json, hashlib, re
from datetime import datetime, timezone

ALLOWED_OUTCOME = {"PASS", "FAIL"}  # witness-walk vocabulary (verdict.outcome)
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


_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$")
_LEDGER = re.compile(r"^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))? UTC$")


def to_epoch(t):
    """UTC seconds for 'YYYY-MM-DDTHH:MM:SSZ' (walk records) or 'YYYY-MM-DD HH:MM[:SS] UTC'
    (the ledger's block_time, written by the stamping runner). None if neither."""
    if not isinstance(t, str):
        return None
    m = _ISO.match(t) or _LEDGER.match(t)
    if not m:
        return None
    y, mo, d, h, mi, sec = m.groups()
    try:
        return int(datetime(int(y), int(mo), int(d), int(h), int(mi), int(sec or 0), tzinfo=timezone.utc).timestamp())
    except ValueError:
        return None


def _within(t, now, days):
    # floor of whole days, same as JS Math.floor((now - t) / 86400000)
    return (to_epoch(now) - to_epoch(t)) // 86400 <= days


def _scan_forbidden(obj, path="$"):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.lower() in FORBIDDEN_SCORE_KEYS:
                raise Reject("score_injection", "forbidden score key '" + k + "' at " + path)
            _scan_forbidden(v, path + "." + str(k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _scan_forbidden(v, path + "[" + str(i) + "]")


def _verdict(rec):
    """verdict{ok,outcome,n_pass,n_total} (walk shape). Legacy: top-level outcome, no ok."""
    v = rec.get("verdict")
    if isinstance(v, dict):
        return v.get("outcome"), v.get("ok"), v.get("n_pass"), v.get("n_total")
    return rec.get("outcome"), None, None, None


def check_measurement(m):
    """Authenticate one measurement. Returns (rec, outcome, witness, measured_at, n_pass, n_total) or raises Reject."""
    rc = m.get("record_canonical")
    claimed = m.get("record_sha256")
    if not isinstance(rc, str) or not isinstance(claimed, str):
        raise Reject("self_asserted", "measurement carries no record bytes to authenticate")
    if sha256_hex(rc) != claimed:
        raise Reject("orphan_record", "record_sha256 does not recompute from record_canonical bytes")
    try:
        rec = json.loads(rc)
    except Exception:
        raise Reject("self_asserted", "record_canonical is not JSON")
    if not isinstance(rec, dict) or rec.get("schema") != "jidec-path-v1":
        raise Reject("self_asserted", "record is not a jidec-path-v1 measurement")
    _scan_forbidden(rec)
    outcome, ok, n_pass, n_total = _verdict(rec)
    if outcome not in ALLOWED_OUTCOME:
        raise Reject("score_injection", "verdict.outcome must be a category in " + str(sorted(ALLOWED_OUTCOME)) + ", got " + repr(outcome))
    if ok is not None and bool(ok) != (outcome == "PASS"):
        raise Reject("verdict_inconsistent", "verdict.ok disagrees with verdict.outcome")
    w = rec.get("witness")
    if not isinstance(w, dict) or not w.get("name") or not w.get("vantage"):
        raise Reject("self_asserted", "measurement has no witness{name,vantage}")
    anchor = m.get("anchor") or {}
    block_time = anchor.get("block_time")
    measured_at = rec.get("walked_at") or rec.get("measured_at") or rec.get("first_instant")
    if not block_time or not measured_at:
        raise Reject("coordinate_chosen_by_prover", "no anchor block_time to bound the measurement time")
    t_m, t_b = to_epoch(measured_at), to_epoch(block_time)
    if t_m is None or t_b is None:
        raise Reject("coordinate_chosen_by_prover", "measurement or anchor time is not a recognised UTC timestamp")
    if t_m > t_b:
        raise Reject("coordinate_chosen_by_prover", "walked_at is after the anchoring block (postdated)")
    return rec, outcome, w, measured_at, n_pass, n_total


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
    counts = {"PASS": 0, "FAIL": 0}
    names = set()
    vantages = set()
    times = []
    for m in measurements:
        rec, outcome, w, measured_at, n_pass, n_total = check_measurement(m)
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
            "n_pass": n_pass,
            "n_total": n_total,
            "base": rec.get("base"),
            "purpose": rec.get("purpose"),
            "witness": {"name": w["name"], "vantage": w["vantage"], "key_url": w.get("key_url")},
            "record_url": m.get("record_url"),
            "anchor": {"bitcoin_block": anchor.get("bitcoin_block"), "block_time": anchor.get("block_time"), "ots": anchor.get("ots"), "batch_sha256": anchor.get("batch_sha256")},
            "source_ledger_n": m.get("source_ledger_n"),
        })
    out_rings = [_copy_ring(r, discrepancies) for r in rings]
    last = max(times) if times else None
    oldest = min(times) if times else None
    current_now = bool(last and now and to_epoch(last) is not None and to_epoch(now) is not None and _within(last, now, period_days))
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
