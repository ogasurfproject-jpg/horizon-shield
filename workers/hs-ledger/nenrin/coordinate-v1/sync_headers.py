"""
sync_headers.py: the only step that touches the network, run by the operator, once.

It walks a public block explorer's block list from the tip down to a chosen start height,
rebuilds every 80 byte header from the fields the explorer returns (version, previous hash,
merkle root, time, bits, nonce), and refuses to keep any header whose double SHA-256 does not
equal the block id the explorer printed for it. Then it hands the whole run to
localheaders.validate_chain, which checks linkage, proof of work, the difficulty retarget,
median time past and the future drift against Bitcoin's consensus rules. Nothing is written
unless every header passes. What is written:

    localheaders_mainnet.bin             raw headers, 80 bytes each, ascending
    localheaders_mainnet.manifest.json   start height, prev hash, prior bits and times for the
                                         first checks, sha256 of the bin, tip, chainwork,
                                         checkpoints at every retarget boundary in the window
                                         plus the tip, the explorer used, and the sync time
    explorer_<name>_snapshot.json        optional: that explorer's own view of the same window
                                         in the exact SOURCES shape freshness_v3 consumes, so
                                         the quorum can be run offline against real data

The explorer is not trusted. It is a courier. A courier that hands over a forged header is
caught by proof of work; one that hands over a stale chain is caught as lag by the quorum;
one that hands over a different chain is caught by the checkpoints the operator pins in the
addendum. The default start height is the first block of the previous full retarget period,
so at least one difficulty boundary is verified from inside the file rather than assumed.

Standard library only. Run from the coordinate-v1 directory:

    python3 sync_headers.py
    python3 sync_headers.py --source mempool --snapshot
    python3 sync_headers.py --start 900000 --out-prefix localheaders_mainnet
"""
import json, sys, os, io, time, hashlib, argparse, urllib.request, urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import localheaders as LH

EXPLORERS = {
    "blockstream": {"base": "https://blockstream.info/api", "tip": "/blocks/tip/height", "page": "/blocks/%d"},
    "mempool":     {"base": "https://mempool.space/api",   "tip": "/blocks/tip/height", "page": "/v1/blocks/%d"},
}
UA = "nenrin-localheaders-sync/1 (+https://ledger.horizonshield.dev)"


def get(url, retries=4, pause=0.25):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json,text/plain"})
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read().decode("utf-8")
            time.sleep(pause)
            return body
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            last = e; time.sleep(1.5 * (i + 1))
    raise SystemExit("network: gave up on %s (%s). nothing written." % (url, last))


def rebuild(block):
    """80 raw bytes from explorer fields. Refuses if the hash does not equal the explorer's id."""
    raw = LH.build_header(int(block["version"]), block["previousblockhash"], block["merkle_root"],
                          int(block["timestamp"]), int(block["bits"]), int(block["nonce"]))
    h = LH.dsha256(raw)[::-1].hex()
    if h != block["id"].lower():
        raise SystemExit("rebuild mismatch at height %s: computed %s, explorer said %s. nothing written."
                         % (block.get("height"), h, block["id"]))
    return raw


def self_test():
    """Offline: rebuild the mainnet genesis and block one from explorer shaped fields and
    check the hashes. Proves the field order and byte order are right before any network."""
    g = {"id": LH.MAINNET.genesis_hash, "height": 0, "version": 1, "timestamp": 1231006505, "bits": 0x1D00FFFF,
         "nonce": 2083236893, "merkle_root": "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
         "previousblockhash": LH.ZERO_HASH}
    b1 = {"id": "00000000839a8e6886ab5951d76f411475428afc90947ee320161bbf18eb6048", "height": 1, "version": 1,
          "timestamp": 1231469665, "bits": 0x1D00FFFF, "nonce": 2573394689,
          "merkle_root": "0e3e2357e806b6cdb1f70b54c3a3a17b6714ee1f0e68bebb44a74b1efd512098",
          "previousblockhash": LH.MAINNET.genesis_hash}
    raw = rebuild(g) + rebuild(b1)
    rep = LH.validate_chain(raw, LH.MAINNET, start_height=0, start_prev_hash=LH.ZERO_HASH, start_bits=0x1D00FFFF, prior_times=[])
    print(json.dumps({"rebuilt_genesis": rep["headers"][0]["hash"], "rebuilt_block1": rep["headers"][1]["hash"],
                      "chain_valid": True, "chainwork_hex": rep["chainwork_hex"]}, indent=1))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true", help="offline: rebuild genesis and block 1 from fields")
    ap.add_argument("--source", choices=sorted(EXPLORERS), default="blockstream")
    ap.add_argument("--start", type=int, default=None, help="first height to keep. default: start of the previous full retarget period")
    ap.add_argument("--out-prefix", default="localheaders_mainnet")
    ap.add_argument("--snapshot", action="store_true", help="also write this explorer's view as a SOURCES shaped json")
    ap.add_argument("--dry-run", action="store_true", help="fetch and validate, write nothing")
    a = ap.parse_args()
    if a.self_test:
        return self_test()
    ex = EXPLORERS[a.source]

    tip = int(get(ex["base"] + ex["tip"]).strip())
    start = a.start if a.start is not None else ((tip // LH.MAINNET.interval) - 1) * LH.MAINNET.interval
    if start < 0 or start > tip:
        raise SystemExit("bad start %d for tip %d" % (start, tip))
    prior_floor = max(0, start - 11)          # eleven blocks below start feed the first MTP checks
    print("explorer %s | tip %d | keeping %d..%d | fetching down to %d" % (a.source, tip, start, tip, prior_floor))

    blocks = {}
    h = tip
    pages = 0
    while h >= prior_floor:
        body = get(ex["base"] + (ex["page"] % h))
        page = json.loads(body)
        if not isinstance(page, list) or not page:
            raise SystemExit("unexpected page at %d. nothing written." % h)
        for b in page:
            bh = int(b["height"])
            if prior_floor <= bh <= tip and bh not in blocks:
                blocks[bh] = b
        lowest = min(int(b["height"]) for b in page)
        if lowest >= h:
            raise SystemExit("explorer page did not descend at %d. nothing written." % h)
        h = lowest - 1
        pages += 1
        if pages % 25 == 0:
            print("  %d pages, down to %d" % (pages, h + 1))

    missing = [x for x in range(prior_floor, tip + 1) if x not in blocks]
    if missing:
        raise SystemExit("missing heights %s.. nothing written." % missing[:5])

    raws = {bh: rebuild(blocks[bh]) for bh in range(prior_floor, tip + 1)}
    prior = [LH.parse_header(raws[x]) for x in range(prior_floor, start)]
    keep = b"".join(raws[x] for x in range(start, tip + 1))
    start_prev = blocks[start]["previousblockhash"].lower() if start > 0 else LH.ZERO_HASH
    start_bits = prior[-1]["bits"] if prior else None
    prior_times = [p["time"] for p in prior]
    now = int(time.time())

    try:
        rep = LH.validate_chain(keep, LH.MAINNET, start_height=start, start_prev_hash=start_prev,
                                now=now, start_bits=start_bits, prior_times=prior_times)
    except LH.Refused as e:
        raise SystemExit("REFUSED at height %s: %s. nothing written." % (e.height, e.reason))

    checkpoints = {str(hd["height"]): hd["hash"] for hd in rep["headers"]
                   if hd["height"] % LH.MAINNET.interval == 0}
    checkpoints[str(rep["tip_height"])] = rep["tip_hash"]
    sha = hashlib.sha256(keep).hexdigest()
    manifest = {
        "schema": "nenrin-localheaders-manifest-1", "chain": "bitcoin", "explorer": a.source,
        "explorer_base": ex["base"], "synced_at": now, "start_height": start, "count": rep["count"],
        "tip_height": rep["tip_height"], "tip_hash": rep["tip_hash"], "tip_time": rep["tip_time"],
        "chainwork_hex": rep["chainwork_hex"], "sha256": sha, "start_prev_hash": start_prev,
        "start_bits": start_bits, "prior_times": prior_times, "checkpoints": checkpoints,
        "retarget_verified_at": rep["retarget_verified_at"], "unverified": rep["unverified"],
        "future_check": rep["future_check"],
        "note": "value is the block hash in display order, time is the header nTime. the explorer was a courier, not a source of truth: every header was rebuilt from fields, hashed, linked, proven and retargeted locally.",
    }
    print("valid | %d headers %d..%d | tip %s | retargets verified at %s | unverified %d | sha256 %s"
          % (rep["count"], start, rep["tip_height"], "..." + rep["tip_hash"][-16:], rep["retarget_verified_at"], len(rep["unverified"]), sha[:16]))
    print("checkpoints for the addendum:")
    for k in sorted(checkpoints, key=int):
        print("    %8s  %s" % (k, checkpoints[k]))

    if a.dry_run:
        print("dry run. nothing written."); return 0

    bin_path = a.out_prefix + ".bin"; man_path = a.out_prefix + ".manifest.json"
    io.open(bin_path, "wb").write(keep)
    io.open(man_path, "w", encoding="utf-8").write(json.dumps(manifest, ensure_ascii=False, indent=1))
    src, rep2 = LH.load_source(bin_path, man_path, LH.MAINNET, now=now)
    if src is None:
        os.remove(bin_path); os.remove(man_path)
        raise SystemExit("read back failed: %s. files removed." % rep2)
    print("wrote %s (%d bytes) and %s | read back: tip %d, %d blocks" % (bin_path, len(keep), man_path, src["tip"], len(src["blocks"])))

    if a.snapshot:
        snap = {"chain": "bitcoin", "tip": tip, "explorer": a.source, "fetched_at": now,
                "blocks": {str(x): {"value": blocks[x]["id"].lower(), "time": int(blocks[x]["timestamp"])} for x in range(start, tip + 1)}}
        sp = "explorer_%s_snapshot.json" % a.source
        io.open(sp, "w", encoding="utf-8").write(json.dumps(snap, ensure_ascii=False))
        print("wrote %s (%d blocks, this explorer's own view, untrusted, for the quorum)" % (sp, len(snap["blocks"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
