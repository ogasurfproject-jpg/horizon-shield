#!/usr/bin/env python3
"""Adversary for nenrin-ring-v1. Offline, deterministic. Run: python3 ring_redteam.py"""

import copy, json, hashlib, re
from make_ring import build_ring, ring_bytes, canonical, sha256_hex, dedupe

R = []
def case(kind, name, ok, detail=""):
    R.append((kind, name, bool(ok), str(detail)))

EP = "https://target.test/mcp"
def ent(day, status="verified", reachable=True, mh="aaaa", consent="well_known", det_measured=True, sha=None):
    return {
        "at": "2026-08-%02dT18:00:00.000Z" % day, "status": status, "reachable": reachable,
        "record_sha256": sha or hashlib.sha256(("r%d%s" % (day, status)).encode()).hexdigest(),
        "consent_source": consent,
        "conditions": {"determinism": {"pass": det_measured, "measured": det_measured, "transport": False, "reason": "x"}},
        "surface": {"manifest_hash": mh, "names_hash": "n", "canonicalization": "rfc8785-jcs"} if mh else None,
    }

H = [ent(1), ent(8), ent(15, status="pending", reachable=False, mh=None), ent(22, mh="bbbb"), ent(29, mh="bbbb")]
ring = build_ring(EP, "2026-08", H)

# --- control ------------------------------------------------------------------
case("control", "counts are what the history says",
     ring["instants_sampled"] == 5 and ring["instants_reached"] == 4, json.dumps(ring["instants_by_status"]))
case("control", "surface change is dated and names both hashes",
     ring["surface_changes"] == [{"at": H[3]["at"], "from": "aaaa", "to": "bbbb"}], str(ring["surface_changes"]))
case("control", "distinct manifest hashes, in order of first sight", ring["manifest_hashes_observed"] == ["aaaa", "bbbb"])
case("control", "same history in any order gives byte-identical ring",
     ring_bytes(build_ring(EP, "2026-08", list(reversed(H)))) == ring_bytes(ring), "")

# --- attack: inflate ----------------------------------------------------------
dup = H + [copy.deepcopy(H[0])]
case("attack", "the same measurement pasted twice counts once",
     build_ring(EP, "2026-08", dup)["instants_sampled"] == 5, "")
wrong_month = H + [ent(3)]; wrong_month[-1]["at"] = "2026-09-03T18:00:00.000Z"
case("attack", "an instant from another month is excluded, not pulled in to pad the count",
     build_ring(EP, "2026-08", wrong_month)["instants_sampled"] == 5, "")
no_reach = [ent(d, reachable=None) for d in range(1, 6)]
case("attack", "reachable null (instrument failure) is not counted as reached",
     build_ring(EP, "2026-08", no_reach)["instants_reached"] == 0, "")

# --- attack: hide -------------------------------------------------------------
case("attack", "an instant with no surface cannot smuggle a fake hash in",
     "None" not in json.dumps(ring["manifest_hashes_observed"]) and len(ring["manifest_hashes_observed"]) == 2, "")
r2 = build_ring(EP, "2026-08", [ent(1, det_measured=False), ent(8, det_measured=False)])
case("attack", "unmeasured determinism is named in limits, never folded into a pass",
     "not measured on 2 of 2" in r2["limits"], r2["limits"][:80])

# --- attack: score creep ------------------------------------------------------
txt = canonical(ring)
case("attack", "no rate, score, ratio, percent or rank appears anywhere in the ring",
     not re.search(r'"(rate|score|ratio|percent|pct|rank|uptime)"', txt) and "%" not in txt, "")

# --- attack: chain ------------------------------------------------------------
prev = build_ring(EP, "2026-07", [ent(20)]); prev_sha = sha256_hex(ring_bytes(prev))
chained = build_ring(EP, "2026-08", H, prev_ring=prev)
case("control", "prev_ring_sha256 equals sha256 of the previous ring FILE (the anchored hash), not of some other serialisation",
     chained["prev_ring_sha256"] == prev_sha and prev_sha != sha256_hex(canonical(prev).encode()), "")
forged = copy.deepcopy(prev); forged["instants_sampled"] = 999
case("attack", "editing last month's ring breaks this month's chain link",
     build_ring(EP, "2026-08", H, prev_ring=forged)["prev_ring_sha256"] != prev_sha, "")
import os, tempfile
from make_ring import load_prev
tmpd = tempfile.mkdtemp(); pp = os.path.join(tmpd, "prev.json")
open(pp, "wb").write(ring_bytes(prev)); load_prev(pp)
open(pp, "w").write(json.dumps(prev))
try:
    load_prev(pp); refused = False
except SystemExit:
    refused = True
case("attack", "a reformatted previous ring (same content, different bytes) is refused as --prev, so file sha and chain sha cannot silently diverge", refused)
case("control", "the first ring has no predecessor and says so", ring["prev_ring_sha256"] is None and ring["prev_ring"] is None)

# --- witnesses ----------------------------------------------------------------
case("control", "with the gate alone, witnesses is 1 and limits says no discrepancy was possible",
     ring["witnesses"] == 1 and "one witness only" in ring["limits"], "")
w = {"at": "2026-08-10T00:00:00Z", "witness": {"name": "peer.example", "vantage": "eu-west"}, "discrepancy_sha256": "d1"}
r3 = build_ring(EP, "2026-08", H, witness_records=[w, w])
case("control", "a second witness is counted once, its discrepancy is listed once",
     r3["witnesses"] == 2 and r3["discrepancies"] == ["d1"] and "one witness only" not in r3["limits"], "")
wbad = {"at": "2026-08-10T00:00:00Z", "witness": {"vantage": "nowhere"}}
case("attack", "a witness record without a name is not a witness", build_ring(EP, "2026-08", H, witness_records=[wbad])["witnesses"] == 1)
wold = dict(w); wold["at"] = "2026-07-10T00:00:00Z"
case("attack", "a witness record from another month does not count this month",
     build_ring(EP, "2026-08", H, witness_records=[wold])["witnesses"] == 1)

# --- misclass -----------------------------------------------------------------
empty = build_ring(EP, "2026-08", [])
case("misclass", "a month with nothing measured still produces a ring, and says it is a gap",
     empty["instants_sampled"] == 0 and "recorded gap" in empty["limits"], "")

# --- residual -----------------------------------------------------------------
case("residual", "a ring cannot tell a shim that answered every instant from an honest server",
     ring["instants_reached"] == 4, "conduct facts only. Quality is not measured and the spec never claimed it was.")
case("residual", "the ring trusts the history export; a tampered export makes a tampered ring",
     True, "which is why record_sha256_first and _last are carried, so the export can be checked against the gate")

# --- report -------------------------------------------------------------------
k = {}
for kind, _n, ok, _d in R:
    a, b = k.get(kind, (0, 0)); k[kind] = (a + (1 if ok else 0), b + 1)
print("--- 種別 ---")
for kind in ("attack", "control", "misclass", "residual"):
    if kind in k: print("  %-10s %d / %d" % (kind, k[kind][0], k[kind][1]))
print()
for kind, n, ok, d in R:
    if not ok: print("  NG  [%s] %s\n      %s" % (kind, n, d))
passed = sum(1 for _k, _n, ok, _d in R if ok)
print("=== %d / %d 合格 (nenrin-ring-v1) ===" % (passed, len(R)))
if passed == len(R): print("数えるだけ。率も点も順位も出さん。前の輪の hash を次の輪が持つ。")
raise SystemExit(0 if passed == len(R) else 1)
