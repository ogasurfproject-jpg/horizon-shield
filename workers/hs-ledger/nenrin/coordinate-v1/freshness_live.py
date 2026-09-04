"""
freshness_live.py: freshness_v3 run against real Bitcoin mainnet headers, offline.

Sources come from sources_live.load_sources: the validated header chain the operator synced
(localheaders_mainnet.bin, a chain and not a website) and each explorer's own snapshot of the
same window. freshness_v3.py is imported as pinned by JIDEC entry 24 and not modified.

What runs, in order, all against the real tip block of the synced window:
  1. an honest proof whose beacon is the real tip block, created just after it: authentic,
     valid as issued. The sources that agreed are named, and if only a quorum was reachable
     the degraded tip basis is disclosed rather than hidden.
  2. the same proof with a fabricated block hash at the real height: forged, refused.
  3. a beacon at a height beyond the reference tip plus the six block margin: bad coordinate,
     refused, even though every source is honest.
  4. a proof created before its own beacon's block time: refused as backdated.
  5. the header chain marked down (as if the file had been refused): the two explorers alone
     still reach quorum, and the degraded tip basis is disclosed.

The clock is a parameter and defaults to a fixed value written here, so the run is
deterministic and the record hashes below can be reproduced byte for byte by anyone holding
the same three source files, whose sha256 are pinned in the addendum.

    python3 freshness_live.py            # fixed clock, reproducible
    python3 freshness_live.py --now 0    # use the wall clock instead
"""
import json, os, sys, argparse, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import freshness_v3 as F3
import sources_live as SL

SEED = "nenrin-localheaders-live"
FIXED_NOW = 1_788_512_000      # 2026-09-04, a few minutes after the synced tip. Deterministic by default.


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--now", type=int, default=FIXED_NOW, help="unix time. 0 means the wall clock")
    a = ap.parse_args()
    now = int(time.time()) if a.now == 0 else a.now

    sources, down, report = SL.load_sources(a.dir, now=now)
    print("sources:", json.dumps(report, ensure_ascii=False))
    print("down:", sorted(down))
    lh = sources["localheaders"]
    if not lh["blocks"]:
        print("no validated header chain. nothing to demonstrate."); return 1
    tip_h = lh["tip"]; tip = lh["blocks"][tip_h]
    beacon = {"source": "bitcoin", "height": tip_h, "value": tip["value"], "time": tip["time"]}
    anchor = tip["time"] + 300           # the OTS anchor would land shortly after the beacon block
    _, trusted = F3.keypair(SEED)
    results = {}

    def run(label, ev, **kw):
        v = F3.verify_freshness(ev, trusted, anchor, now, sources=sources, down=kw.pop("down", down), **kw)
        d = v["disclosures"]
        results[label] = {"beacon_verdict": v["checks"]["beacon_verdict"], "valid_as_issued": v["valid_as_issued"],
                          "refused": v["refused"], "sources": d["beacon_sources"], "agreeing": d["sources_agreeing"],
                          "reference_tip": d["reference_tip"], "tip_basis": d["tip_basis"],
                          "not_backdated": v["checks"].get("not_backdated"), "record_sha256": v["record_sha256"]}
        print("\n[%s]" % label)
        print(json.dumps(results[label], ensure_ascii=False, indent=1))
        return v

    # 1. honest
    ev = F3.make_event(SEED, tip["time"] + 60, "agent_reported", beacon)
    run("1_honest_real_tip", ev)

    # 2. fabricated hash at the real height
    fake = dict(beacon, value="00000000000000000000" + "d" * 44)
    run("2_fabricated_hash_forged", F3.make_event(SEED, tip["time"] + 60, "agent_reported", fake))

    # 3. beyond the reference tip plus margin
    far = dict(beacon, height=tip_h + F3.MARGIN_BLOCKS + 1)
    run("3_beyond_margin_bad_coordinate", F3.make_event(SEED, tip["time"] + 60, "agent_reported", far))

    # 4. backdated: created long before the beacon block existed
    run("4_backdated_refused", F3.make_event(SEED, tip["time"] - 7 * 24 * 3600, "agent_reported", beacon))

    # 5. header chain down: explorers alone
    run("5_localheaders_down_explorers_only", ev, down=frozenset(set(down) | {"localheaders"}))

    print("\nrecord hashes:")
    for k, v in results.items():
        print("  %s  %s" % (v["record_sha256"], k))
    ok = (results["1_honest_real_tip"]["beacon_verdict"] == "authentic" and results["1_honest_real_tip"]["valid_as_issued"]
          and results["2_fabricated_hash_forged"]["beacon_verdict"] == "forged"
          and results["3_beyond_margin_bad_coordinate"]["beacon_verdict"] == "bad_coordinate"
          and results["4_backdated_refused"]["refused"] is True)
    print("\n%s" % ("all five behaved as the addendum says" if ok else "MISMATCH: read the verdicts above"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
