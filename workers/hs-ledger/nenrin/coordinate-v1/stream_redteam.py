"""
stream_redteam.py: proves localheaders_stream.ChainValidator is the same judge as
localheaders.validate_chain, only faster and in constant memory.

The two must agree on every accepted chain and on every refusal: same report fields, same
sha, same reason string, same height. They are fed the same bytes, the streaming one in
random chunk sizes from a seeded generator so the split points differ from run to run of the
red team but never between two runs with the same seed. The chains are mined by
localheaders_redteam at test difficulty; the real mainnet window pinned by entry 27 is used
too when the file is present, and reported as skipped (not green) when it is not.
"""
import os, sys, json, random, struct, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import localheaders as LH
import localheaders_stream as LS
import localheaders_redteam as RT

TEST = RT.TEST
FIELDS = ["count", "start_height", "tip_height", "tip_hash", "tip_time", "chainwork", "chainwork_hex",
          "retarget_verified_at", "checkpoints_matched", "checkpoints_unreached", "unverified", "future_check"]
RESULTS = []


def check(name, cond, note=""):
    RESULTS.append((name, bool(cond), note))
    print("  %s  %-46s %s" % ("green" if cond else "FAIL ", name, note if not cond else "ok"))


def stream_in_chunks(raw, rng, params, **kw):
    v = LS.ChainValidator(params, **kw)
    pos = 0
    while pos < len(raw):
        n = rng.randint(1, 7) * 80
        v.feed(raw[pos:pos + n]); pos += n
    return v.report()


def same_report(a, b):
    diffs = [f for f in FIELDS if a.get(f) != b.get(f)]
    return (not diffs), diffs


def both_refuse(raw, params, **kw):
    r1 = r2 = None
    try:
        LH.validate_chain(raw, params, **kw)
    except LH.Refused as e:
        r1 = (e.reason, e.height)
    try:
        v = LS.ChainValidator(params, **kw); v.feed(raw); v.report()
    except LH.Refused as e:
        r2 = (e.reason, e.height)
    return r1, r2


def main():
    print("stream red team. same bytes, two judges, must agree.")
    rng = random.Random(20260904)
    raw, hon = RT.build_chain(TEST, 32, {0: 600, 1: 600, 2: 300, 3: 600}, TEST.pow_limit_bits)
    H = lambda i: hon[i]["hash"]
    base = dict(start_height=0, start_prev_hash=LH.ZERO_HASH, start_bits=TEST.pow_limit_bits, prior_times=[])

    # e01 honest chain, random chunks
    a = LH.validate_chain(raw, TEST, **base); b = stream_in_chunks(raw, rng, TEST, **base)
    ok, diffs = same_report(a, b)
    check("e01_honest_chain_reports_identical", ok and b["sha256"] == LS.hashlib.sha256(raw).hexdigest(), json.dumps(diffs))

    # e02 one header at a time vs all at once
    v1 = LS.ChainValidator(TEST, **base)
    for i in range(32): v1.feed(raw[i * 80:(i + 1) * 80])
    v2 = LS.ChainValidator(TEST, **base); v2.feed(raw)
    ok, diffs = same_report(v1.report(), v2.report())
    check("e02_chunking_does_not_change_verdict", ok, json.dumps(diffs))

    # e03 every refusal agrees on reason and height
    flipped = bytearray(raw); flipped[10 * 80 + 50] ^= 0x01
    bits32 = LH.next_bits(TEST, hon[31]["bits"], hon[24]["time"], hon[31]["time"])
    unmined = (struct.pack("<i", 0x20000000) + bytes.fromhex(H(31))[::-1] + bytes.fromhex(RT.merkle_for(32, "forge"))[::-1] + struct.pack("<III", hon[31]["time"] + 600, bits32, 0))
    forged24 = RT.mine(H(23), 24, hon[24]["time"], hon[23]["bits"], "forge")
    harder = LH.target_to_bits(LH.bits_to_target(hon[11]["bits"]) // 2)
    drift12 = RT.mine(H(11), 12, hon[12]["time"], harder, "forge")
    mtp12 = RT.mine(H(11), 12, hon[1]["time"], hon[11]["bits"], "forge")
    fut = RT.mine(H(31), 32, hon[31]["time"] + 600, bits32, "future")
    neg = bytearray(raw[:80]); neg[72:76] = struct.pack("<I", 0x1F800000)
    over = RT.mine(LH.ZERO_HASH, 0, RT.T0, 0x20010000, "over")
    cases = [
        ("bit_flip", bytes(flipped), {}), ("unmined", raw + unmined, {}), ("easy_bits_retarget", raw[:24 * 80] + forged24, {}),
        ("bits_off_boundary", raw[:12 * 80] + drift12, {}), ("mtp", raw[:12 * 80] + mtp12, {}),
        ("future", raw + fut, {"now": hon[31]["time"] - 5 * 3600}), ("checkpoint_conflict", raw, {"checkpoints": {12: H(13)}}),
        ("duplicate", raw[:11 * 80] + raw[10 * 80:11 * 80] + raw[11 * 80:], {}), ("gap", raw[:10 * 80] + raw[11 * 80:], {}),
        ("negative_bits", bytes(neg), {}), ("over_limit", over, {}), ("bad_length", raw[:-1], {}),
    ]
    agree = []; disagree = []
    for name, data, extra in cases:
        kw = dict(base, **extra)
        r1, r2 = both_refuse(data, TEST, **kw)
        (agree if (r1 is not None and r1 == r2) else disagree).append((name, r1, r2))
    check("e03_all_twelve_refusals_agree_reason_and_height", not disagree and len(agree) == 12, json.dumps(disagree)[:300])

    # e04 mid period start with prior state
    kw = dict(start_height=5, start_prev_hash=H(4), start_bits=hon[4]["bits"], prior_times=[x["time"] for x in hon[:5]])
    a = LH.validate_chain(raw[5 * 80:], TEST, **kw); b = stream_in_chunks(raw[5 * 80:], rng, TEST, **kw)
    ok, diffs = same_report(a, b)
    check("e04_mid_period_start_identical_including_unverified", ok and [u["height"] for u in b["unverified"] if u["check"] == "retarget"] == [8], json.dumps(diffs))

    # e05 no prev supplied: identical disclosure
    kw = dict(start_height=5, start_prev_hash=None, start_bits=hon[4]["bits"], prior_times=[x["time"] for x in hon[:5]])
    a = LH.validate_chain(raw[5 * 80:], TEST, **kw); b = stream_in_chunks(raw[5 * 80:], rng, TEST, **kw)
    ok, diffs = same_report(a, b)
    check("e05_missing_prev_disclosure_identical", ok, json.dumps(diffs))

    # e06 constant memory: state never grows with the chain
    v = LS.ChainValidator(TEST, **base); v.feed(raw)
    check("e06_state_is_bounded", len(v.period_first_time) <= 2 and len(v.times) <= 11,
          "period_first_time=%d times=%d" % (len(v.period_first_time), len(v.times)))

    # e07 mainnet genesis and block one under mainnet rules
    b1 = ("01000000" + "6fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d6190000000000"
          + "982051fd1e4ba744bbbe680e1fee14677ba1a3c3540bf7b1cdb606e857233e0e" + "61bc6649" + "ffff001d" + "01e36299")
    g2 = bytes.fromhex(LH.GENESIS_HEADER_HEX + b1)
    kwm = dict(start_height=0, start_prev_hash=LH.ZERO_HASH, start_bits=0x1D00FFFF, prior_times=[])
    a = LH.validate_chain(g2, LH.MAINNET, **kwm); b = stream_in_chunks(g2, rng, LH.MAINNET, **kwm)
    ok, diffs = same_report(a, b)
    check("e07_mainnet_genesis_block1_identical", ok and b["tip_hash"] == "00000000839a8e6886ab5951d76f411475428afc90947ee320161bbf18eb6048", json.dumps(diffs))

    # e08 the real window pinned by entry 27, if present: identical reports, and a timing
    here = os.path.dirname(os.path.abspath(__file__))
    binp = os.path.join(here, "localheaders_mainnet.bin"); manp = os.path.join(here, "localheaders_mainnet.manifest.json")
    if os.path.exists(binp) and os.path.exists(manp):
        m = json.load(open(manp)); data = open(binp, "rb").read()
        kwr = dict(start_height=int(m["start_height"]), start_prev_hash=m["start_prev_hash"], start_bits=m.get("start_bits"),
                   prior_times=m.get("prior_times"), checkpoints=m.get("checkpoints"), now=int(m["synced_at"]))
        t0 = time.time(); a = LH.validate_chain(data, LH.MAINNET, **kwr); t1 = time.time()
        b = stream_in_chunks(data, rng, LH.MAINNET, **kwr); t2 = time.time()
        ok, diffs = same_report(a, b)
        check("e08_real_window_3820_identical", ok and b["sha256"] == m["sha256"] and b["checkpoints_matched"] == [961632, 963648, 965451],
              json.dumps(diffs) + " batch %.2fs stream %.2fs" % (t1 - t0, t2 - t1))
        print("         note: batch %.2fs, stream %.2fs over %d headers" % (t1 - t0, t2 - t1, b["count"]))
    else:
        check("e08_real_window_3820_identical", False, "skipped: localheaders_mainnet.bin not beside this file")

    n_ok = sum(1 for _, ok, _ in RESULTS if ok)
    print("\n=== %d / %d ===" % (n_ok, len(RESULTS)))
    print("two judges, one verdict: the streaming validator accepts what validate_chain accepts, refuses what it refuses with the same "
          "reason at the same height, discloses the same unverified boundaries, and keeps no more than eleven timestamps and two "
          "period starts no matter how long the chain.")
    return 0 if n_ok == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
