"""
localheaders_stream.py: the same seven checks as localheaders.validate_chain, applied as
headers arrive, in constant memory per header, so a whole chain from genesis can be verified
in one pass while it streams in from the network.

localheaders.validate_chain takes a complete byte string and returns a report holding every
parsed header. That is the right shape for a window of a few thousand headers and the wrong
shape for nine hundred thousand: validating cumulatively after every network message would be
quadratic, and holding every parsed header would cost hundreds of megabytes for nothing.
ChainValidator keeps only what the next header needs: the previous hash and bits, the last
eleven timestamps, the first timestamp of the current and previous difficulty period, the
running chainwork, and the bookkeeping lists. feed() accepts any multiple of eighty bytes and
raises localheaders.Refused on the first violation with the same reason strings, so a caller
cannot tell the two apart except by speed. The red team proves that: it feeds the same bytes
to both in random chunk sizes and requires identical reports.

Nothing here changes localheaders.py, which entry 27 pinned. This file imports its primitives
(parse_header, bits_to_target, next_bits, median_time_past, work_for_target, Refused) and
reuses them unchanged.

Standard library only. Deterministic. Offline.
"""
import hashlib, io, json, os, sys
from collections import deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import localheaders as LH


class ChainValidator:
    def __init__(self, params, start_height=0, start_prev_hash=None, checkpoints=None, now=None,
                 start_bits=None, prior_times=None):
        self.params = params
        self.height = start_height          # height the next header will have
        self.prev_hash = start_prev_hash
        self.prev_bits = start_bits
        self.times = deque(list(prior_times or [])[-11:], maxlen=11)
        self.prior_times_given = prior_times is not None
        self.checkpoints = {int(k): v.lower() for k, v in (checkpoints or {}).items()}
        self.now = now
        self.chainwork = 0
        self.count = 0
        self.tip_hash = None; self.tip_time = None; self.tip_bits = None
        self.period_first_time = {}         # only the two most recent periods are kept
        self.retarget_checked = []
        self.checkpoints_matched = []
        self.unverified = []
        self.start_height = start_height
        self.sha = hashlib.sha256()

    def feed(self, raw):
        if not isinstance(raw, (bytes, bytearray)):
            raise LH.Refused("headers must be bytes")
        if len(raw) % LH.HEADER_LEN != 0:
            raise LH.Refused("length %d is not a multiple of 80" % len(raw))
        p = self.params
        for i in range(0, len(raw), LH.HEADER_LEN):
            chunk = raw[i:i + LH.HEADER_LEN]
            h = self.height
            hdr = LH.parse_header(chunk)

            if self.prev_hash is None:
                self.unverified.append({"height": h, "check": "linkage", "why": "no prev hash supplied"})
            elif hdr["prev"] != self.prev_hash:
                raise LH.Refused("linkage broken: prev %s.. does not match %s.." % (hdr["prev"][:16], self.prev_hash[:16]), h)

            try:
                target = LH.bits_to_target(hdr["bits"])
            except ValueError as e:
                raise LH.Refused("bad bits: %s" % e, h)
            if target > p.pow_limit:
                raise LH.Refused("target above proof of work limit", h)
            if int(hdr["hash"], 16) > target:
                raise LH.Refused("proof of work not met", h)

            if p.interval > 0 and h % p.interval == 0 and h > 0:
                ps = h - p.interval
                if ps in self.period_first_time and self.prev_bits is not None and self.tip_time is not None:
                    expected = LH.next_bits(p, self.prev_bits, self.period_first_time[ps], self.tip_time)
                    if hdr["bits"] != expected:
                        raise LH.Refused("retarget mismatch: bits 0x%08x expected 0x%08x" % (hdr["bits"], expected), h)
                    self.retarget_checked.append(h)
                else:
                    self.unverified.append({"height": h, "check": "retarget",
                                            "why": "first block of the previous period (height %d) is not in the file" % ps})
            else:
                if self.prev_bits is None:
                    self.unverified.append({"height": h, "check": "bits_continuity", "why": "no previous bits supplied"})
                elif hdr["bits"] != self.prev_bits:
                    raise LH.Refused("bits changed off a retarget boundary: 0x%08x after 0x%08x" % (hdr["bits"], self.prev_bits), h)
            if p.interval > 0 and h % p.interval == 0:
                self.period_first_time[h] = hdr["time"]
                for k in [k for k in self.period_first_time if k < h - p.interval]:
                    del self.period_first_time[k]

            if self.times:
                mtp = LH.median_time_past(list(self.times))
                if hdr["time"] <= mtp:
                    raise LH.Refused("time %d not above median time past %d" % (hdr["time"], mtp), h)
            elif self.count == 0 and not self.prior_times_given:
                self.unverified.append({"height": h, "check": "median_time_past", "why": "no prior times supplied"})

            if self.now is not None and hdr["time"] > self.now + p.max_future:
                raise LH.Refused("time %d is beyond now %d plus drift %d" % (hdr["time"], self.now, p.max_future), h)

            if h in self.checkpoints:
                if hdr["hash"] != self.checkpoints[h]:
                    raise LH.Refused("checkpoint mismatch at height %d" % h, h)
                self.checkpoints_matched.append(h)

            if h == 0 and p.genesis_hash and hdr["hash"] != p.genesis_hash:
                raise LH.Refused("genesis hash does not match this chain", 0)

            self.chainwork += LH.work_for_target(target)
            self.times.append(hdr["time"])
            self.prev_hash = hdr["hash"]; self.prev_bits = hdr["bits"]
            self.tip_hash = hdr["hash"]; self.tip_time = hdr["time"]; self.tip_bits = hdr["bits"]
            self.sha.update(chunk)
            self.count += 1
            self.height += 1
        return self

    def report(self):
        if self.count == 0:
            raise LH.Refused("empty header set")
        tip = self.height - 1
        unreached = sorted(k for k in self.checkpoints if k > tip or k < self.start_height)
        return {
            "chain": self.params.name, "count": self.count, "start_height": self.start_height, "tip_height": tip,
            "tip_hash": self.tip_hash, "tip_time": self.tip_time, "chainwork": self.chainwork,
            "chainwork_hex": "%x" % self.chainwork, "retarget_verified_at": list(self.retarget_checked),
            "checkpoints_matched": list(self.checkpoints_matched), "checkpoints_unreached": unreached,
            "unverified": list(self.unverified),
            "future_check": ("done" if self.now is not None else "skipped, no clock supplied"),
            "sha256": self.sha.hexdigest(),
        }


def validate_file_streaming(path, params, chunk_headers=2000, **kw):
    """Validate a header file of any size in one pass. Returns the report."""
    v = ChainValidator(params, **kw)
    with io.open(path, "rb") as f:
        while True:
            b = f.read(chunk_headers * LH.HEADER_LEN)
            if not b:
                break
            v.feed(b)
    return v.report()


def slice_window(path, start_height_of_file, lo, hi):
    """Raw bytes for heights lo..hi inclusive from a file that starts at start_height_of_file."""
    with io.open(path, "rb") as f:
        f.seek((lo - start_height_of_file) * LH.HEADER_LEN)
        return f.read((hi - lo + 1) * LH.HEADER_LEN)


def _cli():
    import argparse
    ap = argparse.ArgumentParser(description="validate a header file of any size in one streaming pass")
    ap.add_argument("bin"); ap.add_argument("manifest")
    ap.add_argument("--now", type=int, default=None)
    a = ap.parse_args()
    m = json.load(io.open(a.manifest, encoding="utf-8"))
    try:
        rep = validate_file_streaming(a.bin, LH.MAINNET, start_height=int(m["start_height"]), start_prev_hash=m.get("start_prev_hash"),
                                      checkpoints=m.get("checkpoints"), now=a.now, start_bits=m.get("start_bits"), prior_times=m.get("prior_times"))
    except LH.Refused as e:
        print(json.dumps({"verdict": "refused", "reason": e.reason, "height": e.height}, indent=1)); return 1
    if m.get("sha256") and rep["sha256"] != m["sha256"]:
        print(json.dumps({"verdict": "refused", "reason": "file sha256 does not match manifest"}, indent=1)); return 1
    rep["verdict"] = "valid"; rep["retarget_boundaries_verified"] = len(rep.pop("retarget_verified_at"))
    print(json.dumps(rep, indent=1)); return 0


if __name__ == "__main__":
    sys.exit(_cli())
