"""
localheaders.py: a beacon source that is a chain, not a website.

NENRIN coordinate-v1, time axis. freshness_v3 takes its not-before beacon from several
sources the prover does not own. Two of them are public block explorers. This is the third,
and it is the one the addendum (JIDEC entry 24, then 26) called the strongest form of the
check: a locally synced set of raw Bitcoin block headers, verified against the chain's own
consensus rules, with no API in the path at verification time.

What this file trusts: nothing. Every 80 byte header is checked for
  1. hash          double SHA-256 of the exact bytes
  2. linkage       prev_hash of header i+1 equals hash of header i
  3. proof of work hash, as a 256 bit integer, is at or below the target its own bits encode,
                   and that target is at or below the chain's proof of work limit
  4. difficulty    off a boundary, bits must equal the previous header's bits; on a boundary
                   (height divisible by the interval) bits must equal what Bitcoin Core's
                   retarget arithmetic produces from the previous period's first and last
                   timestamps, clamped to a factor of four, capped at the limit
  5. median time   time must exceed the median of the previous eleven header times
  6. future time   time must not exceed a supplied clock plus the allowed drift (skipped, and
                   said so, when no clock is supplied, so offline runs stay deterministic)
  7. checkpoints   if the file covers a checkpointed height, the hash there must match. A
                   checkpoint the file does not reach is lag, reported, never a veto.

One violation refuses the whole file. A header set with one bad header is evidence of
tampering or corruption, not a shorter chain, so the source reports itself as refused with
the reason and the height, and the quorum treats it as down. That is the same rule as
everywhere else in the ledger: fail closed on the adversary, and let no single source open or
close the gate alone.

What it emits is the exact shape freshness_v3 consumes, so freshness_v3.py (pinned by entry
24) is not touched:

    {"chain": "bitcoin", "tip": <height>, "blocks": {<height>: {"value": <hash hex>,
                                                                 "time":  <nTime>}}}

value is the block hash as 64 lowercase hex characters in display order (the order explorers
print), time is the header's nTime. A prover embedding a beacon must use the same two fields.

Named limits, so nobody reads more into this than it proves:
  - the sync peer can hand over a stale but valid chain. That is lag. The quorum tip logic in
    freshness_v3 already treats a lagging source as the lowest tip, never a veto.
  - proof of work bounds an attacker by hashpower, not by identity. At mainnet difficulty a
    forged segment costs real energy; in the red team at test difficulty it costs seconds,
    which is exactly why the red team can afford to mine forgeries and show where the line is.
    The operator's checkpoints, whose hashes are pinned in the addendum and so anchored in
    Bitcoin through JIDEC, are what refuse a lighter alternative chain.
  - a file that starts mid period cannot have its first difficulty boundary verified, because
    the first block of that period is not in the file. The report names those boundaries as
    unverified rather than pretending.

Standard library only. Deterministic. Offline.
"""
import hashlib, struct, json, io, sys, os

HEADER_LEN = 80
ZERO_HASH = "0" * 64


class ChainParams:
    def __init__(self, name, pow_limit_bits, interval, timespan, max_future, genesis_hash=None):
        self.name = name
        self.pow_limit_bits = pow_limit_bits
        self.pow_limit = bits_to_target(pow_limit_bits)
        self.interval = interval
        self.timespan = timespan
        self.max_future = max_future
        self.genesis_hash = genesis_hash

    def __repr__(self):
        return "ChainParams(%s interval=%d timespan=%d limit=0x%08x)" % (
            self.name, self.interval, self.timespan, self.pow_limit_bits)


def dsha256(b):
    return hashlib.sha256(hashlib.sha256(b).digest()).digest()


def bits_to_target(bits):
    """Bitcoin compact encoding to integer target. Negative or overflowing values are refused."""
    if bits < 0 or bits > 0xFFFFFFFF:
        raise ValueError("bits out of range")
    exp = bits >> 24
    mant = bits & 0x007FFFFF
    if bits & 0x00800000:
        raise ValueError("negative target")
    if exp <= 3:
        target = mant >> (8 * (3 - exp))
    else:
        target = mant << (8 * (exp - 3))
    if target >> 256:
        raise ValueError("target overflows 256 bits")
    return target


def target_to_bits(target):
    """Integer target to Bitcoin compact encoding, Bitcoin Core GetCompact semantics."""
    if target <= 0:
        return 0
    size = (target.bit_length() + 7) // 8
    if size <= 3:
        mant = target << (8 * (3 - size))
    else:
        mant = target >> (8 * (size - 3))
    if mant & 0x00800000:
        mant >>= 8
        size += 1
    return (size << 24) | mant


def work_for_target(target):
    """Expected hashes to find a block at this target: 2^256 / (target + 1)."""
    return (1 << 256) // (target + 1)


def parse_header(raw):
    if len(raw) != HEADER_LEN:
        raise ValueError("header must be exactly 80 bytes, got %d" % len(raw))
    version, = struct.unpack("<i", raw[0:4])
    prev = raw[4:36][::-1].hex()
    merkle = raw[36:68][::-1].hex()
    time_, bits, nonce = struct.unpack("<III", raw[68:80])
    h = dsha256(raw)[::-1].hex()
    return {"version": version, "prev": prev, "merkle": merkle, "time": time_,
            "bits": bits, "nonce": nonce, "hash": h}


def build_header(version, prev_hex, merkle_hex, time_, bits, nonce):
    """Assemble 80 raw bytes from display order fields. Inverse of parse_header."""
    return (struct.pack("<i", version) + bytes.fromhex(prev_hex)[::-1]
            + bytes.fromhex(merkle_hex)[::-1] + struct.pack("<III", time_, bits, nonce))


def next_bits(params, last_bits, first_time, last_time):
    """Bitcoin Core CalculateNextWorkRequired: actual timespan between the first and last
    block of the finished period, clamped to [timespan/4, timespan*4], applied to the old
    target with multiply then integer divide, capped at the proof of work limit."""
    span = last_time - first_time
    lo, hi = params.timespan // 4, params.timespan * 4
    if span < lo:
        span = lo
    if span > hi:
        span = hi
    target = bits_to_target(last_bits) * span // params.timespan
    if target > params.pow_limit:
        target = params.pow_limit
    return target_to_bits(target)


def median_time_past(times):
    """Median of up to the last eleven timestamps. Bitcoin's MTP rule."""
    window = sorted(times[-11:])
    return window[len(window) // 2]


class Refused(Exception):
    def __init__(self, reason, height=None):
        super().__init__(reason)
        self.reason = reason
        self.height = height


def validate_chain(raw, params, start_height=0, start_prev_hash=None, checkpoints=None,
                   now=None, start_bits=None, prior_times=None):
    """Validate a contiguous run of raw headers. Returns a report dict on success. Raises
    Refused on the first violation, naming reason and height. Never returns a partial chain.

    raw             bytes, a multiple of 80
    start_height    height of the first header in raw
    start_prev_hash display hex of the block before the first header (ZERO_HASH for genesis).
                    None means the first header's linkage is unverified and reported as such.
    checkpoints     {height: hash_hex}. Covered heights must match. Uncovered are reported.
    now             unix time for the future drift check, or None to skip (reported).
    start_bits      bits of the block before the first header, for the off boundary rule on
                    the first header. None means that one check is unverified and reported.
    prior_times     times of up to eleven blocks before the first header, for the MTP rule on
                    the first headers. None means MTP starts from inside the file (reported).
    """
    if not isinstance(raw, (bytes, bytearray)):
        raise Refused("headers must be bytes")
    if len(raw) == 0:
        raise Refused("empty header set")
    if len(raw) % HEADER_LEN != 0:
        raise Refused("length %d is not a multiple of 80" % len(raw))
    n = len(raw) // HEADER_LEN
    checkpoints = {int(k): v for k, v in (checkpoints or {}).items()}

    headers = []
    times = list(prior_times or [])
    chainwork = 0
    prev_hash = start_prev_hash
    prev_bits = start_bits
    unverified = []
    retarget_checked = []
    checkpoints_matched = []
    period_first_time = {}   # period index -> time of its first block, when inside the file

    for i in range(n):
        h = start_height + i
        hdr = parse_header(raw[i * HEADER_LEN:(i + 1) * HEADER_LEN])

        # 2. linkage
        if prev_hash is None:
            unverified.append({"height": h, "check": "linkage", "why": "no prev hash supplied"})
        elif hdr["prev"] != prev_hash:
            raise Refused("linkage broken: prev %s.. does not match %s.." % (hdr["prev"][:16], prev_hash[:16]), h)

        # 3. proof of work
        try:
            target = bits_to_target(hdr["bits"])
        except ValueError as e:
            raise Refused("bad bits: %s" % e, h)
        if target > params.pow_limit:
            raise Refused("target above proof of work limit", h)
        if int(hdr["hash"], 16) > target:
            raise Refused("proof of work not met", h)

        # 4. difficulty rule
        if params.interval > 0 and h % params.interval == 0 and h > 0:
            period_start = h - params.interval
            if period_start in period_first_time and prev_bits is not None:
                expected = next_bits(params, prev_bits, period_first_time[period_start], headers[-1]["time"])
                if hdr["bits"] != expected:
                    raise Refused("retarget mismatch: bits 0x%08x expected 0x%08x" % (hdr["bits"], expected), h)
                retarget_checked.append(h)
            else:
                unverified.append({"height": h, "check": "retarget",
                                   "why": "first block of the previous period (height %d) is not in the file" % period_start})
        else:
            if prev_bits is None:
                unverified.append({"height": h, "check": "bits_continuity", "why": "no previous bits supplied"})
            elif hdr["bits"] != prev_bits:
                raise Refused("bits changed off a retarget boundary: 0x%08x after 0x%08x" % (hdr["bits"], prev_bits), h)
        if params.interval > 0 and h % params.interval == 0:
            period_first_time[h] = hdr["time"]

        # 5. median time past
        if times:
            mtp = median_time_past(times)
            if hdr["time"] <= mtp:
                raise Refused("time %d not above median time past %d" % (hdr["time"], mtp), h)
        elif i == 0 and prior_times is None:
            unverified.append({"height": h, "check": "median_time_past", "why": "no prior times supplied"})

        # 6. future time
        if now is not None and hdr["time"] > now + params.max_future:
            raise Refused("time %d is beyond now %d plus drift %d" % (hdr["time"], now, params.max_future), h)

        # 7. checkpoints
        if h in checkpoints:
            if hdr["hash"] != checkpoints[h].lower():
                raise Refused("checkpoint mismatch at height %d" % h, h)
            checkpoints_matched.append(h)

        if h == 0 and params.genesis_hash and hdr["hash"] != params.genesis_hash:
            raise Refused("genesis hash does not match this chain", 0)

        hdr["height"] = h
        hdr["work"] = work_for_target(target)
        chainwork += hdr["work"]
        headers.append(hdr)
        times.append(hdr["time"])
        prev_hash = hdr["hash"]
        prev_bits = hdr["bits"]

    tip = headers[-1]
    unreached = sorted(k for k in checkpoints if k > tip["height"] or k < start_height)
    return {
        "chain": params.name, "count": n, "start_height": start_height, "tip_height": tip["height"],
        "tip_hash": tip["hash"], "tip_time": tip["time"], "chainwork": chainwork,
        "chainwork_hex": "%x" % chainwork, "retarget_verified_at": retarget_checked,
        "checkpoints_matched": checkpoints_matched, "checkpoints_unreached": unreached,
        "unverified": unverified, "future_check": ("done" if now is not None else "skipped, no clock supplied"),
        "headers": headers,
    }


def to_source(report, chain_label="bitcoin"):
    """The exact shape freshness_v3.classify_beacon consumes."""
    return {"chain": chain_label, "tip": report["tip_height"],
            "blocks": {hd["height"]: {"value": hd["hash"], "time": hd["time"]} for hd in report["headers"]}}


def load_source(bin_path, manifest_path, params, now=None, chain_label="bitcoin"):
    """Read a header file plus its manifest, validate, and return (source, report).
    On refusal returns (None, {"refused": reason, "height": h}) so a caller can mark the
    source down with the reason on the record instead of silently dropping it."""
    with io.open(bin_path, "rb") as f:
        raw = f.read()
    with io.open(manifest_path, encoding="utf-8") as f:
        m = json.load(f)
    if m.get("sha256") and hashlib.sha256(raw).hexdigest() != m["sha256"]:
        return None, {"refused": "header file sha256 does not match manifest", "height": None}
    try:
        rep = validate_chain(raw, params, start_height=int(m["start_height"]),
                             start_prev_hash=m.get("start_prev_hash"), checkpoints=m.get("checkpoints"),
                             now=now, start_bits=m.get("start_bits"), prior_times=m.get("prior_times"))
    except Refused as e:
        return None, {"refused": e.reason, "height": e.height}
    return to_source(rep, chain_label), rep


# Bitcoin mainnet. Genesis hash included so a file that starts at height 0 is pinned to it.
MAINNET = ChainParams("bitcoin", 0x1D00FFFF, 2016, 14 * 24 * 3600, 2 * 3600,
                      genesis_hash="000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f")

# The mainnet genesis header, from bytes. If these 80 bytes are wrong the self check below
# fails, which is the point of keeping it: the adapter recognises the real chain from bytes
# alone and never from a name.
GENESIS_HEADER_HEX = ("01000000" + "00" * 32
                      + "3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a"
                      + "29ab5f49" + "ffff001d" + "1dac2b7c")


def self_check():
    g = parse_header(bytes.fromhex(GENESIS_HEADER_HEX))
    ok_hash = g["hash"] == MAINNET.genesis_hash
    ok_pow = int(g["hash"], 16) <= bits_to_target(g["bits"]) <= MAINNET.pow_limit
    ok_compact = target_to_bits(bits_to_target(0x1D00FFFF)) == 0x1D00FFFF and target_to_bits(bits_to_target(0x1703A30C)) == 0x1703A30C
    return {"genesis_hash_from_bytes": g["hash"], "matches_known_genesis": ok_hash,
            "genesis_pow_ok": ok_pow, "compact_roundtrip_ok": ok_compact}


def _cli():
    import argparse
    ap = argparse.ArgumentParser(description="validate a raw header file against Bitcoin consensus rules, offline")
    ap.add_argument("bin", nargs="?", help="raw headers, 80 bytes each, ascending")
    ap.add_argument("manifest", nargs="?", help="json: start_height, start_prev_hash, checkpoints, sha256, start_bits, prior_times")
    ap.add_argument("--now", type=int, default=None, help="unix time for the future drift check")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()
    if a.self_check or not a.bin:
        print(json.dumps(self_check(), indent=1))
        return 0
    src, rep = load_source(a.bin, a.manifest, MAINNET, now=a.now)
    if src is None:
        print(json.dumps({"verdict": "refused", **rep}, indent=1)); return 1
    out = {k: v for k, v in rep.items() if k != "headers"}
    out["verdict"] = "valid"; out["blocks_emitted"] = len(src["blocks"])
    print(json.dumps(out, indent=1)); return 0


if __name__ == "__main__":
    sys.exit(_cli())
