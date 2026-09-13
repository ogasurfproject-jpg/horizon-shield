"""resume_redteam.py : adversary for NENRIN Resume v1. Offline, deterministic, fail-closed.

Controls must assemble. Attacks must be refused with the named reason code.
Run from the resume-v1 directory: python3 resume_redteam.py
"""
import sys
sys.path.insert(0, ".")
from resume_v1 import assemble_resume, canonical, sha256_hex, Reject

NOW = "2026-09-13T00:00:00Z"
END = "https://mcp.horizonshield.dev/mcp"
PID = "https://w3id.org/horizonshield/conduct/v1"
CARD = "https://mcp.horizonshield.dev/.well-known/agent-card.json"


def mk_record(outcome="verified", witness="default", measured_at="2026-09-10T00:00:00Z",
              discrepancies=None, extra=None):
    w = {"name": "anonymous", "vantage": "tokyo residential fiber"} if witness == "default" else witness
    rec = {"schema": "jidec-path-v1", "endpoint": END, "outcome": outcome,
           "consent_source": "well_known", "witness": w, "measured_at": measured_at,
           "assertions": [{"claim": "measured_endpoint_answered", "op": "eq", "result": True}]}
    if discrepancies is not None:
        rec["discrepancies"] = discrepancies
    if extra:
        rec.update(extra)
    return rec


def mk_meas(rec, block_time="2026-09-10T06:00:00Z", block=966000, tamper_sha=None):
    rc = canonical(rec)
    sha = tamper_sha if tamper_sha else sha256_hex(rc)
    return {"record_canonical": rc, "record_sha256": sha,
            "anchor": {"bitcoin_block": block, "block_time": block_time, "ots": "b64ots"},
            "source_ledger_n": 40}


results = []


def expect_ok(name, fn):
    try:
        fn()
        results.append((name, "pass", "assembled"))
    except Reject as e:
        results.append((name, "FAIL", "unexpected reject " + e.code))
    except Exception as e:
        results.append((name, "FAIL", "error " + repr(e)))


def expect_reject(name, code, fn):
    try:
        fn()
        results.append((name, "FAIL", "no reject, expected " + code))
    except Reject as e:
        results.append((name, "pass" if e.code == code else "FAIL",
                        ("rejected " + code) if e.code == code else ("wrong code " + e.code + " expected " + code)))
    except Exception as e:
        results.append((name, "FAIL", "error " + repr(e)))


def R(measurements, **kw):
    return lambda: assemble_resume(PID, END, CARD, measurements, now=NOW, **kw)


# controls (must assemble)
def c1():
    r = assemble_resume(PID, END, CARD, [mk_meas(mk_record())], now=NOW)
    assert r["counts"]["verified"] == 1
    assert r["freshness"]["current_now"] is True
    assert r["resume_sha256"] == sha256_hex(canonical({k: v for k, v in r.items() if k != "resume_sha256"}))
expect_ok("C1_clean_assembles", c1)

def c2():
    r = assemble_resume(PID, END, CARD, [mk_meas(mk_record(discrepancies=[{"id": "disc-0001", "note": "522 witnessB"}]))], now=NOW)
    assert len(r["discrepancies"]) == 1
expect_ok("C2_discrepancy_surfaced_not_dropped", c2)

def c3():
    m = [mk_meas(mk_record())]
    assert assemble_resume(PID, END, CARD, m, now=NOW)["resume_sha256"] == assemble_resume(PID, END, CARD, m, now=NOW)["resume_sha256"]
expect_ok("C3_deterministic_bytes", c3)

# attacks (must be refused)
expect_reject("A1_self_asserted_no_witness", "self_asserted", R([mk_meas(mk_record(witness={}))]))

def a2():
    orig_sha = sha256_hex(canonical(mk_record(discrepancies=[{"id": "disc-0001"}])))
    doctored = mk_record()  # discrepancy stripped, but claims the original sha
    m = {"record_canonical": canonical(doctored), "record_sha256": orig_sha,
         "anchor": {"bitcoin_block": 966000, "block_time": "2026-09-10T06:00:00Z"}, "source_ledger_n": 40}
    assemble_resume(PID, END, CARD, [m], now=NOW)
expect_reject("A2_hide_discrepancy", "orphan_record", a2)

expect_reject("A3_prover_chosen_coordinate", "coordinate_chosen_by_prover",
              R([mk_meas(mk_record(measured_at="2026-09-11T00:00:00Z"), block_time="2026-09-10T06:00:00Z")]))
expect_reject("A4_orphan_record_sha_mismatch", "orphan_record",
              R([mk_meas(mk_record(), tamper_sha="0" * 64)]))
expect_reject("A5_score_in_outcome", "score_injection", R([mk_meas(mk_record(outcome="4.5stars"))]))
expect_reject("A6_score_key_injected", "score_injection", R([mk_meas(mk_record(extra={"trust_score": 95}))]))

# honest limit: backdating is NOT caught by a forward anchor, and we do not pretend it is.
def l1():
    r = assemble_resume(PID, END, CARD, [mk_meas(mk_record(measured_at="2026-01-01T00:00:00Z"), block_time="2026-09-10T06:00:00Z")], now=NOW)
    assert r["freshness"]["current_now"] is False  # passes assembly but shown stale
expect_ok("L1_backdating_passes_but_flagged_stale(honest_limit)", l1)

bad = [r for r in results if r[1] != "pass"]
for n, s, why in results:
    print(("[OK]  " if s == "pass" else "[FAIL] ") + n + "  " + why)
print("\ntotal " + str(len(results)) + "  pass " + str(len(results) - len(bad)) + "  fail " + str(len(bad)))
sys.exit(1 if bad else 0)
