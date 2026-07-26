#!/usr/bin/env python3
"""Local proof for jidec_cite.py — no network. Builds a fixture ledger with a
real path record and verifies resolution, integrity, and parsing."""
import hashlib, json, sys
import jidec_path as jp, test_jidec_path as t
import jidec_cite as jc

BASE = "https://hs-ledger.oga-surf-project.workers.dev"

# Build a real path record (the canonical bytes the ledger would store).
walk = t.run(t.CANARY_OK, t.ENTRY4_SRC_OK, walked_at="2026-07-25T10:00:00Z")
RECORD = walk["record_canonical"].encode("utf-8")
PATH_SHA = hashlib.sha256(RECORD).hexdigest()   # == ledger claim_sha256 == path_id

# A confirmed entry #6 fixture.
INDEX = json.dumps({"ledger": "JIDEC", "count": 6, "entries": [
    {"n": 6, "work": "path", "claim_sha256": PATH_SHA, "ots_status": "confirmed",
     "bitcoin_block": 959600, "url": BASE + "/ledger/6"},
    {"n": 5, "work": "spec", "claim_sha256": "5"*64, "ots_status": "pending",
     "bitcoin_block": None, "url": BASE + "/ledger/5"},
]}).encode("utf-8")

ENTRY6_JSON = json.dumps({
    "n": 6, "claim_sha256": PATH_SHA, "record_canonical": RECORD.decode(),
    "ots_status": "confirmed", "bitcoin_block": 959600, "block_time": "2026-07-26 03:00 UTC",
}).encode("utf-8")


def make_transport(raw_bytes=RECORD, index=INDEX, entry_json=ENTRY6_JSON):
    def tr(method, url):
        if url.endswith("/ledger"):
            return 200, index
        if "format=raw" in url:
            return 200, raw_bytes
        if "format=json" in url:
            return 200, entry_json
        raise AssertionError("unexpected url: " + url)
    return tr


def main():
    fails = []

    # 1. resolve by hash (jidec:path:<sha>) => integrity OK, path surfaced
    card = jc.cite("jidec:path:" + PATH_SHA, base=BASE, transport=make_transport())
    print("1 entry:", card["resolved_entry"], "| integrity:", card["integrity"]["match"],
          "| kind:", card["record_kind"], "| verdict:", card.get("path", {}).get("verdict", {}).get("outcome"))
    if card["resolved_entry"] != 6: fails.append("hash did not resolve to entry 6")
    if not card["integrity"]["match"]: fails.append("integrity should match")
    if card["record_kind"] != "jidec-path-v1": fails.append("record_kind wrong")
    if card["bitcoin"]["status"] != "confirmed" or card["bitcoin"]["block"] != 959600:
        fails.append("bitcoin status/block wrong")
    if len(card["path"]["assertions"]) != 4: fails.append("assertions not surfaced")

    # 2. resolve by entry number
    card2 = jc.cite("jidec:entry:6", base=BASE, transport=make_transport())
    print("2 by-entry integrity:", card2["integrity"]["match"])
    if not card2["integrity"]["match"]: fails.append("by-entry integrity should match")

    # 3. tampered bytes => integrity FAIL
    tampered = RECORD.replace(b'"outcome":"PASS"', b'"outcome":"FAIL"')
    if tampered == RECORD:
        tampered = RECORD + b" "  # ensure difference
    card3 = jc.cite("jidec:path:" + PATH_SHA, base=BASE,
                    transport=make_transport(raw_bytes=tampered))
    print("3 tampered integrity:", card3["integrity"]["match"], "(expect False)")
    if card3["integrity"]["match"]: fails.append("tampered bytes should FAIL integrity")
    if "INTEGRITY FAILURE" not in card3["trust_note"]: fails.append("no failure note on tamper")

    # 4. unknown hash => unresolved (LookupError)
    try:
        jc.cite("jidec:path:" + "a"*64, base=BASE, transport=make_transport())
        fails.append("unknown hash should not resolve")
    except LookupError:
        print("4 unknown hash: correctly unresolved")

    # 5. human summary renders without error
    summary = jc.human_summary(card)
    print("5 summary lines:", len(summary.splitlines()))
    if "verdict" not in summary: fails.append("summary missing verdict")

    print()
    if fails:
        print("FAIL:")
        for f in fails: print("  -", f)
        return 1
    print("ALL PASS (5/5 citation scenarios)")
    print()
    print("--- sample human summary ---")
    print(summary)
    return 0

if __name__ == "__main__":
    sys.exit(main())
