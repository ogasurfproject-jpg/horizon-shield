"""
sync_headers_p2p.py: the courier that is not a website.

sync_headers.py pulled headers through a block explorer's HTTP API, rebuilt them from fields,
and let proof of work decide whether to keep them. That closed trust in the courier but not
the courier's identity: an HTTP explorer is still a third party in the path at sync time.
This file removes it. It speaks the Bitcoin peer to peer protocol directly to full nodes,
asks for headers with getheaders, receives them in headers messages, and validates every one
with localheaders.py before a byte is written. Nothing between the operator and the chain but
the nodes that make up the chain.

What it does, in order:
  1. finds peers: addresses given with --peer, or resolved from the public DNS seeds
  2. handshakes with each: version, verack; answers ping with pong; ignores everything else
  3. sends getheaders with a block locator taken from the manifest of the explorer built file
     (the hash of the block before the window), so the peer answers with the same window
  4. reads headers messages, up to 2000 per message, until the peer has no more
  5. validates the accumulated run after every message with localheaders.validate_chain,
     against the same manifest's prior bits, prior times and checkpoints. A peer that serves
     one bad header is dropped with the reason. The run is never truncated to look valid.
  6. requires the peers that finished to agree byte for byte over the window they all cover.
     Disagreement refuses the sync and names the peers. One peer cannot vouch alone unless
     --min-peers 1 is given, and then the manifest says so.
  7. writes localheaders_p2p.bin and its manifest only if every step above held, then reads
     them back through localheaders.load_source as the last check.

Message framing, for anyone checking this against the protocol: 4 byte magic, 12 byte
command, 4 byte little endian payload length, 4 byte checksum (first four bytes of double
SHA-256 of the payload), payload. Hashes travel in internal byte order, the reverse of the
display order explorers print. Protocol version 70016. The client advertises no services and
asks for no transactions.

Named limits: a peer can be stale (lag, reported as a lower tip, never a veto); a set of
peers could all be sybils serving the same forged chain, which proof of work bounds by
hashpower and the operator's checkpoints refuse; DNS seeds are a third party for discovery
only, never for data, and --peer bypasses them entirely.

v2 (supersedes the bytes entry 28 pinned; that sha stays on record in the next addendum):
validation is now streaming through localheaders_stream.ChainValidator, one pass, constant
memory, proven equivalent to validate_chain by stream_redteam.py, so a whole chain can be
pulled in one run. --from-genesis asks for everything after the genesis block, which the
adapter already knows from bytes, and verifies every difficulty boundary from height 2016 to
the tip from inside the file. No checkpoint is needed then except the genesis hash itself.
--check-against reads an earlier window's manifest and requires its checkpoints to sit on
the full chain at the same hashes.

v3 (supersedes the bytes entry 29 pinned; that sha stays on record in the next addendum):
a refusal now leaves a record. "Nothing is written on a refusal" was meant for header bytes
and had swallowed the record too, so a sync that refused left nothing a downstream consumer
could query; the failure mode was legible only in the red team's output and in prose. Now
every refusal writes <out-prefix>.refusal.<time>.json: the reason code, the height, the two
peers and the two hashes when peers disagree, every peer that finished or was dropped, and
bytes_written false. Header bytes are still never written on a refusal. The record is a
ledger seed's worth of evidence: make_refusal_seed.py turns it into a JIDEC entry of its own.

Standard library only. Run from the coordinate-v1 directory:

    python3 sync_headers_p2p.py --from-manifest localheaders_mainnet.manifest.json
    python3 sync_headers_p2p.py --from-genesis --check-against localheaders_mainnet.manifest.json --out-prefix localheaders_full
    python3 sync_headers_p2p.py --from-manifest localheaders_mainnet.manifest.json --peer 203.0.113.5:8333 --peer 198.51.100.7:8333
"""
import socket, struct, hashlib, time, json, io, os, sys, argparse, random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import localheaders as LH
import localheaders_stream as LS

MAINNET_MAGIC = bytes.fromhex("f9beb4d9")
PROTOCOL_VERSION = 70016
USER_AGENT = b"/nenrin-localheaders:1/"
DNS_SEEDS = ["seed.bitcoin.sipa.be", "dnsseed.bluematt.me", "seed.bitcoinstats.com",
             "seed.bitcoin.jonasschnelli.ch", "seed.btc.petertodd.org", "seed.bitcoin.sprovoost.nl",
             "dnsseed.emzy.de", "seed.bitcoin.wiz.biz"]
MAX_HEADERS_PER_MSG = 2000
MAX_PAYLOAD = 4 * 1024 * 1024


class PeerError(Exception):
    pass


class Disagreement(PeerError):
    """Two peers served different valid headers at the same height. Carries the evidence."""

    def __init__(self, height, ref_peer, ref_hash, peer, peer_hash, common_headers):
        self.height, self.ref_peer, self.ref_hash, self.peer, self.peer_hash, self.common_headers = \
            height, ref_peer, ref_hash, peer, peer_hash, common_headers
        super().__init__("disagrees with the reference run (%s) at height %d: %s.. vs %s.."
                         % (ref_peer, height, ref_hash[:16], peer_hash[:16]))


REFUSAL_SCHEMA = "nenrin-localheaders-refusal-1"


def write_refusal(out_prefix, now, params, magic, mode, reason_code, reason, results, failures, wanted, min_peers,
                  start_height, checkpoints, height=None, disagreement=None):
    """A refusal is evidence. Header bytes are not written; this record is. Returns the path."""
    mainnet = (params is LH.MAINNET and magic == MAINNET_MAGIC)
    rec = {
        "schema": REFUSAL_SCHEMA, "chain": params.name, "courier": "bitcoin p2p getheaders", "mode": mode,
        "network": ("bitcoin mainnet" if mainnet else "test network (magic %s, params %s): not the real chain" % (magic.hex(), params.name)),
        "refused_at": now, "reason_code": reason_code, "reason": reason, "height": height,
        "disagreement": disagreement,
        "peers_finished": {n: {"tip_height": results[n][1]["tip_height"], "headers": results[n][1]["count"]} for n in sorted(results)},
        "peers_failed": dict(failures), "peers_wanted": wanted, "min_peers": min_peers,
        "start_height": start_height, "checkpoints": {str(k): v for k, v in sorted((int(k), v) for k, v in (checkpoints or {}).items())},
        "bytes_written": False,
        "note": "a refusal is evidence. no header bytes were written; this record was. a contradiction between sources is "
                "exposed here by name and height so that anyone can query it, not only read about it.",
    }
    path = "%s.refusal.%d.json" % (out_prefix, now)
    io.open(path, "w", encoding="utf-8").write(json.dumps(rec, ensure_ascii=False, indent=1, sort_keys=True))
    return path


def varint(n):
    if n < 0xFD: return struct.pack("<B", n)
    if n <= 0xFFFF: return b"\xfd" + struct.pack("<H", n)
    if n <= 0xFFFFFFFF: return b"\xfe" + struct.pack("<I", n)
    return b"\xff" + struct.pack("<Q", n)


def read_varint(buf, pos):
    b = buf[pos]
    if b < 0xFD: return b, pos + 1
    if b == 0xFD: return struct.unpack_from("<H", buf, pos + 1)[0], pos + 3
    if b == 0xFE: return struct.unpack_from("<I", buf, pos + 1)[0], pos + 5
    return struct.unpack_from("<Q", buf, pos + 1)[0], pos + 9


def frame(magic, command, payload):
    cmd = command.encode("ascii").ljust(12, b"\x00")
    return magic + cmd + struct.pack("<I", len(payload)) + LH.dsha256(payload)[:4] + payload


def net_addr(services=0, ip="0.0.0.0", port=0):
    packed = b"\x00" * 10 + b"\xff\xff" + socket.inet_aton(ip)
    return struct.pack("<Q", services) + packed + struct.pack(">H", port)


def version_payload(start_height=0):
    nonce = random.getrandbits(64)
    return (struct.pack("<iQq", PROTOCOL_VERSION, 0, int(time.time())) + net_addr() + net_addr()
            + struct.pack("<Q", nonce) + varint(len(USER_AGENT)) + USER_AGENT + struct.pack("<i", start_height) + b"\x00")


def getheaders_payload(locator_display_hashes, stop=None):
    body = struct.pack("<i", PROTOCOL_VERSION) + varint(len(locator_display_hashes))
    for h in locator_display_hashes:
        body += bytes.fromhex(h)[::-1]
    body += bytes.fromhex(stop)[::-1] if stop else b"\x00" * 32
    return body


class Peer:
    """One connection. Blocking sockets, explicit timeouts, no threads."""

    def __init__(self, host, port, magic=MAINNET_MAGIC, timeout=30.0):
        self.host, self.port, self.magic, self.timeout = host, port, magic, timeout
        self.sock = None; self.buf = b""; self.their_version = None; self.log = []

    def name(self):
        return "%s:%d" % (self.host, self.port)

    def connect(self):
        self.sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
        self.sock.settimeout(self.timeout)

    def send(self, command, payload=b""):
        self.sock.sendall(frame(self.magic, command, payload))

    def _fill(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise PeerError("connection closed by peer")
            self.buf += chunk

    def recv(self):
        """One message: (command, payload). Bad magic or checksum is a PeerError, not a skip."""
        self._fill(24)
        magic, cmd, length, checksum = self.buf[:4], self.buf[4:16], struct.unpack("<I", self.buf[16:20])[0], self.buf[20:24]
        if magic != self.magic:
            raise PeerError("wrong network magic %s" % magic.hex())
        if length > MAX_PAYLOAD:
            raise PeerError("payload length %d exceeds limit" % length)
        self._fill(24 + length)
        payload = self.buf[24:24 + length]; self.buf = self.buf[24 + length:]
        if LH.dsha256(payload)[:4] != checksum:
            raise PeerError("checksum mismatch on %s" % cmd.rstrip(b"\x00").decode("ascii", "replace"))
        return cmd.rstrip(b"\x00").decode("ascii", "replace"), payload

    def handshake(self):
        self.send("version", version_payload())
        got_version = got_verack = False
        deadline = time.time() + self.timeout
        while not (got_version and got_verack):
            if time.time() > deadline:
                raise PeerError("handshake timed out")
            cmd, payload = self.recv()
            if cmd == "version":
                self.their_version = struct.unpack_from("<i", payload, 0)[0]
                ua_len, pos = read_varint(payload, 80)
                self.user_agent = payload[pos:pos + ua_len].decode("utf-8", "replace")
                self.start_height = struct.unpack_from("<i", payload, pos + ua_len)[0]
                got_version = True
                self.send("verack")
            elif cmd == "verack":
                got_verack = True
            elif cmd == "ping":
                self.send("pong", payload)
            # sendcmpct, wtxidrelay, sendaddrv2, feefilter, sendheaders, alert: ignored
        self.log.append("handshake ok, peer %s height %d" % (self.user_agent, self.start_height))

    def get_headers(self, locator, stop=None):
        """Send getheaders, wait for one headers message, return list of raw 80 byte headers."""
        self.send("getheaders", getheaders_payload(locator, stop))
        deadline = time.time() + self.timeout
        while True:
            if time.time() > deadline:
                raise PeerError("no headers message within timeout")
            cmd, payload = self.recv()
            if cmd == "ping":
                self.send("pong", payload); continue
            if cmd != "headers":
                continue
            count, pos = read_varint(payload, 0)
            if count > MAX_HEADERS_PER_MSG:
                raise PeerError("headers count %d exceeds protocol maximum" % count)
            out = []
            for _ in range(count):
                if pos + 80 > len(payload):
                    raise PeerError("headers payload truncated")
                out.append(payload[pos:pos + 80]); pos += 80
                txn, pos = read_varint(payload, pos)
                if txn != 0:
                    raise PeerError("headers message carried a transaction count %d" % txn)
            if pos != len(payload):
                raise PeerError("headers payload has %d trailing bytes" % (len(payload) - pos))
            return out

    def close(self):
        try:
            if self.sock: self.sock.close()
        except OSError:
            pass


def sync_from_peer(peer, start_height, start_prev, seed_raw, params, checkpoints, now, start_bits, prior_times,
                   reference=None, reference_peer=None, log=print, every=25):
    """Pull headers after start_prev from one peer, validating as they arrive (one pass, constant
    memory). seed_raw is any header bytes the caller already holds at start_height (the genesis
    header in from-genesis mode), fed first. If reference bytes are given, every batch is
    compared byte for byte at the same offset and a mismatch is a refusal naming the height.
    Returns (raw_bytes, report). Raises PeerError on any refusal."""
    v = LS.ChainValidator(params, start_height=start_height, start_prev_hash=start_prev, checkpoints=checkpoints,
                          now=now, start_bits=start_bits, prior_times=prior_times)
    raw = b""
    if seed_raw:
        v.feed(seed_raw); raw += seed_raw
    last_display = v.tip_hash if v.count else start_prev
    msgs = 0
    while True:
        batch = peer.get_headers([last_display])
        if not batch:
            break
        chunk = b"".join(batch)
        try:
            v.feed(chunk)
        except LH.Refused as e:
            raise PeerError("served a header that fails validation at height %s: %s" % (e.height, e.reason))
        if reference is not None:
            off = len(raw); ref = reference[off:off + len(chunk)]
            if ref and ref != chunk[:len(ref)]:
                bad = next(i for i in range(len(ref)) if ref[i] != chunk[i]) // 80
                h = start_height + off // 80 + bad
                ref_hash = LH.parse_header(ref[bad * 80:(bad + 1) * 80])["hash"]
                peer_hash = LH.parse_header(chunk[bad * 80:(bad + 1) * 80])["hash"]
                raise Disagreement(h, reference_peer or "reference", ref_hash, peer.name(), peer_hash, off // 80 + bad)
        raw += chunk
        last_display = v.tip_hash
        msgs += 1
        if msgs % every == 0 or len(batch) < MAX_HEADERS_PER_MSG:
            log("  %s: %d headers, tip %d, %d retargets verified" % (peer.name(), v.count, v.height - 1, len(v.retarget_checked)))
        if len(batch) < MAX_HEADERS_PER_MSG:
            break
    if v.count == 0:
        raise PeerError("peer returned no headers for the locator")
    return raw, v.report()


def discover(seeds, want, port=8333, log=print):
    addrs = []
    for s in seeds:
        try:
            for fam, _, _, _, sa in socket.getaddrinfo(s, port, socket.AF_INET, socket.SOCK_STREAM):
                addrs.append((sa[0], port))
        except socket.gaierror as e:
            log("  seed %s: %s" % (s, e))
    random.shuffle(addrs)
    seen = set(); out = []
    for a in addrs:
        if a not in seen:
            seen.add(a); out.append(a)
    log("  %d candidate addresses from %d seeds" % (len(out), len(seeds)))
    return out[:max(want * 6, 12)]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-manifest", default=None, help="manifest of an earlier window; supplies start, prev hash, prior bits and times, checkpoints")
    ap.add_argument("--from-genesis", action="store_true", help="pull the whole chain after the genesis block the adapter knows from bytes")
    ap.add_argument("--check-against", default=None, help="manifest whose checkpoints must sit on the chain at the same hashes (from-genesis mode)")
    ap.add_argument("--peer", action="append", default=[], help="host:port, repeatable. bypasses DNS seeds")
    ap.add_argument("--peers", type=int, default=3, help="how many peers must finish and agree")
    ap.add_argument("--min-peers", type=int, default=2, help="refuse to write below this many agreeing peers")
    ap.add_argument("--out-prefix", default="localheaders_p2p")
    ap.add_argument("--timeout", type=float, default=30.0)
    ap.add_argument("--magic", default=MAINNET_MAGIC.hex(), help="network magic hex (tests use their own)")
    ap.add_argument("--params", choices=["mainnet", "test"], default="mainnet")
    ap.add_argument("--now", type=int, default=None, help="clock for the future drift check (default: wall clock)")
    ap.add_argument("--compare", default=None, help="a .bin to compare bytes against over the common window")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    if bool(a.from_manifest) == bool(a.from_genesis):
        raise SystemExit("give exactly one of --from-manifest or --from-genesis")

    params = LH.MAINNET if a.params == "mainnet" else LH.ChainParams("test", 0x1F040000, 8, 8 * 600, 2 * 3600)
    magic = bytes.fromhex(a.magic)
    now = a.now if a.now is not None else int(time.time())
    if a.from_manifest:
        with io.open(a.from_manifest, encoding="utf-8") as f:
            manifest = json.load(f)
        start_height = int(manifest["start_height"]); start_prev = manifest["start_prev_hash"]
        start_bits = manifest.get("start_bits"); prior_times = manifest.get("prior_times")
        checkpoints = manifest.get("checkpoints") or {}; seed_raw = b""
        mode = "window from manifest"
    else:
        start_height = 0; start_prev = LH.ZERO_HASH; start_bits = None; prior_times = []
        seed_raw = bytes.fromhex(LH.GENESIS_HEADER_HEX) if params is LH.MAINNET else b""
        checkpoints = {}
        if a.check_against:
            with io.open(a.check_against, encoding="utf-8") as f:
                checkpoints = json.load(f).get("checkpoints") or {}
        manifest = {"start_prev_hash": start_prev, "start_bits": start_bits, "prior_times": prior_times}
        mode = "whole chain from genesis"
    print("mode: %s | params %s | peers wanted %d, minimum %d | checkpoints %d" % (mode, params.name, a.peers, a.min_peers, len(checkpoints)))

    candidates = [(h, int(p)) for h, p in (x.rsplit(":", 1) for x in a.peer)] if a.peer else discover(DNS_SEEDS, a.peers)
    results = {}; failures = {}; reference = None; reference_peer = None

    def refuse(code, reason, height=None, disagreement=None):
        path = write_refusal(a.out_prefix, now, params, magic, mode, code, reason, results, failures, a.peers, a.min_peers,
                             start_height, checkpoints, height=height, disagreement=disagreement)
        raise SystemExit("%s no header bytes written. refusal record: %s" % (reason, path))

    for host, port in candidates:
        if len(results) >= a.peers:
            break
        peer = Peer(host, port, magic=magic, timeout=a.timeout)
        try:
            peer.connect(); peer.handshake()
            print("  %s: %s" % (peer.name(), peer.log[-1]))
            raw, rep = sync_from_peer(peer, start_height, start_prev, seed_raw, params, checkpoints, now, start_bits, prior_times,
                                      reference=reference, reference_peer=reference_peer)
            results[peer.name()] = (raw, rep)
            if reference is None or len(raw) > len(reference):
                reference = raw; reference_peer = peer.name()
        except Disagreement as e:
            peer.close()
            refuse("peers_disagree", "peers disagree over the common window: %s vs %s at height %d." % (e.ref_peer, e.peer, e.height),
                   height=e.height, disagreement={"peer_a": e.ref_peer, "hash_a": e.ref_hash, "peer_b": e.peer, "hash_b": e.peer_hash,
                                                  "height": e.height, "common_headers_before": e.common_headers})
        except PeerError as e:
            failures[peer.name()] = str(e)
            print("  %s: dropped: %s" % (peer.name(), e))
        except (OSError, socket.timeout) as e:
            failures[peer.name()] = str(e)
            print("  %s: dropped: %s" % (peer.name(), e))
        finally:
            peer.close()

    if len(results) < a.min_peers:
        refuse("below_min_peers", "only %d peer(s) finished, need %d." % (len(results), a.min_peers))

    # agreement over the common window: every finished peer must be byte identical up to the shortest.
    # the streaming comparison above already refused any mismatch; this is the belt to that brace.
    names = sorted(results); shortest = min(len(results[n][0]) for n in names)
    common = {n: results[n][0][:shortest] for n in names}
    ref = common[names[0]]
    disagree = [n for n in names if common[n] != ref]
    if disagree:
        other = common[disagree[0]]
        bad = next(i for i in range(shortest) if ref[i] != other[i]) // 80
        h = start_height + bad
        refuse("peers_disagree", "peers disagree over the common window: %s vs %s at height %d." % (names[0], disagree[0], h),
               height=h, disagreement={"peer_a": names[0], "hash_a": LH.parse_header(ref[bad * 80:(bad + 1) * 80])["hash"],
                                       "peer_b": disagree[0], "hash_b": LH.parse_header(other[bad * 80:(bad + 1) * 80])["hash"],
                                       "height": h, "common_headers_before": bad})
    longest = max(names, key=lambda n: len(results[n][0]))
    raw, rep = results[longest]
    tips = {n: results[n][1]["tip_height"] for n in names}
    sha = hashlib.sha256(raw).hexdigest()
    print("agreed: %d peers byte identical over %d headers; tips %s; longest %s tip %d; sha256 %s"
          % (len(names), shortest // 80, tips, longest, rep["tip_height"], sha[:16]))

    cmp_note = None
    if a.compare:
        other = io.open(a.compare, "rb").read(); n = min(len(other), len(raw))
        same = other[:n] == raw[:n]
        cmp_note = {"file": a.compare, "common_headers": n // 80, "byte_identical": same,
                    "sha256_common_from_p2p": hashlib.sha256(raw[:n]).hexdigest(), "sha256_common_from_file": hashlib.sha256(other[:n]).hexdigest()}
        print("compare with %s: %d common headers, byte identical: %s" % (a.compare, n // 80, same))

    if a.dry_run:
        print("dry run. nothing written."); return 0

    out_manifest = {
        "schema": "nenrin-localheaders-manifest-1", "chain": params.name, "courier": "bitcoin p2p getheaders", "mode": mode,
        "peers": {n: {"tip_height": results[n][1]["tip_height"], "headers": results[n][1]["count"]} for n in names},
        "peers_failed": failures, "min_peers": a.min_peers, "synced_at": now,
        "start_height": rep["start_height"], "count": rep["count"], "tip_height": rep["tip_height"], "tip_hash": rep["tip_hash"],
        "tip_time": rep["tip_time"], "chainwork_hex": rep["chainwork_hex"], "sha256": sha,
        "start_prev_hash": manifest["start_prev_hash"], "start_bits": manifest.get("start_bits"), "prior_times": manifest.get("prior_times"),
        "checkpoints": dict(checkpoints, **{str(rep["tip_height"]): rep["tip_hash"]}),
        "retarget_boundaries_verified": len(rep["retarget_verified_at"]),
        "retarget_verified_at": (rep["retarget_verified_at"] if len(rep["retarget_verified_at"]) <= 8 else [rep["retarget_verified_at"][0], "...", rep["retarget_verified_at"][-1]]),
        "unverified": rep["unverified"], "future_check": rep["future_check"],
        "compare": cmp_note,
        "note": "no HTTP explorer in the path. headers came from full nodes over the peer to peer protocol, were validated by consensus rules, and had to agree byte for byte across peers before anything was written.",
    }
    bp = a.out_prefix + ".bin"; mp = a.out_prefix + ".manifest.json"
    io.open(bp, "wb").write(raw)
    io.open(mp, "w", encoding="utf-8").write(json.dumps(out_manifest, ensure_ascii=False, indent=1))
    try:
        back = LS.validate_file_streaming(bp, params, start_height=start_height, start_prev_hash=start_prev, checkpoints=out_manifest["checkpoints"],
                                          now=now, start_bits=start_bits, prior_times=prior_times)
    except LH.Refused as e:
        os.remove(bp); os.remove(mp)
        refuse("readback_refused", "read back failed: %s at %s. files removed." % (e.reason, e.height), height=e.height)
    if back["sha256"] != sha:
        os.remove(bp); os.remove(mp)
        refuse("readback_sha_mismatch", "read back sha mismatch. files removed.")
    print("wrote %s (%d bytes) and %s | read back tip %d, %d headers, %d retarget boundaries verified, checkpoints matched %s"
          % (bp, len(raw), mp, back["tip_height"], back["count"], len(back["retarget_verified_at"]), back["checkpoints_matched"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
