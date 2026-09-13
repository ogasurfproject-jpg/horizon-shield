"""resume_redteam.py : adversary for NENRIN Resume v1. Offline, deterministic, fail-closed.
Controls must assemble. Attacks must be refused with the named reason code.
Run from the resume-v1 directory: python3 resume_redteam.py
"""
import sys
sys.path.insert(0, ".")
from resume_v1 import assemble_resume, canonical, sha256_hex, Reject
from resume_fixtures import rec, meas, ring, args, NOW, END, PID, CARD

results = []


def A(a):
    return lambda: assemble_resume(a["perma_id"], a["endpoint"], a["agent_card_url"], a["measurements"],
                                   rings=a["rings"], agreements=a["agreements"], period_days=a["period_days"], now=a["now"])


def expect_ok(name, fn):
    try:
        fn(); results.append((name, "pass", "assembled"))
    except Reject as e:
        results.append((name, "FAIL", "unexpected reject " + e.code))
    except Exception as e:
        results.append((name, "FAIL", "error " + repr(e)))


def expect_reject(name, code, fn):
    try:
        fn(); results.append((name, "FAIL", "no reject, expected " + code))
    except Reject as e:
        results.append((name, "pass" if e.code == code else "FAIL", ("rejected " + code) if e.code == code else ("wrong code " + e.code + " expected " + code)))
    except Exception as e:
        results.append((name, "FAIL", "error " + repr(e)))


def c1():
    r = A(args([meas(rec())]))()
    assert r["counts"] == {"PASS": 1, "FAIL": 0}, r["counts"]
    assert r["measurements"][0]["n_pass"] == 5 and r["measurements"][0]["base"] == "https://mcp.horizonshield.dev"
    assert r["freshness"]["current_now"] is True
    assert r["resume_sha256"] == sha256_hex(canonical({k: v for k, v in r.items() if k != "resume_sha256"}))
expect_ok("C1_clean_real_shape_assembles", c1)

def c2():
    r = A(args([meas(rec(discrepancies=[{"id": "disc-0001", "note": "522 witnessB"}]))]))()
    assert len(r["discrepancies"]) == 1
expect_ok("C2_discrepancy_surfaced_not_dropped", c2)

def c3():
    m = [meas(rec())]
    assert A(args(m))()["resume_sha256"] == A(args(m))()["resume_sha256"]
expect_ok("C3_deterministic_bytes", c3)

def c4():
    r = A(args([meas(rec(outcome="FAIL"))]))()
    assert r["counts"] == {"PASS": 0, "FAIL": 1}
expect_ok("C4_FAIL_is_a_count_not_hidden", c4)

expect_reject("A1_self_asserted_no_witness", "self_asserted", A(args([meas(rec(witness={}))])))

def a2():
    orig_sha = sha256_hex(canonical(rec(discrepancies=[{"id": "disc-0001"}])))
    m = {"record_canonical": canonical(rec()), "record_sha256": orig_sha,
         "anchor": {"bitcoin_block": 966000, "block_time": "2026-09-10T06:00:00Z"}, "source_ledger_n": 40}
    A(args([m]))()
expect_reject("A2_hide_discrepancy", "orphan_record", a2)

expect_reject("A3_prover_chosen_coordinate_postdated", "coordinate_chosen_by_prover",
              A(args([meas(rec(walked_at="2026-09-11T00:00:00Z"), block_time="2026-09-10T06:00:00Z")])))
expect_reject("A4_orphan_record_sha_mismatch", "orphan_record", A(args([meas(rec(), tamper_sha="0" * 64)])))
expect_reject("A5_score_in_verdict_outcome", "score_injection", A(args([meas(rec(outcome="4.5stars", ok=True))])))
expect_reject("A6_score_key_injected", "score_injection", A(args([meas(rec(extra={"trust_score": 95}))])))
expect_reject("A7_verdict_ok_disagrees_with_outcome", "verdict_inconsistent", A(args([meas(rec(outcome="PASS", ok=False))])))
expect_reject("A8_no_anchor_block_time", "coordinate_chosen_by_prover", A(args([meas(rec(), block_time=None)])))

def l1():
    r = A(args([meas(rec(walked_at="2026-01-01T00:00:00Z"), block_time="2026-09-10T06:00:00Z")]))()
    assert r["freshness"]["current_now"] is False
expect_ok("L1_backdating_passes_but_flagged_stale(honest_limit)", l1)

def e1():
    r = A(args([meas(rec(legacy_outcome=True, time_key="measured_at"))]))()
    assert r["measurements"][0]["n_pass"] is None
expect_ok("E1_legacy_top_level_outcome_fallback", e1)

bad = [r for r in results if r[1] != "pass"]
for n, s, why in results:
    print(("[OK]  " if s == "pass" else "[FAIL] ") + n + "  " + why)
print("\ntotal " + str(len(results)) + "  pass " + str(len(results) - len(bad)) + "  fail " + str(len(bad)))
sys.exit(1 if bad else 0)
