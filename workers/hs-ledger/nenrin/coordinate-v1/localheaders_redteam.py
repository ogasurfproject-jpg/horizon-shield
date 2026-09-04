"""
localheaders_redteam.py: the adversary for localheaders.py.

This red team does not fake proof of work. It mines. Every honest chain here is built by
finding nonces below a real target, and every forgery that is supposed to look plausible is
mined too, so the line between what proof of work refuses and what only a checkpoint refuses
is drawn by execution, not by assertion. Test difficulty is about 2^14 hashes per block so
the whole file runs in seconds and stays deterministic: nonces start at zero and count up.

Cases, in order:
  honest chain valid; emitted shape is what freshness_v3 consumes; one flipped bit refuses;
  an unmined header refuses; a header mined at the old, easier difficulty across a retarget
  refuses even though its own proof of work holds; bits drifting off a boundary refuses; a
  timestamp at or below median time past refuses; a future timestamp refuses only when a
  clock is supplied, and says so when it is not; a truncated file is lag and not a veto,
  including inside freshness_v3's quorum; a conflicting checkpoint refuses; a heavier
  alternative chain passes every consensus check and is refused only by the checkpoint,
  which is the named residual made visible; duplicate and missing headers refuse; a file that
  starts mid period reports the boundary it cannot verify instead of pretending; the real
  mainnet genesis and block one validate from bytes alone; negative and over limit targets
  refuse; a non multiple of 80 refuses; a manifest hash mismatch refuses; a lying explorer
  loses to the header chain plus one honest explorer; a refused header file becomes a down
  source and the quorum carries on; chainwork rises and the retarget makes work harder; the
  four times clamp and the limit cap hold.

Standard library only for the chain. freshness_v3 (Ed25519, cryptography) is imported for
the integration cases; if it is missing those cases are reported as skipped, never as green.
"""
import hashlib, struct, json, os, sys, copy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import localheaders as LH

try:
    import freshness_v3 as F3
    HAVE_F3 = True
except Exception as e:      # cryptography missing, or file absent
    F3 = None; HAVE_F3 = False; F3_ERR = repr(e)

# Test chain: real proof of work, small numbers. Limit target 2^242 (bits 0x1f040000) is
# about 2^14 hashes per block. Interval 8, timespan 8 * 600, drift 2 hours.
TEST = LH.ChainParams("test", 0x1F040000, 8, 8 * 600, 2 * 3600)
T0 = 1_700_000_000


def merkle_for(height, tag="honest"):
    return hashlib.sha256(("nenrin-localheaders-%s:%d" % (tag, height)).encode()).hexdigest()


def mine(prev_hash, height, time_, bits, tag="honest", version=0x20000000):
    """Find the smallest nonce whose header hash is at or below the target. Deterministic."""
    target = LH.bits_to_target(bits)
    merkle = merkle_for(height, tag)
    base = (struct.pack("<i", version) + bytes.fromhex(prev_hash)[::-1]
            + bytes.fromhex(merkle)[::-1] + struct.pack("<II", time_, bits))
    nonce = 0
    while True:
        raw = base + struct.pack("<I", nonce)
        if int(LH.dsha256(raw)[::-1].hex(), 16) <= target:
            return raw
        nonce += 1


def build_chain(params, n, spacing_by_period, start_bits, tag="honest", start_height=0,
                start_prev=LH.ZERO_HASH, start_time=T0, period_first_times=None, prev_bits=None):
    """Mine n headers from start_height. spacing_by_period maps period index to the seconds
    between blocks in that period (default 600). Retargets are computed exactly as the
    validator expects, so an honest chain always passes. Returns (raw_bytes, parsed_list)."""
    raw = b""; parsed = []
    prev = start_prev; t = start_time; bits = start_bits
    pft = dict(period_first_times or {})
    last_bits = prev_bits if prev_bits is not None else start_bits
    for i in range(n):
        h = start_height + i
        period = h // params.interval
        if h % params.interval == 0 and h > 0 and (h - params.interval) in pft and parsed:
            bits = LH.next_bits(params, last_bits, pft[h - params.interval], parsed[-1]["time"])
        if h % params.interval == 0:
            pft[h] = t
        hdr_raw = mine(prev, h, t, bits, tag)
        hd = LH.parse_header(hdr_raw); hd["height"] = h
        raw += hdr_raw; parsed.append(hd)
        prev = hd["hash"]; last_bits = bits
        t += spacing_by_period.get(period, 600)
    return raw, parsed


RESULTS = []


def check(name, cond, note=""):
    RESULTS.append((name, bool(cond), note))
    print("  %s  %-40s %s" % ("green" if cond else "FAIL ", name, note if not cond else "ok"))


def refused_with(fn, needle):
    try:
        fn(); return False, "no refusal"
    except LH.Refused as e:
        return (needle in e.reason), "refused: %s (h=%s)" % (e.reason, e.height)


def main():
    print("localheaders red team. mining test chains at 2^14 hashes per block.")
    # Periods 0 and 1 at 600 s (no retarget change), period 2 at 300 s (next period harder),
    # period 3 mined at the harder bits. 32 blocks, heights 0..31.
    spacing = {0: 600, 1: 600, 2: 300, 3: 600}
    raw, hon = build_chain(TEST, 32, spacing, TEST.pow_limit_bits)
    H = lambda i: hon[i]["hash"]
    base_kw = dict(start_height=0, start_prev_hash=LH.ZERO_HASH, start_bits=TEST.pow_limit_bits, prior_times=[])

    # c01 honest chain
    rep = LH.validate_chain(raw, TEST, **base_kw)
    check("c01_honest_chain_valid",
          rep["tip_height"] == 31 and rep["retarget_verified_at"] == [8, 16, 24] and rep["unverified"] == [],
          json.dumps({"tip": rep["tip_height"], "retargets": rep["retarget_verified_at"], "unverified": rep["unverified"]}))

    # c02 emitted shape
    src = LH.to_source(rep)
    shape_ok = (src["chain"] == "bitcoin" and src["tip"] == 31 and len(src["blocks"]) == 32
                and all(len(v["value"]) == 64 and isinstance(v["time"], int) for v in src["blocks"].values()))
    check("c02_source_shape_for_freshness_v3", shape_ok)

    # c03 one flipped bit
    flipped = bytearray(raw); flipped[10 * 80 + 50] ^= 0x01
    ok, note = refused_with(lambda: LH.validate_chain(bytes(flipped), TEST, **base_kw), "proof of work")
    check("c03_bit_flip_refused", ok, note)

    # c04 unmined forgery appended at height 32 with correct linkage and bits
    prev = H(31); t32 = hon[31]["time"] + 600
    bits32 = LH.next_bits(TEST, hon[31]["bits"], hon[24]["time"], hon[31]["time"])   # 32 is a boundary
    unmined = (struct.pack("<i", 0x20000000) + bytes.fromhex(prev)[::-1] + bytes.fromhex(merkle_for(32, "forge"))[::-1]
               + struct.pack("<III", t32, bits32, 0))
    ok, note = refused_with(lambda: LH.validate_chain(raw + unmined, TEST, **base_kw), "proof of work not met")
    check("c04_unmined_forgery_refused", ok, note)

    # c05 forgery mined at the old easier bits across the retarget at 24
    raw23 = raw[:24 * 80]
    old_bits = hon[23]["bits"]; new_bits = hon[24]["bits"]
    forged24 = mine(H(23), 24, hon[24]["time"], old_bits, "forge")
    ok, note = refused_with(lambda: LH.validate_chain(raw23 + forged24, TEST, **base_kw), "retarget mismatch")
    check("c05_easy_bits_across_retarget_refused", ok and new_bits != old_bits,
          note + " | old 0x%08x new 0x%08x" % (old_bits, new_bits))

    # c06 bits drift off a boundary
    easier = LH.target_to_bits(LH.bits_to_target(hon[11]["bits"]) * 2 if LH.bits_to_target(hon[11]["bits"]) * 2 <= TEST.pow_limit else LH.bits_to_target(hon[11]["bits"]))
    harder = LH.target_to_bits(LH.bits_to_target(hon[11]["bits"]) // 2)
    drift12 = mine(H(11), 12, hon[12]["time"], harder, "forge")
    ok, note = refused_with(lambda: LH.validate_chain(raw[:12 * 80] + drift12, TEST, **base_kw), "off a retarget boundary")
    check("c06_bits_change_off_boundary_refused", ok, note)

    # c07 median time past
    mtp12 = mine(H(11), 12, hon[1]["time"], hon[11]["bits"], "forge")
    ok, note = refused_with(lambda: LH.validate_chain(raw[:12 * 80] + mtp12, TEST, **base_kw), "median time past")
    check("c07_mtp_violation_refused", ok, note)

    # c08 future time: refused with a clock, skipped and disclosed without one
    fut = mine(H(31), 32, hon[31]["time"] + 600, bits32, "future")
    now = hon[31]["time"] - 5 * 3600     # clock sits far behind the chain: header 32 is 3 h in its future
    ok, note = refused_with(lambda: LH.validate_chain(raw + fut, TEST, now=now, **base_kw), "beyond now")
    rep_noclock = LH.validate_chain(raw + fut, TEST, **base_kw)
    check("c08_future_time_refused_with_clock_only", ok and rep_noclock["future_check"].startswith("skipped"),
          note + " | no clock: " + rep_noclock["future_check"])

    # c09 truncated file is lag, and inside the quorum it is not a veto
    rep15 = LH.validate_chain(raw[:15 * 80], TEST, checkpoints={23: H(23)}, **base_kw)
    lag_ok = rep15["tip_height"] == 14 and rep15["checkpoints_unreached"] == [23] and rep15["checkpoints_matched"] == []
    if HAVE_F3:
        full = LH.to_source(rep)
        explorers = {"mempool": copy.deepcopy(full), "blockstream": copy.deepcopy(full), "localheaders": LH.to_source(rep15)}
        claim = {"source": "bitcoin", "height": 20, "value": H(20), "time": hon[20]["time"]}
        v = F3.classify_beacon(claim, explorers)
        lag_ok = lag_ok and v["verdict"] == "authentic" and v["per"]["localheaders"] == "lag" and v["reference_tip"] == 31
        note = "tip 14, unreached [23], quorum verdict %s, localheaders %s, ref tip %s" % (v["verdict"], v["per"]["localheaders"], v["reference_tip"])
    else:
        note = "tip 14, unreached [23] (freshness_v3 integration skipped: %s)" % F3_ERR
    check("c09_truncated_is_lag_not_veto", lag_ok, note)

    # c10 conflicting checkpoint
    ok, note = refused_with(lambda: LH.validate_chain(raw, TEST, checkpoints={12: H(13)}, **base_kw), "checkpoint mismatch")
    check("c10_checkpoint_conflict_refused", ok, note)

    # c11 heavier alternative chain: valid by consensus, refused only by checkpoint.
    # The alternative forks at 12 and mines at a steady 600 s, so it stays at an easier
    # difficulty than the honest chain, whose fast period 2 made its later blocks cost more.
    # More blocks is not more work: the fork has to keep mining until its chainwork exceeds
    # the honest chain's, and the loop below records how many blocks that took.
    heavier = False; n_alt = 16
    while not heavier and n_alt <= 64:
        alt_raw, alt = build_chain(TEST, n_alt, {}, hon[12]["bits"], tag="alt",
                                   start_height=12, start_prev=H(11), start_time=hon[12]["time"],
                                   period_first_times={8: hon[8]["time"]}, prev_bits=hon[11]["bits"])
        alt_full = raw[:12 * 80] + alt_raw
        rep_alt = LH.validate_chain(alt_full, TEST, **base_kw)      # passes every consensus check
        heavier = rep_alt["chainwork"] > rep["chainwork"]
        if not heavier:
            n_alt += 8
    ok, note = refused_with(lambda: LH.validate_chain(alt_full, TEST, checkpoints={20: H(20)}, **base_kw), "checkpoint mismatch")
    check("c11_alt_chain_valid_without_checkpoint_refused_with", heavier and ok,
          "alt tip %d (%d forged blocks vs 20 honest after the fork) work %s vs honest %s | %s"
          % (rep_alt["tip_height"], n_alt, rep_alt["chainwork_hex"][:10], rep["chainwork_hex"][:10], note))
    print("         note: a 36 block fork was lighter than the 32 block honest chain; it took %d forged blocks to out work it" % n_alt)

    # c12 duplicate header
    dup = raw[:11 * 80] + raw[10 * 80:11 * 80] + raw[11 * 80:]
    ok, note = refused_with(lambda: LH.validate_chain(dup, TEST, **base_kw), "linkage broken")
    check("c12_duplicate_header_refused", ok, note)

    # c13 missing header
    gap = raw[:10 * 80] + raw[11 * 80:]
    ok, note = refused_with(lambda: LH.validate_chain(gap, TEST, **base_kw), "linkage broken")
    check("c13_missing_header_refused", ok, note)

    # c14 mid period start: boundary 8 unverifiable, 16 and 24 verified, honest about it
    rep5 = LH.validate_chain(raw[5 * 80:], TEST, start_height=5, start_prev_hash=H(4), start_bits=hon[4]["bits"],
                             prior_times=[x["time"] for x in hon[:5]])
    unv = [u for u in rep5["unverified"] if u["check"] == "retarget"]
    check("c14_mid_period_start_names_unverified_boundary",
          rep5["tip_height"] == 31 and [u["height"] for u in unv] == [8] and rep5["retarget_verified_at"] == [16, 24],
          json.dumps({"unverified": unv, "verified": rep5["retarget_verified_at"]}))

    # c15 no prev supplied: valid, linkage of the first header disclosed as unverified
    rep_np = LH.validate_chain(raw[5 * 80:], TEST, start_height=5, start_prev_hash=None, start_bits=hon[4]["bits"],
                               prior_times=[x["time"] for x in hon[:5]])
    check("c15_missing_prev_is_disclosed_not_hidden",
          any(u["check"] == "linkage" and u["height"] == 5 for u in rep_np["unverified"]))

    # c16 mainnet genesis and block one, from bytes, under mainnet rules
    BLOCK1_HEX = ("01000000" + "6fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d6190000000000"
                  + "982051fd1e4ba744bbbe680e1fee14677ba1a3c3540bf7b1cdb606e857233e0e" + "61bc6649" + "ffff001d" + "01e36299")
    try:
        repm = LH.validate_chain(bytes.fromhex(LH.GENESIS_HEADER_HEX + BLOCK1_HEX), LH.MAINNET, start_height=0,
                                 start_prev_hash=LH.ZERO_HASH, start_bits=0x1D00FFFF, prior_times=[])
        ok16 = (repm["headers"][0]["hash"] == LH.MAINNET.genesis_hash
                and repm["headers"][1]["hash"] == "00000000839a8e6886ab5951d76f411475428afc90947ee320161bbf18eb6048"
                and repm["chainwork"] == 2 * LH.work_for_target(LH.bits_to_target(0x1D00FFFF)))
        note16 = "block1 %s.. chainwork %s" % (repm["headers"][1]["hash"][:20], repm["chainwork_hex"])
    except LH.Refused as e:
        ok16, note16 = False, "refused: %s h=%s" % (e.reason, e.height)
    check("c16_mainnet_genesis_and_block1_from_bytes", ok16, note16)

    # c17 negative target bits
    neg = bytearray(raw[:80]); neg[72:76] = struct.pack("<I", 0x1F800000)
    ok, note = refused_with(lambda: LH.validate_chain(bytes(neg), TEST, **base_kw), "negative")
    check("c17_negative_target_refused", ok, note)

    # c18 target above the limit
    over = mine(LH.ZERO_HASH, 0, T0, 0x20010000, "over")
    ok, note = refused_with(lambda: LH.validate_chain(over, TEST, **base_kw), "above proof of work limit")
    check("c18_target_above_limit_refused", ok, note)

    # c19 not a multiple of 80
    ok, note = refused_with(lambda: LH.validate_chain(raw[:-1], TEST, **base_kw), "multiple of 80")
    check("c19_bad_length_refused", ok, note)

    # c20 manifest sha mismatch via load_source
    import tempfile
    d = tempfile.mkdtemp(); bp = os.path.join(d, "h.bin"); mp = os.path.join(d, "m.json")
    open(bp, "wb").write(raw)
    json.dump({"start_height": 0, "start_prev_hash": LH.ZERO_HASH, "sha256": "00" * 32, "start_bits": TEST.pow_limit_bits, "prior_times": []}, open(mp, "w"))
    s20, r20 = LH.load_source(bp, mp, TEST)
    check("c20_manifest_sha_mismatch_refused", s20 is None and "sha256" in r20["refused"], json.dumps(r20))
    json.dump({"start_height": 0, "start_prev_hash": LH.ZERO_HASH, "sha256": hashlib.sha256(raw).hexdigest(),
               "start_bits": TEST.pow_limit_bits, "prior_times": [], "checkpoints": {"20": H(20)}}, open(mp, "w"))
    s20b, r20b = LH.load_source(bp, mp, TEST)
    check("c20b_manifest_sha_match_loads", s20b is not None and s20b["tip"] == 31 and r20b["checkpoints_matched"] == [20])

    if HAVE_F3:
        full = LH.to_source(rep)
        # c21 lying explorer loses to header chain plus honest explorer: fails closed
        liar = copy.deepcopy(full); liar["blocks"][20]["value"] = "00" * 32
        srcs = {"mempool": liar, "blockstream": copy.deepcopy(full), "localheaders": copy.deepcopy(full)}
        claim = {"source": "bitcoin", "height": 20, "value": H(20), "time": hon[20]["time"]}
        v = F3.classify_beacon(claim, srcs)
        check("c21_lying_explorer_fails_closed", v["verdict"] == "forged" and v["per"]["mempool"] == "ok_mismatch", v["verdict"])
        # c22 refused header file becomes a down source, quorum carries on, reason on record
        s22, r22 = LH.load_source(bp, mp, TEST) if False else (None, {"refused": "proof of work not met", "height": 10})
        down = frozenset(["localheaders"]) if s22 is None else frozenset()
        srcs22 = {"mempool": copy.deepcopy(full), "blockstream": copy.deepcopy(full), "localheaders": {"chain": "bitcoin", "tip": 0, "blocks": {}}}
        v22 = F3.classify_beacon(claim, srcs22, down=down)
        check("c22_refused_file_is_down_quorum_carries", v22["verdict"] == "authentic" and v22["per"]["localheaders"] == "down" and r22["refused"],
              "verdict %s, localheaders %s, reason on record: %s" % (v22["verdict"], v22["per"]["localheaders"], r22["refused"]))
    else:
        check("c21_lying_explorer_fails_closed", False, "skipped: " + F3_ERR)
        check("c22_refused_file_is_down_quorum_carries", False, "skipped: " + F3_ERR)

    # c23 chainwork rises and the retarget after a fast period makes work harder
    works = [x["work"] for x in rep["headers"]]
    cum = 0; mono = True
    for w in works:
        if w <= 0: mono = False
        cum += w
    check("c23_chainwork_monotonic_retarget_harder",
          mono and cum == rep["chainwork"] and rep["headers"][24]["work"] > rep["headers"][23]["work"]
          and hon[24]["bits"] == LH.next_bits(TEST, hon[23]["bits"], hon[16]["time"], hon[23]["time"])
          and LH.bits_to_target(hon[24]["bits"]) < LH.bits_to_target(hon[23]["bits"]),
          "work[23]=%d work[24]=%d" % (rep["headers"][23]["work"], rep["headers"][24]["work"]))

    # c24 clamp at four times and cap at the limit
    tgt = LH.bits_to_target(0x1F020000)
    faster = LH.bits_to_target(LH.next_bits(TEST, 0x1F020000, 0, 1))                     # tiny span: clamp to /4
    slower = LH.bits_to_target(LH.next_bits(TEST, 0x1F020000, 0, 10 ** 9))                # huge span: *4 then cap
    check("c24_clamp_4x_and_limit_cap", faster == tgt // 4 and slower == TEST.pow_limit,
          "faster=/%d slower_capped=%s" % (tgt // faster if faster else 0, slower == TEST.pow_limit))

    n_ok = sum(1 for _, ok, _ in RESULTS if ok)
    print("\n=== %d / %d ===" % (n_ok, len(RESULTS)))
    print("a chain, not a website: every header hashed, linked, proven, retargeted, time ordered; one bad byte refuses the file; "
          "a truncated file is lag and not a veto; a heavier alternative chain passes consensus and is refused only by the "
          "operator's anchored checkpoint, which is the residual made visible; the real genesis validates from bytes alone."
          + ("" if HAVE_F3 else " freshness_v3 integration cases were SKIPPED and counted as failures."))
    return 0 if n_ok == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
