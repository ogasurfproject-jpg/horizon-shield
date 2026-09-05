#!/usr/bin/env python3
"""
verify_beacons.py: falsify, or fail to falsify, every beacon the gate wrote into a verdict.

Gate 0.3.0 derives the measurement day and the tool order from a salt it committed to before the
window, bound to a Bitcoin block mined after the salt existed. Every derived verdict carries
coordinate_derivation { window_id, salt_commitment, salt_created_at, beacon { height, block_hash } }.
Anyone holding Bitcoin headers can check two things without trusting the gate or an explorer:

  1. the block hash the gate recorded at that height is the hash the chain has at that height
  2. the salt was created before that block's time (a salt made after seeing the block could be chosen)

This does both against the locally validated header file (localheaders.py, JIDEC entries 24 and 26),
never against an API. Weakness audit 2026-09-05, item 7: "falsifiable" and "falsified or not" are
different states; this script produces the second.

    python3 verify_beacons.py --history ../ring-v1/history/*.json            # one line per distinct beacon
    python3 verify_beacons.py --history ../../../../mcp-conduct-register/history/*.json

A beacon above the local tip is reported as BEYOND_TIP, which means: sync headers, then rerun.
That is a limit of the local file, not a finding about the gate.
"""

import argparse, glob, io, json, os, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import localheaders as LH  # noqa: E402

# A block's nTime may be up to 2h ahead of real time (consensus drift). The salt must predate the block;
# allow the drift so an honest gate is not falsified by the miner's clock.
DRIFT = 2 * 3600


def iso_to_unix(s):
    return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())


def collect(history_paths):
    """Distinct beacons across every verdict: {(height, hash): {windows, salt_created_at, commitments, verdicts}}."""
    out = {}
    for p in history_paths:
        d = json.load(io.open(p, encoding="utf-8"))
        for e in d.get("entries") or []:
            cd = e.get("coordinate_derivation") if isinstance(e.get("coordinate_derivation"), dict) else None
            if not cd or not cd.get("derived") or not isinstance(cd.get("beacon"), dict):
                continue
            b = cd["beacon"]
            key = (int(b.get("height")), str(b.get("block_hash") or "").lower())
            slot = out.setdefault(key, {"windows": set(), "salts": set(), "commitments": set(), "verdicts": 0})
            slot["windows"].add(cd.get("window_id"))
            if cd.get("salt_created_at"):
                slot["salts"].add(cd["salt_created_at"])
            if cd.get("salt_commitment"):
                slot["commitments"].add(cd["salt_commitment"])
            slot["verdicts"] += 1
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--history", nargs="+", required=True, help="/history exports (files or globs)")
    ap.add_argument("--bin", default=os.path.join(HERE, "localheaders_mainnet.bin"))
    ap.add_argument("--manifest", default=os.path.join(HERE, "localheaders_mainnet.manifest.json"))
    a = ap.parse_args()
    paths = []
    for h in a.history:
        paths += glob.glob(h) or [h]
    src, rep = LH.load_source(a.bin, a.manifest, LH.MAINNET)
    if src is None:
        print("REFUSED: local headers %s" % rep)
        return 2
    print("local headers: %d..%d (tip %s), validated offline" % (rep["start_height"], rep["tip_height"], rep["tip_hash"][-16:]))
    beacons = collect(paths)
    if not beacons:
        print("no derived beacons in %d history file(s); the gate has not yet written a derived verdict (legacy fallback or pre-0.3.0)" % len(paths))
        return 0
    bad = 0
    for (height, bh), info in sorted(beacons.items()):
        blk = src["blocks"].get(height)
        if blk is None:
            state = "BEYOND_TIP" if height > src["tip"] else "BELOW_START"
            print("%-11s height %d  hash ..%s  windows %s  verdicts %d  (sync headers and rerun)" % (state, height, bh[-16:], sorted(info["windows"]), info["verdicts"]))
            continue
        hash_ok = blk["value"].lower() == bh
        salt_ok, salt_note = True, "no salt_created_at recorded"
        if info["salts"]:
            latest_salt = max(iso_to_unix(s) for s in info["salts"])
            salt_ok = latest_salt <= blk["time"] + DRIFT
            salt_note = "salt %s vs block time %s (%s)" % (
                datetime.fromtimestamp(latest_salt, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                datetime.fromtimestamp(blk["time"], timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "salt predates block" if salt_ok else "SALT AFTER BLOCK: the gate could have chosen the salt knowing the hash")
        state = "MATCH" if (hash_ok and salt_ok) else "FALSIFIED"
        if state == "FALSIFIED":
            bad += 1
        print("%-11s height %d  hash ..%s  chain ..%s  windows %s  verdicts %d  %s" % (
            state, height, bh[-16:], blk["value"][-16:], sorted(info["windows"]), info["verdicts"], salt_note))
    print("%d distinct beacon(s), %d falsified" % (len(beacons), bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
