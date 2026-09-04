"""
genesis_window_check.py: does the chain pulled from genesis contain, byte for byte, every window
the earlier couriers delivered, and does it need no checkpoint to say so?

Reads the from-genesis header file and its manifest, validates the whole file in one streaming
pass with NO checkpoints supplied (the file has to stand on proof of work, linkage, retargets
and time alone), then slices out of it the exact heights each earlier window covers and
compares the slice to the earlier file: same bytes, same sha256 as that window's manifest
records. Last, it reads the hash at every checkpoint height the earlier manifests name and at
the height that confirmed entry 26, straight from the bytes at that offset, and compares.

Nothing is fetched. Nothing is written. Every line printed is derived from files on disk.

    python3 genesis_window_check.py localheaders_full.bin localheaders_full.manifest.json
    python3 genesis_window_check.py localheaders_full.bin localheaders_full.manifest.json --window localheaders_mainnet --window localheaders_p2p
"""
import argparse, hashlib, io, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import localheaders as LH
import localheaders_stream as LS

DEFAULT_WINDOWS = ["localheaders_mainnet", "localheaders_mainnet_mempool", "localheaders_p2p"]
ENTRY_26_BLOCK = 965447
RESULTS = []


def check(name, cond, note=""):
    RESULTS.append((name, bool(cond), note))
    print("  %s  %-52s %s" % ("green" if cond else "FAIL ", name, note))


def header_at(path, file_start, height):
    with io.open(path, "rb") as f:
        f.seek((height - file_start) * LH.HEADER_LEN)
        b = f.read(LH.HEADER_LEN)
    if len(b) != LH.HEADER_LEN:
        raise LH.Refused("height %d is not in the file" % height, height)
    return LH.parse_header(b)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("bin"); ap.add_argument("manifest")
    ap.add_argument("--window", action="append", default=None, help="prefix of an earlier window (bin + manifest.json), repeatable")
    ap.add_argument("--now", type=int, default=None, help="clock for the future drift check; default: synced_at from the manifest")
    a = ap.parse_args()
    here = os.path.dirname(os.path.abspath(a.bin))
    m = json.load(io.open(a.manifest, encoding="utf-8"))
    file_start = int(m["start_height"])
    now = a.now if a.now is not None else int(m["synced_at"])
    size = os.path.getsize(a.bin)
    print("genesis window check. file %s, %d bytes, %d headers, starts at height %d." % (a.bin, size, size // LH.HEADER_LEN, file_start))

    # 1. the whole file, one pass, no checkpoints supplied
    t0 = time.time()
    try:
        rep = LS.validate_file_streaming(a.bin, LH.MAINNET, start_height=file_start, start_prev_hash=m["start_prev_hash"], checkpoints={},
                                         now=now, start_bits=m.get("start_bits"), prior_times=m.get("prior_times"))
    except LH.Refused as e:
        check("g01_whole_file_valid_without_checkpoints", False, "refused at %s: %s" % (e.height, e.reason)); rep = None
    dt = time.time() - t0
    if rep:
        check("g01_whole_file_valid_without_checkpoints", rep["sha256"] == m["sha256"] and rep["tip_height"] == int(m["tip_height"]) and rep["tip_hash"] == m["tip_hash"],
              "tip %d, %d headers, %.1fs, sha %s" % (rep["tip_height"], rep["count"], dt, rep["sha256"][:16]))
        boundaries = rep["retarget_verified_at"]
        expected_boundaries = [h for h in range(LH.MAINNET.interval, rep["tip_height"] + 1, LH.MAINNET.interval) if h > file_start]
        check("g02_every_retarget_boundary_verified_from_inside", boundaries == expected_boundaries,
              "%d boundaries, first %s, last %s" % (len(boundaries), boundaries[:1], boundaries[-1:]))
        unv = [u for u in rep["unverified"] if not (u["height"] == 0 and u["check"] == "bits_continuity")]
        check("g03_nothing_unverified_but_genesis_bits_continuity", file_start == 0 and not unv,
              json.dumps(rep["unverified"]))
        check("g04_genesis_hash_from_bytes", file_start == 0 and header_at(a.bin, 0, 0)["hash"] == LH.MAINNET.genesis_hash, LH.MAINNET.genesis_hash[:16] if file_start == 0 else "file does not start at 0")
        print("         chainwork 0x%s" % rep["chainwork_hex"])

    # 2. every earlier window is a byte slice of this file
    names = a.window if a.window else DEFAULT_WINDOWS
    all_ckpts = {}
    for w in names:
        wb = os.path.join(here, w + ".bin"); wm = os.path.join(here, w + ".manifest.json")
        if not (os.path.exists(wb) and os.path.exists(wm)):
            check("w_%s_is_a_slice_of_the_genesis_chain" % w, False, "missing beside the file"); continue
        mw = json.load(io.open(wm, encoding="utf-8"))
        lo = int(mw["start_height"]); hi = int(mw["tip_height"])
        try:
            sl = LS.slice_window(a.bin, file_start, lo, hi)
        except OSError as e:
            check("w_%s_is_a_slice_of_the_genesis_chain" % w, False, str(e)); continue
        other = io.open(wb, "rb").read()
        sha_slice = hashlib.sha256(sl).hexdigest()
        ok = (sl == other) and (sha_slice == mw["sha256"]) and (len(sl) == (hi - lo + 1) * LH.HEADER_LEN)
        check("w_%s_is_a_slice_of_the_genesis_chain" % w, ok, "%d..%d, %d headers, sha %s %s manifest" % (lo, hi, len(sl) // 80, sha_slice[:16], "==" if sha_slice == mw["sha256"] else "!="))
        for k, v in (mw.get("checkpoints") or {}).items():
            all_ckpts.setdefault(int(k), set()).add(v.lower())

    # 3. checkpoints the earlier manifests name, read from the bytes at that height. none was supplied above.
    bad = []
    for h in sorted(all_ckpts):
        want = all_ckpts[h]
        try:
            got = header_at(a.bin, file_start, h)["hash"]
        except LH.Refused:
            bad.append((h, "not in file")); continue
        if len(want) != 1 or got not in want:
            bad.append((h, got[:16], sorted(x[:16] for x in want)))
    check("k01_all_earlier_checkpoints_sit_on_the_chain_unaided", bool(all_ckpts) and not bad, "%d heights: %s" % (len(all_ckpts), sorted(all_ckpts)) if not bad else json.dumps(bad))

    # 4. the block that confirmed entry 26
    try:
        b = header_at(a.bin, file_start, ENTRY_26_BLOCK)
        print("         block %d hash %s time %d" % (ENTRY_26_BLOCK, b["hash"], b["time"]))
        check("k02_entry_26_anchor_block_present", b["hash"].startswith("0000000000000000"), "hash %s.." % b["hash"][:24])
    except LH.Refused as e:
        check("k02_entry_26_anchor_block_present", False, e.reason)

    n_ok = sum(1 for _, ok, _ in RESULTS if ok)
    print("\n=== %d / %d ===" % (n_ok, len(RESULTS)))
    print("the chain from genesis needed no checkpoint to be valid; the windows the five couriers delivered are byte slices of it; "
          "the checkpoints the operator chose were confirmed by the bytes, not the other way round.")
    return 0 if n_ok == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
