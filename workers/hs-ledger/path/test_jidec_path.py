#!/usr/bin/env python3
"""Local proof for jidec_path.py — no network. Uses a fixture transport and a
fixed clock so we can assert determinism and verdict/drift behavior."""

import hashlib
import json
import sys

import jidec_path as jp

BASE = "https://hs-ledger.oga-surf-project.workers.dev"
PDFGEN = "https://hs-pdf-gen.oga-surf-project.workers.dev"
EXPECT = "C025E288675EE898"

# A representative /canary body (the real one is larger; the walk only reads
# these three fields, so this exercises the exact logic).
CANARY_OK = json.dumps({
    "canary_ex": {"schema_version": "0.1", "doc": {"title": "外壁塗装 カナリア固定入力"}},
    "canary_expect_hash": EXPECT,
    "live_computed_hash": EXPECT,
    "match": True,
}).encode("utf-8")

# A stand-in for the anchored entry-#4 source: must contain the constant + name.
ENTRY4_SRC_OK = (
    'var HS_AUDIT_CANARY_EXPECT = { hash: "' + EXPECT + '", counts: "..." };\n'
    'if (pathname === "/canary" && request.method === "GET") { /* ... */ }\n'
).encode("utf-8")

# A drifted deployment: live hash no longer matches.
CANARY_DRIFT = json.dumps({
    "canary_ex": {"schema_version": "0.1"},
    "canary_expect_hash": EXPECT,
    "live_computed_hash": "DEADBEEFDEADBEEF",
    "match": False,
}).encode("utf-8")


def make_transport(canary_body, entry4_body):
    def t(method, url, headers=None, body=None):
        h = {"content-type": "application/json"}
        if url.endswith("/canary"):
            return 200, h, canary_body
        if "/ledger/4" in url:
            return 200, {"content-type": "text/plain"}, entry4_body
        raise AssertionError("unexpected url in fixture: " + url)
    return t


FIXED_CLOCK_T = 1_769_000_000  # arbitrary fixed epoch seconds


def fixed_clock():
    # constant time => deterministic walked_at and duration_ms==0
    return FIXED_CLOCK_T


def run(canary, entry4, walked_at="2026-07-25T10:00:00Z"):
    return jp.walk_entry4(
        BASE, PDFGEN,
        transport=make_transport(canary, entry4),
        clock=fixed_clock,
        walked_at=walked_at,
    )


def main():
    fails = []

    # 1. happy path => PASS, 4/4
    a = run(CANARY_OK, ENTRY4_SRC_OK)
    print("test 1 verdict:", a["verdict"])
    if a["verdict"]["outcome"] != "PASS" or a["verdict"]["n_total"] != 4:
        fails.append("happy path did not PASS 4/4")

    # 2. path_id == sha256(record_canonical)
    recomputed = hashlib.sha256(a["record_canonical"].encode("utf-8")).hexdigest()
    print("test 2 path_id:", a["path_id"])
    print("test 2 recomputed:", recomputed)
    if a["path_id"] != recomputed:
        fails.append("path_id != sha256(record_canonical)")

    # 3. determinism: same inputs + same clock => identical path_id
    b = run(CANARY_OK, ENTRY4_SRC_OK)
    print("test 3 determinism identical:", a["path_id"] == b["path_id"])
    if a["path_id"] != b["path_id"]:
        fails.append("non-deterministic path_id for identical inputs")

    # 4. drift detection: mutated live deployment => different path_id AND FAIL
    c = run(CANARY_DRIFT, ENTRY4_SRC_OK)
    print("test 4 drift verdict:", c["verdict"])
    print("test 4 different id:", c["path_id"] != a["path_id"])
    if c["verdict"]["outcome"] != "FAIL":
        fails.append("drift did not produce FAIL")
    if c["path_id"] == a["path_id"]:
        fails.append("drifted walk produced same path_id (should differ)")

    # 5. anchored-source drift: source missing the constant => that assertion fails
    src_missing = b"var SOMETHING_ELSE = 1;\n"
    d = run(CANARY_OK, src_missing)
    src_assertion = [x for x in d["presented"]["assertions"]
                     if "anchored entry #4 source carries" in x["claim"]][0]
    print("test 5 source-carries assertion result:", src_assertion["result"])
    if src_assertion["result"] is not False or d["verdict"]["outcome"] != "FAIL":
        fails.append("missing-constant source did not fail its assertion")

    # 6. canonical bytes are stable under re-serialization (idempotent)
    reparsed = json.loads(a["record_canonical"])
    reserialized = jp.canon(reparsed)
    print("test 6 canonical idempotent:", reserialized == a["record_canonical"])
    if reserialized != a["record_canonical"]:
        fails.append("canonical serialization not idempotent")

    print()
    if fails:
        print("FAIL:")
        for f in fails:
            print("  -", f)
        return 1
    print("ALL PASS (6/6)")
    print("sample cite_as:", a["presented"]["cite_as"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
