"""resume_bytematch.py : M4 harness. python (resume_v1.py) vs node (resume_v1.mjs).

Same fixtures into both. For assembled cases the resume_sha256 must be byte-identical;
for refused cases the rejection code must be identical. Any mismatch fails (exit 1).
Run from the resume-v1 directory: python3 resume_bytematch.py
"""
import sys, os, json, shutil, subprocess, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) or ".")
from resume_v1 import assemble_resume, canonical, sha256_hex, Reject

HERE = os.path.dirname(os.path.abspath(__file__)) or "."
NOW = "2026-09-13T00:00:00Z"
END = "https://mcp.horizonshield.dev/mcp"
PID = "https://w3id.org/horizonshield/conduct/v1"
CARD = "https://mcp.horizonshield.dev/.well-known/agent-card.json"


def rec(outcome="verified", witness="default", measured_at="2026-09-10T00:00:00Z", discrepancies=None, extra=None, time_key="measured_at"):
    w = {"name": "anonymous", "vantage": "tokyo residential fiber"} if witness == "default" else witness
    r = {"schema": "jidec-path-v1", "endpoint": END, "outcome": outcome, "consent_source": "well_known",
         "witness": w, time_key: measured_at,
         "assertions": [{"claim": "measured_endpoint_answered", "op": "eq", "result": True}]}
    if discrepancies is not None:
        r["discrepancies"] = discrepancies
    if extra:
        r.update(extra)
    return r


def meas(r, block_time="2026-09-10T06:00:00Z", block=966000, tamper_sha=None, n=40):
    rc = canonical(r)
    return {"record_canonical": rc, "record_sha256": tamper_sha or sha256_hex(rc),
            "anchor": {"bitcoin_block": block, "block_time": block_time, "ots": "b64ots"}, "source_ledger_n": n}


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


orig_disc_sha = sha256_hex(canonical(rec(discrepancies=[{"id": "disc-0001"}])))
cases = [
    ("C1_clean", args([meas(rec())])),
    ("C2_discrepancy_in_measurement", args([meas(rec(discrepancies=[{"id": "disc-0001", "note": "522 witnessB"}]))])),
    ("C3_two_witnesses_one_held", args([meas(rec(), n=40),
                                        meas(rec(outcome="held", witness={"name": "babyblueviper1", "vantage": "madrid vps"}, measured_at="2026-09-12T00:00:00Z"), block_time="2026-09-12T06:00:00Z", block=966300, n=41)])),
    ("C4_ring_and_agreement", args([meas(rec())], rings=[ring(discrepancies=[{"id": "disc-0001"}])],
                                   agreements=[{"record_sha256": "ab" * 32, "source_ledger_n": 41}])),
    ("C5_empty_measurements", args([])),
    ("C6_ring_with_explicit_counts", args([meas(rec())], rings=[ring(counts={"reached": 8, "sampled": 8})])),
    ("C7_key_url_and_consent", args([meas(rec(witness={"name": "w", "vantage": "v", "key_url": "https://example.invalid/k.json"}))])),
    ("E1_first_instant_instead_of_measured_at", args([meas(rec(time_key="first_instant"))])),
    ("E2_utf8_raw_bytes_parity", args([meas(rec(witness={"name": "匿名の証人", "vantage": "東京 住宅 光回線"}))])),
    ("E3_escape_parity", args([meas(rec(discrepancies=[{"note": "line1\nline2 \"q\" \\ back\ttab"}]))])),
    ("E4_period_floor_boundary", args([meas(rec(measured_at="2026-08-14T00:00:00Z"), block_time="2026-08-14T06:00:00Z")], now="2026-09-13T12:00:00Z")),
    ("A1_no_witness", args([meas(rec(witness={}))])),
    ("A2_hide_discrepancy", args([{"record_canonical": canonical(rec()), "record_sha256": orig_disc_sha,
                                   "anchor": {"bitcoin_block": 966000, "block_time": "2026-09-10T06:00:00Z"}, "source_ledger_n": 40}])),
    ("A3_postdated", args([meas(rec(measured_at="2026-09-11T00:00:00Z"), block_time="2026-09-10T06:00:00Z")])),
    ("A4_sha_mismatch", args([meas(rec(), tamper_sha="0" * 64)])),
    ("A5_score_outcome", args([meas(rec(outcome="4.5stars"))])),
    ("A6_score_key", args([meas(rec(extra={"trust_score": 95}))])),
    ("L1_backdating_stale", args([meas(rec(measured_at="2026-01-01T00:00:00Z"))])),
]


def run_py(a):
    try:
        r = assemble_resume(a["perma_id"], a["endpoint"], a["agent_card_url"], a["measurements"],
                            rings=a["rings"], agreements=a["agreements"], period_days=a["period_days"], now=a["now"])
        return {"ok": True, "sha": r["resume_sha256"]}
    except Reject as e:
        return {"ok": False, "code": e.code}


node = shutil.which("node")
if not node:
    print("node not found; cannot byte-match"); sys.exit(2)
with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tf:
    json.dump({"cases": [{"name": n, "args": a} for n, a in cases]}, tf, ensure_ascii=False)
    fx = tf.name
try:
    out = subprocess.run([node, os.path.join(HERE, "resume_v1.mjs"), "--fixtures", fx], capture_output=True, text=True, timeout=60)
finally:
    try: os.unlink(fx)
    except Exception: pass
if out.returncode != 0:
    print("node failed:", out.stderr[:800]); sys.exit(2)
js = {r["name"]: r for r in json.loads(out.stdout)["results"]}

bad = 0
for name, a in cases:
    py = run_py(a)
    j = js.get(name)
    if j is None:
        print("[FAIL] " + name + "  node produced no result"); bad += 1; continue
    if py["ok"] and j["ok"] and py["sha"] == j["sha"]:
        print("[OK]   " + name + "  sha match " + py["sha"][:12])
    elif (not py["ok"]) and (not j["ok"]) and py["code"] == j["code"]:
        print("[OK]   " + name + "  both refuse " + py["code"])
    else:
        print("[FAIL] " + name + "  py=" + json.dumps(py) + "  js=" + json.dumps(j)); bad += 1
print("\ncases " + str(len(cases)) + "  match " + str(len(cases) - bad) + "  mismatch " + str(bad))
sys.exit(1 if bad else 0)
