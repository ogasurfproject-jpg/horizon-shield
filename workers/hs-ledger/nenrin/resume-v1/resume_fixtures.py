"""resume_fixtures.py : shared fixture builders in the REAL jidec-path-v1 witness-walk shape
(a2a_conduct_walk.py): verdict{ok,outcome,n_pass,n_total}, walked_at, base, witness, nodes[]."""
from resume_v1 import canonical, sha256_hex

NOW = "2026-09-13T00:00:00Z"
BASE = "https://mcp.horizonshield.dev"
END = BASE + "/mcp"
PID = END  # v1 identity = measured endpoint (a per-agent w3id perma-id can replace it later)
CARD = BASE + "/.well-known/agent-card.json"


def rec(outcome="PASS", ok="auto", witness="default", walked_at="2026-09-10T00:00:00Z",
        discrepancies=None, extra=None, time_key="walked_at", legacy_outcome=False, n_pass=5, n_total=5):
    w = {"name": "anonymous", "vantage": "tokyo residential fiber"} if witness == "default" else witness
    r = {"schema": "jidec-path-v1", "base": BASE, "purpose": "a2a-conduct-walk", "witness": w, time_key: walked_at,
         "nodes": [{"n": 0, "kind": "card", "request": {"method": "GET", "url": CARD}, "response": {"status": 200, "body_sha256": "ab" * 32}}],
         "assertions": [{"claim": "measured_endpoint_answered", "op": "eq", "result": outcome == "PASS"}]}
    if legacy_outcome:
        r["outcome"] = outcome  # older records: top-level outcome, no verdict object
    else:
        r["verdict"] = {"ok": (outcome == "PASS") if ok == "auto" else ok, "outcome": outcome, "n_pass": n_pass, "n_total": n_total}
    if discrepancies is not None:
        r["discrepancies"] = discrepancies
    if extra:
        r.update(extra)
    return r


def meas(r, block_time="2026-09-10T06:00:00Z", block=966000, tamper_sha=None, n=40):
    rc = canonical(r)
    return {"record_canonical": rc, "record_sha256": tamper_sha or sha256_hex(rc),
            "anchor": {"bitcoin_block": block, "block_time": block_time, "ots": "https://ledger.horizonshield.dev/ledger/" + str(n) + "/ots"},
            "source_ledger_n": n}


def ring(month="2026-08", discrepancies=None, counts=None):
    rr = {"schema": "nenrin-ring-v1", "endpoint": END, "month": month, "instants_reached": 8, "instants_sampled": 8,
          "determinism": "stable", "derived": True, "digest": "d1"}
    if discrepancies is not None:
        rr["discrepancies"] = discrepancies
    if counts is not None:
        rr["counts"] = counts
    rc = canonical(rr)
    return {"record_canonical": rc, "record_sha256": sha256_hex(rc), "source_ledger_n": 32}


def args(measurements, rings=None, agreements=None, period_days=30, now=NOW):
    return {"perma_id": PID, "endpoint": END, "agent_card_url": CARD, "measurements": measurements,
            "rings": rings or [], "agreements": agreements or [], "period_days": period_days, "now": now}
