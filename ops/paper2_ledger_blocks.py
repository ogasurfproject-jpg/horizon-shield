#!/usr/bin/env python3
"""Read the JIDEC ledger entries paper 2 rests on and print their anchoring state (Table 3 block heights).

Runs on the Mac (needs network to ledger.horizonshield.dev). Read only. Uses curl, the same client that
works from the terminal (python's urllib got 403 from the edge).

    python3 ops/paper2_ledger_blocks.py            # entries 22 23 24 25 26 27 28 29 30 31 33
    python3 ops/paper2_ledger_blocks.py 35 36      # any entries

For each entry: schema, claim sha256, and every field whose name mentions block, bitcoin, ots, anchor,
status, confirmed, stamp or attest. The record body itself is not printed.
"""
import json
import subprocess
import sys
import time

LEDGER = "https://ledger.horizonshield.dev/ledger/%s?cb=%d"
KEYS = ("block", "bitcoin", "ots", "anchor", "status", "confirm", "stamp", "attest", "height")
SKIP = ("record", "record_canonical", "record_json", "claim_text")


def fetch(n):
    out = subprocess.run(["curl", "-sS", "--fail", "--max-time", "60", "-H", "Accept: application/json",
                          LEDGER % (n, int(time.time()))], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def walk(obj, prefix=""):
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            name = (prefix + "." + k) if prefix else k
            if k in SKIP:
                continue
            if any(s in k.lower() for s in KEYS) and not isinstance(v, (dict, list)):
                out.append((name, v))
            if isinstance(v, (dict, list)):
                out.extend(walk(v, name))
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:20]):
            out.extend(walk(v, "%s[%d]" % (prefix, i)))
    return out


def main(ns):
    for n in ns:
        try:
            d = fetch(n)
        except Exception as e:
            print("%s: fetch failed: %s" % (n, str(e)[:200]))
            continue
        top = d if isinstance(d, dict) else {}
        rec = top.get("record") if isinstance(top.get("record"), dict) else {}
        schema = rec.get("schema") or top.get("schema")
        claim = top.get("claim_sha256") or top.get("claim") or rec.get("claim_sha256")
        print("entry %s  schema %s  claim %s" % (n, schema, claim))
        seen = walk(top)
        if not seen:
            print("    (no block or ots field found; top level keys: %s)" % ", ".join(list(top.keys())[:20]))
        for k, v in seen:
            print("    %s = %s" % (k, str(v)[:120]))


if __name__ == "__main__":
    args = sys.argv[1:] or ["22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "33"]
    main(args)
