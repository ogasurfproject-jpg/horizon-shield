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

# ledger-shaped records (what GET /witness/{sha} and a nenrin-witness-batch entry actually hold)
def walk(base, ok=True, name="peer.example", at="2026-08-12T00:00:00Z"):
    return {"schema": "jidec-path-v1", "purpose": "monthly walk", "walked_at": at, "base": base,
            "nodes": [{"kind": "fetch", "n": 0, "request": {"method": "POST", "url": base + "/mcp"}, "response": {"status": 200}}],
            "assertions": [{"claim": "tools/list answers", "result": ok}], "verdict": {"ok": ok},
            "witness": {"name": name, "vantage": "eu-west"}}
def stored(wk, sha="s1"):
    return {"sha": sha, "witness_name": wk["witness"]["name"], "vantage": "eu-west", "signed": False,
            "submitted_at": "2026-08-12T00:05:00Z", "record_canonical": json.dumps(wk)}
r4 = build_ring(EP, "2026-08", H, witness_records=[stored(walk("https://target.test"))])
case("control", "a ledger-shaped witness record (jidec-path-v1 walk) is counted, by walked_at and witness.name",
     r4["witnesses"] == 2 and r4["discrepancies"] == [], json.dumps(r4["witness_identities"]))
r5 = build_ring(EP, "2026-08", H, witness_records=[stored(walk("https://somebody-else.test"))])
case("attack", "a walk of somebody else's service does not count as a witness of this endpoint",
     r5["witnesses"] == 1, "")
r6 = build_ring(EP, "2026-08", H, witness_records=[stored(walk("https://target.test", ok=False), sha="d9")])
case("control", "a walk whose verdict is not ok is a discrepancy, listed by the record's sha",
     r6["witnesses"] == 2 and r6["discrepancies"] == ["d9"], json.dumps(r6["discrepancies"]))
r7 = build_ring(EP, "2026-08", H, witness_records=[stored(walk("https://target.test", at="2026-07-30T00:00:00Z"))])
case("attack", "walked_at decides the month, not submitted_at; a July walk submitted in August stays in July",
     r7["witnesses"] == 1, "")

# --- conduct-v1.1 columns (2026-09-07): September on; August bytes untouched -----
def ent9(day, derived=None, **kw):
    e = ent(day, **kw); e["at"] = "2026-09-%02dT18:00:00.000Z" % day
    if derived is not None:
        e["coordinate_derivation"] = {"derived": derived, "reason_code": None if derived else "tips_unavailable"}
    return e
H9 = [ent9(1, derived=False), ent9(2, derived=True), ent9(3, derived=True), ent9(4)]
def walk9(base, ok=True, name="peer.example", at="2026-09-12T00:00:00Z", mode=None):
    w = walk(base, ok=ok, name=name, at=at)
    if mode:
        w["mode"] = mode; w["establishes"] = ["x"]; w["does_not_establish"] = ["y"]
        if mode == "commitment":
            w.pop("nodes"); w.pop("assertions"); w.pop("verdict"); w["commitment"] = "c" * 64
    return w
def stored9(wk, sha, signed_domain=None, counted=True, mode=None):
    s = stored(wk, sha=sha); s["submitted_at"] = wk["walked_at"]
    if signed_domain: s["signed_domain"] = signed_domain; s["signed"] = True
    if mode: s["mode"] = mode
    if not counted: s["counted"] = False
    return s
aug = build_ring(EP, "2026-08", H, witness_records=[stored(walk("https://target.test"))])
case("control", "an August ring carries no v1.1 key: anchored rings still verify byte for byte",
     all(k not in aug for k in ("witnesses_signed", "witnesses_unsigned", "instants_derived", "walked_as_witness")), json.dumps(sorted(aug.keys()))[:80])
sep = build_ring(EP, "2026-09", H9, witness_records=[
    stored9(walk9("https://target.test", name="Signed Peer"), "s1", signed_domain="peer.example"),
    stored9(walk9("https://target.test", name="Unsigned Peer"), "u1"),
])
case("control", "a September ring has the two witness columns and the coordinate counts",
     sep["witnesses"] == 3 and sep["witnesses_signed"] == 1 and sep["witnesses_unsigned"] == 1
     and sep["instants_derived"] == 2 and sep["instants_legacy"] == 1 and sep["instants_no_coordinate_block"] == 1,
     json.dumps({k: sep[k] for k in ("witnesses", "witnesses_signed", "witnesses_unsigned", "instants_derived", "instants_legacy", "instants_no_coordinate_block")}))
case("control", "the September ring says the columns count third parties and that unsigned witnesses are counted by name",
     "third parties only" in sep["limits"] and "counted by the name they gave" in sep["limits"], sep["limits"][-120:])
flood = [stored9(walk9("https://target.test", ok=False, name="Sock " + str(i), at="2026-09-12T00:00:%02dZ" % i), "f%d" % i) for i in range(20)]
fl = build_ring(EP, "2026-09", H9, witness_records=flood)
case("attack", "twenty unsigned sock names on one day: v1 discrepancies keep every sha, the unsigned column stays unsigned, the signed column stays empty",
     len(fl["discrepancies"]) == 20 and fl["witnesses_unsigned"] == 20 and fl["witnesses_signed"] == 0 and fl["discrepancies_signed"] == [] and len(fl["discrepancies_unsigned"]) == 20,
     json.dumps({"disc": len(fl["discrepancies"]), "unsigned": fl["witnesses_unsigned"], "signed": fl["witnesses_signed"]}))
same = [stored9(walk9("https://target.test", ok=False, name="One Name", at="2026-09-12T00:00:%02dZ" % i), "o%d" % i, counted=(i == 0)) for i in range(20)]
sm = build_ring(EP, "2026-09", H9, witness_records=same)
case("attack", "twenty FAIL records from one name on one day: one witness, one counted discrepancy in the column, all twenty shas kept under v1 discrepancies",
     sm["witnesses_unsigned"] == 1 and len(sm["discrepancies_unsigned"]) == 1 and len(sm["discrepancies"]) == 20,
     json.dumps({"unsigned": sm["witnesses_unsigned"], "disc_unsigned": len(sm["discrepancies_unsigned"]), "disc_v1": len(sm["discrepancies"])}))
cmt = build_ring(EP, "2026-09", H9, witness_records=[stored9(walk9("https://target.test", mode="commitment"), "k1", mode="commitment")])
case("control", "a commitment record is counted as unrevealed and in neither witness column",
     cmt["commitments_unrevealed"] == 1 and cmt["witnesses_signed"] == 0 and cmt["witnesses_unsigned"] == 0 and cmt["witnesses"] == 2,
     json.dumps({"c": cmt["commitments_unrevealed"], "w": cmt["witnesses"]}))
waw = build_ring(EP, "2026-09", H9, witness_records=[
    stored9(walk9("https://somebody-else.test", name="target operator"), "w1", signed_domain="target.test"),
    stored9(walk9("https://another.test", name="target operator"), "w2", signed_domain="target.test"),
    stored9(walk9("https://third.test", name="target operator"), "w3", signed_domain="target.test", counted=False),
])
case("control", "walked_as_witness counts the counted walks this endpoint's domain filed about others, and none of them as witnesses of itself",
     waw["walked_as_witness"] == 2 and waw["witnesses"] == 1, json.dumps({"waw": waw["walked_as_witness"], "w": waw["witnesses"]}))
case("control", "same September inputs in any order give byte-identical bytes",
     ring_bytes(build_ring(EP, "2026-09", list(reversed(H9)), witness_records=list(reversed(flood)))) == ring_bytes(fl), "")

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
